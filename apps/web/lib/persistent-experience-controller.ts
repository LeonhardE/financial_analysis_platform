/** Owner orchestration: current permissions and task assignment never come from OAuth. */
import {
  readResourceCatalogue,
  readResourceWatchlist,
  readChannelFollows,
} from "./resource-library";
import { taskPage } from "./task-types";
import type { HoldingsWorkspace } from "../components/useHoldingsWorkspace";
export const PERSISTENT_CONTRACT = "folioview.agent-workspace.v2.0";
type Json = Record<string, any>;
export type PersistentConnection = {
  connectionId: string;
  clientId: string;
  vaultId: string;
  provider: "muse";
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
};
export class PersistentExperienceError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
const fail = (code: string): never => {
  throw new PersistentExperienceError(code);
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
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
    const actor = this.actor(connection),
      v = this.vault(),
      base = this.base(connection);
    if (packet.connectionId !== connection.connectionId) fail("verification_failed");
    const publication = packet.kind === "publication";
    const receiptPath = publication
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
      if (packet.kind === "identity" && packet.registryUpdate) {
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
      const path = publication
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
        json: packet.body,
        headers: { "Idempotency-Key": packet.operationId },
      });
    }
    await this.workspace().finishPersistentPending(actor, receipt);
    this.assert();
    if (packet.kind === "identity" && packet.setupIntentId)
      await this.request(`/api/v2/runtime-setups/${packet.setupIntentId}/completion`, {
        method: "POST",
        json: { contractVersion: PERSISTENT_CONTRACT },
      });
  }
  async resume(connection: PersistentConnection) {
    const pending = await this.workspace().loadPersistentPending(this.actor(connection));
    this.assert();
    if (pending) await this.send(connection, pending);
  }
  async inspectSetup(intentId: string) {
    this.vault();
    return this.request("/api/v2/runtime-setups/" + intentId);
  }
  async enroll(intentId: string, expectedSetup: Json) {
    const setup = await this.inspectSetup(intentId);
    if (!same(setup, expectedSetup)) fail("review_changed");
    const c = setup.setup,
      connection: PersistentConnection = {
        connectionId: c.connectionId,
        clientId: c.clientId,
        vaultId: c.vaultId,
        provider: "muse",
        status: "active",
        accountState: "connecting",
        linkedAt: c.issuedAt,
      };
    const actor = this.actor(connection);
    await this.resume(connection);
    const current = await this.request(this.base(connection));
    if (current.identity) {
      await this.workspace().verifyPersistentIdentity({ state: current, actor });
      this.assert();
      await this.request(`/api/v2/runtime-setups/${intentId}/completion`, {
        method: "POST",
        json: { contractVersion: PERSISTENT_CONTRACT },
      });
      return;
    }
    const packet = await this.workspace().preparePersistentEnrollment({ actor, intentId, setup });
    this.assert();
    await this.send(connection, packet);
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
      const packet = await this.request("/api/v2/tasks/" + meta.taskId);
      if (!same(packet.metadata, meta)) fail("version_conflict");
      const content = await this.workspace().openTask(packet as any);
      this.assert();
      const authority = await this.request(
        `/api/v2/persistent-content/${v.vaultId}/tasks/${meta.taskId}/authority`,
      );
      result.push({
        taskId: meta.taskId,
        title: content.name,
        packet,
        content,
        authority,
        plan: null,
      });
    }
    return result;
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
      const authority = await this.request(
        `/api/v2/persistent-content/${connection.vaultId}/tasks/${task.taskId}/authority`,
      );
      const p = await this.workspace().preparePersistentTask({
        ...this.control(current),
        authority,
        task: task.packet,
        resultPolicy: "owner_inbox",
        allowReassign,
      });
      this.assert();
      await this.send(connection, p);
    }
    await this.synchronize(connection);
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
  async synchronize(connection: PersistentConnection) {
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
    const tasks = await this.tasks();
    for (const task of tasks) {
      const authority = task.authority.authority;
      if (!authority || authority.context.connectionId !== connection.connectionId) continue;
      const p = await this.workspace().preparePersistentTask({
        ...this.control(context),
        authority: task.authority,
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
