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
  approveCredential,
  credentialStatus,
  DEFAULT_CREDENTIAL_SECONDS,
  CREDENTIAL_NOTICE_SECONDS,
} from "../../../packages/encrypted-workspace/dist/core.mjs";
import { VaultError, type Json, type Vault, type RegistryBundle } from "./encrypted-types";
const AGENT = "folioview.persistent-agent-identity.v1";
function fail(code = "binding_mismatch"): never {
  throw new VaultError(code);
}
const copy = <T>(v: T): T => structuredClone(v);
const buffer = (value: Uint8Array): ArrayBuffer => new Uint8Array(value).buffer;
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
};
export class PersistentOwner {
  constructor(private readonly ctx: Context) {}
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
  private async actor(identity: Json, binding: Json, registry: Registry, at = this.ctx.now()) {
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
    await registry.binding(binding, identity, identity, at);
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
  private async certifyAgent(p: Json) {
    const v = this.ctx.vault,
      registry = await this.registry();
    const bundle = copy(v.registryHistory.at(-1)!);
    const known = [...registry.current.keys.values()].filter(
      (c) => c.connectionId === p.connectionId && ["agent_sig", "agent_enc"].includes(c.role),
    );
    const sig = await keyId(p.signingPublicJwk),
      enc = await keyId(p.encryptionPublicJwk),
      now = this.ctx.now();
    const registered =
      known.filter((c) => c.principalId === p.agentId && [sig, enc].includes(c.keyId)).length === 2;
    let registryUpdate: Json | null = null,
      accepted = registry;
    if (!registered) {
      if (bundle.entries.length + 2 > 64 || v.registryHistory.length >= 32) fail("device_limit");
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
          expiresAt: now + DEFAULT_CREDENTIAL_SECONDS,
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
  /** Read-only verification also works after Agent expiry; no old Agent secret is used. */
  async credentialState(state: Json, hubOrigin: string) {
    exact(state, [
      "contractVersion",
      "profile",
      "identity",
      "binding",
      "lease",
      "approval",
      "status",
      "defaultValiditySeconds",
      "noticeSeconds",
    ]);
    if (
      state.contractVersion !== CONTRACT ||
      state.profile !== "folioview.agent-credential.v1" ||
      state.defaultValiditySeconds !== DEFAULT_CREDENTIAL_SECONDS ||
      state.noticeSeconds !== CREDENTIAL_NOTICE_SECONDS
    )
      fail();
    if (state.lease === null) return { status: "reauthorization_required", expiresAt: null };
    validate("AgentCredentialLease", state.lease);
    validate("PersistentAgentIdentity", state.identity);
    const payload = parsed(bytes(state.approval.payload), true);
    validate("AgentCredentialApproval", payload);
    const registry = await this.registry(
      this.ctx.vault.registryHistory.slice(0, payload.registrySequence),
      payload.issuedAt,
    );
    const identity = { ...state.identity, identityEpoch: 1, status: "active", revokedAt: null };
    await this.actor(identity, state.binding, registry, payload.issuedAt);
    const author = registry.cert(payload.deviceSigningKeyId, "device_sig", null, payload.issuedAt);
    await verify(state.approval, author.publicJwk, "fv-control+jws");
    if (
      !author.capabilities.includes("control_write") ||
      payload.audience !== hubOrigin ||
      payload.registrySequence !== registry.sequence ||
      payload.checkpointDigest !== registry.current.digest ||
      payload.keyEpoch !== registry.current.keyEpoch ||
      payload.issuedAt < Math.max(author.notBefore, registry.current.issuedAt) ||
      payload.issuedAt < identity.registeredAt ||
      payload.issuedAt > this.ctx.now()
    )
      fail();
    for (const k of BINDING) if (!same(payload[k], identity[k])) fail();
    const { sig, enc } = registry.agent(identity, payload.issuedAt);
    if (
      payload.expiresAt <= payload.issuedAt ||
      payload.expiresAt >
        Math.min(payload.issuedAt + DEFAULT_CREDENTIAL_SECONDS, sig.expiresAt, enc.expiresAt)
    )
      fail();
    const omitted = new Set([
      "artifactType",
      "deviceSigningKeyId",
      "stableOperationId",
      "registrySequence",
      "checkpointDigest",
      "keyEpoch",
    ]);
    const derived = {
      ...Object.fromEntries(Object.entries(payload).filter(([k]) => !omitted.has(k))),
      credentialFingerprint: await fingerprint(state.approval),
      status: state.lease.status,
    };
    if (!same(derived, state.lease)) fail();
    const status =
      state.identity.status !== "active" || state.status === "revoked"
        ? "revoked"
        : credentialStatus(state.lease, this.ctx.now());
    return { status, expiresAt: state.lease.expiresAt };
  }
  private async credentialOffer(args: Json) {
    exact(args, ["handoff", "setup", "current", "hubOrigin"]);
    const h = args.handoff,
      s = args.setup;
    exact(h, ["version", "issuer", "vaultId", "connectionId", "setupIntentId", "secret"]);
    exact(s, [
      "setupIntentId",
      "ownerSubject",
      "vaultId",
      "connectionId",
      "clientId",
      "authorizationId",
      "issuedAt",
      "expiresAt",
      "expectedGeneration",
      "expectedCredentialFingerprint",
      "offer",
      "consumedBy",
      "issuer",
      "provider",
      "predecessorConnectionId",
    ]);
    if (
      h.version !== 1 ||
      h.issuer !== args.hubOrigin ||
      s.issuer !== args.hubOrigin ||
      h.vaultId !== this.ctx.vault.vaultId ||
      h.connectionId !== this.ctx.actor?.connectionId ||
      s.connectionId !== h.connectionId ||
      s.clientId !== this.ctx.actor?.clientId ||
      s.ownerSubject !== this.ctx.ownerSubject ||
      s.vaultId !== h.vaultId ||
      s.setupIntentId !== h.setupIntentId ||
      !["muse", "chatgpt"].includes(s.provider) ||
      !s.offer ||
      s.consumedBy !== null ||
      !Number.isSafeInteger(s.issuedAt) ||
      s.expiresAt !== s.issuedAt + 600 ||
      s.issuedAt > this.ctx.now() ||
      s.expiresAt <= this.ctx.now() ||
      !Number.isSafeInteger(s.expectedGeneration) ||
      s.expectedGeneration < 0 ||
      bytes(h.secret).length !== 32
    )
      fail("agent_unavailable");
    identifier(s.setupIntentId);
    identifier(s.authorizationId);
    if (s.predecessorConnectionId !== null) identifier(s.predecessorConnectionId);
    await this.credentialState(args.current, args.hubOrigin);
    const current = args.current.lease;
    if (
      s.expectedGeneration !== (current?.generation ?? 0) ||
      s.expectedCredentialFingerprint !== (current?.credentialFingerprint ?? null)
    )
      fail("version_conflict");
    const fields = [
      "setupIntentId",
      "ownerSubject",
      "vaultId",
      "connectionId",
      "clientId",
      "authorizationId",
      "issuedAt",
      "expiresAt",
      "expectedGeneration",
      "expectedCredentialFingerprint",
    ];
    const context = {
      profile: "folioview.agent-pairing.v1",
      issuer: s.issuer,
      provider: s.provider,
      ...Object.fromEntries(fields.map((k) => [k, s[k]])),
    };
    exact(s.offer, ["version", "iv", "ciphertext"]);
    if (
      s.offer.version !== 1 ||
      bytes(s.offer.iv).length !== 12 ||
      bytes(s.offer.ciphertext).length > 8192
    )
      fail();
    const key = await crypto.subtle.importKey(
      "raw",
      buffer(bytes(h.secret)),
      { name: "AES-GCM" },
      false,
      ["decrypt", "encrypt"],
    );
    let signed: Json;
    try {
      signed = parsed(
        new Uint8Array(
          await crypto.subtle.decrypt(
            {
              name: "AES-GCM",
              iv: buffer(bytes(s.offer.iv)),
              additionalData: buffer(canonical({ ...context, phase: "offer" })),
            },
            key,
            buffer(bytes(s.offer.ciphertext)),
          ),
        ),
      );
    } catch {
      fail("agent_unavailable");
    }
    const offer = parsed(bytes(signed.payload), true);
    exact(offer, [
      "contractVersion",
      "profile",
      "artifactType",
      "issuer",
      "provider",
      ...fields,
      "agentId",
      "signingPublicJwk",
      "encryptionPublicJwk",
    ]);
    const sig = await keyId(offer.signingPublicJwk),
      enc = await keyId(offer.encryptionPublicJwk);
    await verify(signed, offer.signingPublicJwk, "fv-control+jws");
    if (
      offer.contractVersion !== CONTRACT ||
      offer.profile !== "folioview.agent-key-offer.v1" ||
      offer.artifactType !== "agent_key_offer" ||
      offer.issuer !== s.issuer ||
      offer.provider !== s.provider ||
      offer.agentId !== "agent_" + sig ||
      sig === enc
    )
      fail();
    for (const k of fields) if (!same(offer[k], s[k])) fail();
    return { offer, context, key, current };
  }
  async inspectCredentialSetup(args: Json) {
    const { offer } = await this.credentialOffer(args);
    return {
      provider: offer.provider,
      expiresAt: args.setup.expiresAt,
      reviewDigest: await digest([args.setup, args.current]),
    };
  }
  async expiredCredentialPending(args: Json) {
    const { packet, previousSetup, ...replacement } = args;
    await this.credentialOffer(replacement);
    const p = parsed(bytes(packet?.body?.command?.approval?.payload), true);
    const previous = previousSetup;
    if (
      packet.kind !== "credential" ||
      packet.connectionId !== this.ctx.actor?.connectionId ||
      packet.setupIntentId !== previous.setupIntentId ||
      p.setupIntentId !== previous.setupIntentId ||
      p.stableOperationId !== packet.operationId ||
      p.ownerSubject !== this.ctx.ownerSubject ||
      p.vaultId !== this.ctx.vault.vaultId ||
      p.clientId !== this.ctx.actor?.clientId ||
      previous.ownerSubject !== p.ownerSubject ||
      previous.vaultId !== p.vaultId ||
      previous.connectionId !== p.connectionId ||
      previous.clientId !== p.clientId ||
      previous.setupIntentId === args.setup.setupIntentId ||
      previous.consumedBy !== null ||
      !Number.isSafeInteger(previous.issuedAt) ||
      previous.expiresAt !== previous.issuedAt + 600 ||
      previous.expiresAt > args.setup.issuedAt ||
      previous.expiresAt > this.ctx.now()
    )
      fail("persistent_operation_pending");
    return { operationId: packet.operationId };
  }
  async credentialEnrollment(args: Json) {
    const { offer, context, key, current } = await this.credentialOffer(args);
    const prepared = await this.certifyAgent({ ...offer, intentId: offer.setupIntentId });
    const binding = prepared.body.command;
    const accepted = await this.registry(
      prepared.registryUpdate
        ? [...this.ctx.vault.registryHistory, prepared.registryUpdate.registryBundle]
        : this.ctx.vault.registryHistory,
    );
    const payload = {
      ...parsed(bytes(binding.payload), true),
      profile: "folioview.agent-credential.v1",
      artifactType: "agent_credential_approve",
      bindingFingerprint: prepared.identity.bindingFingerprint,
      generation: (current?.generation ?? 0) + 1,
      previousCredentialFingerprint: current?.credentialFingerprint ?? null,
      setupIntentId: offer.setupIntentId,
      audience: args.hubOrigin,
      expiresAt: this.ctx.now() + DEFAULT_CREDENTIAL_SECONDS,
    };
    const { sig, enc } = accepted.agent(prepared.identity, this.ctx.now());
    payload.expiresAt = Math.min(payload.expiresAt, sig.expiresAt, enc.expiresAt);
    const approval = await sign(
      payload,
      this.ctx.deviceSigningKey,
      this.ctx.deviceSigningKeyId,
      "fv-control+jws",
    );
    const lease = await approveCredential(approval, {
      registry: accepted,
      identity: prepared.identity,
      currentLease: current,
      setupIntentId: offer.setupIntentId,
      audience: args.hubOrigin,
      now: this.ctx.now(),
    });
    const activation = {
      contractVersion: CONTRACT,
      profile: "folioview.agent-activation.v1",
      setupIntentId: offer.setupIntentId,
      issuer: args.hubOrigin,
      provider: offer.provider,
      actor: Object.fromEntries(
        ["ownerSubject", "vaultId", "connectionId", "clientId"].map((k) => [k, offer[k]]),
      ),
      rootJwk: this.ctx.vault.rootJwk,
      rootKeyId: this.ctx.vault.rootKeyId,
      anchor: accepted.pin(),
      identity: prepared.identity,
      binding,
      lease,
      approval,
      previousLease: current,
    };
    const iv = crypto.getRandomValues(new Uint8Array(12)),
      clear = canonical(activation);
    if (clear.length + 16 > 8192) fail("invalid_data");
    const encrypted = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: buffer(canonical({ ...context, phase: "activation" })),
        },
        key,
        buffer(clear),
      ),
    );
    const b64 = (v: Uint8Array) =>
      btoa(String.fromCharCode(...v))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    return {
      ...prepared,
      kind: "credential",
      setupIntentId: offer.setupIntentId,
      body: {
        contractVersion: CONTRACT,
        command: {
          binding,
          approval,
          activation: { version: 1, iv: b64(iv), ciphertext: b64(encrypted) },
        },
      },
      expectedLease: lease,
    };
  }
  async historicalPolicy(state: Json, resourceState: Json, receipts: Json[]) {
    const p = parsed(bytes(state.binding.payload), true);
    const registry = await this.registry();
    const historical = await this.registry(
      this.ctx.vault.registryHistory.slice(0, p.registrySequence),
      p.issuedAt,
    );
    const identity = { ...state.identity, identityEpoch: 1, status: "active", revokedAt: null };
    await this.actor(identity, state.binding, historical, p.issuedAt);
    if (
      resourceState.contractVersion !== CONTRACT ||
      resourceState.profile !== CONSENT_PROFILE ||
      !same(
        resourceState.operations,
        receipts.map((r) => r.operationId),
      )
    )
      fail();
    return verifyConsentChain({
      consent: resourceState.consent,
      receipts,
      identity,
      registry,
    });
  }
  async restoration(args: {
    current: Json;
    sources: Json[];
    hubOrigin: string;
    legacyConnectionId: string | null;
  }) {
    if (!this.ctx.actor || !Array.isArray(args.sources) || args.sources.length > 32) fail();
    await this.credentialState(args.current, args.hubOrigin);
    let expected: Json | null = args.current.identity
      ? {
          connectionId: args.current.identity.connectionId,
          bindingFingerprint: args.current.identity.bindingFingerprint,
          credentialFingerprint: args.current.lease?.credentialFingerprint ?? null,
          generation: args.current.lease?.generation ?? 0,
        }
      : null;
    if (!expected && args.legacyConnectionId !== null) {
      identifier(args.legacyConnectionId);
      expected = args.sources[0]?.state?.source;
      if (
        !expected ||
        expected.connectionId !== args.legacyConnectionId ||
        expected.generation !== 0
      )
        fail();
    }
    const seen = new Set<string>(),
      decided = new Set<string>(),
      permissions: Json[] = [],
      identities: Json[] = [];
    for (const entry of args.sources) {
      exact(entry, ["state", "receipts"]);
      const value = entry.state;
      exact(value, [
        "contractVersion",
        "profile",
        "source",
        "historical",
        "identityState",
        "credential",
        "resourceState",
        "predecessor",
      ]);
      if (
        value.contractVersion !== CONTRACT ||
        value.profile !== "folioview.agent-restoration.v1" ||
        typeof value.historical !== "boolean" ||
        !expected ||
        !same(expected, value.source)
      )
        fail();
      const ref = value.source;
      exact(ref, ["connectionId", "bindingFingerprint", "credentialFingerprint", "generation"]);
      identifier(ref.connectionId);
      validate("Digest", ref.bindingFingerprint);
      integer(ref.generation, 0);
      if (ref.credentialFingerprint !== null) validate("Digest", ref.credentialFingerprint);
      const key = ref.connectionId + ":" + ref.bindingFingerprint;
      if (seen.has(key)) fail("version_conflict");
      seen.add(key);
      const state = value.identityState;
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
        state.identity.clientId !== this.ctx.actor.clientId ||
        state.identity.connectionId !== ref.connectionId ||
        state.identity.bindingFingerprint !== ref.bindingFingerprint
      )
        fail();
      const sourceOwner = new PersistentOwner({
        ...this.ctx,
        actor: { connectionId: ref.connectionId, clientId: this.ctx.actor.clientId },
      });
      if (value.credential !== null) {
        exact(value.credential, ["lease", "approval"]);
        await sourceOwner.credentialState(
          {
            contractVersion: CONTRACT,
            profile: "folioview.agent-credential.v1",
            identity: state.identity,
            binding: state.binding,
            lease: value.credential.lease,
            approval: value.credential.approval,
            status: state.identity.status === "revoked" ? "revoked" : "active",
            defaultValiditySeconds: DEFAULT_CREDENTIAL_SECONDS,
            noticeSeconds: CREDENTIAL_NOTICE_SECONDS,
          },
          args.hubOrigin,
        );
        if (
          ref.generation !== value.credential.lease.generation ||
          ref.credentialFingerprint !== value.credential.lease.credentialFingerprint
        )
          fail();
      } else if (ref.generation !== 0 || ref.credentialFingerprint !== null) fail();
      const policy = await sourceOwner.historicalPolicy(state, value.resourceState, entry.receipts);
      identities.push({ ...state.identity, identityEpoch: 1, status: "active", revokedAt: null });
      const refs = new Map<string, Json[]>();
      for (const permission of policy?.permissions ?? []) {
        const token = JSON.stringify([
          permission.ref.kind,
          permission.ref.sourceService,
          permission.ref.resourceId,
          permission.ref.incarnation,
        ]);
        refs.set(token, [...(refs.get(token) ?? []), permission]);
      }
      for (const [token, items] of refs) {
        if (decided.has(token)) continue;
        decided.add(token);
        const active = items.find(
          (v) => v.status === "active" && v.versionPolicy === "current_and_future",
        );
        if (active) permissions.push(copy(active));
      }
      expected = value.predecessor;
      if (expected !== null) {
        exact(expected, [
          "connectionId",
          "bindingFingerprint",
          "credentialFingerprint",
          "generation",
        ]);
        if (ref.generation > 1) {
          if (
            expected.connectionId !== ref.connectionId ||
            expected.generation + 1 !== ref.generation ||
            expected.credentialFingerprint !== value.credential?.lease.previousCredentialFingerprint
          )
            fail();
        } else if (
          ref.generation !== 1 ||
          expected.generation !== 0 ||
          expected.credentialFingerprint !== null ||
          expected.connectionId === ref.connectionId
        )
          fail();
      } else if (ref.generation > 1) fail();
    }
    if (expected !== null) fail("version_conflict");
    return {
      permissions,
      identities,
      reviewDigest: await digest([
        args.current.identity,
        args.sources.map((v) => [v.state.source, v.state.resourceState.consent]),
      ]),
    };
  }
  private async restorationControl(args: Json) {
    const current = args.credentialState;
    const status = await this.credentialState(current, args.hubOrigin);
    if (
      !["active", "expiring"].includes(status.status) ||
      !same(current.identity, args.identityState.identity) ||
      !same(current.binding, args.identityState.binding)
    )
      fail("agent_unavailable");
    const scope = await this.restoration({
      current,
      sources: args.sources,
      hubOrigin: args.hubOrigin,
      legacyConnectionId: null,
    });
    const { consent } = await this.policy(args.identityState, args.resourceState, args.receipts);
    const blocked = (consent?.permissions ?? []).filter(
      (p: Json) =>
        p.status === "revoked" &&
        !(consent?.permissions ?? []).some(
          (v: Json) => v.status === "active" && same(v.ref, p.ref),
        ),
    );
    return {
      ...scope,
      permissions: scope.permissions.filter((p) => !blocked.some((v: Json) => same(v.ref, p.ref))),
    };
  }
  async restoredConsent(args: Json) {
    const scope = await this.restorationControl(args);
    for (const resource of args.resources) {
      const allowed = scope.permissions.find(
        (p) => same(p.ref, resource.ref) && p.sourceEpoch === resource.sourceEpoch,
      );
      if (!allowed || resource.revision < allowed.fromRevision) fail("resource_not_approved");
    }
    return this.approve(args as any);
  }
  async restoredTask(args: Json) {
    const scope = await this.restorationControl(args),
      authority = args.authority.authority;
    if (
      !authority ||
      !scope.identities.some((identity) =>
        BINDING.every((k) => same(authority.context[k], identity[k])),
      )
    )
      fail("replacement_review_required");
    for (const binding of args.metadata.resourceBindings)
      if (
        !scope.permissions.some(
          (p) => same(p.ref, binding.ref) && p.sourceEpoch === binding.sourceEpoch,
        )
      )
        fail("resource_not_approved");
    return this.task({ ...args, allowReassign: true } as any);
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
    if (packet.kind === "credential") {
      exact(receipt, [
        "contractVersion",
        "profile",
        "operationId",
        "fingerprint",
        "identity",
        "binding",
        "lease",
        "approval",
      ]);
      if (
        receipt.contractVersion !== CONTRACT ||
        receipt.profile !== "folioview.agent-credential.v1" ||
        receipt.operationId !== packet.operationId ||
        receipt.fingerprint !== (await fingerprint(packet.body.command.approval)) ||
        !same(receipt.identity, packet.identity) ||
        !same(receipt.binding, packet.body.command.binding) ||
        !same(receipt.approval, packet.body.command.approval) ||
        !same(receipt.lease, packet.expectedLease)
      )
        fail();
      return { operationId: packet.operationId };
    }
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
        !["muse", "chatgpt"].includes(r.provider) ||
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
