/** Trusted foreground orchestration. Crypto stays in the pinned, network-free Worker.
 * Host authentication is memory-only and is never a model-facing operation.
 */
import {
  CiphertextOutbox,
  ControllerDenied,
  CONTROLLER_PROFILE,
  CONTRACT,
  reject,
  exact,
  identifier,
  canonical,
  bounded,
  checkedScope,
  checkedPacket,
  checkedReceipt,
} from "./controller-storage.mjs";
export {
  CiphertextOutbox,
  ControllerDenied,
  CONTROLLER_PROFILE,
  CONTRACT,
  reject,
  exact,
  identifier,
  bounded,
};
const encoder = new TextEncoder();
export const HELPER_VERSION = "1.2.0";
const AGENT_OPERATIONS = {
  status: [],
  lock: [],
  registry: ["bundles"],
  install: ["metadata"],
  decrypt: ["objectId", "envelope"],
  beginRun: ["stableOperationId"],
  installRun: ["response"],
  decryptRun: ["runId", "page"],
  sealResult: ["runId", "stableOperationId", "content"],
  reviseResult: ["runId", "stableOperationId", "expectedRevision", "content"],
  resultOutbox: ["runId", "stableOperationId"],
};
async function sha(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
function issuerOrigin(value, loopback) {
  let url;
  try {
    url = new URL(value);
  } catch {
    reject("invalid_configuration");
  }
  if (
    url.origin !== value ||
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(
        loopback &&
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  )
    reject("invalid_configuration");
  return url.origin;
}
async function responseBytes(response, signal, limit) {
  if (!response.body) reject("invalid_response");
  const reader = response.body.getReader(),
    chunks = [];
  let length = 0;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      const part = await reader.read();
      if (signal.aborted) reject("request_cancelled");
      if (part.done) break;
      length += part.value.length;
      if (length > limit) reject("invalid_response");
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  } finally {
    signal.removeEventListener("abort", abort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
function clone(value) {
  return structuredClone(value);
}
export class ForegroundController {
  #issuer;
  #fetch;
  #makeWorker;
  #storage;
  #clock;
  #notify;
  #worker;
  #owner;
  #agent;
  #scope;
  #anchor;
  #pin;
  #offer;
  #token;
  #principal;
  #objectUrl;
  #expiresAt = null;
  #authenticating = false;
  #epoch = 1;
  #sequence = 0;
  #sessionId;
  #generation = 1;
  #ended = false;
  #visible = true;
  #pending = new Map();
  #requests = new Set();
  #metadata;
  #runs = new Map();
  #liveResults = new Set();
  #ttl;
  constructor({
    issuer,
    developmentLoopback = false,
    fetchImpl = fetch,
    createWorker = (url) => new Worker(url, { type: "module" }),
    outbox = new CiphertextOutbox(),
    clock = Date.now,
    onState = () => {},
  }) {
    this.#issuer = issuerOrigin(issuer, developmentLoopback);
    this.#fetch = fetchImpl;
    this.#makeWorker = createWorker;
    this.#storage = outbox;
    this.#clock = clock;
    this.#notify = onState;
  }
  #assert(epoch, privateOperation = false) {
    if (this.#ended || epoch !== this.#epoch || !this.#scope) reject("session_ended");
    if (privateOperation && !this.#visible) reject("foreground_required");
    if (privateOperation && this.#authenticating) reject("transport_refreshing");
  }
  status() {
    return {
      profile: CONTROLLER_PROFILE,
      helperVersion: HELPER_VERSION,
      sessionId: this.#sessionId ?? null,
      generation: this.#generation,
      expiresAt: this.#expiresAt,
      state: this.#ended ? "LOCKED" : this.#offer ? "READY" : "ABSENT",
      foreground: this.#visible,
      authenticatedTransport: Boolean(this.#token),
      independentDeliveryConfirmed: Boolean(this.#pin),
      privateKeysPersistent: false,
    };
  }
  publicOffer() {
    if (!this.#offer || this.#ended) reject("session_ended");
    return clone(this.#offer);
  }
  async initialize(card) {
    exact(card, ["helperVersion", "workerSha256", "anchor", "ttlSeconds"]);
    if (
      this.#ended ||
      this.#worker ||
      this.#scope ||
      card.helperVersion !== HELPER_VERSION ||
      typeof card.workerSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(card.workerSha256) ||
      !Number.isSafeInteger(card.ttlSeconds) ||
      card.ttlSeconds < 1 ||
      card.ttlSeconds > 3600
    )
      reject("invalid_initialization");
    exact(card.anchor, [
      "ownerSubject",
      "vaultId",
      "rootJwk",
      "rootKeyId",
      "rootEpoch",
      "registrySequence",
      "checkpointDigest",
      "connectionId",
      "agentPrincipalId",
      "taskId",
    ]);
    const scope = checkedScope(
      Object.fromEntries(
        ["ownerSubject", "vaultId", "connectionId", "agentPrincipalId", "taskId"].map((name) => [
          name,
          card.anchor[name],
        ]),
      ),
    );
    this.#scope = scope;
    this.#anchor = clone(card.anchor);
    this.#sessionId = `session_${crypto.randomUUID().replaceAll("-", "")}`;
    const epoch = this.#epoch,
      controller = new AbortController();
    this.#requests.add(controller);
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await this.#fetch(this.#issuer + "/agent/v2/helper/worker.mjs", {
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      if (
        !response.ok ||
        response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !==
          "text/javascript"
      )
        reject("helper_unavailable");
      const bytes = await responseBytes(response, controller.signal, 2097152);
      this.#assert(epoch);
      if ((await sha(bytes)) !== card.workerSha256) reject("helper_integrity_mismatch");
      this.#assert(epoch);
      this.#objectUrl = URL.createObjectURL(new Blob([bytes], { type: "text/javascript" }));
      this.#worker = this.#makeWorker(this.#objectUrl);
      const owner = new MessageChannel(),
        agent = new MessageChannel();
      this.#owner = owner.port1;
      this.#agent = agent.port1;
      const reply = (event) => this.#reply(event.data);
      this.#owner.onmessage = reply;
      this.#agent.onmessage = reply;
      this.#owner.start();
      this.#agent.start();
      this.#worker.onerror = () => this.lock("worker_failed");
      this.#worker.postMessage({ op: "attach", ownerPort: owner.port2, agentPort: agent.port2 }, [
        owner.port2,
        agent.port2,
      ]);
      const result = await this.#rpc(
        "initialize",
        { anchor: card.anchor, now: Math.floor(this.#clock() / 1000), ttlSeconds: card.ttlSeconds },
        true,
      );
      this.#assert(epoch);
      this.#offer = {
        helperVersion: HELPER_VERSION,
        sessionId: this.#sessionId,
        generation: this.#generation,
        anchor: clone(this.#anchor),
        agentSigningPublicJwk: result.agentSigningPublicJwk,
        agentEncryptionPublicJwk: result.agentEncryptionPublicJwk,
        agentSigningKeyId: result.agentSigningKeyId,
        agentEncryptionKeyId: result.agentEncryptionKeyId,
        keyExportRejected: result.keyExportRejected,
      };
      if (result.keyExportRejected !== true || result.privateKeysPresent !== true)
        reject("unsafe_helper");
      this.#expiresAt = Math.floor(this.#clock() / 1000) + card.ttlSeconds;
      this.#ttl = setTimeout(() => this.lock("session_expired"), card.ttlSeconds * 1000);
      this.#notify(this.status());
      return this.publicOffer();
    } catch (error) {
      this.lock("initialization_failed");
      throw error instanceof ControllerDenied ? error : new ControllerDenied("helper_unavailable");
    } finally {
      clearTimeout(timeout);
      this.#requests.delete(controller);
    }
  }
  #reply(message) {
    if (message?.event === "sessionEnded") {
      this.lock("session_ended");
      return;
    }
    const pending = this.#pending.get(message?.id);
    if (!pending) return;
    this.#pending.delete(message.id);
    clearTimeout(pending.timeout);
    try {
      this.#assert(pending.epoch, pending.privateOperation);
      if (message.ok === true) pending.resolve(message.value);
      else
        pending.reject(
          new ControllerDenied(
            typeof message.error?.code === "string" ? message.error.code : "helper_rejected",
          ),
        );
    } catch (error) {
      pending.reject(error);
    }
  }
  async #rpc(op, args, trusted = false) {
    const epoch = this.#epoch;
    this.#assert(epoch, !trusted && !["status", "lock"].includes(op));
    if (!this.#worker || this.#pending.size >= 8) reject("helper_busy");
    const message = {
      id: `rpc_${++this.#sequence}`,
      sessionId: this.#sessionId,
      generation: this.#generation,
      op,
      args,
    };
    bounded(message);
    return new Promise((resolve, rejectPromise) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(message.id);
        rejectPromise(new ControllerDenied("helper_timeout"));
        this.lock("helper_timeout");
      }, 20000);
      this.#pending.set(message.id, {
        resolve,
        reject: rejectPromise,
        timeout,
        epoch,
        privateOperation: !trusted && op !== "status",
      });
      try {
        (trusted ? this.#owner : this.#agent).postMessage(message);
      } catch {
        clearTimeout(timeout);
        this.#pending.delete(message.id);
        rejectPromise(new ControllerDenied("helper_unavailable"));
      }
    });
  }
  async confirmDelivery({ pin }) {
    const epoch = this.#epoch;
    this.#assert(epoch);
    await this.#rpc("confirmDelivery", { pin }, true);
    this.#assert(epoch);
    this.#pin = clone(pin);
    this.#metadata = undefined;
    this.#runs.clear();
    this.#liveResults.clear();
    this.#notify(this.status());
    return this.status();
  }
  async dispatchAgent(message) {
    exact(message, ["op", "args"]);
    if (!Object.hasOwn(AGENT_OPERATIONS, message.op)) reject("unsupported_operation");
    exact(message.args, AGENT_OPERATIONS[message.op]);
    if (message.op === "status") return this.status();
    if (message.op === "lock") {
      this.lock();
      return this.status();
    }
    const epoch = this.#epoch;
    this.#assert(epoch, true);
    const value = await this.#rpc(message.op, message.args);
    this.#assert(epoch, true);
    if (message.op === "install") this.#metadata = clone(message.args.metadata);
    if (message.op === "installRun") {
      const response = message.args.response;
      this.#runs.set(response.run.runId, {
        createdAt: response.run.createdAt,
        response: clone(response),
      });
    }
    if (message.op === "sealResult" || message.op === "reviseResult") {
      const run = this.#runs.get(message.args.runId);
      if (!run) reject("run_required");
      await this.#stage(value, run.createdAt, epoch);
      this.#assert(epoch, true);
      this.#liveResults.add(value.runId + "/" + value.stableOperationId);
    }
    return value;
  }
  setVisible(visible) {
    if (typeof visible !== "boolean") reject("invalid_fields");
    this.#visible = visible;
    if (!visible) {
      for (const request of this.#requests) request.abort();
      for (const [id, pending] of this.#pending)
        if (pending.privateOperation) {
          clearTimeout(pending.timeout);
          pending.reject(new ControllerDenied("foreground_required"));
          this.#pending.delete(id);
        }
    }
    this.#notify(this.status());
  }
  async authenticate(accessToken) {
    if (typeof accessToken !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(accessToken))
      reject("invalid_token");
    const epoch = this.#epoch;
    this.#assert(epoch);
    if (this.#authenticating || this.#requests.size || this.#pending.size) reject("transport_busy");
    this.#authenticating = true;
    try {
      const principal = await this.#http("/agent/v2/authorization", {
        token: accessToken,
        privateOperation: false,
      });
      this.#assert(epoch);
      exact(principal, [
        "contractVersion",
        "connectionId",
        "authorizationId",
        "clientId",
        "scopes",
        "taskIds",
        "expiresAt",
      ]);
      const allowedScopes = new Set([
        "tasks:read",
        "runs:create",
        "runs:read",
        "results:create",
        "results:revise",
        "receipts:read",
        "watchlist:read",
        "channel_follows:read",
        "portfolio:read",
      ]);
      if (
        principal.contractVersion !== CONTRACT ||
        principal.connectionId !== this.#scope.connectionId ||
        !Array.isArray(principal.taskIds) ||
        principal.taskIds.length > 10 ||
        !principal.taskIds.includes(this.#scope.taskId) ||
        principal.taskIds.some((value) => !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) ||
        new Set(principal.taskIds).size !== principal.taskIds.length ||
        !Array.isArray(principal.scopes) ||
        principal.scopes.length > 9 ||
        principal.scopes.some((value) => !allowedScopes.has(value)) ||
        new Set(principal.scopes).size !== principal.scopes.length ||
        !Number.isSafeInteger(principal.expiresAt) ||
        principal.expiresAt <= Math.floor(this.#clock() / 1000) ||
        (this.#pin && principal.authorizationId !== this.#pin.authorizationId)
      ) {
        this.lock("authorization_denied");
        reject("authorization_denied");
      }
      identifier(principal.clientId);
      identifier(principal.authorizationId);
      const identity = (row) =>
        canonical({
          connectionId: row.connectionId,
          authorizationId: row.authorizationId,
          clientId: row.clientId,
          scopes: [...row.scopes].sort(),
          taskIds: [...row.taskIds].sort(),
        });
      if (this.#principal && identity(this.#principal) !== identity(principal)) {
        this.lock("authorization_changed");
        reject("authorization_changed");
      }
      // A host may replace a short-lived access token for the exact same grant.
      // No refresh token is retained and the original Worker TTL is unchanged.
      this.#token = accessToken;
      this.#principal = clone(principal);
      this.#notify(this.status());
      return {
        connectionId: principal.connectionId,
        authorizationId: principal.authorizationId,
        expiresAt: principal.expiresAt,
      };
    } finally {
      this.#authenticating = false;
    }
  }
  async #http(
    path,
    { method = "GET", json, operation, token = this.#token, privateOperation = true } = {},
  ) {
    const epoch = this.#epoch;
    this.#assert(epoch, privateOperation);
    if (!token) reject("authenticated_host_required");
    // Paths are produced only by named operations below, never model/user URLs.
    if (
      !/^\/agent\/v2\/(?:authorization|tasks\/[A-Za-z0-9_-]+\/(?:preparation|runs)|preparations\/[A-Za-z0-9_-]+\/(?:objects\/[A-Za-z0-9_-]+|registries\/[1-9][0-9]?)|runs\/[A-Za-z0-9_-]+(?:\/(?:inputs(?:\?cursor=[A-Za-z0-9_-]{1,128})?|registries\/[1-9][0-9]?|results|receipts\/[A-Za-z0-9_-]+))?|results\/[A-Za-z0-9_-]+\/revisions)$/.test(
        path,
      )
    )
      reject("unsupported_operation");
    const headers = { Authorization: `Bearer ${token}`, "X-FolioView-Contract": CONTRACT };
    if (operation) headers["Idempotency-Key"] = identifier(operation);
    if (json !== undefined) {
      headers["Content-Type"] = "application/json";
      bounded(json, 589824);
    }
    const controller = new AbortController();
    this.#requests.add(controller);
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await this.#fetch(this.#issuer + path, {
        method,
        headers,
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
        ...(json === undefined ? {} : { body: JSON.stringify(json) }),
      });
      this.#assert(epoch, privateOperation);
      if (response.status === 401 || response.status === 403) {
        this.lock("authorization_denied");
        reject("authorization_denied");
      }
      if (!response.ok) {
        if (response.status === 409) this.lock("authority_changed");
        reject(
          response.status === 404
            ? "not_found"
            : response.status === 409
              ? "authority_changed"
              : "request_failed",
        );
      }
      if (
        response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !==
        "application/json"
      )
        reject("invalid_response");
      const raw = await responseBytes(response, controller.signal, 1048576);
      this.#assert(epoch, privateOperation);
      let value;
      try {
        value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
      } catch {
        reject("invalid_response");
      }
      return value;
    } catch (error) {
      if (error instanceof ControllerDenied) throw error;
      reject(controller.signal.aborted ? "request_cancelled" : "request_failed");
    } finally {
      clearTimeout(timeout);
      this.#requests.delete(controller);
    }
  }
  async loadPreparation() {
    const epoch = this.#epoch;
    this.#assert(epoch, true);
    if (!this.#pin) reject("trusted_pin_required");
    const metadata = await this.#http(`/agent/v2/tasks/${this.#scope.taskId}/preparation`);
    if (
      metadata.preparationId !== this.#pin.preparationId ||
      !Array.isArray(metadata.registryProofs) ||
      metadata.registryProofs.length < 1 ||
      metadata.registryProofs.length > 32
    )
      reject("invalid_response");
    for (let index = 0; index < metadata.registryProofs.length; index++) {
      const n = index + 1,
        path = `/agent/v2/preparations/${identifier(metadata.preparationId)}/registries/${n}`;
      if (
        metadata.registryProofs[index].registrySequence !== n ||
        metadata.registryProofs[index].path !== path
      )
        reject("invalid_response");
      const page = await this.#http(path);
      this.#assert(epoch, true);
      if (page.preparationId !== metadata.preparationId || page.registrySequence !== n)
        reject("invalid_response");
      await this.#rpc("registry", { bundles: [page.registryBundle] });
    }
    await this.dispatchAgent({ op: "install", args: { metadata } });
    this.#assert(epoch, true);
    return { preparationId: metadata.preparationId, objects: clone(metadata.objects) };
  }
  async readPreparedObject(objectId) {
    const epoch = this.#epoch;
    this.#assert(epoch, true);
    identifier(objectId);
    if (!this.#metadata?.objects.some((row) => row.objectId === objectId))
      reject("object_not_authorized");
    const response = await this.#http(
      `/agent/v2/preparations/${identifier(this.#pin.preparationId)}/objects/${objectId}`,
    );
    this.#assert(epoch, true);
    exact(response, ["contractVersion", "preparationId", "objectId", "envelope"]);
    if (
      response.contractVersion !== CONTRACT ||
      response.preparationId !== this.#pin.preparationId ||
      response.objectId !== objectId
    )
      reject("invalid_response");
    return this.dispatchAgent({ op: "decrypt", args: { objectId, envelope: response.envelope } });
  }
  async beginRun(operation) {
    const epoch = this.#epoch;
    this.#assert(epoch, true);
    identifier(operation);
    const begin = await this.dispatchAgent({
      op: "beginRun",
      args: { stableOperationId: operation },
    });
    this.#assert(epoch, true);
    const response = await this.#http(`/agent/v2/tasks/${this.#scope.taskId}/runs`, {
      method: "POST",
      json: { contractVersion: CONTRACT, signedBeginIntent: begin.signedBeginIntent },
      operation,
    });
    this.#assert(epoch, true);
    await this.dispatchAgent({ op: "installRun", args: { response } });
    this.#assert(epoch, true);
    return clone(response);
  }
  async readRunPage(runId, cursor = null) {
    const epoch = this.#epoch;
    this.#assert(epoch, true);
    identifier(runId);
    if (
      !this.#runs.has(runId) ||
      (cursor !== null && (typeof cursor !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(cursor)))
    )
      reject("run_required");
    const page = await this.#http(
      `/agent/v2/runs/${runId}/inputs${cursor === null ? "" : "?cursor=" + cursor}`,
    );
    this.#assert(epoch, true);
    return this.dispatchAgent({ op: "decryptRun", args: { runId, page } });
  }
  async #stage(packet, runCreatedAt, epoch) {
    await checkedPacket(packet, this.#scope);
    this.#assert(epoch, true);
    const record = await this.#storage.stage(this.#scope, {
      profile: CONTROLLER_PROFILE,
      scope: clone(this.#scope),
      packet,
      receipt: null,
      runCreatedAt,
    });
    this.#assert(epoch, true);
    return record;
  }
  async submitResult(runId, operation, content, expectedRevision = 0) {
    const epoch = this.#epoch;
    this.#assert(epoch, true);
    identifier(runId);
    identifier(operation);
    const packet = await this.dispatchAgent({
      op: expectedRevision === 0 ? "sealResult" : "reviseResult",
      args: {
        runId,
        stableOperationId: operation,
        ...(expectedRevision === 0 ? {} : { expectedRevision }),
        content,
      },
    });
    this.#assert(epoch, true);
    return this.replay(packet.stableOperationId);
  }
  async #accept(record, receipt, epoch) {
    const { context } = await checkedPacket(record.packet, this.#scope);
    this.#assert(epoch, true);
    const checked = checkedReceipt(
      receipt,
      record.packet,
      this.#scope,
      context,
      record.runCreatedAt,
    );
    await this.#storage.accept(
      this.#scope,
      record.packet.stableOperationId,
      record.packet.envelopeFingerprint,
      checked,
    );
    this.#assert(epoch, true);
    // Restored ciphertext has no restored private keys or Worker outbox handle.
    // Its server receipt may be recovered, but never silently enables revisions.
    const live = this.#liveResults.has(record.packet.runId + "/" + record.packet.stableOperationId);
    if (live) {
      await this.#rpc(
        "acceptReceipt",
        {
          runId: record.packet.runId,
          stableOperationId: record.packet.stableOperationId,
          receipt: checked,
        },
        true,
      );
      this.#assert(epoch, true);
    }
    return { receipt: checked, liveRevisionSession: live, recoveredWithoutPrivateKeys: !live };
  }
  async replay(operation) {
    const epoch = this.#epoch;
    this.#assert(epoch, true);
    identifier(operation);
    const record = await this.#storage.get(this.#scope, operation);
    this.#assert(epoch, true);
    if (!record) reject("not_found");
    const packet = record.packet,
      revision = packet.expectedRevision > 0;
    const receipt = await this.#http(
      revision
        ? `/agent/v2/results/${packet.resultId}/revisions`
        : `/agent/v2/runs/${packet.runId}/results`,
      {
        method: "POST",
        operation,
        json: revision
          ? {
              contractVersion: CONTRACT,
              expectedRevision: packet.expectedRevision,
              signedObject: packet.envelope.signedObject,
            }
          : packet.envelope,
      },
    );
    this.#assert(epoch, true);
    return this.#accept(record, receipt, epoch);
  }
  async recoverReceipt(operation) {
    const epoch = this.#epoch;
    this.#assert(epoch, true);
    identifier(operation);
    const record = await this.#storage.get(this.#scope, operation);
    this.#assert(epoch, true);
    if (!record) reject("not_found");
    const receipt = await this.#http(`/agent/v2/runs/${record.packet.runId}/receipts/${operation}`);
    this.#assert(epoch, true);
    if (receipt === null) return { receipt: null, pending: true };
    return this.#accept(record, receipt, epoch);
  }
  async listOutbox() {
    const epoch = this.#epoch;
    this.#assert(epoch);
    const records = await this.#storage.list(this.#scope);
    this.#assert(epoch);
    return records.map((row) => ({
      runId: row.packet.runId,
      resultId: row.packet.resultId,
      stableOperationId: row.packet.stableOperationId,
      revision: row.packet.revision,
      envelopeFingerprint: row.packet.envelopeFingerprint,
      receiptSaved: row.receipt !== null,
    }));
  }
  async discardOutbox(operation, expectedFingerprint) {
    const epoch = this.#epoch;
    this.#assert(epoch);
    identifier(operation);
    if (typeof expectedFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(expectedFingerprint))
      reject("invalid_fields");
    await this.#storage.discard(this.#scope, operation, expectedFingerprint);
    this.#assert(epoch);
    return this.listOutbox();
  }
  lock(reason = "locked") {
    if (this.#ended) return;
    this.#ended = true;
    this.#epoch++;
    this.#generation++;
    clearTimeout(this.#ttl);
    for (const request of this.#requests) request.abort();
    this.#requests.clear();
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new ControllerDenied("session_ended"));
    }
    this.#pending.clear();
    this.#worker?.terminate();
    this.#owner?.close();
    this.#agent?.close();
    if (this.#objectUrl) URL.revokeObjectURL(this.#objectUrl);
    this.#worker = this.#owner = this.#agent = undefined;
    this.#token = this.#principal = this.#metadata = this.#pin = this.#offer = undefined;
    this.#runs.clear();
    this.#liveResults.clear();
    this.#notify({ ...this.status(), reason });
  }
}
