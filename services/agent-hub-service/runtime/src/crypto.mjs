/** Strict primitives adapted from reviewed helper boundaries; no state or network. */
import * as jose from "jose";
import canonicalize from "canonicalize";
import validators from "./validators.cjs";
const encoder = new TextEncoder(),
  decoder = new TextDecoder("utf-8", { fatal: true });
const MAX_CARRIER = 524288;
export const CONTRACT = "folioview.agent-workspace.v2.0";
export const PROFILE = "folioview.persistent-content.v1";
export const BINDING = [
  "ownerSubject",
  "vaultId",
  "rootKeyId",
  "connectionId",
  "agentId",
  "clientId",
  "identityEpoch",
  "agentSigningKeyId",
  "agentEncryptionKeyId",
  "bindingFingerprint",
];
export const JWE_HEADER = {
  alg: "ECDH-ES+A256KW",
  enc: "A256GCM",
  typ: "fv-persistent-private+jwe",
  cty: "application/json",
};
export class RuntimeDenied extends Error {
  constructor(code = "operation_rejected") {
    super(code);
    this.code = code;
  }
}
function deny(code) {
  throw new RuntimeDenied(code);
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
async function fingerprint(signed) {
  const raw = encoder.encode(signed.protected + "." + signed.payload);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", raw))]
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

function context(value) {
  validate("PersistentContentContext", value);
  if (value.revision !== value.expectedRevision + 1) deny("version_conflict");
  const ids = value.recipients.map((r) => r.keyId);
  unique(ids);
  if (!same(ids, [...ids].sort())) deny("recipient_binding_mismatch");
  if (value.objectType === "task") {
    if (
      value.objectId !== value.taskId ||
      value.revision !== value.taskVersion ||
      value.authorityVersion !== value.expectedAuthorityVersion + 1 ||
      (value.expectedAuthorityVersion === 0) !== (value.expectedAuthorityDigest === null)
    )
      deny("recipient_binding_mismatch");
    unique(value.resourceBindings.map((b) => canonicalize(b.ref)));
    value.resourceBindings.forEach((b) => reference(b.ref));
  } else if (value.objectType !== "result_revision") {
    reference(value.ref);
    const kinds = {
      holdings_snapshot: "holdings",
      watchlist_evidence: "watchlist",
      channel_follows_evidence: "channel_follows",
    };
    if (value.ref.kind !== kinds[value.objectType] || value.sourceRevision !== value.revision)
      deny("recipient_binding_mismatch");
  }
  if (value.objectType === "result_revision") {
    if (
      !value.recipients.some((r) => r.role === "recovery_enc") ||
      value.recipients.some((r) => !["device_enc", "recovery_enc"].includes(r.role))
    )
      deny("recipient_binding_mismatch");
  } else if (
    value.recipients.length !== 2 ||
    value.recipients.filter((r) => r.role === "recovery_enc").length !== 1 ||
    !same(
      value.recipients.filter((r) => r.role === "agent_enc"),
      [{ keyId: value.agentEncryptionKeyId, role: "agent_enc" }],
    )
  )
    deny("recipient_binding_mismatch");
  return value;
}
function reference(value) {
  validate("ResourceRef", value);
  if (value.sourceService !== (value.kind === "holdings" ? "portfolio" : "user"))
    deny("recipient_binding_mismatch");
  return value;
}
function privatePayload(value, c, outputSpec = null) {
  context(c);
  validate("PersistentPrivatePayload", value);
  for (const k of ["objectId", "objectType", "revision"])
    if (!same(value[k], c[k])) deny("private_binding_mismatch");
  const limit =
    c.objectType === "task" ? 65536 : c.objectType === "result_revision" ? 98304 : 196608;
  if (canonical(value).length > limit) deny("payload_too_large");
  const p = value.payload;
  if (c.objectType === "result_revision") {
    resultContent(p, outputSpec ?? { sections: p.sections });
    return p;
  }
  if (c.objectType === "task") {
    unique(p.outputSpec.sections.map((x) => x.sectionId));
    if (p.template === "brief" && !c.resourceBindings.length) deny("private_schema_invalid");
    if (p.deliveryExpectation !== null)
      try {
        new Intl.DateTimeFormat("en", { timeZone: p.deliveryExpectation.timeZone });
      } catch {
        deny("private_schema_invalid");
      }
    return p;
  }
  if (p.data.kind !== c.ref.kind) deny("private_schema_invalid");
  utc(p.fetchedAt);
  if (p.sourceAsOf !== null) utc(p.sourceAsOf);
  const d = p.data;
  if (c.ref.kind === "holdings") {
    if (d.snapshotId !== c.objectId) deny("private_binding_mismatch");
    unique(d.accounts.map((a) => a.accountId));
    if (d.accounts.reduce((n, a) => n + a.positions.length, 0) > 1000)
      deny("private_schema_invalid");
    for (const a of d.accounts) {
      unique(a.balances.map((b) => b.currency));
      unique(a.positions.map((p) => p.assetId));
      if (a.positions.some((p) => p.marketValue !== null && p.marketValue.currency !== p.currency))
        deny("private_schema_invalid");
    }
  } else {
    unique(d.items.map((x) => (c.ref.kind === "watchlist" ? x.symbol : x.followId)));
    for (const x of d.items) {
      utc(x.addedAt);
      if (
        c.ref.kind === "channel_follows" &&
        !/^@[^\s\x00-\x1f]+$/.test(x.handleOrUrl) &&
        !safeUrl(x.handleOrUrl)
      )
        deny("private_schema_invalid");
    }
  }
  return p;
}
function inspect(value) {
  validate("PersistentContentCarrier", value);
  const payload = parsed(bytes(value.proof.payload), true);
  validate("PersistentContentProofPayload", payload);
  const c = context(payload.context),
    encrypted = value.jwe;
  if (
    canonical(value).length > MAX_CARRIER ||
    canonical(c).length > 16384 ||
    bytes(encrypted.ciphertext).length >
      (c.objectType === "task" ? 65536 : c.objectType === "result_revision" ? 98304 : 196608)
  )
    deny("payload_too_large");
  exact(encrypted, ["protected", "aad", "iv", "ciphertext", "tag", "recipients"]);
  if (
    !same(parsed(bytes(encrypted.protected)), JWE_HEADER) ||
    !equalBytes(bytes(encrypted.aad), canonical(c)) ||
    bytes(encrypted.iv).length !== 12 ||
    bytes(encrypted.tag).length !== 16
  )
    deny("recipient_binding_mismatch");
  if (
    !same(
      encrypted.recipients.map((r) => r.header.kid),
      c.recipients.map((r) => r.keyId),
    )
  )
    deny("recipient_binding_mismatch");
  for (const r of encrypted.recipients) {
    exact(r, ["header", "encrypted_key"]);
    exact(r.header, ["kid", "epk"]);
    validate("PublicJWK", r.header.epk);
    if (bytes(r.encrypted_key).length !== 40) deny("invalid_envelope");
  }
  return { carrier: value, context: c, payload };
}
async function open(value, privateKey, expectedContext) {
  const checked = inspect(value);
  if (!same(checked.context, expectedContext)) deny("recipient_binding_mismatch");
  const out = await jose.generalDecrypt(value.jwe, privateKey, {
    keyManagementAlgorithms: ["ECDH-ES+A256KW"],
    contentEncryptionAlgorithms: ["A256GCM"],
  });
  if (
    !same(out.protectedHeader, JWE_HEADER) ||
    !equalBytes(out.additionalAuthenticatedData, canonical(expectedContext))
  )
    deny("recipient_binding_mismatch");
  return privatePayload(parsed(out.plaintext, true), expectedContext);
}
async function seal(payload, c, publicKeys, privateKey) {
  context(c);
  const wrapper = {
    privateSchemaVersion: 1,
    profile: PROFILE,
    objectId: c.objectId,
    objectType: c.objectType,
    revision: c.revision,
    payload,
  };
  privatePayload(wrapper, c);
  const encrypt = new jose.GeneralEncrypt(canonical(wrapper))
    .setProtectedHeader(JWE_HEADER)
    .setAdditionalAuthenticatedData(canonical(c));
  for (const r of c.recipients)
    encrypt
      .addRecipient(await jose.importJWK(publicKeys[r.keyId], "ECDH-ES+A256KW"))
      .setUnprotectedHeader({ kid: r.keyId });
  const encrypted = await encrypt.encrypt();
  const proof = await sign(
    {
      contractVersion: CONTRACT,
      profile: PROFILE,
      artifactType: "persistent_content_publication",
      context: c,
      ciphertextDigest: await digest(encrypted),
    },
    privateKey,
    c.objectType === "result_revision" ? c.agentSigningKeyId : c.rootKeyId,
    "fv-control+jws",
  );
  const value = { contractVersion: CONTRACT, profile: PROFILE, proof, jwe: encrypted };
  inspect(value);
  return value;
}
export {
  jose,
  deny,
  object,
  exact,
  canonical,
  same,
  bytes,
  parsed,
  integer,
  identifier,
  digestString,
  digest,
  fingerprint,
  array,
  unique,
  publicKey,
  keyId,
  verify,
  sign,
  validate,
  utc,
  safeUrl,
  resultContent,
  context,
  reference,
  privatePayload,
  inspect,
  open,
  seal,
};
