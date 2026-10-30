"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import type { HoldingsWorkspace } from "@/components/useHoldingsWorkspace";
import type {
  EncryptedTask,
  PendingTask,
  ResourceBindingMetadata,
  TaskContent,
  TaskMetadata,
} from "@/lib/encrypted-types";
import { defaultTask, reviewTask, type TaskPreview } from "@/lib/task-forms";
import {
  bindingsKey,
  encryptedTask,
  identifier,
  taskCatalogue,
  taskError,
  taskPage,
  TaskError,
  TASK_CONTRACT,
  type TaskResourceOption,
} from "@/lib/task-types";

type Confirmation = "rules" | "resource_scope" | "key_epoch" | "recipients";
type DraftSummary = { slot: string; revision: number; baseVersion: number; taskId: string };
type PendingSummary = {
  taskId: string;
  operationId: string;
  mode: "create" | "update" | "transition";
  keyEpoch: number;
  expectedVersion: number;
};
type Context = { signal: AbortSignal; assert: () => void };
type Editor = {
  scope: string;
  slot: string;
  revision: number;
  baseVersion: number;
  taskId: string;
  packet: EncryptedTask | null;
};
type State = {
  owner: string | null;
  privateScope: string | null;
  loading: boolean;
  busy: boolean;
  error: string;
  notice: string;
  items: TaskMetadata[];
  catalogue: TaskResourceOption[];
  selected: TaskMetadata | null;
  form: TaskContent | null;
  bindings: ResourceBindingMetadata[];
  dirty: boolean;
  preview: TaskPreview | null;
  confirmation: Confirmation | null;
  confirmationReasons: Confirmation[];
  pending: PendingTask | null;
  pendingOperations: PendingSummary[];
  drafts: DraftSummary[];
  history: TaskMetadata[];
  historical: boolean;
  conflictCurrent: TaskMetadata | null;
};
const initial: State = {
  owner: null,
  privateScope: null,
  loading: false,
  busy: false,
  error: "",
  notice: "",
  items: [],
  catalogue: [],
  selected: null,
  form: null,
  bindings: [],
  dirty: false,
  preview: null,
  confirmation: null,
  confirmationReasons: [],
  pending: null,
  pendingOperations: [],
  drafts: [],
  history: [],
  historical: false,
  conflictCurrent: null,
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const newId = () => `task_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;

export function useTasks(workspace: HoldingsWorkspace, { active }: { active: boolean }) {
  const auth = useAuth();
  const owner = auth.status === "authenticated" && auth.profile ? auth.sessionKey : null;
  const configured = auth.agentHubConfigured && workspace.vaultConfigured;
  const unlocked = Boolean(
    owner && configured && workspace.owner === owner && workspace.phase === "unlocked",
  );
  const scope = unlocked ? `${owner}:${workspace.vaultGeneration}` : null;
  const [visible, setVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden",
  );
  const [state, setState] = useState<State>(initial);
  const stateRef = useRef(state);
  stateRef.current = state;
  const live = useRef({ owner, configured, scope, visible, active, workspace });
  live.current = { owner, configured, scope, visible, active, workspace };
  const jobs = useRef(new Set<AbortController>()),
    generation = useRef(0),
    selection = useRef(0),
    listSerial = useRef(0);
  const editor = useRef<Editor | null>(null),
    writeJob = useRef<object | null>(null);
  const reviewed = useRef<{
    fingerprint: string;
    action: "save" | "pause" | "resume" | "archive";
  } | null>(null);
  const draftQueue = useRef<{
    saving: boolean;
    queued: boolean;
    waiters: (() => void)[];
    failure: unknown;
  }>({ saving: false, queued: false, waiters: [], failure: null });

  const operation = useCallback(
    async <T>(privateRead: boolean, action: (context: Context) => Promise<T>): Promise<T> => {
      const start = live.current,
        epoch = generation.current,
        controller = new AbortController();
      jobs.current.add(controller);
      let timedOut = false;
      const timeout = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 60_000);
      const assert = () => {
        const now = live.current;
        if (
          controller.signal.aborted ||
          !start.owner ||
          now.owner !== start.owner ||
          !now.configured ||
          !now.active ||
          !now.visible ||
          (privateRead &&
            (!start.scope || now.scope !== start.scope || generation.current !== epoch))
        )
          throw new TaskError(timedOut ? "request_timeout" : "cancelled");
      };
      let cancel: (() => void) | undefined;
      const cancellation = new Promise<never>((_resolve, reject) => {
        cancel = () => reject(new TaskError(timedOut ? "request_timeout" : "cancelled"));
        controller.signal.addEventListener("abort", cancel, { once: true });
      });
      try {
        assert();
        return await Promise.race([action({ signal: controller.signal, assert }), cancellation]);
      } finally {
        if (cancel) controller.signal.removeEventListener("abort", cancel);
        controller.abort();
        window.clearTimeout(timeout);
        jobs.current.delete(controller);
      }
    },
    [],
  );
  const api = useCallback(
    async (
      path: string,
      context: Context,
      options: {
        method?: "GET" | "POST" | "PUT";
        json?: unknown;
        headers?: Record<string, string>;
      } = {},
    ) => {
      context.assert();
      const response = await auth.requestPrivate("agent-hub", path, owner!, {
        ...options,
        signal: context.signal,
        headers: { "X-FolioView-Contract": TASK_CONTRACT, ...options.headers },
      });
      context.assert();
      if (!response.ok)
        throw new TaskError(
          response.status === 409
            ? "version_conflict"
            : response.status === 401
              ? "session_expired"
              : response.status === 403
                ? "insufficient_scope"
                : response.status === 404
                  ? "not_found"
                  : "request_failed",
        );
      if (
        !response.body ||
        response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !==
          "application/json"
      )
        throw new TaskError("invalid_response");
      const reader = response.body.getReader(),
        parts: Uint8Array[] = [];
      let length = 0;
      const cancel = () => {
        void reader.cancel().catch(() => {});
      };
      context.signal.addEventListener("abort", cancel, { once: true });
      try {
        for (;;) {
          const part = await reader.read();
          context.assert();
          if (part.done) break;
          length += part.value.length;
          if (length > 1048576) throw new TaskError("invalid_response");
          parts.push(part.value);
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const part of parts) {
          bytes.set(part, offset);
          offset += part.length;
        }
        context.assert();
        return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
      } catch (error) {
        if (error instanceof TaskError) throw error;
        throw new TaskError("invalid_response");
      } finally {
        context.signal.removeEventListener("abort", cancel);
        void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    },
    [auth.requestPrivate, owner],
  );
  const updatePrivate = useCallback((apply: (previous: State) => State) => {
    const now = live.current;
    if (now.owner && now.scope && now.visible && now.active)
      setState((previous) =>
        previous.owner === now.owner && previous.privateScope === now.scope
          ? apply(previous)
          : previous,
      );
  }, []);
  const fail = useCallback(
    (error: unknown) => {
      if (taskError(error) !== "cancelled")
        updatePrivate((previous) => ({ ...previous, error: taskError(error) }));
    },
    [updatePrivate],
  );

  const summaries = useCallback(
    async (context: Context) => {
      const [drafts, pendingOperations] = await Promise.all([
        live.current.workspace.listTaskDrafts(),
        live.current.workspace.listTaskOutbox(),
      ]);
      context.assert();
      updatePrivate((previous) => ({ ...previous, drafts, pendingOperations }));
    },
    [updatePrivate],
  );
  const reload = useCallback(async () => {
    if (
      !owner ||
      live.current.owner !== owner ||
      !configured ||
      !live.current.active ||
      !live.current.visible
    )
      return;
    const serial = ++listSerial.current;
    setState((previous) => ({
      ...(previous.owner === owner ? previous : initial),
      owner,
      loading: true,
      error: "",
    }));
    try {
      await operation(false, async (context) => {
        const [page, catalogue] = await Promise.all([
          api("/api/v2/tasks?limit=32", context),
          api("/api/v2/resources/catalogue", context),
        ]);
        const items = taskPage(page),
          resources = taskCatalogue(catalogue);
        context.assert();
        if (serial !== listSerial.current) return;
        setState((previous) =>
          previous.owner === owner ? { ...previous, items, catalogue: resources } : previous,
        );
      });
    } catch (error) {
      if (
        live.current.owner === owner &&
        serial === listSerial.current &&
        taskError(error) !== "cancelled"
      )
        setState((previous) => ({ ...previous, error: taskError(error) }));
    } finally {
      if (live.current.owner === owner && serial === listSerial.current)
        setState((previous) => ({ ...previous, loading: false }));
    }
  }, [api, configured, operation, owner]);

  const persistDraft = useCallback(async () => {
    const queue = draftQueue.current;
    queue.queued = true;
    if (queue.saving) {
      await new Promise<void>((resolve) => queue.waiters.push(resolve));
      if (queue.failure) throw queue.failure;
      return;
    }
    queue.saving = true;
    queue.failure = null;
    try {
      while (queue.queued && queue === draftQueue.current) {
        queue.queued = false;
        const current = editor.current,
          snapshot = stateRef.current;
        if (
          !current ||
          current.scope !== live.current.scope ||
          !snapshot.form ||
          snapshot.privateScope !== current.scope ||
          !snapshot.dirty
        )
          break;
        await operation(true, async (context) => {
          const saved = await live.current.workspace.saveTaskDraft({
            slot: current.slot,
            expectedRevision: current.revision,
            baseVersion: current.baseVersion,
            taskId: current.taskId,
            draft: clone({ content: snapshot.form!, resourceBindings: snapshot.bindings }),
          });
          context.assert();
          if (editor.current !== current) return;
          current.revision = saved.revision;
          updatePrivate((previous) => ({
            ...previous,
            drafts: [...previous.drafts.filter((row) => row.slot !== saved.slot), saved],
            notice: "draft_saved",
          }));
        });
      }
    } catch (error) {
      queue.queued = false;
      queue.failure = error;
      fail(error);
    } finally {
      queue.saving = false;
      for (const resolve of queue.waiters.splice(0)) resolve();
    }
    if (queue.failure) throw queue.failure;
  }, [fail, operation, updatePrivate]);

  const editable = useCallback(() => {
    if (
      !owner ||
      live.current.owner !== owner ||
      !scope ||
      live.current.scope !== scope ||
      !live.current.visible ||
      !live.current.active ||
      stateRef.current.historical ||
      writeJob.current ||
      stateRef.current.pending
    )
      return false;
    return true;
  }, [owner, scope]);
  const startNew = useCallback(
    (seed?: ResourceBindingMetadata, initialContent?: TaskContent) => {
      if (!editable()) return;
      if (stateRef.current.form || stateRef.current.drafts.some((row) => row.slot === "new")) {
        updatePrivate((previous) => ({ ...previous, error: "unsaved_draft" }));
        return;
      }
      if (stateRef.current.items.length >= 32) {
        updatePrivate((previous) => ({ ...previous, error: "task_limit" }));
        return;
      }
      if (
        seed &&
        !stateRef.current.catalogue.some(
          (row) =>
            row.selectable && row.binding && bindingsKey([row.binding]) === bindingsKey([seed]),
        )
      ) {
        updatePrivate((previous) => ({ ...previous, error: "source_unavailable" }));
        return;
      }
      editor.current = {
        scope: scope!,
        slot: "new",
        revision: 0,
        baseVersion: 0,
        taskId: newId(),
        packet: null,
      };
      reviewed.current = null;
      const form = clone(initialContent ?? defaultTask());
      setState((previous) => ({
        ...previous,
        privateScope: scope,
        selected: null,
        form,
        bindings: seed ? [clone(seed)] : [],
        dirty: true,
        preview: null,
        confirmation: null,
        confirmationReasons: [],
        history: [],
        historical: false,
        conflictCurrent: null,
        error: "",
        notice: "",
      }));
      // The effect below seals every changed form, including incomplete drafts.
    },
    [editable, scope, updatePrivate],
  );
  const setForm = useCallback(
    (form: TaskContent) => {
      if (!editable() || !editor.current || !stateRef.current.form) return;
      if (
        !stateRef.current.dirty &&
        stateRef.current.drafts.some((row) => row.slot === editor.current!.slot)
      ) {
        fail(new TaskError("unsaved_draft"));
        return;
      }
      reviewed.current = null;
      updatePrivate((previous) => ({
        ...previous,
        form: clone(form),
        dirty: true,
        preview: null,
        confirmation: null,
        confirmationReasons: [],
        error: "",
        notice: "",
      }));
    },
    [editable, fail, updatePrivate],
  );
  const setBindings = useCallback(
    (bindings: ResourceBindingMetadata[]) => {
      if (!editable() || !editor.current || !stateRef.current.form || bindings.length > 10) return;
      if (
        !stateRef.current.dirty &&
        stateRef.current.drafts.some((row) => row.slot === editor.current!.slot)
      ) {
        fail(new TaskError("unsaved_draft"));
        return;
      }
      reviewed.current = null;
      updatePrivate((previous) => ({
        ...previous,
        bindings: clone(bindings),
        dirty: true,
        preview: null,
        confirmation: null,
        confirmationReasons: [],
        error: "",
        notice: "",
      }));
    },
    [editable, fail, updatePrivate],
  );
  const review = useCallback(() => {
    if (!editable() || !stateRef.current.form) return;
    updatePrivate((previous) => ({
      ...previous,
      preview: reviewTask(previous.form!, previous.bindings),
      confirmation: null,
      error: "",
    }));
  }, [editable, updatePrivate]);

  const openTask = useCallback(
    async (taskId: string, version?: number) => {
      if (
        !owner ||
        live.current.owner !== owner ||
        !scope ||
        live.current.scope !== scope ||
        writeJob.current ||
        !identifier(taskId) ||
        (version !== undefined && (!Number.isSafeInteger(version) || version < 1 || version > 50))
      )
        return;
      if (stateRef.current.dirty || stateRef.current.pending) {
        fail(new TaskError("unsaved_draft"));
        return;
      }
      const serial = ++selection.current;
      updatePrivate((previous) => ({
        ...previous,
        busy: true,
        error: "",
        form: null,
        selected: null,
        preview: null,
        confirmation: null,
      }));
      try {
        await operation(true, async (context) => {
          await live.current.workspace.refreshVault(context.signal);
          context.assert();
          const head = encryptedTask(await api(`/api/v2/tasks/${taskId}`, context));
          context.assert();
          const packet =
            version === undefined || version === head.metadata.taskVersion
              ? head
              : encryptedTask(await api(`/api/v2/tasks/${taskId}/versions/${version}`, context));
          if (
            packet.metadata.taskId !== taskId ||
            (version !== undefined && packet.metadata.taskVersion !== version)
          )
            throw new TaskError("invalid_response");
          const form = await live.current.workspace.openTask(packet);
          context.assert();
          if (serial !== selection.current) return;
          const existingDrafts = await live.current.workspace.listTaskDrafts();
          context.assert();
          if (serial !== selection.current) return;
          const draft = existingDrafts.find((row) => row.slot === taskId);
          editor.current = {
            scope: live.current.scope!,
            slot: taskId,
            taskId,
            revision: draft?.revision ?? 0,
            baseVersion: packet.metadata.taskVersion,
            packet,
          };
          reviewed.current = null;
          updatePrivate((previous) => ({
            ...previous,
            selected: packet.metadata,
            form,
            bindings: packet.metadata.resourceBindings,
            dirty: false,
            historical: packet.metadata.taskVersion !== head.metadata.taskVersion,
            conflictCurrent: null,
            history: [head.metadata],
            drafts: existingDrafts,
            confirmation: null,
            confirmationReasons: [],
            notice: "",
          }));
        });
      } catch (error) {
        if (serial === selection.current) fail(error);
      } finally {
        if (serial === selection.current)
          updatePrivate((previous) => ({ ...previous, busy: false }));
      }
    },
    [api, fail, operation, owner, scope, updatePrivate],
  );

  const restoreDraft = useCallback(
    async (slot: string) => {
      if (
        !owner ||
        live.current.owner !== owner ||
        !scope ||
        live.current.scope !== scope ||
        writeJob.current ||
        stateRef.current.dirty ||
        stateRef.current.pending
      )
        return;
      const serial = ++selection.current;
      updatePrivate((previous) => ({ ...previous, busy: true, error: "" }));
      try {
        await operation(true, async (context) => {
          const restored = await live.current.workspace.loadTaskDraft(slot);
          context.assert();
          if (!restored) throw new TaskError("not_found");
          let packet: EncryptedTask | null = null,
            head: EncryptedTask | null = null;
          if (restored.baseVersion > 0) {
            await live.current.workspace.refreshVault(context.signal);
            context.assert();
            head = encryptedTask(await api(`/api/v2/tasks/${restored.taskId}`, context));
            packet =
              head.metadata.taskVersion === restored.baseVersion
                ? head
                : encryptedTask(
                    await api(
                      `/api/v2/tasks/${restored.taskId}/versions/${restored.baseVersion}`,
                      context,
                    ),
                  );
            if (
              head.metadata.taskId !== restored.taskId ||
              packet.metadata.taskId !== restored.taskId ||
              packet.metadata.taskVersion !== restored.baseVersion
            )
              throw new TaskError("invalid_response");
            await live.current.workspace.openTask(packet);
            context.assert();
          }
          context.assert();
          if (serial !== selection.current) return;
          editor.current = {
            scope: live.current.scope!,
            slot,
            revision: restored.revision,
            baseVersion: restored.baseVersion,
            taskId: restored.taskId,
            packet,
          };
          reviewed.current = null;
          updatePrivate((previous) => ({
            ...previous,
            selected: packet?.metadata ?? null,
            form: restored.draft.content,
            bindings: restored.draft.resourceBindings,
            dirty: true,
            historical: false,
            preview: null,
            confirmation: null,
            confirmationReasons: [],
            conflictCurrent:
              head && head.metadata.taskVersion !== restored.baseVersion ? head.metadata : null,
            notice: "draft_restored",
            error:
              head && head.metadata.taskVersion !== restored.baseVersion ? "version_conflict" : "",
          }));
        });
      } catch (error) {
        fail(error);
      } finally {
        if (serial === selection.current)
          updatePrivate((previous) => ({ ...previous, busy: false }));
      }
    },
    [api, fail, operation, owner, scope, updatePrivate],
  );

  const freshWrite = useCallback(
    async (context: Context, current: Editor, action: "save" | "pause" | "resume" | "archive") => {
      if (!live.current.workspace.canWriteState) throw new TaskError("unlock_required");
      await live.current.workspace.refreshVault(context.signal, true);
      context.assert();
      let head: EncryptedTask | null = null;
      if (current.baseVersion > 0) {
        head = encryptedTask(await api(`/api/v2/tasks/${current.taskId}`, context));
        context.assert();
        if (head.metadata.taskId !== current.taskId) throw new TaskError("invalid_response");
        if (
          head.metadata.taskVersion !== current.baseVersion ||
          head.metadata.envelopeFingerprint !== current.packet?.metadata.envelopeFingerprint
        ) {
          updatePrivate((previous) => ({ ...previous, conflictCurrent: head!.metadata }));
          throw new TaskError("version_conflict");
        }
        if (head.metadata.status === "archived") throw new TaskError("historical_read_only");
        if (head.metadata.taskVersion >= 50) throw new TaskError("version_limit");
      }
      const catalogue = taskCatalogue(await api("/api/v2/resources/catalogue", context));
      context.assert();
      updatePrivate((previous) => ({ ...previous, catalogue }));
      const snapshot = stateRef.current;
      // Pausing/archiving never expands a source and must remain available during an upstream outage.
      if (
        action !== "pause" &&
        action !== "archive" &&
        snapshot.bindings.some(
          (binding) =>
            !catalogue.some(
              (option) =>
                option.selectable &&
                option.binding &&
                bindingsKey([binding]) === bindingsKey([option.binding]),
            ),
        )
      )
        throw new TaskError("source_unavailable");
      const authority = await live.current.workspace.taskAuthority(head);
      context.assert();
      return { head, authority };
    },
    [api, updatePrivate],
  );

  const transmit = useCallback(
    async (
      packet: PendingTask,
      context: Context,
      consumedDraft?: { slot: string; revision: number; taskId: string },
    ) => {
      const route =
        packet.mode === "create"
          ? "/api/v2/tasks"
          : `/api/v2/tasks/${packet.taskId}${packet.mode === "transition" ? "/transitions" : ""}`;
      const saved = encryptedTask(
        await api(route, context, {
          method: packet.mode === "update" ? "PUT" : "POST",
          json: packet.body,
          headers: {
            "Idempotency-Key": packet.operationId,
            "X-FolioView-Author-Key": packet.authorKeyId,
          },
        }),
      );
      context.assert();
      if (
        saved.metadata.taskId !== packet.taskId ||
        saved.metadata.envelopeFingerprint !== packet.envelopeFingerprint ||
        saved.metadata.taskVersion !== packet.body.expectedVersion + 1
      )
        throw new TaskError("invalid_response");
      // Verify the complete authenticated task before accepting success or clearing the exact retry packet.
      await live.current.workspace.openTask(saved);
      context.assert();
      const head = encryptedTask(await api(`/api/v2/tasks/${packet.taskId}`, context));
      context.assert();
      if (
        head.metadata.taskId !== packet.taskId ||
        head.metadata.taskVersion < saved.metadata.taskVersion ||
        (head.metadata.taskVersion === saved.metadata.taskVersion &&
          head.metadata.envelopeFingerprint !== saved.metadata.envelopeFingerprint)
      )
        throw new TaskError("invalid_response");
      const form = await live.current.workspace.openTask(head);
      context.assert();
      const storedDrafts = await live.current.workspace.listTaskDrafts();
      context.assert();
      let retainedDraft = storedDrafts.some((draft) => draft.taskId === packet.taskId);
      // Only the current explicit save can prove which reviewed draft produced
      // this packet. Recovered packets retain all drafts, including other tabs' edits.
      if (consumedDraft) {
        if (consumedDraft.taskId !== packet.taskId) throw new TaskError("invalid_response");
        try {
          await live.current.workspace.clearTaskDraft(consumedDraft.slot, consumedDraft.revision);
          context.assert();
          retainedDraft = storedDrafts.some(
            (draft) => draft.taskId === packet.taskId && draft.slot !== consumedDraft.slot,
          );
        } catch (error) {
          context.assert();
          if (taskError(error) !== "draft_conflict") throw error;
          retainedDraft = true;
        }
      }
      await live.current.workspace.clearTaskOutbox(packet.taskId, packet.operationId);
      context.assert();
      editor.current = {
        scope: live.current.scope!,
        slot: packet.taskId,
        revision: 0,
        taskId: packet.taskId,
        baseVersion: head.metadata.taskVersion,
        packet: head,
      };
      reviewed.current = null;
      updatePrivate((previous) => ({
        ...previous,
        selected: head.metadata,
        form,
        bindings: head.metadata.resourceBindings,
        dirty: false,
        pending: null,
        confirmation: null,
        confirmationReasons: [],
        preview: null,
        historical: false,
        conflictCurrent: null,
        error: "",
        notice: retainedDraft ? "saved_draft_retained" : "saved",
        items: [
          ...previous.items.filter((row) => row.taskId !== head.metadata.taskId),
          head.metadata,
        ],
      }));
      await summaries(context);
    },
    [api, summaries, updatePrivate],
  );

  const write = useCallback(
    async (action: "save" | "pause" | "resume" | "archive", confirmed = false) => {
      if (
        !owner ||
        live.current.owner !== owner ||
        !editable() ||
        !editor.current ||
        !stateRef.current.form
      )
        return;
      const current = editor.current,
        snapshot = stateRef.current;
      const hasUnreviewedDraft =
        !snapshot.dirty && snapshot.drafts.some((row) => row.slot === current.slot);
      if (action !== "save" && (snapshot.dirty || !current.packet || hasUnreviewedDraft)) {
        fail(new TaskError("unsaved_draft"));
        return;
      }
      const preview = reviewTask(snapshot.form!, snapshot.bindings);
      updatePrivate((previous) => ({ ...previous, preview }));
      if (action === "save" && !preview.valid) {
        fail(new TaskError("validation_failed"));
        return;
      }
      if (action === "save" && !snapshot.dirty) {
        fail(new TaskError("nothing_to_save"));
        return;
      }
      const job = {};
      writeJob.current = job;
      updatePrivate((previous) => ({ ...previous, busy: true, error: "" }));
      try {
        await persistDraft();
        if (
          live.current.owner !== owner ||
          live.current.scope !== scope ||
          editor.current !== current
        )
          throw new TaskError("cancelled");
        await operation(true, async (context) => {
          const outstanding = await live.current.workspace.loadTaskOutbox(current.taskId);
          context.assert();
          if (outstanding) {
            updatePrivate((previous) => ({ ...previous, pending: outstanding }));
            throw new TaskError("pending_task");
          }
          const { head, authority } = await freshWrite(context, current, action);
          context.assert();
          if (
            editor.current !== current ||
            stateRef.current.form !== snapshot.form ||
            bindingsKey(stateRef.current.bindings) !== bindingsKey(snapshot.bindings)
          )
            throw new TaskError("review_required");
          const reasons: Confirmation[] = [];
          if (head && authority.keyEpoch !== head.metadata.keyEpoch) reasons.push("key_epoch");
          if (
            head &&
            JSON.stringify(authority.recipientKeyIds) !==
              JSON.stringify(authority.previousRecipientKeyIds)
          )
            reasons.push("recipients");
          if (
            head &&
            bindingsKey(snapshot.bindings) !== bindingsKey(head.metadata.resourceBindings)
          )
            reasons.push("resource_scope");
          if (!reasons.length) reasons.push("rules");
          const fingerprint = JSON.stringify({
            content: snapshot.form,
            bindings: bindingsKey(snapshot.bindings),
            version: current.baseVersion,
            taskId: current.taskId,
            authority,
            action,
          });
          if (
            !confirmed ||
            reviewed.current?.fingerprint !== fingerprint ||
            reviewed.current.action !== action
          ) {
            reviewed.current = { fingerprint, action };
            updatePrivate((previous) => ({
              ...previous,
              confirmation: reasons[0],
              confirmationReasons: reasons,
            }));
            return;
          }
          const consumedDraft =
            action === "save" && current.revision > 0
              ? { slot: current.slot, revision: current.revision, taskId: current.taskId }
              : undefined;
          const packet =
            action === "save"
              ? await live.current.workspace.sealTask({
                  content: snapshot.form!,
                  resourceBindings: snapshot.bindings,
                  current: head,
                  taskId: current.taskId,
                })
              : await live.current.workspace.transitionTask({ current: head!, action });
          context.assert();
          // Seal commits an exact ciphertext retry packet before any HTTP side effect.
          updatePrivate((previous) => ({
            ...previous,
            pending: packet,
            confirmation: null,
            confirmationReasons: [],
          }));
          await transmit(packet, context, consumedDraft);
        });
      } catch (error) {
        fail(error);
      } finally {
        if (writeJob.current === job) {
          writeJob.current = null;
          updatePrivate((previous) => ({ ...previous, busy: false }));
        }
      }
    },
    [editable, fail, freshWrite, operation, owner, scope, persistDraft, transmit, updatePrivate],
  );

  const recoverPending = useCallback(
    async (taskId?: string) => {
      if (
        !owner ||
        live.current.owner !== owner ||
        !scope ||
        live.current.scope !== scope ||
        writeJob.current
      )
        return;
      updatePrivate((previous) => ({ ...previous, busy: true, error: "" }));
      try {
        await operation(true, async (context) => {
          const list = await live.current.workspace.listTaskOutbox();
          context.assert();
          const id = taskId ?? editor.current?.taskId ?? list[0]?.taskId;
          const pending = id ? await live.current.workspace.loadTaskOutbox(id) : null;
          context.assert();
          updatePrivate((previous) => ({
            ...previous,
            pending,
            pendingOperations: list,
            notice: pending ? "pending_recovered" : "no_pending",
          }));
        });
      } catch (error) {
        fail(error);
      } finally {
        updatePrivate((previous) => ({ ...previous, busy: false }));
      }
    },
    [fail, operation, owner, scope, updatePrivate],
  );
  const resendPending = useCallback(async () => {
    if (
      !owner ||
      live.current.owner !== owner ||
      !scope ||
      live.current.scope !== scope ||
      writeJob.current ||
      !stateRef.current.pending
    )
      return;
    const packet = stateRef.current.pending,
      job = {};
    writeJob.current = job;
    updatePrivate((previous) => ({ ...previous, busy: true, error: "" }));
    try {
      await operation(true, async (context) => {
        await live.current.workspace.refreshVault(context.signal, true);
        context.assert();
        await live.current.workspace.validateTaskPending(packet);
        context.assert();
        await transmit(packet, context);
      });
    } catch (error) {
      fail(error);
    } finally {
      if (writeJob.current === job) {
        writeJob.current = null;
        updatePrivate((previous) => ({ ...previous, busy: false }));
      }
    }
  }, [fail, operation, owner, scope, transmit, updatePrivate]);
  const discardPending = useCallback(
    async (taskId?: string, operationId?: string) => {
      if (
        !owner ||
        live.current.owner !== owner ||
        !scope ||
        live.current.scope !== scope ||
        writeJob.current
      )
        return;
      const packet =
        taskId && operationId
          ? stateRef.current.pendingOperations.find(
              (row) => row.taskId === taskId && row.operationId === operationId,
            )
          : stateRef.current.pending;
      if (!packet) return;
      try {
        await operation(true, async (context) => {
          await live.current.workspace.clearTaskOutbox(packet.taskId, packet.operationId);
          context.assert();
          updatePrivate((previous) => ({
            ...previous,
            pending: null,
            notice: "retry_discarded",
            error: "",
          }));
          await summaries(context);
        });
      } catch (error) {
        fail(error);
      }
    },
    [fail, operation, owner, scope, summaries, updatePrivate],
  );
  const discardDraft = useCallback(async () => {
    if (
      !owner ||
      live.current.owner !== owner ||
      !scope ||
      live.current.scope !== scope ||
      writeJob.current ||
      stateRef.current.pending
    )
      return;
    try {
      await persistDraft();
      if (live.current.owner !== owner || live.current.scope !== scope)
        throw new TaskError("cancelled");
      await operation(true, async (context) => {
        const current = editor.current;
        const revision = current
          ? current.revision ||
            stateRef.current.drafts.find((row) => row.slot === current.slot)?.revision
          : undefined;
        if (current && revision) {
          await live.current.workspace.clearTaskDraft(current.slot, revision);
          context.assert();
        }
        editor.current = null;
        reviewed.current = null;
        ++selection.current;
        updatePrivate((previous) => ({
          ...previous,
          selected: null,
          form: null,
          bindings: [],
          dirty: false,
          preview: null,
          confirmation: null,
          confirmationReasons: [],
          historical: false,
          conflictCurrent: null,
          history: [],
          error: "",
          notice: "draft_discarded",
        }));
        await summaries(context);
      });
    } catch (error) {
      fail(error);
    }
  }, [fail, operation, owner, scope, persistDraft, summaries, updatePrivate]);
  const rebaseDraft = useCallback(async () => {
    if (
      !editable() ||
      !editor.current ||
      !stateRef.current.form ||
      !stateRef.current.dirty ||
      editor.current.baseVersion === 0
    )
      return;
    const current = editor.current;
    try {
      await persistDraft();
      await operation(true, async (context) => {
        if (live.current.scope !== current.scope || editor.current !== current)
          throw new TaskError("cancelled");
        await live.current.workspace.refreshVault(context.signal, true);
        context.assert();
        const head = encryptedTask(await api(`/api/v2/tasks/${current.taskId}`, context));
        context.assert();
        if (head.metadata.taskId !== current.taskId) throw new TaskError("invalid_response");
        if (head.metadata.status === "archived" || head.metadata.taskVersion >= 50)
          throw new TaskError("historical_read_only");
        // Opening latest verifies it before the explicit rebase. Draft content remains unchanged.
        await live.current.workspace.openTask(head);
        context.assert();
        const saved = await live.current.workspace.saveTaskDraft({
          slot: current.slot,
          expectedRevision: current.revision,
          baseVersion: head.metadata.taskVersion,
          taskId: current.taskId,
          draft: clone({
            content: stateRef.current.form!,
            resourceBindings: stateRef.current.bindings,
          }),
        });
        context.assert();
        current.packet = head;
        current.baseVersion = head.metadata.taskVersion;
        current.revision = saved.revision;
        reviewed.current = null;
        updatePrivate((previous) => ({
          ...previous,
          selected: head.metadata,
          conflictCurrent: null,
          confirmation: null,
          confirmationReasons: [],
          preview: null,
          error: "",
          notice: "draft_rebased",
          drafts: [...previous.drafts.filter((row) => row.slot !== saved.slot), saved],
        }));
      });
    } catch (error) {
      fail(error);
    }
  }, [api, editable, fail, operation, persistDraft, updatePrivate]);

  useEffect(() => {
    const changed = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  useEffect(() => {
    ++generation.current;
    ++selection.current;
    ++listSerial.current;
    for (const job of jobs.current) job.abort();
    jobs.current.clear();
    editor.current = null;
    reviewed.current = null;
    writeJob.current = null;
    draftQueue.current = { saving: false, queued: false, waiters: [], failure: null };
    setState((previous) => ({
      ...(previous.owner === owner ? previous : initial),
      owner,
      privateScope: active && visible ? scope : null,
      selected: null,
      form: null,
      bindings: [],
      dirty: false,
      preview: null,
      confirmation: null,
      confirmationReasons: [],
      pending: null,
      pendingOperations: [],
      drafts: [],
      history: [],
      historical: false,
      conflictCurrent: null,
      busy: false,
      loading: false,
    }));
    if (scope && active && visible) void operation(true, summaries).catch(fail);
    return () => {
      ++generation.current;
      for (const job of jobs.current) job.abort();
      editor.current = null;
      reviewed.current = null;
    };
  }, [owner, scope, active, visible, operation, summaries, fail]);
  useEffect(() => {
    if (owner && configured && active && visible) void reload();
  }, [owner, configured, active, visible, scope, reload]);
  useEffect(() => {
    if (state.privateScope === scope && state.form && state.dirty && active && visible)
      void persistDraft().catch(fail);
  }, [
    state.form,
    state.bindings,
    state.privateScope,
    state.dirty,
    scope,
    active,
    visible,
    persistDraft,
    fail,
  ]);

  const display = state.owner === owner ? state : { ...initial, owner };
  const privateVisible = Boolean(scope && active && visible && display.privateScope === scope);
  const output = privateVisible
    ? display
    : {
        ...display,
        form: null,
        selected: null,
        bindings: [],
        dirty: false,
        preview: null,
        confirmation: null,
        confirmationReasons: [],
        pending: null,
        pendingOperations: [],
        drafts: [],
        history: [],
        historical: false,
        conflictCurrent: null,
        busy: false,
      };
  return {
    ...output,
    owner,
    configured,
    unlocked: privateVisible,
    canWrite: privateVisible && workspace.canWriteState,
    nextExpectedAt: output.form ? reviewTask(output.form, output.bindings).nextExpectedAt : null,
    reload,
    startNew,
    openTask,
    setForm,
    setBindings,
    review,
    save: (confirmed = false) => write("save", confirmed),
    transition: (action: "pause" | "resume" | "archive", confirmed = false) =>
      write(action, confirmed),
    recoverPending,
    resendPending,
    discardPending,
    restoreDraft,
    discardDraft,
    rebaseDraft,
    cancelConfirmation: () => {
      if (editable()) {
        reviewed.current = null;
        updatePrivate((previous) => ({ ...previous, confirmation: null, confirmationReasons: [] }));
      }
    },
    loadVersion: (version: number) =>
      output.selected ? openTask(output.selected.taskId, version) : Promise.resolve(),
    copyHandoff: async () => {
      if (
        !owner ||
        live.current.owner !== owner ||
        !scope ||
        live.current.scope !== scope ||
        !live.current.visible ||
        !live.current.active ||
        stateRef.current.dirty ||
        !stateRef.current.selected
      )
        return;
      try {
        await navigator.clipboard.writeText(stateRef.current.selected.taskId);
      } catch {
        fail(new TaskError("request_failed"));
      }
    },
  };
}
export type TaskModel = ReturnType<typeof useTasks>;
