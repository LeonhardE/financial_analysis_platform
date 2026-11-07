/** Closed persistent runtime: fixed calls only; private handles never cross its boundary. */
import {
  CONTRACT,
  PROFILE,
  BINDING,
  deny,
  exact,
  canonical,
  bytes,
  parsed,
  same,
  identifier,
  digest,
  fingerprint,
  keyId,
  sign,
  validate,
  inspect,
  open,
  seal,
  privatePayload,
  resultContent,
} from "./crypto.mjs";
import { Registry } from "./registry.mjs";
import { verifyConsentChain, permissionFor } from "./consents.mjs";
import { matchBinding, verifyEnvelope, verifyManifest, requestProof } from "./authority.mjs";
import { RuntimeStorage } from "./storage.mjs";
import { dueSlot } from "./schedule.mjs";
const PAIRING = "folioview.runtime-pairing.v1";
export class PersistentRuntime {
  #fetch;
  #storage;
  #origin;
  #clock;
  #config;
  #profile;
  #actor;
  #identity;
  #root;
  #setup;
  #registry;
  #consent;
  #tasks = new Map();
  #runs = new Map();
  constructor({
    origin,
    fetch = globalThis.fetch.bind(globalThis),
    storage = new RuntimeStorage(),
    monotonic = () => performance.now(),
  } = {}) {
    const u = new URL(origin);
    if (u.protocol !== "https:" || u.origin !== origin) deny("invalid_runtime_origin");
    this.#origin = origin;
    this.#fetch = fetch;
    this.#storage = storage;
    this.#clock = { monotonic, started: 0, seconds: 0 };
  }
  now() {
    return Math.floor(this.#clock.seconds + (this.#clock.monotonic() - this.#clock.started) / 1000);
  }
  async #json(path, body = null, max = 4194304) {
    if (
      !path.startsWith("/") ||
      path.includes("//") ||
      path.includes("?") ||
      path.includes("#") ||
      path.split("/").some((p) => p === "." || p === "..")
    )
      deny("invalid_path");
    let response;
    try {
      response = await this.#fetch(this.#origin + path, {
        method: body === null ? "GET" : "POST",
        headers: body === null ? {} : { "Content-Type": "application/json" },
        body: body === null ? undefined : new TextDecoder().decode(canonical(body)),
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      deny("runtime_network_unavailable");
    }
    if (!response.ok) {
      if (response.status === 404) deny("not_found");
      if (response.status === 401 || response.status === 403)
        deny("runtime_authorization_required");
      if (response.status === 409) deny("version_conflict");
      deny("runtime_service_unavailable");
    }
    if (!/^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? ""))
      deny("invalid_response");
    const reader = response.body?.getReader();
    if (!reader) deny("invalid_response");
    let total = 0,
      parts = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > max) {
        await reader.cancel();
        deny("payload_too_large");
      }
      parts.push(value);
    }
    const out = new Uint8Array(total);
    let pos = 0;
    for (const value of parts) {
      out.set(value, pos);
      pos += value.length;
    }
    return parsed(out);
  }
  async #configuration() {
    const c = await this.#json("/agent/v3/runtime/config", null, 16384);
    if (
      c.contractVersion !== CONTRACT ||
      c.runtimeVersion !== "1.0.0" ||
      c.issuer !== this.#origin ||
      !Number.isSafeInteger(c.serverNow) ||
      c.serverNow < 0
    )
      deny("invalid_runtime_configuration");
    this.#config = c;
    this.#clock.seconds = c.serverNow;
    this.#clock.started = this.#clock.monotonic();
    return c;
  }
  #base() {
    if (!this.#actor || !this.#identity) deny("runtime_not_connected");
    const a = this.#actor;
    return `/agent/v3/persistent/owners/${a.ownerSubject}/vaults/${a.vaultId}/connections/${a.connectionId}`;
  }
  async #call(operation, request) {
    const allowed = [
      "session",
      "consent-receipts",
      "tasks",
      "task-input",
      "runs/begin",
      "runs/receipt",
      "runs/input",
      "runs/submit",
      "runs/result-receipt",
    ];
    if (!allowed.includes(operation)) deny("invalid_operation");
    const path = this.#base() + "/" + operation;
    const send = async () =>
      this.#json(path, {
        contractVersion: CONTRACT,
        proof: await requestProof({
          identity: this.#identity,
          audience: this.#origin,
          path,
          request,
          now: this.now(),
          privateKey: this.#profile.signingPrivateKey,
        }),
        request,
      });
    try {
      return await send();
    } catch (e) {
      // A current certificate/revocation error never causes key deletion or user unlock loops.
      // Refresh public server time once; business operation and encrypted body remain identical.
      if (e.code !== "runtime_authorization_required") throw e;
      await this.#configuration();
      return send();
    }
  }
  async #record(name, change) {
    const key = "public:" + (await digest([this.#actor, name]));
    return this.#storage.transact(key, change);
  }
  #checkedActor(value) {
    exact(value, ["ownerSubject", "vaultId", "connectionId", "clientId"]);
    Object.values(value).forEach(identifier);
    return { issuer: this.#origin, ...value };
  }
  async initialize(args) {
    if (this.#actor) deny("already_initialized");
    await this.#configuration();
    exact(args, args.intentId ? ["intentId", "rootKeyId"] : ["actor", "identity", "rootKeyId"]);
    if (typeof args.rootKeyId !== "string" || bytes(args.rootKeyId).length !== 32)
      deny("invalid_root_pin");
    this.#root = args.rootKeyId;
    if (args.intentId) {
      identifier(args.intentId);
      const state = await this.#json("/agent/v3/runtime/setups/" + args.intentId, null, 24576),
        s = state.setup;
      if (s.intentId !== args.intentId || s.expiresAt <= this.now()) deny("setup_expired");
      this.#setup = s;
      this.#actor = this.#checkedActor(
        Object.fromEntries(
          ["ownerSubject", "vaultId", "connectionId", "clientId"].map((k) => [k, s[k]]),
        ),
      );
      this.#profile = await this.#storage.profile(this.#actor, { create: state.paired === null });
      if (state.paired) {
        await this.#adopt(state.paired.identity);
        await this.synchronize();
        return this.status();
      }
      const key = "offer:" + s.intentId;
      let saved = await this.#record(key, (v) => ({ result: v }));
      if (!saved) {
        const signingKeyId = await keyId(this.#profile.signingPublicJwk);
        const proof = await sign(
          {
            contractVersion: CONTRACT,
            profile: PAIRING,
            artifactType: "runtime_key_offer",
            ...Object.fromEntries(
              [
                "intentId",
                "ownerSubject",
                "vaultId",
                "connectionId",
                "clientId",
                "authorizationId",
                "nonce",
              ].map((k) => [k, s[k]]),
            ),
            issuedAt: this.now(),
            expiresAt: Math.min(this.now() + 300, s.expiresAt),
            agentId: "agent_" + signingKeyId,
            signingPublicJwk: this.#profile.signingPublicJwk,
            encryptionPublicJwk: this.#profile.encryptionPublicJwk,
          },
          this.#profile.signingPrivateKey,
          signingKeyId,
          "fv-control+jws",
        );
        // The immutable candidate is computed outside IDB, then create-only committed.
        const candidate = { proof, fingerprint: await fingerprint(proof) };
        saved = await this.#record(key, (v) =>
          v ? { result: v } : { write: candidate, result: candidate },
        );
      }
      const response = await this.#json(
        "/agent/v3/runtime/setups/" + s.intentId + "/offers",
        { contractVersion: CONTRACT, proof: saved.proof },
        24576,
      );
      if (response.offerFingerprint !== saved.fingerprint) deny("offer_conflict");
      return {
        state: "awaiting_owner_approval",
        setupIntentId: s.intentId,
        offerFingerprint: saved.fingerprint,
      };
    }
    this.#actor = this.#checkedActor(args.actor);
    this.#profile = await this.#storage.profile(this.#actor);
    await this.#adopt(args.identity);
    await this.synchronize();
    return this.status();
  }
  async #adopt(identity) {
    validate("PersistentAgentIdentity", identity);
    if (identity.rootKeyId !== this.#root) deny("root_pin_mismatch");
    for (const k of ["ownerSubject", "vaultId", "connectionId", "clientId"])
      if (identity[k] !== this.#actor[k]) deny("recipient_binding_mismatch");
    if (
      identity.agentSigningKeyId !== (await keyId(this.#profile.signingPublicJwk)) ||
      identity.agentEncryptionKeyId !== (await keyId(this.#profile.encryptionPublicJwk)) ||
      identity.status !== "active"
    )
      deny("lost_private_keys");
    this.#identity = structuredClone(identity);
  }
  async pairing() {
    if (!this.#setup) deny("invalid_operation");
    const response = await this.#json(
      "/agent/v3/runtime/setups/" + this.#setup.intentId,
      null,
      24576,
    );
    if (response.paired) {
      await this.#adopt(response.paired.identity);
      await this.synchronize();
      return this.status();
    }
    return {
      state: "awaiting_owner_approval",
      setupIntentId: this.#setup.intentId,
      offerFingerprint: response.offerFingerprint,
    };
  }
  async synchronize() {
    const response = await this.#call("session", {});
    if (!same(response.identity, this.#identity) || (await keyId(response.rootJwk)) !== this.#root)
      deny("recipient_binding_mismatch");
    const anchor = this.#profile.pins ?? {
      rootKeyId: this.#root,
      registrySequence: response.registryHistory.length,
      checkpointDigest: await digest(
        parsed(bytes(response.registryHistory.at(-1).checkpoint.payload), true),
      ),
    };
    const registry = await new Registry({
      ...anchor,
      rootJwk: response.rootJwk,
      ownerSubject: this.#actor.ownerSubject,
      vaultId: this.#actor.vaultId,
      rootEpoch: 1,
    }).load(response.registryHistory, this.now());
    await registry.binding(response.binding, this.#identity, this.#actor, this.now());
    const receipts = [];
    for (const operationId of response.consentOperations)
      receipts.push(await this.#call("consent-receipts", { operationId }));
    const oldPin = await this.#record("consent-pin", (v) => ({ result: v }));
    const consent = await verifyConsentChain({
      consent: response.consent,
      receipts,
      identity: this.#identity,
      registry,
      pin: oldPin,
    });
    if (consent) {
      const pin = { version: consent.version, digest: await digest(consent) };
      await this.#record("consent-pin", (v) => {
        if (
          v &&
          (v.version > pin.version || (v.version === pin.version && v.digest !== pin.digest))
        )
          deny("consent_rollback");
        return { write: pin, result: pin };
      });
    }
    this.#profile = await this.#storage.bind(this.#actor, this.#identity, registry.pin());
    this.#registry = registry;
    this.#consent = consent;
    return this.status();
  }
  status() {
    return {
      state: this.#registry
        ? "connected"
        : this.#setup
          ? "awaiting_owner_approval"
          : "not_connected",
      connectionId: this.#identity?.connectionId ?? null,
      registrySequence: this.#registry?.sequence ?? null,
      consentVersion: this.#consent?.version ?? null,
    };
  }
  async #task(taskId) {
    identifier(taskId);
    const response = await this.#call("task-input", { taskId }),
      c = response.authority?.context;
    if (
      !c ||
      c.taskId !== taskId ||
      response.authority.fingerprint !== (await fingerprint(response.envelope.proof)) ||
      response.authority.publicationId !== c.stableOperationId
    )
      deny("invalid_task_authority");
    await verifyEnvelope(response.envelope, {
      registry: this.#registry,
      identity: this.#identity,
      expected: c,
      now: this.now(),
    });
    const pin = { version: c.authorityVersion, digest: await digest(c) };
    await this.#record("task:" + taskId, (v) => {
      if (v && (v.version > pin.version || (v.version === pin.version && v.digest !== pin.digest)))
        deny("task_rollback");
      return { write: pin, result: pin };
    });
    const task = await open(response.envelope, this.#profile.encryptionPrivateKey, c);
    for (const b of c.resourceBindings)
      if (
        !this.#consent?.permissions.some(
          (p) => p.status === "active" && same(p.ref, b.ref) && p.sourceEpoch === b.sourceEpoch,
        )
      )
        deny("insufficient_scope");
    const value = {
      task,
      context: c,
      fingerprint: response.authority.fingerprint,
      publicationId: response.authority.publicationId,
    };
    this.#tasks.set(taskId, value);
    return value;
  }
  async tasks() {
    await this.synchronize();
    const response = await this.#call("tasks", {});
    if (!Array.isArray(response.tasks) || response.tasks.length > 128) deny("invalid_tasks");
    const result = [];
    for (const item of response.tasks) {
      const t = await this.#task(item.taskId);
      if (item.fingerprint !== t.fingerprint || item.taskVersion !== t.context.taskVersion)
        deny("version_conflict");
      result.push({
        taskId: item.taskId,
        taskVersion: item.taskVersion,
        task: t.task,
        deliveryExpectation: t.task.deliveryExpectation,
      });
    }
    return result;
  }
  async due() {
    const tasks = await this.tasks(),
      result = [];
    for (const task of tasks) {
      const slot = await dueSlot(this.#actor, task.taskId, task.deliveryExpectation, this.now());
      if (slot) result.push({ taskId: task.taskId, taskVersion: task.taskVersion, ...slot });
    }
    return result;
  }
  async begin({ taskId, triggerId }) {
    identifier(taskId);
    validate("OperationIdentifier", triggerId);
    await this.synchronize();
    const t = await this.#task(taskId);
    const operationId =
      "begin_" + (await digest([this.#actor.ownerSubject, this.#actor.vaultId, taskId, triggerId]));
    const response = await this.#call("runs/begin", {
      taskId,
      triggerId,
      operationId,
      taskPublicationFingerprint: t.fingerprint,
    });
    const checked = await verifyManifest(response.manifest, {
      identity: this.#identity,
      taskContext: t.context,
      taskFingerprint: t.fingerprint,
      consent: this.#consent,
      now: this.now(),
    });
    if (
      checked.fingerprint !== response.manifestFingerprint ||
      checked.manifest.triggerId !== triggerId ||
      checked.manifest.stableOperationId !== operationId
    )
      deny("invalid_manifest");
    await this.#record("run:" + checked.manifest.runId, (v) => {
      if (v && !same(v, checked.manifest)) deny("run_conflict");
      return { write: checked.manifest, result: checked.manifest };
    });
    this.#runs.set(checked.manifest.runId, { ...checked, task: t });
    return {
      runId: checked.manifest.runId,
      manifestFingerprint: checked.fingerprint,
      task: t.task,
      inputs: checked.manifest.inputs.map((i) => ({
        publicationId: i.publicationId,
        ref: i.ref,
        sourceRevision: i.sourceRevision,
      })),
      state: response.state,
      resultId: response.resultId,
    };
  }
  async #run(runId) {
    identifier(runId);
    await this.synchronize();
    const response = await this.#call("runs/receipt", { runId }),
      m = response.manifest;
    if (m.runId !== runId) deny("invalid_manifest");
    const local = await this.#record("run:" + runId, (v) => ({ result: v }));
    if (local && !same(local, m)) deny("run_conflict");
    const t = await this.#task(m.taskId),
      checked = await verifyManifest(m, {
        identity: this.#identity,
        taskContext: t.context,
        taskFingerprint: t.fingerprint,
        consent: this.#consent,
        now: this.now(),
      });
    if (checked.fingerprint !== response.manifestFingerprint) deny("invalid_manifest");
    return { ...checked, task: t };
  }
  async input({ runId, publicationId }) {
    validate("OperationIdentifier", publicationId);
    const r = await this.#run(runId),
      item = r.manifest.inputs.find((i) => i.publicationId === publicationId);
    if (!item) deny("insufficient_scope");
    const response = await this.#call("runs/input", { runId, publicationId }),
      c = inspect(response.envelope).context;
    if (
      response.manifestFingerprint !== r.fingerprint ||
      (await fingerprint(response.envelope.proof)) !== item.publicationFingerprint ||
      c.objectId !== item.objectId
    )
      deny("recipient_binding_mismatch");
    for (const k of ["ref", "sourceEpoch", "sourceRevision", "permissionId", "permissionEpoch"])
      if (!same(c[k], item[k])) deny("recipient_binding_mismatch");
    permissionFor(this.#consent, c);
    await verifyEnvelope(response.envelope, {
      registry: this.#registry,
      identity: this.#identity,
      expected: { ...c, ...item },
      now: this.now(),
    });
    return {
      runId,
      publicationId,
      ref: item.ref,
      sourceRevision: item.sourceRevision,
      resource: await open(response.envelope, this.#profile.encryptionPrivateKey, c),
    };
  }
  async submit({ runId, report }) {
    identifier(runId);
    const operationId =
      "report_" + (await digest([this.#actor.ownerSubject, this.#actor.vaultId, runId]));
    // Exact unknown-outcome retry does not re-encrypt or require still-readable inputs.
    let carrier = await this.#storage.outbox(this.#actor, operationId);
    if (!carrier) {
      const r = await this.#run(runId);
      if (r.manifest.resultPolicy !== "owner_inbox") deny("insufficient_scope");
      resultContent(report, r.task.task.outputSpec);
      const registry = this.#registry,
        recipients = [];
      for (const cert of registry.current.keys.values())
        if (["device_enc", "recovery_enc"].includes(cert.role)) {
          try {
            registry.cert(cert.keyId, cert.role, null, this.now());
            recipients.push({ keyId: cert.keyId, role: cert.role });
          } catch {}
        }
      recipients.sort((a, b) => (a.keyId < b.keyId ? -1 : 1));
      if (!recipients.some((r) => r.role === "recovery_enc")) deny("key_authorization_required");
      const context = {
        contractVersion: CONTRACT,
        profile: PROFILE,
        ...Object.fromEntries(BINDING.map((k) => [k, this.#identity[k]])),
        ...Object.fromEntries(
          ["taskId", "taskVersion", "executionEpoch", "authorityId", "authorityVersion"].map(
            (k) => [k, r.manifest[k]],
          ),
        ),
        objectId:
          "presult_" + (await digest([this.#actor.ownerSubject, this.#actor.vaultId, runId])),
        objectType: "result_revision",
        purpose: "save_report",
        revision: 1,
        expectedRevision: 0,
        runId,
        manifestFingerprint: r.fingerprint,
        registrySequence: registry.sequence,
        checkpointDigest: registry.current.digest,
        keyEpoch: registry.current.keyEpoch,
        stableOperationId: operationId,
        issuedAt: this.now(),
        recipients,
      };
      const publicKeys = Object.fromEntries(
        recipients.map((r) => [r.keyId, registry.current.keys.get(r.keyId).publicJwk]),
      );
      const candidate = await seal(report, context, publicKeys, this.#profile.signingPrivateKey);
      carrier = await this.#storage.originalCiphertext(this.#actor, operationId, candidate);
    }
    const response = await this.#call("runs/submit", { runId, operationId, envelope: carrier });
    return this.#receipt(response, carrier, runId);
  }
  async receipt({ runId }) {
    identifier(runId);
    const operationId =
        "report_" + (await digest([this.#actor.ownerSubject, this.#actor.vaultId, runId])),
      carrier = await this.#storage.outbox(this.#actor, operationId);
    if (!carrier) deny("not_found");
    return this.#receipt(await this.#call("runs/result-receipt", { runId }), carrier, runId);
  }
  async #receipt(value, carrier, runId) {
    const c = inspect(carrier).context;
    for (const [k, want] of Object.entries({
      contractVersion: CONTRACT,
      profile: PROFILE,
      runId,
      resultId: c.objectId,
      taskId: c.taskId,
      connectionId: c.connectionId,
      revision: 1,
      publicationId: c.stableOperationId,
      fingerprint: await fingerprint(carrier.proof),
      manifestFingerprint: c.manifestFingerprint,
    }))
      if (value[k] !== want) deny("invalid_result_receipt");
    if (!Number.isSafeInteger(value.receivedAt) || value.receivedAt < c.issuedAt)
      deny("invalid_result_receipt");
    return { state: "saved", ...value };
  }
  clear() {
    this.#tasks.clear();
    this.#runs.clear();
    return this.status();
  }
}

export { dueSlot };
