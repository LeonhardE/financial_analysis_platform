/** Hub-owned BH-M-E foreground primitive. No network, persistence or key-import API.
 * Parser/JOSE boundary adapted from reviewed VAL-004; formal v2 schemas are compiled at build time.
 */
import * as jose from "jose";
import canonicalize from "canonicalize";
import validators from "./validators.cjs";
export const VERSION = "1.2.0";
export const CONTRACT = "folioview.agent-workspace.v2.0";
export const PROFILE = "folioview.agent-preparation.v1";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const MAX_CARRIER = 524288;
const MAX_RPC = 1048576;
const JWE_HEADER = {
  alg: "ECDH-ES+A256KW",
  enc: "A256GCM",
  typ: "fv-private+jwe",
  cty: "application/json",
};
const EMPTY_BINDING = [
  "taskId",
  "taskVersion",
  "runId",
  "manifestId",
  "taskEnvelopeFingerprint",
  "manifestFingerprint",
  "connectionId",
  "grantId",
  "grantEpoch",
  "executionEpoch",
  "resourceRef",
  "sourceRevision",
  "sourceEpoch",
];
const ROLES = ["root_sig", "device_sig", "device_enc", "agent_sig", "agent_enc", "recovery_enc"];
const OWNER_OPS = {
  initialize: ["anchor", "now", "ttlSeconds"],
  confirmDelivery: ["pin"],
  acceptReceipt: ["runId", "stableOperationId", "receipt"],
};
const AGENT_OPS = {
  registry: ["bundles"],
  install: ["metadata"],
  decrypt: ["objectId", "envelope"],
  beginRun: ["stableOperationId"],
  installRun: ["response"],
  decryptRun: ["runId", "page"],
  sealResult: ["runId", "stableOperationId", "content"],
  reviseResult: ["runId", "stableOperationId", "expectedRevision", "content"],
  resultOutbox: ["runId", "stableOperationId"],
  status: [],
  lock: [],
  revoke: [],
};
export class HelperDenied extends Error {
  constructor(code = "operation_rejected") {
    super(code);
    this.code = code;
  }
}
function deny(code) {
  throw new HelperDenied(code);
}
function object(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}
function exact(value, fields) {
  if (!object(value) || Object.keys(value).sort().join("\0") !== [...fields].sort().join("\0"))
    deny("invalid_fields");
}
function canonical(value) {
  jsonValue(value);
  const text = canonicalize(value);
  if (typeof text !== "string") deny("invalid_json");
  return encoder.encode(text);
}
function jsonValue(value, depth = 0) {
  if (depth > 20) deny("json_too_deep");
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (!value.isWellFormed()) deny("invalid_unicode");
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))
      deny("invalid_number");
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) jsonValue(entry, depth + 1);
    return;
  }
  if (!object(value)) deny("invalid_json");
  for (const [key, entry] of Object.entries(value)) {
    jsonValue(key);
    jsonValue(entry, depth + 1);
  }
}
function same(a, b) {
  return canonicalize(a) === canonicalize(b);
}
function bytes(value) {
  if (typeof value !== "string" || value.includes("=") || !/^[A-Za-z0-9_-]*$/.test(value))
    deny("invalid_base64url");
  const out = jose.base64url.decode(value);
  if (jose.base64url.encode(out) !== value) deny("invalid_base64url");
  return out;
}
function parsed(raw, requireCanonical = false) {
  const text = decoder.decode(raw);
  // Reject duplicate decoded member names without requiring JOSE headers to be
  // JCS-ordered. JSON.parse alone would silently keep the last duplicate.
  let position = 0;
  const whitespace = () => {
    while (/[\x20\x09\x0a\x0d]/.test(text[position] || "!")) position += 1;
  };
  const string = () => {
    if (text[position] !== '"') deny("malformed_json");
    const start = position++;
    while (position < text.length) {
      if (text[position] === "\\") {
        position += 2;
        continue;
      }
      if (text[position++] === '"') return JSON.parse(text.slice(start, position));
    }
    deny("malformed_json");
  };
  const scan = (depth) => {
    if (depth > 20) deny("json_too_deep");
    whitespace();
    if (text[position] === '"') {
      string();
      return;
    }
    const isObject = text[position] === "{";
    if (isObject || text[position] === "[") {
      const end = isObject ? "}" : "]";
      position += 1;
      whitespace();
      const members = new Set();
      if (text[position] === end) {
        position += 1;
        return;
      }
      while (true) {
        if (isObject) {
          whitespace();
          const name = string();
          if (members.has(name)) deny("duplicate_member");
          members.add(name);
          whitespace();
          if (text[position++] !== ":") deny("malformed_json");
        }
        scan(depth + 1);
        whitespace();
        if (text[position] === end) {
          position += 1;
          return;
        }
        if (text[position++] !== ",") deny("malformed_json");
      }
    }
    const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
      text.slice(position),
    );
    if (!token) deny("malformed_json");
    position += token[0].length;
  };
  scan(0);
  whitespace();
  if (position !== text.length) deny("malformed_json");
  const value = JSON.parse(text);
  jsonValue(value);
  if (requireCanonical && !equalBytes(canonical(value), raw)) deny("noncanonical_json");
  return value;
}
function equalBytes(a, b) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
function integer(value, min = 0) {
  if (!Number.isSafeInteger(value) || value < min) deny("invalid_integer");
  return value;
}
function identifier(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value))
    deny("invalid_identifier");
  return value;
}
function digestString(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) deny("invalid_digest");
  return value;
}
async function digest(value) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", canonical(value)))]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
async function fingerprint(carrier) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        encoder.encode(carrier.signedObject.protected + "." + carrier.signedObject.payload),
      ),
    ),
  ]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
function array(value, maximum, minimum = 0) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum)
    deny("invalid_array");
  return value;
}
function unique(value) {
  if (new Set(value).size !== value.length) deny("duplicate_value");
  return value;
}
function versions(value) {
  array(value, 50, 1);
  value.forEach((v) => integer(v, 1));
  if (
    !same(
      value,
      [...new Set(value)].sort((a, b) => a - b),
    )
  )
    deny("invalid_versions");
}
function ref(value) {
  exact(value, ["kind", "sourceService", "resourceId", "incarnation"]);
  if (!["holdings", "watchlist", "channel_follows"].includes(value.kind))
    deny("invalid_resource_ref");
  if (value.sourceService !== (value.kind === "holdings" ? "portfolio" : "user"))
    deny("invalid_resource_ref");
  identifier(value.resourceId);
  identifier(value.incarnation);
  return value;
}
async function publicKey(value) {
  exact(value, ["kty", "crv", "x", "y"]);
  if (
    value.kty !== "EC" ||
    value.crv !== "P-256" ||
    bytes(value.x).length !== 32 ||
    bytes(value.y).length !== 32
  )
    deny("invalid_public_key");
  await jose.importJWK(value, "ES256");
  return value;
}
async function keyId(value) {
  await publicKey(value);
  return jose.calculateJwkThumbprint(value, "sha256");
}
function header(carrier, typ, kid) {
  exact(carrier, ["protected", "payload", "signature"]);
  const h = parsed(bytes(carrier.protected));
  if (
    !same(h, { alg: "ES256", kid, typ, cty: "application/json" }) ||
    bytes(carrier.signature).length !== 64
  )
    deny("invalid_signature_profile");
  return h;
}
async function verify(carrier, key, typ) {
  const kid = await keyId(key);
  header(carrier, typ, kid);
  if (canonical(carrier).length > (typ === "fv-control+jws" ? 65536 : MAX_CARRIER))
    deny("payload_too_large");
  const out = await jose.flattenedVerify(carrier, await jose.importJWK(key, "ES256"), {
    algorithms: ["ES256"],
  });
  return parsed(out.payload, true);
}
async function sign(payload, privateKey, kid, typ) {
  return new jose.FlattenedSign(canonical(payload))
    .setProtectedHeader({ alg: "ES256", kid, typ, cty: "application/json" })
    .sign(privateKey);
}

function validate(name, value) {
  const validator = validators[name];
  if (!validator || !validator(value)) deny("invalid_schema");
}
function utc(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19)
  )
    deny("private_schema_invalid");
}
function safeUrl(value) {
  if (typeof value !== "string" || /[\s\\\x00-\x1f]/.test(value)) return false;
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      u.hostname &&
      !u.username &&
      !u.password &&
      (!u.port || u.port === "443")
    );
  } catch {
    return false;
  }
}
function markdown(value) {
  // Conservative input checks, not a renderer/sanitizer. Unknown named HTML
  // entities are rejected so decoding differences cannot conceal HTML/URLs.
  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    colon: ":",
    Tab: "\t",
    NewLine: "\n",
  };
  let text = value;
  for (let count = 0; count < 4; count++) {
    const decoded = text.replace(/&(#x[0-9a-f]+|#\d+|[A-Za-z][A-Za-z0-9]+);?/gi, (_, code) => {
      if (code[0] !== "#") {
        if (!Object.hasOwn(named, code)) deny("private_schema_invalid");
        return named[code];
      }
      const point = /^#x/i.test(code) ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      if (
        !Number.isSafeInteger(point) ||
        point <= 0 ||
        point > 0x10ffff ||
        (point >= 0xd800 && point <= 0xdfff)
      )
        deny("private_schema_invalid");
      return String.fromCodePoint(point);
    });
    if (decoded === text) break;
    text = decoded;
    if (count === 3 && /&(?:#x[0-9a-f]+|#\d+|[A-Za-z][A-Za-z0-9]+);?/i.test(text))
      deny("private_schema_invalid");
  }
  if (/<\s*(?:\/?[A-Za-z][A-Za-z0-9-]*(?:\s|\/?>)|!|\?)/.test(text) || /!\s*\[/.test(text))
    deny("private_schema_invalid");
  const destinations = [
    ...[...text.matchAll(/\]\(\s*(<[^>]+>|[^\s)]+)/g)].map((m) => m[1]),
    ...[...text.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/gm)].map((m) => m[1]),
    ...[...text.matchAll(/<([^<>\s]+:[^<>\s]*)>/g)].map((m) => m[1]),
  ];
  if (destinations.some((x) => !safeUrl(x.replace(/^<|>$/g, "")))) deny("private_schema_invalid");
}
function resultContent(content, outputSpec) {
  validate("ResultContent", content);
  unique(content.sections.map((row) => row.sectionId));
  unique(content.citations.map((row) => row.citationId));
  if (
    !same(
      content.sections.map((row) => row.sectionId),
      outputSpec.sections.map((row) => row.sectionId),
    )
  )
    deny("private_output_mismatch");
  for (const section of content.sections) markdown(section.markdown);
  for (const citation of content.citations) {
    if (!safeUrl(citation.url)) deny("private_schema_invalid");
    if (citation.publishedAt !== null) utc(citation.publishedAt);
  }
}
function privateContent(value, context) {
  validate("PrivatePayload", value);
  for (const key of ["objectId", "objectType", "revision", "binding"])
    if (!same(value[key], context[key])) deny("private_binding_mismatch");
  if (canonical(value).length > (context.objectType === "task" ? 65536 : 196608))
    deny("payload_too_large");
  const p = value.payload;
  if (context.objectType === "task") {
    unique(p.outputSpec.sections.map((x) => x.sectionId));
    if (p.template === "brief" && !context.resourceBindings.length) deny("private_schema_invalid");
    if (p.deliveryExpectation !== null) {
      try {
        new Intl.DateTimeFormat("en", { timeZone: p.deliveryExpectation.timeZone });
      } catch {
        deny("private_schema_invalid");
      }
    }
  } else {
    const expected = {
      holdings_snapshot: "holdings",
      watchlist_evidence: "watchlist",
      channel_follows_evidence: "channel_follows",
    }[context.objectType];
    if (!expected || p.data.kind !== expected || context.binding.resourceRef.kind !== expected)
      deny("private_schema_invalid");
    const d = p.data;
    utc(p.fetchedAt);
    if (p.sourceAsOf !== null) utc(p.sourceAsOf);
    if (expected === "holdings") {
      if (d.snapshotId !== context.objectId) deny("private_binding_mismatch");
      unique(d.accounts.map((x) => x.accountId));
      if (d.accounts.reduce((n, x) => n + x.positions.length, 0) > 1000)
        deny("private_schema_invalid");
      for (const a of d.accounts) {
        unique(a.balances.map((x) => x.currency));
        unique(a.positions.map((x) => x.assetId));
        if (
          a.positions.some((x) => x.marketValue !== null && x.marketValue.currency !== x.currency)
        )
          deny("private_schema_invalid");
      }
    } else if (expected === "watchlist") {
      unique(d.items.map((x) => x.symbol));
      for (const x of d.items) utc(x.addedAt);
    } else {
      unique(d.items.map((x) => x.followId));
      for (const x of d.items) {
        utc(x.addedAt);
        if (!/^@[^\s\x00-\x1f]+$/.test(x.handleOrUrl) && !safeUrl(x.handleOrUrl))
          deny("private_schema_invalid");
      }
    }
  }
  return p;
}

/** Memory-only, bounded session. Owner and agent operations use separate Worker ports. */
export class ForegroundSession {
  #onInvalidate;
  #state = "ABSENT";
  #generation = 0;
  #sessionId = null;
  #keys = null;
  #anchor = null;
  #registry = null;
  #registrySnapshots = new Map();
  #begins = new Map();
  #runs = new Map();
  #resultOutbox = new Map();
  #decrypted = new Map();
  #inputFacts = new Map();
  #inputPolicy = null;
  #sequence = 0;
  #history = new Map();
  #localEpochs = new Map();
  #metadata = null;
  #grant = null;
  #deliveryPin = null;
  #queue = Promise.resolve();
  #pending = 0;
  #timer = null;
  #started = 0;
  #deadline = 0;
  #wall = 0;
  #sigKid = null;
  #encKid = null;
  constructor({ onInvalidate = () => {} } = {}) {
    this.#onInvalidate = onInvalidate;
  }
  status() {
    return {
      helperVersion: VERSION,
      state: this.#state,
      sessionId: this.#sessionId,
      generation: this.#generation,
      privateKeysPresent: this.#keys !== null,
      privateKeysExtractable: false,
    };
  }
  #alive(g, setup = false) {
    if (
      g !== this.#generation ||
      !["READY", "ACTIVE", ...(setup ? ["SETTING_UP"] : [])].includes(this.#state)
    )
      deny("session_locked");
    if (performance.now() >= this.#deadline) {
      this.#invalidate("LOCKED");
      deny("session_expired");
    }
  }
  #invalidate(state) {
    clearTimeout(this.#timer);
    this.#generation++;
    this.#state = state;
    this.#keys = null;
    this.#registry = null;
    this.#metadata = null;
    this.#grant = null;
    this.#deliveryPin = null;
    this.#registrySnapshots.clear();
    this.#begins.clear();
    this.#runs.clear();
    this.#resultOutbox.clear();
    this.#decrypted.clear();
    this.#inputFacts.clear();
    this.#inputPolicy = null;
    this.#history.clear();
    this.#localEpochs.clear();
    this.#onInvalidate({ event: "sessionEnded", ...this.status() });
  }
  #time() {
    return this.#wall + Math.floor((performance.now() - this.#started) / 1000);
  }
  dispatch(message, trusted = false) {
    if (["initialize", "status", "lock", "revoke"].includes(message?.op))
      return this.#dispatch(message, trusted);
    if (this.#pending >= 8) return Promise.reject(new HelperDenied("queue_limit"));
    this.#pending++;
    const run = this.#queue
      .then(() => this.#dispatch(message, trusted))
      .finally(() => {
        this.#pending--;
      });
    this.#queue = run.catch(() => {});
    return run;
  }
  async #dispatch(m, trusted) {
    exact(m, ["id", "sessionId", "generation", "op", "args"]);
    identifier(m.id);
    identifier(m.sessionId);
    integer(m.generation, 1);
    if (canonical(m).length > MAX_RPC) deny("payload_too_large");
    const owner = Object.hasOwn(OWNER_OPS, m.op);
    if (!(owner || Object.hasOwn(AGENT_OPS, m.op)) || (owner && !trusted))
      deny("unsupported_operation");
    exact(m.args, owner ? OWNER_OPS[m.op] : AGENT_OPS[m.op]);
    if (m.op === "initialize") {
      if (this.#state !== "ABSENT") deny("already_initialized");
      try {
        return await this.#initialize(m);
      } catch (error) {
        if (
          this.#state === "SETTING_UP" &&
          this.#generation === m.generation &&
          this.#sessionId === m.sessionId
        )
          this.#invalidate("LOCKED");
        throw error;
      }
    }
    if (m.sessionId !== this.#sessionId || m.generation !== this.#generation)
      deny("session_mismatch");
    if (m.op === "status") return this.status();
    if (["lock", "revoke"].includes(m.op)) {
      this.#invalidate(m.op === "lock" ? "LOCKED" : "REVOKED");
      return this.status();
    }
    const g = this.#generation;
    this.#alive(g);
    if (m.op === "registry") await this.#registryPage(m.args.bundles, g);
    else if (m.op === "confirmDelivery") this.#confirm(m.args.pin);
    else if (m.op === "install") await this.#install(m.args.metadata, g);
    else if (m.op === "decrypt") return await this.#decrypt(m.args.objectId, m.args.envelope, g);
    else if (m.op === "beginRun") return await this.#beginRun(m.args.stableOperationId, g);
    else if (m.op === "installRun") return await this.#installRun(m.args.response, g);
    else if (m.op === "decryptRun") return await this.#decryptRun(m.args.runId, m.args.page, g);
    else if (m.op === "sealResult" || m.op === "reviseResult")
      return await this.#sealResult(m.args, m.op === "reviseResult", g);
    else if (m.op === "resultOutbox") return this.#outbox(m.args.runId, m.args.stableOperationId);
    else if (m.op === "acceptReceipt")
      return this.#acceptReceipt(m.args.runId, m.args.stableOperationId, m.args.receipt);
    this.#alive(g);
    return this.status();
  }
  async #initialize(m) {
    const a = m.args.anchor;
    exact(a, [
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
    for (const x of ["ownerSubject", "vaultId", "connectionId", "agentPrincipalId", "taskId"])
      validate("Identifier", a[x]);
    validate("PublicJWK", a.rootJwk);
    validate("KeyId", a.rootKeyId);
    digestString(a.checkpointDigest);
    integer(a.rootEpoch, 1);
    integer(a.registrySequence, 1);
    integer(m.args.now, 1);
    integer(m.args.ttlSeconds, 1);
    if (a.rootEpoch !== 1 || a.registrySequence > 32 || m.args.ttlSeconds > 3600)
      deny("invalid_anchor");
    this.#anchor = structuredClone(a);
    this.#sessionId = m.sessionId;
    this.#generation = m.generation;
    this.#wall = m.args.now;
    this.#started = performance.now();
    this.#deadline = this.#started + m.args.ttlSeconds * 1000;
    this.#state = "SETTING_UP";
    const g = this.#generation;
    if ((await keyId(a.rootJwk)) !== a.rootKeyId) deny("root_pin_mismatch");
    this.#alive(g, true);
    const sig = await jose.generateKeyPair("ES256", { crv: "P-256", extractable: false });
    this.#alive(g, true);
    const enc = await jose.generateKeyPair("ECDH-ES+A256KW", { crv: "P-256", extractable: false });
    this.#alive(g, true);
    if (sig.privateKey.extractable || enc.privateKey.extractable) deny("unsafe_private_key");
    const pub = async (key) => {
      const p = await jose.exportJWK(key);
      return { kty: p.kty, crv: p.crv, x: p.x, y: p.y };
    };
    const signing = await pub(sig.publicKey),
      encryption = await pub(enc.publicKey);
    this.#alive(g, true);
    this.#sigKid = await keyId(signing);
    this.#encKid = await keyId(encryption);
    this.#alive(g, true);
    if (this.#sigKid === this.#encKid) deny("key_role_reuse");
    for (const key of [sig.privateKey, enc.privateKey]) {
      let blocked = false;
      try {
        await crypto.subtle.exportKey("jwk", key);
      } catch {
        blocked = true;
      }
      if (!blocked) deny("unsafe_private_key");
      this.#alive(g, true);
    }
    this.#keys = { sig: sig.privateKey, enc: enc.privateKey };
    this.#state = "READY";
    this.#timer = setTimeout(() => this.#invalidate("LOCKED"), m.args.ttlSeconds * 1000);
    return {
      ...this.status(),
      agentSigningPublicJwk: signing,
      agentEncryptionPublicJwk: encryption,
      agentSigningKeyId: this.#sigKid,
      agentEncryptionKeyId: this.#encKid,
      keyExportRejected: true,
    };
  }
  #identity(v) {
    if (
      v.contractVersion !== CONTRACT ||
      v.ownerSubject !== this.#anchor.ownerSubject ||
      v.vaultId !== this.#anchor.vaultId
    )
      deny("identity_mismatch");
  }
  #key(kid, role = null, connection = undefined) {
    const c = this.#registry?.keys.get(kid);
    if (
      !c ||
      !c.active ||
      this.#registry.revoked.has(kid) ||
      !(c.notBefore <= this.#time() && this.#time() < c.expiresAt) ||
      c.keyEpoch !== this.#localEpochs.get([c.principalId, c.role, c.connectionId].join("/"))
    )
      deny("key_revoked_or_expired");
    if (role && c.role !== role) deny("key_role_mismatch");
    if (connection !== undefined && c.connectionId !== connection) deny("connection_mismatch");
    return c;
  }
  async #registryPage(bundles, g) {
    array(bundles, 8, 1);
    for (const b of bundles) {
      validate("RegistryBundle", b);
      if (canonical(b).length > 131072) deny("payload_too_large");
      const cp = await verify(b.checkpoint, this.#anchor.rootJwk, "fv-control+jws");
      this.#alive(g);
      validate("RegistryCheckpointPayload", cp);
      this.#identity(cp);
      if (
        cp.rootKeyId !== this.#anchor.rootKeyId ||
        cp.rootEpoch !== this.#anchor.rootEpoch ||
        cp.issuedAt > this.#time()
      )
        deny("root_pin_mismatch");
      const d = await digest(cp);
      this.#alive(g);
      if (this.#history.has(cp.registrySequence)) {
        if (this.#history.get(cp.registrySequence) !== d) deny("registry_rollback");
        continue;
      }
      if (
        cp.registrySequence !== this.#sequence + 1 ||
        cp.registrySequence > 32 ||
        cp.previousDigest !== (this.#registry?.digest ?? null)
      )
        deny("registry_chain_mismatch");
      if (
        this.#registry &&
        (cp.keyEpoch < this.#registry.keyEpoch ||
          cp.issuedAt < this.#registry.issuedAt ||
          [...this.#registry.revoked].some((k) => !cp.revokedKeyIds.includes(k)))
      )
        deny("registry_rollback");
      const keys = new Map(),
        ids = [],
        descriptions = [],
        generations = new Set();
      for (const row of b.entries) {
        const c = await verify(row.certificate, this.#anchor.rootJwk, "fv-control+jws");
        this.#alive(g);
        validate("KeyCertificatePayload", c);
        this.#identity(c);
        if (
          c.issuerKeyId !== this.#anchor.rootKeyId ||
          c.keyId !== (await keyId(c.publicJwk)) ||
          keys.has(c.keyId) ||
          c.expiresAt <= c.notBefore ||
          !ROLES.includes(c.role) ||
          c.role.startsWith("agent_") !== (c.connectionId !== null) ||
          row.active === cp.revokedKeyIds.includes(c.keyId) ||
          (c.role === "root_sig") !== (c.keyId === this.#anchor.rootKeyId)
        )
          deny("invalid_certificate");
        this.#alive(g);
        const permitted =
          c.role === "device_sig"
            ? ["object_write", "task_grant", "control_write"]
            : c.role === "agent_sig"
              ? ["run_request", "result_write"]
              : [];
        if (c.capabilities.some((x) => !permitted.includes(x))) deny("invalid_certificate");
        const identity = [c.principalId, c.role, c.connectionId].join("/"),
          generation = identity + "/" + c.keyEpoch;
        if (generations.has(generation)) deny("key_epoch_conflict");
        generations.add(generation);
        const old = this.#registry?.keys.get(c.keyId);
        if (old && !same(Object.fromEntries(Object.keys(c).map((k) => [k, old[k]])), c))
          deny("registry_conflict");
        if (!old && this.#registry && c.keyEpoch <= (this.#localEpochs.get(identity) ?? 0))
          deny("key_epoch_conflict");
        keys.set(c.keyId, { ...c, active: row.active });
        ids.push(c.certificateId);
        descriptions.push({
          certificateId: c.certificateId,
          payloadDigest: await digest(c),
          active: row.active,
        });
        this.#alive(g);
      }
      unique(ids);
      if (
        (await digest(
          descriptions.sort((a, b) =>
            a.certificateId < b.certificateId ? -1 : a.certificateId > b.certificateId ? 1 : 0,
          ),
        )) !== cp.entriesDigest
      )
        deny("registry_digest_mismatch");
      this.#alive(g);
      if (
        cp.registrySequence === this.#anchor.registrySequence &&
        d !== this.#anchor.checkpointDigest
      )
        deny("checkpoint_pin_mismatch");
      for (const c of keys.values()) {
        const identity = [c.principalId, c.role, c.connectionId].join("/");
        this.#localEpochs.set(identity, Math.max(c.keyEpoch, this.#localEpochs.get(identity) ?? 0));
      }
      this.#sequence = cp.registrySequence;
      this.#history.set(cp.registrySequence, d);
      this.#registry = {
        keys,
        revoked: new Set(cp.revokedKeyIds),
        digest: d,
        keyEpoch: cp.keyEpoch,
        issuedAt: cp.issuedAt,
      };
      this.#registrySnapshots.set(cp.registrySequence, {
        ...this.#registry,
        localEpochs: new Map(this.#localEpochs),
      });
    }
    if (this.#grant) {
      try {
        // A known checkpoint change must invalidate cached issuer/recipient
        // authority too, not just this agent's own two certificates.
        await this.#install(this.#metadata, g);
      } catch (error) {
        if (this.#generation === g) this.#invalidate("REVOKED");
        throw error;
      }
    }
  }
  #confirm(pin) {
    exact(pin, [
      "preparationId",
      "taskVersion",
      "taskEnvelopeFingerprint",
      "taskDeliveryFingerprint",
      "objects",
      "deliveryRevision",
      "priorEnvelopeFingerprint",
      "authorizationId",
      "grantId",
      "grantEpoch",
      "executionEpoch",
    ]);
    for (const k of ["preparationId", "authorizationId", "grantId"]) validate("Identifier", pin[k]);
    for (const k of ["taskVersion", "deliveryRevision", "grantEpoch", "executionEpoch"])
      integer(pin[k], 1);
    digestString(pin.taskEnvelopeFingerprint);
    digestString(pin.taskDeliveryFingerprint);
    array(pin.objects, 11, 1);
    for (const row of pin.objects) {
      exact(row, ["objectId", "envelopeFingerprint"]);
      validate("Identifier", row.objectId);
      digestString(row.envelopeFingerprint);
    }
    if (
      !same(
        pin.objects,
        [...pin.objects].sort((a, b) =>
          a.objectId < b.objectId ? -1 : a.objectId > b.objectId ? 1 : 0,
        ),
      )
    )
      deny("invalid_delivery_pin");
    unique(pin.objects.map((row) => row.objectId));
    digestString(pin.priorEnvelopeFingerprint);
    if (pin.deliveryRevision < 2) deny("invalid_delivery_pin");
    this.#begins.clear();
    this.#runs.clear();
    this.#resultOutbox.clear();
    this.#decrypted.clear();
    this.#inputFacts.clear();
    this.#inputPolicy = null;
    this.#deliveryPin = structuredClone(pin);
    this.#metadata = null;
    this.#grant = null;
    this.#state = "READY";
  }
  async #install(m, g) {
    if (
      !this.#deliveryPin ||
      !this.#registry ||
      this.#history.get(this.#anchor.registrySequence) !== this.#anchor.checkpointDigest
    )
      deny("trusted_pin_required");
    exact(m, [
      "contractVersion",
      "profile",
      "preparationId",
      "connectionId",
      "authorizationId",
      "clientId",
      "taskId",
      "taskVersion",
      "grantId",
      "grantEpoch",
      "executionEpoch",
      "keyEpoch",
      "ownerSubject",
      "vaultId",
      "rootJwk",
      "rootKeyId",
      "rootEpoch",
      "agentKeyGrant",
      "authorizationExpiresAt",
      "registryProofs",
      "taskMetadata",
      "taskDeliveryBase",
      "objects",
    ]);
    if (m.contractVersion !== CONTRACT || m.profile !== PROFILE) deny("unsupported_contract");
    this.#identity(m);
    const pin = this.#deliveryPin;
    for (const k of [
      "preparationId",
      "taskVersion",
      "authorizationId",
      "grantId",
      "grantEpoch",
      "executionEpoch",
    ])
      if (m[k] !== pin[k]) deny("delivery_binding_mismatch");
    if (
      m.taskId !== this.#anchor.taskId ||
      m.connectionId !== this.#anchor.connectionId ||
      m.rootKeyId !== this.#anchor.rootKeyId ||
      m.rootEpoch !== this.#anchor.rootEpoch ||
      !same(m.rootJwk, this.#anchor.rootJwk) ||
      m.keyEpoch !== this.#registry.keyEpoch
    )
      deny("identity_mismatch");
    validate("TaskMetadata", m.taskMetadata);
    utc(m.taskMetadata.createdAt);
    utc(m.taskMetadata.updatedAt);
    exact(m.taskDeliveryBase, ["deliveryRevision", "envelopeFingerprint"]);
    if (
      m.taskDeliveryBase.deliveryRevision !== pin.deliveryRevision - 1 ||
      m.taskDeliveryBase.envelopeFingerprint !== pin.priorEnvelopeFingerprint ||
      (pin.deliveryRevision === 2 && pin.priorEnvelopeFingerprint !== pin.taskEnvelopeFingerprint)
    )
      deny("delivery_binding_mismatch");
    array(m.registryProofs, 32, 1);
    for (let i = 0; i < m.registryProofs.length; i++) {
      const proof = m.registryProofs[i];
      exact(proof, ["registrySequence", "checkpointDigest", "path"]);
      if (
        proof.registrySequence !== i + 1 ||
        this.#history.get(proof.registrySequence) !== proof.checkpointDigest ||
        proof.path !== `/agent/v2/preparations/${m.preparationId}/registries/${i + 1}`
      )
        deny("invalid_registry_proof");
    }
    if (
      m.taskMetadata.taskId !== m.taskId ||
      m.taskMetadata.taskVersion !== m.taskVersion ||
      m.taskMetadata.status !== "active" ||
      m.taskMetadata.envelopeFingerprint !== pin.taskEnvelopeFingerprint ||
      m.taskMetadata.executionEpoch !== m.executionEpoch
    )
      deny("task_binding_mismatch");
    validate("SignedObject", m.agentKeyGrant);
    const h = parsed(bytes(m.agentKeyGrant.protected)),
      device = this.#key(h.kid, "device_sig", null);
    if (!device.capabilities.includes("task_grant")) deny("insufficient_capability");
    const grant = await verify(m.agentKeyGrant, device.publicJwk, "fv-control+jws");
    this.#alive(g);
    validate("AgentKeyGrantPayload", grant);
    this.#identity(grant);
    for (const k of [
      "taskId",
      "connectionId",
      "authorizationId",
      "grantId",
      "grantEpoch",
      "executionEpoch",
      "keyEpoch",
    ])
      if (grant[k] !== m[k]) deny("grant_binding_mismatch");
    if (
      grant.deviceSigningKeyId !== device.keyId ||
      grant.agentSigningKeyId !== this.#sigKid ||
      grant.agentEncryptionKeyId !== this.#encKid ||
      grant.agentSigningKeyEpoch !==
        this.#key(this.#sigKid, "agent_sig", this.#anchor.connectionId).keyEpoch ||
      grant.agentEncryptionKeyEpoch !==
        this.#key(this.#encKid, "agent_enc", this.#anchor.connectionId).keyEpoch ||
      this.#key(this.#sigKid).principalId !== this.#anchor.agentPrincipalId ||
      this.#key(this.#encKid).principalId !== this.#anchor.agentPrincipalId ||
      grant.historyPolicy !== "selected" ||
      !same(grant.taskVersions, [m.taskVersion]) ||
      this.#history.get(grant.registrySequence) !== grant.checkpointDigest
    )
      deny("grant_binding_mismatch");
    const sig = this.#key(this.#sigKid),
      enc = this.#key(this.#encKid);
    integer(m.authorizationExpiresAt, 1);
    if (
      !(grant.notBefore <= this.#time() && this.#time() < grant.expiresAt) ||
      grant.expiresAt - grant.notBefore > 2592000 ||
      grant.notBefore < Math.max(device.notBefore, sig.notBefore, enc.notBefore) ||
      grant.expiresAt >
        Math.min(m.authorizationExpiresAt, device.expiresAt, sig.expiresAt, enc.expiresAt)
    )
      deny("grant_expired_or_untrusted");
    if (!same(grant.writebackRecipientKeyIds, [...new Set(grant.writebackRecipientKeyIds)].sort()))
      deny("invalid_recipients");
    const recipientRoles = [];
    for (const kid of grant.writebackRecipientKeyIds) {
      const r = this.#key(kid, null, null);
      recipientRoles.push(r.role);
      if (
        !["device_enc", "recovery_enc"].includes(r.role) ||
        grant.expiresAt > r.expiresAt ||
        grant.notBefore < r.notBefore
      )
        deny("invalid_recipients");
    }
    if (!recipientRoles.includes("device_enc") || !recipientRoles.includes("recovery_enc"))
      deny("invalid_recipients");
    const refs = [];
    for (const b of grant.resourceBindings) {
      if (b.versionAccess !== "selected" || b.selectedVersions.length !== 1)
        deny("resource_not_selected");
      refs.push(canonicalize(b.ref));
    }
    unique(refs);
    if (
      !same(
        grant.resourceBindings.map((b) => ({ ref: b.ref, sourceEpoch: b.sourceEpoch })),
        m.taskMetadata.resourceBindings,
      )
    )
      deny("resource_set_mismatch");
    array(m.objects, 11, 1);
    const confirmedObjects = m.objects
      .map((row) => ({ objectId: row.objectId, envelopeFingerprint: row.envelopeFingerprint }))
      .sort((a, b) => (a.objectId < b.objectId ? -1 : a.objectId > b.objectId ? 1 : 0));
    if (!same(confirmedObjects, pin.objects)) deny("delivery_binding_mismatch");
    const seen = [],
      resourceSeen = [];
    let tasks = 0;
    for (const d of m.objects) {
      exact(d, [
        "objectId",
        "objectType",
        "revision",
        "deliveryRevision",
        "priorEnvelopeFingerprint",
        "envelopeFingerprint",
        "resourceRef",
        "sourceEpoch",
        "sourceRevision",
        "producerSnapshotId",
        "path",
        "provenance",
      ]);
      for (const k of [
        "objectId",
        "objectType",
        "revision",
        "deliveryRevision",
        "envelopeFingerprint",
        "resourceRef",
        "sourceEpoch",
        "sourceRevision",
        "path",
        "provenance",
      ])
        if (!Object.hasOwn(d, k)) deny("invalid_descriptor");
      validate("Identifier", d.objectId);
      integer(d.revision, 1);
      integer(d.deliveryRevision, 1);
      digestString(d.envelopeFingerprint);
      if (d.path !== `/agent/v2/preparations/${m.preparationId}/objects/${d.objectId}`)
        deny("invalid_descriptor");
      seen.push(d.objectId);
      if (d.objectType === "task") {
        tasks++;
        if (
          d.objectId !== m.taskId ||
          d.revision !== m.taskVersion ||
          d.deliveryRevision !== pin.deliveryRevision ||
          d.envelopeFingerprint !== pin.taskDeliveryFingerprint ||
          d.priorEnvelopeFingerprint !== pin.priorEnvelopeFingerprint ||
          d.producerSnapshotId !== null ||
          d.resourceRef !== null ||
          d.sourceEpoch !== null ||
          d.sourceRevision !== null ||
          d.provenance !== "task_reshare"
        )
          deny("task_binding_mismatch");
      } else {
        const b = grant.resourceBindings.find((b) => same(b.ref, d.resourceRef));
        if (
          !b ||
          d.sourceEpoch !== b.sourceEpoch ||
          d.sourceRevision !== d.revision ||
          !b.selectedVersions.includes(d.revision) ||
          d.deliveryRevision !== 1 ||
          d.priorEnvelopeFingerprint !== null ||
          d.objectType !==
            {
              holdings: "holdings_snapshot",
              watchlist: "watchlist_evidence",
              channel_follows: "channel_follows_evidence",
            }[b.ref.kind] ||
          d.provenance !== "owner_attested_copy"
        )
          deny("resource_not_authorized");
        resourceSeen.push(canonicalize(d.resourceRef));
        if (d.producerSnapshotId !== null) validate("Identifier", d.producerSnapshotId);
      }
    }
    unique(seen);
    unique(resourceSeen);
    if (
      tasks !== 1 ||
      resourceSeen.length !== refs.length ||
      refs.some((x) => !resourceSeen.includes(x))
    )
      deny("resource_set_mismatch");
    this.#metadata = structuredClone(m);
    this.#grant = grant;
    this.#state = "ACTIVE";
  }
  #runAuthority() {
    if (this.#state !== "ACTIVE" || !this.#metadata || !this.#grant) deny("grant_required");
    const grant = this.#grant;
    if (this.#time() >= Math.min(grant.expiresAt, this.#metadata.authorizationExpiresAt)) {
      this.#invalidate("LOCKED");
      deny("grant_expired_or_untrusted");
    }
    const sig = this.#key(this.#sigKid, "agent_sig", this.#anchor.connectionId);
    this.#key(this.#encKid, "agent_enc", this.#anchor.connectionId);
    if (!sig.capabilities.includes("run_request") || !grant.capabilities.includes("decrypt_task"))
      deny("insufficient_capability");
    if (grant.resourceBindings.length && !grant.capabilities.includes("decrypt_resources"))
      deny("insufficient_capability");
    return grant;
  }
  #resourceVersions() {
    return this.#grant.resourceBindings.map((binding) => {
      const d = this.#metadata.objects.find((row) => same(row.resourceRef, binding.ref));
      if (!d) deny("resource_not_authorized");
      return {
        ref: structuredClone(binding.ref),
        revision: d.revision,
        sourceEpoch: d.sourceEpoch,
        envelopeFingerprint: d.envelopeFingerprint,
      };
    });
  }
  async #beginRun(operation, g) {
    const grant = this.#runAuthority();
    if (typeof operation !== "string" || !/^[A-Za-z0-9_-]{22,128}$/.test(operation))
      deny("invalid_operation_id");
    this.#checkInputPolicy();
    const existing = this.#begins.get(operation);
    if (existing) return structuredClone(existing.public);
    if (this.#begins.size >= 32) deny("run_capacity");
    // Typed decryption and the conservative private input-policy checks precede
    // signing; they do not prove source truth, financial equivalence or model quality.
    if (
      this.#metadata.objects.some((d) => this.#decrypted.get(d.objectId) !== d.envelopeFingerprint)
    )
      deny("inputs_not_decrypted");
    const intent = {
      artifactType: "begin_run_intent",
      contractVersion: CONTRACT,
      ownerSubject: this.#anchor.ownerSubject,
      vaultId: this.#anchor.vaultId,
      stableOperationId: operation,
      taskId: grant.taskId,
      expectedTaskVersion: this.#metadata.taskVersion,
      taskEnvelopeFingerprint: this.#deliveryPin.taskDeliveryFingerprint,
      resourceVersions: this.#resourceVersions(),
      connectionId: grant.connectionId,
      authorizationId: grant.authorizationId,
      grantId: grant.grantId,
      grantEpoch: grant.grantEpoch,
      executionEpoch: grant.executionEpoch,
      keyEpoch: this.#registry.keyEpoch,
      registrySequence: this.#sequence,
      checkpointDigest: this.#registry.digest,
    };
    validate("BeginRunIntentPayload", intent);
    const signed = await sign(intent, this.#keys.sig, this.#sigKid, "fv-control+jws");
    this.#alive(g);
    const fp = await fingerprint({ signedObject: signed });
    this.#alive(g);
    const ns = [
      intent.ownerSubject,
      intent.vaultId,
      intent.connectionId,
      intent.authorizationId,
      intent.grantId,
      intent.grantEpoch,
      intent.taskId,
      operation,
      fp,
    ];
    const ids = {
      runId: "run_" + (await digest(["folioview.run-allocation.v1", ...ns])),
      manifestId: "manifest_" + (await digest(["folioview.manifest-allocation.v1", ...ns])),
      initialResultId: "result_" + (await digest(["folioview.result-allocation.v1", ...ns])),
    };
    this.#alive(g);
    const value = {
      contractVersion: CONTRACT,
      stableOperationId: operation,
      signedBeginIntent: signed,
      beginIntentFingerprint: fp,
      ...ids,
    };
    this.#begins.set(operation, { intent, signed, fp, ids, public: value });
    return structuredClone(value);
  }
  #checkInputPolicy(at = this.#time()) {
    if (
      !this.#inputPolicy ||
      !this.#metadata ||
      this.#metadata.objects.some((d) => this.#decrypted.get(d.objectId) !== d.envelopeFingerprint)
    )
      deny("inputs_not_decrypted");
    for (const d of this.#metadata.objects.filter((row) => row.objectType !== "task")) {
      const facts = this.#inputFacts.get(d.objectId),
        policy = this.#inputPolicy;
      if (!facts) deny("inputs_not_decrypted");
      if (!policy.allowPartial && facts.coverage !== "complete") deny("input_policy_partial");
      if (!policy.allowUnknownAsOf && facts.sourceAsOf === null) deny("input_policy_asof");
      const age = at - Date.parse(facts.fetchedAt) / 1000;
      if (!Number.isFinite(age) || age < 0 || age > policy.maxFetchedAgeSeconds)
        deny("input_policy_fetched_age");
      if (
        facts.freshness === "stale" ||
        (facts.freshness === "unknown" && !policy.allowUnknownAsOf)
      )
        deny("input_policy_freshness");
    }
  }
  #historicalAuthor(kid, proof) {
    const snapshot = this.#registrySnapshots.get(proof.registrySequence),
      author = snapshot?.keys.get(kid);
    if (
      !snapshot ||
      proof.verifiedAt < snapshot.issuedAt ||
      !author ||
      !author.active ||
      snapshot.revoked.has(kid) ||
      author.role !== "device_sig" ||
      author.connectionId !== null ||
      !(author.notBefore <= proof.verifiedAt && proof.verifiedAt < author.expiresAt) ||
      author.keyEpoch !==
        snapshot.localEpochs.get(
          [author.principalId, author.role, author.connectionId].join("/"),
        ) ||
      !author.capabilities.includes("object_write")
    )
      deny("historical_author_untrusted");
    return author;
  }
  async #installRun(response, g) {
    this.#runAuthority();
    exact(response, [
      "contractVersion",
      "profile",
      "run",
      "manifest",
      "manifestFingerprint",
      "componentPath",
      "registryProofs",
      "authorProofs",
    ]);
    if (response.contractVersion !== CONTRACT || response.profile !== "folioview.agent-run.v1")
      deny("unsupported_contract");
    const r = response.run,
      m = response.manifest;
    validate("RunDescriptor", r);
    validate("ManifestDescriptor", m);
    if (canonical(m).length > 262144) deny("payload_too_large");
    const begin = [...this.#begins.values()].find((row) => row.fp === r.beginIntentFingerprint);
    if (!begin) deny("begin_intent_pin_required");
    for (const k of ["runId", "manifestId", "initialResultId"])
      if (r[k] !== begin.ids[k]) deny("run_allocation_mismatch");
    if (r.state !== "ready") deny("run_not_ready");
    const fields = [
      "vaultId",
      "taskId",
      "connectionId",
      "authorizationId",
      "grantId",
      "grantEpoch",
      "executionEpoch",
      "keyEpoch",
    ];
    for (const k of fields) if (r[k] !== begin.intent[k]) deny("run_binding_mismatch");
    if (r.taskVersion !== begin.intent.expectedTaskVersion) deny("run_binding_mismatch");
    const lifetime = (value) => {
      utc(value.createdAt);
      utc(value.expiresAt);
      const created = Date.parse(value.createdAt) / 1000,
        expires = Date.parse(value.expiresAt) / 1000;
      if (
        !(this.#grant.notBefore <= created && created <= this.#time() && this.#time() < expires) ||
        expires - created <= 0 ||
        expires - created > 7200 ||
        expires > this.#grant.expiresAt
      )
        deny("run_expired_or_untrusted");
    };
    lifetime(r);
    lifetime(m);
    if (
      Date.parse(m.createdAt) < Date.parse(r.createdAt) ||
      Date.parse(m.expiresAt) > Date.parse(r.expiresAt)
    )
      deny("run_lifetime_mismatch");
    for (const k of [
      "manifestId",
      "runId",
      "vaultId",
      "taskId",
      "taskVersion",
      "connectionId",
      "grantId",
      "grantEpoch",
      "executionEpoch",
      "keyEpoch",
      "beginIntentFingerprint",
    ])
      if (m[k] !== r[k]) deny("manifest_binding_mismatch");
    if ((await fingerprint({ signedObject: m.signedBeginIntent })) !== begin.fp)
      deny("begin_intent_mismatch");
    this.#alive(g);
    const signedIntent = await verify(
      m.signedBeginIntent,
      this.#key(this.#sigKid, "agent_sig", this.#anchor.connectionId).publicJwk,
      "fv-control+jws",
    );
    this.#alive(g);
    if (
      !same(signedIntent, begin.intent) ||
      this.#history.get(signedIntent.registrySequence) !== signedIntent.checkpointDigest
    )
      deny("begin_intent_mismatch");
    const expectedTask = this.#metadata.objects.find((d) => d.objectType === "task");
    const reference = (d) => ({
      objectId: d.objectId,
      objectType: d.objectType,
      revision: d.revision,
      deliveryRevision: d.deliveryRevision,
      envelopeFingerprint: d.envelopeFingerprint,
      keyEpoch: this.#grant.keyEpoch,
    });
    if (!same(m.taskEnvelope, reference(expectedTask))) deny("manifest_task_mismatch");
    const entries = begin.intent.resourceVersions.map((selected) => {
      const d = this.#metadata.objects.find((row) => same(row.resourceRef, selected.ref));
      return { ...reference(d), ref: selected.ref, sourceEpoch: selected.sourceEpoch };
    });
    if (!same(m.entries, entries)) deny("manifest_resource_mismatch");
    if ((await digest(m)) !== response.manifestFingerprint) deny("manifest_fingerprint_mismatch");
    this.#alive(g);
    if (response.componentPath !== `/agent/v2/runs/${r.runId}/inputs`) deny("run_path_mismatch");
    array(response.registryProofs, 32, 1);
    for (let i = 0; i < response.registryProofs.length; i++) {
      const proof = response.registryProofs[i];
      exact(proof, ["registrySequence", "checkpointDigest", "path"]);
      if (
        proof.registrySequence !== i + 1 ||
        this.#history.get(i + 1) !== proof.checkpointDigest ||
        proof.path !== `/agent/v2/runs/${r.runId}/registries/${i + 1}`
      )
        deny("invalid_registry_proof");
    }
    array(response.authorProofs, entries.length + 1, entries.length + 1);
    const descriptors = [m.taskEnvelope, ...m.entries];
    for (let i = 0; i < descriptors.length; i++) {
      const proof = response.authorProofs[i];
      exact(proof, ["objectId", "registrySequence", "verifiedAt"]);
      if (
        proof.objectId !== descriptors[i].objectId ||
        proof.registrySequence !== begin.intent.registrySequence ||
        proof.verifiedAt !== Date.parse(r.createdAt) / 1000 ||
        !this.#registrySnapshots.has(proof.registrySequence) ||
        proof.verifiedAt < this.#registrySnapshots.get(proof.registrySequence).issuedAt
      )
        deny("historical_author_untrusted");
    }
    const frozen = {
      run: r,
      manifest: m,
      fp: response.manifestFingerprint,
      authorProofs: response.authorProofs,
    };
    const old = this.#runs.get(r.runId);
    if (old && !same(old.frozen, frozen)) deny("run_replacement");
    if (!old)
      this.#runs.set(r.runId, {
        frozen: structuredClone(frozen),
        nextIndex: 0,
        lastIndex: -1,
        outputSpec: null,
        acceptedRevision: 0,
      });
    return {
      runId: r.runId,
      manifestId: r.manifestId,
      manifestFingerprint: response.manifestFingerprint,
      componentCount: descriptors.length,
      nextComponentIndex: this.#runs.get(r.runId).nextIndex,
    };
  }
  async #decryptRun(id, page, g) {
    this.#runAuthority();
    const saved = this.#runs.get(id);
    if (!saved) deny("run_pin_required");
    const { run, manifest, fp, authorProofs } = saved.frozen;
    this.#checkInputPolicy(Date.parse(run.createdAt) / 1000);
    if (this.#time() >= Date.parse(run.expiresAt) / 1000) deny("run_expired_or_untrusted");
    validate("ManifestComponentPage", page);
    if (canonical(page).length > MAX_RPC) deny("payload_too_large");
    if (!same(page.manifest, manifest) || page.manifestFingerprint !== fp)
      deny("manifest_binding_mismatch");
    const index = page.componentIndex,
      references = [manifest.taskEnvelope, ...manifest.entries];
    if (index >= references.length || (index !== saved.nextIndex && index !== saved.lastIndex))
      deny("component_order_mismatch");
    if ((page.nextCursor === null) !== (index === references.length - 1))
      deny("component_cursor_mismatch");
    const d = references[index],
      c = page.component;
    if (
      c.kind !== (index === 0 ? "task" : "resource") ||
      c.objectId !== d.objectId ||
      c.revision !== d.revision ||
      c.deliveryRevision !== d.deliveryRevision
    )
      deny("component_binding_mismatch");
    const result = await this.#decrypt(
      c.objectId,
      { contractVersion: CONTRACT, signedObject: c.signedObject },
      g,
      authorProofs[index],
    );
    this.#alive(g);
    if (index === saved.nextIndex) {
      if (index === 0) saved.outputSpec = structuredClone(result.payload.outputSpec);
      saved.lastIndex = index;
      saved.nextIndex = index + 1;
    }
    return {
      ...result,
      runId: id,
      manifestId: run.manifestId,
      manifestFingerprint: fp,
      componentIndex: index,
      nextCursor: page.nextCursor,
    };
  }
  #operation(operation) {
    if (typeof operation !== "string" || !/^[A-Za-z0-9_-]{22,128}$/.test(operation))
      deny("invalid_operation_id");
  }
  #outbox(id, operation) {
    identifier(id);
    this.#operation(operation);
    const saved = this.#resultOutbox.get(id + "/" + operation);
    if (!saved || saved.packet.runId !== id) deny("result_operation_not_found");
    // No current Run expiry/key check: retrieving already produced ciphertext
    // and verifying an authenticated saved receipt are not new cryptographic writes.
    return { ...structuredClone(saved.packet), receipt: structuredClone(saved.receipt) };
  }
  #resultAuthority(saved) {
    if (this.#state !== "ACTIVE" || !this.#grant || !this.#metadata) deny("grant_required");
    const grant = this.#grant,
      run = saved.frozen.run;
    if (this.#time() >= Math.min(grant.expiresAt, this.#metadata.authorizationExpiresAt))
      deny("grant_expired_or_untrusted");
    const author = this.#key(this.#sigKid, "agent_sig", this.#anchor.connectionId);
    this.#key(this.#encKid, "agent_enc", this.#anchor.connectionId);
    if (
      !author.capabilities.includes("result_write") ||
      !grant.capabilities.includes("encrypt_result")
    )
      deny("insufficient_capability");
    for (const k of [
      "taskId",
      "connectionId",
      "authorizationId",
      "grantId",
      "grantEpoch",
      "executionEpoch",
      "keyEpoch",
    ])
      if (run[k] !== grant[k]) deny("run_binding_mismatch");
    if (!grant.taskVersions.includes(run.taskVersion) || run.keyEpoch !== this.#registry.keyEpoch)
      deny("run_binding_mismatch");
    if (this.#time() >= Date.parse(run.expiresAt) / 1000) deny("run_expired_or_untrusted");
    const recipients = grant.writebackRecipientKeyIds.map((kid) => this.#key(kid, null, null));
    if (
      !recipients.some((r) => r.role === "device_enc") ||
      !recipients.some((r) => r.role === "recovery_enc") ||
      recipients.some((r) => !["device_enc", "recovery_enc"].includes(r.role))
    )
      deny("invalid_recipients");
    return recipients;
  }
  async #sealResult(args, isRevision, g) {
    identifier(args.runId);
    this.#operation(args.stableOperationId);
    const saved = this.#runs.get(args.runId);
    if (!saved) deny("run_pin_required");
    const recipients = this.#resultAuthority(saved),
      { run, manifest, fp } = saved.frozen;
    if (saved.nextIndex !== manifest.entries.length + 1 || !saved.outputSpec)
      deny("run_inputs_not_decrypted");
    const expected = isRevision ? integer(args.expectedRevision, 1) : 0;
    if (!Number.isSafeInteger(expected + 1)) deny("invalid_integer");
    resultContent(args.content, saved.outputSpec);
    const privateIntent = await digest({
      runId: args.runId,
      operation: args.stableOperationId,
      expectedRevision: expected,
      operationType: isRevision ? "revise_result" : "submit_result",
      content: args.content,
    });
    this.#alive(g);
    const operationKey = args.runId + "/" + args.stableOperationId;
    const old = this.#resultOutbox.get(operationKey);
    if (old) {
      if (old.privateIntent !== privateIntent) deny("idempotency_conflict");
      return structuredClone(old.packet);
    }
    if (!isRevision && [...this.#resultOutbox.values()].some((x) => x.packet.runId === args.runId))
      deny("initial_result_exists");
    if (isRevision && saved.acceptedRevision !== expected) deny("revision_base_unacknowledged");
    if (this.#resultOutbox.size >= 32) deny("result_capacity");
    const candidates = [...this.#resultOutbox.values()].filter(
      (x) => x.packet.runId === args.runId && x.packet.expectedRevision === expected,
    );
    if (isRevision && candidates.length >= 2) deny("revision_candidate_limit");
    const binding = {
      ...Object.fromEntries(EMPTY_BINDING.map((k) => [k, null])),
      taskId: run.taskId,
      taskVersion: run.taskVersion,
      runId: run.runId,
      manifestId: run.manifestId,
      taskEnvelopeFingerprint: manifest.taskEnvelope.envelopeFingerprint,
      manifestFingerprint: fp,
      connectionId: run.connectionId,
      grantId: run.grantId,
      grantEpoch: run.grantEpoch,
      executionEpoch: run.executionEpoch,
    };
    const context = {
      contractVersion: CONTRACT,
      profileId: "P1",
      ownerSubject: this.#anchor.ownerSubject,
      vaultId: this.#anchor.vaultId,
      rootKeyId: this.#anchor.rootKeyId,
      rootEpoch: this.#anchor.rootEpoch,
      registrySequence: this.#sequence,
      checkpointDigest: this.#registry.digest,
      keyEpoch: this.#registry.keyEpoch,
      objectId: run.initialResultId,
      objectType: "result_revision",
      revision: expected + 1,
      deliveryRevision: 1,
      priorEnvelopeFingerprint: null,
      expectedRevision: expected,
      stableOperationId: args.stableOperationId,
      operationType: isRevision ? "revise_result" : "submit_result",
      authorSigningKeyId: this.#sigKid,
      binding,
      resourceBindings: [],
      recipients: recipients.map((r) =>
        Object.fromEntries(
          ["keyId", "role", "principalId", "connectionId", "keyEpoch"].map((k) => [k, r[k]]),
        ),
      ),
    };
    validate("Context", context);
    const content = {
      privateSchemaVersion: 2,
      objectId: context.objectId,
      objectType: context.objectType,
      revision: context.revision,
      binding,
      payload: args.content,
    };
    validate("PrivatePayload", content);
    if (canonical(content).length > 65536 || canonical(context).length > 16384)
      deny("payload_too_large");
    const encryptor = new jose.GeneralEncrypt(canonical(content))
      .setProtectedHeader(JWE_HEADER)
      .setAdditionalAuthenticatedData(canonical(context));
    for (const recipient of recipients) {
      const key = await jose.importJWK(recipient.publicJwk, "ECDH-ES+A256KW");
      this.#alive(g);
      encryptor.addRecipient(key).setUnprotectedHeader({ kid: recipient.keyId });
    }
    const jwe = await encryptor.encrypt();
    this.#alive(g);
    const signedObject = await sign(
      { context, jwe },
      this.#keys.sig,
      this.#sigKid,
      "fv-object+jws",
    );
    this.#alive(g);
    const envelope = { contractVersion: CONTRACT, signedObject };
    validate("Carrier", envelope);
    if (canonical(envelope).length > MAX_CARRIER) deny("payload_too_large");
    const packet = {
      contractVersion: CONTRACT,
      runId: run.runId,
      resultId: run.initialResultId,
      revision: context.revision,
      expectedRevision: expected,
      stableOperationId: args.stableOperationId,
      envelopeFingerprint: await fingerprint(envelope),
      envelope,
    };
    this.#alive(g);
    this.#resultOutbox.set(operationKey, { privateIntent, packet, context, receipt: null });
    return structuredClone(packet);
  }
  #acceptReceipt(id, operation, receipt) {
    this.#outbox(id, operation);
    const pending = this.#resultOutbox.get(id + "/" + operation),
      saved = this.#runs.get(id);
    validate("ResultReceipt", receipt);
    utc(receipt.receivedAt);
    const p = pending.packet,
      c = pending.context;
    const expected = {
      contractVersion: CONTRACT,
      vaultId: this.#anchor.vaultId,
      runId: id,
      taskId: c.binding.taskId,
      resultId: p.resultId,
      revision: p.revision,
      deliveryRevision: c.deliveryRevision,
      stableOperationId: operation,
      envelopeFingerprint: p.envelopeFingerprint,
      resultPath: `/results/${p.resultId}?revision=${p.revision}`,
    };
    if (Object.keys(expected).some((k) => receipt[k] !== expected[k]))
      deny("receipt_binding_mismatch");
    if (pending.receipt) {
      if (!same(pending.receipt, receipt)) deny("receipt_replacement");
      return structuredClone(pending.receipt);
    }
    if (saved.acceptedRevision !== p.expectedRevision) deny("receipt_revision_conflict");
    if (Date.parse(receipt.receivedAt) < Date.parse(saved.frozen.run.createdAt))
      deny("receipt_time_mismatch");
    pending.receipt = structuredClone(receipt);
    saved.acceptedRevision = p.revision;
    return structuredClone(receipt);
  }
  async #decrypt(id, carrier, g, historical = null) {
    if (this.#state !== "ACTIVE" || !this.#metadata || !this.#grant) deny("grant_required");
    const m = this.#metadata,
      grant = this.#grant,
      pin = this.#deliveryPin;
    if (this.#time() >= Math.min(grant.expiresAt, m.authorizationExpiresAt)) {
      this.#invalidate("LOCKED");
      deny("grant_expired_or_untrusted");
    }
    const d = m.objects.find((x) => x.objectId === id);
    if (!d) deny("object_not_authorized");
    validate("Carrier", carrier);
    if (carrier.contractVersion !== CONTRACT || canonical(carrier).length > MAX_CARRIER)
      deny("unsupported_contract");
    if ((await fingerprint(carrier)) !== d.envelopeFingerprint)
      deny("component_fingerprint_mismatch");
    this.#alive(g);
    const raw = parsed(bytes(carrier.signedObject.payload), true);
    validate("ObjectMessage", raw);
    const c = raw.context;
    this.#identity(c);
    validate("Context", c);
    if (
      c.profileId !== "P1" ||
      c.objectId !== d.objectId ||
      c.objectType !== d.objectType ||
      c.revision !== d.revision ||
      c.deliveryRevision !== d.deliveryRevision ||
      c.rootKeyId !== this.#anchor.rootKeyId ||
      c.rootEpoch !== this.#anchor.rootEpoch ||
      c.keyEpoch !== this.#registry.keyEpoch ||
      this.#history.get(c.registrySequence) !== c.checkpointDigest
    )
      deny("object_binding_mismatch");
    const binding = Object.fromEntries(EMPTY_BINDING.map((k) => [k, null]));
    if (c.objectType === "task") {
      if (!grant.capabilities.includes("decrypt_task")) deny("insufficient_capability");
      binding.taskId = m.taskId;
      binding.taskVersion = m.taskVersion;
      if (
        c.expectedRevision !== c.revision ||
        c.operationType !== "reshare_delivery" ||
        c.priorEnvelopeFingerprint !== pin.priorEnvelopeFingerprint ||
        !same(c.resourceBindings, m.taskMetadata.resourceBindings)
      )
        deny("task_binding_mismatch");
    } else {
      if (!grant.capabilities.includes("decrypt_resources")) deny("insufficient_capability");
      binding.resourceRef = d.resourceRef;
      binding.sourceRevision = d.sourceRevision;
      binding.sourceEpoch = d.sourceEpoch;
      if (
        c.expectedRevision !== c.revision - 1 ||
        c.operationType !==
          (c.objectType === "holdings_snapshot" ? "commit_snapshot" : "commit_evidence") ||
        c.priorEnvelopeFingerprint !== null ||
        c.resourceBindings.length
      )
        deny("resource_binding_mismatch");
    }
    if (!same(c.binding, binding)) deny("object_binding_mismatch");
    const author = historical
      ? this.#historicalAuthor(c.authorSigningKeyId, historical)
      : this.#key(c.authorSigningKeyId, "device_sig", null);
    if (!author.capabilities.includes("object_write")) deny("insufficient_capability");
    const signed = await verify(carrier.signedObject, author.publicJwk, "fv-object+jws");
    this.#alive(g);
    if (!same(raw, signed)) deny("invalid_signature");
    const expected = [...grant.writebackRecipientKeyIds, this.#encKid].sort(),
      kids = [];
    for (const r of c.recipients) {
      const cert = this.#key(r.keyId);
      kids.push(r.keyId);
      if (
        !same(
          r,
          Object.fromEntries(
            ["keyId", "role", "principalId", "connectionId", "keyEpoch"].map((k) => [k, cert[k]]),
          ),
        )
      )
        deny("recipient_binding_mismatch");
    }
    if (!same(kids, expected)) deny("recipient_binding_mismatch");
    const jwe = signed.jwe;
    exact(jwe, ["protected", "recipients", "iv", "ciphertext", "tag", "aad"]);
    if (
      !same(parsed(bytes(jwe.protected)), JWE_HEADER) ||
      !equalBytes(bytes(jwe.aad), canonical(c)) ||
      bytes(jwe.iv).length !== 12 ||
      bytes(jwe.tag).length !== 16 ||
      bytes(jwe.ciphertext).length > (c.objectType === "task" ? 65536 : 196608) ||
      canonical(c).length > 16384 ||
      jwe.recipients.length !== kids.length
    )
      deny("invalid_jwe_profile");
    for (let i = 0; i < kids.length; i++) {
      const r = jwe.recipients[i];
      exact(r, ["header", "encrypted_key"]);
      exact(r.header, ["kid", "epk"]);
      if (r.header.kid !== kids[i] || bytes(r.encrypted_key).length !== 40)
        deny("recipient_binding_mismatch");
      await publicKey(r.header.epk);
      this.#alive(g);
    }
    const out = await jose.generalDecrypt(jwe, this.#keys.enc, {
      keyManagementAlgorithms: ["ECDH-ES+A256KW"],
      contentEncryptionAlgorithms: ["A256GCM"],
    });
    this.#alive(g);
    const content = privateContent(parsed(out.plaintext, true), c);
    this.#alive(g);
    this.#decrypted.set(d.objectId, d.envelopeFingerprint);
    if (c.objectType === "task") this.#inputPolicy = structuredClone(content.inputPolicy);
    else
      this.#inputFacts.set(d.objectId, {
        state: content.state,
        coverage: content.coverage.state,
        sourceAsOf: content.sourceAsOf,
        fetchedAt: content.fetchedAt,
        freshness: content.freshness,
      });
    return {
      objectId: d.objectId,
      objectType: d.objectType,
      revision: d.revision,
      provenance: d.provenance,
      payload: content,
    };
  }
}
