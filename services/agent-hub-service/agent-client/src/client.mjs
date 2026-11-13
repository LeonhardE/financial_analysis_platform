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
  verify,
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
import {
  requireCurrentCredential,
  approveCredential,
} from "../../../../packages/encrypted-workspace/dist/core.mjs";
import { verifyCenter, assignedTrigger, assignedDue, centerRequestProof } from "./task-center.mjs";
import { dueSlot } from "./schedule.mjs";
import { checkInputPolicy } from "./policy.mjs";
const PLAN = "folioview.persistent-native-plan.v1",
  PLAN_INTENT = "folioview.runtime-plan-pending.v1";
const PLAN_STATUS = ["enabled", "paused", "removed", "unconfirmed"];
export class AgentClient {
  #fetch;
  #storage;
  #origin;
  #clock;
  #wall;
  #config;
  #profile;
  #actor;
  #identity;
  #root;
  #credential;
  #provider;
  #registry;
  #consent;
  #tasks = new Map();
  #runs = new Map();
  constructor({
    origin,
    fetch = globalThis.fetch.bind(globalThis),
    storage,
    monotonic = () => performance.now(),
    clock = () => Date.now() / 1000,
  } = {}) {
    const u = new URL(origin);
    if (u.protocol !== "https:" || u.origin !== origin) deny("invalid_runtime_origin");
    this.#wall = clock;
    this.#origin = origin;
    this.#fetch = fetch;
    if (!storage) deny("reauthorization_required");
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
        headers: {
          "X-FolioView-Contract": CONTRACT,
          ...(body === null ? {} : { "Content-Type": "application/json" }),
        },
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
      if (response.status === 403 && path.includes("/task-center/")) {
        let reason;
        try {
          reason = await response.json();
        } catch {
          deny("runtime_authorization_required");
        }
        if (reason?.detail?.code === "insufficient_scope") deny("insufficient_scope");
      }
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
    // Host wall time is a bounded local credential prerequisite, not a server
    // promise about expiry. Persist a rollback floor without storing plaintext.
    const seconds = Math.floor(this.#wall());
    await this.#storage.noteTime(seconds);
    this.#clock.seconds = seconds;
    this.#clock.started = this.#clock.monotonic();
    return this.#config;
  }
  #base() {
    if (!this.#actor || !this.#identity) deny("runtime_not_connected");
    const a = this.#actor;
    return `/agent/v3/persistent/owners/${a.ownerSubject}/vaults/${a.vaultId}/connections/${a.connectionId}`;
  }
  async #call(operation, request) {
    requireCurrentCredential(this.#credential.lease, {
      identity: this.#identity,
      audience: this.#origin,
      now: this.now(),
    });
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
      "plans/state",
      "plans/report",
      "task-center/context",
      "task-center/prepare",
      "task-center/plans/report",
    ];
    if (!allowed.includes(operation)) deny("invalid_operation");
    const path = this.#base() + "/" + operation;
    const send = async () =>
      this.#json(path, {
        contractVersion: CONTRACT,
        proof: await (operation.startsWith("task-center/") ? centerRequestProof : requestProof)({
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
  async initialize() {
    if (this.#actor) deny("already_initialized");
    await this.#configuration();
    const record = await this.#storage.active(this.#origin);
    this.#credential = record.activation;
    this.#provider = record.provider;
    this.#root = record.activation.rootKeyId;
    this.#actor = this.#checkedActor(record.actor);
    this.#profile = await this.#storage.profile(this.#actor);
    await this.#adopt(record.activation.identity);
    requireCurrentCredential(this.#credential.lease, {
      identity: this.#identity,
      audience: this.#origin,
      now: this.now(),
    });
    await this.synchronize();
    return this.status();
  }
  async #adopt(identity) {
    validate("PersistentAgentIdentity", identity);
    if (identity.rootKeyId !== this.#root) deny("root_pin_mismatch");
    for (const k of ["ownerSubject", "vaultId", "connectionId", "clientId"])
      if (identity[k] !== this.#actor[k]) deny("recipient_binding_mismatch");
    const signingKeyMatches =
        identity.agentSigningKeyId === (await keyId(this.#profile.signingPublicJwk)),
      encryptionKeyMatches =
        identity.agentEncryptionKeyId === (await keyId(this.#profile.encryptionPublicJwk)),
      identityActive = identity.status === "active";
    if (!signingKeyMatches || !encryptionKeyMatches || !identityActive)
      deny("reauthorization_required");
    this.#identity = structuredClone(identity);
  }
  async synchronize() {
    requireCurrentCredential(this.#credential.lease, {
      identity: this.#identity,
      audience: this.#origin,
      now: this.now(),
    });
    const response = await this.#call("session", {});
    if (!same(response.identity, this.#identity) || (await keyId(response.rootJwk)) !== this.#root)
      deny("recipient_binding_mismatch");
    if (
      !same(response.credentialLease, this.#credential.lease) ||
      !same(response.credentialApproval, this.#credential.approval) ||
      response.provider !== this.#provider
    )
      deny("reauthorization_required");
    const anchor = this.#profile.pins ?? this.#credential.anchor;
    const registry = await new Registry({
      ...anchor,
      rootJwk: response.rootJwk,
      ownerSubject: this.#actor.ownerSubject,
      vaultId: this.#actor.vaultId,
      rootEpoch: 1,
    }).load(response.registryHistory, this.now());
    await registry.binding(response.binding, this.#identity, this.#actor, this.now());
    if (!same(response.binding, this.#credential.binding)) deny("recipient_binding_mismatch");
    const approvalPayload = parsed(bytes(this.#credential.approval.payload), true);
    const approvedRegistry = await new Registry({
      ...this.#credential.anchor,
      rootJwk: this.#credential.rootJwk,
      ownerSubject: this.#actor.ownerSubject,
      vaultId: this.#actor.vaultId,
      rootEpoch: 1,
    }).load(
      response.registryHistory.slice(0, approvalPayload.registrySequence),
      approvalPayload.issuedAt,
    );
    await approvedRegistry.binding(
      response.binding,
      this.#identity,
      this.#actor,
      approvalPayload.issuedAt,
    );
    const derived = await approveCredential(this.#credential.approval, {
      registry: approvedRegistry,
      identity: this.#identity,
      currentLease: this.#credential.previousLease,
      setupIntentId: this.#credential.lease.setupIntentId,
      audience: this.#origin,
      now: approvalPayload.issuedAt,
    });
    if (!same(derived, this.#credential.lease)) deny("recipient_binding_mismatch");
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
      state: this.#registry ? "connected" : "not_connected",
      provider: this.#provider,
      expiresAt: this.#credential?.lease.expiresAt ?? null,
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
  #planReceipt(value, taskId) {
    exact(value, [
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
    if (
      value.contractVersion !== CONTRACT ||
      value.profile !== PLAN ||
      value.taskId !== taskId ||
      value.connectionId !== this.#actor.connectionId ||
      value.provider !== this.#provider ||
      value.authority !== "agent_statement" ||
      value.nativeScheduleAttested !== false ||
      !PLAN_STATUS.includes(value.reportedStatus) ||
      !Number.isSafeInteger(value.version) ||
      value.version < 1 ||
      !Number.isSafeInteger(value.reportedAt) ||
      value.reportedAt < 0 ||
      !Number.isSafeInteger(value.receivedAt) ||
      value.receivedAt < 0 ||
      value.reportedAt > value.receivedAt + 2
    )
      deny("invalid_plan_observation");
    for (const k of ["requestDigest", "taskPublicationFingerprint"]) validate("Digest", value[k]);
    validate("OperationIdentifier", value.operationId);
    if (value.planReferenceHash !== null) validate("Digest", value.planReferenceHash);
    if (["enabled", "paused"].includes(value.reportedStatus) && value.planReferenceHash === null)
      deny("invalid_plan_observation");
    return value;
  }
  #planView(value, taskId) {
    exact(value, [
      "contractVersion",
      "profile",
      "taskId",
      "connectionId",
      "version",
      "desired",
      "reported",
      "observed",
      "reportedEvidence",
      "nativeScheduleAttested",
    ]);
    if (
      value.contractVersion !== CONTRACT ||
      value.profile !== PLAN ||
      value.taskId !== taskId ||
      value.connectionId !== this.#actor.connectionId ||
      value.nativeScheduleAttested !== false ||
      !Number.isSafeInteger(value.version) ||
      value.version < 0 ||
      (value.reported === null) !== (value.version === 0)
    )
      deny("invalid_plan_observation");
    if (value.desired !== null) {
      exact(value.desired, ["taskPublicationFingerprint", "taskVersion", "executionEpoch"]);
      validate("Digest", value.desired.taskPublicationFingerprint);
      for (const k of ["taskVersion", "executionEpoch"])
        if (!Number.isSafeInteger(value.desired[k]) || value.desired[k] < 1)
          deny("invalid_plan_observation");
    }
    if (
      value.reported !== null &&
      this.#planReceipt(value.reported, taskId).version !== value.version
    )
      deny("invalid_plan_observation");
    if (value.observed !== null) {
      const o = value.observed;
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
      if (
        o.nativeScheduleAttested !== false ||
        !Number.isSafeInteger(o.runCreatedAt) ||
        o.runCreatedAt < 0 ||
        (o.resultId === null
          ? o.source !== "hub_run_receipt" || o.receivedAt !== null
          : o.source !== "hub_result_receipt" ||
            !Number.isSafeInteger(o.receivedAt) ||
            o.receivedAt < o.runCreatedAt)
      )
        deny("invalid_plan_observation");
      if (o.resultId !== null) identifier(o.resultId);
    }
    return value;
  }
  async planStatus({ taskId }) {
    identifier(taskId);
    await this.synchronize();
    const value = this.#planView(await this.#call("plans/state", { taskId }), taskId);
    if (value.reported !== null) {
      const e = value.reportedEvidence;
      if (!e) deny("invalid_plan_observation");
      exact(e, ["request", "proof", "identity", "registrySequence", "checkpointDigest"]);
      const cp = this.#registry.snapshots.get(e.registrySequence);
      if (!cp || cp.digest !== e.checkpointDigest || !same(e.identity, this.#identity))
        deny("registry_conflict");
      const signed = parsed(bytes(e.proof.payload), true),
        cert = this.#registry.cert(
          this.#identity.agentSigningKeyId,
          "agent_sig",
          this.#actor.connectionId,
          signed.issuedAt,
          e.registrySequence,
        ),
        p = await verify(e.proof, cert.publicJwk, "fv-control+jws");
      validate("PersistentAgentRequestPayload", p);
      matchBinding(p, this.#identity);
      for (const k of [
        "taskPublicationFingerprint",
        "provider",
        "planReferenceHash",
        "reportedStatus",
        "reportedAt",
      ])
        if (!same(e.request[k], value.reported[k])) deny("invalid_plan_observation");
      if (
        p.path !== this.#base() + "/plans/report" ||
        p.audience !== this.#origin ||
        p.method !== "POST" ||
        p.bodyDigest !== (await digest(e.request)) ||
        p.bodyDigest !== value.reported.requestDigest ||
        p.issuedAt > value.reported.receivedAt ||
        p.expiresAt <= value.reported.receivedAt ||
        e.request.operationId !== value.reported.operationId ||
        e.request.taskId !== taskId ||
        e.request.expectedVersion + 1 !== value.version
      )
        deny("invalid_plan_observation");
    } else if (value.reportedEvidence !== null) deny("invalid_plan_observation");
    return value;
  }
  async #pendingPlan(taskId, pending) {
    exact(pending, ["request", "proof"]);
    const request = pending.request;
    exact(request, [
      "taskId",
      "taskPublicationFingerprint",
      "operationId",
      "expectedVersion",
      "provider",
      "planReferenceHash",
      "reportedStatus",
      "reportedAt",
    ]);
    if (
      request.taskId !== taskId ||
      request.provider !== this.#provider ||
      !PLAN_STATUS.includes(request.reportedStatus) ||
      !Number.isSafeInteger(request.expectedVersion) ||
      request.expectedVersion < 0 ||
      !Number.isSafeInteger(request.reportedAt) ||
      request.reportedAt < 0
    )
      deny("invalid_plan_observation");
    validate("OperationIdentifier", request.operationId);
    validate("Digest", request.taskPublicationFingerprint);
    if (request.planReferenceHash !== null) validate("Digest", request.planReferenceHash);
    const p = await verify(pending.proof, this.#profile.signingPublicJwk, "fv-control+jws");
    exact(p, ["profile", ...BINDING, "requestDigest"]);
    matchBinding(p, this.#identity);
    if (p.profile !== PLAN_INTENT || p.requestDigest !== (await digest(request)))
      deny("invalid_plan_observation");
    return request;
  }
  async reportPlan({ taskId, status, planReference }) {
    identifier(taskId);
    if (
      !PLAN_STATUS.includes(status) ||
      !(
        planReference === null ||
        (typeof planReference === "string" &&
          /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(planReference))
      ) ||
      (["enabled", "paused"].includes(status) && planReference === null)
    )
      deny("invalid_plan_observation");
    await this.synchronize();
    const hash = planReference === null ? null : await digest(planReference),
      name = "plan-pending:" + taskId,
      previous = await this.#record(name, (v) => ({ result: v }));
    if (previous) {
      const request = await this.#pendingPlan(taskId, previous);
      if (request.reportedStatus !== status || request.planReferenceHash !== hash)
        deny("pending_plan_observation");
      return this.retryPlanReport({ taskId });
    }
    const state = await this.planStatus({ taskId });
    let fingerprint = state.desired?.taskPublicationFingerprint;
    if (status === "enabled") fingerprint = (await this.#task(taskId)).fingerprint;
    if (!fingerprint) deny("insufficient_scope");
    const r = state.reported;
    if (
      r &&
      r.taskPublicationFingerprint === fingerprint &&
      r.reportedStatus === status &&
      r.planReferenceHash === hash &&
      this.now() - r.reportedAt < 86400
    )
      return { state: "unchanged", receipt: r };
    const request = {
      taskId,
      taskPublicationFingerprint: fingerprint,
      operationId:
        "plan_" +
        (await digest([
          this.#identity.bindingFingerprint,
          taskId,
          state.version,
          fingerprint,
          status,
          hash,
        ])),
      expectedVersion: state.version,
      provider: this.#provider,
      planReferenceHash: hash,
      reportedStatus: status,
      reportedAt: this.now(),
    };
    const proof = await sign(
      {
        profile: PLAN_INTENT,
        ...Object.fromEntries(BINDING.map((k) => [k, this.#identity[k]])),
        requestDigest: await digest(request),
      },
      this.#profile.signingPrivateKey,
      this.#identity.agentSigningKeyId,
      "fv-control+jws",
    );
    const candidate = { request, proof };
    const stored = await this.#record(name, (v) => ({
      write: v ?? candidate,
      result: v ?? candidate,
    }));
    if (!same(stored, candidate)) deny("pending_plan_observation");
    return this.retryPlanReport({ taskId });
  }
  async retryPlanReport({ taskId }) {
    identifier(taskId);
    await this.synchronize();
    const name = "plan-pending:" + taskId,
      pending = await this.#record(name, (v) => ({ result: v }));
    if (!pending) deny("not_found");
    const request = await this.#pendingPlan(taskId, pending),
      receipt = this.#planReceipt(await this.#call("plans/report", request), taskId);
    for (const k of [
      "taskPublicationFingerprint",
      "provider",
      "planReferenceHash",
      "reportedStatus",
      "reportedAt",
    ])
      if (!same(request[k], receipt[k])) deny("invalid_plan_observation");
    if (
      receipt.requestDigest !== (await digest(request)) ||
      receipt.operationId !== request.operationId ||
      receipt.version !== request.expectedVersion + 1
    )
      deny("invalid_plan_observation");
    await this.#record(name, (v) => {
      if (!same(v, pending)) deny("version_conflict");
      return { write: null, result: null };
    });
    return { state: "reported", receipt };
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
  async #verifiedManifest(manifest, task) {
    const check = (now) =>
      verifyManifest(manifest, {
        identity: this.#identity,
        taskContext: task.context,
        taskFingerprint: task.fingerprint,
        consent: this.#consent,
        now,
      });
    const observedNow = this.now();
    try {
      return await check(observedNow);
    } catch (error) {
      if (error?.code !== "run_expired") throw error;
      const ahead = manifest.createdAt - observedNow;
      if (
        ahead <= 0 ||
        ahead > 2 ||
        manifest.expiresAt <= manifest.createdAt ||
        manifest.expiresAt > manifest.createdAt + 7200
      )
        throw error;
      // A new Hub run may arrive just ahead of the host's whole-second clock.
      // Let real monotonic time advance, then run every original check again.
      // Never shift the clock, widen validity or retry the begin write here.
      const remaining = manifest.createdAt - this.now();
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining * 1000));
      return check(this.now());
    }
  }
  async taskCenterState({ taskId }) {
    identifier(taskId);
    await this.synchronize();
    const task = await this.#task(taskId);
    const value = await this.#call("task-center/context", { taskId });
    await verifyCenter(value, {
      registry: this.#registry,
      identity: this.#identity,
      lease: this.#credential.lease,
      provider: this.#provider,
      task,
    });
    const pin = {
      definitionVersion: value.definition.definitionVersion,
      assignmentVersion: value.assignment.assignmentVersion,
      digest: await digest([value.definition, value.assignment]),
    };
    await this.#record("task-center-pin:" + taskId, (v) => {
      if (
        v &&
        (v.definitionVersion > pin.definitionVersion ||
          v.assignmentVersion > pin.assignmentVersion ||
          (v.definitionVersion === pin.definitionVersion &&
            v.assignmentVersion === pin.assignmentVersion &&
            v.digest !== pin.digest))
      )
        deny("version_conflict");
      return { write: pin, result: pin };
    });
    return value;
  }
  async dueAssigned() {
    const tasks = await this.tasks(),
      result = [];
    for (const task of tasks) {
      let state;
      try {
        state = await this.taskCenterState({ taskId: task.taskId });
      } catch (e) {
        if (e.code === "not_found") continue;
        throw e;
      }
      const due = await assignedDue(state.definition, this.now());
      if (due) result.push({ taskId: task.taskId, binding: state.binding, ...due });
    }
    return result;
  }
  async beginAssigned({ taskId, baseTriggerId }) {
    identifier(taskId);
    validate("OperationIdentifier", baseTriggerId);
    const name = "task-center-begin:" + taskId + ":" + baseTriggerId;
    let pending = await this.#record(name, (v) => ({ result: v }));
    const state = await this.taskCenterState({ taskId });
    const triggerId = await assignedTrigger(state.assignment, baseTriggerId);
    const operationId =
      "begin_" + (await digest([this.#actor.ownerSubject, this.#actor.vaultId, taskId, triggerId]));
    const request = {
      taskId,
      baseTriggerId,
      operationId,
      binding: state.binding,
      taskPublicationFingerprint: state.authority.fingerprint,
    };
    pending = await this.#record(name, (v) => {
      if (v && (!same(v.request, request) || v.triggerId !== triggerId)) deny("version_conflict");
      const stored = v ?? { request, triggerId };
      return { write: stored, result: stored };
    });
    const prepared = await this.#call("task-center/prepare", pending.request);
    if (
      prepared.triggerId !== pending.triggerId ||
      !same(prepared.request, pending.request) ||
      prepared.triggerKind !== "legacy_unknown"
    )
      deny("invalid_manifest");
    return this.begin({ taskId, triggerId: pending.triggerId });
  }
  async reportPlanAssigned({ taskId, status, planReference }) {
    if (
      !PLAN_STATUS.includes(status) ||
      (planReference !== null &&
        (typeof planReference !== "string" || !planReference.length || planReference.length > 2048))
    )
      deny("invalid_plan");
    const name = "task-center-plan:" + taskId;
    const old = await this.#record(name, (v) => ({ result: v }));
    const planReferenceHash = planReference === null ? null : await digest(planReference);
    if (
      old &&
      (!same(old.request.reportedStatus, status) ||
        old.request.planReferenceHash !== planReferenceHash)
    )
      deny("version_conflict");
    const state = await this.taskCenterState({ taskId });
    if (old && !same(old.request.binding, state.binding)) deny("version_conflict");
    if (state.definition.schedule === null && ["enabled", "paused"].includes(status))
      deny("invalid_plan");
    const request = old?.request ?? {
      taskId,
      operationId:
        "plan_" +
        (await digest([
          this.#actor,
          taskId,
          state.binding,
          state.plan.version,
          status,
          planReferenceHash,
        ])),
      binding: state.binding,
      expectedVersion: state.plan.version,
      provider: this.#provider,
      planReferenceHash,
      reportedStatus: status,
      reportedAt: this.now(),
    };
    const pending = await this.#record(name, (v) => ({
      write: v ?? { request },
      result: v ?? { request },
    }));
    const receipt = await this.#call("task-center/plans/report", pending.request);
    if (
      !same(receipt.request, pending.request) ||
      !same(receipt.binding, state.binding) ||
      receipt.version !== pending.request.expectedVersion + 1 ||
      receipt.nativeScheduleAttested !== false
    )
      deny("invalid_plan");
    await this.#record(name, (v) => {
      if (!same(v, pending)) deny("version_conflict");
      return { write: null, result: null };
    });
    return {
      version: receipt.version,
      status,
      authority: "agent_statement",
      nativeScheduleAttested: false,
    };
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
    const checked = await this.#verifiedManifest(response.manifest, t);
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
      checked = await this.#verifiedManifest(m, t);
    if (checked.fingerprint !== response.manifestFingerprint) deny("invalid_manifest");
    return { ...checked, task: t };
  }
  async input({ runId, publicationId }) {
    validate("OperationIdentifier", publicationId);
    const r = await this.#run(runId);
    return this.#input(r, publicationId);
  }
  async #input(r, publicationId) {
    const runId = r.manifest.runId,
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
    const resource = await open(response.envelope, this.#profile.encryptionPrivateKey, c);
    checkInputPolicy(r.task.task.inputPolicy, resource, this.now());
    return {
      runId,
      publicationId,
      ref: item.ref,
      sourceRevision: item.sourceRevision,
      resource,
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
      try {
        resultContent(report, r.task.task.outputSpec);
      } catch (error) {
        if (
          [
            "invalid_schema",
            "private_schema_invalid",
            "private_output_mismatch",
            "duplicate_value",
          ].includes(error?.code)
        )
          deny("invalid_report");
        throw error;
      }
      // First publication verifies every frozen input even if the caller skipped
      // readInput. Unknown-outcome retries above retain the original ciphertext.
      const resources = [];
      for (const item of r.manifest.inputs)
        resources.push(await this.#input(r, item.publicationId));
      for (const { resource } of resources)
        checkInputPolicy(r.task.task.inputPolicy, resource, this.now());
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
