/** Owner orchestration: current permissions and task assignment never come from OAuth. */
import {
  readResourceCatalogue,
  readResourceWatchlist,
  readChannelFollows,
} from "./resource-library";
import { taskMetadata, taskPage } from "./task-types";
import type { HoldingsWorkspace } from "../components/useHoldingsWorkspace";
export const PERSISTENT_CONTRACT = "folioview.agent-workspace.v2.0";
export const DEFAULT_CONNECTION_SECONDS = 7776000;
export const TEMPORARY_CONNECTION_SECONDS = 900;
function credentialLifetime(packet: Json) {
  const seconds = Object.hasOwn(packet, "credentialLifetimeSeconds")
    ? packet.credentialLifetimeSeconds
    : DEFAULT_CONNECTION_SECONDS;
  if (![DEFAULT_CONNECTION_SECONDS, TEMPORARY_CONNECTION_SECONDS].includes(seconds))
    fail("verification_failed");
  return seconds as number;
}
type Json = Record<string, any>;
export type PersistentConnection = {
  connectionId: string;
  clientId: string;
  vaultId: string;
  provider: "muse" | "chatgpt";
  status: "active" | "revoked";
  accountState: string;
  linkedAt: number;
};
export type PersistentTask = {
  taskId: string;
  title: string;
  packet: Json;
  content: Json;
  authority: Json;
  plan: Json | null;
};
export type PersistentConnectionView = {
  connection: PersistentConnection;
  identity: Json | null;
  policy: Json | null;
  tasks: PersistentTask[];
  pending: boolean;
  error: string;
  credential?: Json | null;
};
export class PersistentExperienceError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
const fail = (code: string): never => {
  throw new PersistentExperienceError(code);
};
// JSON object property order is not authority. Hub history snapshots sort their
// keys, while current descriptors may retain construction order. Arrays, field
// sets and every nested value must still match exactly before restoring scope.
const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => same(v, b[i]))
    );
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && same((a as Json)[key], (b as Json)[key]))
  );
};
const sourceKey = (r: Json) =>
  JSON.stringify([r.kind, r.sourceService, r.resourceId, r.incarnation]);
export type PersistentApi = (
  service: "agent-hub" | "portfolio" | "user",
  path: string,
  options?: {
    method?: "GET" | "POST" | "PUT" | "PATCH";
    json?: unknown;
    headers?: Record<string, string>;
  },
) => Promise<any>;
export class PersistentExperienceController {
  constructor(
    private readonly api: PersistentApi,
    private readonly workspace: () => HoldingsWorkspace,
    private readonly assert: () => void,
    private readonly signal: AbortSignal,
    private readonly hubOrigin = "",
  ) {}
  private async request(path: string, options: Parameters<PersistentApi>[2] = {}) {
    this.assert();
    const v = await this.api("agent-hub", path, options);
    this.assert();
    return v;
  }
  private vault() {
    this.assert();
    const w = this.workspace();
    if (w.phase !== "unlocked" || !w.vault) fail("unlock_required");
    return w.vault!;
  }
  private actor(connection: PersistentConnection) {
    if (connection.vaultId !== this.vault().vaultId || connection.status !== "active")
      fail("connection_unavailable");
    return { connectionId: connection.connectionId, clientId: connection.clientId };
  }
  private base(connection: PersistentConnection) {
    this.actor(connection);
    return `/api/v2/persistent-agents/${connection.vaultId}/${connection.connectionId}`;
  }
  private control(context: Json) {
    const { actor, identityState, resourceState, receipts } = context;
    return { actor, identityState, resourceState, receipts };
  }
  private async context(connection: PersistentConnection) {
    const actor = this.actor(connection),
      base = this.base(connection);
    const identityState = await this.request(base),
      resourceState = await this.request(base + "/resource-consent");
    const receipts = [];
    for (const op of resourceState.operations)
      receipts.push(await this.request(base + "/resource-operations/" + op));
    const policy = await this.workspace().verifyPersistentPolicy({
      actor,
      identityState,
      resourceState,
      receipts,
    });
    this.assert();
    return { actor, identityState, resourceState, receipts, policy };
  }
  async send(connection: PersistentConnection, packet: Json) {
    if (packet.kind === "no_change") return;
    if (!["credential", "consent", "revocation", "publication"].includes(packet.kind))
      fail("verification_failed");
    const actor = this.actor(connection),
      v = this.vault(),
      base = this.base(connection);
    if (packet.connectionId !== connection.connectionId) fail("verification_failed");
    const publication = packet.kind === "publication",
      credential = packet.kind === "credential";
    const receiptPath =
      credential && packet.providerActivation
        ? `/api/v3/provider-connections/${v.vaultId}/${packet.providerActivation.provider}/operations/${packet.operationId}`
        : credential
          ? `/api/v3/agent-credentials/${v.vaultId}/${connection.connectionId}/operations/${packet.operationId}`
          : publication
            ? `/api/v2/persistent-content/${v.vaultId}/connections/${connection.connectionId}/operations/${packet.operationId}`
            : base +
              (packet.kind === "identity" ? "/operations/" : "/resource-operations/") +
              packet.operationId;
    let receipt: Json | null = null;
    try {
      receipt = await this.request(receiptPath);
    } catch (e) {
      if (!(e instanceof PersistentExperienceError) || e.code !== "not_found") throw e;
    }
    if (!receipt) {
      if (credential && packet.registryUpdate) {
        await this.workspace().refreshVault(this.signal, true);
        this.assert();
        const fresh = (await this.request("/api/v2/vaults/current")).vault,
          update = packet.registryUpdate;
        if (fresh.version === update.expectedVersion) {
          await this.request(`/api/v2/vaults/${v.vaultId}/registry`, {
            method: "PUT",
            json: { contractVersion: PERSISTENT_CONTRACT, ...update },
            headers: { "Idempotency-Key": "directory_" + packet.operationId },
          });
          await this.workspace().refreshVault(this.signal, true);
          this.assert();
        } else if (!same(fresh.registryHistory.at(-1), update.registryBundle))
          fail("version_conflict");
      }
      const path =
        credential && packet.providerActivation
          ? `/api/v3/provider-connections/${v.vaultId}/${packet.providerActivation.provider}/commands`
          : credential
            ? `/api/v3/agent-credentials/${v.vaultId}/${connection.connectionId}/approvals`
            : publication
              ? `/api/v2/persistent-content/${v.vaultId}/connections/${connection.connectionId}/publications`
              : base +
                (
                  {
                    identity: "/bindings",
                    consent: "/resource-approvals",
                    revocation: "/resource-revocations",
                  } as Record<string, string>
                )[packet.kind];
      if (!path) fail("verification_failed");
      receipt = await this.request(path, {
        method: "POST",
        json: packet.providerActivation?.body ?? packet.body,
        headers: { "Idempotency-Key": packet.operationId },
      });
    }
    await this.workspace().finishPersistentPending(actor, receipt);
    this.assert();
  }
  async resume(connection: PersistentConnection) {
    const actor = this.actor(connection),
      pending = await this.workspace().loadPersistentPending(actor);
    this.assert();
    if (
      pending?.kind === "publication" &&
      pending.context?.registrySequence < this.vault().registryHistory.length
    ) {
      // A committed original always wins, even if the directory has since advanced.
      let receipt: Json | null = null;
      try {
        receipt = await this.request(
          `/api/v2/persistent-content/${connection.vaultId}/connections/${connection.connectionId}/operations/${pending.operationId}`,
        );
      } catch (e) {
        if (!(e instanceof PersistentExperienceError) || e.code !== "not_found") throw e;
      }
      if (receipt) {
        await this.workspace().finishPersistentPending(actor, receipt);
        this.assert();
        return;
      }
      const current = await this.request(this.credentialBase(connection));
      const archived = await this.workspace().archiveSupersededPersistentPublication({
        actor,
        current,
        hubOrigin: this.hubOrigin,
        expectedOperationId: pending.operationId,
        expectedFingerprint: pending.fingerprint,
      });
      this.assert();
      if (archived) return;
    }
    if (pending) await this.send(connection, pending);
  }
  private credentialBase(connection: PersistentConnection) {
    this.actor(connection);
    return `/api/v3/agent-credentials/${connection.vaultId}/${connection.connectionId}`;
  }
  async credential(connection: PersistentConnection) {
    const state = await this.request(this.credentialBase(connection));
    return this.inspectCredential(connection, state);
  }
  async inspectCredential(connection: PersistentConnection, state: Json) {
    this.assert();
    const verified = await this.workspace().inspectAgentCredential({
      actor: this.actor(connection),
      state,
      hubOrigin: this.hubOrigin,
    });
    this.assert();
    return { state, verified };
  }
  async restorationSources(
    connection: PersistentConnection,
    sourceConnection: string | null = null,
  ) {
    const base = this.credentialBase(connection),
      lookup = sourceConnection ?? connection.connectionId;
    const head = await this.request(
      `/api/v3/agent-credentials/${connection.vaultId}/${lookup}/restoration`,
    );
    const result: Json[] = [],
      seen = new Set<string>();
    let ref = head.source;
    while (ref !== null) {
      const key = ref.connectionId + ":" + ref.bindingFingerprint;
      if (seen.has(key) || result.length >= 32) fail("invalid_response");
      seen.add(key);
      const state = await this.request(
        `${base}/restoration/${ref.connectionId}/${ref.bindingFingerprint}`,
      );
      if (!same(state.source, ref)) fail("invalid_response");
      const receipts = [];
      for (const operation of state.resourceState.operations)
        receipts.push(
          await this.request(
            `/api/v2/persistent-agents/${connection.vaultId}/${ref.connectionId}/resource-operations/${operation}`,
          ),
        );
      result.push({ state, receipts });
      ref = state.predecessor;
    }
    return result;
  }
  private async restorationScope(
    connection: PersistentConnection,
    current: Json,
    sources: Json[],
    legacyConnectionId: string | null = null,
  ) {
    const scope = await this.workspace().verifyAgentRestoration({
      actor: this.actor(connection),
      current,
      sources,
      hubOrigin: this.hubOrigin,
      legacyConnectionId,
    });
    this.assert();
    return scope;
  }
  private matchingAuthority(task: PersistentTask, identities: Json[]) {
    const c = task.authority.authority?.context;
    return (
      !!c &&
      identities.some(
        (identity) =>
          c.connectionId === identity.connectionId &&
          c.bindingFingerprint === identity.bindingFingerprint,
      )
    );
  }
  async inspectAuthorization(handoff: Json) {
    if (handoff.issuer !== this.hubOrigin || handoff.vaultId !== this.vault().vaultId)
      fail("invalid_handoff");
    const base = `/api/v3/agent-credentials/${handoff.vaultId}/${handoff.connectionId}`;
    const setup = await this.request(`${base}/setups/${handoff.setupIntentId}`);
    const list = await this.request("/api/v2/persistent-connections");
    const connection = list.connections.find(
      (v: PersistentConnection) =>
        v.connectionId === handoff.connectionId &&
        v.clientId === setup.clientId &&
        v.provider === setup.provider,
    );
    if (!connection) fail("connection_unavailable");
    const current = await this.request(base),
      actor = this.actor(connection);
    const review = await this.workspace().inspectAgentCredentialSetup({
      actor,
      handoff,
      setup,
      current,
      hubOrigin: this.hubOrigin,
    });
    this.assert();
    if ((this.workspace() as any).providerSlotsSupported) {
      const caps = await this.request("/api/v3/provider-connections/capabilities");
      if (caps.enabled) {
        const providerState = await this.request(
            `/api/v3/provider-connections/${handoff.vaultId}/${connection.provider}`,
          ),
          pending = await this.workspace().loadPersistentPending(actor);
        this.assert();
        return {
          connection,
          setup,
          current,
          review,
          scope: { reviewDigest: review.reviewDigest, identities: [], permissions: [] },
          tasks: [],
          renewing: Boolean(current.lease || providerState.slot),
          providerState,
          pendingLifetimeSeconds:
            pending?.kind === "credential" && pending.setupIntentId === setup.setupIntentId
              ? credentialLifetime(pending)
              : null,
        };
      }
    }
    const legacy = setup.predecessorConnectionId,
      sources = await this.restorationSources(connection, current.identity ? null : legacy);
    const scope = await this.restorationScope(connection, current, sources, legacy),
      all = await this.tasks();
    const renewing = scope.identities.length > 0;
    const tasks = all.filter((task) =>
      renewing
        ? this.matchingAuthority(task, scope.identities) &&
          task.packet.metadata.resourceBindings.every((b: Json) =>
            scope.permissions.some(
              (p: Json) => same(p.ref, b.ref) && p.sourceEpoch === b.sourceEpoch,
            ),
          )
        : !task.authority.authority,
    );
    const pending = await this.workspace().loadPersistentPending(this.actor(connection));
    this.assert();
    const pendingLifetimeSeconds =
      pending?.kind === "credential" && pending.setupIntentId === setup.setupIntentId
        ? credentialLifetime(pending)
        : null;
    return {
      connection,
      setup,
      current,
      review,
      scope,
      tasks,
      renewing,
      pendingLifetimeSeconds,
      providerState: null,
    };
  }
  async authorize(
    handoff: Json,
    expected: Json,
    selected: string[],
    lifetimeSeconds = DEFAULT_CONNECTION_SECONDS,
  ) {
    if (![DEFAULT_CONNECTION_SECONDS, TEMPORARY_CONNECTION_SECONDS].includes(lifetimeSeconds))
      fail("review_changed");
    const current = await this.inspectAuthorization(handoff);
    if (
      !same(
        [
          current.setup,
          current.current,
          current.scope.reviewDigest,
          current.providerState,
          current.tasks.map((t) => t.packet.metadata),
        ],
        [
          expected.setup,
          expected.current,
          expected.scope.reviewDigest,
          expected.providerState,
          expected.tasks.map((t: PersistentTask) => t.packet.metadata),
        ],
      )
    )
      fail("review_changed");
    const connection = current.connection,
      actor = this.actor(connection);
    let pending = await this.workspace().loadPersistentPending(actor);
    this.assert();
    if (pending && pending.kind !== "credential") fail("persistent_operation_pending");
    if (pending && pending.setupIntentId !== current.setup.setupIntentId) {
      let receipt: Json | null = null;
      try {
        receipt = await this.request(
          pending.providerActivation
            ? `/api/v3/provider-connections/${connection.vaultId}/${pending.providerActivation.provider}/operations/${pending.operationId}`
            : `${this.credentialBase(connection)}/operations/${pending.operationId}`,
        );
      } catch (e) {
        if (!(e instanceof PersistentExperienceError) || e.code !== "not_found") throw e;
      }
      if (receipt) {
        await this.workspace().finishPersistentPending(actor, receipt);
        this.assert();
        fail("review_changed");
      }
      const previousSetup = await this.request(
        `${this.credentialBase(connection)}/setups/${pending.setupIntentId}`,
      );
      await this.workspace().archiveExpiredCredentialPending({
        actor,
        handoff,
        setup: current.setup,
        current: current.current,
        hubOrigin: this.hubOrigin,
        previousSetup,
      });
      this.assert();
      pending = null;
    }
    if (pending && credentialLifetime(pending) !== lifetimeSeconds)
      fail("persistent_operation_pending");
    if (
      new Set(selected).size !== selected.length ||
      selected.some((id) => !current.tasks.some((t) => t.taskId === id))
    )
      fail("review_changed");
    const packet =
      pending ??
      (await this.workspace().prepareAgentCredential({
        actor,
        handoff,
        setup: current.setup,
        current: current.current,
        hubOrigin: this.hubOrigin,
        lifetimeSeconds,
        ...(current.providerState ? { providerState: current.providerState } : {}),
      }));
    this.assert();
    await this.send(connection, packet);
    const installed = await this.request(this.credentialBase(connection));
    if (
      installed.lease?.credentialFingerprint !== packet.expectedLease.credentialFingerprint ||
      installed.identity?.bindingFingerprint !== packet.identity.bindingFingerprint
    )
      fail("version_conflict");
    if (current.providerState || packet.providerActivation)
      return { connected: true, requiresTaskReview: true };
    if (current.renewing) await this.restore(connection);
    else if (selected.length) {
      const review = await this.review(connection);
      await this.approve(
        connection,
        current.tasks.filter((t) => selected.includes(t.taskId)),
        review,
        false,
      );
    }
    return { connected: true };
  }
  async restore(connection: PersistentConnection) {
    await this.resume(connection);
    const { state: credentialState, verified } = await this.credential(connection);
    if (!["active", "expiring"].includes(verified.status)) fail("agent_unavailable");
    const sources = await this.restorationSources(connection),
      scope = await this.restorationScope(connection, credentialState, sources);
    let context = await this.context(connection);
    const catalogue = await this.catalogue(),
      resources: Json[] = [];
    for (const permission of scope.permissions) {
      const item = catalogue.groups
        .flatMap((g) => g.items)
        .find((i) => i.ref && sourceKey(i.ref) === sourceKey(permission.ref));
      if (
        !item ||
        item.sourceEpoch !== permission.sourceEpoch ||
        item.revision === null ||
        item.revision < permission.fromRevision ||
        !["active", "ready", "empty"].includes(item.state)
      )
        continue;
      resources.push({
        ref: item.ref,
        sourceEpoch: item.sourceEpoch,
        revision: item.revision,
        state: "active",
      });
    }
    if (resources.length) {
      const packet = await this.workspace().prepareRestoredConsent({
        ...this.control(context),
        credentialState,
        sources,
        hubOrigin: this.hubOrigin,
        resources,
      });
      this.assert();
      await this.send(connection, packet);
      context = await this.context(connection);
    }
    for (const permission of context.policy?.permissions ?? []) {
      if (permission.status !== "active") continue;
      const item = catalogue.groups
        .flatMap((g) => g.items)
        .find((i) => i.ref && sourceKey(i.ref) === sourceKey(permission.ref));
      if (
        item &&
        item.sourceEpoch === permission.sourceEpoch &&
        item.revision !== null &&
        item.revision >= permission.fromRevision &&
        ["active", "ready", "empty"].includes(item.state)
      )
        await this.publishResource(connection, context, item);
    }
    const tasks = await this.tasks();
    let restored = 0;
    for (const task of tasks) {
      if (
        !this.matchingAuthority(task, scope.identities) ||
        !task.packet.metadata.resourceBindings.every((b: Json) =>
          scope.permissions.some(
            (p: Json) => same(p.ref, b.ref) && p.sourceEpoch === b.sourceEpoch,
          ),
        )
      )
        continue;
      const packet = await this.workspace().prepareRestoredTask({
        ...this.control(context),
        credentialState,
        sources,
        hubOrigin: this.hubOrigin,
        authority: task.authority,
        task: task.packet,
      });
      this.assert();
      await this.send(connection, packet);
      restored++;
    }
    return { restored };
  }
  async taskAuthority(connection: PersistentConnection, task: PersistentTask, previous?: Json) {
    try {
      return await this.request(
        `/api/v2/persistent-content/${connection.vaultId}/tasks/${task.taskId}/authority`,
      );
    } catch (error) {
      if (!(error instanceof PersistentExperienceError) || error.code !== "version_conflict")
        throw error;
      const state = await this.workspace().verifyTaskCenterState(
        await this.request(`/api/v3/task-center/${connection.vaultId}/tasks/${task.taskId}`),
      );
      const head =
        state.assignments.find(
          (r: Json) => r.assignment.credential.connectionId === connection.connectionId,
        )?.authority ??
        (previous?.authority?.context.connectionId === connection.connectionId
          ? previous.authority
          : null);
      const receipt = head
        ? await this.request(
            `/api/v2/persistent-content/${connection.vaultId}/connections/${connection.connectionId}/operations/${head.publicationId}`,
          )
        : null;
      return {
        contractVersion: PERSISTENT_CONTRACT,
        profile: "folioview.persistent-content.v1",
        authority: head,
        envelope: receipt?.envelope ?? (head ? previous?.envelope : null),
      };
    }
  }
  async tasks() {
    const v = this.vault(),
      items: Json[] = [];
    let cursor: string | null = null;
    do {
      const p = await this.request(
        "/api/v2/tasks?limit=20" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
      );
      items.push(...taskPage(p));
      cursor = p.nextCursor;
      if (items.length > 50) fail("too_many_tasks");
    } while (cursor);
    const result: PersistentTask[] = [];
    for (const meta of items) {
      if (meta.vaultId !== v.vaultId || meta.status !== "active") continue;
      result.push(await this.task(meta));
    }
    return result;
  }
  async task(metadata: Json): Promise<PersistentTask> {
    const meta = taskMetadata(metadata),
      v = this.vault();
    if (meta.vaultId !== v.vaultId || meta.status !== "active") fail("review_changed");
    const packet = await this.request("/api/v2/tasks/" + meta.taskId);
    if (!same(packet.metadata, meta)) fail("version_conflict");
    const content = await this.workspace().openTask(packet as any);
    this.assert();
    let authority: Json;
    try {
      authority = await this.request(
        `/api/v2/persistent-content/${v.vaultId}/tasks/${meta.taskId}/authority`,
      );
    } catch (error) {
      if (!(error instanceof PersistentExperienceError) || error.code !== "version_conflict")
        throw error;
      const center = await this.workspace().verifyTaskCenterState(
        await this.request(`/api/v3/task-center/${v.vaultId}/tasks/${meta.taskId}`),
      );
      authority = { authority: null, envelope: null, taskCenter: center };
    }
    return {
      taskId: meta.taskId,
      title: content.name,
      packet,
      content,
      authority,
      plan: null,
    };
  }
  async catalogue() {
    return readResourceCatalogue(await this.request("/api/v2/resources/catalogue"));
  }
  async review(connection: PersistentConnection) {
    const context = await this.context(connection);
    return { identity: context.identityState.identity, policy: context.policy };
  }
  async approve(
    connection: PersistentConnection,
    tasks: PersistentTask[],
    expected: Json,
    allowReassign = false,
    taskCenter?: {
      previous?: Json;
      beforePublish: (task: PersistentTask, packet: Json, context: Json) => Promise<void>;
    },
  ) {
    if (!tasks.length) fail("select_task");
    const context = await this.context(connection),
      catalogue = await this.catalogue();
    if (!same({ identity: context.identityState.identity, policy: context.policy }, expected))
      fail("review_changed");
    const sources = new Map<string, Json>();
    for (const task of tasks) {
      const current = await this.request("/api/v2/tasks/" + task.taskId);
      if (!same(current.metadata, task.packet.metadata)) fail("review_changed");
      for (const b of current.metadata.resourceBindings) {
        const item = catalogue.groups
          .flatMap((g) => g.items)
          .find((i) => (i.ref ? sourceKey(i.ref) : "") === sourceKey(b.ref));
        if (
          !item ||
          item.sourceEpoch !== b.sourceEpoch ||
          item.revision === null ||
          !["active", "ready", "empty"].includes(item.state)
        )
          fail("source_unavailable");
        sources.set(sourceKey(b.ref), {
          ref: b.ref,
          sourceEpoch: b.sourceEpoch,
          revision: item!.revision,
          state: "active",
        });
      }
    }
    if (!sources.size) fail("select_resource");
    const packet = await this.workspace().preparePersistentConsent({
      ...this.control(context),
      resources: [...sources.values()],
    });
    this.assert();
    await this.send(connection, packet);
    const current = await this.context(connection);
    for (const task of tasks) {
      const authority = await this.taskAuthority(connection, task, taskCenter?.previous);
      const p = await this.workspace().preparePersistentTask({
        ...this.control(current),
        authority,
        task: task.packet,
        resultPolicy: "owner_inbox",
        allowReassign,
      });
      this.assert();
      if (taskCenter) await taskCenter.beforePublish(task, p, current);
      this.assert();
      await this.send(connection, p);
    }
    await this.synchronize(connection, !taskCenter);
  }
  private async publishResource(connection: PersistentConnection, context: Json, item: Json) {
    const before = await this.catalogue(),
      find = (c: any) =>
        c.groups
          .flatMap((g: any) => g.items)
          .find((v: any) => sourceKey(v.ref) === sourceKey(item.ref));
    if (!same(find(before), item)) fail("source_unavailable");
    let source: Json;
    if (item.ref.kind === "holdings") {
      if (!item.snapshotId) fail("source_unavailable");
      const authority = await this.request("/api/v2/vaults/current/authority-token", {
        method: "POST",
        json: { contractVersion: PERSISTENT_CONTRACT },
      });
      await this.api(
        "portfolio",
        `/api/v2/holdings/sources/${item.ref.resourceId}/authority-sync`,
        {
          method: "POST",
          json: { contractVersion: PERSISTENT_CONTRACT },
          headers: { "X-FolioView-Authority-Delegation": authority.token },
        },
      );
      this.assert();
      const snapshot = await this.api(
        "portfolio",
        `/api/v2/holdings/sources/${item.ref.resourceId}/snapshots/${item.snapshotId}`,
      );
      this.assert();
      source = {
        kind: "holdings",
        ref: item.ref,
        sourceEpoch: item!.sourceEpoch,
        revision: item!.revision,
        snapshot,
      };
    } else {
      const raw = await this.api(
        "user",
        item.ref.kind === "watchlist" ? "/api/v1/watchlist" : "/api/v1/channel-follows",
      );
      this.assert();
      const response =
        item.ref.kind === "watchlist" ? readResourceWatchlist(raw) : readChannelFollows(raw);
      if (
        item.ref.kind === "channel_follows" &&
        (response as { revision: number }).revision !== item.revision
      )
        fail("source_unavailable");
      source = {
        kind: item.ref.kind,
        ref: item.ref,
        sourceEpoch: item!.sourceEpoch,
        revision: item!.revision,
        fetchedAt: new Date().toISOString(),
        sourceAsOf: null,
        response,
      };
    }
    const after = await this.catalogue();
    if (!same(find(after), item)) fail("source_unavailable");
    const packet = await this.workspace().preparePersistentResource({
      ...this.control(context),
      source,
    });
    this.assert();
    await this.send(connection, packet);
  }
  async synchronize(connection: PersistentConnection, includeTasks = true) {
    await this.resume(connection);
    const context = await this.context(connection),
      catalogue = await this.catalogue();
    for (const permission of context.policy?.permissions ?? []) {
      if (permission.status !== "active" || permission.versionPolicy !== "current_and_future")
        continue;
      const item = catalogue.groups
        .flatMap((g) => g.items)
        .find((i) => (i.ref ? sourceKey(i.ref) : "") === sourceKey(permission.ref));
      if (
        !item ||
        item.sourceEpoch !== permission.sourceEpoch ||
        item.revision === null ||
        item.revision < permission.fromRevision ||
        !["active", "ready", "empty"].includes(item.state)
      )
        continue;
      await this.publishResource(connection, context, item);
    }
    if (!includeTasks) return;
    const tasks = await this.tasks();
    for (const task of tasks) {
      const selected = task.authority.taskCenter?.assignments?.find(
        (r: Json) =>
          r.assignment.credential.connectionId === connection.connectionId &&
          r.plan?.currentAssignment,
      );
      const authority = selected?.authority ?? task.authority.authority;
      if (!authority || authority.context.connectionId !== connection.connectionId) continue;
      const currentAuthority = task.authority.taskCenter
        ? await this.taskAuthority(connection, task)
        : task.authority;
      const p = await this.workspace().preparePersistentTask({
        ...this.control(context),
        authority: currentAuthority,
        task: task.packet,
        resultPolicy: authority.context.resultPolicy,
        allowReassign: false,
      });
      this.assert();
      await this.send(connection, p);
    }
  }
  async revoke(connection: PersistentConnection, permissionIds: string[]) {
    const context = await this.context(connection);
    const p = await this.workspace().preparePersistentRevocation({
      ...this.control(context),
      permissionIds,
    });
    this.assert();
    await this.send(connection, p);
  }
  async plan(connection: PersistentConnection, taskId: string) {
    const state = await this.request(
      `/api/v2/persistent-plans/${connection.vaultId}/${connection.connectionId}/${taskId}`,
    );
    const identityState = await this.request(this.base(connection));
    return { state, identityState };
  }
}
