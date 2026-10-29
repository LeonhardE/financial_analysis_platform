"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isPrivateServiceConfigured, useAuth } from "@/components/AuthProvider";
import {
  HOLDINGS_CSV_MAX_BYTES,
  HoldingsCsvError,
  parseHoldingsCsv,
  selectHoldingsAccounts,
  type HoldingsCsvPreview,
  type HoldingsResourceContent,
} from "@/lib/holdings-csv";
import { EncryptedVaultSession } from "@/lib/encrypted-vault";
import { createVaultPasskey, unlockVaultPasskey } from "@/lib/encrypted-passkey";
import type { PendingSnapshot, Source, Vault } from "@/lib/encrypted-types";

const CONTRACT = "folioview.agent-workspace.v2.0";
const contractHeaders = { "X-FolioView-Contract": CONTRACT };
type Phase = "checking" | "needs-vault" | "locked" | "unlocked";
type Busy =
  "loading" | "creating" | "unlocking" | "parsing" | "saving" | "reading" | "recovering" | null;
type State = {
  owner: string | null;
  phase: Phase;
  busy: Busy;
  vault: Vault | null;
  sources: Source[];
  preview: HoldingsCsvPreview | null;
  content: HoldingsResourceContent | null;
  hasPending: boolean;
  discardOperationId: string | null;
  error: string;
  errorRow: number | null;
  notice: string;
};
const empty: State = {
  owner: null,
  phase: "checking",
  busy: null,
  vault: null,
  sources: [],
  preview: null,
  content: null,
  hasPending: false,
  discardOperationId: null,
  error: "",
  errorRow: null,
  notice: "",
};
class WorkspaceError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
function id(prefix: string) {
  return `${prefix}_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function sameSource(left: unknown, right: Source["resourceRef"]) {
  return (
    record(left) &&
    ["kind", "sourceService", "resourceId", "incarnation"].every(
      (key) => left[key] === right[key as keyof typeof right],
    )
  );
}
function aggregate(value: unknown): { vault: Vault | null; sources: Source[] } {
  if (
    !record(value) ||
    value.contractVersion !== CONTRACT ||
    !Array.isArray(value.sources) ||
    value.sources.length > 10 ||
    !(value.vault === null || record(value.vault))
  )
    throw new WorkspaceError("invalid_response");
  const seen = new Set<string>();
  for (const source of value.sources) {
    if (
      !record(source) ||
      !record(source.resourceRef) ||
      source.resourceRef.kind !== "holdings" ||
      source.resourceRef.sourceService !== "portfolio" ||
      typeof source.resourceRef.resourceId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(source.resourceRef.resourceId) ||
      typeof source.resourceRef.incarnation !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(source.resourceRef.incarnation) ||
      !Number.isSafeInteger(source.sourceEpoch) ||
      (source.sourceEpoch as number) < 1 ||
      seen.has(source.resourceRef.resourceId)
    )
      throw new WorkspaceError("invalid_response");
    seen.add(source.resourceRef.resourceId);
  }
  if (!value.vault && value.sources.length) throw new WorkspaceError("invalid_response");
  return { vault: value.vault as Vault | null, sources: value.sources as Source[] };
}
function errorCode(error: unknown): string {
  if (error instanceof HoldingsCsvError) return error.code;
  if (record(error) && typeof error.code === "string" && /^[a-z_]{1,80}$/.test(error.code)) {
    return error.code;
  }
  return "request_failed";
}

export function useHoldingsWorkspace() {
  const auth = useAuth();
  const owner = auth.status === "authenticated" && auth.profile ? auth.sessionKey : null;
  const uid = owner ? auth.profile!.uid : null;
  const configured =
    isPrivateServiceConfigured("portfolio") && isPrivateServiceConfigured("agent-hub");
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const [state, setState] = useState<State>(empty);
  const stateRef = useRef(state);
  stateRef.current = state;
  const serial = useRef(0);
  const current = useRef<{ serial: number; controller: AbortController } | null>(null);
  const session = useRef<{ owner: string; instance: EncryptedVaultSession } | null>(null);
  const pending = useRef<PendingSnapshot | null>(null);

  const terminate = useCallback(() => {
    session.current?.instance.lock();
    session.current = null;
    pending.current = null;
  }, []);

  const perform = useCallback(
    async (
      busy: Exclude<Busy, null>,
      action: (context: { assertActive: () => void; signal: AbortSignal }) => Promise<void>,
    ) => {
      if (!owner || !uid || ownerRef.current !== owner || current.current || !configured) return;
      const controller = new AbortController();
      const call = { serial: ++serial.current, controller };
      current.current = call;
      const owns = () =>
        ownerRef.current === owner && serial.current === call.serial && !controller.signal.aborted;
      const assertActive = () => {
        if (!owns()) throw new WorkspaceError("cancelled");
      };
      setState((previous) => ({
        ...(previous.owner === owner ? previous : empty),
        owner,
        busy,
        error: "",
        errorRow: null,
        notice: "",
        discardOperationId: null,
      }));
      const timeout = window.setTimeout(
        () => {
          if (!owns()) return;
          controller.abort();
          ++serial.current;
          current.current = null;
          terminate();
          setState((previous) => ({
            ...previous,
            busy: null,
            phase: previous.vault ? "locked" : "needs-vault",
            preview: null,
            content: null,
            hasPending: false,
            discardOperationId: null,
            error: "request_timeout",
          }));
        },
        busy === "creating" || busy === "unlocking" ? 120_000 : 60_000,
      );
      try {
        await action({ assertActive, signal: controller.signal });
      } catch (error) {
        if (!owns()) return;
        if (busy === "creating" || busy === "unlocking") terminate();
        setState((previous) => ({
          ...previous,
          ...(busy === "creating" || busy === "unlocking"
            ? {
                phase: previous.vault ? ("locked" as const) : ("needs-vault" as const),
                content: null,
                preview: null,
              }
            : {}),
          ...(busy === "reading" || busy === "saving" ? { content: null } : {}),
          error: errorCode(error),
          errorRow: error instanceof HoldingsCsvError ? error.row : null,
        }));
      } finally {
        window.clearTimeout(timeout);
        if (owns()) setState((previous) => ({ ...previous, busy: null }));
        if (current.current === call) current.current = null;
      }
    },
    [owner, uid, configured, terminate],
  );

  const api = useCallback(
    async (
      service: "portfolio" | "agent-hub",
      path: string,
      signal: AbortSignal,
      options: {
        method?: "GET" | "POST" | "PUT";
        json?: unknown;
        headers?: Record<string, string>;
        allowMissing?: boolean;
      } = {},
    ): Promise<unknown> => {
      if (!owner || ownerRef.current !== owner || signal.aborted)
        throw new WorkspaceError("cancelled");
      const { allowMissing, ...transport } = options;
      const response = await auth.requestPrivate(service, path, owner, {
        ...transport,
        signal,
        headers: { ...contractHeaders, ...(options.headers ?? {}) },
      });
      if (ownerRef.current !== owner || signal.aborted) throw new WorkspaceError("cancelled");
      if (!response.ok) {
        if (allowMissing && response.status === 404) {
          const text = await response.text();
          if (ownerRef.current !== owner || signal.aborted) throw new WorkspaceError("cancelled");
          if (new TextEncoder().encode(text).length > 16_384)
            throw new WorkspaceError("invalid_response");
          let value: unknown;
          try {
            value = JSON.parse(text);
          } catch {
            throw new WorkspaceError("invalid_response");
          }
          if (
            !record(value) ||
            value.contractVersion !== CONTRACT ||
            !record(value.error) ||
            value.error.code !== "not_found"
          )
            throw new WorkspaceError("invalid_response");
          return null;
        }
        throw new WorkspaceError(
          response.status === 409
            ? "version_conflict"
            : response.status === 401
              ? "session_expired"
              : response.status === 403
                ? "insufficient_scope"
                : "service_unavailable",
        );
      }
      const text = await response.text();
      if (ownerRef.current !== owner || signal.aborted) throw new WorkspaceError("cancelled");
      if (new TextEncoder().encode(text).length > 1_048_576)
        throw new WorkspaceError("invalid_response");
      try {
        return JSON.parse(text);
      } catch {
        throw new WorkspaceError("invalid_response");
      }
    },
    [auth.requestPrivate, owner],
  );

  const readCurrent = useCallback(
    async (signal: AbortSignal) =>
      aggregate(await api("agent-hub", "/api/v2/vaults/current", signal)),
    [api],
  );

  const liveSession = useCallback(() => {
    if (!owner || ownerRef.current !== owner || session.current?.owner !== owner)
      throw new WorkspaceError("unlock_required");
    return session.current.instance;
  }, [owner]);

  const sync = useCallback(
    async (source: Source, signal: AbortSignal) => {
      const token = await api("agent-hub", "/api/v2/vaults/current/authority-token", signal, {
        method: "POST",
        json: { contractVersion: CONTRACT },
      });
      if (
        !record(token) ||
        token.contractVersion !== CONTRACT ||
        typeof token.token !== "string" ||
        token.token.length > 16_384
      )
        throw new WorkspaceError("invalid_response");
      await api(
        "portfolio",
        `/api/v2/holdings/sources/${source.resourceRef.resourceId}/authority-sync`,
        signal,
        {
          method: "POST",
          json: { contractVersion: CONTRACT },
          headers: { "X-FolioView-Authority-Delegation": token.token },
        },
      );
    },
    [api],
  );

  const readSaved = useCallback(
    async (source: Source, signal: AbortSignal, assertActive: () => void) => {
      await sync(source, signal);
      const metadata = await api(
        "portfolio",
        `/api/v2/holdings/sources/${source.resourceRef.resourceId}`,
        signal,
      );
      if (
        !record(metadata) ||
        metadata.contractVersion !== CONTRACT ||
        !sameSource(metadata.resourceRef, source.resourceRef) ||
        metadata.sourceEpoch !== source.sourceEpoch ||
        !Number.isSafeInteger(metadata.revision) ||
        (metadata.revision as number) < 0
      )
        throw new WorkspaceError("invalid_response");
      const instance = liveSession();
      const recovered = await instance.loadOutbox(source.resourceRef.resourceId);
      assertActive();
      pending.current = recovered;
      if (metadata.snapshotId === null) {
        setState((previous) => ({
          ...previous,
          content: null,
          hasPending: Boolean(pending.current),
        }));
        return;
      }
      if (
        typeof metadata.snapshotId !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(metadata.snapshotId)
      )
        throw new WorkspaceError("invalid_response");
      const stored = await api(
        "portfolio",
        `/api/v2/holdings/sources/${source.resourceRef.resourceId}/snapshots/${metadata.snapshotId}`,
        signal,
      );
      assertActive();
      const receipt = record(stored) && record(stored.receipt) ? stored.receipt : null;
      const expectedPath = `/api/v2/holdings/sources/${source.resourceRef.resourceId}/snapshots/${metadata.snapshotId}`;
      if (
        !record(stored) ||
        stored.contractVersion !== CONTRACT ||
        !receipt ||
        receipt.snapshotId !== metadata.snapshotId ||
        receipt.revision !== metadata.revision ||
        receipt.snapshotPath !== expectedPath ||
        !sameSource(receipt.resourceRef, source.resourceRef) ||
        (metadata.snapshotSourceEpoch != null &&
          (!Number.isSafeInteger(metadata.snapshotSourceEpoch) ||
            receipt.sourceEpoch !== metadata.snapshotSourceEpoch))
      )
        throw new WorkspaceError("invalid_response");
      const content = await instance.openSnapshot(
        stored as Parameters<EncryptedVaultSession["openSnapshot"]>[0],
        source,
      );
      assertActive();
      setState((previous) => ({
        ...previous,
        content: content as HoldingsResourceContent,
        hasPending: Boolean(pending.current),
      }));
    },
    [api, liveSession, sync],
  );

  const reload = useCallback(
    () =>
      perform("loading", async ({ assertActive, signal }) => {
        const result = await readCurrent(signal);
        assertActive();
        terminate();
        setState({
          ...empty,
          owner,
          vault: result.vault,
          sources: result.sources,
          phase: result.vault ? "locked" : "needs-vault",
          busy: "loading",
        });
      }),
    [owner, perform, readCurrent, terminate],
  );

  useEffect(() => {
    ++serial.current;
    current.current?.controller.abort();
    current.current = null;
    terminate();
    setState({ ...empty, owner });
    if (owner && configured) void reload();
    return () => {
      ++serial.current;
      current.current?.controller.abort();
      current.current = null;
      terminate();
    };
  }, [owner, configured, reload, terminate]);

  const unlock = useCallback(
    () =>
      perform("unlocking", async ({ assertActive, signal }) => {
        const vault = stateRef.current.owner === owner ? stateRef.current.vault : null;
        if (!vault || !uid || !owner) throw new WorkspaceError("unlock_required");
        terminate();
        const instance = new EncryptedVaultSession(uid);
        session.current = { owner, instance };
        const material = await unlockVaultPasskey(vault.archive);
        try {
          assertActive();
          const result = await instance.unlock(vault, material);
          assertActive();
          if (result.needsDeviceRegistration) {
            const update = await instance.prepareDeviceRegistration(vault);
            assertActive();
            await api("agent-hub", `/api/v2/vaults/${vault.vaultId}/registry`, signal, {
              method: "PUT",
              json: {
                contractVersion: CONTRACT,
                expectedVersion: update.expectedVersion,
                registryBundle: update.registryBundle,
              },
              headers: { "Idempotency-Key": update.operationId },
            });
          }
          const refreshed = await readCurrent(signal);
          assertActive();
          if (!refreshed.vault) throw new WorkspaceError("invalid_response");
          await instance.acceptVault(refreshed.vault);
          assertActive();
          setState((previous) => ({
            ...previous,
            phase: "unlocked",
            vault: refreshed.vault,
            sources: refreshed.sources,
          }));
          if (refreshed.sources[0]) await readSaved(refreshed.sources[0], signal, assertActive);
        } finally {
          if (material.secret.byteLength) new Uint8Array(material.secret).fill(0);
        }
      }),
    [api, owner, perform, readCurrent, readSaved, terminate, uid],
  );

  const create = useCallback(
    () =>
      perform("creating", async ({ assertActive, signal }) => {
        if (!uid || !owner || stateRef.current.vault) throw new WorkspaceError("version_conflict");
        terminate();
        const instance = new EncryptedVaultSession(uid);
        session.current = { owner, instance };
        await instance.prepareCreate();
        assertActive();
        const material = await createVaultPasskey(uid);
        try {
          assertActive();
          const prepared = await instance.beginCreate(material);
          assertActive();
          const { operationId, ...body } = prepared;
          await api("agent-hub", "/api/v2/vaults", signal, {
            method: "POST",
            json: { contractVersion: CONTRACT, ...body },
            headers: { "Idempotency-Key": operationId },
          });
          const result = await readCurrent(signal);
          assertActive();
          if (!result.vault) throw new WorkspaceError("invalid_response");
          await instance.acceptVault(result.vault);
          assertActive();
          setState((previous) => ({
            ...previous,
            phase: "unlocked",
            vault: result.vault,
            sources: result.sources,
            notice: "vault_created",
          }));
        } finally {
          if (material.secret.byteLength) new Uint8Array(material.secret).fill(0);
        }
      }),
    [api, owner, perform, readCurrent, terminate, uid],
  );

  const importFile = useCallback(
    (file: File) =>
      perform("parsing", async ({ assertActive }) => {
        liveSession();
        if (file.size > HOLDINGS_CSV_MAX_BYTES) throw new HoldingsCsvError("file_too_large");
        const text = await file.text();
        assertActive();
        const preview = await parseHoldingsCsv({
          text,
          brokerId: "wealthsimple",
          ownerUid: uid!,
          snapshotId: id("snapshot"),
          importedAt: new Date().toISOString(),
        });
        assertActive();
        setState((previous) => ({ ...previous, preview, notice: "" }));
      }),
    [liveSession, perform, uid],
  );

  const selectAccounts = useCallback(
    (ids: string[]) => {
      if (
        !owner ||
        ownerRef.current !== owner ||
        current.current ||
        stateRef.current.owner !== owner ||
        !stateRef.current.preview
      )
        return;
      try {
        const preview = selectHoldingsAccounts(stateRef.current.preview, ids);
        setState((previous) => ({ ...previous, preview, error: "", errorRow: null }));
      } catch (error) {
        setState((previous) => ({ ...previous, error: errorCode(error) }));
      }
    },
    [owner],
  );

  const save = useCallback(
    () =>
      perform("saving", async ({ assertActive, signal }) => {
        const instance = liveSession();
        const currentState = stateRef.current;
        if (currentState.owner !== owner || !currentState.vault)
          throw new WorkspaceError("unlock_required");
        const refreshed = await readCurrent(signal);
        assertActive();
        if (!refreshed.vault) throw new WorkspaceError("invalid_response");
        await instance.acceptVault(refreshed.vault);
        assertActive();
        setState((previous) => ({
          ...previous,
          vault: refreshed.vault,
          sources: refreshed.sources,
        }));
        let source = refreshed.sources[0];
        if (!source) {
          if (!currentState.preview) throw new WorkspaceError("choose_file");
          const sourceId = id("holdings");
          const signed = await instance.signSource(sourceId);
          assertActive();
          await api(
            "agent-hub",
            `/api/v2/vaults/${currentState.vault.vaultId}/holdings-sources/${sourceId}`,
            signal,
            {
              method: "POST",
              json: { contractVersion: CONTRACT, command: signed.command },
              headers: {
                "Idempotency-Key": signed.operationId,
                "X-FolioView-Author-Key": signed.authorKeyId,
              },
            },
          );
          const updated = await readCurrent(signal);
          assertActive();
          if (!updated.vault) throw new WorkspaceError("invalid_response");
          await instance.acceptVault(updated.vault);
          source = updated.sources.find((item) => item.resourceRef.resourceId === sourceId)!;
          if (!source) throw new WorkspaceError("invalid_response");
          setState((previous) => ({ ...previous, vault: updated.vault, sources: updated.sources }));
        }
        await sync(source, signal);
        assertActive();
        let upload = pending.current ?? (await instance.loadOutbox(source.resourceRef.resourceId));
        assertActive();
        if (!upload) {
          const preview = stateRef.current.preview;
          if (!preview) throw new WorkspaceError("choose_file");
          const metadata = await api(
            "portfolio",
            `/api/v2/holdings/sources/${source.resourceRef.resourceId}`,
            signal,
          );
          if (
            !record(metadata) ||
            metadata.contractVersion !== CONTRACT ||
            !sameSource(metadata.resourceRef, source.resourceRef) ||
            metadata.sourceEpoch !== source.sourceEpoch ||
            !Number.isSafeInteger(metadata.revision) ||
            (metadata.revision as number) < 0
          )
            throw new WorkspaceError("invalid_response");
          upload = await instance.sealSnapshot({
            content: preview.resourceContent,
            source,
            expectedRevision: metadata.revision as number,
            snapshotId: preview.resourceContent.data.snapshotId,
          });
          assertActive();
        }
        if (
          !sameSource(upload.source?.resourceRef, source.resourceRef) ||
          upload.source.sourceEpoch !== source.sourceEpoch
        )
          throw new WorkspaceError("version_conflict");
        pending.current = upload;
        setState((previous) => ({ ...previous, hasPending: true }));
        const receipt = await api(
          "portfolio",
          `/api/v2/holdings/sources/${source.resourceRef.resourceId}/snapshots/${upload.snapshotId}`,
          signal,
          {
            method: "PUT",
            json: {
              contractVersion: CONTRACT,
              expectedRevision: upload.expectedRevision,
              carrier: upload.carrier,
            },
            headers: {
              "Idempotency-Key": upload.operationId,
              "X-FolioView-Author-Key": upload.authorKeyId,
            },
          },
        );
        assertActive();
        await instance.verifyReceipt(upload, receipt);
        assertActive();
        await instance.clearOutbox(source.resourceRef.resourceId, upload.operationId);
        assertActive();
        pending.current = null;
        setState((previous) => ({
          ...previous,
          preview: null,
          content: null,
          hasPending: false,
          discardOperationId: null,
          notice: "saved",
        }));
        await readSaved(source, signal, assertActive);
        setState((previous) => ({ ...previous, notice: "saved" }));
      }),
    [api, liveSession, owner, perform, readCurrent, readSaved, sync],
  );

  const checkPending = useCallback(
    (confirmedOperation: string | null = null) =>
      perform("recovering", async ({ assertActive, signal }) => {
        const instance = liveSession();
        const source = stateRef.current.sources[0];
        if (!source) throw new WorkspaceError("invalid_response");
        const upload =
          pending.current ?? (await instance.loadOutbox(source.resourceRef.resourceId));
        assertActive();
        if (!upload || upload.source.resourceRef.resourceId !== source.resourceRef.resourceId)
          throw new WorkspaceError("invalid_response");
        if (confirmedOperation !== null && confirmedOperation !== upload.operationId)
          throw new WorkspaceError("version_conflict");
        pending.current = upload;
        const receipt = await api(
          "portfolio",
          `/api/v2/holdings/sources/${source.resourceRef.resourceId}/operations/${upload.operationId}`,
          signal,
          { allowMissing: true },
        );
        assertActive();
        if (receipt !== null) {
          await instance.verifyReceipt(upload, receipt);
          assertActive();
          await instance.clearOutbox(source.resourceRef.resourceId, upload.operationId);
          assertActive();
          pending.current = null;
          setState((previous) => ({
            ...previous,
            hasPending: false,
            discardOperationId: null,
            preview: null,
            content: null,
          }));
          await readSaved(source, signal, assertActive);
          setState((previous) => ({ ...previous, notice: "receipt_recovered" }));
          return;
        }
        if (confirmedOperation === null) {
          setState((previous) => ({
            ...previous,
            hasPending: true,
            discardOperationId: upload.operationId,
            notice: "",
          }));
          return;
        }
        // Discard only this device's exact retry packet. A 404 is not a cancellation
        // fence: a previously sent request may still commit. No server deletion occurs.
        await instance.clearOutbox(source.resourceRef.resourceId, upload.operationId);
        assertActive();
        pending.current = null;
        setState((previous) => ({
          ...previous,
          hasPending: false,
          discardOperationId: null,
          preview: null,
          content: null,
          notice: "retry_discarded",
        }));
        await readSaved(source, signal, assertActive);
        setState((previous) => ({ ...previous, notice: "retry_discarded" }));
      }),
    [api, liveSession, perform, readSaved],
  );

  const lock = useCallback(() => {
    ++serial.current;
    current.current?.controller.abort();
    current.current = null;
    terminate();
    setState((previous) => ({
      ...previous,
      preview: null,
      content: null,
      busy: null,
      hasPending: false,
      discardOperationId: null,
      phase: previous.vault ? "locked" : "needs-vault",
      error: "",
      notice: "",
    }));
  }, [terminate]);

  const visible = owner && state.owner === owner ? state : { ...empty, owner };
  return {
    ...visible,
    authenticated: Boolean(owner),
    authStatus: auth.status,
    configured,
    signIn: auth.signIn,
    create,
    unlock,
    lock,
    reload,
    importFile,
    selectAccounts,
    save,
    recoverPending: () => checkPending(),
    discardPending: () => {
      const operation = stateRef.current.discardOperationId;
      if (operation) return checkPending(operation);
      return Promise.resolve();
    },
    keepPending: () => {
      if (ownerRef.current === owner && !current.current)
        setState((previous) => ({ ...previous, discardOperationId: null }));
    },
    discardPreview: () => {
      if (!current.current && ownerRef.current === owner)
        setState((previous) => ({ ...previous, preview: null, error: "" }));
    },
    readStored: () =>
      perform("reading", async ({ assertActive, signal }) => {
        const source = stateRef.current.sources[0];
        if (source) await readSaved(source, signal, assertActive);
      }),
  };
}
export type HoldingsWorkspace = ReturnType<typeof useHoldingsWorkspace>;
