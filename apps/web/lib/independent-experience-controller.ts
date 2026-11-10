/** Adapt the existing ciphertext/receipt flow to the independent Root-approved parent. */
import {
  PersistentExperienceController,
  PersistentExperienceError,
  PERSISTENT_CONTRACT,
  type PersistentApi,
  type PersistentConnection,
  type PersistentTask,
} from "./persistent-experience-controller";
import type { HoldingsWorkspace } from "../components/useHoldingsWorkspace";
import { policyRedirect, type IndependentAgentConfiguration } from "./independent-agent";
type Json = Record<string, any>;
export const independentBindingKey = (r: Json) =>
  JSON.stringify([
    r.ref.kind,
    r.ref.sourceService,
    r.ref.resourceId,
    r.ref.incarnation,
    r.sourceEpoch,
  ]);
export type IndependentApi = (
  service: "agent-policy" | Parameters<PersistentApi>[0],
  path: string,
  options?: any,
) => Promise<any>;
export class IndependentExperienceController {
  readonly content: PersistentExperienceController;
  constructor(
    readonly configuration: IndependentAgentConfiguration,
    private readonly api: IndependentApi,
    private readonly workspace: () => HoldingsWorkspace,
    private readonly assert: () => void,
    signal: AbortSignal,
  ) {
    this.content = new PersistentExperienceController(
      async (service, path, options = {}) => {
        if (service !== "agent-hub") return this.api(service, path, options);
        const w = this.workspace(),
          v = w.vault?.vaultId,
          c = configuration.connectionId;
        const base = `/api/v2/persistent-agents/${v}/${c}`;
        let target = path;
        if (path === base) return (await this.current()).identityState;
        if (path.startsWith(base + "/"))
          target =
            `/api/v2/executor-connections/${v}/${c}/` +
            path.slice(base.length + 1).replace(/^operations\//, "identity-operations/");
        const publication = `/api/v2/persistent-content/${v}/connections/${c}/`;
        if (path.startsWith(publication))
          target =
            `/api/v2/executor-connections/${v}/${c}/` +
            path.slice(publication.length).replace(/^operations\//, "publication-operations/");
        if (target !== path && options.method && options.method !== "GET") await this.current();
        this.assert();
        return this.api(service, target, options);
      },
      workspace,
      assert,
      signal,
    );
  }
  connection(): PersistentConnection {
    const v = this.workspace().vault;
    if (!v) throw new PersistentExperienceError("unlock_required");
    return {
      connectionId: this.configuration.connectionId,
      clientId: this.configuration.clientId,
      vaultId: v.vaultId,
      provider: "muse",
      status: "active",
      accountState: "connected",
      linkedAt: 0,
    };
  }
  private async destination(historical = false) {
    this.assert();
    const cfg = this.configuration,
      actor = { connectionId: cfg.connectionId, clientId: cfg.clientId };
    const hubState = await this.api(
      "agent-hub",
      `/api/v2/executor-connections/${this.connection().vaultId}/${cfg.connectionId}`,
    );
    await this.workspace().verifyIndependentDestination({
      actor,
      configuration: cfg,
      hubState,
      historical,
    });
    this.assert();
    return { cfg, actor, hubState };
  }
  async current() {
    const { cfg, actor, hubState } = await this.destination();
    const policyState = await this.api("agent-policy", `/api/v1/connections/${cfg.connectionId}`);
    this.assert();
    if (policyState.status === "revoked") throw new PersistentExperienceError("connection_revoked");
    const cp = await this.api(
      "agent-policy",
      `/api/v1/connections/${cfg.connectionId}/checkpoint`,
      {
        method: "POST",
        json: { contractVersion: PERSISTENT_CONTRACT },
      },
    );
    const state = { actor, configuration: cfg, hubState, policyState, checkpoint: cp.checkpoint };
    const verified = await this.workspace().verifyIndependentAgent(state);
    this.assert();
    return {
      state,
      verified,
      identityState: {
        contractVersion: PERSISTENT_CONTRACT,
        profile: "folioview.persistent-agent-identity.v1",
        identity: hubState.identity,
        binding: hubState.command,
        revocation: hubState.revocation,
        connectionRevoked: false,
      },
    };
  }
  async load() {
    const current = await this.current(),
      connection = this.connection();
    const review = await this.content.review(connection),
      tasks = await this.content.tasks();
    this.assert();
    return {
      ...current,
      review,
      tasks,
      pending: !!(await this.workspace().loadPersistentPending({
        connectionId: connection.connectionId,
        clientId: connection.clientId,
      })),
    };
  }
  async approve(tasks: PersistentTask[], expected: Json, reassign: boolean) {
    const current = await this.current(),
      allowed = current.verified.scope.resourceBindings;
    if (
      tasks.some((task) =>
        task.packet.metadata.resourceBindings.some(
          (r: Json) =>
            !allowed.some((a: Json) => independentBindingKey(a) === independentBindingKey(r)),
        ),
      )
    )
      throw new PersistentExperienceError("scope_extension_required");
    await this.content.approve(this.connection(), tasks, expected, reassign);
  }
  async authorize(pendingId: string) {
    const current = await this.current();
    const pending = await this.api("agent-policy", `/api/v1/authorizations/${pendingId}`);
    if (pending.pendingId !== pendingId) throw new PersistentExperienceError("invalid_response");
    return { ...current, pending };
  }
  async approveAuthorization(pendingId: string, expected: Json) {
    const current = await this.authorize(pendingId);
    if (JSON.stringify(current.pending) !== JSON.stringify(expected))
      throw new PersistentExperienceError("review_changed");
    const { command } = await this.workspace().signIndependentPolicyControl({
      ...current.state,
      action: "oauth_approve",
      pending: current.pending,
    });
    this.assert();
    const result = await this.api("agent-policy", `/api/v1/authorizations/${pendingId}/approvals`, {
      method: "POST",
      json: {
        contractVersion: PERSISTENT_CONTRACT,
        connectionId: this.configuration.connectionId,
        command,
      },
    });
    this.assert();
    return policyRedirect(result.redirectUri, this.configuration);
  }
  async revoke() {
    await this.destination(true);
    const configuration = this.configuration;
    const policyState = await this.api(
      "agent-policy",
      `/api/v1/connections/${configuration.connectionId}`,
    );
    this.assert();
    if (policyState.status === "revoked") return { alreadyRevoked: true };
    const { command } = await this.workspace().signIndependentPolicyControl({
      actor: { connectionId: configuration.connectionId, clientId: configuration.clientId },
      configuration,
      policyState,
      hubState: null,
      checkpoint: null,
      action: "revoke",
      pending: null,
    });
    this.assert();
    return this.api(
      "agent-policy",
      `/api/v1/connections/${this.configuration.connectionId}/controls`,
      {
        method: "POST",
        json: {
          contractVersion: PERSISTENT_CONTRACT,
          request: { action: "revoke", parameters: {}, approval: null, command },
        },
      },
    );
  }
}
