"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import type { HoldingsWorkspace } from "./useHoldingsWorkspace";
import type {
  AgentAnchor,
  AgentApprovalPacket,
  AgentGrantPacket,
  AgentPreparationPacket,
  AgentPreparationSource,
  AgentRegistration,
  EncryptedTask,
  HelperPublicOffer,
  Json,
  TaskContent,
  TaskMetadata,
} from "@/lib/encrypted-types";
import {
  CONNECTION_CONTRACT,
  ConnectionError,
  connectionError,
  exact,
  identifier,
  readConnectionList,
  type AgentScope,
} from "@/lib/agent-connections";
import {
  equalJSON,
  readPendingAuthorization,
  readPreparationIntent,
  readPreparationCommit,
  verifyPreparationDescriptor,
  verifyPreparationObjects,
  type PendingAuthorization,
} from "@/lib/agent-consent";
import { encryptedTask, taskPage } from "@/lib/task-types";
import {
  readChannelFollows,
  readResourceCatalogue,
  readResourceWatchlist,
  type ResourceCatalogue,
  type ResourceItem,
} from "@/lib/resource-library";
import {
  connectOwnerConsentBridge,
  type ConsentHandoff,
  type ConsentOperation,
  type OwnerConsentBridge,
} from "@/lib/owner-consent-bridge";
import {
  HELPER_VERSION,
  HELPER_WORKER_SHA256,
  openHelperOwnerBridge,
  type HelperOwnerBridge,
} from "@/lib/helper-owner-bridge";
import type { AgentLinkConfiguration } from "@/lib/agent-link";

type Stage =
  "incoming" | "select" | "keys" | "registered" | "grant" | "approved" | "published" | "closed";
type Outbox = {
  kind: "registration" | "preparation" | "approval";
  connectionId: string;
  taskId: string;
  operationId: string;
};
type OfferReview = {
  registered: boolean;
  registeredExpiresAt: number | null;
  offerFingerprint: string;
  existingConnectionKeyIds: string[];
  agentSigningKeyEpoch: number;
  agentEncryptionKeyEpoch: number;
  registrySequence: number;
  checkpointDigest: string;
};
type SetupCard = {
  helperVersion: "1.2.0";
  workerSha256: string;
  anchor: AgentAnchor;
  ttlSeconds: number;
};
type State = {
  owner: string | null;
  scope: string | null;
  stage: Stage;
  busy: boolean;
  error: string;
  notice: string;
  authorization: PendingAuthorization | null;
  tasks: TaskMetadata[];
  selected: EncryptedTask | null;
  content: TaskContent | null;
  scopes: AgentScope[];
  setupCard: SetupCard | null;
  offer: HelperPublicOffer | null;
  offerReview: OfferReview | null;
  keysConfirmed: boolean;
  replacementConfirmed: boolean;
  grantConfirmed: boolean;
  registered: boolean;
  decisionSent: boolean;
  mode: "paired" | "manual" | null;
  signedGrant: AgentApprovalPacket | null;
  published: AgentPreparationPacket | null;
  helperConfirmed: boolean;
  outbox: Outbox[];
  pendingRegistration: AgentRegistration | null;
  pendingPreparation: AgentPreparationPacket | null;
};
const initial = (owner: string | null = null): State => ({
  owner,
  scope: null,
  stage: "incoming",
  busy: false,
  error: "",
  notice: "",
  authorization: null,
  tasks: [],
  selected: null,
  content: null,
  scopes: [],
  setupCard: null,
  offer: null,
  offerReview: null,
  keysConfirmed: false,
  replacementConfirmed: false,
  grantConfirmed: false,
  registered: false,
  signedGrant: null,
  decisionSent: false,
  mode: null,
  published: null,
  helperConfirmed: false,
  outbox: [],
  pendingRegistration: null,
  pendingPreparation: null,
});
type Context = { signal: AbortSignal; assert: () => void };
const nonceId = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
const fieldError = (error: unknown) => {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  return [
    "cancelled",
    "invalid_handoff",
    "popup_blocked",
    "helper_rejected",
    "request_timeout",
    "invalid_response",
    "request_failed",
    "insufficient_scope",
    "session_expired",
    "not_found",
    "version_conflict",
    "review_required",
    "source_unavailable",
    "stale_epoch",
    "stale_key_epoch",
    "registry_conflict",
    "key_revoked",
    "replacement_review_required",
    "pending_agent_operation",
    "outcome_unknown",
    "helper_unavailable",
    "selection_required",
    "confirmation_required",
    "request_busy",
  ].includes(code)
    ? code
    : connectionError(error);
};
const sourceKey = (ref: unknown) =>
  JSON.stringify(
    ref && typeof ref === "object"
      ? Object.entries(ref).sort(([a], [b]) => a.localeCompare(b))
      : ref,
  );
function helperReady(value: unknown): value is Json {
  return (
    exact(value, [
      "profile",
      "helperVersion",
      "state",
      "sessionId",
      "generation",
      "expiresAt",
      "foreground",
      "authenticatedTransport",
      "independentDeliveryConfirmed",
      "privateKeysPersistent",
    ]) &&
    value.profile === "folioview.foreground-controller.v1" &&
    value.helperVersion === HELPER_VERSION &&
    value.state === "READY" &&
    value.privateKeysPersistent === false &&
    Number.isSafeInteger(value.generation) &&
    value.generation >= 1 &&
    identifier(value.sessionId) &&
    Number.isSafeInteger(value.expiresAt) &&
    value.expiresAt > 0 &&
    [value.foreground, value.authenticatedTransport, value.independentDeliveryConfirmed].every(
      (field) => typeof field === "boolean",
    )
  );
}

/** Consent credentials and public helper controls use distinct, fixed browser ports. */
export function useAgentConsent(
  workspace: HoldingsWorkspace,
  configuration: AgentLinkConfiguration | null,
  handoff: ConsentHandoff | null,
  active: boolean,
  connectionEnabled = true,
) {
  const auth = useAuth(),
    owner = auth.status === "authenticated" && auth.profile ? auth.sessionKey : null;
  const configured =
    auth.agentHubConfigured && configuration?.enabled === true && Boolean(configuration.hubOrigin);
  const scope =
    owner && workspace.owner === owner && workspace.phase === "unlocked"
      ? `${owner}:${workspace.vaultGeneration}`
      : null;
  const [visible, setVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden",
  );
  const [state, setState] = useState<State>(() => initial(owner));
  const current = useRef(state);
  current.current = state;
  // Rollout revalidation may pause new steps without replacing the trusted
  // destination or tearing down an existing draft, bridge or sealed outbox.
  const live = useRef({
    owner,
    scope,
    active,
    visible,
    configured,
    workspace,
    configuration,
    connectionEnabled,
  });
  live.current = {
    owner,
    scope,
    active,
    visible,
    configured,
    workspace,
    configuration,
    connectionEnabled,
  };
  const ownerBridge = useRef<OwnerConsentBridge | null>(null),
    helper = useRef<HelperOwnerBridge | null>(null),
    jobs = useRef(new Set<AbortController>()),
    job = useRef<object | null>(null),
    generation = useRef(0);
  const update = useCallback(
    (apply: (previous: State) => State) => {
      if (owner && live.current.owner === owner)
        setState((previous) => (previous.owner === owner ? apply(previous) : previous));
    },
    [owner],
  );
  const fail = useCallback(
    (error: unknown) => {
      if (fieldError(error) !== "cancelled")
        update((previous) => ({ ...previous, error: fieldError(error) }));
    },
    [update],
  );
  const operation = useCallback(
    async <T>(
      privateRead: boolean,
      action: (context: Context) => Promise<T>,
      allowHidden = false,
    ): Promise<T> => {
      const start = live.current,
        epoch = generation.current,
        controller = new AbortController();
      jobs.current.add(controller);
      let expired = false;
      const assert = () => {
        const now = live.current;
        if (
          controller.signal.aborted ||
          !start.owner ||
          now.owner !== start.owner ||
          !now.configured ||
          !now.active ||
          (!allowHidden && !now.visible) ||
          generation.current !== epoch ||
          (privateRead && (!start.scope || now.scope !== start.scope))
        )
          throw new ConnectionError(expired ? "request_timeout" : "cancelled");
      };
      const timer = window.setTimeout(() => {
        expired = true;
        controller.abort();
      }, 120_000);
      let cancel: (() => void) | undefined;
      const cancellation = new Promise<never>((_resolve, reject) => {
        cancel = () => reject(new ConnectionError(expired ? "request_timeout" : "cancelled"));
        controller.signal.addEventListener("abort", cancel, { once: true });
      });
      try {
        assert();
        return await Promise.race([action({ signal: controller.signal, assert }), cancellation]);
      } finally {
        if (cancel) controller.signal.removeEventListener("abort", cancel);
        controller.abort();
        window.clearTimeout(timer);
        jobs.current.delete(controller);
      }
    },
    [],
  );
  const run = useCallback(
    async (
      privateRead: boolean,
      action: (context: Context) => Promise<void>,
      allowHidden = false,
    ) => {
      if (job.current || !owner || live.current.owner !== owner || !live.current.connectionEnabled)
        return;
      const token = {};
      job.current = token;
      update((previous) => ({ ...previous, busy: true, error: "", notice: "" }));
      try {
        await operation(privateRead, action, allowHidden);
      } catch (error) {
        fail(error);
      } finally {
        if (job.current === token) {
          job.current = null;
          update((previous) => ({ ...previous, busy: false }));
        }
      }
    },
    [owner, operation, update, fail],
  );
  const api = useCallback(
    async (
      service: "agent-hub" | "portfolio" | "user",
      path: string,
      context: Context,
      options: {
        method?: "GET" | "POST" | "PUT";
        json?: unknown;
        headers?: Record<string, string>;
      } = {},
    ) => {
      context.assert();
      const response = await auth.requestPrivate(service, path, owner!, {
        ...options,
        signal: context.signal,
      });
      context.assert();
      if (!response.ok)
        throw new ConnectionError(
          response.status === 409
            ? "version_conflict"
            : response.status === 403
              ? "insufficient_scope"
              : response.status === 401
                ? "session_expired"
                : response.status === 404
                  ? "not_found"
                  : "request_failed",
        );
      if (
        !response.body ||
        response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !==
          "application/json"
      )
        throw new ConnectionError("invalid_response");
      const reader = response.body.getReader(),
        chunks: Uint8Array[] = [];
      let size = 0;
      const cancel = () => {
        void reader.cancel().catch(() => {});
      };
      context.signal.addEventListener("abort", cancel, { once: true });
      try {
        for (;;) {
          const part = await reader.read();
          context.assert();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 1048576) throw new ConnectionError("invalid_response");
          chunks.push(part.value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const part of chunks) {
          bytes.set(part, offset);
          offset += part.length;
        }
        return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
      } catch (error) {
        if (error instanceof ConnectionError) throw error;
        throw new ConnectionError("invalid_response");
      } finally {
        context.signal.removeEventListener("abort", cancel);
        cancel();
        reader.releaseLock();
      }
    },
    [auth.requestPrivate, owner],
  );
  const ownerRequest = useCallback(
    async (op: ConsentOperation, json: unknown, context: Context) => {
      context.assert();
      const bridge = ownerBridge.current;
      if (!bridge?.isLive() || !owner) throw new ConnectionError("invalid_handoff");
      const value = await auth.requestAgentConsent(bridge, op, json, owner, context.signal);
      context.assert();
      return value;
    },
    [auth.requestAgentConsent, owner],
  );
  const summaries = useCallback(
    async (context: Context) => {
      const outbox = await live.current.workspace.listAgentOutbox();
      context.assert();
      update((previous) => ({ ...previous, outbox, scope: live.current.scope }));
    },
    [update],
  );
  const claim = useCallback(
    () =>
      run(false, async (context) => {
        if (!handoff || !live.current.configuration?.hubOrigin)
          throw new ConnectionError("invalid_handoff");
        ownerBridge.current?.close();
        ownerBridge.current = await connectOwnerConsentBridge(
          handoff,
          live.current.configuration.hubOrigin,
          context.signal,
        );
        context.assert();
        const authorization = readPendingAuthorization(
          await ownerRequest("claim", { contractVersion: CONNECTION_CONTRACT }, context),
        );
        if (authorization.status !== "pending" || authorization.prepared !== null)
          throw new ConnectionError("review_required");
        const tasks = taskPage(await api("agent-hub", "/api/v2/tasks?limit=32", context)).filter(
          (task) => task.status === "active",
        );
        context.assert();
        update((previous) => ({
          ...previous,
          authorization,
          tasks,
          stage: "select",
          scopes: authorization.scopes.slice(),
          selected: null,
          content: null,
          scope: live.current.scope,
        }));
      }),
    [run, handoff, ownerRequest, api, update],
  );
  const selectTask = useCallback(
    (taskId: string) =>
      run(true, async (context) => {
        if (
          !current.current.authorization ||
          current.current.registered ||
          current.current.authorization.prepared
        )
          throw new ConnectionError("review_required");
        const packet = encryptedTask(await api("agent-hub", `/api/v2/tasks/${taskId}`, context));
        context.assert();
        if (
          !current.current.tasks.some((task) => task.taskId === taskId) ||
          packet.metadata.taskId !== taskId ||
          packet.metadata.status !== "active"
        )
          throw new ConnectionError("invalid_response");
        await live.current.workspace.refreshVault(context.signal, true);
        context.assert();
        const content = await live.current.workspace.openTask(packet);
        context.assert();
        helper.current?.close();
        helper.current = null;
        update((previous) => ({
          ...previous,
          selected: packet,
          content,
          scope: live.current.scope,
          setupCard: null,
          offer: null,
          offerReview: null,
          keysConfirmed: false,
          replacementConfirmed: false,
          grantConfirmed: false,
          signedGrant: null,
          helperConfirmed: false,
          stage: "keys",
        }));
      }),
    [run, api, update],
  );
  const selectScopes = useCallback(
    (scopes: AgentScope[]) => {
      if (
        !owner ||
        live.current.owner !== owner ||
        !scope ||
        live.current.scope !== scope ||
        !active ||
        !visible ||
        job.current ||
        current.current.authorization?.prepared ||
        scopes.length < 1 ||
        new Set(scopes).size !== scopes.length ||
        scopes.some((s) => !current.current.authorization?.scopes.includes(s))
      )
        return;
      update((previous) => ({
        ...previous,
        scopes: [...scopes],
        grantConfirmed: false,
        signedGrant: null,
        error: "",
      }));
    },
    [owner, scope, active, visible, update],
  );
  const setup = useCallback(
    async (context: Context) => {
      const selected = current.current.selected,
        authorization = current.current.authorization;
      if (!selected || !authorization || authorization.prepared || current.current.registered)
        throw new ConnectionError("selection_required");
      await live.current.workspace.refreshVault(context.signal, true);
      context.assert();
      const anchor = await live.current.workspace.publicAgentAnchor({
        connectionId: authorization.connectionId,
        agentPrincipalId: nonceId("agent"),
        taskId: selected.metadata.taskId,
      });
      context.assert();
      const card: SetupCard = {
        helperVersion: HELPER_VERSION,
        workerSha256: HELPER_WORKER_SHA256,
        anchor,
        ttlSeconds: 900,
      };
      update((previous) => ({
        ...previous,
        setupCard: card,
        scope: live.current.scope,
        offer: null,
        offerReview: null,
        keysConfirmed: false,
        replacementConfirmed: false,
        helperConfirmed: false,
      }));
      return card;
    },
    [update],
  );
  const acceptOffer = useCallback(
    async (offer: unknown, card: SetupCard, context: Context) => {
      if (
        !exact(offer, [
          "helperVersion",
          "sessionId",
          "generation",
          "anchor",
          "agentSigningPublicJwk",
          "agentEncryptionPublicJwk",
          "agentSigningKeyId",
          "agentEncryptionKeyId",
          "keyExportRejected",
        ]) ||
        !equalJSON(offer.anchor, card.anchor)
      )
        throw new ConnectionError("invalid_response");
      const review = await live.current.workspace.inspectAgentOffer({
        offer: offer as HelperPublicOffer,
      });
      context.assert();
      update((previous) => ({
        ...previous,
        offer: offer as HelperPublicOffer,
        offerReview: review,
        keysConfirmed: false,
        replacementConfirmed: false,
        scope: live.current.scope,
        notice: "offer_received",
      }));
    },
    [update],
  );
  const createManualCard = useCallback(
    () =>
      run(true, async (context) => {
        helper.current?.close();
        helper.current = null;
        await setup(context);
        update((previous) => ({ ...previous, mode: "manual" }));
      }),
    [run, setup, update],
  );
  const pairHelper = useCallback(() => {
    if (
      !owner ||
      live.current.owner !== owner ||
      !scope ||
      live.current.scope !== scope ||
      !live.current.configuration?.hubOrigin ||
      !live.current.connectionEnabled ||
      job.current
    )
      return Promise.resolve();
    // Open synchronously from the click; initialization transfers only a public anchor.
    const opening = openHelperOwnerBridge(live.current.configuration.hubOrigin);
    let adopted = false;
    return run(
      true,
      async (context) => {
        helper.current?.close();
        helper.current = null;
        const card = await setup(context),
          paired = await opening;
        context.assert();
        helper.current = paired;
        const offer = await paired.request("initialize", card, context.signal);
        context.assert();
        await acceptOffer(offer, card, context);
        adopted = true;
        update((previous) => ({ ...previous, mode: "paired" }));
      },
      true,
    ).finally(() => {
      void opening
        .then((paired) => {
          if (!adopted) {
            if (helper.current === paired) helper.current = null;
            paired.close();
          }
        })
        .catch(() => {});
    });
  }, [owner, scope, run, setup, acceptOffer, update]);
  const importOffer = useCallback(
    (text: string) =>
      run(true, async (context) => {
        const card = current.current.setupCard;
        if (!card || new TextEncoder().encode(text).length > 16384)
          throw new ConnectionError("invalid_response");
        let value: unknown;
        try {
          value = JSON.parse(text);
        } catch {
          throw new ConnectionError("invalid_response");
        }
        await acceptOffer(value, card, context);
      }),
    [run, acceptOffer],
  );
  const confirmKeys = useCallback(
    (checked: boolean, replacement: boolean) => {
      if (
        !owner ||
        live.current.owner !== owner ||
        !scope ||
        live.current.scope !== scope ||
        !active ||
        !visible ||
        job.current ||
        !current.current.offer
      )
        return;
      update((previous) => ({
        ...previous,
        keysConfirmed: checked,
        replacementConfirmed: replacement,
        error: "",
      }));
    },
    [owner, scope, active, visible, update],
  );
  const registrationSaved = useCallback(
    async (packet: AgentRegistration, context: Context) => {
      await live.current.workspace.refreshVault(context.signal, true);
      context.assert();
      const review = await live.current.workspace.inspectAgentOffer({ offer: packet.offer });
      context.assert();
      if (
        !equalJSON(
          review.existingConnectionKeyIds.slice().sort(),
          [packet.offer.agentSigningKeyId, packet.offer.agentEncryptionKeyId].sort(),
        )
      )
        throw new ConnectionError("version_conflict");
      await live.current.workspace.clearAgentRegistration(
        packet.offer.anchor.connectionId,
        packet.offer.anchor.taskId,
        packet.operationId,
      );
      context.assert();
      update((previous) => ({
        ...previous,
        offer: packet.offer,
        offerReview: review,
        registered: true,
        pendingRegistration: null,
        stage: "registered",
        scope: live.current.scope,
        notice: "keys_registered",
      }));
      await summaries(context);
    },
    [update, summaries],
  );
  const sendRegistration = useCallback(
    async (packet: AgentRegistration, context: Context) => {
      await api("agent-hub", `/api/v2/vaults/${packet.offer.anchor.vaultId}/registry`, context, {
        method: "PUT",
        json: {
          contractVersion: CONNECTION_CONTRACT,
          expectedVersion: packet.expectedVersion,
          registryBundle: packet.registryBundle,
        },
        headers: { "Idempotency-Key": packet.operationId },
      });
      context.assert();
      await registrationSaved(packet, context);
    },
    [api, registrationSaved],
  );
  const registerKeys = useCallback(
    () =>
      run(true, async (context) => {
        const snapshot = current.current;
        if (
          !snapshot.offer ||
          !snapshot.offerReview ||
          !snapshot.keysConfirmed ||
          (!snapshot.offerReview.registered &&
            snapshot.offerReview.existingConnectionKeyIds.length > 0 &&
            !snapshot.replacementConfirmed)
        )
          throw new ConnectionError("confirmation_required");
        await live.current.workspace.refreshVault(context.signal, true);
        context.assert();
        const currentReview = await live.current.workspace.inspectAgentOffer({
          offer: snapshot.offer,
        });
        context.assert();
        if (!equalJSON(currentReview, snapshot.offerReview)) {
          update((previous) => ({
            ...previous,
            offerReview: currentReview,
            keysConfirmed: false,
            replacementConfirmed: false,
          }));
          throw new ConnectionError("review_required");
        }
        if (currentReview.registered) {
          update((previous) => ({
            ...previous,
            registered: true,
            stage: "registered",
            notice: "keys_registered",
          }));
          return;
        }
        const existing = await live.current.workspace.loadAgentRegistration(
          snapshot.offer.anchor.connectionId,
          snapshot.offer.anchor.taskId,
        );
        context.assert();
        if (existing) {
          update((previous) => ({ ...previous, pendingRegistration: existing }));
          throw new ConnectionError("pending_agent_operation");
        }
        const packet = await live.current.workspace.prepareAgentRegistration({
          offer: snapshot.offer,
          ttlSeconds: 900,
          ...(snapshot.offerReview.existingConnectionKeyIds.length
            ? { replaceKeyIds: snapshot.offerReview.existingConnectionKeyIds }
            : {}),
        });
        context.assert();
        update((previous) => ({ ...previous, pendingRegistration: packet }));
        await sendRegistration(packet, context);
      }),
    [run, update, sendRegistration],
  );
  const prepareGrant = useCallback(
    () =>
      run(true, async (context) => {
        const snapshot = current.current;
        if (
          !snapshot.authorization ||
          !snapshot.selected ||
          !snapshot.offer ||
          !snapshot.registered ||
          snapshot.authorization.prepared
        )
          throw new ConnectionError("selection_required");
        const task = encryptedTask(
          await api("agent-hub", `/api/v2/tasks/${snapshot.selected.metadata.taskId}`, context),
        );
        context.assert();
        if (!equalJSON(task.metadata, snapshot.selected.metadata))
          throw new ConnectionError("review_required");
        const authorization = readPendingAuthorization(
          await ownerRequest(
            "prepare_encrypted",
            {
              contractVersion: CONNECTION_CONTRACT,
              taskIds: [task.metadata.taskId],
              connectionId: null,
              approvedScopes: snapshot.scopes,
              historyPolicy: "selected",
            },
            context,
          ),
        );
        context.assert();
        if (
          !authorization.prepared ||
          authorization.prepared.tasks.length !== 1 ||
          authorization.connectionId !== snapshot.offer.anchor.connectionId ||
          authorization.prepared.taskIds[0] !== task.metadata.taskId
        )
          throw new ConnectionError("invalid_response");
        update((previous) => ({
          ...previous,
          authorization,
          grantConfirmed: false,
          stage: "grant",
          signedGrant: null,
        }));
      }),
    [run, api, ownerRequest, update],
  );
  const confirmGrant = useCallback(
    (checked: boolean) => {
      if (
        !job.current &&
        owner &&
        live.current.owner === owner &&
        scope &&
        live.current.scope === scope &&
        active &&
        visible
      )
        update((previous) => ({ ...previous, grantConfirmed: checked }));
    },
    [owner, scope, active, visible, update],
  );
  const reconcileApproval = useCallback(
    async (packet: AgentApprovalPacket, context: Context) => {
      const authorization = readPendingAuthorization(packet.authorization),
        selected = authorization.prepared?.tasks[0];
      if (!selected || authorization.prepared?.tasks.length !== 1)
        throw new ConnectionError("invalid_response");
      const connections = readConnectionList(
        await api("agent-hub", "/api/v2/agent-connections", context),
      );
      context.assert();
      const connection = connections.items.find(
          (item) => item.connectionId === authorization.connectionId,
        ),
        grant = connection?.grants.find((item) => item.grantId === selected.grantId);
      if (
        !connection ||
        connection.status !== "active" ||
        connection.authorizationId !== authorization.authorizationId ||
        !equalJSON(
          connection.approvedScopes.slice().sort(),
          authorization.prepared!.approvedScopes.slice().sort(),
        ) ||
        !grant ||
        grant.status !== "active" ||
        !grant.signedGrantPresent ||
        grant.taskId !== selected.taskId ||
        grant.taskVersion !== selected.taskVersion ||
        grant.executionEpoch !== selected.executionEpoch ||
        grant.grantEpoch !== selected.grantEpoch ||
        !equalJSON(grant.resourceBindings, selected.resourceBindings)
      )
        throw new ConnectionError("outcome_unknown");
      const task = encryptedTask(
        await api(
          "agent-hub",
          `/api/v2/tasks/${selected.taskId}/versions/${selected.taskVersion}`,
          context,
        ),
      );
      context.assert();
      if (
        task.metadata.taskId !== selected.taskId ||
        task.metadata.taskVersion !== selected.taskVersion
      )
        throw new ConnectionError("invalid_response");
      const content = await live.current.workspace.openTask(task);
      context.assert();
      update((previous) => ({
        ...previous,
        authorization,
        selected: task,
        content,
        offer: packet.offer,
        signedGrant: packet,
        stage: "approved",
        scope: live.current.scope,
        decisionSent: true,
        grantConfirmed: false,
        notice: "approval_recorded",
      }));
      await summaries(context);
    },
    [api, update, summaries],
  );
  const approve = useCallback(
    () =>
      run(true, async (context) => {
        const snapshot = current.current;
        if (
          snapshot.decisionSent ||
          !snapshot.authorization?.prepared ||
          !snapshot.selected ||
          !snapshot.offer ||
          !snapshot.grantConfirmed
        )
          throw new ConnectionError("confirmation_required");
        await live.current.workspace.refreshVault(context.signal, true);
        context.assert();
        const existing = await live.current.workspace.loadAgentApproval(
          snapshot.authorization.connectionId,
          snapshot.selected.metadata.taskId,
        );
        context.assert();
        if (existing) throw new ConnectionError("pending_agent_operation");
        const signedGrant = await live.current.workspace.signAgentGrants({
          authorization: snapshot.authorization,
          tasks: [snapshot.selected],
          offer: snapshot.offer,
        });
        context.assert();
        update((previous) => ({
          ...previous,
          signedGrant,
          decisionSent: true,
          grantConfirmed: false,
        }));
        try {
          const done = await ownerRequest(
            "decision",
            {
              contractVersion: CONNECTION_CONTRACT,
              decision: "approve",
              signedGrants: signedGrant.signedGrants,
            },
            context,
          );
          context.assert();
          if (!exact(done, ["completed"]) || done.completed !== true)
            throw new ConnectionError("invalid_response");
        } catch (error) {
          context.assert();
          await summaries(context);
          throw new ConnectionError("outcome_unknown");
        }
        ownerBridge.current?.close();
        ownerBridge.current = null;
        await reconcileApproval(signedGrant, context);
      }),
    [run, ownerRequest, update, summaries, reconcileApproval],
  );
  const deny = useCallback(
    (decision: "deny" | "cancel") =>
      run(false, async (context) => {
        const done = await ownerRequest(
          "decision",
          { contractVersion: CONNECTION_CONTRACT, decision, signedGrants: [] },
          context,
        );
        if (!exact(done, ["completed"]) || done.completed !== true)
          throw new ConnectionError("invalid_response");
        ownerBridge.current?.close();
        ownerBridge.current = null;
        helper.current?.close();
        helper.current = null;
        update((previous) => ({
          ...previous,
          stage: "closed",
          selected: null,
          content: null,
          signedGrant: null,
          offer: null,
          helperConfirmed: false,
          notice: decision,
        }));
      }),
    [run, ownerRequest, update],
  );
  const collectSources = useCallback(
    async (
      authorization: PendingAuthorization,
      context: Context,
    ): Promise<AgentPreparationSource[]> => {
      const selected = authorization.prepared?.tasks[0].selectedResourceVersions;
      if (!selected) throw new ConnectionError("invalid_response");
      if (selected.length === 0) return [];
      const before = readResourceCatalogue(
        await api("agent-hub", "/api/v2/resources/catalogue", context),
      );
      const row = (catalogue: ResourceCatalogue, ref: unknown): ResourceItem | undefined =>
        catalogue.groups
          .flatMap((group) => group.items)
          .find((item) => item.ref && sourceKey(item.ref) === sourceKey(ref));
      const sources: AgentPreparationSource[] = [];
      for (const source of selected) {
        context.assert();
        const first = row(before, source.ref);
        if (
          !first ||
          !["active", "ready", "empty"].includes(first.state) ||
          first.sourceEpoch !== source.sourceEpoch ||
          first.revision !== source.revision
        )
          throw new ConnectionError("source_unavailable");
        if (source.ref.kind === "holdings") {
          if (!source.producerSnapshotId) throw new ConnectionError("source_unavailable");
          const authority = await api(
            "agent-hub",
            "/api/v2/vaults/current/authority-token",
            context,
            { method: "POST", json: { contractVersion: CONNECTION_CONTRACT } },
          );
          if (
            !authority ||
            typeof authority !== "object" ||
            !("token" in authority) ||
            typeof authority.token !== "string" ||
            authority.token.length > 16384
          )
            throw new ConnectionError("invalid_response");
          await api(
            "portfolio",
            `/api/v2/holdings/sources/${source.ref.resourceId}/authority-sync`,
            context,
            {
              method: "POST",
              json: { contractVersion: CONNECTION_CONTRACT },
              headers: { "X-FolioView-Authority-Delegation": authority.token },
            },
          );
          const snapshot = await api(
            "portfolio",
            `/api/v2/holdings/sources/${source.ref.resourceId}/snapshots/${source.producerSnapshotId}`,
            context,
          );
          if (
            !exact(snapshot, ["contractVersion", "carrier", "keyProofs", "receipt"]) ||
            snapshot.contractVersion !== CONNECTION_CONTRACT
          )
            throw new ConnectionError("invalid_response");
          sources.push({
            kind: "holdings",
            ref: source.ref as AgentPreparationSource["ref"] & {
              kind: "holdings";
              sourceService: "portfolio";
            },
            sourceEpoch: source.sourceEpoch,
            revision: source.revision,
            snapshot: snapshot as any,
          });
        } else {
          const raw = await api(
            "user",
            source.ref.kind === "watchlist" ? "/api/v1/watchlist" : "/api/v1/channel-follows",
            context,
          );
          const response =
            source.ref.kind === "watchlist" ? readResourceWatchlist(raw) : readChannelFollows(raw);
          if (
            source.ref.kind === "channel_follows" &&
            (response as { revision?: number }).revision !== source.revision
          )
            throw new ConnectionError("source_unavailable");
          sources.push({
            kind: source.ref.kind,
            ref: source.ref,
            sourceEpoch: source.sourceEpoch,
            revision: source.revision,
            fetchedAt: new Date().toISOString(),
            sourceAsOf: null,
            response: response as any,
          });
        }
      }
      const after = readResourceCatalogue(
        await api("agent-hub", "/api/v2/resources/catalogue", context),
      );
      context.assert();
      for (const source of selected)
        if (!equalJSON(row(before, source.ref), row(after, source.ref)))
          throw new ConnectionError("source_unavailable");
      return sources;
    },
    [api],
  );
  const sendPreparation = useCallback(
    async (packet: AgentPreparationPacket, context: Context) => {
      const base = `/api/v2/agent-connections/${packet.connectionId}/tasks/${packet.taskId}`;
      for (const object of packet.objects) {
        const ack = await api(
          "agent-hub",
          `${base}/preparation/objects/${object.objectId}`,
          context,
          {
            method: "PUT",
            json: { contractVersion: CONNECTION_CONTRACT, envelope: object.envelope },
            headers: {
              "Idempotency-Key": object.operationId,
              "X-FolioView-Author-Key": object.authorKeyId,
            },
          },
        );
        if (
          !ack ||
          typeof ack !== "object" ||
          !("objectId" in ack) ||
          ack.objectId !== object.objectId
        )
          throw new ConnectionError("invalid_response");
        verifyPreparationDescriptor(ack, packet);
      }
      const saved = readPreparationCommit(
        await api("agent-hub", `${base}/preparation/commit`, context, {
          method: "POST",
          json: packet.commit.body,
          headers: { "Idempotency-Key": packet.commit.operationId },
        }),
        packet.preparationId,
      );
      verifyPreparationObjects(saved.objects, packet);
      context.assert();
      const fresh = readPreparationIntent(
        await api("agent-hub", `${base}/preparation-intent`, context),
      );
      if (fresh.status !== "committed" || fresh.preparationId !== packet.preparationId)
        throw new ConnectionError("invalid_response");
      verifyPreparationObjects(fresh.objects, packet);
      let helperConfirmed = false;
      if (helper.current?.isLive()) {
        const status = await helper.current.request(
          "confirm_delivery",
          { pin: packet.deliveryPin },
          context.signal,
        );
        context.assert();
        if (!helperReady(status) || status.independentDeliveryConfirmed !== true)
          throw new ConnectionError("helper_unavailable");
        helperConfirmed = true;
        await live.current.workspace.clearAgentPreparation(
          packet.connectionId,
          packet.taskId,
          packet.commit.operationId,
        );
        context.assert();
        const approval = await live.current.workspace.loadAgentApproval(
          packet.connectionId,
          packet.taskId,
        );
        context.assert();
        if (approval) {
          await live.current.workspace.clearAgentApproval(
            packet.connectionId,
            packet.taskId,
            approval.operationId,
          );
          context.assert();
        }
      }
      // Manual handoff retains the sealed packet and independent pin until explicit cleanup.
      update((previous) => ({
        ...previous,
        published: packet,
        pendingPreparation: helperConfirmed ? null : packet,
        stage: "published",
        helperConfirmed,
        notice: helperConfirmed ? "published_paired" : "published_manual",
      }));
      await summaries(context);
    },
    [api, update, summaries],
  );
  const publish = useCallback(
    () =>
      run(true, async (context) => {
        const snapshot = current.current;
        if (
          snapshot.stage !== "approved" ||
          !snapshot.authorization ||
          !snapshot.selected ||
          !snapshot.signedGrant
        )
          throw new ConnectionError("selection_required");
        if (snapshot.mode === null || (snapshot.mode === "paired" && !helper.current?.isLive()))
          throw new ConnectionError("helper_unavailable");
        await live.current.workspace.refreshVault(context.signal, true);
        context.assert();
        const pending = await live.current.workspace.loadAgentPreparation(
          snapshot.authorization.connectionId,
          snapshot.selected.metadata.taskId,
        );
        context.assert();
        if (pending) {
          update((previous) => ({ ...previous, pendingPreparation: pending }));
          throw new ConnectionError("pending_agent_operation");
        }
        const intent = readPreparationIntent(
          await api(
            "agent-hub",
            `/api/v2/agent-connections/${snapshot.authorization.connectionId}/tasks/${snapshot.selected.metadata.taskId}/preparation-intent`,
            context,
          ),
        );
        if (intent.status !== "staging") throw new ConnectionError("version_conflict");
        const sources = await collectSources(snapshot.authorization, context);
        context.assert();
        const packet = await live.current.workspace.sealAgentPreparation({
          intent,
          task: snapshot.selected,
          signedGrant: snapshot.signedGrant.signedGrants[0],
          sources,
        });
        context.assert();
        update((previous) => ({ ...previous, pendingPreparation: packet }));
        await sendPreparation(packet, context);
      }),
    [run, api, collectSources, update, sendPreparation],
  );
  const recover = useCallback(
    (entry: Outbox) =>
      run(true, async (context) => {
        await live.current.workspace.refreshVault(context.signal, true);
        context.assert();
        if (entry.kind === "approval") {
          const packet = await live.current.workspace.loadAgentApproval(
            entry.connectionId,
            entry.taskId,
          );
          context.assert();
          if (!packet || packet.operationId !== entry.operationId)
            throw new ConnectionError("not_found");
          await reconcileApproval(packet, context);
        } else if (entry.kind === "registration") {
          const packet = await live.current.workspace.loadAgentRegistration(
            entry.connectionId,
            entry.taskId,
          );
          context.assert();
          if (!packet || packet.operationId !== entry.operationId)
            throw new ConnectionError("not_found");
          update((previous) => ({ ...previous, pendingRegistration: packet }));
          await sendRegistration(packet, context);
        } else {
          const packet = await live.current.workspace.loadAgentPreparation(
            entry.connectionId,
            entry.taskId,
          );
          context.assert();
          if (!packet || packet.commit.operationId !== entry.operationId)
            throw new ConnectionError("not_found");
          const liveConnections = readConnectionList(
            await api("agent-hub", "/api/v2/agent-connections", context),
          );
          context.assert();
          const connection = liveConnections.items.find(
              (item) => item.connectionId === packet.connectionId,
            ),
            grant = connection?.grants.find((item) => item.grantId === packet.deliveryPin.grantId);
          if (
            !connection ||
            connection.status !== "active" ||
            connection.authorizationId !== packet.deliveryPin.authorizationId ||
            !grant ||
            grant.status !== "active" ||
            !grant.signedGrantPresent ||
            grant.taskId !== packet.taskId ||
            grant.taskVersion !== packet.deliveryPin.taskVersion ||
            grant.grantEpoch !== packet.deliveryPin.grantEpoch ||
            grant.executionEpoch !== packet.deliveryPin.executionEpoch
          )
            throw new ConnectionError("insufficient_scope");
          update((previous) => ({ ...previous, pendingPreparation: packet }));
          await sendPreparation(packet, context);
        }
      }),
    [run, update, sendRegistration, sendPreparation, reconcileApproval, api],
  );
  const discardPending = useCallback(
    (entry: Outbox) =>
      run(true, async (context) => {
        if (entry.kind === "approval")
          await live.current.workspace.clearAgentApproval(
            entry.connectionId,
            entry.taskId,
            entry.operationId,
          );
        else if (entry.kind === "registration")
          await live.current.workspace.clearAgentRegistration(
            entry.connectionId,
            entry.taskId,
            entry.operationId,
          );
        else
          await live.current.workspace.clearAgentPreparation(
            entry.connectionId,
            entry.taskId,
            entry.operationId,
          );
        context.assert();
        update((previous) => ({
          ...previous,
          pendingRegistration: null,
          pendingPreparation: null,
          notice: "pending_discarded",
        }));
        await summaries(context);
      }),
    [run, update, summaries],
  );
  const confirmOriginalHelper = useCallback(() => {
    if (
      !owner ||
      live.current.owner !== owner ||
      !scope ||
      live.current.scope !== scope ||
      !active ||
      !visible ||
      job.current ||
      current.current.stage !== "approved" ||
      current.current.mode !== null ||
      !current.current.signedGrant
    )
      return;
    update((previous) => ({ ...previous, mode: "manual", notice: "original_helper_required" }));
  }, [owner, scope, active, visible, update]);
  const lockHelper = useCallback(() => {
    helper.current?.close();
    helper.current = null;
    update((previous) => ({ ...previous, helperConfirmed: false, notice: "helper_locked" }));
  }, [update]);
  useEffect(() => {
    const change = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
  useEffect(() => {
    ++generation.current;
    for (const request of jobs.current) request.abort();
    jobs.current.clear();
    job.current = null;
    ownerBridge.current?.close();
    ownerBridge.current = null;
    helper.current?.close();
    helper.current = null;
    setState(initial(owner));
    return () => {
      ++generation.current;
      for (const request of jobs.current) request.abort();
      ownerBridge.current?.close();
      helper.current?.close();
    };
  }, [owner, configured, configuration?.hubOrigin]);
  useEffect(() => {
    for (const request of jobs.current) request.abort();
    job.current = null;
    helper.current?.close();
    helper.current = null;
    update((previous) => ({
      ...previous,
      scope: null,
      selected: null,
      content: null,
      offer: null,
      offerReview: null,
      setupCard: null,
      signedGrant: null,
      published: null,
      helperConfirmed: false,
      busy: false,
      registered: false,
      keysConfirmed: false,
      replacementConfirmed: false,
      grantConfirmed: false,
    }));
    if (scope && active && visible) void operation(true, summaries).catch(fail);
  }, [scope, configuration?.hubOrigin, operation, summaries, fail, update]);
  useEffect(() => {
    // This public-only heartbeat keeps the paired owner lease while a popup is focused.
    // It never fetches a Firebase credential or performs content/private-key operations.
    const timer = window.setInterval(() => {
      const now = live.current,
        paired = helper.current;
      if (!now.owner || !now.scope || !now.configured || !paired?.isLive()) return;
      void paired
        .request("status", {})
        .then((status) => {
          if (helper.current !== paired) return;
          if (!helperReady(status)) {
            paired.close();
            helper.current = null;
            update((previous) => ({
              ...previous,
              helperConfirmed: false,
              notice: "helper_locked",
            }));
          }
        })
        .catch((error) => {
          if (fieldError(error) === "request_busy") return;
          if (helper.current === paired) {
            paired.close();
            helper.current = null;
            update((previous) => ({
              ...previous,
              helperConfirmed: false,
              notice: "helper_locked",
            }));
          }
        });
    }, 25_000);
    return () => window.clearInterval(timer);
  }, [owner, scope, configured, update]);
  useEffect(
    () => () => {
      for (const request of jobs.current) request.abort();
      ownerBridge.current?.close();
      helper.current?.close();
    },
    [],
  );
  const display = state.owner === owner ? state : initial(owner),
    privateVisible = Boolean(
      owner && configured && active && visible && scope && display.scope === scope,
    );
  return {
    ...(privateVisible
      ? display
      : {
          ...display,
          selected: null,
          content: null,
          setupCard: null,
          offer: null,
          offerReview: null,
          signedGrant: null,
          published: null,
          pendingRegistration: null,
          pendingPreparation: null,
          outbox: [],
          keysConfirmed: false,
          replacementConfirmed: false,
          grantConfirmed: false,
        }),
    owner,
    configured,
    unlocked: Boolean(scope),
    hasHandoff: Boolean(handoff),
    canWrite: Boolean(scope && workspace.canWriteState && connectionEnabled),
    claim,
    selectTask,
    selectScopes,
    pairHelper,
    createManualCard,
    importOffer,
    confirmKeys,
    registerKeys,
    prepareGrant,
    confirmGrant,
    approve,
    deny,
    publish,
    recover,
    discardPending,
    lockHelper,
    confirmOriginalHelper,
  };
}
export type AgentConsentModel = ReturnType<typeof useAgentConsent>;
