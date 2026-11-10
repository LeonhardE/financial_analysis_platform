/** Trusted owner Worker composition. Root/reader handles never leave this module's caller. */
import {
  Registry,
  CONTRACT,
  PROFILE,
  CONSENT_PROFILE,
  BINDING,
  canonical,
  parsed,
  bytes,
  exact,
  same,
  integer,
  identifier,
  keyId,
  digest,
  fingerprint,
  sign,
  verify,
  validate,
  verifyConsentChain,
  applyConsent,
  shape,
  permissionFor,
  inspect,
  verifyEnvelope,
  open,
  seal,
  privatePayload,
  matchBinding,
} from "../../../packages/encrypted-workspace/dist/core.mjs";
import { VaultError, type Json, type Vault, type RegistryBundle } from "./encrypted-types";
import {
  verifyExecutorApproval,
  validateExecutorSchema,
} from "../../../packages/executor-trust/dist/core.mjs";
const AGENT = "folioview.persistent-agent-identity.v1";
const PAIRING = "folioview.runtime-pairing.v1";
function fail(code = "binding_mismatch"): never {
  throw new VaultError(code);
}
const copy = <T>(v: T): T => structuredClone(v);
const op = (prefix: string, parts: unknown[]) => digest(parts).then((d) => prefix + d);
export type PersistentActor = { connectionId: string; clientId: string };
type Context = {
  actor?: PersistentActor;
  ownerSubject: string;
  vault: Vault;
  root: CryptoKey;
  deviceSigningKey: CryptoKey;
  deviceSigningKeyId: string;
  now: () => number;
  reader: (ids: string[]) => Promise<CryptoKey>;
  checkpointPins?: Map<string, Json>;
};
export class PersistentOwner {
  constructor(private readonly ctx: Context) {}
  private async independentDomain(cfg: Json, value: Json, historical: boolean) {
    exact(cfg, [
      "connectionId",
      "clientId",
      "issuer",
      "audience",
      "policyJwk",
      "nativeRedirectUris",
    ]);
    if (
      !this.ctx.actor ||
      cfg.connectionId !== this.ctx.actor.connectionId ||
      cfg.clientId !== this.ctx.actor.clientId
    )
      fail();
    const b = validateExecutorSchema("ExecutorBinding", value.binding);
    const payload = parsed(bytes(value.approval.payload), true);
    const approval = await verifyExecutorApproval(value.approval, {
      expectedBinding: {
        ownerSubject: this.ctx.ownerSubject,
        vaultId: this.ctx.vault.vaultId,
        rootKeyId: this.ctx.vault.rootKeyId,
        connectionId: cfg.connectionId,
        clientId: cfg.clientId,
        issuer: cfg.issuer,
        audience: cfg.audience,
        provider: "openai_chatgpt",
        providerClientId: cfg.clientId,
        policySigningKeyId: await keyId(cfg.policyJwk),
        tlsKeyId: b.tlsKeyId,
        scopeDigest: b.scopeDigest,
        workloadDigest: b.workloadDigest,
        recipientKeyIds: b.recipientKeyIds,
        agentId: b.agentId,
        agentSigningKeyId: b.agentSigningKeyId,
        agentEncryptionKeyId: b.agentEncryptionKeyId,
        identityEpoch: b.identityEpoch,
        bindingFingerprint: b.bindingFingerprint,
      },
      rootJwk: this.ctx.vault.rootJwk,
      now: historical ? payload.issuedAt : this.ctx.now(),
    });
    return approval.binding;
  }
  /** Check the approved credential destination before making any Policy request. */
  async independentDestination(args: Json) {
    exact(args, ["configuration", "hubState", "historical"]);
    if (canonical(args).length > 131072 || typeof args.historical !== "boolean") fail();
    const h = args.hubState;
    exact(h, [
      "contractVersion",
      "profile",
      "identity",
      "command",
      "revocation",
      "binding",
      "scope",
      "approval",
      "receipt",
    ]);
    if (h.contractVersion !== CONTRACT || h.profile !== "folioview.hub-executor-ciphertext.v1")
      fail();
    const b = await this.independentDomain(args.configuration, h, args.historical);
    return { issuer: b.issuer, connectionId: b.connectionId };
  }
  /** The configured endpoint never chooses the Owner Root or the original Agent keys. */
  async independent(args: Json) {
    exact(args, ["configuration", "hubState", "policyState", "checkpoint"]);
    if (canonical(args).length > 131072) fail("payload_too_large");
    const cfg = args.configuration,
      h = args.hubState,
      p = args.policyState,
      now = this.ctx.now();
    exact(cfg, [
      "connectionId",
      "clientId",
      "issuer",
      "audience",
      "policyJwk",
      "nativeRedirectUris",
    ]);
    if (
      !this.ctx.actor ||
      cfg.connectionId !== this.ctx.actor.connectionId ||
      cfg.clientId !== this.ctx.actor.clientId
    )
      fail();
    exact(h, [
      "contractVersion",
      "profile",
      "identity",
      "command",
      "revocation",
      "binding",
      "scope",
      "approval",
      "receipt",
    ]);
    if (
      h.contractVersion !== CONTRACT ||
      h.profile !== "folioview.hub-executor-ciphertext.v1" ||
      h.revocation !== null
    )
      fail("agent_unavailable");
    if (h.binding?.identityEpoch !== 1) fail("migration_required");
    const registry = await this.registry(),
      identity = await this.actor(h.identity, h.command, registry);
    if (identity.identityEpoch !== 1) fail("migration_required");
    const b = validateExecutorSchema("ExecutorBinding", h.binding);
    const expected = {
      ...b,
      ownerSubject: this.ctx.ownerSubject,
      vaultId: this.ctx.vault.vaultId,
      connectionId: cfg.connectionId,
      clientId: cfg.clientId,
      rootKeyId: this.ctx.vault.rootKeyId,
      agentId: identity.agentId,
      agentSigningKeyId: identity.agentSigningKeyId,
      agentEncryptionKeyId: identity.agentEncryptionKeyId,
      bindingFingerprint: identity.bindingFingerprint,
      identityEpoch: 1,
      issuer: cfg.issuer,
      audience: cfg.audience,
      provider: "openai_chatgpt",
      providerClientId: cfg.clientId,
      policySigningKeyId: await keyId(cfg.policyJwk),
      tlsKeyId: b.tlsKeyId,
      scopeDigest: b.scopeDigest,
      workloadDigest: b.workloadDigest,
      recipientKeyIds: b.recipientKeyIds,
    };
    const approval = await verifyExecutorApproval(h.approval, {
      expectedBinding: expected,
      rootJwk: this.ctx.vault.rootJwk,
      now,
    });
    if (approval.operationId !== parsed(bytes(h.command.payload), true).stableOperationId) fail();
    const recipients = [...registry.current.keys.values()]
      .filter(
        (c) =>
          !registry.current.revoked.has(c.keyId) &&
          c.connectionId === null &&
          ["device_enc", "recovery_enc"].includes(c.role) &&
          c.notBefore <= now &&
          now < c.expiresAt,
      )
      .map((c) => c.keyId)
      .sort();
    exact(h.scope, ["profile", "purpose", "resultPolicy", "resourceBindings"]);
    if (
      h.scope.profile !== "folioview.hub-executor-ciphertext-scope.v1" ||
      h.scope.purpose !== "analysis" ||
      h.scope.resultPolicy !== "owner_inbox" ||
      !Array.isArray(h.scope.resourceBindings) ||
      h.scope.resourceBindings.length < 1 ||
      h.scope.resourceBindings.length > 10 ||
      !same(recipients, b.recipientKeyIds) ||
      b.scopeDigest !== (await digest(h.scope))
    )
      fail();
    const refs = h.scope.resourceBindings.map((item: Json) => {
      validate("ResourceRef", item.ref);
      integer(item.sourceEpoch, 1);
      exact(item, ["ref", "sourceEpoch"]);
      return canonical(item.ref);
    });
    if (!same(refs, [...new Set(refs)].sort())) fail();
    const cp = validateExecutorSchema(
      "ExecutorCheckpointPayload",
      await verify(args.checkpoint, cfg.policyJwk, "fv-control+jws"),
    );
    if (
      p.profile !== "folioview.agent-policy.v1" ||
      p.connectionId !== cfg.connectionId ||
      p.status !== "active" ||
      !same(p.binding, b) ||
      !same(p.scope, h.scope) ||
      (await fingerprint(p.approval)) !== (await fingerprint(h.approval)) ||
      cp.revoked ||
      cp.bindingDigest !== (await digest(b)) ||
      cp.approvalFingerprint !== (await fingerprint(h.approval)) ||
      cp.stateVersion !== p.stateVersion ||
      cp.stateHead !== p.stateHead ||
      cp.authorizationEpoch !== p.authorizationEpoch ||
      cp.issuedAt > now ||
      cp.issuedAt < approval.issuedAt ||
      now >= cp.expiresAt ||
      cp.expiresAt > Math.min(cp.issuedAt + 120, approval.expiresAt)
    )
      fail("stale_policy");
    const pin = this.ctx.checkpointPins?.get(cfg.connectionId);
    if (
      pin &&
      (cp.stateVersion < pin.stateVersion ||
        cp.authorizationEpoch < pin.authorizationEpoch ||
        (cp.stateVersion === pin.stateVersion &&
          !same(
            [cp.stateHead, cp.authorizationEpoch, cp.bindingDigest],
            [pin.stateHead, pin.authorizationEpoch, pin.bindingDigest],
          )))
    )
      fail("stale_policy");
    this.ctx.checkpointPins?.set(cfg.connectionId, cp);
    return {
      identity,
      binding: b,
      scope: h.scope,
      checkpoint: cp,
      approvalExpiresAt: approval.expiresAt,
      nativeScheduleStatus: "not_observed",
      continuousExecutionAcceptance: "pending",
    };
  }
  async independentControl(args: Json) {
    exact(args, ["configuration", "hubState", "policyState", "checkpoint", "action", "pending"]);
    const { action, pending, ...state } = args;
    if (canonical(args).length > 131072) fail("payload_too_large");
    const now = this.ctx.now();
    let review: Json;
    let parameters: Json;
    if (action === "revoke" && pending === null) {
      // Terminal narrowing works with issuance off, expired approval or lost Agent keys.
      // The live service still enforces the exact Owner Root and version/head CAS.
      const p = state.policyState,
        cfg = state.configuration;
      if (p.profile !== "folioview.agent-policy.v1" || p.connectionId !== cfg.connectionId) fail();
      const b = await this.independentDomain(cfg, p, true);
      integer(p.stateVersion, 1);
      validate("Digest", p.stateHead);
      review = { binding: b, checkpoint: { stateVersion: p.stateVersion, stateHead: p.stateHead } };
      parameters = { parameters: {}, approval: null };
    } else if (action === "oauth_approve") {
      review = await this.independent(state);
      exact(pending, ["pendingId", "requestDigest", "clientId", "resource", "scope", "expiresAt"]);
      validate("Digest", pending.requestDigest);
      integer(pending.expiresAt, 1);
      const scopes = typeof pending.scope === "string" ? pending.scope.split(" ") : [];
      if (
        !/^pauth_[A-Za-z0-9_-]{43}$/.test(pending.pendingId) ||
        pending.clientId !== review.binding.clientId ||
        pending.resource !== review.binding.audience ||
        pending.expiresAt <= now ||
        pending.expiresAt > now + 300 ||
        scopes.length < 1 ||
        new Set(scopes).size !== scopes.length ||
        scopes.some(
          (s: string) =>
            !["executor:execute", "executor:write_report", "executor:recover"].includes(s),
        )
      )
        fail();
      parameters = { pendingId: pending.pendingId, requestDigest: pending.requestDigest };
    } else fail();
    const command = {
      contractVersion: CONTRACT,
      profile: "folioview.agent-policy-control.v1",
      action,
      ownerSubject: this.ctx.ownerSubject,
      connectionId: review.binding.connectionId,
      operationId: "policy_" + crypto.randomUUID().replaceAll("-", ""),
      expectedVersion: review.checkpoint.stateVersion,
      expectedHead: review.checkpoint.stateHead,
      parametersDigest: await digest(parameters!),
      issuedAt: now,
      expiresAt: now + 120,
    };
    return {
      command: await sign(command, this.ctx.root, this.ctx.vault.rootKeyId, "fv-control+jws"),
    };
  }
  private async registry(
    bundles: RegistryBundle[] = this.ctx.vault.registryHistory,
    at = this.ctx.now(),
  ) {
    const v = this.ctx.vault,
      last = parsed(bytes(bundles.at(-1)!.checkpoint.payload), true);
    if (bundles.length < 1 || bundles.length > 32 || last.registrySequence !== bundles.length)
      fail();
    return new Registry({
      rootJwk: v.rootJwk,
      rootKeyId: v.rootKeyId,
      ownerSubject: this.ctx.ownerSubject,
      vaultId: v.vaultId,
      rootEpoch: 1,
      registrySequence: last.registrySequence,
      checkpointDigest: await digest(last),
    }).load(bundles, at);
  }
  private async actor(identity: Json, binding: Json, registry: Registry) {
    validate("PersistentAgentIdentity", identity);
    if (
      !this.ctx.actor ||
      identity.connectionId !== this.ctx.actor.connectionId ||
      identity.clientId !== this.ctx.actor.clientId ||
      identity.ownerSubject !== this.ctx.ownerSubject ||
      identity.vaultId !== this.ctx.vault.vaultId ||
      identity.rootKeyId !== this.ctx.vault.rootKeyId
    )
      fail();
    await registry.binding(binding, identity, identity, this.ctx.now());
    return identity;
  }
  async identity(state: Json) {
    exact(state, [
      "contractVersion",
      "profile",
      "identity",
      "binding",
      "revocation",
      "connectionRevoked",
    ]);
    if (
      state.contractVersion !== CONTRACT ||
      state.profile !== AGENT ||
      state.connectionRevoked ||
      !state.identity
    )
      fail("agent_unavailable");
    const registry = await this.registry();
    return { identity: await this.actor(state.identity, state.binding, registry), registry };
  }
  async inspectSetup(value: Json) {
    exact(value, [
      "contractVersion",
      "profile",
      "setup",
      "offer",
      "protectedHostAttested",
      "authority",
    ]);
    if (
      value.contractVersion !== CONTRACT ||
      value.profile !== PAIRING ||
      value.authority !== "pairing_observation_only" ||
      !value.offer ||
      value.setup.confirmed !== true
    )
      fail("agent_unavailable");
    if (
      !this.ctx.actor ||
      value.setup.connectionId !== this.ctx.actor.connectionId ||
      value.setup.clientId !== this.ctx.actor.clientId
    )
      fail();
    const s = value.setup,
      offer = value.offer,
      p = await verify(
        offer.command,
        parsed(bytes(offer.command.payload), true).signingPublicJwk,
        "fv-control+jws",
      );
    exact(p, [
      "contractVersion",
      "profile",
      "artifactType",
      "intentId",
      "ownerSubject",
      "vaultId",
      "connectionId",
      "clientId",
      "authorizationId",
      "nonce",
      "issuedAt",
      "expiresAt",
      "agentId",
      "signingPublicJwk",
      "encryptionPublicJwk",
    ]);
    if (
      p.contractVersion !== CONTRACT ||
      p.profile !== PAIRING ||
      p.artifactType !== "runtime_key_offer" ||
      p.ownerSubject !== this.ctx.ownerSubject ||
      p.vaultId !== this.ctx.vault.vaultId ||
      s.expiresAt <= this.ctx.now() ||
      p.issuedAt < s.issuedAt ||
      p.issuedAt > this.ctx.now() ||
      p.expiresAt > Math.min(p.issuedAt + 300, s.expiresAt) ||
      p.expiresAt <= p.issuedAt ||
      bytes(p.nonce).length !== 32
    )
      fail();
    for (const k of [
      "intentId",
      "ownerSubject",
      "vaultId",
      "connectionId",
      "clientId",
      "authorizationId",
      "nonce",
    ])
      if (p[k] !== s[k]) fail();
    const sig = await keyId(p.signingPublicJwk),
      enc = await keyId(p.encryptionPublicJwk);
    if (
      sig === enc ||
      p.agentId !== "agent_" + sig ||
      offer.agentId !== p.agentId ||
      offer.signingKeyId !== sig ||
      offer.encryptionKeyId !== enc ||
      offer.fingerprint !== (await fingerprint(offer.command))
    )
      fail();
    return { setup: s, offer: p, fingerprint: offer.fingerprint, protectedHostAttested: false };
  }
  async enrollment(value: Json) {
    const review = await this.inspectSetup(value),
      { offer: p } = review,
      v = this.ctx.vault,
      registry = await this.registry();
    const bundle = copy(v.registryHistory.at(-1)!);
    const known = [...registry.current.keys.values()].filter(
      (c) => c.connectionId === p.connectionId && ["agent_sig", "agent_enc"].includes(c.role),
    );
    const sig = await keyId(p.signingPublicJwk),
      enc = await keyId(p.encryptionPublicJwk),
      now = this.ctx.now();
    const registered =
      known.length === 2 &&
      known.every((c) => c.principalId === p.agentId && [sig, enc].includes(c.keyId));
    let registryUpdate: Json | null = null,
      accepted = registry;
    if (!registered) {
      if (known.length || bundle.entries.length + 2 > 64 || v.registryHistory.length >= 32)
        fail("device_limit");
      for (const [role, jwk, kid] of [
        ["agent_sig", p.signingPublicJwk, sig],
        ["agent_enc", p.encryptionPublicJwk, enc],
      ] as [string, Json, string][]) {
        if (registry.current.keys.has(kid)) fail();
        const certificate = {
          contractVersion: CONTRACT,
          artifactType: "key_certificate",
          ownerSubject: this.ctx.ownerSubject,
          vaultId: v.vaultId,
          certificateId: await op("cert_", [p.intentId, role, kid]),
          keyId: kid,
          role,
          publicJwk: jwk,
          principalId: p.agentId,
          connectionId: p.connectionId,
          keyEpoch: 1,
          issuerKeyId: v.rootKeyId,
          notBefore: now,
          expiresAt: now + 31536000,
          capabilities: role === "agent_sig" ? ["run_request", "result_write"] : [],
        };
        validate("KeyCertificatePayload", certificate);
        bundle.entries.push({
          certificate: await sign(certificate, this.ctx.root, v.rootKeyId, "fv-control+jws"),
          active: true,
        });
      }
      const descriptions = [];
      for (const entry of bundle.entries) {
        const c = parsed(bytes(entry.certificate.payload), true);
        descriptions.push({
          certificateId: c.certificateId,
          payloadDigest: await digest(c),
          active: entry.active,
        });
      }
      descriptions.sort((a, b) => (a.certificateId < b.certificateId ? -1 : 1));
      const cp = {
        ...parsed(bytes(bundle.checkpoint.payload), true),
        registrySequence: registry.sequence + 1,
        previousDigest: registry.current.digest,
        entriesDigest: await digest(descriptions),
        issuedAt: now,
      };
      bundle.checkpoint = await sign(cp, this.ctx.root, v.rootKeyId, "fv-control+jws");
      accepted = await this.registry([...v.registryHistory, bundle]);
      registryUpdate = {
        contractVersion: CONTRACT,
        expectedVersion: v.version,
        registryBundle: bundle,
      };
    }
    const command = {
      contractVersion: CONTRACT,
      profile: AGENT,
      artifactType: "persistent_agent_binding",
      ownerSubject: this.ctx.ownerSubject,
      vaultId: v.vaultId,
      rootKeyId: v.rootKeyId,
      connectionId: p.connectionId,
      agentId: p.agentId,
      clientId: p.clientId,
      identityEpoch: 1,
      agentSigningKeyId: sig,
      agentEncryptionKeyId: enc,
      deviceSigningKeyId: this.ctx.deviceSigningKeyId,
      stableOperationId: await op("identity_", [
        this.ctx.ownerSubject,
        v.vaultId,
        p.connectionId,
        p.agentId,
        sig,
        enc,
      ]),
      registrySequence: accepted.sequence,
      checkpointDigest: accepted.current.digest,
      keyEpoch: accepted.current.keyEpoch,
      issuedAt: now,
    };
    validate("PersistentAgentBindingPayload", command);
    const binding = await sign(
      command,
      this.ctx.deviceSigningKey,
      this.ctx.deviceSigningKeyId,
      "fv-control+jws",
    );
    const identity = {
      contractVersion: CONTRACT,
      profile: AGENT,
      ...Object.fromEntries(
        BINDING.filter((k) => k !== "bindingFingerprint").map((k) => [
          k,
          command[k as keyof typeof command],
        ]),
      ),
      bindingFingerprint: await fingerprint(binding),
      status: "active",
      registeredAt: now,
      revokedAt: null,
    };
    validate("PersistentAgentIdentity", identity);
    await accepted.binding(binding, identity, identity, now);
    return {
      kind: "identity",
      connectionId: p.connectionId,
      operationId: command.stableOperationId,
      setupIntentId: p.intentId,
      registryUpdate,
      body: { contractVersion: CONTRACT, command: binding },
      identity,
    };
  }
  async policy(
    state: Json,
    resourceState: Json,
    receipts: Json[],
    pin: { version: number; digest: string } | null = null,
  ) {
    const { identity, registry } = await this.identity(state);
    exact(resourceState, ["contractVersion", "profile", "consent", "operations", "parentRevoked"]);
    if (
      resourceState.contractVersion !== CONTRACT ||
      resourceState.profile !== CONSENT_PROFILE ||
      resourceState.parentRevoked ||
      !same(
        resourceState.operations,
        receipts.map((r) => r.operationId),
      )
    )
      fail("agent_unavailable");
    return {
      identity,
      registry,
      consent: await verifyConsentChain({
        consent: resourceState.consent,
        receipts,
        identity,
        registry,
        pin,
      }),
    };
  }
  async approve(args: {
    identityState: Json;
    resourceState: Json;
    receipts: Json[];
    resources: Json[];
  }) {
    const { identity, registry, consent } = await this.policy(
      args.identityState,
      args.resourceState,
      args.receipts,
    );
    if (!Array.isArray(args.resources) || args.resources.length < 1 || args.resources.length > 10)
      fail("invalid_data");
    const proposals = [],
      sources = [];
    for (const source of args.resources) {
      exact(source, ["ref", "sourceEpoch", "revision", "state"]);
      validate("ResourceRef", source.ref);
      integer(source.sourceEpoch, 1);
      integer(source.revision, 1);
      if (source.state !== "active") fail("resource_unavailable");
      const current = consent?.permissions.find(
        (p: Json) =>
          p.status === "active" && same(p.ref, source.ref) && p.sourceEpoch === source.sourceEpoch,
      );
      if (current) continue;
      proposals.push({
        permissionId: await op("permission_", [
          identity.bindingFingerprint,
          source.ref,
          source.sourceEpoch,
          consent?.version ?? 0,
        ]),
        ref: source.ref,
        sourceEpoch: source.sourceEpoch,
        fromRevision: source.revision,
        versionPolicy: "current_and_future",
        selectedHistory: [],
        expectedPermissionEpoch: 0,
      });
      sources.push({
        ownerSubject: identity.ownerSubject,
        vaultId: identity.vaultId,
        ref: source.ref,
        sourceEpoch: source.sourceEpoch,
        currentRevision: source.revision,
        state: "active",
      });
    }
    if (!proposals.length) return { kind: "no_change", consent };
    const payload = {
      contractVersion: CONTRACT,
      profile: CONSENT_PROFILE,
      ...Object.fromEntries(BINDING.map((k) => [k, identity[k]])),
      artifactType: "persistent_resource_approval",
      consentId:
        consent?.consentId ??
        (await op("consent_", [identity.ownerSubject, identity.vaultId, identity.connectionId])),
      purpose: "analysis",
      authorKeyId: identity.rootKeyId,
      stableOperationId: await op("consent_op_", [
        identity.bindingFingerprint,
        consent?.version ?? 0,
        proposals,
      ]),
      expectedVersion: consent?.version ?? 0,
      expectedConsentDigest: consent ? await digest(consent) : null,
      issuedAt: this.ctx.now(),
      registrySequence: registry.sequence,
      checkpointDigest: registry.current.digest,
      keyEpoch: registry.current.keyEpoch,
      resources: proposals,
    };
    validate("PersistentResourceApprovalPayload", payload);
    const command = await sign(payload, this.ctx.root, identity.rootKeyId, "fv-control+jws");
    const expected = await applyConsent(command, consent, identity, registry, sources);
    return {
      kind: "consent",
      connectionId: identity.connectionId,
      operationId: payload.stableOperationId,
      body: { contractVersion: CONTRACT, command },
      expected,
    };
  }
  async revoke(args: {
    identityState: Json;
    resourceState: Json;
    receipts: Json[];
    permissionIds: string[];
  }) {
    const { identity, registry, consent } = await this.policy(
      args.identityState,
      args.resourceState,
      args.receipts,
    );
    if (!consent) fail("not_found");
    if (
      !Array.isArray(args.permissionIds) ||
      !args.permissionIds.length ||
      new Set(args.permissionIds).size !== args.permissionIds.length
    )
      fail();
    const targets = args.permissionIds.map((id) => {
      const p = consent.permissions.find(
        (p: Json) => p.permissionId === id && p.status === "active",
      );
      if (!p) fail("not_found");
      return { permissionId: id, ref: p.ref, expectedPermissionEpoch: p.permissionEpoch };
    });
    const payload = {
      contractVersion: CONTRACT,
      profile: CONSENT_PROFILE,
      ...Object.fromEntries(BINDING.map((k) => [k, identity[k]])),
      artifactType: "persistent_resource_revocation",
      consentId: consent.consentId,
      purpose: "analysis",
      authorKeyId: this.ctx.deviceSigningKeyId,
      stableOperationId: await op("consent_revoke_", [
        identity.bindingFingerprint,
        consent.version,
        targets,
      ]),
      expectedVersion: consent.version,
      expectedConsentDigest: await digest(consent),
      issuedAt: this.ctx.now(),
      registrySequence: registry.sequence,
      checkpointDigest: registry.current.digest,
      keyEpoch: registry.current.keyEpoch,
      targets,
    };
    validate("PersistentResourceRevocationPayload", payload);
    const command = await sign(
      payload,
      this.ctx.deviceSigningKey,
      this.ctx.deviceSigningKeyId,
      "fv-control+jws",
    );
    return {
      kind: "revocation",
      connectionId: identity.connectionId,
      operationId: payload.stableOperationId,
      body: { contractVersion: CONTRACT, command },
      expected: await applyConsent(command, consent, identity, registry, []),
    };
  }
  private async publication(
    identity: Json,
    registry: Registry,
    objectType: string,
    objectId: string,
    revision: number,
    business: Json,
    payload: Json,
    operationId: string,
  ) {
    const recovery = [...registry.current.keys.values()]
      .filter((c) => c.role === "recovery_enc")
      .filter((c) => {
        try {
          registry.cert(c.keyId, "recovery_enc", null, this.ctx.now());
          return true;
        } catch {
          return false;
        }
      });
    if (recovery.length !== 1) fail("missing_key");
    const recipients = [
      { keyId: identity.agentEncryptionKeyId, role: "agent_enc" },
      { keyId: recovery[0].keyId, role: "recovery_enc" },
    ].sort((a, b) => (a.keyId < b.keyId ? -1 : 1));
    const context = {
      contractVersion: CONTRACT,
      profile: PROFILE,
      ...Object.fromEntries(BINDING.map((k) => [k, identity[k]])),
      registrySequence: registry.sequence,
      checkpointDigest: registry.current.digest,
      keyEpoch: registry.current.keyEpoch,
      stableOperationId: operationId,
      issuedAt: this.ctx.now(),
      objectType,
      objectId,
      revision,
      expectedRevision: revision - 1,
      purpose: objectType === "task" ? "execute_task" : "analysis",
      recipients,
      ...business,
    };
    const publicKeys = Object.fromEntries(
      recipients.map((r) => [r.keyId, registry.current.keys.get(r.keyId)!.publicJwk]),
    );
    const envelope = await seal(payload, context, publicKeys, this.ctx.root);
    await verifyEnvelope(envelope, {
      registry,
      identity,
      expected: context,
      now: this.ctx.now(),
      purpose: "new_publication",
    });
    return {
      kind: "publication",
      identity,
      connectionId: identity.connectionId,
      operationId,
      body: { contractVersion: CONTRACT, envelope },
      fingerprint: await fingerprint(envelope.proof),
      context,
    };
  }
  async resource(args: {
    identityState: Json;
    resourceState: Json;
    receipts: Json[];
    ref: Json;
    sourceEpoch: number;
    revision: number;
    objectId: string;
    ownerEnvelopeFingerprint: string;
    content: Json;
  }) {
    const { identity, registry, consent } = await this.policy(
      args.identityState,
      args.resourceState,
      args.receipts,
    );
    const permission = consent?.permissions.find(
      (p: Json) =>
        p.status === "active" && same(p.ref, args.ref) && p.sourceEpoch === args.sourceEpoch,
    );
    if (!permission) fail("resource_not_approved");
    const c = {
      ref: args.ref,
      sourceEpoch: args.sourceEpoch,
      sourceRevision: args.revision,
      permissionId: permission.permissionId,
      permissionEpoch: permission.permissionEpoch,
      ownerEnvelopeFingerprint: args.ownerEnvelopeFingerprint,
    };
    permissionFor(consent, c);
    validate("Digest", args.ownerEnvelopeFingerprint);
    identifier(args.objectId);
    const kind = {
      holdings: "holdings_snapshot",
      watchlist: "watchlist_evidence",
      channel_follows: "channel_follows_evidence",
    }[args.ref.kind as string];
    if (!kind) fail();
    const operationId = await op("resource_pub_", [
      identity.bindingFingerprint,
      args.ref,
      args.sourceEpoch,
      args.revision,
      permission.permissionId,
      permission.permissionEpoch,
      args.ownerEnvelopeFingerprint,
    ]);
    return this.publication(
      identity,
      registry,
      kind,
      args.objectId,
      args.revision,
      c,
      args.content,
      operationId,
    );
  }
  async task(args: {
    identityState: Json;
    resourceState: Json;
    receipts: Json[];
    authority: Json;
    metadata: Json;
    content: Json;
    resultPolicy: "none" | "owner_inbox";
    allowReassign: boolean;
  }) {
    const { identity, registry, consent } = await this.policy(
        args.identityState,
        args.resourceState,
        args.receipts,
      ),
      meta = args.metadata;
    validate("TaskMetadata", meta);
    if (meta.status !== "active") fail("task_unavailable");
    if (!["none", "owner_inbox"].includes(args.resultPolicy)) fail();
    for (const b of meta.resourceBindings)
      if (
        !consent?.permissions.some(
          (p: Json) =>
            p.status === "active" && same(p.ref, b.ref) && p.sourceEpoch === b.sourceEpoch,
        )
      )
        fail("resource_not_approved");
    const a = args.authority;
    exact(a, ["contractVersion", "profile", "authority", "envelope"]);
    if (a.contractVersion !== CONTRACT || a.profile !== PROFILE) fail();
    let old: Json | null = null;
    if (a.authority) {
      const c = inspect(a.envelope).context;
      // Existing task assignment is Root-authenticated even when its previous Agent is inactive.
      await verify(a.envelope.proof, this.ctx.vault.rootJwk, "fv-control+jws");
      if (
        c.objectType !== "task" ||
        c.taskId !== meta.taskId ||
        c.ownerSubject !== identity.ownerSubject ||
        c.vaultId !== identity.vaultId ||
        c.rootKeyId !== identity.rootKeyId ||
        a.authority.fingerprint !== (await fingerprint(a.envelope.proof)) ||
        !same(a.authority.context, c) ||
        a.authority.publicationId !== c.stableOperationId ||
        inspect(a.envelope).payload.ciphertextDigest !== (await digest(a.envelope.jwe))
      )
        fail();
      const cp = registry.snapshots.get(c.registrySequence);
      if (!cp || cp.digest !== c.checkpointDigest) fail();
      if (c.connectionId !== identity.connectionId && !args.allowReassign)
        fail("replacement_review_required");
      if (c.taskVersion > meta.taskVersion) fail("version_conflict");
      old = a.authority;
      if (
        BINDING.every((k) => same(c[k], identity[k])) &&
        c.taskVersion === meta.taskVersion &&
        c.executionEpoch === meta.executionEpoch &&
        c.ownerTaskFingerprint === meta.envelopeFingerprint &&
        c.resultPolicy === args.resultPolicy &&
        same(c.resourceBindings, meta.resourceBindings)
      )
        return { kind: "no_change", authority: old };
    }
    const business = {
      taskId: meta.taskId,
      taskVersion: meta.taskVersion,
      executionEpoch: meta.executionEpoch,
      authorityId:
        old?.context.authorityId ??
        (await op("task_authority_", [identity.ownerSubject, identity.vaultId, meta.taskId])),
      authorityVersion: (old?.context.authorityVersion ?? 0) + 1,
      expectedAuthorityVersion: old?.context.authorityVersion ?? 0,
      expectedAuthorityDigest: old ? await digest(old) : null,
      resultPolicy: args.resultPolicy,
      ownerTaskFingerprint: meta.envelopeFingerprint,
      resourceBindings: meta.resourceBindings,
    };
    const operationId = await op("task_pub_", [
      identity.bindingFingerprint,
      meta.taskId,
      meta.taskVersion,
      meta.executionEpoch,
      meta.envelopeFingerprint,
      business.authorityVersion,
      args.resultPolicy,
    ]);
    return this.publication(
      identity,
      registry,
      "task",
      meta.taskId,
      meta.taskVersion,
      business,
      args.content,
      operationId,
    );
  }
  async publicationReceipt(packet: Json, receipt: Json) {
    const hasEnvelope = Object.hasOwn(receipt, "envelope");
    exact(receipt, [
      "contractVersion",
      "profile",
      "publicationId",
      "fingerprint",
      "context",
      ...(hasEnvelope ? ["envelope"] : []),
    ]);
    if (
      receipt.contractVersion !== CONTRACT ||
      receipt.profile !== PROFILE ||
      receipt.publicationId !== packet.operationId
    )
      fail();
    if (hasEnvelope) {
      const c = inspect(receipt.envelope).context;
      const omit = new Set([
        "issuedAt",
        "registrySequence",
        "checkpointDigest",
        "keyEpoch",
        "recipients",
      ]);
      const logical = (context: Json) =>
        Object.fromEntries(Object.entries(context).filter(([key]) => !omit.has(key)));
      if (
        !same(logical(c), logical(packet.context)) ||
        !same(c, receipt.context) ||
        c.issuedAt > this.ctx.now() ||
        c.registrySequence > this.ctx.vault.registryHistory.length
      )
        fail();
      const registry = await this.registry(
        this.ctx.vault.registryHistory.slice(0, c.registrySequence),
        c.issuedAt,
      );
      const verified = await verifyEnvelope(receipt.envelope, {
        registry,
        identity: packet.identity,
        expected: c,
        now: c.issuedAt,
        purpose: "owner_history",
      });
      if (verified.fingerprint !== receipt.fingerprint) fail();
    } else if (receipt.fingerprint !== packet.fingerprint || !same(receipt.context, packet.context))
      fail();
    return { operationId: packet.operationId };
  }
  async controlReceipt(packet: Json, receipt: Json) {
    if (
      receipt.contractVersion !== CONTRACT ||
      receipt.operationId !== packet.operationId ||
      receipt.fingerprint !== (await fingerprint(packet.body.command))
    )
      fail();
    if (packet.kind === "identity") {
      if (receipt.profile !== AGENT || !same(receipt.identity, packet.identity)) fail();
    } else if (
      receipt.profile !== CONSENT_PROFILE ||
      !same(receipt.consent, packet.expected) ||
      receipt.priorDigest !== parsed(bytes(packet.body.command.payload), true).expectedConsentDigest
    )
      fail();
    return { operationId: packet.operationId };
  }
  async plan(args: { state: Json; identityState: Json; taskId: string; hubOrigin: string }) {
    const s = args.state;
    exact(s, [
      "contractVersion",
      "profile",
      "taskId",
      "connectionId",
      "version",
      "desired",
      "reported",
      "reportedEvidence",
      "observed",
      "nativeScheduleAttested",
      "parentRevoked",
    ]);
    identifier(args.taskId);
    if (
      !this.ctx.actor ||
      s.contractVersion !== CONTRACT ||
      s.profile !== "folioview.persistent-native-plan.v1" ||
      s.taskId !== args.taskId ||
      s.connectionId !== this.ctx.actor.connectionId ||
      s.nativeScheduleAttested !== false ||
      !Number.isSafeInteger(s.version) ||
      s.version < 0 ||
      typeof s.parentRevoked !== "boolean" ||
      (s.reported === null) !== (s.version === 0) ||
      !/^https:\/\/agent-hub-api-[0-9]{1,20}\.[a-z]+(?:-[a-z0-9]+)+[0-9]\.run\.app$/.test(
        args.hubOrigin,
      )
    )
      fail("invalid_plan_observation");
    if (s.reported) {
      const r = s.reported,
        e = s.reportedEvidence;
      exact(r, [
        "contractVersion",
        "profile",
        "connectionId",
        "taskId",
        "operationId",
        "version",
        "requestDigest",
        "taskPublicationFingerprint",
        "provider",
        "planReferenceHash",
        "reportedStatus",
        "reportedAt",
        "receivedAt",
        "authority",
        "nativeScheduleAttested",
      ]);
      exact(e, ["request", "proof", "identity", "registrySequence", "checkpointDigest"]);
      if (
        r.contractVersion !== CONTRACT ||
        r.profile !== s.profile ||
        r.connectionId !== s.connectionId ||
        r.taskId !== args.taskId ||
        r.version !== s.version ||
        r.authority !== "agent_statement" ||
        r.nativeScheduleAttested !== false ||
        !["enabled", "paused", "removed", "unconfirmed"].includes(r.reportedStatus) ||
        r.provider !== "muse" ||
        !Number.isSafeInteger(r.receivedAt) ||
        r.receivedAt < 0 ||
        r.receivedAt > this.ctx.now() ||
        !Number.isSafeInteger(e.registrySequence) ||
        e.registrySequence < 1 ||
        e.registrySequence > this.ctx.vault.registryHistory.length
      )
        fail("invalid_plan_observation");
      const registry = await this.registry(
        this.ctx.vault.registryHistory.slice(0, e.registrySequence),
        r.receivedAt,
      );
      if (registry.current.digest !== e.checkpointDigest) fail();
      validate("PersistentAgentIdentity", e.identity);
      if (
        e.identity.connectionId !== this.ctx.actor.connectionId ||
        e.identity.clientId !== this.ctx.actor.clientId ||
        e.identity.ownerSubject !== this.ctx.ownerSubject ||
        e.identity.vaultId !== this.ctx.vault.vaultId ||
        e.identity.rootKeyId !== this.ctx.vault.rootKeyId
      )
        fail();
      const signed = parsed(bytes(e.proof.payload), true);
      await registry.binding(args.identityState.binding, e.identity, e.identity, signed.issuedAt);
      const key = registry.cert(
        e.identity.agentSigningKeyId,
        "agent_sig",
        e.identity.connectionId,
        signed.issuedAt,
        e.registrySequence,
      );
      const proof = await verify(e.proof, key.publicJwk, "fv-control+jws");
      validate("PersistentAgentRequestPayload", proof);
      matchBinding(proof, e.identity);
      exact(e.request, [
        "taskId",
        "taskPublicationFingerprint",
        "operationId",
        "expectedVersion",
        "provider",
        "planReferenceHash",
        "reportedStatus",
        "reportedAt",
      ]);
      for (const k of [
        "taskId",
        "taskPublicationFingerprint",
        "operationId",
        "provider",
        "planReferenceHash",
        "reportedStatus",
        "reportedAt",
      ])
        if (!same(e.request[k], r[k])) fail();
      validate("Digest", r.taskPublicationFingerprint);
      validate("Digest", r.requestDigest);
      validate("OperationIdentifier", r.operationId);
      if (r.planReferenceHash !== null) validate("Digest", r.planReferenceHash);
      if (
        !Number.isSafeInteger(r.reportedAt) ||
        r.reportedAt < 0 ||
        r.reportedAt > r.receivedAt + 2 ||
        (["enabled", "paused"].includes(r.reportedStatus) && r.planReferenceHash === null) ||
        proof.path !==
          `/agent/v3/persistent/owners/${e.identity.ownerSubject}/vaults/${e.identity.vaultId}/connections/${e.identity.connectionId}/plans/report` ||
        proof.audience !== args.hubOrigin ||
        proof.method !== "POST" ||
        proof.bodyDigest !== (await digest(e.request)) ||
        proof.bodyDigest !== r.requestDigest ||
        proof.issuedAt > r.receivedAt ||
        proof.expiresAt <= r.receivedAt ||
        e.request.expectedVersion + 1 !== s.version
      )
        fail("invalid_plan_observation");
    } else if (s.reportedEvidence !== null) fail();
    if (s.desired !== null) {
      exact(s.desired, ["taskPublicationFingerprint", "taskVersion", "executionEpoch"]);
      validate("Digest", s.desired.taskPublicationFingerprint);
      integer(s.desired.taskVersion, 1);
      integer(s.desired.executionEpoch, 1);
    }
    if (s.observed !== null) {
      const o = s.observed;
      exact(o, [
        "source",
        "runId",
        "triggerId",
        "taskPublicationFingerprint",
        "runCreatedAt",
        "resultId",
        "receivedAt",
        "nativeScheduleAttested",
      ]);
      identifier(o.runId);
      validate("OperationIdentifier", o.triggerId);
      validate("Digest", o.taskPublicationFingerprint);
      integer(o.runCreatedAt, 0);
      if (
        o.nativeScheduleAttested !== false ||
        (o.resultId === null
          ? o.source !== "hub_run_receipt" || o.receivedAt !== null
          : o.source !== "hub_result_receipt" ||
            !Number.isSafeInteger(o.receivedAt) ||
            o.receivedAt < o.runCreatedAt)
      )
        fail();
      if (o.resultId !== null) identifier(o.resultId);
    }
    return copy(s);
  }
  async result(args: { record: Json; resultId: string }) {
    exact(args, ["record", "resultId"]);
    identifier(args.resultId);
    const { record } = args;
    exact(record, [
      "contractVersion",
      "profile",
      "metadata",
      "receipt",
      "envelope",
      "manifest",
      "manifestFingerprint",
      "identity",
      "binding",
      "rootJwk",
      "registryHistory",
    ]);
    const v = this.ctx.vault;
    if (
      record.contractVersion !== CONTRACT ||
      record.profile !== PROFILE ||
      !same(record.rootJwk, v.rootJwk)
    )
      fail();
    const { context: c } = inspect(record.envelope),
      receipt = record.receipt,
      m = record.manifest;
    if (
      c.objectId !== args.resultId ||
      record.metadata.resultId !== args.resultId ||
      c.objectType !== "result_revision" ||
      c.ownerSubject !== this.ctx.ownerSubject ||
      c.vaultId !== v.vaultId ||
      c.rootKeyId !== v.rootKeyId ||
      !Number.isSafeInteger(receipt.receivedAt) ||
      receipt.receivedAt < c.issuedAt ||
      receipt.receivedAt > this.ctx.now()
    )
      fail();
    // Select an issuance snapshot from the already verified owner's current Root chain.
    if (
      c.registrySequence > v.registryHistory.length ||
      !Array.isArray(record.registryHistory) ||
      !same(
        record.registryHistory.slice(0, c.registrySequence),
        v.registryHistory.slice(0, c.registrySequence),
      )
    )
      fail();
    const registry = await this.registry(
      v.registryHistory.slice(0, c.registrySequence),
      receipt.receivedAt,
    );
    await registry.binding(record.binding, record.identity, record.identity, c.issuedAt);
    matchBinding(c, record.identity);
    matchBinding(m, record.identity);
    validate("PersistentRunManifest", m);
    if (
      m.runId !== "prun_" + (await digest([m.ownerSubject, m.vaultId, m.taskId, m.triggerId])) ||
      m.createdAt > c.issuedAt ||
      c.issuedAt >= m.expiresAt ||
      m.expiresAt > m.createdAt + 7200 ||
      record.manifestFingerprint !== (await digest(m)) ||
      c.manifestFingerprint !== record.manifestFingerprint ||
      m.resultPolicy !== "owner_inbox" ||
      c.objectId !== "presult_" + (await digest([c.ownerSubject, c.vaultId, c.runId]))
    )
      fail();
    for (const k of [
      "runId",
      "taskId",
      "taskVersion",
      "executionEpoch",
      "authorityId",
      "authorityVersion",
    ])
      if (!same(c[k], m[k])) fail();
    for (const [k, value] of Object.entries({
      contractVersion: CONTRACT,
      profile: PROFILE,
      resultId: c.objectId,
      runId: c.runId,
      taskId: c.taskId,
      connectionId: c.connectionId,
      revision: 1,
      publicationId: c.stableOperationId,
      fingerprint: await fingerprint(record.envelope.proof),
      manifestFingerprint: c.manifestFingerprint,
    }))
      if (receipt[k] !== value) fail();
    if (
      record.metadata.resultId !== c.objectId ||
      record.metadata.runId !== c.runId ||
      record.metadata.taskId !== c.taskId ||
      record.metadata.connectionId !== c.connectionId ||
      record.metadata.receivedAt !== receipt.receivedAt
    )
      fail();
    await verifyEnvelope(record.envelope, {
      registry,
      identity: record.identity,
      expected: { ...c, manifestFingerprint: record.manifestFingerprint },
      now: receipt.receivedAt,
      purpose: "owner_history",
    });
    return open(record.envelope, await this.ctx.reader(c.recipients.map((r: Json) => r.keyId)), c);
  }
}
