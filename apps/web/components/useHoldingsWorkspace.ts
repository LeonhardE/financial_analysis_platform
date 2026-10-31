"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import {
  HOLDINGS_CSV_MAX_BYTES,
  HoldingsCsvError,
  parseHoldingsCsv,
  selectHoldingsAccounts,
  type HoldingsCsvPreview,
  type HoldingsResourceContent,
} from "@/lib/holdings-csv";
import { EncryptedVaultSession } from "@/lib/encrypted-vault";
import {
  createVaultPasskey,
  replaceVaultPasskey,
  unlockVaultPasskey,
  type PasskeyMethod,
  type PasskeyOptions,
} from "@/lib/encrypted-passkey";
import type {
  OpenResultArgs,
  PendingSnapshot,
  SnapshotResponse,
  ResultMetadata,
  ResultStateChanges,
  Source,
  EncryptedTask,
  PendingTask,
  TaskContent,
  TaskDraft,
  ResourceBindingMetadata,
  AgentAnchor,
  HelperPublicOffer,
  AgentRegistration,
  AgentGrantArgs,
  AgentPreparationArgs,
  Vault,
  VaultManagementSummary,
  DeviceChangePacket,
  VaultLifecycleState,
  ArchiveChangePacket,
  KeyRenewalSummary,
  KeyRenewalPacket,
} from "@/lib/encrypted-types";

const CONTRACT = "folioview.agent-workspace.v2.0";
const contractHeaders = { "X-FolioView-Contract": CONTRACT };
type Phase = "checking" | "needs-vault" | "locked" | "needs-device" | "unlocked" | "renewal-only";
type Busy =
  | "loading"
  | "creating"
  | "unlocking"
  | "parsing"
  | "saving"
  | "reading"
  | "recovering"
  | "managing"
  | "verifying"
  | "enrolling"
  | "changing-passkey"
  | "exporting-recovery"
  | "restoring-recovery"
  | "reviewing-renewal"
  | "renewing-keys"
  | "cancelling-renewal"
  | null;
type DeviceReview = {
  action: "revoke" | "rotate";
  deviceId: string;
  registrySequence: number;
  checkpointDigest: string;
};
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
  canWriteState: boolean;
  keyManagement: VaultManagementSummary | null;
  deviceReview: DeviceReview | null;
  deviceChange: DeviceChangePacket | null;
  needsDeviceApproval: boolean;
  registrationForResults: boolean;
  recoveryCheck: { rootKeyId: string; registrySequence: number; checkedAt: string } | null;
  keyNotice: string;
  recoveryExport: {
    file: string;
    code: string;
    createdAt: string;
    vaultId: string;
    rootKeyId: string;
  } | null;
  archiveChange: {
    operationId: string;
    mode: "passkey_change" | "recovery";
    state: "ready" | "applied" | "conflict";
  } | null;
  keyRenewal: KeyRenewalSummary | null;
  keyRenewalCancellation: boolean;
  keyRenewalFailure: boolean;
  renewalHoldings: { sourceId: string; operationId: string; status: "saved" | "unknown" } | null;
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
  canWriteState: false,
  keyManagement: null,
  deviceReview: null,
  deviceChange: null,
  needsDeviceApproval: false,
  registrationForResults: false,
  recoveryCheck: null,
  keyNotice: "",
  recoveryExport: null,
  archiveChange: null,
  keyRenewal: null,
  keyRenewalCancellation: false,
  keyRenewalFailure: false,
  renewalHoldings: null,
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
  const configured = auth.agentHubConfigured;
  const holdingsConfigured = auth.portfolioConfigured && configured;
  const capabilitiesRef = useRef({ hub: configured, portfolio: auth.portfolioConfigured });
  capabilitiesRef.current = { hub: configured, portfolio: auth.portfolioConfigured };
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const [state, setState] = useState<State>(empty);
  const stateRef = useRef(state);
  stateRef.current = state;
  const serial = useRef(0);
  const current = useRef<{ serial: number; controller: AbortController } | null>(null);
  const session = useRef<{ owner: string; instance: EncryptedVaultSession } | null>(null);
  const pending = useRef<PendingSnapshot | null>(null);
  const vaultGeneration = useRef(0);
  const recoverySession = useRef<EncryptedVaultSession | null>(null);
  const renewalHoldingsReview = useRef<{
    pending: PendingSnapshot;
    receipt: unknown;
    snapshot: SnapshotResponse;
    registrySequence: number;
    checkpointDigest: string;
  } | null>(null);

  const terminate = useCallback(() => {
    ++vaultGeneration.current;
    session.current?.instance.lock();
    recoverySession.current?.lock();
    recoverySession.current = null;
    session.current = null;
    pending.current = null;
    renewalHoldingsReview.current = null;
  }, []);

  const perform = useCallback(
    async (
      busy: Exclude<Busy, null>,
      action: (context: { assertActive: () => void; signal: AbortSignal }) => Promise<void>,
    ) => {
      if (
        !owner ||
        !uid ||
        ownerRef.current !== owner ||
        current.current ||
        !configured ||
        !capabilitiesRef.current.hub
      )
        return;
      const controller = new AbortController();
      const call = { serial: ++serial.current, controller };
      current.current = call;
      const owns = () =>
        ownerRef.current === owner &&
        capabilitiesRef.current.hub &&
        serial.current === call.serial &&
        !controller.signal.aborted;
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
        keyNotice: "",
        recoveryExport: null,
        keyRenewalFailure: false,
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
            keyManagement: null,
            deviceReview: null,
            deviceChange: null,
            needsDeviceApproval: false,
            recoveryCheck: null,
            keyNotice: "",
            recoveryExport: null,
            keyRenewal: null,
            renewalHoldings: null,
            keyRenewalCancellation: false,
            keyRenewalFailure:
              previous.phase === "renewal-only" ||
              ["reviewing-renewal", "renewing-keys", "cancelling-renewal"].includes(busy),
            canWriteState: false,
            error: "request_timeout",
          }));
        },
        [
          "creating",
          "unlocking",
          "verifying",
          "changing-passkey",
          "restoring-recovery",
          "reviewing-renewal",
        ].includes(busy)
          ? 180_000
          : 60_000,
      );
      try {
        await action({ assertActive, signal: controller.signal });
      } catch (error) {
        if (!owns()) return;
        const discardKeys =
          busy === "creating" ||
          busy === "unlocking" ||
          busy === "reviewing-renewal" ||
          [
            "untrusted_vault",
            "rollback_detected",
            "registry_conflict",
            "wrong_account",
            "key_revoked",
            "untrusted_lifecycle",
            "archive_session_stale",
          ].includes(errorCode(error));
        if (discardKeys) terminate();
        setState((previous) => ({
          ...previous,
          ...(discardKeys
            ? {
                phase: previous.vault ? ("locked" as const) : ("needs-vault" as const),
                content: null,
                preview: null,
                keyManagement: null,
                deviceReview: null,
                deviceChange: null,
                needsDeviceApproval: false,
                recoveryCheck: null,
                canWriteState: false,
                recoveryExport: null,
                keyRenewal: null,
                renewalHoldings: null,
                keyRenewalCancellation: false,
              }
            : {}),
          ...(busy === "reading" || busy === "saving" ? { content: null } : {}),
          error: errorCode(error),
          keyRenewalFailure:
            previous.phase === "renewal-only" ||
            errorCode(error).startsWith("key_renewal_") ||
            ["reviewing-renewal", "renewing-keys", "cancelling-renewal"].includes(busy),
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

  const readLifecycle = useCallback(
    async (vault: Vault, signal: AbortSignal) =>
      (await api(
        "agent-hub",
        `/api/v2/vaults/${vault.vaultId}/archive`,
        signal,
      )) as VaultLifecycleState,
    [api],
  );

  const liveSession = useCallback(
    (allowRenewal = false) => {
      if (
        !owner ||
        ownerRef.current !== owner ||
        !capabilitiesRef.current.hub ||
        session.current?.owner !== owner ||
        (stateRef.current.phase === "renewal-only" && !allowRenewal)
      )
        throw new WorkspaceError("unlock_required");
      return session.current.instance;
    },
    [owner],
  );

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
      const instance = liveSession();
      if (!capabilitiesRef.current.portfolio) throw new WorkspaceError("service_unavailable");
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
  }, [owner, configured, auth.portfolioConfigured, reload, terminate]);

  const unlock = useCallback(
    (options?: { forResults?: boolean; enableState?: boolean; method?: PasskeyMethod }) =>
      perform("unlocking", async ({ assertActive, signal }) => {
        if (stateRef.current.phase === "renewal-only") throw new WorkspaceError("key_renewal_only");
        const fresh = await readCurrent(signal);
        assertActive();
        const vault = stateRef.current.owner === owner ? fresh.vault : null;
        if (!vault || !uid || !owner) throw new WorkspaceError("unlock_required");
        terminate();
        const instance = new EncryptedVaultSession(uid);
        session.current = { owner, instance };
        setState((previous) => ({
          ...previous,
          phase: "locked",
          content: null,
          preview: null,
          keyManagement: null,
          deviceReview: null,
          deviceChange: null,
          recoveryCheck: null,
          needsDeviceApproval: false,
          canWriteState: false,
        }));
        const material = await unlockVaultPasskey(vault.archive, {
          method: options?.method,
          signal,
        });
        try {
          assertActive();
          const readOnly = Boolean(options?.forResults);
          const historicalAccess = readOnly
            ? await instance.unlockForResults(vault, material)
            : null;
          const result = readOnly
            ? {
                needsDeviceRegistration: Boolean(
                  options?.enableState && !historicalAccess?.canWriteState,
                ),
              }
            : await instance.unlock(vault, material);
          assertActive();
          const lifecycle = await readLifecycle(vault, signal);
          await instance.verifyLifecycle(vault, lifecycle);
          assertActive();
          const archiveChange = await instance.getArchiveChange(vault, lifecycle);
          assertActive();
          if (archiveChange) {
            if (archiveChange.state === "applied") {
              await instance.finishArchiveChange(
                vault,
                lifecycle,
                archiveChange.packet.operationId,
              );
              assertActive();
              terminate();
              setState((previous) => ({
                ...previous,
                vault,
                sources: fresh.sources,
                phase: "locked",
                archiveChange: null,
                keyNotice: "archive_change_saved",
              }));
            } else {
              setState((previous) => ({
                ...previous,
                vault,
                sources: fresh.sources,
                phase: "locked",
                archiveChange: {
                  operationId: archiveChange.packet.operationId,
                  mode: archiveChange.packet.mode,
                  state: archiveChange.state,
                },
              }));
            }
            return;
          }
          if (result.needsDeviceRegistration) {
            const refreshed = await readCurrent(signal);
            assertActive();
            if (!refreshed.vault) throw new WorkspaceError("invalid_response");
            await instance.acceptResultVault(refreshed.vault);
            const deviceChange = await instance.loadDeviceChange(refreshed.vault);
            const keyManagement = await instance.deviceManagement(refreshed.vault);
            assertActive();
            setState((previous) => ({
              ...previous,
              phase: deviceChange ? "unlocked" : "needs-device",
              needsDeviceApproval: !deviceChange,
              registrationForResults: Boolean(options?.forResults),
              canWriteState: false,
              vault: refreshed.vault,
              sources: refreshed.sources,
              keyManagement,
              deviceReview: null,
              deviceChange,
              recoveryCheck: null,
            }));
            return;
          }
          const refreshed = await readCurrent(signal);
          assertActive();
          if (!refreshed.vault) throw new WorkspaceError("invalid_response");
          const resultAccess = readOnly ? await instance.acceptResultVault(refreshed.vault) : null;
          if (!readOnly) await instance.acceptVault(refreshed.vault);
          const keyManagement = await instance.deviceManagement(refreshed.vault);
          const deviceChange = await instance.loadDeviceChange(refreshed.vault);
          assertActive();
          setState((previous) => ({
            ...previous,
            phase: "unlocked",
            vault: refreshed.vault,
            sources: refreshed.sources,
            canWriteState: readOnly ? Boolean(resultAccess?.canWriteState) : true,
            keyManagement,
            deviceChange,
            deviceReview: null,
            needsDeviceApproval: false,
            recoveryCheck: null,
          }));
          if (!options?.forResults && capabilitiesRef.current.portfolio && refreshed.sources[0])
            await readSaved(refreshed.sources[0], signal, assertActive);
        } finally {
          if (material.secret.byteLength) new Uint8Array(material.secret).fill(0);
        }
      }),
    [api, owner, perform, readCurrent, readLifecycle, readSaved, terminate, uid],
  );

  const create = useCallback(
    (options?: Pick<PasskeyOptions, "method">) =>
      perform("creating", async ({ assertActive, signal }) => {
        if (!uid || !owner || stateRef.current.vault) throw new WorkspaceError("version_conflict");
        terminate();
        const instance = new EncryptedVaultSession(uid);
        session.current = { owner, instance };
        await instance.prepareCreate();
        assertActive();
        const material = await createVaultPasskey(uid, { method: options?.method, signal });
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
          await instance.verifyLifecycle(result.vault, await readLifecycle(result.vault, signal));
          const keyManagement = await instance.deviceManagement(result.vault);
          assertActive();
          setState((previous) => ({
            ...previous,
            phase: "unlocked",
            vault: result.vault,
            sources: result.sources,
            notice: "vault_created",
            canWriteState: true,
            keyManagement,
            deviceChange: null,
            deviceReview: null,
            needsDeviceApproval: false,
            recoveryCheck: null,
          }));
        } finally {
          if (material.secret.byteLength) new Uint8Array(material.secret).fill(0);
        }
      }),
    [api, owner, perform, readCurrent, readLifecycle, terminate, uid],
  );

  const importFile = useCallback(
    (file: File) =>
      perform("parsing", async ({ assertActive }) => {
        if (!capabilitiesRef.current.portfolio) throw new WorkspaceError("service_unavailable");
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
        if (!capabilitiesRef.current.portfolio) throw new WorkspaceError("service_unavailable");
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
    if (ownerRef.current !== owner) return;
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
      canWriteState: false,
      keyManagement: null,
      deviceReview: null,
      deviceChange: null,
      needsDeviceApproval: false,
      recoveryCheck: null,
      keyNotice: "",
      recoveryExport: null,
      keyRenewal: null,
      keyRenewalCancellation: false,
      keyRenewalFailure: false,
    }));
  }, [owner, terminate]);

  const assertInboxSession = useCallback(
    (instance: EncryptedVaultSession, generation: number) => {
      if (
        !owner ||
        ownerRef.current !== owner ||
        !capabilitiesRef.current.hub ||
        session.current?.instance !== instance ||
        vaultGeneration.current !== generation ||
        stateRef.current.owner !== owner ||
        stateRef.current.phase !== "unlocked"
      )
        throw new WorkspaceError("unlock_required");
    },
    [owner],
  );

  const refreshVault = useCallback(
    async (signal: AbortSignal, forState = false): Promise<Vault> => {
      const instance = liveSession(),
        generation = vaultGeneration.current;
      assertInboxSession(instance, generation);
      const refreshed = await readCurrent(signal);
      assertInboxSession(instance, generation);
      if (signal.aborted || !refreshed.vault) throw new WorkspaceError("invalid_response");
      const access = forState
        ? (await instance.acceptVault(refreshed.vault), { canWriteState: true })
        : await instance.acceptResultVault(refreshed.vault);
      assertInboxSession(instance, generation);
      if (signal.aborted) throw new WorkspaceError("cancelled");
      setState((previous) => ({
        ...previous,
        vault: refreshed.vault,
        sources: refreshed.sources,
        canWriteState: access.canWriteState,
      }));
      return refreshed.vault;
    },
    [assertInboxSession, liveSession, readCurrent],
  );

  const openResult = useCallback(
    async (args: OpenResultArgs) => {
      const instance = liveSession(),
        generation = vaultGeneration.current;
      assertInboxSession(instance, generation);
      const value = await instance.openResult(args);
      assertInboxSession(instance, generation);
      return value;
    },
    [assertInboxSession, liveSession],
  );

  const signResultState = useCallback(
    async (args: { metadata: ResultMetadata; changes: ResultStateChanges }) => {
      const instance = liveSession(),
        generation = vaultGeneration.current;
      assertInboxSession(instance, generation);
      const value = await instance.signResultState(args);
      assertInboxSession(instance, generation);
      return value;
    },
    [assertInboxSession, liveSession],
  );

  // Tasks share the existing owner-fenced Worker. Callers receive role-bound
  // operations, never a Worker handle, unwrapped key or another account's session.
  const taskGeneration = vaultGeneration.current;
  const taskCall = useCallback(
    async <T>(action: (instance: EncryptedVaultSession) => Promise<T>) => {
      if (taskGeneration !== vaultGeneration.current) throw new WorkspaceError("unlock_required");
      const instance = liveSession(),
        generation = vaultGeneration.current;
      assertInboxSession(instance, generation);
      const value = await action(instance);
      assertInboxSession(instance, generation);
      return value;
    },
    [assertInboxSession, liveSession, taskGeneration],
  );
  const openTask = useCallback(
    (task: EncryptedTask) => taskCall((instance) => instance.openTask(task)),
    [taskCall],
  );
  const taskAuthority = useCallback(
    (current: EncryptedTask | null) => taskCall((instance) => instance.taskAuthority(current)),
    [taskCall],
  );
  const sealTask = useCallback(
    (args: {
      content: TaskContent;
      resourceBindings: ResourceBindingMetadata[];
      current: EncryptedTask | null;
      taskId?: string;
    }) => taskCall((instance) => instance.sealTask(args)),
    [taskCall],
  );
  const transitionTask = useCallback(
    (args: { current: EncryptedTask; action: "pause" | "resume" | "archive" }) =>
      taskCall((instance) => instance.transitionTask(args)),
    [taskCall],
  );
  const listTaskDrafts = useCallback(
    () => taskCall((instance) => instance.listTaskDrafts()),
    [taskCall],
  );
  const loadTaskDraft = useCallback(
    (slot: string) => taskCall((instance) => instance.loadTaskDraft(slot)),
    [taskCall],
  );
  const saveTaskDraft = useCallback(
    (args: {
      slot: string;
      expectedRevision: number;
      baseVersion: number;
      taskId: string;
      draft: TaskDraft;
    }) => taskCall((instance) => instance.saveTaskDraft(args)),
    [taskCall],
  );
  const clearTaskDraft = useCallback(
    (slot: string, expectedRevision: number) =>
      taskCall((instance) => instance.clearTaskDraft(slot, expectedRevision)),
    [taskCall],
  );
  const listTaskOutbox = useCallback(
    () => taskCall((instance) => instance.listTaskOutbox()),
    [taskCall],
  );
  const loadTaskOutbox = useCallback(
    (taskId: string) => taskCall((instance) => instance.loadTaskOutbox(taskId)),
    [taskCall],
  );
  const validateTaskPending = useCallback(
    (packet: PendingTask) => taskCall((instance) => instance.validateTaskPending(packet)),
    [taskCall],
  );
  const clearTaskOutbox = useCallback(
    (taskId: string, operationId: string) =>
      taskCall((instance) => instance.clearTaskOutbox(taskId, operationId)),
    [taskCall],
  );

  const listAgentOutbox = useCallback(
    () => taskCall((instance) => instance.listAgentOutbox()),
    [taskCall],
  );
  const publicAgentAnchor = useCallback(
    (args: { connectionId: string; agentPrincipalId: string; taskId: string }) =>
      taskCall((instance) => instance.publicAgentAnchor(args)),
    [taskCall],
  );
  const inspectAgentOffer = useCallback(
    (args: { offer: HelperPublicOffer }) =>
      taskCall((instance) => instance.inspectAgentOffer(args)),
    [taskCall],
  );
  const prepareAgentRegistration = useCallback(
    (args: { offer: HelperPublicOffer; ttlSeconds: number; replaceKeyIds?: string[] }) =>
      taskCall((instance) => instance.prepareAgentRegistration(args)),
    [taskCall],
  );
  const loadAgentRegistration = useCallback(
    (connectionId: string, taskId: string) =>
      taskCall((instance) => instance.loadAgentRegistration(connectionId, taskId)),
    [taskCall],
  );
  const clearAgentRegistration = useCallback(
    (connectionId: string, taskId: string, operationId: string) =>
      taskCall((instance) => instance.clearAgentRegistration(connectionId, taskId, operationId)),
    [taskCall],
  );
  const loadAgentApproval = useCallback(
    (connectionId: string, taskId: string) =>
      taskCall((instance) => instance.loadAgentApproval(connectionId, taskId)),
    [taskCall],
  );
  const clearAgentApproval = useCallback(
    (connectionId: string, taskId: string, operationId: string) =>
      taskCall((instance) => instance.clearAgentApproval(connectionId, taskId, operationId)),
    [taskCall],
  );
  const signAgentGrants = useCallback(
    (args: AgentGrantArgs) => taskCall((instance) => instance.signAgentGrants(args)),
    [taskCall],
  );
  const sealAgentPreparation = useCallback(
    (args: AgentPreparationArgs) => taskCall((instance) => instance.sealAgentPreparation(args)),
    [taskCall],
  );
  const loadAgentPreparation = useCallback(
    (connectionId: string, taskId: string) =>
      taskCall((instance) => instance.loadAgentPreparation(connectionId, taskId)),
    [taskCall],
  );
  const clearAgentPreparation = useCallback(
    (connectionId: string, taskId: string, operationId: string) =>
      taskCall((instance) => instance.clearAgentPreparation(connectionId, taskId, operationId)),
    [taskCall],
  );
  const managementGeneration = vaultGeneration.current;
  const assertKeySession = useCallback(
    (instance: EncryptedVaultSession, generation: number) => {
      if (
        !owner ||
        ownerRef.current !== owner ||
        !capabilitiesRef.current.hub ||
        session.current?.instance !== instance ||
        vaultGeneration.current !== generation ||
        stateRef.current.owner !== owner ||
        !["unlocked", "needs-device"].includes(stateRef.current.phase)
      )
        throw new WorkspaceError("unlock_required");
    },
    [owner],
  );
  const keySnapshot = useCallback(async (instance: EncryptedVaultSession, vault: Vault) => {
    const deviceChange = await instance.loadDeviceChange(vault);
    const keyManagement = await instance.deviceManagement(vault);
    return { keyManagement, deviceChange };
  }, []);
  const refreshKeyManagement = useCallback(
    () =>
      perform("managing", async ({ assertActive, signal }) => {
        const instance = liveSession();
        assertKeySession(instance, managementGeneration);
        const fresh = await readCurrent(signal);
        assertActive();
        assertKeySession(instance, managementGeneration);
        if (!fresh.vault) throw new WorkspaceError("invalid_response");
        const next = await keySnapshot(instance, fresh.vault);
        assertActive();
        assertKeySession(instance, managementGeneration);
        setState((previous) => ({
          ...previous,
          ...next,
          vault: fresh.vault,
          sources: fresh.sources,
          deviceReview: null,
          recoveryCheck: null,
        }));
      }),
    [assertKeySession, keySnapshot, liveSession, managementGeneration, perform, readCurrent],
  );
  const reviewDeviceChange = useCallback(
    async (action: "revoke" | "rotate", deviceId: string) => {
      try {
        const instance = liveSession();
        assertKeySession(instance, managementGeneration);
        if (current.current) return;
        const summary = stateRef.current.keyManagement;
        if (!summary?.canManage || stateRef.current.deviceChange)
          throw new WorkspaceError("device_change_pending");
        const target = summary.devices.find((device) => device.deviceId === deviceId);
        if (
          !target?.active ||
          (action === "rotate" ? !target.current : action !== "revoke" || target.current)
        )
          throw new WorkspaceError("invalid_operation");
        // This is only a public review. Generate and seal candidate keys after the
        // final confirmation, so cancelling a review has no pending network effect.
        setState((previous) => ({
          ...previous,
          deviceReview: {
            action,
            deviceId,
            registrySequence: summary.registrySequence,
            checkpointDigest: summary.checkpointDigest,
          },
          error: "",
          keyNotice: "",
        }));
      } catch (error) {
        if (ownerRef.current === owner && managementGeneration === vaultGeneration.current)
          setState((previous) => ({ ...previous, error: errorCode(error) }));
      }
    },
    [assertKeySession, liveSession, managementGeneration, owner],
  );
  const reviewedDeviceChange = state.deviceReview;
  const reviewedOperationId = state.deviceChange?.operationId ?? null;
  const enrollmentCheckpoint = state.keyManagement?.checkpointDigest ?? null;
  const confirmDeviceChange = useCallback(
    () =>
      perform("managing", async ({ assertActive, signal }) => {
        const instance = liveSession();
        assertKeySession(instance, managementGeneration);
        if (
          stateRef.current.deviceReview !== reviewedDeviceChange ||
          (stateRef.current.deviceChange?.operationId ?? null) !== reviewedOperationId
        )
          throw new WorkspaceError("version_conflict");
        const review = reviewedDeviceChange;
        const fresh = await readCurrent(signal);
        assertActive();
        assertKeySession(instance, managementGeneration);
        if (!fresh.vault) throw new WorkspaceError("invalid_response");
        let next = await keySnapshot(instance, fresh.vault);
        assertActive();
        assertKeySession(instance, managementGeneration);
        let packet = next.deviceChange;
        if (packet && next.keyManagement.pendingChange?.state === "conflict") {
          setState((previous) => ({
            ...previous,
            ...next,
            vault: fresh.vault,
            deviceReview: null,
          }));
          throw new WorkspaceError("version_conflict");
        }
        if (!packet) {
          if (!review || !next.keyManagement.canManage)
            throw new WorkspaceError("invalid_operation");
          if (
            review.registrySequence !== next.keyManagement.registrySequence ||
            review.checkpointDigest !== next.keyManagement.checkpointDigest
          ) {
            setState((previous) => ({
              ...previous,
              ...next,
              vault: fresh.vault,
              deviceReview: null,
            }));
            throw new WorkspaceError("version_conflict");
          }
          packet = await instance.prepareDeviceChange({
            vault: fresh.vault,
            action: review.action,
            deviceId: review.deviceId,
          });
          assertActive();
          assertKeySession(instance, managementGeneration);
          next = await keySnapshot(instance, fresh.vault);
          assertActive();
          assertKeySession(instance, managementGeneration);
          setState((previous) => ({
            ...previous,
            ...next,
            deviceChange: packet,
            deviceReview: null,
          }));
        }
        if (next.keyManagement.pendingChange?.state !== "applied") {
          await api("agent-hub", `/api/v2/vaults/${fresh.vault.vaultId}/registry`, signal, {
            method: "PUT",
            json: {
              contractVersion: CONTRACT,
              expectedVersion: packet.expectedVersion,
              registryBundle: packet.registryBundle,
            },
            headers: { "Idempotency-Key": packet.operationId },
          });
        }
        assertActive();
        assertKeySession(instance, managementGeneration);
        const saved = await readCurrent(signal);
        assertActive();
        assertKeySession(instance, managementGeneration);
        if (!saved.vault) throw new WorkspaceError("invalid_response");
        const keyManagement = await instance.acceptDeviceChange(saved.vault);
        assertActive();
        assertKeySession(instance, managementGeneration);
        // Every private consumer must recheck its generation after changing the
        // current device. Old agent grants retain their original recipients.
        ++vaultGeneration.current;
        setState((previous) => ({
          ...previous,
          vault: saved.vault,
          sources: saved.sources,
          keyManagement,
          deviceChange: null,
          deviceReview: null,
          recoveryCheck: null,
          preview: null,
          content: null,
          canWriteState: keyManagement.canManage,
          keyNotice: "device_change_saved",
          notice: "",
          error: "",
        }));
      }),
    [
      api,
      assertKeySession,
      keySnapshot,
      liveSession,
      managementGeneration,
      perform,
      readCurrent,
      reviewedDeviceChange,
      reviewedOperationId,
    ],
  );
  const discardDeviceChange = useCallback(
    () =>
      perform("managing", async ({ assertActive, signal }) => {
        const instance = liveSession();
        assertKeySession(instance, managementGeneration);
        if (
          stateRef.current.deviceReview !== reviewedDeviceChange ||
          (stateRef.current.deviceChange?.operationId ?? null) !== reviewedOperationId
        )
          throw new WorkspaceError("version_conflict");
        if (!stateRef.current.deviceChange) {
          setState((previous) => ({ ...previous, deviceReview: null, error: "" }));
          return;
        }
        const fresh = await readCurrent(signal);
        assertActive();
        assertKeySession(instance, managementGeneration);
        if (!fresh.vault) throw new WorkspaceError("invalid_response");
        const before = await keySnapshot(instance, fresh.vault);
        assertActive();
        assertKeySession(instance, managementGeneration);
        if (!before.deviceChange || before.keyManagement.pendingChange?.state !== "conflict")
          throw new WorkspaceError("device_change_pending");
        await instance.discardDeviceChange(fresh.vault, before.deviceChange.operationId);
        assertActive();
        assertKeySession(instance, managementGeneration);
        const next = await keySnapshot(instance, fresh.vault);
        assertActive();
        assertKeySession(instance, managementGeneration);
        setState((previous) => ({
          ...previous,
          ...next,
          vault: fresh.vault,
          deviceReview: null,
          keyNotice: "device_change_discarded",
          notice: "",
        }));
      }),
    [
      assertKeySession,
      keySnapshot,
      liveSession,
      managementGeneration,
      perform,
      readCurrent,
      reviewedDeviceChange,
      reviewedOperationId,
    ],
  );
  const confirmDeviceRegistration = useCallback(
    () =>
      perform("enrolling", async ({ assertActive, signal }) => {
        const instance = liveSession();
        assertKeySession(instance, managementGeneration);
        const before = stateRef.current;
        if (!before.needsDeviceApproval || before.phase !== "needs-device" || !before.keyManagement)
          throw new WorkspaceError("invalid_operation");
        if (before.keyManagement.checkpointDigest !== enrollmentCheckpoint)
          throw new WorkspaceError("version_conflict");
        const fresh = await readCurrent(signal);
        assertActive();
        assertKeySession(instance, managementGeneration);
        if (!fresh.vault) throw new WorkspaceError("invalid_response");
        const keyManagement = await instance.deviceManagement(fresh.vault);
        assertActive();
        assertKeySession(instance, managementGeneration);
        let saved = fresh;
        // A previously confirmed registration can commit even if its reply or
        // following GET was lost. A verified eligible local pair is its own
        // recovery fact; do not mint another pair or append duplicate certificates.
        if (!keyManagement.canManage) {
          if (
            keyManagement.registrySequence !== before.keyManagement.registrySequence ||
            keyManagement.checkpointDigest !== before.keyManagement.checkpointDigest
          ) {
            setState((previous) => ({ ...previous, vault: fresh.vault, keyManagement }));
            throw new WorkspaceError("version_conflict");
          }
          const update = await instance.prepareDeviceRegistration(fresh.vault, {
            replaceInactive: true,
          });
          assertActive();
          assertKeySession(instance, managementGeneration);
          await api("agent-hub", `/api/v2/vaults/${fresh.vault.vaultId}/registry`, signal, {
            method: "PUT",
            json: {
              contractVersion: CONTRACT,
              expectedVersion: update.expectedVersion,
              registryBundle: update.registryBundle,
            },
            headers: { "Idempotency-Key": update.operationId },
          });
          saved = await readCurrent(signal);
        }
        assertActive();
        assertKeySession(instance, managementGeneration);
        if (!saved.vault) throw new WorkspaceError("invalid_response");
        await instance.acceptVault(saved.vault);
        const next = await keySnapshot(instance, saved.vault);
        assertActive();
        assertKeySession(instance, managementGeneration);
        ++vaultGeneration.current;
        setState((previous) => ({
          ...previous,
          ...next,
          phase: "unlocked",
          vault: saved.vault,
          sources: saved.sources,
          needsDeviceApproval: false,
          canWriteState: next.keyManagement.canManage,
          recoveryCheck: null,
          keyNotice: "device_registered",
          notice: "",
          error: "",
        }));
        if (!before.registrationForResults && capabilitiesRef.current.portfolio && saved.sources[0])
          await readSaved(saved.sources[0], signal, assertActive);
      }),
    [
      api,
      assertKeySession,
      keySnapshot,
      liveSession,
      managementGeneration,
      perform,
      readCurrent,
      readSaved,
      enrollmentCheckpoint,
    ],
  );
  const verifyRecovery = useCallback(
    (method: PasskeyMethod = "local") =>
      perform("verifying", async ({ assertActive, signal }) => {
        const instance = liveSession();
        assertKeySession(instance, managementGeneration);
        const fresh = await readCurrent(signal);
        assertActive();
        assertKeySession(instance, managementGeneration);
        if (!fresh.vault || !uid) throw new WorkspaceError("invalid_response");
        const material = await unlockVaultPasskey(fresh.vault.archive, { method, signal });
        let probe: EncryptedVaultSession | null = null;
        try {
          assertActive();
          assertKeySession(instance, managementGeneration);
          probe = new EncryptedVaultSession(uid);
          recoverySession.current = probe;
          await probe.unlockForResults(fresh.vault, material);
          await probe.verifyLifecycle(fresh.vault, await readLifecycle(fresh.vault, signal));
          assertActive();
          assertKeySession(instance, managementGeneration);
          const proof = await probe.verifyRecovery(fresh.vault);
          assertActive();
          assertKeySession(instance, managementGeneration);
          const snapshot = await keySnapshot(instance, fresh.vault);
          assertActive();
          assertKeySession(instance, managementGeneration);
          if (
            proof.vaultId !== fresh.vault.vaultId ||
            proof.rootKeyId !== snapshot.keyManagement.rootKeyId ||
            proof.registrySequence !== snapshot.keyManagement.registrySequence ||
            proof.checkpointDigest !== snapshot.keyManagement.checkpointDigest
          )
            throw new WorkspaceError("binding_mismatch");
          setState((previous) => ({
            ...previous,
            ...snapshot,
            vault: fresh.vault,
            sources: fresh.sources,
            canWriteState: previous.canWriteState && snapshot.keyManagement.canManage,
            recoveryCheck: {
              rootKeyId: proof.rootKeyId,
              registrySequence: proof.registrySequence,
              checkedAt: new Date().toISOString(),
            },
            keyNotice: "recovery_verified",
            notice: "",
            error: "",
          }));
        } finally {
          if (material.secret.byteLength) new Uint8Array(material.secret).fill(0);
          probe?.lock();
          if (recoverySession.current === probe) recoverySession.current = null;
        }
      }),
    [
      assertKeySession,
      keySnapshot,
      liveSession,
      managementGeneration,
      perform,
      readCurrent,
      readLifecycle,
      uid,
    ],
  );

  const clearRecoveryExport = useCallback(() => {
    if (ownerRef.current === owner) setState((previous) => ({ ...previous, recoveryExport: null }));
  }, [owner]);

  const exportRecoveryKit = useCallback(
    () =>
      perform("exporting-recovery", async ({ assertActive, signal }) => {
        const instance = liveSession();
        assertKeySession(instance, managementGeneration);
        const fresh = await readCurrent(signal);
        assertActive();
        if (!fresh.vault) throw new WorkspaceError("invalid_response");
        const lifecycle = await readLifecycle(fresh.vault, signal);
        const kit = await instance.createRecoveryKit(fresh.vault, lifecycle);
        assertActive();
        assertKeySession(instance, managementGeneration);
        setState((previous) => ({
          ...previous,
          recoveryExport: {
            ...kit,
            createdAt: new Date(kit.createdAt * 1000).toISOString(),
            vaultId: fresh.vault!.vaultId,
            rootKeyId: fresh.vault!.rootKeyId,
          },
        }));
      }),
    [assertKeySession, liveSession, managementGeneration, perform, readCurrent, readLifecycle],
  );

  // A receipt can recover the identity of an accepted request, but only verified
  // current history may promote the retained candidate into the local key store.
  const completeArchiveChange = useCallback(
    async (
      instance: EncryptedVaultSession,
      vault: Vault,
      packet: ArchiveChangePacket,
      state: "ready" | "applied" | "conflict",
      signal: AbortSignal,
      assertActive: () => void,
    ) => {
      if (state === "conflict") throw new WorkspaceError("version_conflict");
      if (state !== "applied") {
        if (packet.authorization) {
          await api(
            "agent-hub",
            `/api/v2/vaults/${vault.vaultId}/recovery-authorizations`,
            signal,
            {
              method: "POST",
              json: { contractVersion: CONTRACT, command: packet.authorization.command },
              headers: { "Idempotency-Key": packet.authorization.operationId },
            },
          );
          assertActive();
        }
        await api("agent-hub", `/api/v2/vaults/${vault.vaultId}/archive`, signal, {
          method: "PUT",
          json: { contractVersion: CONTRACT, archive: packet.archive, command: packet.command },
          headers: { "Idempotency-Key": packet.operationId },
        });
        assertActive();
      }
      await api(
        "agent-hub",
        `/api/v2/vaults/${vault.vaultId}/archive-operations/${packet.operationId}`,
        signal,
      );
      assertActive();
      const saved = await readCurrent(signal);
      assertActive();
      if (!saved.vault) throw new WorkspaceError("invalid_response");
      const lifecycle = await readLifecycle(saved.vault, signal);
      assertActive();
      await instance.finishArchiveChange(saved.vault, lifecycle, packet.operationId);
      assertActive();
      terminate();
      setState((previous) => ({
        ...empty,
        owner,
        busy: previous.busy,
        vault: saved.vault,
        sources: saved.sources,
        phase: "locked",
        keyNotice: "archive_change_saved",
      }));
    },
    [api, owner, readCurrent, readLifecycle, terminate],
  );

  const changePasskey = useCallback(
    (method: PasskeyMethod = "local") =>
      perform("changing-passkey", async ({ assertActive, signal }) => {
        if (!uid) throw new WorkspaceError("unlock_required");
        const instance = liveSession();
        assertKeySession(instance, managementGeneration);
        const fresh = await readCurrent(signal);
        assertActive();
        if (!fresh.vault) throw new WorkspaceError("invalid_response");
        const lifecycle = await readLifecycle(fresh.vault, signal);
        await instance.verifyLifecycle(fresh.vault, lifecycle);
        assertActive();
        if (lifecycle.lifecycleVersion >= 31) throw new WorkspaceError("archive_cancel_limit");
        if (lifecycle.pendingAuthorization)
          throw new WorkspaceError("recovery_authorization_pending");
        const material = await replaceVaultPasskey(uid, fresh.vault.archive, { method, signal });
        try {
          assertActive();
          assertKeySession(instance, managementGeneration);
          const packet = await instance.prepareArchiveChange(
            fresh.vault,
            lifecycle,
            material,
            "passkey_change",
          );
          assertActive();
          ++vaultGeneration.current;
          setState((previous) => ({
            ...previous,
            preview: null,
            content: null,
            recoveryExport: null,
            phase: "locked",
            canWriteState: false,
            archiveChange: { operationId: packet.operationId, mode: packet.mode, state: "ready" },
          }));
          await completeArchiveChange(instance, fresh.vault, packet, "ready", signal, assertActive);
        } finally {
          if (material.secret.byteLength) new Uint8Array(material.secret).fill(0);
        }
      }),
    [
      assertKeySession,
      completeArchiveChange,
      liveSession,
      managementGeneration,
      perform,
      readCurrent,
      readLifecycle,
      uid,
    ],
  );

  const recoverWithKit = useCallback(
    (file: string, code: string, method: PasskeyMethod = "local") =>
      perform("restoring-recovery", async ({ assertActive, signal }) => {
        if (!uid || !owner || !["locked", "needs-device"].includes(stateRef.current.phase))
          throw new WorkspaceError("invalid_operation");
        if (file.length > 131_072 || code.length > 128) throw new WorkspaceError("invalid_data");
        terminate();
        const instance = new EncryptedVaultSession(uid);
        recoverySession.current = instance;
        try {
          const fresh = await readCurrent(signal);
          assertActive();
          if (!fresh.vault) throw new WorkspaceError("invalid_response");
          const lifecycle = await readLifecycle(fresh.vault, signal);
          await instance.importRecoveryKit(fresh.vault, lifecycle, file, code);
          file = "";
          code = "";
          assertActive();
          if (lifecycle.lifecycleVersion >= 31) throw new WorkspaceError("archive_cancel_limit");
          if (lifecycle.pendingAuthorization && lifecycle.pendingAuthorization.status !== "expired")
            throw new WorkspaceError("recovery_authorization_pending");
          const material = await replaceVaultPasskey(uid, fresh.vault.archive, { method, signal });
          try {
            assertActive();
            const packet = await instance.prepareArchiveChange(
              fresh.vault,
              lifecycle,
              material,
              "recovery",
            );
            assertActive();
            // Retain this Worker for exact-request recovery if the network outcome
            // is unknown. It never exposes a normal decrypted workspace here.
            recoverySession.current = null;
            session.current = { owner, instance };
            ++vaultGeneration.current;
            setState((previous) => ({
              ...previous,
              recoveryExport: null,
              preview: null,
              content: null,
              phase: "locked",
              canWriteState: false,
              archiveChange: { operationId: packet.operationId, mode: packet.mode, state: "ready" },
            }));
            await completeArchiveChange(
              instance,
              fresh.vault,
              packet,
              "ready",
              signal,
              assertActive,
            );
          } finally {
            if (material.secret.byteLength) new Uint8Array(material.secret).fill(0);
          }
        } finally {
          file = "";
          code = "";
          if (recoverySession.current === instance) {
            instance.lock();
            recoverySession.current = null;
          }
        }
      }),
    [completeArchiveChange, owner, perform, readCurrent, readLifecycle, terminate, uid],
  );

  const inspectArchiveChange = useCallback(
    (submit: boolean) =>
      perform("recovering", async ({ assertActive, signal }) => {
        const instance = liveSession();
        const fresh = await readCurrent(signal);
        assertActive();
        if (!fresh.vault) throw new WorkspaceError("invalid_response");
        const lifecycle = await readLifecycle(fresh.vault, signal);
        const pending = await instance.getArchiveChange(fresh.vault, lifecycle);
        assertActive();
        if (!pending) throw new WorkspaceError("invalid_operation");
        await api(
          "agent-hub",
          `/api/v2/vaults/${fresh.vault.vaultId}/archive-operations/${pending.packet.operationId}`,
          signal,
          { allowMissing: true },
        );
        assertActive();
        setState((previous) => ({
          ...previous,
          archiveChange: {
            operationId: pending.packet.operationId,
            mode: pending.packet.mode,
            state: pending.state,
          },
        }));
        if (submit || pending.state === "applied")
          await completeArchiveChange(
            instance,
            fresh.vault,
            pending.packet,
            pending.state,
            signal,
            assertActive,
          );
      }),
    [api, completeArchiveChange, liveSession, perform, readCurrent, readLifecycle],
  );

  const resumeArchiveWithNewPasskey = useCallback(
    (method: PasskeyMethod = "local") =>
      perform("unlocking", async ({ assertActive, signal }) => {
        if (!uid || !owner || stateRef.current.phase !== "locked")
          throw new WorkspaceError("invalid_operation");
        terminate();
        const instance = new EncryptedVaultSession(uid);
        session.current = { owner, instance };
        const fresh = await readCurrent(signal);
        assertActive();
        if (!fresh.vault) throw new WorkspaceError("invalid_response");
        const lifecycle = await readLifecycle(fresh.vault, signal);
        const offer = await instance.inspectArchiveChange(fresh.vault, lifecycle);
        assertActive();
        if (!offer) throw new WorkspaceError("archive_change_missing");
        const material = await unlockVaultPasskey(offer.archive, { method, signal });
        try {
          assertActive();
          const pending = await instance.getArchiveChange(fresh.vault, lifecycle, material);
          assertActive();
          if (!pending || pending.packet.operationId !== offer.operationId)
            throw new WorkspaceError("operation_conflict");
          setState((previous) => ({
            ...previous,
            archiveChange: {
              operationId: pending.packet.operationId,
              mode: pending.packet.mode,
              state: pending.state,
            },
          }));
          await completeArchiveChange(
            instance,
            fresh.vault,
            pending.packet,
            pending.state,
            signal,
            assertActive,
          );
        } finally {
          if (material.secret.byteLength) new Uint8Array(material.secret).fill(0);
        }
      }),
    [completeArchiveChange, owner, perform, readCurrent, readLifecycle, terminate, uid],
  );

  const cancelArchiveChange = useCallback(
    () =>
      perform("recovering", async ({ assertActive, signal }) => {
        const instance = liveSession();
        const fresh = await readCurrent(signal);
        assertActive();
        if (!fresh.vault) throw new WorkspaceError("invalid_response");
        const lifecycle = await readLifecycle(fresh.vault, signal);
        const pending = await instance.getArchiveChange(fresh.vault, lifecycle);
        assertActive();
        if (!pending) throw new WorkspaceError("archive_change_missing");
        if (pending.state === "applied") {
          await completeArchiveChange(
            instance,
            fresh.vault,
            pending.packet,
            pending.state,
            signal,
            assertActive,
          );
          return;
        }
        const cancellation = await instance.prepareArchiveCancellation(fresh.vault, lifecycle);
        assertActive();
        for (const command of cancellation.commands) {
          const path =
            command.action === "recovery_authorize"
              ? `/api/v2/vaults/${fresh.vault.vaultId}/recovery-authorizations`
              : `/api/v2/vaults/${fresh.vault.vaultId}/recovery-authorizations/${command.authorizationId}/revoke`;
          await api("agent-hub", path, signal, {
            method: "POST",
            json: { contractVersion: CONTRACT, command: command.command },
            headers: { "Idempotency-Key": command.operationId },
          });
          assertActive();
        }
        const saved = await readCurrent(signal);
        assertActive();
        if (!saved.vault) throw new WorkspaceError("invalid_response");
        const state = await readLifecycle(saved.vault, signal);
        await instance.discardArchiveChange(saved.vault, state, pending.packet.operationId);
        assertActive();
        terminate();
        setState((previous) => ({
          ...empty,
          owner,
          busy: previous.busy,
          vault: saved.vault,
          sources: saved.sources,
          phase: "locked",
          keyNotice: "archive_change_cancelled",
        }));
      }),
    [
      api,
      completeArchiveChange,
      liveSession,
      owner,
      perform,
      readCurrent,
      readLifecycle,
      terminate,
    ],
  );

  const readRenewalContext = useCallback(
    async (signal: AbortSignal, assertActive: () => void) => {
      const fresh = await readCurrent(signal);
      assertActive();
      if (!fresh.vault) throw new WorkspaceError("invalid_response");
      const lifecycle = await readLifecycle(fresh.vault, signal);
      assertActive();
      return { ...fresh, vault: fresh.vault, lifecycle };
    },
    [readCurrent, readLifecycle],
  );

  const reviewKeyRenewal = useCallback(
    (method: PasskeyMethod = "local") =>
      perform("reviewing-renewal", async ({ assertActive, signal }) => {
        if (!uid || !owner) throw new WorkspaceError("unlock_required");
        terminate();
        setState({ ...empty, owner, phase: "locked", busy: "reviewing-renewal" });
        const fresh = await readRenewalContext(signal, assertActive);
        const instance = new EncryptedVaultSession(uid);
        session.current = { owner, instance };
        setState((previous) => ({
          ...previous,
          vault: fresh.vault,
          sources: fresh.sources,
          phase: "renewal-only",
        }));
        const material = await unlockVaultPasskey(fresh.vault.archive, { method, signal });
        try {
          assertActive();
          await instance.unlockForKeyRenewal(fresh.vault, material);
          assertActive();
          const summary = await instance.inspectKeyRenewal(fresh.vault, fresh.lifecycle);
          assertActive();
          const candidate = await instance.getKeyRenewal(fresh.vault, fresh.lifecycle);
          assertActive();
          setState((previous) => ({
            ...previous,
            keyRenewal: summary,
            keyRenewalCancellation: Boolean(candidate?.cancellation),
          }));
        } finally {
          if (material.secret.byteLength) new Uint8Array(material.secret).fill(0);
        }
      }),
    [owner, perform, readRenewalContext, terminate, uid],
  );

  const lockRenewalView = useCallback(
    (fresh: { vault: Vault; sources: Source[] }, notice = "") => {
      terminate();
      setState((previous) => ({
        ...empty,
        owner,
        busy: previous.busy,
        vault: fresh.vault,
        sources: fresh.sources,
        phase: "locked",
        keyNotice: notice,
      }));
    },
    [owner, terminate],
  );

  const completeKeyRenewal = useCallback(
    async (
      instance: EncryptedVaultSession,
      vault: Vault,
      packet: KeyRenewalPacket,
      pendingState: "ready" | "applied" | "conflict",
      submit: boolean,
      signal: AbortSignal,
      assertActive: () => void,
    ) => {
      let receipt = await api(
        "agent-hub",
        `/api/v2/vaults/${vault.vaultId}/key-renewal-operations/${packet.operationId}`,
        signal,
        { allowMissing: true },
      );
      assertActive();
      if (receipt === null) {
        if (!submit) return false;
        if (pendingState !== "ready") throw new WorkspaceError("key_renewal_conflict");
        await api("agent-hub", `/api/v2/vaults/${vault.vaultId}/key-renewals`, signal, {
          method: "POST",
          json: packet.body,
          headers: { "Idempotency-Key": packet.operationId },
        });
        assertActive();
        receipt = await api(
          "agent-hub",
          `/api/v2/vaults/${vault.vaultId}/key-renewal-operations/${packet.operationId}`,
          signal,
        );
        assertActive();
      }
      const saved = await readRenewalContext(signal, assertActive);
      try {
        await instance.finishKeyRenewal(saved.vault, saved.lifecycle, receipt, packet.operationId);
        assertActive();
      } catch (error) {
        assertActive();
        lockRenewalView(saved);
        throw error;
      }
      lockRenewalView(saved, "key_renewal_saved");
      return true;
    },
    [api, lockRenewalView, readRenewalContext],
  );

  const renewalGeneration = vaultGeneration.current;
  const reviewedRenewal = state.keyRenewal;
  const assertRenewal = useCallback(() => {
    if (
      renewalGeneration !== vaultGeneration.current ||
      stateRef.current.phase !== "renewal-only" ||
      stateRef.current.keyRenewal !== reviewedRenewal
    )
      throw new WorkspaceError("key_renewal_only");
    return liveSession(true);
  }, [liveSession, renewalGeneration, reviewedRenewal]);

  // These GET-only checks never turn a root renewal session into an ordinary writer.
  const readRenewalHoldingsEvidence = useCallback(
    async (packet: PendingSnapshot, signal: AbortSignal, assertActive: () => void) => {
      const sourceId = packet.source.resourceRef.resourceId;
      const receipt = await api(
        "portfolio",
        `/api/v2/holdings/sources/${sourceId}/operations/${packet.operationId}`,
        signal,
        { allowMissing: true },
      );
      assertActive();
      if (receipt === null) return null;
      // Construct the fixed route from the verified original packet, never a response URL.
      const snapshot = (await api(
        "portfolio",
        `/api/v2/holdings/sources/${sourceId}/snapshots/${packet.snapshotId}`,
        signal,
        { allowMissing: true },
      )) as SnapshotResponse | null;
      assertActive();
      return snapshot === null ? null : { receipt, snapshot };
    },
    [api],
  );

  const reviewRenewalHoldings = useCallback(
    () =>
      perform("recovering", async ({ assertActive, signal }) => {
        const instance = assertRenewal();
        const assertHoldingsActive = () => {
          assertActive();
          if (!capabilitiesRef.current.portfolio) {
            instance.lock();
            throw new WorkspaceError("service_unavailable");
          }
        };
        assertHoldingsActive();
        renewalHoldingsReview.current = null;
        setState((previous) => ({ ...previous, renewalHoldings: null }));
        const fresh = await readRenewalContext(signal, assertHoldingsActive);
        const summary = await instance.inspectKeyRenewal(fresh.vault, fresh.lifecycle);
        assertHoldingsActive();
        if (summary.pending) throw new WorkspaceError("key_renewal_pending");
        setState((previous) => ({
          ...previous,
          vault: fresh.vault,
          sources: fresh.sources,
          keyRenewal: summary,
        }));
        for (const source of fresh.sources) {
          const sourceId = source.resourceRef.resourceId;
          const packet = await instance.loadRenewalHoldingsOutbox(sourceId);
          assertHoldingsActive();
          if (!packet) continue;
          const evidence = await readRenewalHoldingsEvidence(packet, signal, assertHoldingsActive);
          if (evidence) {
            await instance.verifyRenewalHoldingsReceipt(
              packet,
              evidence.receipt,
              evidence.snapshot,
            );
            assertHoldingsActive();
            renewalHoldingsReview.current = {
              pending: packet,
              ...evidence,
              registrySequence: summary.registrySequence,
              checkpointDigest: summary.checkpointDigest,
            };
          }
          setState((previous) => ({
            ...previous,
            renewalHoldings: {
              sourceId,
              operationId: packet.operationId,
              status: evidence ? "saved" : "unknown",
            },
          }));
          return;
        }
        setState((previous) => ({ ...previous, keyNotice: "renewal_holdings_none" }));
      }),
    [assertRenewal, perform, readRenewalContext, readRenewalHoldingsEvidence],
  );

  const confirmRenewalHoldings = useCallback(
    () =>
      perform("recovering", async ({ assertActive, signal }) => {
        const instance = assertRenewal();
        const assertHoldingsActive = () => {
          assertActive();
          if (!capabilitiesRef.current.portfolio) {
            instance.lock();
            throw new WorkspaceError("service_unavailable");
          }
        };
        assertHoldingsActive();
        const reviewed = renewalHoldingsReview.current;
        const visible = stateRef.current.renewalHoldings;
        if (
          !reviewed ||
          visible?.status !== "saved" ||
          visible.operationId !== reviewed.pending.operationId ||
          visible.sourceId !== reviewed.pending.source.resourceRef.resourceId
        )
          throw new WorkspaceError("key_renewal_holdings_review_required");
        const fresh = await readRenewalContext(signal, assertHoldingsActive);
        const summary = await instance.inspectKeyRenewal(fresh.vault, fresh.lifecycle);
        assertHoldingsActive();
        if (
          summary.pending ||
          summary.registrySequence !== reviewed.registrySequence ||
          summary.checkpointDigest !== reviewed.checkpointDigest
        )
          throw new WorkspaceError("key_renewal_conflict");
        const evidence = await readRenewalHoldingsEvidence(
          reviewed.pending,
          signal,
          assertHoldingsActive,
        );
        if (
          !evidence ||
          JSON.stringify(evidence.receipt) !== JSON.stringify(reviewed.receipt) ||
          JSON.stringify(evidence.snapshot) !== JSON.stringify(reviewed.snapshot)
        ) {
          renewalHoldingsReview.current = null;
          setState((previous) => ({ ...previous, renewalHoldings: null }));
          throw new WorkspaceError("key_renewal_holdings_changed");
        }
        assertHoldingsActive();
        await instance.reconcileRenewalHoldingsOutbox(
          reviewed.pending,
          evidence.receipt,
          evidence.snapshot,
        );
        assertHoldingsActive();
        renewalHoldingsReview.current = null;
        setState((previous) => ({
          ...previous,
          keyRenewal: summary,
          renewalHoldings: null,
          keyNotice: "renewal_holdings_reconciled",
        }));
      }),
    [assertRenewal, perform, readRenewalContext, readRenewalHoldingsEvidence],
  );

  const refreshKeyRenewal = useCallback(
    () =>
      perform("recovering", async ({ assertActive, signal }) => {
        const instance = assertRenewal();
        const fresh = await readRenewalContext(signal, assertActive);
        const candidate = await instance.getKeyRenewal(fresh.vault, fresh.lifecycle);
        assertActive();
        const summary = await instance.inspectKeyRenewal(fresh.vault, fresh.lifecycle);
        assertActive();
        setState((previous) => ({
          ...previous,
          vault: fresh.vault,
          sources: fresh.sources,
          keyRenewal: summary,
          keyRenewalCancellation: Boolean(candidate?.cancellation),
        }));
        if (candidate)
          await completeKeyRenewal(
            instance,
            fresh.vault,
            candidate.packet,
            candidate.state,
            false,
            signal,
            assertActive,
          );
      }),
    [assertRenewal, completeKeyRenewal, perform, readRenewalContext],
  );

  const confirmKeyRenewal = useCallback(
    () =>
      perform("renewing-keys", async ({ assertActive, signal }) => {
        const instance = assertRenewal();
        const fresh = await readRenewalContext(signal, assertActive);
        const summary = await instance.inspectKeyRenewal(fresh.vault, fresh.lifecycle);
        assertActive();
        let candidate = await instance.getKeyRenewal(fresh.vault, fresh.lifecycle);
        assertActive();
        if (candidate?.cancellation) throw new WorkspaceError("key_renewal_cancel_pending");
        if (candidate) {
          if (candidate.packet.operationId !== reviewedRenewal?.pending?.operationId)
            throw new WorkspaceError("key_renewal_pending");
        } else {
          if (reviewedRenewal?.pending) throw new WorkspaceError("key_renewal_missing");
          if (
            !summary.canRenew ||
            summary.registrySequence !== reviewedRenewal?.registrySequence ||
            summary.checkpointDigest !== reviewedRenewal.checkpointDigest
          )
            throw new WorkspaceError("key_renewal_conflict");
          let packet: KeyRenewalPacket;
          try {
            packet = await instance.prepareKeyRenewal(fresh.vault, fresh.lifecycle);
            assertActive();
          } catch (error) {
            assertActive();
            lockRenewalView(fresh);
            throw error;
          }
          candidate = { packet, state: "ready" };
        }
        const pendingSummary = await instance.inspectKeyRenewal(fresh.vault, fresh.lifecycle);
        assertActive();
        setState((previous) => ({
          ...previous,
          vault: fresh.vault,
          sources: fresh.sources,
          keyRenewal: pendingSummary,
          keyRenewalCancellation: false,
        }));
        await completeKeyRenewal(
          instance,
          fresh.vault,
          candidate.packet,
          candidate.state,
          true,
          signal,
          assertActive,
        );
      }),
    [
      assertRenewal,
      completeKeyRenewal,
      lockRenewalView,
      perform,
      readRenewalContext,
      reviewedRenewal,
    ],
  );

  const clearKeyRenewal = useCallback(
    async (
      instance: EncryptedVaultSession,
      fresh: Awaited<ReturnType<typeof readRenewalContext>>,
      operationId: string,
      assertActive: () => void,
    ) => {
      try {
        await instance.discardKeyRenewal(fresh.vault, fresh.lifecycle, operationId);
        assertActive();
      } catch (error) {
        assertActive();
        lockRenewalView(fresh);
        throw error;
      }
      lockRenewalView(fresh, "key_renewal_cancelled");
    },
    [lockRenewalView],
  );

  const discardKeyRenewal = useCallback(
    () =>
      perform("cancelling-renewal", async ({ assertActive, signal }) => {
        const instance = assertRenewal();
        const fresh = await readRenewalContext(signal, assertActive);
        const candidate = await instance.getKeyRenewal(fresh.vault, fresh.lifecycle);
        assertActive();
        if (!candidate || candidate.packet.operationId !== reviewedRenewal?.pending?.operationId)
          throw new WorkspaceError("key_renewal_missing");
        if (
          await completeKeyRenewal(
            instance,
            fresh.vault,
            candidate.packet,
            candidate.state,
            false,
            signal,
            assertActive,
          )
        )
          return;
        if (candidate.state !== "conflict") throw new WorkspaceError("key_renewal_pending");
        await clearKeyRenewal(instance, fresh, candidate.packet.operationId, assertActive);
      }),
    [
      assertRenewal,
      clearKeyRenewal,
      completeKeyRenewal,
      perform,
      readRenewalContext,
      reviewedRenewal,
    ],
  );

  const cancelKeyRenewal = useCallback(
    () =>
      perform("cancelling-renewal", async ({ assertActive, signal }) => {
        const instance = assertRenewal();
        let fresh = await readRenewalContext(signal, assertActive);
        const candidate = await instance.getKeyRenewal(fresh.vault, fresh.lifecycle);
        assertActive();
        if (!candidate || candidate.packet.operationId !== reviewedRenewal?.pending?.operationId)
          throw new WorkspaceError("key_renewal_missing");
        if (
          await completeKeyRenewal(
            instance,
            fresh.vault,
            candidate.packet,
            candidate.state,
            false,
            signal,
            assertActive,
          )
        )
          return;
        if (candidate.state === "conflict") {
          await clearKeyRenewal(instance, fresh, candidate.packet.operationId, assertActive);
          return;
        }
        const cancellation = await instance.prepareKeyRenewalCancellation(
          fresh.vault,
          fresh.lifecycle,
        );
        assertActive();
        setState((previous) => ({ ...previous, keyRenewalCancellation: true }));
        let failure: unknown;
        try {
          await api("agent-hub", `/api/v2/vaults/${fresh.vault.vaultId}/archive`, signal, {
            method: "PUT",
            json: cancellation.body,
            headers: { "Idempotency-Key": cancellation.operationId },
          });
        } catch (error) {
          failure = error;
        }
        assertActive();
        fresh = await readRenewalContext(signal, assertActive);
        const outcome = await instance.getKeyRenewal(fresh.vault, fresh.lifecycle);
        assertActive();
        if (!outcome || outcome.packet.operationId !== candidate.packet.operationId)
          throw new WorkspaceError("key_renewal_missing");
        const summary = await instance.inspectKeyRenewal(fresh.vault, fresh.lifecycle);
        assertActive();
        setState((previous) => ({
          ...previous,
          vault: fresh.vault,
          sources: fresh.sources,
          keyRenewal: summary,
          keyRenewalCancellation: Boolean(outcome.cancellation),
        }));
        if (
          await completeKeyRenewal(
            instance,
            fresh.vault,
            outcome.packet,
            outcome.state,
            false,
            signal,
            assertActive,
          )
        )
          return;
        if (outcome.state === "conflict") {
          await clearKeyRenewal(instance, fresh, outcome.packet.operationId, assertActive);
          return;
        }
        throw failure ?? new WorkspaceError("key_renewal_cancel_pending");
      }),
    [
      api,
      assertRenewal,
      clearKeyRenewal,
      completeKeyRenewal,
      perform,
      readRenewalContext,
      reviewedRenewal,
    ],
  );

  const visible = owner && configured && state.owner === owner ? state : { ...empty, owner };
  return {
    ...visible,
    content: holdingsConfigured ? visible.content : null,
    preview: holdingsConfigured ? visible.preview : null,
    canWriteState: visible.phase === "unlocked" && visible.canWriteState,
    keyManagement: ["unlocked", "needs-device"].includes(visible.phase)
      ? visible.keyManagement
      : null,
    deviceReview: visible.phase === "unlocked" ? visible.deviceReview : null,
    deviceChange: ["unlocked", "needs-device"].includes(visible.phase)
      ? visible.deviceChange
      : null,
    recoveryCheck: ["unlocked", "needs-device"].includes(visible.phase)
      ? visible.recoveryCheck
      : null,
    authenticated: Boolean(owner),
    authStatus: auth.status,
    configured: holdingsConfigured,
    vaultConfigured: configured,
    vaultGeneration: vaultGeneration.current,
    recoveryExport: ["unlocked", "needs-device"].includes(visible.phase)
      ? visible.recoveryExport
      : null,
    keyRenewal: visible.phase === "renewal-only" ? visible.keyRenewal : null,
    keyRenewalCancellation: visible.phase === "renewal-only" && visible.keyRenewalCancellation,
    renewalHoldings: visible.phase === "renewal-only" ? visible.renewalHoldings : null,
    reviewRenewalHoldings,
    confirmRenewalHoldings,
    reviewKeyRenewal,
    refreshKeyRenewal,
    confirmKeyRenewal,
    cancelKeyRenewal,
    discardKeyRenewal,
    exportRecoveryKit,
    clearRecoveryExport,
    changePasskey,
    recoverWithKit,
    refreshArchiveChange: () => inspectArchiveChange(false),
    confirmArchiveChange: () => inspectArchiveChange(true),
    resumeArchiveWithNewPasskey,
    cancelArchiveChange,
    cancelRecovery: lock,
    openResult,
    signResultState,
    refreshVault,
    openTask,
    listAgentOutbox,
    publicAgentAnchor,
    inspectAgentOffer,
    prepareAgentRegistration,
    loadAgentRegistration,
    clearAgentRegistration,
    loadAgentApproval,
    clearAgentApproval,
    signAgentGrants,
    sealAgentPreparation,
    loadAgentPreparation,
    clearAgentPreparation,
    taskAuthority,
    sealTask,
    transitionTask,
    listTaskDrafts,
    loadTaskDraft,
    saveTaskDraft,
    clearTaskDraft,
    listTaskOutbox,
    loadTaskOutbox,
    validateTaskPending,
    clearTaskOutbox,
    signIn: auth.signIn,
    create,
    unlock,
    lock,
    cancelOperation: lock,
    refreshKeyManagement,
    reviewDeviceChange,
    confirmDeviceChange,
    discardDeviceChange,
    confirmDeviceRegistration,
    verifyRecovery,
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
