/** Trusted browser worker crypto. No network, logging, or plaintext persistence. */
import {
  GeneralEncrypt,
  FlattenedSign,
  flattenedVerify,
  generalDecrypt,
  calculateJwkThumbprint,
} from "jose";
import canonicalize from "canonicalize";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schemas from "./encrypted-schemas.json";
import {
  CONTRACT,
  VaultError,
  type Json,
  type Vault,
  type Archive,
  type Source,
  type SourceCreationPacket,
  type SourceMutationAction,
  type SourceMutationPacket,
  type SourceMutationReceipt,
  type RegistryBundle,
  type Signed,
  type PasskeyMaterial,
  type PendingSnapshot,
  type SnapshotResponse,
  type OpenResultArgs,
  type ResultContent,
  type ResultMetadata,
  type ResultStateChanges,
  type ResultStatePacket,
  type TaskContent,
  type TaskDraft,
  type TaskDraftSummary,
  type TaskDraftRecord,
  type TaskAction,
  type EncryptedTask,
  type PendingTask,
  type SealTaskArgs,
  type ResourceBindingMetadata,
  type AgentAnchor,
  type HelperPublicOffer,
  type AgentRegistration,
  type AgentGrantArgs,
  type AgentGrantPacket,
  type AgentApprovalPacket,
  type AgentPreparationArgs,
  type AgentPreparationPacket,
  type AgentPreparationSource,
  type AgentPendingKind,
  type VaultDevice,
  type DeviceChangePacket,
  type DeviceChangeSummary,
  type VaultManagementSummary,
  type RecoveryVerification,
  type VaultLifecycleState,
  type VaultLifecyclePin,
  type RecoveryKitExport,
  type ArchiveChangePacket,
  type KeyRenewalPacket,
  type KeyRenewalCancellationPacket,
  type KeyRenewalSummary,
} from "./encrypted-types";
export { CONTRACT };
const utf8 = new TextEncoder();
const decode = new TextDecoder("utf-8", { fatal: true });
const JWE_HEADER = {
  alg: "ECDH-ES+A256KW",
  enc: "A256GCM",
  typ: "fv-private+jwe",
  cty: "application/json",
};
const ajv = new Ajv2020({ strict: false, allErrors: false, validateFormats: true });
addFormats(ajv);
ajv.addFormat("iana-timezone", {
  type: "string",
  validate: (v: string) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: v });
      return true;
    } catch {
      return false;
    }
  },
});
ajv.addSchema(schemas, "formal");
const validators = new Map<string, ReturnType<typeof ajv.compile>>();
export function validate(name: string, value: unknown) {
  let v = validators.get(name);
  if (!v) {
    v = ajv.compile({ $ref: `formal#/$defs/${name}` });
    validators.set(name, v);
  }
  if (!v(value)) throw new VaultError("invalid_data");
}
function jsonSafe(value: unknown, depth = 0): void {
  if (depth > 20) throw new VaultError("invalid_data");
  if (typeof value === "string") {
    for (const c of value) {
      const n = c.codePointAt(0)!;
      if (n >= 0xd800 && n <= 0xdfff) throw new VaultError("invalid_data");
    }
    return;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new VaultError("invalid_data");
    return;
  }
  if (value === null || typeof value === "boolean") return;
  if (Array.isArray(value)) {
    for (const item of value) jsonSafe(item, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      jsonSafe(k, depth + 1);
      jsonSafe(v, depth + 1);
    }
    return;
  }
  throw new VaultError("invalid_data");
}
export function canonical(value: unknown): string {
  jsonSafe(value);
  const s = canonicalize(value);
  if (typeof s !== "string") throw new VaultError("invalid_data");
  return s;
}
export function b64(value: Uint8Array | ArrayBuffer): string {
  const a = value instanceof Uint8Array ? value : new Uint8Array(value);
  let s = "";
  for (const x of a) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
export function unb64(value: string, max = 1048576): Uint8Array {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > max * 2 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  )
    throw new VaultError("invalid_data");
  let a: Uint8Array;
  try {
    a = Uint8Array.from(
      atob(
        value
          .replace(/-/g, "+")
          .replace(/_/g, "/")
          .padEnd(Math.ceil(value.length / 4) * 4, "="),
      ),
      (x) => x.charCodeAt(0),
    );
  } catch {
    throw new VaultError("invalid_data");
  }
  if (a.length > max || b64(a) !== value) throw new VaultError("invalid_data");
  return a;
}
export function randomId(prefix = "") {
  return prefix + b64(crypto.getRandomValues(new Uint8Array(16)));
}
export async function sha(value: Uint8Array | string) {
  const a = typeof value === "string" ? utf8.encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", a as BufferSource))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
function equal(a: unknown, b: unknown) {
  return canonical(a) === canonical(b);
}
function exact(v: Json, names: string[]) {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    !equal(Object.keys(v).sort(), names.sort())
  )
    throw new VaultError("invalid_data");
}
function positive(v: unknown, min = 1) {
  if (!Number.isSafeInteger(v) || (v as number) < min) throw new VaultError("invalid_data");
}
function bounded(v: unknown, max: number) {
  if (utf8.encode(canonical(v)).length > max) throw new VaultError("too_large");
}
function parsed(raw: Uint8Array, requireCanonical = true) {
  let text: string, value: any;
  try {
    text = decode.decode(raw);
    value = JSON.parse(text);
  } catch {
    throw new VaultError("invalid_data");
  }
  let i = 0;
  const space = () => {
    while (/\s/.test(text[i] ?? "") && i < text.length) i++;
  };
  const string = () => {
    const start = i++;
    while (i < text.length) {
      if (text[i] === "\\") {
        i += 2;
        continue;
      }
      if (text[i++] === '"') return JSON.parse(text.slice(start, i));
    }
    throw new VaultError("invalid_data");
  };
  const scan = (depth = 0): void => {
    if (depth > 20) throw new VaultError("invalid_data");
    space();
    const c = text[i];
    if (c === "{") {
      i++;
      space();
      const names = new Set<string>();
      if (text[i] === "}") {
        i++;
        return;
      }
      for (;;) {
        space();
        if (text[i] !== '"') throw new VaultError("invalid_data");
        const name = string();
        if (names.has(name)) throw new VaultError("invalid_data");
        names.add(name);
        space();
        if (text[i++] !== ":") throw new VaultError("invalid_data");
        scan(depth + 1);
        space();
        if (text[i] === "}") {
          i++;
          return;
        }
        if (text[i++] !== ",") throw new VaultError("invalid_data");
      }
    }
    if (c === "[") {
      i++;
      space();
      if (text[i] === "]") {
        i++;
        return;
      }
      for (;;) {
        scan(depth + 1);
        space();
        if (text[i] === "]") {
          i++;
          return;
        }
        if (text[i++] !== ",") throw new VaultError("invalid_data");
      }
    }
    if (c === '"') {
      string();
      return;
    }
    const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
      text.slice(i),
    );
    if (!token) throw new VaultError("invalid_data");
    i += token[0].length;
  };
  scan();
  space();
  if (i !== text.length || (requireCanonical && canonical(value) !== text))
    throw new VaultError("invalid_data");
  return value;
}

function pub(jwk: Json) {
  const v = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
  validate("PublicJWK", v);
  return v;
}
async function thumb(jwk: Json) {
  const p = pub(jwk);
  await crypto.subtle.importKey("jwk", p, { name: "ECDH", namedCurve: "P-256" }, false, []);
  return calculateJwkThumbprint(p);
}
async function key(jwk: Json, signing = false, privateKey = false): Promise<CryptoKey> {
  const material = privateKey ? { ...pub(jwk), d: jwk.d } : pub(jwk);
  return crypto.subtle.importKey(
    "jwk",
    material,
    signing ? { name: "ECDSA", namedCurve: "P-256" } : { name: "ECDH", namedCurve: "P-256" },
    false,
    signing ? [privateKey ? "sign" : "verify"] : privateKey ? ["deriveBits"] : [],
  );
}
async function makeKey(signing = false) {
  const pair = await crypto.subtle.generateKey(
    signing ? { name: "ECDSA", namedCurve: "P-256" } : { name: "ECDH", namedCurve: "P-256" },
    true,
    signing ? ["sign", "verify"] : ["deriveBits"],
  );
  const exported = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const publicJwk = pub(exported);
  const privateJwk = { ...publicJwk, d: exported.d };
  return { privateJwk, publicJwk, keyId: await thumb(publicJwk) };
}
async function sign(
  value: Json,
  k: CryptoKey,
  kid: string,
  typ = "fv-control+jws",
): Promise<Signed> {
  const signed = await new FlattenedSign(utf8.encode(canonical(value)))
    .setProtectedHeader({ alg: "ES256", kid, typ, cty: "application/json" })
    .sign(k);
  return { protected: signed.protected!, payload: signed.payload, signature: signed.signature };
}
async function verified(signed: Signed, jwk: Json, typ = "fv-control+jws") {
  validate("SignedObject", signed);
  bounded(signed, typ === "fv-control+jws" ? 65536 : 524288);
  const h = parsed(unb64(signed.protected, 1024), false);
  exact(h, ["alg", "kid", "typ", "cty"]);
  if (
    h.alg !== "ES256" ||
    h.kid !== (await thumb(jwk)) ||
    h.typ !== typ ||
    h.cty !== "application/json" ||
    unb64(signed.signature, 64).length !== 64
  )
    throw new VaultError("invalid_signature");
  try {
    const opened = await flattenedVerify(signed, await key(jwk, true), { algorithms: ["ES256"] });
    return parsed(opened.payload);
  } catch (e) {
    if (e instanceof VaultError) throw e;
    throw new VaultError("invalid_signature");
  }
}
export async function signingFingerprint(s: Signed) {
  return sha(s.protected + "." + s.payload);
}
type Registry = {
  bundle: RegistryBundle;
  checkpoint: Json;
  digest: string;
  certificates: Map<string, Json>;
  active: Set<string>;
  localEpochs: Map<string, number>;
};
const CAP: Record<string, string[]> = {
  root_sig: [],
  device_sig: ["object_write", "task_grant", "control_write"],
  device_enc: [],
  agent_sig: ["run_request", "result_write"],
  agent_enc: [],
  recovery_enc: [],
};
export async function verifyRegistry(
  bundle: RegistryBundle,
  root: Json,
  owner: string,
  vault: string,
  previous?: Registry,
  now = Math.floor(Date.now() / 1000),
): Promise<Registry> {
  validate("RegistryBundle", bundle);
  bounded(bundle, 131072);
  validate("PublicJWK", root);
  const rootId = await thumb(root);
  const cp = await verified(bundle.checkpoint, root);
  validate("RegistryCheckpointPayload", cp);
  if (
    cp.ownerSubject !== owner ||
    cp.vaultId !== vault ||
    cp.rootKeyId !== rootId ||
    cp.rootEpoch !== 1 ||
    cp.issuedAt > now
  )
    throw new VaultError("untrusted_vault");
  const digest = await sha(canonical(cp));
  if (previous) {
    const old = previous.checkpoint;
    if (
      cp.registrySequence < old.registrySequence ||
      cp.keyEpoch < old.keyEpoch ||
      old.revokedKeyIds.some((x: string) => !cp.revokedKeyIds.includes(x))
    )
      throw new VaultError("rollback_detected");
    if (cp.registrySequence === old.registrySequence) {
      if (digest !== previous.digest) throw new VaultError("registry_conflict");
    } else if (
      cp.registrySequence !== old.registrySequence + 1 ||
      cp.previousDigest !== previous.digest ||
      cp.issuedAt < old.issuedAt
    )
      throw new VaultError("registry_conflict");
  } else if ((cp.registrySequence === 1) !== (cp.previousDigest === null))
    throw new VaultError("registry_conflict");
  const localEpochs = new Map(previous?.localEpochs ?? []);
  const certificates = new Map<string, Json>(),
    active = new Set<string>(),
    ids = new Set<string>(),
    generations = new Set<string>(),
    descriptions: Json[] = [];
  for (const entry of bundle.entries) {
    const c = await verified(entry.certificate, root);
    validate("KeyCertificatePayload", c);
    const local = [c.principalId, c.role, c.connectionId, c.keyEpoch].join("/");
    if (
      c.ownerSubject !== owner ||
      c.vaultId !== vault ||
      c.issuerKeyId !== rootId ||
      c.keyId !== (await thumb(c.publicJwk)) ||
      certificates.has(c.keyId) ||
      ids.has(c.certificateId) ||
      generations.has(local) ||
      c.expiresAt <= c.notBefore ||
      c.capabilities.some((x: string) => !CAP[c.role]?.includes(x)) ||
      c.role.startsWith("agent_") !== (c.connectionId !== null) ||
      (c.role === "root_sig") !== (c.keyId === rootId) ||
      entry.active === cp.revokedKeyIds.includes(c.keyId)
    )
      throw new VaultError("invalid_registry");
    if (previous) {
      const prior = previous.certificates.get(c.keyId);
      if (prior && !equal(prior, c)) throw new VaultError("registry_conflict");
      if (
        !prior &&
        [...previous.certificates.values()].some(
          (x) =>
            x.principalId === c.principalId &&
            x.role === c.role &&
            x.connectionId === c.connectionId &&
            x.keyEpoch >= c.keyEpoch,
        )
      )
        throw new VaultError("rollback_detected");
    }
    const identity = [c.principalId, c.role, c.connectionId].join("/");
    if (
      !previous?.certificates.has(c.keyId) &&
      c.keyEpoch <= (previous?.localEpochs.get(identity) ?? 0)
    )
      throw new VaultError("rollback_detected");
    localEpochs.set(identity, Math.max(localEpochs.get(identity) ?? 0, c.keyEpoch));
    certificates.set(c.keyId, c);
    ids.add(c.certificateId);
    generations.add(local);
    if (entry.active) active.add(c.keyId);
    descriptions.push({
      certificateId: c.certificateId,
      payloadDigest: await sha(canonical(c)),
      active: entry.active,
    });
  }
  if (
    cp.entriesDigest !==
    (await sha(
      canonical(descriptions.sort((a, b) => (a.certificateId < b.certificateId ? -1 : 1))),
    ))
  )
    throw new VaultError("invalid_registry");
  return { bundle, checkpoint: cp, digest, certificates, active, localEpochs };
}
function cert(registry: Registry, kid: string, role?: string, now = Math.floor(Date.now() / 1000)) {
  const c = registry.certificates.get(kid);
  if (
    !c ||
    !registry.active.has(kid) ||
    registry.checkpoint.revokedKeyIds.includes(kid) ||
    c.keyEpoch !== registry.localEpochs.get([c.principalId, c.role, c.connectionId].join("/")) ||
    c.notBefore > now ||
    c.expiresAt <= now ||
    (role && c.role !== role)
  )
    throw new VaultError("key_revoked");
  return c;
}
export type Pin = {
  ownerSubject: string;
  vaultId: string;
  rootKeyId: string;
  registrySequence: number;
  checkpointDigest: string;
  keyEpoch: number;
};
export type DeviceSeal = Json;
function archiveContext(a: Json) {
  const { iv: _iv, ciphertext: _ciphertext, ...context } = a;
  return context;
}
export function checkArchive(a: Archive, owner: string) {
  exact(a, [
    "profile",
    "ownerSubject",
    "vaultId",
    "rootKeyId",
    "credentialId",
    "prfSalt",
    "iv",
    "ciphertext",
  ]);
  if (a.profile !== "folioview.passkey-vault.v1" || a.ownerSubject !== owner)
    throw new VaultError("wrong_account");
  validate("KeyId", a.rootKeyId);
  if (typeof a.vaultId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(a.vaultId))
    throw new VaultError("invalid_data");
  if (
    unb64(a.credentialId, 1536).length < 1 ||
    unb64(a.prfSalt, 32).length !== 32 ||
    unb64(a.iv, 12).length !== 12 ||
    a.ciphertext.length > 32768 ||
    unb64(a.ciphertext, 24576).length < 16
  )
    throw new VaultError("invalid_data");
}
async function aesMaterial(material: PasskeyMaterial) {
  if (!(material.secret instanceof ArrayBuffer) || material.secret.byteLength !== 32)
    throw new VaultError("passkey_unsupported");
  const secret = new Uint8Array(material.secret);
  try {
    return await crypto.subtle.importKey("raw", secret, { name: "AES-GCM" }, false, [
      "encrypt",
      "decrypt",
    ]);
  } finally {
    secret.fill(0);
  }
}
async function seal(k: CryptoKey, context: Json, value: Json) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: utf8.encode(canonical(context)) },
    k,
    utf8.encode(canonical(value)),
  );
  return { ...context, iv: b64(iv), ciphertext: b64(ciphertext) };
}
async function open(k: CryptoKey, envelope: Json, maximum = 32768) {
  try {
    return parsed(
      new Uint8Array(
        await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: unb64(envelope.iv, 12) as BufferSource,
            additionalData: utf8.encode(canonical(archiveContext(envelope))),
          },
          k,
          unb64(envelope.ciphertext, maximum) as BufferSource,
        ),
      ),
    );
  } catch {
    throw new VaultError("unlock_failed");
  }
}
function resultRequire(value: unknown) {
  if (!value) throw new VaultError("binding_mismatch");
}
function utcSeconds(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19)
  )
    throw new VaultError("invalid_data");
  return Date.parse(value) / 1000;
}
function safeResultUrl(value: string) {
  if (/[\s\\\x00-\x1f]/.test(value)) return false;
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      Boolean(u.hostname) &&
      !u.username &&
      !u.password &&
      (!u.port || u.port === "443")
    );
  } catch {
    return false;
  }
}
function resultMarkdown(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    colon: ":",
    tab: "\t",
    newline: "\n",
  };
  // Decode only characters relevant to this input guard. An ordinary query
  // parameter such as &two=2, or harmless text such as &copy;, is not an error.
  // Legacy amp/lt/gt/quot may omit their semicolon; the other named forms may
  // not. The renderer displays text rather than decoding HTML entities.
  const entities = /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|(?:apos|colon|tab|newline)(?=;));?/gi;
  let text = value;
  for (let count = 0; count < 4; count++) {
    const decoded = text.replace(entities, (_, code: string) => {
      if (code[0] !== "#") return named[code.toLowerCase()];
      const point = /^#x/i.test(code) ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      if (
        !Number.isSafeInteger(point) ||
        point <= 0 ||
        point > 0x10ffff ||
        (point >= 0xd800 && point <= 0xdfff)
      )
        throw new VaultError("unsafe_content");
      return String.fromCodePoint(point);
    });
    if (decoded === text) break;
    text = decoded;
    if (count === 3 && text.match(entities)) throw new VaultError("unsafe_content");
  }
  if (/<\s*(?:\/?[A-Za-z][A-Za-z0-9-]*(?:\s|\/?>)|!|\?)/.test(text) || /!\s*\[/.test(text))
    throw new VaultError("unsafe_content");
  const urls = [
    ...[...text.matchAll(/\]\(\s*(<[^>]+>|[^\s)]+)/g)].map((m) => m[1]),
    ...[...text.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/gm)].map((m) => m[1]),
    ...[...text.matchAll(/<([^<>\s]+:[^<>\s]*)>/g)].map((m) => m[1]),
  ];
  if (urls.some((url) => !safeResultUrl(url.replace(/^<|>$/g, ""))))
    throw new VaultError("unsafe_content");
}
function checkedResultContent(value: unknown): ResultContent {
  validate("ResultContent", value);
  const content = value as ResultContent;
  if (
    new Set(content.sections.map((v) => v.sectionId)).size !== content.sections.length ||
    new Set(content.citations.map((v) => v.citationId)).size !== content.citations.length
  )
    throw new VaultError("invalid_data");
  for (const section of content.sections) resultMarkdown(section.markdown);
  for (const citation of content.citations) {
    if (!safeResultUrl(citation.url)) throw new VaultError("unsafe_content");
    if (citation.publishedAt !== null) utcSeconds(citation.publishedAt);
  }
  return content;
}
function taskBindings(value: ResourceBindingMetadata[]) {
  if (!Array.isArray(value) || value.length > 10) throw new VaultError("invalid_data");
  const refs = new Set<string>();
  for (const item of value) {
    validate("ResourceBindingMetadata", item);
    if (
      item.ref.sourceService !== (item.ref.kind === "holdings" ? "portfolio" : "user") ||
      refs.has(canonical(item.ref))
    )
      throw new VaultError("invalid_data");
    refs.add(canonical(item.ref));
  }
  return value;
}
function checkedTaskContent(value: TaskContent, resources: ResourceBindingMetadata[]) {
  validate("TaskContent", value);
  taskBindings(resources);
  if (
    (value.template === "brief" && !resources.length) ||
    new Set(value.outputSpec.sections.map((s) => s.sectionId)).size !==
      value.outputSpec.sections.length
  )
    throw new VaultError("invalid_data");
  return value;
}
function checkedTaskDraft(value: TaskDraft) {
  exact(value, ["content", "resourceBindings"]);
  taskBindings(value.resourceBindings);
  const c = value.content;
  exact(c, ["name", "template", "goal", "inputPolicy", "outputSpec", "deliveryExpectation"]);
  const string = (v: unknown, max: number) => {
    if (typeof v !== "string" || v.length > max) throw new VaultError("invalid_data");
  };
  const integer = (v: unknown, max: number) => {
    if (!Number.isSafeInteger(v) || (v as number) < -1 || (v as number) > max)
      throw new VaultError("invalid_data");
  };
  string(c.name, 80);
  string(c.goal, 2000);
  if (!["brief", "custom"].includes(c.template)) throw new VaultError("invalid_data");
  exact(c.inputPolicy, ["allowPartial", "allowUnknownAsOf", "maxFetchedAgeSeconds"]);
  if (
    typeof c.inputPolicy.allowPartial !== "boolean" ||
    typeof c.inputPolicy.allowUnknownAsOf !== "boolean"
  )
    throw new VaultError("invalid_data");
  integer(c.inputPolicy.maxFetchedAgeSeconds, 604800);
  exact(c.outputSpec, ["label", "sections", "language", "verbosity"]);
  string(c.outputSpec.label, 40);
  if (
    !["zh", "en"].includes(c.outputSpec.language) ||
    !["concise", "standard"].includes(c.outputSpec.verbosity) ||
    !Array.isArray(c.outputSpec.sections) ||
    c.outputSpec.sections.length > 8
  )
    throw new VaultError("invalid_data");
  for (const section of c.outputSpec.sections) {
    exact(section, ["sectionId", "title", "instructions"]);
    string(section.sectionId, 128);
    string(section.title, 120);
    string(section.instructions, 1000);
  }
  if (c.deliveryExpectation !== null) {
    const e = c.deliveryExpectation;
    exact(e, [
      "cadence",
      "localTime",
      "timeZone",
      "graceMinutes",
      ...(e.weekday === undefined ? [] : ["weekday"]),
    ]);
    if (!["daily", "weekdays", "weekly"].includes(e.cadence)) throw new VaultError("invalid_data");
    string(e.localTime, 5);
    string(e.timeZone, 80);
    integer(e.graceMinutes, 1440);
    if (e.weekday !== undefined) integer(e.weekday, 6);
  }
  bounded(value, 65536);
  return value;
}
export class VaultCore {
  readonly owner: Promise<string>;
  private lifecyclePin?: VaultLifecyclePin;
  private recoveryMaster?: Json;
  private archiveChange?: { packet: ArchiveChangePacket; candidate: Json | null };
  private wrapping?: CryptoKey;
  private root?: CryptoKey;
  private recovery?: CryptoKey;
  private recoveryJwk?: Json;
  /** Private historical readers stay in this terminated-on-lock Worker. Never grant signing rights. */
  private historicalReaders = new Map<string, CryptoKey>();
  private renewalOnly = false;
  private vault?: Vault;
  private registry?: Registry;
  private pin?: Pin;
  private device?: {
    deviceId: string;
    sig: CryptoKey;
    enc: CryptoKey;
    sigJwk: Json;
    encJwk: Json;
    sigId: string;
    encId: string;
  };
  private deviceSeal?: DeviceSeal;
  private pendingDevice?: { kind: string; operation: Json; baseDigest: string | null };
  private pendingEnvelope?: Json;
  private pendingAgentRegistrations = new Map<string, AgentRegistration>();
  private deviceChange?: {
    packet: DeviceChangePacket;
    candidate: DeviceSeal | null;
    baseDigest: string;
    record: Json;
  };
  constructor(
    uid: string,
    private readonly now = () => Math.floor(Date.now() / 1000),
  ) {
    if (!uid || uid.length > 128) throw new VaultError("wrong_account");
    this.owner = sha(uid);
  }
  private async installMaster(master: Json, vault: Vault) {
    const fields = ["ownerSubject", "vaultId", "rootKeyId", "rootPrivateJwk", "recoveryPrivateJwk"];
    if (master.profile === "folioview.historical-keyring.v1")
      fields.push("profile", "historicalKeys");
    exact(master, fields);
    if (
      master.ownerSubject !== (await this.owner) ||
      master.vaultId !== vault.vaultId ||
      master.rootKeyId !== vault.rootKeyId ||
      (await thumb(master.rootPrivateJwk)) !== vault.rootKeyId
    )
      throw new VaultError("untrusted_vault");
    const readers = new Map<string, CryptoKey>();
    const historical = master.historicalKeys ?? [];
    if (!Array.isArray(historical) || historical.length > 63) throw new VaultError("invalid_data");
    bounded(master, 24560);
    const seen = new Set<string>([vault.rootKeyId, await thumb(master.recoveryPrivateJwk)]);
    for (const item of historical) {
      exact(item, ["role", "principalId", "privateJwk"]);
      if (!["device_sig", "device_enc", "recovery_enc"].includes(item.role))
        throw new VaultError("invalid_data");
      validate("Identifier", item.principalId);
      exact(item.privateJwk, ["kty", "crv", "x", "y", "d"]);
      if (unb64(item.privateJwk.d, 32).length !== 32) throw new VaultError("invalid_data");
      const kid = await thumb(item.privateJwk);
      if (seen.has(kid)) throw new VaultError("invalid_data");
      seen.add(kid);
      let found = false;
      for (const bundle of vault.registryHistory) {
        for (const entry of bundle.entries) {
          const c = parsed(unb64(entry.certificate.payload));
          if (c.keyId !== kid) continue;
          const signed = await verified(entry.certificate, vault.rootJwk);
          if (
            signed.ownerSubject === master.ownerSubject &&
            signed.vaultId === vault.vaultId &&
            signed.issuerKeyId === vault.rootKeyId &&
            signed.role === item.role &&
            signed.principalId === item.principalId &&
            signed.connectionId === null &&
            equal(signed.publicJwk, pub(item.privateJwk))
          )
            found = true;
        }
      }
      if (!found) throw new VaultError("untrusted_vault");
      const privateKey = await key(item.privateJwk, item.role === "device_sig", true);
      if (item.role !== "device_sig") readers.set(kid, privateKey);
    }
    this.root = await key(master.rootPrivateJwk, true, true);
    this.recovery = await key(master.recoveryPrivateJwk, false, true);
    this.recoveryJwk = pub(master.recoveryPrivateJwk);
    this.recoveryMaster = master;
    this.historicalReaders = readers;
  }
  private async reader(recipientIds: string[]) {
    if (this.device && recipientIds.includes(this.device.encId)) return this.device.enc;
    if (this.recovery && this.recoveryJwk && recipientIds.includes(await thumb(this.recoveryJwk!)))
      return this.recovery;
    for (const id of recipientIds) {
      const historical = this.historicalReaders.get(id);
      if (historical) return historical;
    }
    throw new VaultError("missing_key");
  }
  private requireOrdinarySession() {
    if (this.renewalOnly) throw new VaultError("key_renewal_pending");
  }
  /** A root-only session is deliberately separate from ordinary content signing. */
  async unlockForKeyRenewal(
    vault: Vault,
    material: PasskeyMaterial,
    local?: { pin?: Pin; device?: DeviceSeal; pending?: Json; deviceChange?: Json },
  ) {
    this.renewalOnly = true;
    if (local?.pending || local?.deviceChange) throw new VaultError("pending_registration");
    if (
      this.archiveChange ||
      this.deviceChange ||
      (this.pendingDevice &&
        !vault.registryHistory.some((bundle) =>
          equal(bundle, this.pendingDevice!.operation.registryBundle),
        ))
    )
      throw new VaultError("pending_registration");
    this.pendingDevice = undefined;
    this.pendingEnvelope = undefined;
    const compatible =
      local?.device?.credentialId === vault.archive.credentialId &&
      local.device.prfSalt === vault.archive.prfSalt
        ? local.device
        : undefined;
    await this.unlockForResults(vault, material, { pin: local?.pin, device: compatible });
    await this.verifiedVaultPin(vault);
    return { renewalOnly: true as const };
  }
  private async publicVaultPin(vault: Vault, registry: Registry) {
    const pin: Pin = {
      ownerSubject: await this.owner,
      vaultId: vault.vaultId,
      rootKeyId: vault.rootKeyId,
      registrySequence: registry.checkpoint.registrySequence,
      checkpointDigest: registry.digest,
      keyEpoch: registry.checkpoint.keyEpoch,
    };
    const history = [];
    for (const bundle of vault.registryHistory) {
      const cp = parsed(unb64(bundle.checkpoint.payload));
      history.push({
        registrySequence: cp.registrySequence,
        checkpointDigest: await sha(canonical(cp)),
        keyEpoch: cp.keyEpoch,
      });
    }
    return { pin, history };
  }
  /** Public metadata only; used after signed lifecycle verification for atomic durable pins. */
  async verifiedVaultPin(vault: Vault) {
    if (
      this.vault &&
      (this.vault.vaultId !== vault.vaultId ||
        this.vault.rootKeyId !== vault.rootKeyId ||
        !equal(this.vault.rootJwk, vault.rootJwk))
    )
      throw new VaultError("untrusted_vault");
    const old = this.vault;
    this.vault = undefined;
    try {
      const registry = await this.checkVault(vault, this.pin);
      const record = await this.publicVaultPin(vault, registry);
      this.pin = record.pin;
      return record;
    } finally {
      this.vault = old;
    }
  }
  private async renewalContext(
    vault: Vault,
    state: VaultLifecycleState,
    prior?: VaultLifecyclePin,
  ) {
    if (!this.root || !this.wrapping || !this.recoveryMaster) throw new VaultError("locked");
    const pin = await this.verifyLifecycle(vault, state, prior);
    const old = this.vault;
    this.vault = undefined;
    try {
      return { pin, registry: await this.checkVault(vault, this.pin) };
    } finally {
      this.vault = old;
    }
  }
  private async renewalWrapping() {
    if (!this.recoveryMaster || !this.vault) throw new VaultError("locked");
    const raw = unb64(this.recoveryMaster.rootPrivateJwk.d, 32);
    try {
      const input = await crypto.subtle.importKey("raw", raw as BufferSource, "HKDF", false, [
        "deriveKey",
      ]);
      return await crypto.subtle.deriveKey(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt: utf8.encode("FolioView/key-renewal-pending/v1"),
          info: utf8.encode(
            canonical({
              ownerSubject: await this.owner,
              vaultId: this.vault.vaultId,
              rootKeyId: this.vault.rootKeyId,
            }),
          ),
        },
        input,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
    } finally {
      raw.fill(0);
    }
  }
  private async sealRenewal(value: Json) {
    const packet = value.packet as KeyRenewalPacket;
    bounded(value, 262144);
    return seal(
      await this.renewalWrapping(),
      {
        profile: "folioview.key-renewal-candidate.v1",
        ownerSubject: await this.owner,
        vaultId: this.vault!.vaultId,
        rootKeyId: this.vault!.rootKeyId,
        operationId: packet.operationId,
      },
      value,
    );
  }
  private async readRenewal(vault: Vault, record: Json) {
    exact(record, [
      "profile",
      "ownerSubject",
      "vaultId",
      "rootKeyId",
      "operationId",
      "iv",
      "ciphertext",
    ]);
    if (
      record.profile !== "folioview.key-renewal-candidate.v1" ||
      record.ownerSubject !== (await this.owner) ||
      record.vaultId !== vault.vaultId ||
      record.rootKeyId !== vault.rootKeyId
    )
      throw new VaultError("wrong_account");
    validate("OperationIdentifier", record.operationId);
    const value = await open(await this.renewalWrapping(), record, 262160);
    exact(value, ["packet", "device", "cancellation"]);
    const packet = value.packet as KeyRenewalPacket;
    exact(packet, ["operationId", "body"]);
    exact(packet.body, [
      "contractVersion",
      "registryBundle",
      "archive",
      "command",
      "archiveCommand",
    ]);
    validate("OperationIdentifier", packet.operationId);
    if (packet.operationId !== record.operationId || packet.body.contractVersion !== CONTRACT)
      throw new VaultError("binding_mismatch");
    const { command, archiveCommand, registryBundle, archive } = packet.body;
    bounded(command, 8192);
    bounded(archiveCommand, 8192);
    const p = await verified(command, vault.rootJwk),
      ap = await verified(archiveCommand, vault.rootJwk);
    exact(p, [
      "profile",
      "contractVersion",
      "action",
      "ownerSubject",
      "vaultId",
      "rootKeyId",
      "stableOperationId",
      "expectedVaultVersion",
      "registrySequence",
      "checkpointDigest",
      "keyEpoch",
      "expectedLifecycleVersion",
      "expectedArchiveRevision",
      "expectedArchiveDigest",
      "newCheckpointDigest",
      "newArchiveDigest",
      "archiveCommandFingerprint",
      "renewals",
      "issuedAt",
      "expiresAt",
    ]);
    exact(ap, [
      "profile",
      "contractVersion",
      "action",
      "ownerSubject",
      "vaultId",
      "rootKeyId",
      "stableOperationId",
      "expectedVaultVersion",
      "registrySequence",
      "checkpointDigest",
      "keyEpoch",
      "expectedLifecycleVersion",
      "expectedArchiveRevision",
      "expectedArchiveDigest",
      "newArchiveDigest",
      "mode",
      "authorizationId",
      "issuedAt",
      "expiresAt",
    ]);
    for (const x of [p, ap]) {
      for (const f of ["expectedVaultVersion", "registrySequence", "keyEpoch", "expiresAt"])
        positive(x[f]);
      for (const f of ["expectedLifecycleVersion", "expectedArchiveRevision", "issuedAt"])
        positive(x[f], 0);
      if (
        !(x.issuedAt < x.expiresAt && x.expiresAt <= x.issuedAt + 300) ||
        x.ownerSubject !== (await this.owner) ||
        x.vaultId !== vault.vaultId ||
        x.rootKeyId !== vault.rootKeyId ||
        x.stableOperationId !== packet.operationId ||
        x.contractVersion !== CONTRACT
      )
        throw new VaultError("binding_mismatch");
    }
    for (const f of [
      "ownerSubject",
      "vaultId",
      "rootKeyId",
      "stableOperationId",
      "expectedVaultVersion",
      "registrySequence",
      "checkpointDigest",
      "keyEpoch",
      "expectedLifecycleVersion",
      "expectedArchiveRevision",
      "expectedArchiveDigest",
      "newArchiveDigest",
    ])
      if (p[f] !== ap[f]) throw new VaultError("binding_mismatch");
    if (
      p.profile !== "folioview.vault-key-renewal.v1" ||
      p.action !== "key_renewal" ||
      ap.profile !== "folioview.vault-lifecycle.v1" ||
      ap.action !== "archive_replace" ||
      ap.mode !== "rewrap" ||
      ap.authorizationId !== null ||
      p.archiveCommandFingerprint !== (await signingFingerprint(archiveCommand))
    )
      throw new VaultError("binding_mismatch");
    checkArchive(archive, await this.owner);
    if (
      archive.vaultId !== vault.vaultId ||
      archive.rootKeyId !== vault.rootKeyId ||
      p.newArchiveDigest !== (await sha(canonical(archive)))
    )
      throw new VaultError("binding_mismatch");
    let previous: Registry | undefined;
    const seen = new Set<string>();
    for (const b of vault.registryHistory.slice(0, p.registrySequence)) {
      previous = await verifyRegistry(
        b,
        vault.rootJwk,
        await this.owner,
        vault.vaultId,
        previous,
        this.now(),
      );
      for (const kid of previous.certificates.keys()) seen.add(kid);
    }
    if (
      !previous ||
      previous.checkpoint.registrySequence !== p.registrySequence ||
      previous.digest !== p.checkpointDigest ||
      previous.checkpoint.keyEpoch !== p.keyEpoch
    )
      throw new VaultError("registry_conflict");
    const next = await verifyRegistry(
      registryBundle,
      vault.rootJwk,
      await this.owner,
      vault.vaultId,
      previous,
      this.now(),
    );
    if (
      next.checkpoint.registrySequence !== p.registrySequence + 1 ||
      next.digest !== p.newCheckpointDigest ||
      next.checkpoint.keyEpoch !== p.keyEpoch ||
      next.checkpoint.rootEpoch !== previous.checkpoint.rootEpoch ||
      !Array.isArray(p.renewals) ||
      p.renewals.length !== 3
    )
      throw new VaultError("registry_conflict");
    const old = new Set<string>(),
      fresh = new Set<string>(),
      roles = new Set<string>(),
      order: string[] = [];
    for (const t of p.renewals) {
      exact(t, ["role", "principalId", "priorKeyId", "newKeyId", "priorKeyEpoch", "newKeyEpoch"]);
      validate("Identifier", t.principalId);
      validate("KeyId", t.priorKeyId);
      validate("KeyId", t.newKeyId);
      positive(t.priorKeyEpoch);
      positive(t.newKeyEpoch);
      const before = previous.certificates.get(t.priorKeyId),
        after = next.certificates.get(t.newKeyId);
      if (
        !before ||
        !after ||
        !["device_sig", "device_enc", "recovery_enc"].includes(t.role) ||
        roles.has(t.role) ||
        old.has(t.priorKeyId) ||
        fresh.has(t.newKeyId) ||
        seen.has(t.newKeyId) ||
        !previous.active.has(t.priorKeyId) ||
        previous.checkpoint.revokedKeyIds.includes(t.priorKeyId) ||
        before.keyEpoch !== previous.localEpochs.get([t.principalId, t.role, null].join("/")) ||
        before.keyEpoch !== t.priorKeyEpoch ||
        t.newKeyEpoch !== t.priorKeyEpoch + 1 ||
        after.keyEpoch !== t.newKeyEpoch ||
        before.role !== t.role ||
        before.principalId !== t.principalId ||
        before.connectionId !== null ||
        ["role", "principalId", "connectionId", "capabilities"].some(
          (f) => !equal(before[f], after[f]),
        ) ||
        !(
          p.issuedAt - 300 <= after.notBefore &&
          after.notBefore <= p.issuedAt &&
          p.issuedAt < after.expiresAt &&
          after.expiresAt > before.expiresAt &&
          after.expiresAt - after.notBefore <= 31536000
        )
      )
        throw new VaultError("key_revoked");
      roles.add(t.role);
      old.add(t.priorKeyId);
      fresh.add(t.newKeyId);
      order.push([t.role, t.principalId, t.priorKeyId].join("/"));
    }
    if (
      !equal(order, [...order].sort()) ||
      p.renewals.find((t: Json) => t.role === "device_sig").principalId !==
        p.renewals.find((t: Json) => t.role === "device_enc").principalId ||
      !equal(
        [...next.certificates.keys()].sort(),
        [...previous.certificates.keys(), ...fresh].sort(),
      ) ||
      !equal(
        [...next.active].sort(),
        [...[...previous.active].filter((id) => !old.has(id)), ...fresh].sort(),
      ) ||
      !equal(
        [...next.checkpoint.revokedKeyIds].sort(),
        [...new Set([...previous.checkpoint.revokedKeyIds, ...old])].sort(),
      )
    )
      throw new VaultError("registry_conflict");
    for (const [id, c] of previous.certificates)
      if (!equal(c, next.certificates.get(id))) throw new VaultError("registry_conflict");
    const device = value.device;
    if (
      !device ||
      device.profile !== "folioview.device-keystore.v1" ||
      device.ownerSubject !== (await this.owner) ||
      device.vaultId !== vault.vaultId ||
      device.rootKeyId !== vault.rootKeyId ||
      device.credentialId !== archive.credentialId ||
      device.prfSalt !== archive.prfSalt ||
      device.signingKeyId !== p.renewals.find((t: Json) => t.role === "device_sig").newKeyId ||
      device.encryptionKeyId !== p.renewals.find((t: Json) => t.role === "device_enc").newKeyId ||
      device.deviceId !== p.renewals.find((t: Json) => t.role === "device_sig").principalId
    )
      throw new VaultError("binding_mismatch");
    if (value.cancellation !== null) {
      const cancel = value.cancellation as KeyRenewalCancellationPacket;
      exact(cancel, ["operationId", "body"]);
      exact(cancel.body, ["contractVersion", "archive", "command"]);
      validate("OperationIdentifier", cancel.operationId);
      bounded(cancel.body.command, 8192);
      const c = await verified(cancel.body.command, vault.rootJwk);
      exact(c, Object.keys(ap));
      checkArchive(cancel.body.archive, await this.owner);
      if (
        cancel.body.contractVersion !== CONTRACT ||
        c.profile !== ap.profile ||
        c.action !== "archive_replace" ||
        c.mode !== "rewrap" ||
        c.authorizationId !== null ||
        c.stableOperationId !== cancel.operationId ||
        cancel.operationId === packet.operationId ||
        c.contractVersion !== CONTRACT ||
        [
          "ownerSubject",
          "vaultId",
          "rootKeyId",
          "expectedVaultVersion",
          "registrySequence",
          "checkpointDigest",
          "keyEpoch",
          "expectedLifecycleVersion",
          "expectedArchiveRevision",
          "expectedArchiveDigest",
        ].some((f) => c[f] !== p[f]) ||
        c.newArchiveDigest !== (await sha(canonical(cancel.body.archive))) ||
        cancel.body.archive.credentialId !== archive.credentialId ||
        cancel.body.archive.prfSalt !== archive.prfSalt ||
        cancel.body.archive.vaultId !== vault.vaultId ||
        cancel.body.archive.rootKeyId !== vault.rootKeyId
      )
        throw new VaultError("binding_mismatch");
      for (const f of ["issuedAt", "expiresAt"]) positive(c[f], 0);
      if (!(c.issuedAt < c.expiresAt && c.expiresAt <= c.issuedAt + 300))
        throw new VaultError("binding_mismatch");
    }
    return { value, packet, p, previous, next };
  }
  private renewalPhase(
    vault: Vault,
    state: VaultLifecycleState,
    value: Awaited<ReturnType<VaultCore["readRenewal"]>>,
  ) {
    const p = value.p;
    const committed = state.history.find((i) => i.receipt.operationId === value.packet.operationId);
    if (committed) {
      const checkpoint = vault.registryHistory[p.registrySequence];
      if (
        !checkpoint ||
        !equal(
          parsed(unb64(checkpoint.checkpoint.payload)),
          parsed(unb64(value.packet.body.registryBundle.checkpoint.payload)),
        ) ||
        !equal(
          parsed(unb64(committed.command.payload)),
          parsed(unb64(value.packet.body.archiveCommand.payload)),
        )
      )
        throw new VaultError("binding_mismatch");
      return "applied" as const;
    }
    return vault.version === p.expectedVaultVersion &&
      state.registrySequence === p.registrySequence &&
      state.checkpointDigest === p.checkpointDigest &&
      state.keyEpoch === p.keyEpoch &&
      state.lifecycleVersion === p.expectedLifecycleVersion &&
      state.archiveRevision === p.expectedArchiveRevision &&
      state.archiveDigest === p.expectedArchiveDigest
      ? ("ready" as const)
      : ("conflict" as const);
  }
  async inspectKeyRenewal(
    vault: Vault,
    state: VaultLifecycleState,
    record?: Json,
    prior?: VaultLifecyclePin,
  ): Promise<KeyRenewalSummary> {
    const { registry } = await this.renewalContext(vault, state, prior);
    const device = this.device;
    const sig = device ? registry.certificates.get(device.sigId) : undefined;
    const enc = device ? registry.certificates.get(device.encId) : undefined;
    const recoveryId = this.recoveryJwk ? await thumb(this.recoveryJwk!) : null;
    const recovery = recoveryId ? registry.certificates.get(recoveryId) : undefined;
    const eligible = (c: Json | undefined) =>
      !!c &&
      registry.active.has(c.keyId) &&
      !registry.checkpoint.revokedKeyIds.includes(c.keyId) &&
      c.connectionId === null &&
      c.keyEpoch === registry.localEpochs.get([c.principalId, c.role, null].join("/"));
    let reason: KeyRenewalSummary["reason"] = !device
      ? "device_required"
      : !eligible(sig) ||
          !eligible(enc) ||
          !eligible(recovery) ||
          sig!.role !== "device_sig" ||
          enc!.role !== "device_enc" ||
          recovery!.role !== "recovery_enc" ||
          sig!.principalId !== device.deviceId ||
          enc!.principalId !== device.deviceId
        ? "keys_revoked"
        : this.pendingDevice || this.deviceChange || this.archiveChange
          ? "pending_operation"
          : state.pendingAuthorization
            ? "recovery_authorization_pending"
            : vault.registryHistory.length >= 32 ||
                registry.bundle.entries.length + 3 > 64 ||
                state.lifecycleVersion >= 32
              ? "capacity"
              : null;
    let pending: KeyRenewalSummary["pending"] = null;
    if (record) {
      const found = await this.readRenewal(vault, record);
      pending = {
        operationId: found.packet.operationId,
        state: this.renewalPhase(vault, state, found),
        expiresAt: found.p.expiresAt,
      };
      reason = "pending_operation";
    }
    return {
      vaultId: vault.vaultId,
      rootKeyId: vault.rootKeyId,
      registrySequence: registry.checkpoint.registrySequence,
      checkpointDigest: registry.digest,
      keyEpoch: registry.checkpoint.keyEpoch,
      canRenew: reason === null,
      reason,
      device:
        device && sig && enc
          ? {
              deviceId: device.deviceId,
              signingKeyId: device.sigId,
              encryptionKeyId: device.encId,
              expiresAt: Math.min(sig.expiresAt, enc.expiresAt),
            }
          : null,
      recovery: recovery ? { keyId: recovery.keyId, expiresAt: recovery.expiresAt } : null,
      pending,
    };
  }
  async prepareKeyRenewal(vault: Vault, state: VaultLifecycleState, prior?: VaultLifecyclePin) {
    const summary = await this.inspectKeyRenewal(vault, state, undefined, prior);
    if (!summary.canRenew) throw new VaultError(summary.reason!);
    if (
      !this.wrapping ||
      !this.deviceSeal ||
      !this.device ||
      !this.root ||
      !this.recoveryMaster ||
      !this.recoveryJwk
    )
      throw new VaultError("locked");
    const { registry } = await this.renewalContext(vault, state, prior);
    const issuedAt = this.now(),
      operationId = randomId("renew_");
    const oldRecovery = registry.certificates.get(await thumb(this.recoveryJwk!))!;
    const specs = [
      {
        role: "device_sig",
        before: registry.certificates.get(this.device.sigId)!,
        next: await makeKey(true),
      },
      {
        role: "device_enc",
        before: registry.certificates.get(this.device.encId)!,
        next: await makeKey(),
      },
      { role: "recovery_enc", before: oldRecovery, next: await makeKey() },
    ];
    const historical: Json[] = structuredClone(this.recoveryMaster.historicalKeys ?? []);
    const deviceMaterial = await open(this.wrapping, this.deviceSeal);
    exact(deviceMaterial, ["deviceId", "signingPrivateJwk", "encryptionPrivateJwk"]);
    const retain = async (role: string, principalId: string, privateJwk: Json) => {
      await thumb(privateJwk);
      if (
        !historical.some((item) => canonical(pub(item.privateJwk)) === canonical(pub(privateJwk)))
      )
        historical.push({ role, principalId, privateJwk });
    };
    await retain("recovery_enc", oldRecovery.principalId, this.recoveryMaster.recoveryPrivateJwk);
    await retain("device_sig", this.device.deviceId, deviceMaterial.signingPrivateJwk);
    await retain("device_enc", this.device.deviceId, deviceMaterial.encryptionPrivateJwk);
    for (const item of specs.filter((i) => i.role.startsWith("device_")))
      await retain(item.role, item.before.principalId, item.next.privateJwk);
    const master: Json = {
      ...this.recoveryMaster,
      profile: "folioview.historical-keyring.v1",
      historicalKeys: historical,
      recoveryPrivateJwk: specs[2].next.privateJwk,
    };
    const entries = registry.bundle.entries.map((e) => ({
      ...e,
      active: specs.some((i) => i.before.keyId === parsed(unb64(e.certificate.payload)).keyId)
        ? false
        : e.active,
    }));
    const renewals = [];
    for (const item of specs) {
      const before = item.before;
      const c = {
        ...before,
        certificateId: randomId("cert_"),
        keyId: item.next.keyId,
        publicJwk: item.next.publicJwk,
        keyEpoch: before.keyEpoch + 1,
        notBefore: issuedAt,
        expiresAt: issuedAt + 31536000,
      };
      if (c.expiresAt <= before.expiresAt) throw new VaultError("renewal_too_early");
      entries.push({ certificate: await sign(c, this.root, vault.rootKeyId), active: true });
      renewals.push({
        role: item.role,
        principalId: before.principalId,
        priorKeyId: before.keyId,
        newKeyId: c.keyId,
        priorKeyEpoch: before.keyEpoch,
        newKeyEpoch: c.keyEpoch,
      });
    }
    renewals.sort((a, b) =>
      canonical([a.role, a.principalId, a.priorKeyId]).localeCompare(
        canonical([b.role, b.principalId, b.priorKeyId]),
      ),
    );
    const registryBundle = await this.bundle(entries, registry);
    const cp = parsed(unb64(registryBundle.checkpoint.payload));
    cp.revokedKeyIds = [
      ...new Set([...cp.revokedKeyIds, ...specs.map((i) => i.before.keyId)]),
    ].sort();
    registryBundle.checkpoint = await sign(cp, this.root, vault.rootKeyId);
    const archive = (await seal(this.wrapping, archiveContext(vault.archive), master)) as Archive;
    checkArchive(archive, await this.owner);
    if (!equal(await open(this.wrapping, archive), master)) throw new VaultError("crypto_failed");
    const candidateVault = {
      ...vault,
      archive,
      registryHistory: [...vault.registryHistory, registryBundle],
      version: vault.version + 1,
    };
    // Validate all private readers against the signed candidate directory before any packet leaves the Worker.
    const previousMaster = this.recoveryMaster;
    await this.installMaster(master, candidateVault);
    await this.installMaster(previousMaster, vault);
    const device = await seal(
      this.wrapping,
      {
        ...archiveContext(this.deviceSeal),
        signingKeyId: specs[0].next.keyId,
        encryptionKeyId: specs[1].next.keyId,
      },
      {
        deviceId: this.device.deviceId,
        signingPrivateJwk: specs[0].next.privateJwk,
        encryptionPrivateJwk: specs[1].next.privateJwk,
      },
    );
    const archivePayload: Json = this.lifecycleCommand(state, "archive_replace", operationId, {
      mode: "rewrap",
      authorizationId: null,
      newArchiveDigest: await sha(canonical(archive)),
      issuedAt,
      expiresAt: issuedAt + 300,
    });
    const archiveCommand = await sign(archivePayload, this.root, vault.rootKeyId);
    const { mode: _mode, authorizationId: _authorization, ...base } = archivePayload;
    const packet: KeyRenewalPacket = {
      operationId,
      body: {
        contractVersion: CONTRACT,
        registryBundle,
        archive,
        archiveCommand,
        command: await sign(
          {
            ...base,
            profile: "folioview.vault-key-renewal.v1",
            action: "key_renewal",
            newCheckpointDigest: await sha(canonical(cp)),
            archiveCommandFingerprint: await signingFingerprint(archiveCommand),
            renewals,
          },
          this.root,
          vault.rootKeyId,
        ),
      },
    };
    const record = await this.sealRenewal({ packet, device, cancellation: null });
    await this.readRenewal(vault, record);
    this.renewalOnly = true;
    return { packet, record };
  }
  async getKeyRenewal(
    vault: Vault,
    state: VaultLifecycleState,
    record: Json,
    prior?: VaultLifecyclePin,
  ) {
    await this.renewalContext(vault, state, prior);
    const found = await this.readRenewal(vault, record);
    return {
      packet: found.packet,
      state: this.renewalPhase(vault, state, found),
      ...(found.value.cancellation
        ? { cancellation: found.value.cancellation as KeyRenewalCancellationPacket }
        : {}),
    };
  }
  async prepareKeyRenewalCancellation(
    vault: Vault,
    state: VaultLifecycleState,
    record: Json,
    prior?: VaultLifecyclePin,
  ) {
    await this.renewalContext(vault, state, prior);
    const found = await this.readRenewal(vault, record);
    if (this.renewalPhase(vault, state, found) !== "ready")
      throw new VaultError("operation_conflict");
    if (state.pendingAuthorization || state.lifecycleVersion >= 32 || !this.wrapping || !this.root)
      throw new VaultError("recovery_authorization_pending");
    const previous = found.value.cancellation as KeyRenewalCancellationPacket | null;
    if (previous && parsed(unb64(previous.body.command.payload)).expiresAt > this.now())
      return { packet: previous, record };
    const master = await open(this.wrapping, vault.archive);
    const archive = (await seal(this.wrapping, archiveContext(vault.archive), master)) as Archive;
    checkArchive(archive, await this.owner);
    const operationId = randomId("renew_cancel_");
    const command = await sign(
      this.lifecycleCommand(state, "archive_replace", operationId, {
        mode: "rewrap",
        authorizationId: null,
        newArchiveDigest: await sha(canonical(archive)),
      }),
      this.root,
      vault.rootKeyId,
    );
    const packet: KeyRenewalCancellationPacket = {
      operationId,
      body: { contractVersion: CONTRACT, archive, command },
    };
    const next = await this.sealRenewal({ ...found.value, cancellation: packet });
    await this.readRenewal(vault, next);
    return { packet, record: next };
  }
  private renewalDeviceEligible(registry: Registry) {
    if (!this.device || !this.deviceSeal) return false;
    return [
      [this.device.sigId, "device_sig"],
      [this.device.encId, "device_enc"],
    ].every(([id, role]) => {
      const c = registry.certificates.get(id);
      return (
        c &&
        c.role === role &&
        c.principalId === this.device!.deviceId &&
        c.connectionId === null &&
        registry.active.has(id) &&
        !registry.checkpoint.revokedKeyIds.includes(id) &&
        c.keyEpoch === registry.localEpochs.get([c.principalId, role, null].join("/"))
      );
    });
  }
  private async renewalCommit(vault: Vault, registry: Registry) {
    const record = await this.adoptVault(vault, registry);
    // Expiration never erases the sole local identity needed for another explicit
    // root-approved renewal. Ordinary capabilities still call cert(..., now).
    if (
      this.renewalDeviceEligible(registry) &&
      this.deviceSeal!.credentialId === vault.archive.credentialId &&
      this.deviceSeal!.prfSalt === vault.archive.prfSalt
    )
      record.device = this.deviceSeal;
    return record;
  }
  async finishKeyRenewal(
    vault: Vault,
    state: VaultLifecycleState,
    record: Json,
    response: Json,
    prior?: VaultLifecyclePin,
  ) {
    const { pin, registry } = await this.renewalContext(vault, state, prior);
    const found = await this.readRenewal(vault, record);
    if (this.renewalPhase(vault, state, found) !== "applied")
      throw new VaultError("key_renewal_unknown");
    exact(response, ["contractVersion", "profile", "receipt"]);
    const p = found.p,
      receipt = response.receipt;
    const item = state.history.find((i) => i.receipt.operationId === found.packet.operationId)!;
    const acceptedAt = item.receipt.acceptedAt;
    const ap = parsed(unb64(found.packet.body.archiveCommand.payload));
    if (
      response.contractVersion !== CONTRACT ||
      response.profile !== p.profile ||
      !(
        p.issuedAt <= acceptedAt &&
        acceptedAt < p.expiresAt &&
        ap.issuedAt <= acceptedAt &&
        acceptedAt < ap.expiresAt
      ) ||
      !equal(receipt, {
        profile: p.profile,
        ownerSubject: await this.owner,
        vaultId: vault.vaultId,
        rootKeyId: vault.rootKeyId,
        operationId: found.packet.operationId,
        vaultVersion: p.expectedVaultVersion + 1,
        registrySequence: p.registrySequence + 1,
        checkpointDigest: p.newCheckpointDigest,
        keyEpoch: p.keyEpoch,
        lifecycleVersion: p.expectedLifecycleVersion + 1,
        archiveRevision: p.expectedArchiveRevision + 1,
        archiveDigest: p.newArchiveDigest,
        renewals: p.renewals,
        commandFingerprint: await signingFingerprint(found.packet.body.command),
        archiveCommandFingerprint: p.archiveCommandFingerprint,
        acceptedAt,
      })
    )
      throw new VaultError("binding_mismatch");
    this.vault = vault;
    this.registry = registry;
    if (equal(vault.archive, found.packet.body.archive)) {
      const master = await open(this.wrapping!, vault.archive);
      await this.installMaster(master, vault);
      const nextDevice = await this.readDevice(found.value.device);
      this.device = nextDevice;
      this.deviceSeal = found.value.device;
      if (!this.renewalDeviceEligible(registry)) {
        this.device = undefined;
        this.deviceSeal = undefined;
      }
    }
    this.renewalOnly = false;
    return { pin, record: await this.renewalCommit(vault, registry), applied: true as const };
  }
  async discardKeyRenewal(
    vault: Vault,
    state: VaultLifecycleState,
    record: Json,
    operationId: string,
    prior?: VaultLifecyclePin,
  ) {
    const { pin, registry } = await this.renewalContext(vault, state, prior);
    const found = await this.readRenewal(vault, record);
    if (
      operationId !== found.packet.operationId ||
      this.renewalPhase(vault, state, found) !== "conflict"
    )
      throw new VaultError("key_renewal_unknown");
    this.vault = vault;
    this.registry = registry;
    this.renewalOnly = false;
    return { safe: true as const, pin, record: await this.renewalCommit(vault, registry) };
  }
  /** Dedicated verified transition path; ordinary checkVault remains archive-strict. */
  async verifyLifecycle(vault: Vault, state: VaultLifecycleState, prior?: VaultLifecyclePin) {
    const owner = await this.owner;
    if (
      this.vault &&
      (this.vault.vaultId !== vault.vaultId ||
        this.vault.rootKeyId !== vault.rootKeyId ||
        !equal(this.vault.rootJwk, vault.rootJwk))
    )
      throw new VaultError("untrusted_vault");
    const old = this.vault;
    let registry: Registry;
    this.vault = undefined;
    try {
      registry = await this.checkVault(vault, this.pin);
    } finally {
      this.vault = old;
    }
    exact(state, [
      "contractVersion",
      "profile",
      "vaultId",
      "rootKeyId",
      "vaultVersion",
      "registrySequence",
      "checkpointDigest",
      "keyEpoch",
      "lifecycleVersion",
      "archiveRevision",
      "archiveDigest",
      "archive",
      "pendingAuthorization",
      "history",
    ]);
    bounded(state, 524288);
    if (
      state.profile !== "folioview.vault-lifecycle.v1" ||
      state.contractVersion !== CONTRACT ||
      state.vaultId !== vault.vaultId ||
      state.rootKeyId !== vault.rootKeyId ||
      state.vaultVersion !== vault.version ||
      state.registrySequence !== registry.checkpoint.registrySequence ||
      state.checkpointDigest !== registry.digest ||
      state.keyEpoch !== registry.checkpoint.keyEpoch ||
      !equal(state.archive, vault.archive) ||
      !Array.isArray(state.history) ||
      state.history.length > 32 ||
      state.lifecycleVersion !== state.history.length
    )
      throw new VaultError("untrusted_lifecycle");
    const archiveStates: { digest: string; revision: number }[] = [];
    const fingerprints: string[] = [],
      operations = new Set<string>(),
      authIds = new Set<string>();
    let digest = state.archiveDigest,
      revision = 0,
      pending: { payload: Json; command: Signed } | null = null,
      acceptedAt = 0,
      lastVault = 0,
      lastRegistry = 0;
    const digestValid = (v: unknown) => {
      if (typeof v !== "string" || !/^[0-9a-f]{64}$/.test(v))
        throw new VaultError("untrusted_lifecycle");
    };
    digestValid(digest);
    const fence = ["expectedVaultVersion", "registrySequence", "checkpointDigest", "keyEpoch"];
    for (let index = 0; index < state.history.length; index++) {
      const item = state.history[index];
      exact(item, ["command", "receipt"]);
      bounded(item.command, 8192);
      const p = await verified(item.command, vault.rootJwk);
      const extras: Record<string, string[]> = {
        archive_replace: ["mode", "newArchiveDigest", "authorizationId"],
        recovery_authorize: ["authorizationId", "newArchiveDigest"],
        recovery_revoke: ["authorizationId"],
      };
      if (!extras[p.action]) throw new VaultError("untrusted_lifecycle");
      exact(p, [
        "profile",
        "contractVersion",
        "action",
        "ownerSubject",
        "vaultId",
        "rootKeyId",
        "stableOperationId",
        "expectedVaultVersion",
        "expectedLifecycleVersion",
        "expectedArchiveRevision",
        "expectedArchiveDigest",
        "registrySequence",
        "checkpointDigest",
        "keyEpoch",
        "issuedAt",
        "expiresAt",
        ...extras[p.action],
      ]);
      if (
        p.profile !== state.profile ||
        p.contractVersion !== CONTRACT ||
        p.ownerSubject !== owner ||
        p.vaultId !== vault.vaultId ||
        p.rootKeyId !== vault.rootKeyId
      )
        throw new VaultError("wrong_account");
      validate("OperationIdentifier", p.stableOperationId);
      for (const name of ["expectedVaultVersion", "registrySequence", "keyEpoch", "expiresAt"])
        positive(p[name]);
      for (const name of ["expectedLifecycleVersion", "expectedArchiveRevision", "issuedAt"])
        positive(p[name], 0);
      digestValid(p.expectedArchiveDigest);
      digestValid(p.checkpointDigest);
      if (index === 0) {
        digest = p.expectedArchiveDigest;
        archiveStates.push({ digest, revision });
      }
      const checkpoint = vault.registryHistory[p.registrySequence - 1];
      if (
        !checkpoint ||
        p.expectedVaultVersion < lastVault ||
        p.expectedVaultVersion > vault.version ||
        p.registrySequence < lastRegistry ||
        p.registrySequence > state.registrySequence ||
        p.expectedLifecycleVersion !== index ||
        p.expectedArchiveRevision !== revision ||
        p.expectedArchiveDigest !== digest ||
        operations.has(p.stableOperationId) ||
        !(p.issuedAt < p.expiresAt && p.expiresAt <= p.issuedAt + 300)
      )
        throw new VaultError("untrusted_lifecycle");
      const cp = parsed(unb64(checkpoint.checkpoint.payload));
      if ((await sha(canonical(cp))) !== p.checkpointDigest || cp.keyEpoch !== p.keyEpoch)
        throw new VaultError("untrusted_lifecycle");
      const r = item.receipt;
      exact(r, [
        "profile",
        "ownerSubject",
        "vaultId",
        "rootKeyId",
        "operationId",
        "action",
        "lifecycleVersion",
        "archiveRevision",
        "archiveDigest",
        "commandFingerprint",
        "acceptedAt",
      ]);
      positive(r.acceptedAt, 0);
      if (r.acceptedAt < acceptedAt || r.acceptedAt < p.issuedAt || r.acceptedAt >= p.expiresAt)
        throw new VaultError("untrusted_lifecycle");
      if (p.action !== "recovery_revoke") {
        digestValid(p.newArchiveDigest);
        if (p.newArchiveDigest === digest) throw new VaultError("untrusted_lifecycle");
      }
      if (p.action !== "archive_replace" || p.mode === "recovery")
        validate("Identifier", p.authorizationId);
      if (p.action === "recovery_authorize") {
        if (
          index >= 31 ||
          authIds.has(p.authorizationId) ||
          (pending && r.acceptedAt < pending.payload.expiresAt)
        )
          throw new VaultError("untrusted_lifecycle");
        authIds.add(p.authorizationId);
        pending = { payload: p, command: item.command };
      } else if (p.action === "recovery_revoke") {
        if (!pending || pending.payload.authorizationId !== p.authorizationId)
          throw new VaultError("untrusted_lifecycle");
        pending = null;
      } else {
        if (
          !["rewrap", "passkey_change", "recovery"].includes(p.mode) ||
          (p.mode !== "recovery" && p.authorizationId !== null)
        )
          throw new VaultError("untrusted_lifecycle");
        if (p.mode === "recovery") {
          const a = pending?.payload;
          if (
            !a ||
            a.authorizationId !== p.authorizationId ||
            a.newArchiveDigest !== p.newArchiveDigest ||
            a.expectedArchiveRevision !== revision ||
            a.expectedArchiveDigest !== digest ||
            fence.some((k) => a[k] !== p[k]) ||
            !(
              a.issuedAt <= p.issuedAt &&
              p.issuedAt <= r.acceptedAt &&
              r.acceptedAt < a.expiresAt &&
              p.expiresAt <= a.expiresAt
            )
          )
            throw new VaultError("untrusted_lifecycle");
        }
        digest = p.newArchiveDigest;
        revision++;
        pending = null;
      }
      const fingerprint = await signingFingerprint(item.command);
      if (
        !equal(r, {
          profile: state.profile,
          ownerSubject: owner,
          vaultId: vault.vaultId,
          rootKeyId: vault.rootKeyId,
          operationId: p.stableOperationId,
          action: p.action,
          lifecycleVersion: index + 1,
          archiveRevision: revision,
          archiveDigest: digest,
          commandFingerprint: fingerprint,
          acceptedAt: r.acceptedAt,
        })
      )
        throw new VaultError("untrusted_lifecycle");
      archiveStates.push({ digest, revision });
      fingerprints.push(fingerprint);
      operations.add(p.stableOperationId);
      acceptedAt = r.acceptedAt;
      lastVault = p.expectedVaultVersion;
      lastRegistry = p.registrySequence;
    }
    if (
      digest !== state.archiveDigest ||
      revision !== state.archiveRevision ||
      digest !== (await sha(canonical(vault.archive)))
    )
      throw new VaultError("untrusted_lifecycle");
    let expectedPending: Json | null = null;
    if (pending) {
      const p = pending.payload;
      const status =
        this.now() >= p.expiresAt
          ? "expired"
          : fence.some(
                (k) =>
                  p[k] !==
                  (
                    {
                      expectedVaultVersion: vault.version,
                      registrySequence: state.registrySequence,
                      checkpointDigest: state.checkpointDigest,
                      keyEpoch: state.keyEpoch,
                    } as Json
                  )[k],
              )
            ? "stale"
            : "active";
      expectedPending = {
        authorizationId: p.authorizationId,
        newArchiveDigest: p.newArchiveDigest,
        expiresAt: p.expiresAt,
        status,
        command: pending.command,
      };
    }
    if (!equal(state.pendingAuthorization, expectedPending))
      throw new VaultError("untrusted_lifecycle");
    if (!archiveStates.length) archiveStates.push({ digest, revision });
    const pin: VaultLifecyclePin = {
      ownerSubject: owner,
      vaultId: vault.vaultId,
      rootKeyId: vault.rootKeyId,
      lifecycleVersion: state.lifecycleVersion,
      archiveRevision: revision,
      archiveDigest: digest,
      fingerprints,
    };
    for (const known of [this.lifecyclePin, prior]) {
      if (!known) continue;
      if (
        known.ownerSubject !== owner ||
        known.vaultId !== vault.vaultId ||
        known.rootKeyId !== vault.rootKeyId ||
        !Array.isArray(known.fingerprints) ||
        known.fingerprints.length !== known.lifecycleVersion ||
        known.lifecycleVersion > pin.lifecycleVersion ||
        known.archiveRevision > revision ||
        archiveStates[known.lifecycleVersion]?.digest !== known.archiveDigest ||
        archiveStates[known.lifecycleVersion]?.revision !== known.archiveRevision ||
        known.fingerprints.some((v, i) => v !== fingerprints[i]) ||
        (known.lifecycleVersion === pin.lifecycleVersion && known.archiveDigest !== digest)
      )
        throw new VaultError("rollback_detected");
    }
    this.pin = (await this.publicVaultPin(vault, registry)).pin;
    this.lifecyclePin = pin;
    return pin;
  }
  async createRecoveryKit(
    vault: Vault,
    state: VaultLifecycleState,
    prior?: VaultLifecyclePin,
  ): Promise<RecoveryKitExport> {
    this.requireOrdinarySession();
    if (!this.wrapping || !this.root || !this.recovery) throw new VaultError("locked");
    const pin = await this.verifyLifecycle(vault, state, prior);
    await this.checkVault(vault, this.pin);
    const master = await open(this.wrapping, vault.archive);
    const raw = crypto.getRandomValues(new Uint8Array(32));
    try {
      const code = b64(raw),
        createdAt = this.now();
      const k = await crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, [
        "encrypt",
        "decrypt",
      ]);
      const envelope = await seal(
        k,
        {
          profile: "folioview.independent-recovery.v1",
          ownerSubject: await this.owner,
          vaultId: vault.vaultId,
          rootKeyId: vault.rootKeyId,
          rootJwk: vault.rootJwk,
          registryPin: this.pin ?? (await this.adoptVault(vault, this.registry!)).pin,
          lifecyclePin: pin,
          createdAt,
        },
        master,
      );
      if (!equal(await open(k, envelope), master)) throw new VaultError("crypto_failed");
      return { file: canonical(envelope), code, createdAt };
    } finally {
      raw.fill(0);
    }
  }
  async importRecoveryKit(
    vault: Vault,
    state: VaultLifecycleState,
    file: string,
    code: string,
    prior?: VaultLifecyclePin,
  ) {
    this.requireOrdinarySession();
    if (
      typeof file !== "string" ||
      file.length > 65536 ||
      typeof code !== "string" ||
      code.length !== 43
    )
      throw new VaultError("invalid_recovery_kit");
    const kit = parsed(utf8.encode(file), false);
    exact(kit, [
      "profile",
      "ownerSubject",
      "vaultId",
      "rootKeyId",
      "rootJwk",
      "registryPin",
      "lifecyclePin",
      "createdAt",
      "iv",
      "ciphertext",
    ]);
    if (
      kit.profile !== "folioview.independent-recovery.v1" ||
      kit.ownerSubject !== (await this.owner) ||
      kit.vaultId !== vault.vaultId ||
      kit.rootKeyId !== vault.rootKeyId ||
      !equal(kit.rootJwk, vault.rootJwk)
    )
      throw new VaultError("wrong_account");
    positive(kit.createdAt, 0);
    const raw = unb64(code, 32);
    if (raw.length !== 32) throw new VaultError("invalid_recovery_kit");
    let master: Json;
    try {
      const k = await crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, [
        "decrypt",
      ]);
      master = await open(k, kit);
    } finally {
      raw.fill(0);
    }
    // A recovery kit adds an independent older pin; it must never replace newer
    // pins already known by this Worker or its durable caller.
    const registry = await this.checkVault(vault, this.pin);
    await this.checkVault(vault, kit.registryPin);
    await this.verifyLifecycle(vault, state, prior);
    await this.verifyLifecycle(vault, state, kit.lifecyclePin);
    // A valid pinned root alone cannot recover keys generated after this kit.
    // Reject before installing any kit private material into an existing session.
    try {
      cert(registry, await thumb(master.recoveryPrivateJwk), "recovery_enc", this.now());
    } catch {
      throw new VaultError("stale_recovery_kit");
    }
    await this.installMaster(master, vault);
    // Successful recovery has now observed the current directory. Remember that
    // high-water mark rather than the recovery kit's older lower bound.
    this.pin = {
      ownerSubject: await this.owner,
      vaultId: vault.vaultId,
      rootKeyId: vault.rootKeyId,
      registrySequence: registry.checkpoint.registrySequence,
      checkpointDigest: registry.digest,
      keyEpoch: registry.checkpoint.keyEpoch,
    };
    this.registry = registry;
    this.vault = vault;
    this.recoveryMaster = master;
    this.device = undefined;
    this.deviceSeal = undefined;
    this.wrapping = undefined;
    return { needsDeviceRegistration: true };
  }
  private lifecycleCommand(
    state: VaultLifecycleState,
    action: string,
    operationId: string,
    extra: Json,
  ) {
    if (!this.vault) throw new VaultError("locked");
    const issuedAt = this.now();
    return {
      profile: "folioview.vault-lifecycle.v1",
      contractVersion: CONTRACT,
      action,
      ownerSubject: state.archive.ownerSubject,
      vaultId: state.vaultId,
      rootKeyId: state.rootKeyId,
      stableOperationId: operationId,
      expectedVaultVersion: state.vaultVersion,
      expectedLifecycleVersion: state.lifecycleVersion,
      expectedArchiveRevision: state.archiveRevision,
      expectedArchiveDigest: state.archiveDigest,
      registrySequence: state.registrySequence,
      checkpointDigest: state.checkpointDigest,
      keyEpoch: state.keyEpoch,
      issuedAt,
      expiresAt: issuedAt + 300,
      ...extra,
    };
  }
  async prepareArchiveChange(
    vault: Vault,
    state: VaultLifecycleState,
    material: PasskeyMaterial,
    mode: "passkey_change" | "recovery",
    prior?: VaultLifecyclePin,
  ) {
    this.requireOrdinarySession();
    if (!this.root || !this.recovery || !["passkey_change", "recovery"].includes(mode))
      throw new VaultError("locked");
    await this.verifyLifecycle(vault, state, prior);
    const registry = await this.checkVault(vault, this.pin);
    try {
      if (!this.recoveryJwk) throw new VaultError("locked");
      cert(registry, await thumb(this.recoveryJwk), "recovery_enc", this.now());
    } catch {
      throw new VaultError("stale_recovery_kit");
    }
    if (
      state.lifecycleVersion >= 31 ||
      (state.pendingAuthorization &&
        !(mode === "recovery" && state.pendingAuthorization.status === "expired"))
    )
      throw new VaultError("recovery_authorization_pending");
    if (
      material.credentialId === vault.archive.credentialId ||
      material.prfSalt === vault.archive.prfSalt
    )
      throw new VaultError("invalid_replacement_passkey");
    const master =
      this.recoveryMaster ?? (this.wrapping ? await open(this.wrapping, vault.archive) : null);
    if (!master) throw new VaultError("locked");
    const nextWrapping = await aesMaterial(material);
    const archive = (await seal(
      nextWrapping,
      {
        ...archiveContext(vault.archive),
        credentialId: material.credentialId,
        prfSalt: material.prfSalt,
      },
      master,
    )) as Archive;
    checkArchive(archive, await this.owner);
    if (!equal(await open(nextWrapping, archive), master)) throw new VaultError("crypto_failed");
    let candidate: Json | null = null;
    if (this.deviceSeal && this.wrapping) {
      const plaintext = await open(this.wrapping, this.deviceSeal);
      candidate = await seal(
        nextWrapping,
        {
          ...archiveContext(this.deviceSeal),
          credentialId: material.credentialId,
          prfSalt: material.prfSalt,
        },
        plaintext,
      );
      if (!equal(await open(nextWrapping, candidate), plaintext))
        throw new VaultError("crypto_failed");
    }
    const operationId = randomId(),
      digest = await sha(canonical(archive));
    let authorization: ArchiveChangePacket["authorization"];
    let commandState = state;
    if (mode === "recovery") {
      const authOperation = randomId(),
        authorizationId = randomId("recovery_");
      const payload = this.lifecycleCommand(state, "recovery_authorize", authOperation, {
        authorizationId,
        newArchiveDigest: digest,
      });
      authorization = {
        operationId: authOperation,
        authorizationId,
        command: await sign(payload, this.root, vault.rootKeyId),
      };
      commandState = { ...state, lifecycleVersion: state.lifecycleVersion + 1 };
    }
    const payload = this.lifecycleCommand(commandState, "archive_replace", operationId, {
      mode,
      newArchiveDigest: digest,
      authorizationId: authorization?.authorizationId ?? null,
    });
    if (authorization) payload.expiresAt = parsed(unb64(authorization.command.payload)).expiresAt;
    const packet: ArchiveChangePacket = {
      operationId,
      mode,
      archive,
      command: await sign(payload, this.root, vault.rootKeyId),
      ...(authorization ? { authorization } : {}),
    };
    const context = {
      profile: "folioview.archive-candidate.v1",
      ownerSubject: await this.owner,
      vaultId: vault.vaultId,
      rootKeyId: vault.rootKeyId,
      operationId,
    };
    const value = { packet, candidate };
    const record = {
      ...context,
      packet,
      next: await seal(
        nextWrapping,
        { ...context, credentialId: archive.credentialId, prfSalt: archive.prfSalt },
        value,
      ),
      old: this.wrapping
        ? await seal(
            this.wrapping,
            {
              ...context,
              credentialId: vault.archive.credentialId,
              prfSalt: vault.archive.prfSalt,
            },
            value,
          )
        : null,
    };
    this.archiveChange = { packet, candidate };
    return { packet, record };
  }
  async inspectArchiveChange(
    vault: Vault,
    state: VaultLifecycleState,
    record: Json,
    prior?: VaultLifecyclePin,
  ) {
    await this.verifyLifecycle(vault, state, prior);
    exact(record, [
      "profile",
      "ownerSubject",
      "vaultId",
      "rootKeyId",
      "operationId",
      "packet",
      "next",
      "old",
      ...(record.cancellation ? ["cancellation"] : []),
    ]);
    if (
      record.profile !== "folioview.archive-candidate.v1" ||
      record.ownerSubject !== (await this.owner) ||
      record.vaultId !== vault.vaultId ||
      record.rootKeyId !== vault.rootKeyId
    )
      throw new VaultError("wrong_account");
    bounded(record, 262144);
    const packet = record.packet;
    exact(packet, [
      "operationId",
      "mode",
      "archive",
      "command",
      ...(packet.authorization ? ["authorization"] : []),
    ]);
    if (
      !["passkey_change", "recovery"].includes(packet.mode) ||
      packet.operationId !== record.operationId
    )
      throw new VaultError("untrusted_lifecycle");
    checkArchive(packet.archive, await this.owner);
    bounded(packet.command, 8192);
    const p = await verified(packet.command, vault.rootJwk);
    exact(p, [
      "profile",
      "contractVersion",
      "action",
      "ownerSubject",
      "vaultId",
      "rootKeyId",
      "stableOperationId",
      "expectedVaultVersion",
      "expectedLifecycleVersion",
      "expectedArchiveRevision",
      "expectedArchiveDigest",
      "registrySequence",
      "checkpointDigest",
      "keyEpoch",
      "issuedAt",
      "expiresAt",
      "mode",
      "newArchiveDigest",
      "authorizationId",
    ]);
    validate("OperationIdentifier", p.stableOperationId);
    for (const field of ["expectedVaultVersion", "registrySequence", "keyEpoch", "expiresAt"])
      positive(p[field]);
    for (const field of ["expectedLifecycleVersion", "expectedArchiveRevision", "issuedAt"])
      positive(p[field], 0);
    if (
      !/^[0-9a-f]{64}$/.test(p.expectedArchiveDigest) ||
      !/^[0-9a-f]{64}$/.test(p.checkpointDigest) ||
      !(p.issuedAt < p.expiresAt && p.expiresAt <= p.issuedAt + 300) ||
      p.expectedLifecycleVersion > 32
    )
      throw new VaultError("untrusted_lifecycle");
    const checkpoint = vault.registryHistory[p.registrySequence - 1];
    if (
      !checkpoint ||
      p.expectedVaultVersion > vault.version ||
      (await sha(canonical(parsed(unb64(checkpoint.checkpoint.payload))))) !== p.checkpointDigest ||
      parsed(unb64(checkpoint.checkpoint.payload)).keyEpoch !== p.keyEpoch
    )
      throw new VaultError("untrusted_lifecycle");
    if (
      state.archiveDigest === p.expectedArchiveDigest &&
      (packet.archive.credentialId === vault.archive.credentialId ||
        packet.archive.prfSalt === vault.archive.prfSalt)
    )
      throw new VaultError("invalid_replacement_passkey");
    if (
      p.profile !== "folioview.vault-lifecycle.v1" ||
      p.contractVersion !== CONTRACT ||
      p.action !== "archive_replace" ||
      p.mode !== packet.mode ||
      p.ownerSubject !== (await this.owner) ||
      p.vaultId !== vault.vaultId ||
      p.rootKeyId !== vault.rootKeyId ||
      p.stableOperationId !== packet.operationId ||
      p.newArchiveDigest !== (await sha(canonical(packet.archive))) ||
      packet.archive.vaultId !== vault.vaultId ||
      packet.archive.rootKeyId !== vault.rootKeyId
    )
      throw new VaultError("untrusted_lifecycle");
    if (packet.mode === "recovery") {
      if (!packet.authorization) throw new VaultError("untrusted_lifecycle");
      bounded(packet.authorization.command, 8192);
      const a = await verified(packet.authorization.command, vault.rootJwk);
      exact(packet.authorization, ["operationId", "authorizationId", "command"]);
      exact(a, [
        "profile",
        "contractVersion",
        "action",
        "ownerSubject",
        "vaultId",
        "rootKeyId",
        "stableOperationId",
        "expectedVaultVersion",
        "expectedLifecycleVersion",
        "expectedArchiveRevision",
        "expectedArchiveDigest",
        "registrySequence",
        "checkpointDigest",
        "keyEpoch",
        "issuedAt",
        "expiresAt",
        "authorizationId",
        "newArchiveDigest",
      ]);
      validate("Identifier", a.authorizationId);
      validate("OperationIdentifier", a.stableOperationId);
      if (
        !Number.isSafeInteger(a.issuedAt) ||
        !Number.isSafeInteger(a.expiresAt) ||
        a.issuedAt < 0 ||
        a.issuedAt > p.issuedAt ||
        a.expiresAt < p.expiresAt ||
        a.expiresAt > a.issuedAt + 300
      )
        throw new VaultError("untrusted_lifecycle");
      if (
        a.action !== "recovery_authorize" ||
        a.profile !== p.profile ||
        a.contractVersion !== CONTRACT ||
        a.ownerSubject !== p.ownerSubject ||
        a.vaultId !== p.vaultId ||
        a.rootKeyId !== p.rootKeyId ||
        a.stableOperationId !== packet.authorization.operationId ||
        a.authorizationId !== p.authorizationId ||
        a.authorizationId !== packet.authorization.authorizationId ||
        a.newArchiveDigest !== p.newArchiveDigest ||
        a.expectedLifecycleVersion + 1 !== p.expectedLifecycleVersion ||
        [
          "expectedVaultVersion",
          "expectedArchiveRevision",
          "expectedArchiveDigest",
          "registrySequence",
          "checkpointDigest",
          "keyEpoch",
        ].some((k) => a[k] !== p[k])
      )
        throw new VaultError("untrusted_lifecycle");
    } else if (packet.authorization || p.authorizationId !== null)
      throw new VaultError("untrusted_lifecycle");
    return {
      archive: packet.archive as Archive,
      operationId: packet.operationId as string,
      mode: packet.mode as "passkey_change" | "recovery",
    };
  }
  async getArchiveChange(
    vault: Vault,
    state: VaultLifecycleState,
    record: Json,
    material?: PasskeyMaterial,
    prior?: VaultLifecyclePin,
  ) {
    this.requireOrdinarySession();
    await this.inspectArchiveChange(vault, state, record, prior);
    if (
      !record ||
      record.profile !== "folioview.archive-candidate.v1" ||
      record.ownerSubject !== (await this.owner) ||
      record.vaultId !== vault.vaultId ||
      record.rootKeyId !== vault.rootKeyId
    )
      throw new VaultError("wrong_account");
    if (!material && this.archiveChange && equal(this.archiveChange.packet, record.packet))
      return this.archiveChange.packet;
    let wrapping = this.wrapping;
    if (material) {
      if (
        ![record.next, record.old].some(
          (e) => e && e.credentialId === material.credentialId && e.prfSalt === material.prfSalt,
        )
      )
        throw new VaultError("unlock_failed");
      wrapping = await aesMaterial(material);
    }
    if (!wrapping) throw new VaultError("locked");
    let value: Json | undefined,
      usedNext = false;
    for (const seal of [record.next, record.old]) {
      if (!seal) continue;
      try {
        value = await open(wrapping, seal, 196608);
        usedNext = seal === record.next;
        break;
      } catch {
        /* exact old/new material only */
      }
    }
    if (
      !value ||
      !equal(value.packet, record.packet) ||
      value.packet.operationId !== record.operationId
    )
      throw new VaultError("unlock_failed");
    exact(value, ["packet", "candidate"]);
    const p = await verified(value.packet.command, vault.rootJwk);
    if (
      p.action !== "archive_replace" ||
      p.ownerSubject !== (await this.owner) ||
      p.vaultId !== vault.vaultId ||
      p.rootKeyId !== vault.rootKeyId ||
      p.stableOperationId !== record.operationId ||
      p.newArchiveDigest !== (await sha(canonical(value.packet.archive)))
    )
      throw new VaultError("untrusted_lifecycle");
    // The new PRF can resume a recovery before the old cloud archive was replaced.
    // Recover root only inside this Worker so an expired approval can be explicitly revoked.
    const master = await open(wrapping, usedNext ? value.packet.archive : vault.archive);
    await this.installMaster(master, vault);
    this.recoveryMaster = master;
    this.vault = vault;
    this.registry = await this.checkVault(vault, this.pin);
    this.archiveChange = { packet: value.packet, candidate: value.candidate };
    return value.packet as ArchiveChangePacket;
  }
  async finishArchiveChange(
    vault: Vault,
    state: VaultLifecycleState,
    operationId: string,
    prior?: VaultLifecyclePin,
  ) {
    this.requireOrdinarySession();
    const pin = await this.verifyLifecycle(vault, state, prior),
      change = this.archiveChange;
    if (!change || change.packet.operationId !== operationId)
      throw new VaultError("operation_conflict");
    const found = state.history.find((i) => i.receipt.operationId === operationId);
    if (
      !found ||
      (await signingFingerprint(found.command)) !==
        (await signingFingerprint(change.packet.command))
    )
      throw new VaultError("archive_change_unknown");
    const applied = equal(vault.archive, change.packet.archive);
    // This does not install the old receipt's archive if a later replacement exists.
    this.vault = vault;
    const registry = await this.checkVault(vault, this.pin);
    const record = await this.adoptVault(vault, registry);
    record.device = applied && change.candidate ? change.candidate : undefined;
    this.archiveChange = undefined;
    return { pin, record, applied, needsDeviceRegistration: !change.candidate };
  }
  async prepareArchiveCancellation(
    vault: Vault,
    state: VaultLifecycleState,
    record: Json,
    prior?: VaultLifecyclePin,
  ) {
    this.requireOrdinarySession();
    await this.inspectArchiveChange(vault, state, record, prior);
    if (!this.root) throw new VaultError("locked");
    this.vault = vault;
    const original = await verified(record.packet.command, vault.rootJwk);
    if (state.history.some((i) => i.receipt.operationId === record.operationId))
      throw new VaultError("archive_change_unknown");
    if (record.cancellation) exact(record.cancellation, ["retained"]);
    const source = record.cancellation?.retained ?? [];
    if (!Array.isArray(source) || source.length > 16) throw new VaultError("archive_cancel_limit");
    const retained: Json[] = [...source];
    const decoded: Json[] = [];
    for (const item of retained) {
      exact(item, ["operationId", "action", "authorizationId", "command"]);
      bounded(item.command, 8192);
      const p = await verified(item.command, vault.rootJwk);
      exact(p, [
        "profile",
        "contractVersion",
        "action",
        "ownerSubject",
        "vaultId",
        "rootKeyId",
        "stableOperationId",
        "expectedVaultVersion",
        "expectedLifecycleVersion",
        "expectedArchiveRevision",
        "expectedArchiveDigest",
        "registrySequence",
        "checkpointDigest",
        "keyEpoch",
        "issuedAt",
        "expiresAt",
        "authorizationId",
        ...(p.action === "recovery_authorize" ? ["newArchiveDigest"] : []),
      ]);
      for (const field of ["expectedVaultVersion", "registrySequence", "keyEpoch", "expiresAt"])
        positive(p[field]);
      for (const field of ["expectedLifecycleVersion", "expectedArchiveRevision", "issuedAt"])
        positive(p[field], 0);
      validate("OperationIdentifier", p.stableOperationId);
      validate("Identifier", p.authorizationId);
      if (
        p.profile !== "folioview.vault-lifecycle.v1" ||
        p.contractVersion !== CONTRACT ||
        !(p.issuedAt < p.expiresAt && p.expiresAt <= p.issuedAt + 300) ||
        (p.action === "recovery_authorize" &&
          p.newArchiveDigest !== (await sha(canonical(record.packet.archive))))
      )
        throw new VaultError("untrusted_lifecycle");
      if (
        !["recovery_authorize", "recovery_revoke"].includes(p.action) ||
        p.action !== item.action ||
        p.ownerSubject !== (await this.owner) ||
        p.vaultId !== vault.vaultId ||
        p.rootKeyId !== vault.rootKeyId ||
        p.stableOperationId !== item.operationId ||
        p.authorizationId !== item.authorizationId
      )
        throw new VaultError("untrusted_lifecycle");
      decoded.push(p);
    }
    for (const p of decoded) {
      if (
        p.action === "recovery_revoke" &&
        p.authorizationId !== record.packet.authorization?.authorizationId &&
        !decoded.some(
          (a) => a.action === "recovery_authorize" && a.authorizationId === p.authorizationId,
        )
      )
        throw new VaultError("untrusted_lifecycle");
    }
    const matchingPending =
      state.pendingAuthorization &&
      (state.pendingAuthorization.authorizationId ===
        record.packet.authorization?.authorizationId ||
        retained.some(
          (i) =>
            i.action === "recovery_authorize" &&
            i.authorizationId === state.pendingAuthorization!.authorizationId,
        ));
    if (state.lifecycleVersion > original.expectedLifecycleVersion && !matchingPending)
      return { packet: { commands: [] }, record: { ...record, cancellation: { retained } } };
    if (state.pendingAuthorization && !matchingPending)
      throw new VaultError("recovery_authorization_pending");
    const live = (p: Json, version: number) =>
      p.issuedAt <= this.now() &&
      this.now() < p.expiresAt &&
      p.expectedLifecycleVersion === version &&
      p.expectedVaultVersion === state.vaultVersion &&
      p.registrySequence === state.registrySequence &&
      p.checkpointDigest === state.checkpointDigest &&
      p.keyEpoch === state.keyEpoch &&
      p.expectedArchiveRevision === state.archiveRevision &&
      p.expectedArchiveDigest === state.archiveDigest;
    let commands: Json[] = [];
    if (matchingPending) {
      const id = state.pendingAuthorization!.authorizationId;
      const existing = decoded.findIndex(
        (p) =>
          p.action === "recovery_revoke" &&
          p.authorizationId === id &&
          live(p, state.lifecycleVersion),
      );
      if (existing >= 0) commands = [retained[existing]];
      else {
        if (state.lifecycleVersion >= 32) throw new VaultError("archive_cancel_limit");
        const operationId = randomId(),
          command = await sign(
            this.lifecycleCommand(state, "recovery_revoke", operationId, { authorizationId: id }),
            this.root,
            vault.rootKeyId,
          );
        commands = [{ operationId, action: "recovery_revoke", authorizationId: id, command }];
        retained.push(...commands);
      }
    } else if (state.lifecycleVersion <= original.expectedLifecycleVersion) {
      const existing = decoded.findIndex(
        (p) => p.action === "recovery_authorize" && live(p, state.lifecycleVersion),
      );
      if (existing >= 0) {
        const a = retained[existing],
          r = retained.find(
            (i) => i.action === "recovery_revoke" && i.authorizationId === a.authorizationId,
          );
        if (!r) throw new VaultError("untrusted_lifecycle");
        commands = [a, r];
      } else {
        if (state.lifecycleVersion > 30) throw new VaultError("archive_cancel_limit");
        const authorizationId = randomId("cancel_"),
          operationId = randomId(),
          auth = this.lifecycleCommand(state, "recovery_authorize", operationId, {
            authorizationId,
            newArchiveDigest: await sha(canonical(record.packet.archive)),
          });
        const a = {
            operationId,
            action: "recovery_authorize",
            authorizationId,
            command: await sign(auth, this.root, vault.rootKeyId),
          },
          revokeOp = randomId(),
          revoke = this.lifecycleCommand(
            { ...state, lifecycleVersion: state.lifecycleVersion + 1 },
            "recovery_revoke",
            revokeOp,
            { authorizationId },
          );
        revoke.expiresAt = auth.expiresAt;
        commands = [
          a,
          {
            operationId: revokeOp,
            action: "recovery_revoke",
            authorizationId,
            command: await sign(revoke, this.root, vault.rootKeyId),
          },
        ];
        retained.push(...commands);
      }
    }
    if (retained.length > 16) throw new VaultError("archive_cancel_limit");
    return { packet: { commands }, record: { ...record, cancellation: { retained } } };
  }
  async discardArchiveChange(
    vault: Vault,
    state: VaultLifecycleState,
    record: Json,
    operationId: string,
    prior?: VaultLifecyclePin,
  ) {
    this.requireOrdinarySession();
    await this.inspectArchiveChange(vault, state, record, prior);
    if (
      record.operationId !== operationId ||
      state.history.some((i) => i.receipt.operationId === operationId)
    )
      throw new VaultError("archive_change_unknown");
    const p = await verified(record.packet.command, vault.rootJwk);
    if (
      state.lifecycleVersion <= p.expectedLifecycleVersion ||
      (state.pendingAuthorization &&
        state.pendingAuthorization.authorizationId === p.authorizationId)
    )
      throw new VaultError("archive_change_unknown");
    this.archiveChange = undefined;
    return { pin: this.lifecyclePin };
  }
  async revokeRecoveryAuthorization(
    vault: Vault,
    state: VaultLifecycleState,
    prior?: VaultLifecyclePin,
  ) {
    this.requireOrdinarySession();
    if (!this.root) throw new VaultError("locked");
    await this.verifyLifecycle(vault, state, prior);
    await this.checkVault(vault, this.pin);
    if (!state.pendingAuthorization) throw new VaultError("invalid_operation");
    const operationId = randomId(),
      authorizationId = state.pendingAuthorization.authorizationId;
    const command = await sign(
      this.lifecycleCommand(state, "recovery_revoke", operationId, { authorizationId }),
      this.root,
      vault.rootKeyId,
    );
    return { operationId, authorizationId, command };
  }

  async beginCreate(material: PasskeyMaterial) {
    this.requireOrdinarySession();
    const owner = await this.owner;
    const vaultId = randomId("vault_");
    const root = await makeKey(true),
      recovery = await makeKey();
    this.wrapping = await aesMaterial(material);
    this.root = await key(root.privateJwk, true, true);
    this.recovery = await key(recovery.privateJwk, false, true);
    this.recoveryJwk = recovery.publicJwk;
    const archive = (await seal(
      this.wrapping,
      {
        profile: "folioview.passkey-vault.v1",
        ownerSubject: owner,
        vaultId,
        rootKeyId: root.keyId,
        credentialId: material.credentialId,
        prfSalt: material.prfSalt,
      },
      {
        ownerSubject: owner,
        vaultId,
        rootKeyId: root.keyId,
        rootPrivateJwk: root.privateJwk,
        recoveryPrivateJwk: recovery.privateJwk,
      },
    )) as Archive;
    const partial = {
      vaultId,
      rootJwk: root.publicJwk,
      rootKeyId: root.keyId,
      registryHistory: [],
      archive,
      version: 1,
    };
    this.vault = partial;
    await this.newDevice();
    const entries = [];
    for (const [role, jwk, principal] of [
      ["device_sig", this.device!.sigJwk, this.device!.deviceId],
      ["device_enc", this.device!.encJwk, this.device!.deviceId],
      ["recovery_enc", recovery.publicJwk, "recovery_" + recovery.keyId.slice(0, 24)],
    ] as [string, Json, string][])
      entries.push({ certificate: await this.certificate(role, jwk, principal), active: true });
    const bundle = await this.bundle(entries);
    this.registry = await verifyRegistry(
      bundle,
      partial.rootJwk,
      owner,
      vaultId,
      undefined,
      this.now(),
    );
    const operation = {
      operationId: randomId(),
      vaultId,
      rootJwk: partial.rootJwk,
      rootKeyId: partial.rootKeyId,
      registryBundle: bundle,
      archive,
    };
    return {
      ...operation,
      localPending: await this.stageDevice("bootstrap", operation, null),
      previousPending: null,
    };
  }
  private async stageDevice(kind: string, operation: Json, baseDigest: string | null) {
    if (!this.wrapping || !this.vault || !this.deviceSeal) throw new VaultError("locked");
    const value = { device: this.deviceSeal, operation, baseDigest };
    bounded(value, 196608);
    this.pendingEnvelope = await seal(
      this.wrapping,
      {
        profile: "folioview.pending-device.v1",
        ownerSubject: await this.owner,
        vaultId: this.vault.vaultId,
        rootKeyId: this.vault.rootKeyId,
        credentialId: this.vault.archive.credentialId,
        prfSalt: this.vault.archive.prfSalt,
        kind,
      },
      value,
    );
    this.pendingDevice = { kind, operation, baseDigest };
    return this.pendingEnvelope;
  }
  private async readDevice(d: DeviceSeal) {
    if (!this.vault || !this.wrapping) throw new VaultError("locked");
    const vault = this.vault;
    if (
      d.profile !== "folioview.device-keystore.v1" ||
      d.ownerSubject !== (await this.owner) ||
      d.vaultId !== vault.vaultId ||
      d.rootKeyId !== vault.rootKeyId ||
      d.credentialId !== vault.archive.credentialId ||
      d.prfSalt !== vault.archive.prfSalt
    )
      throw new VaultError("wrong_account");
    const m = await open(this.wrapping, d);
    exact(m, ["deviceId", "signingPrivateJwk", "encryptionPrivateJwk"]);
    if (
      m.deviceId !== d.deviceId ||
      (await thumb(m.signingPrivateJwk)) !== d.signingKeyId ||
      (await thumb(m.encryptionPrivateJwk)) !== d.encryptionKeyId
    )
      throw new VaultError("invalid_data");
    return {
      deviceId: m.deviceId,
      sig: await key(m.signingPrivateJwk, true, true),
      enc: await key(m.encryptionPrivateJwk, false, true),
      sigJwk: pub(m.signingPrivateJwk),
      encJwk: pub(m.encryptionPrivateJwk),
      sigId: d.signingKeyId,
      encId: d.encryptionKeyId,
    };
  }
  private async loadDevice(d: DeviceSeal) {
    this.device = await this.readDevice(d);
    this.deviceSeal = d;
  }

  private async makeDevice() {
    if (!this.vault || !this.wrapping) throw new VaultError("locked");
    const sig = await makeKey(true),
      enc = await makeKey();
    const deviceId = randomId("device_");
    const device = {
      deviceId,
      sig: await key(sig.privateJwk, true, true),
      enc: await key(enc.privateJwk, false, true),
      sigJwk: sig.publicJwk,
      encJwk: enc.publicJwk,
      sigId: sig.keyId,
      encId: enc.keyId,
    };
    const deviceSeal = await seal(
      this.wrapping,
      {
        profile: "folioview.device-keystore.v1",
        ownerSubject: await this.owner,
        vaultId: this.vault.vaultId,
        rootKeyId: this.vault.rootKeyId,
        credentialId: this.vault.archive.credentialId,
        prfSalt: this.vault.archive.prfSalt,
        deviceId,
        signingKeyId: sig.keyId,
        encryptionKeyId: enc.keyId,
      },
      { deviceId, signingPrivateJwk: sig.privateJwk, encryptionPrivateJwk: enc.privateJwk },
    );
    return { device, deviceSeal };
  }
  private async newDevice() {
    const next = await this.makeDevice();
    this.device = next.device;
    this.deviceSeal = next.deviceSeal;
  }
  private async certificate(role: string, jwk: Json, principalId: string) {
    if (!this.vault || !this.root) throw new VaultError("locked");
    const c = {
      artifactType: "key_certificate",
      contractVersion: CONTRACT,
      vaultId: this.vault.vaultId,
      ownerSubject: await this.owner,
      certificateId: randomId("cert_"),
      keyId: await thumb(jwk),
      role,
      publicJwk: jwk,
      principalId,
      connectionId: null,
      keyEpoch: 1,
      issuerKeyId: this.vault.rootKeyId,
      notBefore: Math.max(0, this.now() - 5),
      expiresAt: this.now() + 31536000,
      capabilities: CAP[role],
    };
    validate("KeyCertificatePayload", c);
    return sign(c, this.root, this.vault.rootKeyId);
  }
  private async bundle(
    entries: { certificate: Signed; active: boolean }[],
    previous?: Registry,
  ): Promise<RegistryBundle> {
    if (!this.vault || !this.root) throw new VaultError("locked");
    const descriptions = [];
    for (const e of entries) {
      const c = await verified(e.certificate, this.vault.rootJwk);
      descriptions.push({
        certificateId: c.certificateId,
        payloadDigest: await sha(canonical(c)),
        active: e.active,
      });
    }
    const checkpoint = {
      artifactType: "registry_checkpoint",
      contractVersion: CONTRACT,
      vaultId: this.vault.vaultId,
      ownerSubject: await this.owner,
      rootKeyId: this.vault.rootKeyId,
      rootEpoch: 1,
      registrySequence: (previous?.checkpoint.registrySequence ?? 0) + 1,
      previousDigest: previous?.digest ?? null,
      entriesDigest: await sha(
        canonical(descriptions.sort((a, b) => (a.certificateId < b.certificateId ? -1 : 1))),
      ),
      keyEpoch: previous?.checkpoint.keyEpoch ?? 1,
      revokedKeyIds: previous?.checkpoint.revokedKeyIds ?? [],
      issuedAt: this.now(),
    };
    return {
      contractVersion: CONTRACT,
      checkpoint: await sign(checkpoint, this.root, this.vault.rootKeyId),
      entries,
    };
  }
  private async checkVault(vault: Vault, pin?: Pin) {
    exact(vault, ["vaultId", "rootJwk", "rootKeyId", "registryHistory", "archive", "version"]);
    positive(vault.version);
    validate("PublicJWK", vault.rootJwk);
    const owner = await this.owner;
    checkArchive(vault.archive, owner);
    if (
      vault.archive.vaultId !== vault.vaultId ||
      vault.archive.rootKeyId !== vault.rootKeyId ||
      (await thumb(vault.rootJwk)) !== vault.rootKeyId ||
      !Array.isArray(vault.registryHistory) ||
      vault.registryHistory.length < 1 ||
      vault.registryHistory.length > 32
    )
      throw new VaultError("untrusted_vault");
    if (
      this.vault &&
      (this.vault.vaultId !== vault.vaultId ||
        this.vault.rootKeyId !== vault.rootKeyId ||
        !equal(this.vault.archive, vault.archive))
    )
      throw new VaultError("untrusted_vault");
    let registry: Registry | undefined;
    for (const bundle of vault.registryHistory)
      registry = await verifyRegistry(
        bundle,
        vault.rootJwk,
        owner,
        vault.vaultId,
        registry,
        this.now(),
      );
    if (
      pin &&
      (pin.ownerSubject !== owner ||
        pin.vaultId !== vault.vaultId ||
        pin.rootKeyId !== vault.rootKeyId ||
        registry!.checkpoint.registrySequence < pin.registrySequence ||
        registry!.checkpoint.keyEpoch < pin.keyEpoch ||
        !vault.registryHistory.some((b) => {
          const cp = parsed(unb64(b.checkpoint.payload));
          return cp.registrySequence === pin.registrySequence;
        }))
    )
      throw new VaultError("rollback_detected");
    if (pin) {
      const matched = vault.registryHistory.find(
        (b) => parsed(unb64(b.checkpoint.payload)).registrySequence === pin.registrySequence,
      )!;
      if (
        (await sha(canonical(parsed(unb64(matched.checkpoint.payload))))) !== pin.checkpointDigest
      )
        throw new VaultError("registry_conflict");
    }
    return registry!;
  }
  async unlock(
    vault: Vault,
    material: PasskeyMaterial,
    local?: { pin?: Pin; device?: DeviceSeal; pending?: Json; deviceChange?: Json },
  ) {
    const owner = await this.owner;
    checkArchive(vault.archive, owner);
    if (
      material.credentialId !== vault.archive.credentialId ||
      material.prfSalt !== vault.archive.prfSalt
    )
      throw new VaultError("unlock_failed");
    this.wrapping = await aesMaterial(material);
    const master = await open(this.wrapping, vault.archive);
    await this.installMaster(master, vault);
    this.registry = await this.checkVault(vault, local?.pin);
    this.vault = vault;
    this.pin = local?.pin;
    const recovery = cert(
      this.registry,
      await thumb(this.recoveryJwk!),
      "recovery_enc",
      this.now(),
    );
    if (recovery.role !== "recovery_enc") throw new VaultError("untrusted_vault");
    if (local?.deviceChange) {
      if (local.pending) throw new VaultError("pending_registration");
      const change = await this.readDeviceChange(local.deviceChange, vault, this.registry);
      this.deviceChange = change;
      if (this.deviceChangeState(change, vault, this.registry) === "applied" && change.candidate) {
        await this.loadDevice(change.candidate);
        cert(this.registry, this.device!.sigId, "device_sig", this.now());
        cert(this.registry, this.device!.encId, "device_enc", this.now());
        return { needsDeviceRegistration: false };
      }
    }
    if (local?.pending) return this.restorePendingDevice(vault, local.pending);
    if (local?.device) {
      await this.loadDevice(local.device);
      cert(this.registry, this.device!.sigId, "device_sig", this.now());
      cert(this.registry, this.device!.encId, "device_enc", this.now());
      return { needsDeviceRegistration: false };
    }
    return { needsDeviceRegistration: true };
  }

  private async restorePendingDevice(vault: Vault, e: Json) {
    if (!this.registry || !this.wrapping) throw new VaultError("locked");
    const owner = await this.owner,
      registry = this.registry;
    exact(e, [
      "profile",
      "ownerSubject",
      "vaultId",
      "rootKeyId",
      "credentialId",
      "prfSalt",
      "kind",
      "iv",
      "ciphertext",
    ]);
    if (
      e.profile !== "folioview.pending-device.v1" ||
      e.ownerSubject !== owner ||
      e.vaultId !== vault.vaultId ||
      e.rootKeyId !== vault.rootKeyId ||
      e.credentialId !== vault.archive.credentialId ||
      e.prfSalt !== vault.archive.prfSalt ||
      !["bootstrap", "registration"].includes(e.kind)
    )
      throw new VaultError("wrong_account");
    const value = await open(this.wrapping, e, 262144);
    exact(value, ["device", "operation", "baseDigest"]);
    await this.loadDevice(value.device);
    const pendingRegistry = await verifyRegistry(
      value.operation.registryBundle,
      vault.rootJwk,
      owner,
      vault.vaultId,
      undefined,
      this.now(),
    );
    cert(pendingRegistry, this.device!.sigId, "device_sig", this.now());
    cert(pendingRegistry, this.device!.encId, "device_enc", this.now());
    if (
      e.kind === "bootstrap" &&
      (!equal(value.operation.archive, vault.archive) ||
        value.operation.rootKeyId !== vault.rootKeyId ||
        value.operation.vaultId !== vault.vaultId)
    )
      throw new VaultError("untrusted_vault");
    if (e.kind === "registration" && pendingRegistry.checkpoint.previousDigest !== value.baseDigest)
      throw new VaultError("registry_conflict");
    this.pendingEnvelope = e;
    this.pendingDevice = {
      kind: e.kind,
      operation: value.operation,
      baseDigest: value.baseDigest,
    };
    const sig = registry.certificates.has(this.device!.sigId),
      enc = registry.certificates.has(this.device!.encId);
    if (sig && enc) {
      cert(registry, this.device!.sigId, "device_sig", this.now());
      cert(registry, this.device!.encId, "device_enc", this.now());
      return { needsDeviceRegistration: false };
    }
    const everSeen = vault.registryHistory.some((b) =>
      b.entries.some((entry) =>
        [this.device!.sigId, this.device!.encId].includes(
          parsed(unb64(entry.certificate.payload)).keyId,
        ),
      ),
    );
    if (
      sig ||
      enc ||
      e.kind === "bootstrap" ||
      everSeen ||
      registry.checkpoint.revokedKeyIds.some((id: string) =>
        [this.device!.sigId, this.device!.encId].includes(id),
      )
    )
      throw new VaultError("key_revoked");
    return { needsDeviceRegistration: true };
  }

  async prepareDeviceRegistration(vault: Vault, options?: { replaceInactive?: boolean }) {
    this.requireOrdinarySession();
    if (options !== undefined) {
      exact(options, options.replaceInactive === undefined ? [] : ["replaceInactive"]);
      if (options.replaceInactive !== undefined && typeof options.replaceInactive !== "boolean")
        throw new VaultError("invalid_data");
    }
    if (!this.wrapping || !this.root || !this.vault) throw new VaultError("locked");
    if (this.deviceChange) throw new VaultError("device_change_pending");
    this.registry = await this.checkVault(vault, this.pin);
    this.vault = vault;
    if (
      vault.registryHistory.length >= 32 ||
      [...this.registry.active].filter((k) =>
        ["device_enc", "recovery_enc"].includes(this.registry!.certificates.get(k)!.role),
      ).length >= 8
    )
      throw new VaultError("device_limit");
    if (
      this.pendingDevice?.kind === "registration" &&
      this.pendingDevice.operation.expectedVersion === vault.version &&
      this.pendingDevice.baseDigest === this.registry.digest
    )
      return {
        ...this.pendingDevice.operation,
        localPending: this.pendingEnvelope,
        previousPending: this.pendingEnvelope,
      };
    if (this.device) {
      let eligible = true;
      try {
        const author = cert(this.registry, this.device.sigId, "device_sig", this.now());
        cert(this.registry, this.device.encId, "device_enc", this.now());
        eligible =
          author.capabilities.includes("object_write") &&
          author.capabilities.includes("control_write");
      } catch {
        eligible = false;
      }
      if (eligible) throw new VaultError("device_unavailable");
      const known = vault.registryHistory.some((b) =>
        b.entries.some((e) =>
          [this.device!.sigId, this.device!.encId].includes(
            parsed(unb64(e.certificate.payload)).keyId,
          ),
        ),
      );
      if (!eligible && !(this.pendingDevice?.kind === "registration" && !known)) {
        if (options?.replaceInactive !== true) throw new VaultError("key_revoked");
        if (
          this.pendingDevice &&
          !vault.registryHistory.some((b) => equal(b, this.pendingDevice!.operation.registryBundle))
        )
          throw new VaultError("pending_registration");
        // An explicit owner confirmation creates a different identity; it never
        // reactivates the revoked key, old certificate or prior agent grant.
        this.device = undefined;
        this.deviceSeal = undefined;
        this.pendingDevice = undefined;
        this.pendingEnvelope = undefined;
      }
    }
    if (!this.device) await this.newDevice();
    const previousPending = this.pendingEnvelope ?? null;
    const cached =
      this.pendingDevice?.kind === "registration"
        ? this.pendingDevice.operation.registryBundle.entries
        : [];
    const pendingCert = async (role: string, id: string, jwk: Json) =>
      cached.find((entry: Json) => parsed(unb64(entry.certificate.payload)).keyId === id) ?? {
        certificate: await this.certificate(role, jwk, this.device!.deviceId),
        active: true,
      };
    const entries = [
      ...this.registry.bundle.entries,
      await pendingCert("device_sig", this.device!.sigId, this.device!.sigJwk),
      await pendingCert("device_enc", this.device!.encId, this.device!.encJwk),
    ];
    if (entries.length > 64) throw new VaultError("device_limit");
    const operation = {
      operationId: randomId(),
      expectedVersion: vault.version,
      registryBundle: await this.bundle(entries, this.registry),
    };
    return {
      ...operation,
      localPending: await this.stageDevice("registration", operation, this.registry.digest),
      previousPending,
    };
  }

  async acceptVault(vault: Vault) {
    this.requireOrdinarySession();
    const registry = await this.checkVault(vault, this.pin);
    if (!this.device || !this.deviceSeal) throw new VaultError("device_required");
    cert(registry, this.device.sigId, "device_sig", this.now());
    cert(registry, this.device.encId, "device_enc", this.now());
    return this.adoptVault(vault, registry);
  }
  /** Owner history is authenticated at acceptance time, not a new key-authorized write. */
  async acceptResultVault(vault: Vault) {
    this.requireOrdinarySession();
    if (!this.root || !this.recovery || !this.recoveryJwk) throw new VaultError("locked");
    const record = await this.adoptVault(vault, await this.checkVault(vault, this.pin));
    return { ...record, canWriteState: this.resultStateAvailable() };
  }
  async unlockForResults(
    vault: Vault,
    material: PasskeyMaterial,
    local?: { pin?: Pin; device?: DeviceSeal; pending?: Json; deviceChange?: Json },
  ) {
    const owner = await this.owner;
    checkArchive(vault.archive, owner);
    if (
      material.credentialId !== vault.archive.credentialId ||
      material.prfSalt !== vault.archive.prfSalt
    )
      throw new VaultError("unlock_failed");
    this.wrapping = await aesMaterial(material);
    const master = await open(this.wrapping, vault.archive);
    await this.installMaster(master, vault);
    this.registry = await this.checkVault(vault, local?.pin ?? this.pin);
    this.vault = vault;
    this.pin = local?.pin ?? this.pin;
    this.device = undefined;
    this.deviceSeal = undefined;
    if (local?.pending) {
      if (local.deviceChange) throw new VaultError("pending_registration");
      try {
        await this.restorePendingDevice(vault, local.pending);
      } catch (error) {
        if (!(error instanceof VaultError) || error.code !== "key_revoked") throw error;
        // Read-only recovery does not grant the retained revoked device rights.
      }
    } else if (local?.deviceChange) {
      const change = await this.readDeviceChange(local.deviceChange, vault, this.registry);
      this.deviceChange = change;
      if (this.deviceChangeState(change, vault, this.registry) === "applied" && change.candidate) {
        const next = await this.readDevice(change.candidate);
        try {
          cert(this.registry, next.sigId, "device_sig", this.now());
          cert(this.registry, next.encId, "device_enc", this.now());
          this.device = next;
          this.deviceSeal = change.candidate;
        } catch {
          // A later revocation cannot be revived by a retained candidate.
          if (local.device) await this.loadDevice(local.device);
        }
      } else if (local?.device) await this.loadDevice(local.device);
    } else if (local?.device) await this.loadDevice(local.device);
    return { canWriteState: this.resultStateAvailable() };
  }
  private deviceChangeState(
    change: NonNullable<VaultCore["deviceChange"]>,
    vault: Vault,
    registry: Registry,
  ): DeviceChangeSummary["state"] {
    if (vault.registryHistory.some((b) => equal(b, change.packet.registryBundle))) return "applied";
    return vault.version === change.packet.expectedVersion && registry.digest === change.baseDigest
      ? "ready"
      : "conflict";
  }
  private deviceRows(registry: Registry): VaultDevice[] {
    const groups = new Map<string, { sig?: Json; enc?: Json }>();
    for (const c of registry.certificates.values()) {
      if (c.connectionId !== null || !["device_sig", "device_enc"].includes(c.role)) continue;
      const group = groups.get(c.principalId) ?? {};
      const role = c.role === "device_sig" ? "sig" : "enc";
      if (!group[role] || group[role]!.keyEpoch < c.keyEpoch) group[role] = c;
      groups.set(c.principalId, group);
    }
    return [...groups]
      .map(([deviceId, group]) => {
        if (!group.sig || !group.enc) throw new VaultError("invalid_registry");
        let active = true;
        try {
          cert(registry, group.sig.keyId, "device_sig", this.now());
          cert(registry, group.enc.keyId, "device_enc", this.now());
        } catch {
          active = false;
        }
        return {
          deviceId,
          signingKeyId: group.sig.keyId,
          encryptionKeyId: group.enc.keyId,
          current: this.device?.deviceId === deviceId,
          active,
          notBefore: Math.max(group.sig.notBefore, group.enc.notBefore),
          expiresAt: Math.min(group.sig.expiresAt, group.enc.expiresAt),
        };
      })
      .sort((a, b) => a.deviceId.localeCompare(b.deviceId));
  }
  private async managementSummary(
    vault: Vault,
    registry: Registry,
  ): Promise<VaultManagementSummary> {
    let canManage = Boolean(this.root && this.wrapping && this.device);
    try {
      if (!this.device) throw new VaultError("device_required");
      const signer = cert(registry, this.device.sigId, "device_sig", this.now());
      cert(registry, this.device.encId, "device_enc", this.now());
      canManage &&=
        signer.capabilities.includes("object_write") &&
        signer.capabilities.includes("control_write");
    } catch {
      canManage = false;
    }
    const recoveryId = this.recoveryJwk ? await thumb(this.recoveryJwk!) : null;
    const recoveryCert = recoveryId ? registry.certificates.get(recoveryId) : undefined;
    let recovery: VaultManagementSummary["recovery"] = null;
    if (recoveryCert?.role === "recovery_enc" && recoveryCert.connectionId === null) {
      let active = true;
      try {
        cert(registry, recoveryCert.keyId, "recovery_enc", this.now());
      } catch {
        active = false;
      }
      recovery = {
        keyId: recoveryCert.keyId,
        notBefore: recoveryCert.notBefore,
        expiresAt: recoveryCert.expiresAt,
        active,
      };
    }
    const change = this.deviceChange;
    return {
      vaultId: vault.vaultId,
      rootKeyId: vault.rootKeyId,
      registrySequence: registry.checkpoint.registrySequence,
      checkpointDigest: registry.digest,
      keyEpoch: registry.checkpoint.keyEpoch,
      currentDeviceId: this.device?.deviceId ?? null,
      canManage,
      devices: this.deviceRows(registry),
      recovery,
      pendingChange: change
        ? {
            operationId: change.packet.operationId,
            action: change.packet.action,
            deviceId: change.packet.deviceId,
            newDeviceId: change.packet.newDeviceId,
            state: this.deviceChangeState(change, vault, registry),
          }
        : null,
    };
  }
  private async readDeviceChange(record: Json, vault: Vault, registry: Registry) {
    if (!this.wrapping || !this.root) throw new VaultError("locked");
    bounded(record, 393216);
    exact(record, [
      "profile",
      "ownerSubject",
      "vaultId",
      "rootKeyId",
      "credentialId",
      "prfSalt",
      "iv",
      "ciphertext",
    ]);
    if (
      record.profile !== "folioview.device-change-outbox.v1" ||
      record.ownerSubject !== (await this.owner) ||
      record.vaultId !== vault.vaultId ||
      record.rootKeyId !== vault.rootKeyId ||
      record.credentialId !== vault.archive.credentialId ||
      record.prfSalt !== vault.archive.prfSalt
    )
      throw new VaultError("wrong_account");
    const value = await open(this.wrapping, record, 262144);
    exact(value, ["packet", "candidate", "baseDigest"]);
    const packet = value.packet as DeviceChangePacket;
    exact(packet, [
      "operationId",
      "expectedVersion",
      "registryBundle",
      "action",
      "deviceId",
      "replacedKeyIds",
      "newDeviceId",
      "newKeyIds",
    ]);
    validate("OperationIdentifier", packet.operationId);
    validate("Identifier", packet.deviceId);
    validate("Digest", value.baseDigest);
    positive(packet.expectedVersion);
    if (
      !["revoke", "rotate"].includes(packet.action) ||
      !Array.isArray(packet.replacedKeyIds) ||
      packet.replacedKeyIds.length !== 2 ||
      !equal(packet.replacedKeyIds, [...new Set(packet.replacedKeyIds)].sort()) ||
      !Array.isArray(packet.newKeyIds) ||
      !equal(packet.newKeyIds, [...new Set(packet.newKeyIds)].sort())
    )
      throw new VaultError("invalid_data");
    packet.replacedKeyIds.forEach((id) => validate("KeyId", id));
    packet.newKeyIds.forEach((id) => validate("KeyId", id));
    let base: Registry | undefined;
    for (const bundle of vault.registryHistory) {
      base = await verifyRegistry(
        bundle,
        vault.rootJwk,
        await this.owner,
        vault.vaultId,
        base,
        this.now(),
      );
      if (base.digest === value.baseDigest) break;
    }
    if (!base || base.digest !== value.baseDigest) throw new VaultError("registry_conflict");
    const next = await verifyRegistry(
      packet.registryBundle,
      vault.rootJwk,
      await this.owner,
      vault.vaultId,
      base,
      this.now(),
    );
    if (
      next.checkpoint.registrySequence !== base.checkpoint.registrySequence + 1 ||
      next.checkpoint.keyEpoch !== base.checkpoint.keyEpoch
    )
      throw new VaultError("registry_conflict");
    const target = this.deviceRows(base).find((d) => d.deviceId === packet.deviceId);
    if (
      !target ||
      !equal(packet.replacedKeyIds, [target.signingKeyId, target.encryptionKeyId].sort())
    )
      throw new VaultError("binding_mismatch");
    const added = next.bundle.entries.filter(
      (e) => !base!.certificates.has(parsed(unb64(e.certificate.payload)).keyId),
    );
    if (packet.action === "revoke") {
      if (
        packet.newDeviceId !== null ||
        packet.newKeyIds.length ||
        value.candidate !== null ||
        added.length
      )
        throw new VaultError("binding_mismatch");
    } else {
      validate("Identifier", packet.newDeviceId);
      if (
        packet.newDeviceId === packet.deviceId ||
        packet.newKeyIds.length !== 2 ||
        added.length !== 2 ||
        !value.candidate
      )
        throw new VaultError("binding_mismatch");
      const candidate = await this.readDevice(value.candidate);
      if (
        candidate.deviceId !== packet.newDeviceId ||
        !equal([candidate.sigId, candidate.encId].sort(), packet.newKeyIds)
      )
        throw new VaultError("binding_mismatch");
      for (const [id, role] of [
        [candidate.sigId, "device_sig"],
        [candidate.encId, "device_enc"],
      ]) {
        const c = next.certificates.get(id);
        if (
          !c ||
          c.principalId !== candidate.deviceId ||
          c.role !== role ||
          c.connectionId !== null ||
          !next.active.has(id)
        )
          throw new VaultError("binding_mismatch");
      }
    }
    const expectedEntries = [
      ...base.bundle.entries.map((e) => ({
        ...e,
        active: packet.replacedKeyIds.includes(parsed(unb64(e.certificate.payload)).keyId)
          ? false
          : e.active,
      })),
      ...added,
    ];
    if (
      !equal(next.bundle.entries, expectedEntries) ||
      !equal(
        next.checkpoint.revokedKeyIds,
        [...new Set([...base.checkpoint.revokedKeyIds, ...packet.replacedKeyIds])].sort(),
      )
    )
      throw new VaultError("binding_mismatch");
    return {
      packet,
      candidate: value.candidate as DeviceSeal | null,
      baseDigest: value.baseDigest as string,
      record,
    };
  }
  async deviceManagement(vault: Vault, record?: Json) {
    if (!this.root || !this.wrapping) throw new VaultError("locked");
    const registry = await this.checkVault(vault, this.pin);
    this.vault = vault;
    this.deviceChange = record ? await this.readDeviceChange(record, vault, registry) : undefined;
    const accepted = await this.adoptVault(vault, registry);
    return { summary: await this.managementSummary(vault, registry), record: accepted };
  }
  async prepareDeviceChange(args: { vault: Vault; action: "revoke" | "rotate"; deviceId: string }) {
    exact(args, ["vault", "action", "deviceId"]);
    validate("Identifier", args.deviceId);
    this.requireOrdinarySession();
    if (!["revoke", "rotate"].includes(args.action)) throw new VaultError("invalid_data");
    const registry = await this.checkVault(args.vault, this.pin);
    this.vault = args.vault;
    this.registry = registry;
    const { device, vault } = this.ready();
    const author = cert(registry, device.sigId, "device_sig", this.now());
    cert(registry, device.encId, "device_enc", this.now());
    if (
      !author.capabilities.includes("object_write") ||
      !author.capabilities.includes("control_write")
    )
      throw new VaultError("key_revoked");
    if (this.deviceChange) throw new VaultError("device_change_pending");
    const target = this.deviceRows(registry).find((d) => d.deviceId === args.deviceId);
    if (!target?.active || (args.action === "rotate") !== (args.deviceId === device.deviceId))
      throw new VaultError("device_unavailable");
    if (
      vault.registryHistory.length >= 32 ||
      registry.bundle.entries.length + (args.action === "rotate" ? 2 : 0) > 64 ||
      registry.checkpoint.revokedKeyIds.length + 2 > 64
    )
      throw new VaultError("device_limit");
    const replacedKeyIds = [target.signingKeyId, target.encryptionKeyId].sort();
    const entries = registry.bundle.entries.map((e) => ({
      ...e,
      active: replacedKeyIds.includes(parsed(unb64(e.certificate.payload)).keyId)
        ? false
        : e.active,
    }));
    let candidate: DeviceSeal | null = null,
      newDeviceId: string | null = null;
    const newKeyIds: string[] = [];
    if (args.action === "rotate") {
      const next = await this.makeDevice();
      candidate = next.deviceSeal;
      newDeviceId = next.device.deviceId;
      for (const [role, jwk] of [
        ["device_sig", next.device.sigJwk],
        ["device_enc", next.device.encJwk],
      ] as [string, Json][]) {
        const certificate = await this.certificate(role, jwk, newDeviceId);
        entries.push({ certificate, active: true });
        newKeyIds.push(parsed(unb64(certificate.payload)).keyId);
      }
      newKeyIds.sort();
    }
    const bundle = await this.bundle(entries, registry),
      checkpoint = parsed(unb64(bundle.checkpoint.payload));
    checkpoint.revokedKeyIds = [
      ...new Set([...checkpoint.revokedKeyIds, ...replacedKeyIds]),
    ].sort();
    bundle.checkpoint = await sign(checkpoint, this.root!, vault.rootKeyId);
    const next = await verifyRegistry(
      bundle,
      vault.rootJwk,
      await this.owner,
      vault.vaultId,
      registry,
      this.now(),
    );
    const active = [...next.active]
      .map((id) => {
        try {
          return cert(next, id, undefined, this.now());
        } catch {
          return null;
        }
      })
      .filter(Boolean) as Json[];
    const writers = active.filter(
      (c) => c.role === "device_sig" && c.capabilities.includes("object_write"),
    );
    const recipients = active.filter((c) => ["device_enc", "recovery_enc"].includes(c.role));
    if (
      !writers.length ||
      writers.length > 8 ||
      recipients.length < 2 ||
      recipients.length > 8 ||
      !recipients.some((c) => c.role === "device_enc") ||
      !recipients.some((c) => c.role === "recovery_enc")
    )
      throw new VaultError("device_limit");
    const packet = parsed(
      utf8.encode(
        canonical({
          operationId: randomId(),
          expectedVersion: vault.version,
          registryBundle: bundle,
          action: args.action,
          deviceId: args.deviceId,
          replacedKeyIds,
          newDeviceId,
          newKeyIds,
        }),
      ),
    ) as DeviceChangePacket;
    const value = { packet, candidate, baseDigest: registry.digest };
    bounded(value, 196608);
    const record = await seal(
      this.wrapping!,
      {
        profile: "folioview.device-change-outbox.v1",
        ownerSubject: await this.owner,
        vaultId: vault.vaultId,
        rootKeyId: vault.rootKeyId,
        credentialId: vault.archive.credentialId,
        prfSalt: vault.archive.prfSalt,
      },
      value,
    );
    this.deviceChange = { ...value, record };
    return { ...packet, localPending: record };
  }
  async loadDeviceChange(vault: Vault, record: Json) {
    this.requireOrdinarySession();
    const registry = await this.checkVault(vault, this.pin);
    this.vault = vault;
    const change = await this.readDeviceChange(record, vault, registry);
    this.deviceChange = change;
    return change.packet;
  }
  async acceptDeviceChange(vault: Vault, record: Json) {
    this.requireOrdinarySession();
    const registry = await this.checkVault(vault, this.pin);
    this.vault = vault;
    const change = await this.readDeviceChange(record, vault, registry);
    if (this.deviceChangeState(change, vault, registry) !== "applied")
      throw new VaultError("device_change_conflict");
    if (change.candidate) {
      const candidate = await this.readDevice(change.candidate);
      // A later directory may already revoke/expire the accepted candidate.
      // Keeping its sealed local identity completes acknowledgement, not a
      // registration or permission grant; ready()/state signing still reject it.
      this.device = candidate;
      this.deviceSeal = change.candidate;
    }
    const accepted = await this.adoptVault(vault, registry);
    // An already-applied candidate may now be inactive. Explicitly completing
    // acknowledgement persists that identity without granting it permissions.
    if (change.candidate) {
      accepted.device = change.candidate;
      accepted.deviceReplacementKeyIds = change.packet.replacedKeyIds;
    }
    this.deviceChange = undefined;
    return {
      summary: await this.managementSummary(vault, registry),
      record: accepted,
      operationId: change.packet.operationId,
    };
  }
  async discardDeviceChange(vault: Vault, record: Json, operationId: string) {
    this.requireOrdinarySession();
    const registry = await this.checkVault(vault, this.pin);
    this.vault = vault;
    const change = await this.readDeviceChange(record, vault, registry);
    // An equal-version read cannot prove a timed-out POST will never commit.
    if (
      change.packet.operationId !== operationId ||
      this.deviceChangeState(change, vault, registry) !== "conflict" ||
      vault.version <= change.packet.expectedVersion
    )
      throw new VaultError("device_change_pending");
    this.deviceChange = undefined;
    return { operationId };
  }
  async verifyRecovery(vault: Vault): Promise<RecoveryVerification> {
    this.requireOrdinarySession();
    if (!this.root || !this.recovery || !this.recoveryJwk) throw new VaultError("locked");
    const registry = await this.checkVault(vault, this.pin),
      recoveryKeyId = await thumb(this.recoveryJwk!);
    cert(registry, recoveryKeyId, "recovery_enc", this.now());
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    let left: Uint8Array | undefined, right: Uint8Array | undefined;
    try {
      const signature = await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        this.root,
        challenge,
      );
      if (
        !(await crypto.subtle.verify(
          { name: "ECDSA", hash: "SHA-256" },
          await key(vault.rootJwk, true),
          signature,
          challenge,
        ))
      )
        throw new VaultError("untrusted_vault");
      const ephemeral = await crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" },
        false,
        ["deriveBits"],
      );
      left = new Uint8Array(
        await crypto.subtle.deriveBits(
          { name: "ECDH", public: await key(this.recoveryJwk) },
          ephemeral.privateKey,
          256,
        ),
      );
      right = new Uint8Array(
        await crypto.subtle.deriveBits(
          { name: "ECDH", public: ephemeral.publicKey },
          this.recovery,
          256,
        ),
      );
      if (!equal([...left], [...right])) throw new VaultError("untrusted_vault");
      return {
        vaultId: vault.vaultId,
        rootKeyId: vault.rootKeyId,
        recoveryKeyId,
        registrySequence: registry.checkpoint.registrySequence,
        checkpointDigest: registry.digest,
        verifiedAt: this.now(),
      };
    } finally {
      challenge.fill(0);
      left?.fill(0);
      right?.fill(0);
    }
  }
  private resultStateAvailable() {
    if (this.renewalOnly || !this.registry || !this.device) return false;
    try {
      return cert(this.registry, this.device.sigId, "device_sig", this.now()).capabilities.includes(
        "control_write",
      );
    } catch {
      return false;
    }
  }
  private async adoptVault(vault: Vault, registry: Registry) {
    this.registry = registry;
    this.vault = vault;
    const cp = registry.checkpoint;
    this.pin = {
      ownerSubject: await this.owner,
      vaultId: vault.vaultId,
      rootKeyId: vault.rootKeyId,
      registrySequence: cp.registrySequence,
      checkpointDigest: registry.digest,
      keyEpoch: cp.keyEpoch,
    };
    const history = [];
    for (const bundle of vault.registryHistory) {
      const cp = parsed(unb64(bundle.checkpoint.payload));
      history.push({
        registrySequence: cp.registrySequence,
        checkpointDigest: await sha(canonical(cp)),
        keyEpoch: cp.keyEpoch,
      });
    }
    let device = this.deviceSeal;
    try {
      if (!this.device) throw new VaultError("device_required");
      cert(registry, this.device.sigId, "device_sig", this.now());
      cert(registry, this.device.encId, "device_enc", this.now());
    } catch {
      // Another live tab may have promoted a new sealed candidate already.
      // Public/history refreshes must never overwrite it with this stale key.
      device = undefined;
    }
    const change = this.deviceChange;
    return {
      pin: this.pin,
      device,
      history,
      pending:
        this.pendingDevice &&
        vault.registryHistory.some((b) => equal(b, this.pendingDevice!.operation.registryBundle))
          ? (this.pendingEnvelope ?? null)
          : null,
      deviceReplacementKeyIds:
        device &&
        change?.candidate &&
        this.deviceChangeState(change, vault, registry) === "applied" &&
        this.device?.deviceId === change.packet.newDeviceId
          ? change.packet.replacedKeyIds
          : undefined,
    };
  }
  private ready() {
    this.requireOrdinarySession();
    if (!this.pin || !this.registry || !this.device || !this.vault) throw new VaultError("locked");
    if (
      this.registry.checkpoint.registrySequence < this.pin.registrySequence ||
      this.registry.checkpoint.keyEpoch < this.pin.keyEpoch ||
      (this.registry.checkpoint.registrySequence === this.pin.registrySequence &&
        this.registry.digest !== this.pin.checkpointDigest)
    )
      throw new VaultError("registry_conflict");
    cert(this.registry, this.device.sigId, "device_sig", this.now());
    return { registry: this.registry, device: this.device, vault: this.vault };
  }
  async publicAgentAnchor(args: {
    connectionId: string;
    agentPrincipalId: string;
    taskId: string;
  }): Promise<AgentAnchor> {
    exact(args, ["connectionId", "agentPrincipalId", "taskId"]);
    for (const value of Object.values(args)) validate("Identifier", value);
    const { registry, vault } = this.ready();
    return {
      ownerSubject: await this.owner,
      vaultId: vault.vaultId,
      rootJwk: vault.rootJwk,
      rootKeyId: vault.rootKeyId,
      rootEpoch: registry.checkpoint.rootEpoch,
      registrySequence: registry.checkpoint.registrySequence,
      checkpointDigest: registry.digest,
      ...args,
    };
  }
  private async checkedAgentOffer(offer: HelperPublicOffer) {
    bounded(offer, 16384);
    exact(offer, [
      "helperVersion",
      "sessionId",
      "generation",
      "anchor",
      "agentSigningPublicJwk",
      "agentEncryptionPublicJwk",
      "agentSigningKeyId",
      "agentEncryptionKeyId",
      "keyExportRejected",
    ]);
    const { registry, vault } = this.ready(),
      a = offer.anchor;
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
    for (const field of [
      "ownerSubject",
      "vaultId",
      "connectionId",
      "agentPrincipalId",
      "taskId",
    ] as const)
      validate("Identifier", a[field]);
    validate("Identifier", offer.sessionId);
    positive(offer.generation);
    positive(a.registrySequence);
    validate("Digest", a.checkpointDigest);
    for (const jwk of [a.rootJwk, offer.agentSigningPublicJwk, offer.agentEncryptionPublicJwk])
      validate("PublicJWK", jwk);
    for (const id of [a.rootKeyId, offer.agentSigningKeyId, offer.agentEncryptionKeyId])
      validate("KeyId", id);
    const historical = vault.registryHistory.find(
      (bundle) => parsed(unb64(bundle.checkpoint.payload)).registrySequence === a.registrySequence,
    );
    if (
      offer.helperVersion !== "1.2.0" ||
      offer.keyExportRejected !== true ||
      a.ownerSubject !== (await this.owner) ||
      a.vaultId !== vault.vaultId ||
      a.rootKeyId !== vault.rootKeyId ||
      !equal(a.rootJwk, vault.rootJwk) ||
      a.rootEpoch !== registry.checkpoint.rootEpoch ||
      !historical ||
      (await sha(canonical(parsed(unb64(historical.checkpoint.payload))))) !== a.checkpointDigest ||
      (await thumb(offer.agentSigningPublicJwk)) !== offer.agentSigningKeyId ||
      (await thumb(offer.agentEncryptionPublicJwk)) !== offer.agentEncryptionKeyId ||
      offer.agentSigningKeyId === offer.agentEncryptionKeyId ||
      [vault.rootKeyId, ...registry.certificates.keys()].some(
        (id) =>
          [offer.agentSigningKeyId, offer.agentEncryptionKeyId].includes(id) &&
          !registry.certificates.has(id),
      )
    )
      throw new VaultError("binding_mismatch");
    const old = [...registry.active]
      .map((id) => registry.certificates.get(id)!)
      .filter(
        (c) => c.connectionId === a.connectionId && ["agent_sig", "agent_enc"].includes(c.role),
      );
    const epochs = ["agent_sig", "agent_enc"].map(
      (role) =>
        (registry.localEpochs.get([a.agentPrincipalId, role, a.connectionId].join("/")) ?? 0) + 1,
    );
    let registered = false,
      registeredExpiresAt: number | null = null;
    try {
      const signing = cert(registry, offer.agentSigningKeyId, "agent_sig", this.now()),
        encryption = cert(registry, offer.agentEncryptionKeyId, "agent_enc", this.now());
      registered =
        [signing, encryption].every(
          (c) => c.connectionId === a.connectionId && c.principalId === a.agentPrincipalId,
        ) && old.length === 2;
      if (registered) registeredExpiresAt = Math.min(signing.expiresAt, encryption.expiresAt);
    } catch (error) {
      if (!(error instanceof VaultError)) throw error;
    }
    return {
      offerFingerprint: await sha(canonical(offer)),
      registrySequence: registry.checkpoint.registrySequence,
      checkpointDigest: registry.digest,
      existingConnectionKeyIds: old.map((c) => c.keyId).sort(),
      registered,
      registeredExpiresAt,
      agentSigningKeyEpoch: epochs[0],
      agentEncryptionKeyEpoch: epochs[1],
    };
  }
  async inspectAgentOffer(args: { offer: HelperPublicOffer }) {
    exact(args, ["offer"]);
    return this.checkedAgentOffer(args.offer);
  }
  async prepareAgentRegistration(args: {
    offer: HelperPublicOffer;
    ttlSeconds: number;
    replaceKeyIds?: string[];
  }) {
    exact(args, [
      "offer",
      "ttlSeconds",
      ...(args.replaceKeyIds === undefined ? [] : ["replaceKeyIds"]),
    ]);
    const review = await this.checkedAgentOffer(args.offer),
      { registry, vault } = this.ready();
    if (!Number.isSafeInteger(args.ttlSeconds) || args.ttlSeconds < 60 || args.ttlSeconds > 3600)
      throw new VaultError("invalid_data");
    const replaced = args.replaceKeyIds ?? [];
    if (!Array.isArray(replaced) || !equal(replaced, review.existingConnectionKeyIds))
      throw new VaultError("replacement_review_required");
    const identity = canonical({
      offerFingerprint: review.offerFingerprint,
      replaceKeyIds: replaced,
      ttlSeconds: args.ttlSeconds,
    });
    const cached = this.pendingAgentRegistrations.get(identity);
    if (
      cached &&
      cached.expectedVersion === vault.version &&
      parsed(unb64(cached.registryBundle.checkpoint.payload)).previousDigest === registry.digest &&
      cached.expiresAt > this.now()
    )
      return {
        ...this.normalizedAgentPacket(cached),
        localPending: await this.sealAgentLocal("registration", cached),
      };
    for (const id of [args.offer.agentSigningKeyId, args.offer.agentEncryptionKeyId])
      if (registry.certificates.has(id)) throw new VaultError("agent_already_registered");
    if (
      vault.registryHistory.length >= 32 ||
      registry.bundle.entries.length + 2 > 64 ||
      registry.checkpoint.revokedKeyIds.length + replaced.length > 64 ||
      this.pendingAgentRegistrations.size >= 16
    )
      throw new VaultError("device_limit");
    const expiresAt = this.now() + args.ttlSeconds,
      a = args.offer.anchor;
    const entries = registry.bundle.entries.map((entry) => ({
      ...entry,
      active: replaced.includes(parsed(unb64(entry.certificate.payload)).keyId)
        ? false
        : entry.active,
    }));
    for (const [role, jwk, epoch] of [
      ["agent_sig", args.offer.agentSigningPublicJwk, review.agentSigningKeyEpoch],
      ["agent_enc", args.offer.agentEncryptionPublicJwk, review.agentEncryptionKeyEpoch],
    ] as [string, Json, number][]) {
      const value = {
        artifactType: "key_certificate",
        contractVersion: CONTRACT,
        vaultId: vault.vaultId,
        ownerSubject: await this.owner,
        certificateId: randomId("cert_"),
        keyId: await thumb(jwk),
        role,
        publicJwk: jwk,
        principalId: a.agentPrincipalId,
        connectionId: a.connectionId,
        keyEpoch: epoch,
        issuerKeyId: vault.rootKeyId,
        notBefore: Math.max(0, this.now() - 5),
        expiresAt,
        capabilities: CAP[role],
      };
      validate("KeyCertificatePayload", value);
      entries.push({ certificate: await sign(value, this.root!, vault.rootKeyId), active: true });
    }
    const bundle = await this.bundle(entries, registry),
      checkpoint = parsed(unb64(bundle.checkpoint.payload));
    checkpoint.revokedKeyIds = [...new Set([...checkpoint.revokedKeyIds, ...replaced])].sort();
    bundle.checkpoint = await sign(checkpoint, this.root!, vault.rootKeyId);
    await verifyRegistry(
      bundle,
      vault.rootJwk,
      await this.owner,
      vault.vaultId,
      registry,
      this.now(),
    );
    const packet: AgentRegistration = {
      operationId: randomId(),
      expectedVersion: vault.version,
      registryBundle: bundle,
      offer: args.offer,
      offerFingerprint: review.offerFingerprint,
      expiresAt,
      replacedKeyIds: replaced,
    };
    this.pendingAgentRegistrations.set(identity, packet);
    return {
      ...this.normalizedAgentPacket(packet),
      localPending: await this.sealAgentLocal("registration", packet),
    };
  }
  private normalizedAgentPacket<
    T extends AgentRegistration | AgentApprovalPacket | AgentPreparationPacket,
  >(packet: T): T {
    return parsed(utf8.encode(canonical(packet))) as T;
  }
  private async sealAgentLocal(
    kind: AgentPendingKind,
    packet: AgentRegistration | AgentApprovalPacket | AgentPreparationPacket,
  ) {
    const { vault } = this.ready();
    if (!this.wrapping) throw new VaultError("locked");
    const connectionId =
      kind !== "preparation"
        ? (packet as AgentRegistration | AgentApprovalPacket).offer.anchor.connectionId
        : (packet as AgentPreparationPacket).connectionId;
    const taskId =
      kind !== "preparation"
        ? (packet as AgentRegistration | AgentApprovalPacket).offer.anchor.taskId
        : (packet as AgentPreparationPacket).taskId;
    bounded(packet, 524288);
    return seal(
      this.wrapping,
      {
        profile: "folioview.agent-owner-outbox.v1",
        ownerSubject: await this.owner,
        vaultId: vault.vaultId,
        rootKeyId: vault.rootKeyId,
        kind,
        connectionId,
        taskId,
      },
      packet,
    );
  }
  async openAgentPending(args: {
    kind: AgentPendingKind;
    record: Json;
    connectionId: string;
    taskId: string;
  }) {
    exact(args, ["kind", "record", "connectionId", "taskId"]);
    const { vault } = this.ready();
    if (!this.wrapping || !["registration", "approval", "preparation"].includes(args.kind))
      throw new VaultError("locked");
    const r = args.record;
    exact(r, [
      "profile",
      "ownerSubject",
      "vaultId",
      "rootKeyId",
      "kind",
      "connectionId",
      "taskId",
      "iv",
      "ciphertext",
    ]);
    if (
      r.profile !== "folioview.agent-owner-outbox.v1" ||
      r.ownerSubject !== (await this.owner) ||
      r.vaultId !== vault.vaultId ||
      r.rootKeyId !== vault.rootKeyId ||
      r.kind !== args.kind ||
      r.connectionId !== args.connectionId ||
      r.taskId !== args.taskId
    )
      throw new VaultError("binding_mismatch");
    const packet = await open(this.wrapping, r, 524288);
    if (args.kind === "registration")
      await this.validateAgentRegistration(packet as AgentRegistration);
    else if (args.kind === "approval")
      await this.validateAgentApproval(packet as AgentApprovalPacket);
    else await this.validateAgentPreparation(packet as AgentPreparationPacket);
    return packet;
  }
  async validateAgentRegistration(packet: AgentRegistration) {
    exact(packet, [
      "operationId",
      "expectedVersion",
      "registryBundle",
      "offer",
      "offerFingerprint",
      "expiresAt",
      "replacedKeyIds",
    ]);
    const review = await this.checkedAgentOffer(packet.offer),
      { registry, vault } = this.ready();
    validate("OperationIdentifier", packet.operationId);
    positive(packet.expectedVersion);
    positive(packet.expiresAt);
    if (review.offerFingerprint !== packet.offerFingerprint || packet.expiresAt <= this.now())
      throw new VaultError("stale_epoch");
    const known = vault.registryHistory.some((b) => equal(b, packet.registryBundle));
    const candidate = await verifyRegistry(
      packet.registryBundle,
      vault.rootJwk,
      await this.owner,
      vault.vaultId,
      known ? undefined : registry,
      this.now(),
    );
    if (
      (!known && packet.expectedVersion !== vault.version) ||
      candidate.checkpoint.keyEpoch !== registry.checkpoint.keyEpoch
    )
      throw new VaultError("registry_conflict");
    for (const [id, role, jwk] of [
      [packet.offer.agentSigningKeyId, "agent_sig", packet.offer.agentSigningPublicJwk],
      [packet.offer.agentEncryptionKeyId, "agent_enc", packet.offer.agentEncryptionPublicJwk],
    ]) {
      const c = cert(known ? registry : candidate, id as string, role as string, this.now());
      if (
        c.connectionId !== packet.offer.anchor.connectionId ||
        c.principalId !== packet.offer.anchor.agentPrincipalId ||
        c.expiresAt !== packet.expiresAt ||
        !equal(c.publicJwk, jwk)
      )
        throw new VaultError("binding_mismatch");
    }
    return packet;
  }
  private async checkedAgentGrant(signed: Signed) {
    const { registry, vault } = this.ready();
    const grant = parsed(unb64(signed.payload, 65536));
    validate("AgentKeyGrantPayload", grant);
    const author = cert(registry, grant.deviceSigningKeyId, "device_sig", this.now());
    await verified(signed, author.publicJwk);
    const historical = vault.registryHistory.find(
      (bundle) =>
        parsed(unb64(bundle.checkpoint.payload)).registrySequence === grant.registrySequence,
    );
    if (
      !historical ||
      (await sha(canonical(parsed(unb64(historical.checkpoint.payload))))) !==
        grant.checkpointDigest
    )
      throw new VaultError("registry_conflict");
    if (
      !author.capabilities.includes("task_grant") ||
      grant.ownerSubject !== (await this.owner) ||
      grant.vaultId !== vault.vaultId ||
      grant.keyEpoch !== registry.checkpoint.keyEpoch ||
      grant.taskVersions.length !== 1 ||
      grant.historyPolicy !== "selected" ||
      !grant.capabilities.includes("decrypt_task") ||
      (grant.resourceBindings.length > 0 && !grant.capabilities.includes("decrypt_resources")) ||
      grant.notBefore > this.now() ||
      grant.expiresAt <= this.now()
    )
      throw new VaultError("binding_mismatch");
    const sig = cert(registry, grant.agentSigningKeyId, "agent_sig", this.now()),
      enc = cert(registry, grant.agentEncryptionKeyId, "agent_enc", this.now());
    if (
      sig.connectionId !== grant.connectionId ||
      enc.connectionId !== grant.connectionId ||
      sig.principalId !== enc.principalId ||
      sig.keyEpoch !== grant.agentSigningKeyEpoch ||
      enc.keyEpoch !== grant.agentEncryptionKeyEpoch
    )
      throw new VaultError("binding_mismatch");
    const recipients = grant.writebackRecipientKeyIds.map((id: string) =>
      cert(registry, id, undefined, this.now()),
    );
    if (
      recipients.length < 2 ||
      recipients.length > 7 ||
      !equal(grant.writebackRecipientKeyIds, [...new Set(grant.writebackRecipientKeyIds)].sort()) ||
      !recipients.some((r: Json) => r.role === "device_enc") ||
      !recipients.some((r: Json) => r.role === "recovery_enc") ||
      recipients.some(
        (r: Json) => r.connectionId !== null || !["device_enc", "recovery_enc"].includes(r.role),
      ) ||
      grant.notBefore <
        Math.max(
          author.notBefore,
          sig.notBefore,
          enc.notBefore,
          ...recipients.map((r: Json) => r.notBefore),
        ) ||
      grant.expiresAt - grant.notBefore > 2592000 ||
      grant.expiresAt >
        Math.min(
          author.expiresAt,
          sig.expiresAt,
          enc.expiresAt,
          ...recipients.map((r: Json) => r.expiresAt),
        )
    )
      throw new VaultError("binding_mismatch");
    return {
      grant,
      recipients: [...recipients, enc].sort((a: Json, b: Json) => (a.keyId < b.keyId ? -1 : 1)),
    };
  }
  async signAgentGrants(
    args: AgentGrantArgs,
  ): Promise<AgentApprovalPacket & { localPending: Json }> {
    exact(args, ["authorization", "tasks", "offer"]);
    bounded(args, 1048576);
    const offer = await this.checkedAgentOffer(args.offer),
      { registry, device, vault } = this.ready(),
      a = args.authorization;
    exact(a, [
      "contractVersion",
      "provider",
      "status",
      "clientId",
      "scopes",
      "connectionId",
      "authorizationId",
      "expiresAt",
      "prepared",
    ]);
    const prepared = a.prepared;
    exact(prepared, [
      "taskIds",
      "approvedScopes",
      "tasks",
      "authorizationCount",
      "keyEpoch",
      "registrySequence",
      "checkpointDigest",
      "authorizationExpiresAt",
      "historyPolicy",
    ]);
    validate("Identifier", a.clientId);
    validate("Identifier", a.authorizationId);
    if (!Array.isArray(prepared.approvedScopes)) throw new VaultError("invalid_data");
    const scopes = new Set(prepared.approvedScopes);
    const allowed = [
      "tasks:read",
      "runs:create",
      "runs:read",
      "results:create",
      "results:revise",
      "receipts:read",
      "watchlist:read",
      "channel_follows:read",
      "portfolio:read",
    ];
    if (
      a.contractVersion !== CONTRACT ||
      a.provider !== "muse" ||
      a.status !== "pending" ||
      a.connectionId !== args.offer.anchor.connectionId ||
      !Array.isArray(a.scopes) ||
      !a.scopes.every((s: string) => allowed.includes(s)) ||
      !Array.isArray(prepared.approvedScopes) ||
      !prepared.approvedScopes.length ||
      scopes.size !== prepared.approvedScopes.length ||
      !prepared.approvedScopes.every((s: string) => a.scopes.includes(s)) ||
      !scopes.has("tasks:read") ||
      prepared.historyPolicy !== "selected" ||
      prepared.registrySequence !== registry.checkpoint.registrySequence ||
      prepared.checkpointDigest !== registry.digest ||
      prepared.keyEpoch !== registry.checkpoint.keyEpoch ||
      !Array.isArray(args.tasks) ||
      args.tasks.length !== 1 ||
      args.tasks[0].metadata.taskId !== args.offer.anchor.taskId ||
      !equal(
        prepared.taskIds,
        args.tasks.map((t) => t.metadata.taskId),
      ) ||
      !Array.isArray(prepared.tasks) ||
      prepared.tasks.length !== args.tasks.length ||
      !Number.isSafeInteger(prepared.authorizationExpiresAt) ||
      prepared.authorizationExpiresAt <= this.now()
    )
      throw new VaultError("binding_mismatch");
    const author = cert(registry, device.sigId, "device_sig", this.now());
    if (!author.capabilities.includes("task_grant")) throw new VaultError("key_revoked");
    const sig = cert(registry, args.offer.agentSigningKeyId, "agent_sig", this.now()),
      enc = cert(registry, args.offer.agentEncryptionKeyId, "agent_enc", this.now());
    if (
      [sig, enc].some(
        (c) =>
          c.connectionId !== a.connectionId || c.principalId !== args.offer.anchor.agentPrincipalId,
      )
    )
      throw new VaultError("binding_mismatch");
    const recipients = this.taskSelection(registry, this.now()).recipients;
    if (recipients.length > 7) throw new VaultError("recipient_limit");
    const notBefore = Math.max(
      this.now() - 5,
      author.notBefore,
      sig.notBefore,
      enc.notBefore,
      ...recipients.map((r) => r.notBefore),
    );
    const expiresAt = Math.min(
      this.now() + 3600,
      prepared.authorizationExpiresAt,
      author.expiresAt,
      sig.expiresAt,
      enc.expiresAt,
      ...recipients.map((r) => r.expiresAt),
    );
    if (expiresAt <= this.now()) throw new VaultError("key_revoked");
    const signedGrants: Signed[] = [];
    for (const [index, task] of args.tasks.entries()) {
      await this.openTask(task);
      const meta = task.metadata,
        selected = prepared.tasks[index];
      exact(selected, [
        "taskId",
        "taskVersion",
        "executionEpoch",
        "resourceBindings",
        "grantId",
        "grantEpoch",
        "selectedResourceVersions",
      ]);
      if (
        meta.status !== "active" ||
        selected.taskId !== meta.taskId ||
        selected.taskVersion !== meta.taskVersion ||
        selected.executionEpoch !== meta.executionEpoch ||
        !equal(selected.resourceBindings, meta.resourceBindings) ||
        !Array.isArray(selected.selectedResourceVersions) ||
        selected.selectedResourceVersions.length !== meta.resourceBindings.length
      )
        throw new VaultError("version_conflict");
      const resourceBindings = meta.resourceBindings.map((binding, i) => {
        const version = selected.selectedResourceVersions[i];
        exact(version, ["ref", "revision", "sourceEpoch", "producerSnapshotId"]);
        positive(version.revision);
        if (
          !equal(version.ref, binding.ref) ||
          version.sourceEpoch !== binding.sourceEpoch ||
          !scopes.has(
            {
              holdings: "portfolio:read",
              watchlist: "watchlist:read",
              channel_follows: "channel_follows:read",
            }[binding.ref.kind],
          )
        )
          throw new VaultError("binding_mismatch");
        return { ...binding, versionAccess: "selected", selectedVersions: [version.revision] };
      });
      const capabilities = [
        "decrypt_task",
        ...(resourceBindings.length ? ["decrypt_resources"] : []),
        ...(scopes.has("results:create") || scopes.has("results:revise") ? ["encrypt_result"] : []),
      ];
      if (resourceBindings.length && !(scopes.has("runs:create") || scopes.has("runs:read")))
        throw new VaultError("binding_mismatch");
      const grant = {
        artifactType: "agent_key_grant",
        contractVersion: CONTRACT,
        vaultId: vault.vaultId,
        ownerSubject: await this.owner,
        authorizationId: a.authorizationId,
        deviceSigningKeyId: device.sigId,
        connectionId: a.connectionId,
        taskId: meta.taskId,
        taskVersions: [meta.taskVersion],
        executionEpoch: meta.executionEpoch,
        grantId: selected.grantId,
        grantEpoch: selected.grantEpoch,
        agentSigningKeyId: sig.keyId,
        agentSigningKeyEpoch: sig.keyEpoch,
        agentEncryptionKeyId: enc.keyId,
        agentEncryptionKeyEpoch: enc.keyEpoch,
        keyEpoch: registry.checkpoint.keyEpoch,
        resourceBindings,
        capabilities,
        writebackRecipientKeyIds: recipients.map((r) => r.keyId),
        historyPolicy: "selected",
        notBefore,
        expiresAt,
        registrySequence: registry.checkpoint.registrySequence,
        checkpointDigest: registry.digest,
      };
      validate("AgentKeyGrantPayload", grant);
      signedGrants.push(await sign(grant, device.sig, device.sigId));
    }
    const packet: AgentApprovalPacket = {
      operationId: randomId(),
      authorization: a,
      offer: args.offer,
      signedGrants,
      writebackRecipientKeyIds: recipients.map((r) => r.keyId),
      offerFingerprint: offer.offerFingerprint,
    };
    return {
      ...this.normalizedAgentPacket(packet),
      localPending: await this.sealAgentLocal("approval", packet),
    };
  }
  private async validateAgentApproval(packet: AgentApprovalPacket) {
    exact(packet, [
      "operationId",
      "authorization",
      "offer",
      "signedGrants",
      "writebackRecipientKeyIds",
      "offerFingerprint",
    ]);
    bounded(packet, 131072);
    validate("OperationIdentifier", packet.operationId);
    const inspected = await this.checkedAgentOffer(packet.offer),
      a = packet.authorization,
      p = a.prepared;
    exact(a, [
      "contractVersion",
      "provider",
      "status",
      "clientId",
      "scopes",
      "connectionId",
      "authorizationId",
      "expiresAt",
      "prepared",
    ]);
    exact(p, [
      "taskIds",
      "approvedScopes",
      "tasks",
      "authorizationCount",
      "keyEpoch",
      "registrySequence",
      "checkpointDigest",
      "authorizationExpiresAt",
      "historyPolicy",
    ]);
    if (
      packet.offerFingerprint !== inspected.offerFingerprint ||
      a.contractVersion !== CONTRACT ||
      a.provider !== "muse" ||
      a.status !== "pending" ||
      a.connectionId !== packet.offer.anchor.connectionId ||
      !Array.isArray(packet.signedGrants) ||
      packet.signedGrants.length !== 1 ||
      !Array.isArray(p.tasks) ||
      p.tasks.length !== 1 ||
      !equal(p.taskIds, [packet.offer.anchor.taskId])
    )
      throw new VaultError("binding_mismatch");
    const { grant } = await this.checkedAgentGrant(packet.signedGrants[0]),
      selected = p.tasks[0];
    if (
      grant.authorizationId !== a.authorizationId ||
      grant.connectionId !== a.connectionId ||
      grant.taskId !== packet.offer.anchor.taskId ||
      !equal(grant.taskVersions, [selected.taskVersion]) ||
      grant.executionEpoch !== selected.executionEpoch ||
      grant.grantId !== selected.grantId ||
      grant.grantEpoch !== selected.grantEpoch ||
      grant.agentSigningKeyId !== packet.offer.agentSigningKeyId ||
      grant.agentEncryptionKeyId !== packet.offer.agentEncryptionKeyId ||
      grant.registrySequence !== p.registrySequence ||
      grant.checkpointDigest !== p.checkpointDigest ||
      grant.keyEpoch !== p.keyEpoch ||
      grant.expiresAt > p.authorizationExpiresAt ||
      !equal(grant.writebackRecipientKeyIds, packet.writebackRecipientKeyIds) ||
      !equal(
        grant.resourceBindings.map((b: Json) => ({ ref: b.ref, sourceEpoch: b.sourceEpoch })),
        selected.resourceBindings,
      )
    )
      throw new VaultError("binding_mismatch");
    for (const [index, binding] of grant.resourceBindings.entries()) {
      const version = selected.selectedResourceVersions[index];
      if (
        !version ||
        !equal(version.ref, binding.ref) ||
        version.sourceEpoch !== binding.sourceEpoch ||
        !equal(binding.selectedVersions, [version.revision])
      )
        throw new VaultError("binding_mismatch");
    }
    return packet;
  }
  async sealAgentPreparation(args: AgentPreparationArgs) {
    exact(args, ["intent", "task", "signedGrant", "sources"]);
    bounded(args, 1048576);
    const { registry, device, vault } = this.ready(),
      { grant, recipients } = await this.checkedAgentGrant(args.signedGrant),
      intent = args.intent;
    const content = await this.openTask(args.task),
      meta = args.task.metadata;
    exact(intent, [
      "contractVersion",
      "profile",
      "preparationId",
      "objects",
      "taskMetadata",
      "connectionId",
      "taskId",
      "grantId",
      "grantEpoch",
      "registrySequence",
      "checkpointDigest",
      "taskDeliveryBase",
      "status",
    ]);
    const preparationId =
      "preparation_" +
      (
        await sha(
          canonical([
            grant.ownerSubject,
            grant.connectionId,
            grant.authorizationId,
            grant.grantId,
            grant.grantEpoch,
            grant.taskId,
            grant.taskVersions,
          ]),
        )
      ).slice(0, 43);
    if (
      intent.contractVersion !== CONTRACT ||
      intent.profile !== "folioview.agent-preparation.v1" ||
      intent.status !== "staging" ||
      intent.preparationId !== preparationId ||
      intent.connectionId !== grant.connectionId ||
      intent.taskId !== grant.taskId ||
      meta.taskId !== grant.taskId ||
      grant.taskVersions[0] !== meta.taskVersion ||
      grant.executionEpoch !== meta.executionEpoch ||
      intent.grantId !== grant.grantId ||
      intent.grantEpoch !== grant.grantEpoch ||
      intent.registrySequence !== registry.checkpoint.registrySequence ||
      intent.checkpointDigest !== registry.digest ||
      !equal(intent.taskMetadata, meta) ||
      meta.status !== "active" ||
      !Array.isArray(args.sources) ||
      !equal(
        meta.resourceBindings,
        grant.resourceBindings.map((b: Json) => ({ ref: b.ref, sourceEpoch: b.sourceEpoch })),
      ) ||
      args.sources.length !== grant.resourceBindings.length ||
      !Array.isArray(intent.objects) ||
      intent.objects.length !== args.sources.length + 1
    )
      throw new VaultError("binding_mismatch");
    exact(intent.taskDeliveryBase, ["deliveryRevision", "envelopeFingerprint"]);
    positive(intent.taskDeliveryBase.deliveryRevision);
    validate("Digest", intent.taskDeliveryBase.envelopeFingerprint);
    if (
      intent.taskDeliveryBase.deliveryRevision === 1 &&
      intent.taskDeliveryBase.envelopeFingerprint !== meta.envelopeFingerprint
    )
      throw new VaultError("binding_mismatch");
    const objects: AgentPreparationPacket["objects"] = [];
    for (let index = 0; index < intent.objects.length; index++) {
      const descriptor = intent.objects[index];
      exact(descriptor, [
        "objectId",
        "objectType",
        "revision",
        "deliveryRevision",
        "priorEnvelopeFingerprint",
        "resourceRef",
        "sourceRevision",
        "sourceEpoch",
        "producerSnapshotId",
        "provenance",
      ]);
      let privateContent: Json = content,
        binding: Json = this.taskBinding(meta.taskId, meta.taskVersion),
        expectedRevision = meta.taskVersion,
        operationType = "reshare_delivery";
      if (index === 0) {
        if (
          descriptor.objectId !== meta.taskId ||
          descriptor.objectType !== "task" ||
          descriptor.revision !== meta.taskVersion ||
          descriptor.deliveryRevision !== intent.taskDeliveryBase.deliveryRevision + 1 ||
          descriptor.priorEnvelopeFingerprint !== intent.taskDeliveryBase.envelopeFingerprint ||
          [
            descriptor.resourceRef,
            descriptor.sourceRevision,
            descriptor.sourceEpoch,
            descriptor.producerSnapshotId,
          ].some((v) => v !== null) ||
          descriptor.provenance !== "task_reshare"
        )
          throw new VaultError("binding_mismatch");
      } else {
        const resource = args.sources[index - 1],
          approved = grant.resourceBindings[index - 1];
        if (
          !resource ||
          !equal(resource.ref, approved.ref) ||
          resource.sourceEpoch !== approved.sourceEpoch ||
          !equal(approved.selectedVersions, [resource.revision]) ||
          approved.versionAccess !== "selected"
        )
          throw new VaultError("binding_mismatch");
        const id = "copy_" + (await sha(canonical([preparationId, resource.ref]))).slice(0, 43),
          objectType = {
            holdings: "holdings_snapshot",
            watchlist: "watchlist_evidence",
            channel_follows: "channel_follows_evidence",
          }[resource.kind];
        if (
          resource.kind !== resource.ref.kind ||
          descriptor.objectId !== id ||
          descriptor.objectType !== objectType ||
          descriptor.revision !== resource.revision ||
          descriptor.deliveryRevision !== 1 ||
          descriptor.priorEnvelopeFingerprint !== null ||
          !equal(descriptor.resourceRef, resource.ref) ||
          descriptor.sourceEpoch !== resource.sourceEpoch ||
          descriptor.sourceRevision !== resource.revision ||
          descriptor.producerSnapshotId !== null ||
          descriptor.provenance !== "owner_attested_copy"
        )
          throw new VaultError("binding_mismatch");
        privateContent = await this.agentResourceContent(resource, id);
        binding = {
          ...this.taskBinding("placeholder", 1),
          taskId: null,
          taskVersion: null,
          resourceRef: resource.ref,
          sourceRevision: resource.revision,
          sourceEpoch: resource.sourceEpoch,
        };
        expectedRevision = resource.revision - 1;
        operationType = resource.kind === "holdings" ? "commit_snapshot" : "commit_evidence";
      }
      if (typeof privateContent !== "object") throw new VaultError("invalid_data");
      const operationId = randomId(),
        context = {
          contractVersion: CONTRACT,
          profileId: "P1",
          ownerSubject: await this.owner,
          vaultId: vault.vaultId,
          rootKeyId: vault.rootKeyId,
          rootEpoch: registry.checkpoint.rootEpoch,
          registrySequence: registry.checkpoint.registrySequence,
          checkpointDigest: registry.digest,
          keyEpoch: registry.checkpoint.keyEpoch,
          objectId: descriptor.objectId,
          objectType: descriptor.objectType,
          revision: descriptor.revision,
          deliveryRevision: descriptor.deliveryRevision,
          priorEnvelopeFingerprint: descriptor.priorEnvelopeFingerprint,
          expectedRevision,
          stableOperationId: operationId,
          operationType,
          authorSigningKeyId: device.sigId,
          binding,
          resourceBindings: index === 0 ? meta.resourceBindings : [],
          recipients: recipients.map((r: Json) => this.taskRecipient(r)),
        };
      validate("Context", context);
      bounded(context, 16384);
      const payload = {
        privateSchemaVersion: 2,
        objectId: descriptor.objectId,
        objectType: descriptor.objectType,
        revision: descriptor.revision,
        binding,
        payload: privateContent,
      };
      validate("PrivatePayload", payload);
      bounded(payload, index === 0 ? 65536 : 196608);
      const encryptor = new GeneralEncrypt(utf8.encode(canonical(payload)))
        .setProtectedHeader(JWE_HEADER)
        .setAdditionalAuthenticatedData(utf8.encode(canonical(context)));
      for (const recipient of recipients)
        encryptor
          .addRecipient(await key(recipient.publicJwk))
          .setUnprotectedHeader({ kid: recipient.keyId });
      const envelope = {
        contractVersion: CONTRACT,
        signedObject: await sign(
          { context, jwe: await encryptor.encrypt() },
          device.sig,
          device.sigId,
          "fv-object+jws",
        ),
      };
      validate("Carrier", envelope);
      bounded(envelope, 524288);
      const envelopeFingerprint = await signingFingerprint(envelope.signedObject);
      objects.push({
        objectId: descriptor.objectId,
        operationId,
        authorKeyId: device.sigId,
        envelope,
        envelopeFingerprint,
      });
    }
    const packet: AgentPreparationPacket = {
      preparationId,
      connectionId: grant.connectionId,
      taskId: meta.taskId,
      registrySequence: registry.checkpoint.registrySequence,
      checkpointDigest: registry.digest,
      keyEpoch: registry.checkpoint.keyEpoch,
      objects,
      commit: {
        operationId: randomId(),
        body: {
          contractVersion: CONTRACT,
          objects: objects.map(({ objectId, envelopeFingerprint }) => ({
            objectId,
            envelopeFingerprint,
          })),
        },
      },
      deliveryPin: {
        preparationId,
        taskVersion: meta.taskVersion,
        taskEnvelopeFingerprint: meta.envelopeFingerprint,
        taskDeliveryFingerprint: objects[0].envelopeFingerprint,
        objects: objects
          .map(({ objectId, envelopeFingerprint }) => ({ objectId, envelopeFingerprint }))
          .sort((a, b) => (a.objectId < b.objectId ? -1 : 1)),
        deliveryRevision: intent.objects[0].deliveryRevision,
        priorEnvelopeFingerprint: intent.taskDeliveryBase.envelopeFingerprint,
        authorizationId: grant.authorizationId,
        grantId: grant.grantId,
        grantEpoch: grant.grantEpoch,
        executionEpoch: grant.executionEpoch,
      },
    };
    bounded(packet, 524288);
    return {
      ...this.normalizedAgentPacket(packet),
      localPending: await this.sealAgentLocal("preparation", packet),
    };
  }
  private async agentResourceContent(
    source: AgentPreparationSource,
    copyId: string,
  ): Promise<Json> {
    validate("ResourceRef", source.ref);
    positive(source.revision);
    positive(source.sourceEpoch);
    if (source.kind === "holdings") {
      exact(source, ["kind", "ref", "revision", "sourceEpoch", "snapshot"]);
      if (
        source.snapshot.receipt.revision !== source.revision ||
        source.snapshot.receipt.sourceEpoch !== source.sourceEpoch ||
        !equal(source.snapshot.receipt.resourceRef, source.ref)
      )
        throw new VaultError("binding_mismatch");
      const value = await this.openSnapshot(source.snapshot, {
        resourceRef: source.ref,
        sourceEpoch: source.sourceEpoch,
      });
      return { ...value, data: { ...value.data, snapshotId: copyId } };
    }
    exact(source, [
      "kind",
      "ref",
      "revision",
      "sourceEpoch",
      "fetchedAt",
      "sourceAsOf",
      "response",
    ]);
    exact(
      source.response,
      source.kind === "watchlist" ? ["items", "limit"] : ["revision", "items", "limit"],
    );
    if (
      source.ref.sourceService !== "user" ||
      !Array.isArray(source.response.items) ||
      source.response.limit !== 50 ||
      (source.kind === "channel_follows" && source.response.revision !== source.revision)
    )
      throw new VaultError("binding_mismatch");
    const value = {
      state: source.response.items.length ? "ready" : "empty",
      coverage: { state: "complete", issues: [] },
      sourceAsOf: source.sourceAsOf,
      fetchedAt: source.fetchedAt,
      freshness: source.sourceAsOf === null ? "unknown" : "fresh",
      data:
        source.kind === "watchlist"
          ? { kind: "watchlist", items: source.response.items }
          : { kind: "channel_follows", items: source.response.items, readableMaterialCount: 0 },
    };
    validate("ResourceContent", value);
    bounded(value, 196608);
    if (
      utcSeconds(source.fetchedAt) > this.now() + 2 ||
      (source.sourceAsOf !== null && utcSeconds(source.sourceAsOf) > this.now() + 2)
    )
      throw new VaultError("invalid_data");
    const ids = source.response.items.map((item) =>
      source.kind === "watchlist" ? item.symbol : item.followId,
    );
    if (new Set(ids).size !== ids.length) throw new VaultError("invalid_data");
    return value;
  }
  async validateAgentPreparation(packet: AgentPreparationPacket) {
    const { registry, device, vault } = this.ready();
    exact(packet, [
      "preparationId",
      "connectionId",
      "taskId",
      "registrySequence",
      "checkpointDigest",
      "keyEpoch",
      "objects",
      "commit",
      "deliveryPin",
    ]);
    for (const id of [packet.preparationId, packet.connectionId, packet.taskId])
      validate("Identifier", id);
    const history = vault.registryHistory.find(
      (bundle) =>
        parsed(unb64(bundle.checkpoint.payload)).registrySequence === packet.registrySequence,
    );
    if (
      packet.keyEpoch !== registry.checkpoint.keyEpoch ||
      !history ||
      (await sha(canonical(parsed(unb64(history.checkpoint.payload))))) !==
        packet.checkpointDigest ||
      !Array.isArray(packet.objects) ||
      packet.objects.length < 1 ||
      packet.objects.length > 11
    )
      throw new VaultError("stale_epoch");
    for (const item of packet.objects) {
      exact(item, ["objectId", "operationId", "authorKeyId", "envelope", "envelopeFingerprint"]);
      validate("Carrier", item.envelope);
      validate("OperationIdentifier", item.operationId);
      const author = cert(registry, item.authorKeyId, "device_sig", this.now());
      const message = await verified(item.envelope.signedObject, author.publicJwk, "fv-object+jws");
      validate("ObjectMessage", message);
      for (const recipient of message.context.recipients) {
        const current = cert(registry, recipient.keyId, undefined, this.now());
        if (
          !equal(recipient, this.taskRecipient(current)) ||
          (current.role === "agent_enc"
            ? current.connectionId !== packet.connectionId
            : current.connectionId !== null ||
              !["device_enc", "recovery_enc"].includes(current.role))
        )
          throw new VaultError("key_revoked");
      }

      if (
        !author.capabilities.includes("object_write") ||
        message.context.ownerSubject !== (await this.owner) ||
        message.context.vaultId !== vault.vaultId ||
        message.context.stableOperationId !== item.operationId ||
        message.context.objectId !== item.objectId ||
        message.context.authorSigningKeyId !== item.authorKeyId ||
        message.context.checkpointDigest !== packet.checkpointDigest ||
        message.context.registrySequence !== packet.registrySequence ||
        message.context.keyEpoch !== registry.checkpoint.keyEpoch ||
        (await signingFingerprint(item.envelope.signedObject)) !== item.envelopeFingerprint ||
        !message.context.recipients.some(
          (r: Json) => r.role === "agent_enc" && r.connectionId === packet.connectionId,
        )
      )
        throw new VaultError("binding_mismatch");
    }
    validate("OperationIdentifier", packet.commit.operationId);
    exact(packet.commit.body, ["contractVersion", "objects"]);
    if (
      packet.commit.body.contractVersion !== CONTRACT ||
      !equal(
        packet.commit.body.objects,
        packet.objects.map(({ objectId, envelopeFingerprint }) => ({
          objectId,
          envelopeFingerprint,
        })),
      )
    )
      throw new VaultError("binding_mismatch");
    void device;
    return packet;
  }
  async signSource(sourceId: string) {
    const { registry, device, vault } = this.ready();
    const operationId = randomId();
    const command = {
      artifactType: "control_command",
      contractVersion: CONTRACT,
      vaultId: vault.vaultId,
      ownerSubject: await this.owner,
      stableOperationId: operationId,
      action: "manual_source_create",
      targetId: sourceId,
      expectedVersion: 0,
      expectedSourceEpoch: null,
      registrySequence: registry.checkpoint.registrySequence,
      checkpointDigest: registry.digest,
      keyEpoch: registry.checkpoint.keyEpoch,
      parameters: {},
    };
    validate("ControlCommandPayload", command);
    return {
      operationId,
      command: await sign(command, device.sig, device.sigId),
      authorKeyId: device.sigId,
    };
  }
  async prepareSourceCreation(sourceId: string): Promise<SourceCreationPacket> {
    validate("Identifier", sourceId);
    const { registry, device } = this.ready();
    if (
      !cert(registry, device.sigId, "device_sig", this.now()).capabilities.includes("control_write")
    )
      throw new VaultError("key_revoked");
    return { sourceId, ...(await this.signSource(sourceId)) };
  }
  async validateSourceCreation(packet: SourceCreationPacket): Promise<SourceCreationPacket> {
    bounded(packet, 66560);
    exact(packet, ["sourceId", "operationId", "authorKeyId", "command"]);
    validate("Identifier", packet.sourceId);
    validate("OperationIdentifier", packet.operationId);
    const { command } = await this.sourceControl(packet.command, packet.authorKeyId);
    if (
      command.action !== "manual_source_create" ||
      command.targetId !== packet.sourceId ||
      command.stableOperationId !== packet.operationId ||
      command.expectedVersion !== 0 ||
      command.expectedSourceEpoch !== null ||
      !equal(command.parameters, {})
    )
      throw new VaultError("binding_mismatch");
    return packet;
  }
  async verifySourceCreation(packet: SourceCreationPacket, source: Source): Promise<void> {
    await this.validateSourceCreation(packet);
    exact(source, ["resourceRef", "sourceEpoch"]);
    this.binding(source, 1);
    if (
      source.resourceRef.resourceId !== packet.sourceId ||
      source.resourceRef.incarnation !==
        "inc_" + (await signingFingerprint(packet.command)).slice(0, 32)
    )
      throw new VaultError("binding_mismatch");
  }
  async discardSourceCreation(
    packet: SourceCreationPacket,
    currentVault: Vault,
    sources: Source[],
  ): Promise<void> {
    await this.validateSourceCreation(packet);
    const { command } = await this.sourceControl(packet.command, packet.authorKeyId);
    const current = await this.checkVault(currentVault, this.pin);
    if (
      current.checkpoint.registrySequence <= command.registrySequence ||
      (await sha(
        canonical(
          parsed(
            unb64(currentVault.registryHistory[command.registrySequence - 1].checkpoint.payload),
          ),
        ),
      )) !== command.checkpointDigest
    )
      throw new VaultError("binding_mismatch");
    bounded(sources, 16384);
    if (!Array.isArray(sources) || sources.length > 10) throw new VaultError("invalid_data");
    const seen = new Set<string>();
    for (const source of sources) {
      exact(source, ["resourceRef", "sourceEpoch"]);
      this.binding(source, 1);
      if (
        seen.has(source.resourceRef.resourceId) ||
        source.resourceRef.resourceId === packet.sourceId
      )
        throw new VaultError("binding_mismatch");
      seen.add(source.resourceRef.resourceId);
    }
  }
  async signSourceMutation(args: {
    source: Source;
    expectedVersion: number;
    action: SourceMutationAction;
  }): Promise<SourceMutationPacket> {
    exact(args, ["source", "expectedVersion", "action"]);
    exact(args.source, ["resourceRef", "sourceEpoch"]);
    this.binding(args.source, 1);
    positive(args.expectedVersion);
    positive(args.expectedVersion + 1);
    positive(args.source.sourceEpoch + 1);
    const actions = {
      fence: "resource_fence_request",
      disconnect: "source_disconnect",
      delete: "source_delete",
    };
    if (!Object.hasOwn(actions, args.action)) throw new VaultError("invalid_data");
    const { registry, device, vault } = this.ready();
    if (
      !cert(registry, device.sigId, "device_sig", this.now()).capabilities.includes("control_write")
    )
      throw new VaultError("key_revoked");
    const operationId = randomId() + (await sha(canonical(args.source)));
    const command = {
      artifactType: "control_command",
      contractVersion: CONTRACT,
      vaultId: vault.vaultId,
      ownerSubject: await this.owner,
      stableOperationId: operationId,
      action: actions[args.action],
      targetId: args.source.resourceRef.resourceId,
      expectedVersion: args.expectedVersion,
      expectedSourceEpoch: args.source.sourceEpoch,
      registrySequence: registry.checkpoint.registrySequence,
      checkpointDigest: registry.digest,
      keyEpoch: registry.checkpoint.keyEpoch,
      parameters: args.action === "fence" ? { resourceRef: args.source.resourceRef } : {},
    };
    validate("ControlCommandPayload", command);
    return {
      operationId,
      authorKeyId: device.sigId,
      action: args.action,
      source: args.source,
      body: {
        contractVersion: CONTRACT,
        expectedVersion: args.expectedVersion,
        expectedSourceEpoch: args.source.sourceEpoch,
        command: await sign(command, device.sig, device.sigId),
      },
    };
  }
  private async sourceControl(signed: Signed, authorKeyId: string) {
    if (!this.root || !this.wrapping || !this.vault || !this.pin) throw new VaultError("locked");
    const vault = this.vault;
    await this.checkVault(vault, this.pin);
    validate("KeyId", authorKeyId);
    validate("SignedObject", signed);
    const command = parsed(unb64(signed.payload, 65536));
    validate("ControlCommandPayload", command);
    if (command.ownerSubject !== (await this.owner) || command.vaultId !== vault.vaultId)
      throw new VaultError("binding_mismatch");
    let historical: Registry | undefined;
    for (let i = 0; i < command.registrySequence; i++) {
      if (!vault.registryHistory[i]) throw new VaultError("untrusted_vault");
      historical = await verifyRegistry(
        vault.registryHistory[i],
        vault.rootJwk,
        await this.owner,
        vault.vaultId,
        historical,
        this.now(),
      );
      if (historical.checkpoint.registrySequence !== i + 1) throw new VaultError("untrusted_vault");
    }
    if (
      !historical ||
      historical.digest !== command.checkpointDigest ||
      historical.checkpoint.keyEpoch !== command.keyEpoch
    )
      throw new VaultError("untrusted_vault");
    const author = historical.certificates.get(authorKeyId);
    if (
      !author ||
      author.role !== "device_sig" ||
      author.connectionId !== null ||
      !author.capabilities.includes("control_write")
    )
      throw new VaultError("invalid_signature");
    const possibleAt = Math.max(historical.checkpoint.issuedAt, author.notBefore);
    if (possibleAt > this.now()) throw new VaultError("untrusted_vault");
    cert(historical, author.keyId, "device_sig", possibleAt);
    await verified(signed, author.publicJwk);
    return { vault, historical, author, command };
  }
  /** Authenticate an original public control, without restoring its signing authority. */
  private async sourceMutationPacket(packet: SourceMutationPacket) {
    if (!this.root || !this.wrapping || !this.vault || !this.pin) throw new VaultError("locked");
    const vault = this.vault;
    await this.checkVault(vault, this.pin);
    bounded(packet, 67584);
    exact(packet, ["operationId", "authorKeyId", "action", "source", "body"]);
    exact(packet.source, ["resourceRef", "sourceEpoch"]);
    this.binding(packet.source, 1);
    positive(packet.source.sourceEpoch + 1);
    validate("OperationIdentifier", packet.operationId);
    if (
      packet.operationId.length !== 86 ||
      packet.operationId.slice(22) !== (await sha(canonical(packet.source)))
    )
      throw new VaultError("binding_mismatch");
    validate("KeyId", packet.authorKeyId);
    exact(packet.body, ["contractVersion", "expectedVersion", "expectedSourceEpoch", "command"]);
    positive(packet.body.expectedVersion);
    positive(packet.body.expectedVersion + 1);
    const actions = {
      fence: "resource_fence_request",
      disconnect: "source_disconnect",
      delete: "source_delete",
    };
    if (!Object.hasOwn(actions, packet.action)) throw new VaultError("invalid_data");
    validate("SignedObject", packet.body.command);
    const command = parsed(unb64(packet.body.command.payload, 65536));
    validate("ControlCommandPayload", command);
    if (
      packet.body.contractVersion !== CONTRACT ||
      packet.body.expectedSourceEpoch !== packet.source.sourceEpoch ||
      command.ownerSubject !== (await this.owner) ||
      command.vaultId !== vault.vaultId ||
      command.stableOperationId !== packet.operationId ||
      command.action !== actions[packet.action] ||
      command.targetId !== packet.source.resourceRef.resourceId ||
      command.expectedVersion !== packet.body.expectedVersion ||
      command.expectedSourceEpoch !== packet.source.sourceEpoch ||
      !equal(
        command.parameters,
        packet.action === "fence" ? { resourceRef: packet.source.resourceRef } : {},
      )
    )
      throw new VaultError("binding_mismatch");
    return this.sourceControl(packet.body.command, packet.authorKeyId);
  }
  async validateSourceMutation(packet: SourceMutationPacket): Promise<SourceMutationPacket> {
    await this.sourceMutationPacket(packet);
    return packet;
  }
  async discardSourceMutation(
    packet: SourceMutationPacket,
    currentSource: Source,
    currentAuthorityVersion?: number,
  ): Promise<void> {
    await this.validateSourceMutation(packet);
    exact(currentSource, ["resourceRef", "sourceEpoch"]);
    this.binding(currentSource, 1);
    if (currentAuthorityVersion !== undefined) positive(currentAuthorityVersion);
    if (
      !equal(currentSource.resourceRef, packet.source.resourceRef) ||
      currentSource.sourceEpoch < packet.source.sourceEpoch ||
      !(
        currentSource.sourceEpoch > packet.source.sourceEpoch ||
        (currentAuthorityVersion !== undefined &&
          currentAuthorityVersion > packet.body.expectedVersion)
      )
    )
      throw new VaultError("binding_mismatch");
  }
  async verifySourceMutationReceipt(
    packet: SourceMutationPacket,
    receipt: SourceMutationReceipt,
  ): Promise<SourceMutationReceipt> {
    const { vault, historical, author, command } = await this.sourceMutationPacket(packet);
    bounded(receipt, 4096);
    exact(receipt, [
      "contractVersion",
      "operationId",
      "action",
      "resourceRef",
      "sourceEpoch",
      "state",
      "requestedAt",
      "completedAt",
    ]);
    if (
      receipt.contractVersion !== CONTRACT ||
      receipt.operationId !== packet.operationId ||
      receipt.action !== packet.action ||
      !equal(receipt.resourceRef, packet.source.resourceRef) ||
      receipt.sourceEpoch !== packet.source.sourceEpoch + 1 ||
      !["pending", "acknowledged"].includes(receipt.state)
    )
      throw new VaultError("binding_mismatch");
    const requested = utcSeconds(receipt.requestedAt);
    if (
      requested < historical.checkpoint.issuedAt ||
      (receipt.state === "pending"
        ? receipt.completedAt !== null
        : receipt.completedAt === null || utcSeconds(receipt.completedAt) < requested)
    )
      throw new VaultError("binding_mismatch");
    cert(historical, author.keyId, "device_sig", requested);
    let acceptedRegistry = historical;
    for (let i = command.registrySequence; i < vault.registryHistory.length; i++) {
      const next = vault.registryHistory[i];
      if (parsed(unb64(next.checkpoint.payload)).issuedAt >= Math.floor(requested)) break;
      acceptedRegistry = await verifyRegistry(
        next,
        vault.rootJwk,
        await this.owner,
        vault.vaultId,
        acceptedRegistry,
        requested,
      );
      if (acceptedRegistry.checkpoint.keyEpoch !== command.keyEpoch)
        throw new VaultError("binding_mismatch");
      cert(acceptedRegistry, author.keyId, "device_sig", requested);
    }
    return receipt;
  }
  async signResultState(args: {
    metadata: ResultMetadata;
    changes: ResultStateChanges;
  }): Promise<ResultStatePacket> {
    const { registry, device, vault } = this.ready();
    if (
      !cert(registry, device.sigId, "device_sig", this.now()).capabilities.includes("control_write")
    )
      throw new VaultError("key_revoked");
    validate("ResultMetadata", args.metadata);
    const changes = args.changes;
    if (
      !changes ||
      typeof changes !== "object" ||
      Array.isArray(changes) ||
      !Object.keys(changes).length ||
      Object.keys(changes).some((k) => !["read", "starred", "archived"].includes(k)) ||
      Object.values(changes).some((v) => typeof v !== "boolean")
    )
      throw new VaultError("invalid_data");
    const operationId = randomId();
    const command = {
      artifactType: "control_command",
      contractVersion: CONTRACT,
      vaultId: vault.vaultId,
      ownerSubject: await this.owner,
      stableOperationId: operationId,
      action: "result_state_update",
      targetId: args.metadata.resultId,
      expectedVersion: args.metadata.stateVersion,
      expectedSourceEpoch: null,
      registrySequence: registry.checkpoint.registrySequence,
      checkpointDigest: registry.digest,
      keyEpoch: registry.checkpoint.keyEpoch,
      parameters: { ...changes },
    };
    validate("ControlCommandPayload", command);
    return {
      operationId,
      authorKeyId: device.sigId,
      command: await sign(command, device.sig, device.sigId),
    };
  }
  async openResult(args: OpenResultArgs): Promise<ResultContent> {
    this.requireOrdinarySession();
    if (!this.pin || !this.vault || !this.registry || !this.recovery || !this.recoveryJwk)
      throw new VaultError("locked");
    exact(args, ["result", "evidence", "registryBundles"]);
    const { result, evidence: e, registryBundles } = args,
      vault = this.vault;
    bounded(result, 1048576);
    bounded(e, 1048576);
    bounded(registryBundles, 4198400);
    validate("EncryptedResult", result);
    exact(e, [
      "contractVersion",
      "profile",
      "run",
      "manifest",
      "manifestFingerprint",
      "receipt",
      "agentKeyGrant",
      "authorizationExpiresAt",
      "provenance",
      "authorProof",
      "registryProofs",
    ]);
    resultRequire(
      e.contractVersion === CONTRACT && e.profile === "folioview.owner-result-evidence.v1",
    );
    validate("RunDescriptor", e.run);
    validate("ManifestDescriptor", e.manifest);
    validate("ResultReceipt", e.receipt);
    validate("SignedObject", e.agentKeyGrant);
    exact(e.authorProof, ["registrySequence", "verifiedAt"]);
    positive(e.authorizationExpiresAt);
    const accepted = Math.floor(utcSeconds(e.receipt.receivedAt));
    resultRequire(e.authorProof.verifiedAt === accepted && accepted <= this.now());
    resultRequire(
      Array.isArray(registryBundles) &&
        registryBundles.length >= 1 &&
        registryBundles.length <= 32 &&
        Array.isArray(e.registryProofs) &&
        e.registryProofs.length === registryBundles.length &&
        e.authorProof.registrySequence === registryBundles.length,
    );
    const history = new Map<number, Registry>();
    let historical: Registry | undefined;
    for (let i = 0; i < registryBundles.length; i++) {
      historical = await verifyRegistry(
        registryBundles[i],
        vault.rootJwk,
        await this.owner,
        vault.vaultId,
        historical,
        accepted,
      );
      const descriptor = e.registryProofs[i];
      exact(descriptor, ["registrySequence", "checkpointDigest", "path"]);
      resultRequire(
        historical.checkpoint.registrySequence === i + 1 &&
          descriptor.registrySequence === i + 1 &&
          descriptor.checkpointDigest === historical.digest &&
          descriptor.path ===
            `/api/v2/results/${result.metadata.resultId}/revisions/${result.metadata.revision}/registries/${i + 1}` &&
          vault.registryHistory[i] &&
          equal(vault.registryHistory[i].checkpoint, registryBundles[i].checkpoint),
      );
      history.set(i + 1, historical);
    }
    const registry = historical!;
    resultRequire(
      equal(result.keyProofs, {
        checkpoint: registry.bundle.checkpoint,
        certificates: registry.bundle.entries.map((v) => v.certificate),
      }),
    );
    const grantHeader = parsed(unb64(e.agentKeyGrant.protected, 1024), false);
    const grantDevice = cert(registry, grantHeader.kid, "device_sig", accepted);
    resultRequire(
      grantDevice.connectionId === null && grantDevice.capabilities.includes("task_grant"),
    );
    const grant = await verified(e.agentKeyGrant, grantDevice.publicJwk);
    validate("AgentKeyGrantPayload", grant);
    const owner = await this.owner;
    const reference = (value: Json) =>
      value.ownerSubject === owner &&
      value.vaultId === vault.vaultId &&
      value.keyEpoch === registry.checkpoint.keyEpoch &&
      history.get(value.registrySequence)?.digest === value.checkpointDigest &&
      history.get(value.registrySequence)?.checkpoint.keyEpoch === value.keyEpoch;
    resultRequire(
      reference(grant) &&
        grant.deviceSigningKeyId === grantDevice.keyId &&
        grant.capabilities.includes("encrypt_result") &&
        grant.capabilities.includes("decrypt_task") &&
        equal(
          grant.taskVersions,
          [...grant.taskVersions].sort((a, b) => a - b),
        ) &&
        grant.notBefore <= accepted &&
        accepted < grant.expiresAt &&
        grant.expiresAt - grant.notBefore <= 2592000,
    );
    const agent = cert(registry, grant.agentSigningKeyId, "agent_sig", accepted),
      encryption = cert(registry, grant.agentEncryptionKeyId, "agent_enc", accepted);
    resultRequire(
      agent.connectionId === grant.connectionId &&
        encryption.connectionId === grant.connectionId &&
        agent.principalId === encryption.principalId &&
        agent.keyId !== encryption.keyId &&
        agent.keyEpoch === grant.agentSigningKeyEpoch &&
        encryption.keyEpoch === grant.agentEncryptionKeyEpoch &&
        agent.capabilities.includes("result_write") &&
        agent.capabilities.includes("run_request") &&
        grant.notBefore >= Math.max(grantDevice.notBefore, agent.notBefore, encryption.notBefore) &&
        grant.expiresAt <=
          Math.min(
            e.authorizationExpiresAt,
            grantDevice.expiresAt,
            agent.expiresAt,
            encryption.expiresAt,
          ),
    );
    const recipientIds = grant.writebackRecipientKeyIds as string[];
    resultRequire(equal(recipientIds, [...new Set(recipientIds)].sort()));
    const recipients = recipientIds.map((id) => cert(registry, id, undefined, accepted));
    resultRequire(
      recipients.every(
        (v) =>
          ["device_enc", "recovery_enc"].includes(v.role) &&
          v.connectionId === null &&
          grant.notBefore >= v.notBefore &&
          grant.expiresAt <= v.expiresAt,
      ) &&
        recipients.some((v) => v.role === "device_enc") &&
        recipients.some((v) => v.role === "recovery_enc"),
    );
    const refs = (grant.resourceBindings as Json[]).map((v) => canonical(v.ref));
    resultRequire(
      new Set(refs).size === refs.length &&
        grant.resourceBindings.every((v: Json) =>
          equal(
            v.selectedVersions,
            [...v.selectedVersions].sort((a, b) => a - b),
          ),
        ),
    );

    const run = e.run,
      manifest = e.manifest,
      meta = result.metadata;
    bounded(manifest, 262144);
    resultRequire(
      run.vaultId === vault.vaultId &&
        ["ready", "submitted"].includes(run.state) &&
        run.initialResultId === meta.resultId &&
        grant.taskVersions.includes(run.taskVersion) &&
        meta.revision <= 32 &&
        meta.deliveryRevision === 1,
    );
    for (const name of [
      "taskId",
      "connectionId",
      "authorizationId",
      "grantId",
      "grantEpoch",
      "executionEpoch",
      "keyEpoch",
    ])
      resultRequire(run[name] === grant[name]);
    for (const name of ["taskId", "taskVersion", "runId", "connectionId", "manifestId", "keyEpoch"])
      resultRequire(meta[name as keyof ResultMetadata] === run[name]);
    for (const name of [
      "vaultId",
      "runId",
      "taskId",
      "taskVersion",
      "connectionId",
      "grantId",
      "grantEpoch",
      "executionEpoch",
      "keyEpoch",
      "beginIntentFingerprint",
      "manifestId",
    ])
      resultRequire(manifest[name] === run[name]);
    const lifetime = (v: Json) => {
      const created = utcSeconds(v.createdAt),
        expires = utcSeconds(v.expiresAt);
      resultRequire(
        created <= accepted &&
          accepted < expires &&
          expires > created &&
          expires - created <= 7200 &&
          created >= grant.notBefore &&
          expires <= grant.expiresAt,
      );
      return { created, expires };
    };
    const rt = lifetime(run),
      mt = lifetime(manifest);
    resultRequire(
      mt.created >= rt.created &&
        mt.expires <= rt.expires &&
        manifest.taskEnvelope.objectId === run.taskId &&
        manifest.taskEnvelope.revision === run.taskVersion &&
        manifest.taskEnvelope.keyEpoch === run.keyEpoch,
    );
    resultRequire(e.manifestFingerprint === (await sha(canonical(manifest))));
    const intent = await verified(manifest.signedBeginIntent, agent.publicJwk);
    validate("BeginRunIntentPayload", intent);
    resultRequire(
      reference(intent) &&
        intent.expectedTaskVersion === run.taskVersion &&
        intent.taskEnvelopeFingerprint === manifest.taskEnvelope.envelopeFingerprint &&
        (await signingFingerprint(manifest.signedBeginIntent)) === run.beginIntentFingerprint,
    );
    for (const name of [
      "taskId",
      "connectionId",
      "authorizationId",
      "grantId",
      "grantEpoch",
      "executionEpoch",
    ])
      resultRequire(intent[name] === grant[name]);
    const namespace = [
      owner,
      vault.vaultId,
      grant.connectionId,
      grant.authorizationId,
      grant.grantId,
      grant.grantEpoch,
      grant.taskId,
      intent.stableOperationId,
      run.beginIntentFingerprint,
    ];
    for (const [field, prefix, domain] of [
      ["runId", "run_", "run"],
      ["manifestId", "manifest_", "manifest"],
      ["initialResultId", "result_", "result"],
    ])
      resultRequire(
        run[field] ===
          prefix + (await sha(canonical([`folioview.${domain}-allocation.v1`, ...namespace]))),
      );
    const selected = manifest.entries.map((v: Json) => ({
      ref: v.ref,
      revision: v.revision,
      sourceEpoch: v.sourceEpoch,
      envelopeFingerprint: v.envelopeFingerprint,
    }));
    resultRequire(
      equal(selected, intent.resourceVersions) &&
        new Set(manifest.entries.map((v: Json) => canonical(v.ref))).size ===
          manifest.entries.length &&
        (!manifest.entries.length || grant.capabilities.includes("decrypt_resources")),
    );
    for (const entry of manifest.entries) {
      const binding = grant.resourceBindings.find((v: Json) => equal(v.ref, entry.ref));
      resultRequire(
        binding &&
          entry.sourceEpoch === binding.sourceEpoch &&
          entry.keyEpoch === run.keyEpoch &&
          entry.objectType ===
            {
              holdings: "holdings_snapshot",
              watchlist: "watchlist_evidence",
              channel_follows: "channel_follows_evidence",
            }[entry.ref.kind as string] &&
          (binding.versionAccess !== "selected" ||
            binding.selectedVersions.includes(entry.revision)),
      );
    }
    const expectedBinding = {
      taskId: run.taskId,
      taskVersion: run.taskVersion,
      runId: run.runId,
      manifestId: run.manifestId,
      taskEnvelopeFingerprint: manifest.taskEnvelope.envelopeFingerprint,
      manifestFingerprint: e.manifestFingerprint,
      connectionId: run.connectionId,
      grantId: run.grantId,
      grantEpoch: run.grantEpoch,
      executionEpoch: run.executionEpoch,
      resourceRef: null,
      sourceRevision: null,
      sourceEpoch: null,
    };
    const message = await verified(result.signedObject, agent.publicJwk, "fv-object+jws");
    validate("ObjectMessage", message);
    const c = message.context;
    validate("Context", c);
    resultRequire(
      reference(c) &&
        c.rootKeyId === vault.rootKeyId &&
        c.rootEpoch === 1 &&
        c.objectId === meta.resultId &&
        c.objectType === "result_revision" &&
        c.revision === meta.revision &&
        c.deliveryRevision === 1 &&
        c.priorEnvelopeFingerprint === null &&
        c.expectedRevision === c.revision - 1 &&
        c.operationType === (c.revision === 1 ? "submit_result" : "revise_result") &&
        c.authorSigningKeyId === agent.keyId &&
        equal(c.binding, expectedBinding) &&
        equal(c.resourceBindings, []) &&
        equal(
          c.recipients,
          recipients.map((v) => ({
            keyId: v.keyId,
            role: v.role,
            principalId: v.principalId,
            connectionId: v.connectionId,
            keyEpoch: v.keyEpoch,
          })),
        ),
    );
    const fingerprint = await signingFingerprint(result.signedObject);
    resultRequire(fingerprint === meta.envelopeFingerprint);
    const receipt = e.receipt;
    for (const [name, value] of Object.entries({
      vaultId: vault.vaultId,
      resultId: c.objectId,
      runId: run.runId,
      taskId: run.taskId,
      revision: c.revision,
      deliveryRevision: c.deliveryRevision,
      stableOperationId: c.stableOperationId,
      envelopeFingerprint: fingerprint,
      resultPath: `/results/${c.objectId}?revision=${c.revision}`,
    }))
      resultRequire(receipt[name] === value);
    exact(e.provenance, [
      "kind",
      "provider",
      "clientId",
      "connectionId",
      "authorizationId",
      "agentPrincipalId",
    ]);
    resultRequire(
      e.provenance.kind === "authorized_connection_submission" &&
        e.provenance.provider === "muse" &&
        e.provenance.connectionId === grant.connectionId &&
        e.provenance.authorizationId === grant.authorizationId &&
        e.provenance.agentPrincipalId === agent.principalId,
    );
    validate("Identifier", e.provenance.clientId);
    const jwe = message.jwe;
    exact(jwe, ["protected", "recipients", "iv", "ciphertext", "tag", "aad"]);
    resultRequire(
      equal(parsed(unb64(jwe.protected, 1024), false), JWE_HEADER) &&
        jwe.aad === b64(utf8.encode(canonical(c))) &&
        Array.isArray(jwe.recipients) &&
        jwe.recipients.length === recipients.length &&
        unb64(jwe.iv, 12).length === 12 &&
        unb64(jwe.tag, 16).length === 16,
    );
    for (let i = 0; i < jwe.recipients.length; i++) {
      const recipient = jwe.recipients[i];
      exact(recipient, ["header", "encrypted_key"]);
      exact(recipient.header, ["kid", "epk"]);
      resultRequire(
        recipient.header.kid === recipientIds[i] &&
          unb64(recipient.encrypted_key, 40).length === 40,
      );
      validate("PublicJWK", recipient.header.epk);
    }
    const selectedKey = await this.reader(recipientIds);
    let plaintext: Uint8Array | undefined;
    try {
      const opened = await generalDecrypt(jwe, selectedKey, {
        keyManagementAlgorithms: ["ECDH-ES+A256KW"],
        contentEncryptionAlgorithms: ["A256GCM"],
      });
      plaintext = opened.plaintext;
      resultRequire(
        equal(
          Array.from(opened.additionalAuthenticatedData ?? []),
          Array.from(utf8.encode(canonical(c))),
        ),
      );
      const payload = parsed(plaintext);
      bounded(payload, 196608);
      validate("PrivatePayload", payload);
      resultRequire(
        payload.objectId === c.objectId &&
          payload.objectType === c.objectType &&
          payload.revision === c.revision &&
          equal(payload.binding, c.binding),
      );
      return checkedResultContent(payload.payload);
    } catch (error) {
      if (error instanceof VaultError) throw error;
      throw new VaultError("decryption_failed");
    } finally {
      plaintext?.fill(0);
    }
  }
  private taskBinding(taskId: string, taskVersion: number) {
    return {
      taskId,
      taskVersion,
      runId: null,
      manifestId: null,
      taskEnvelopeFingerprint: null,
      manifestFingerprint: null,
      connectionId: null,
      grantId: null,
      grantEpoch: null,
      executionEpoch: null,
      resourceRef: null,
      sourceRevision: null,
      sourceEpoch: null,
    };
  }
  private taskSelection(registry: Registry, now: number) {
    const eligible: Json[] = [];
    for (const id of [...registry.active].sort()) {
      try {
        const c = cert(registry, id, undefined, now);
        if (c.connectionId === null) eligible.push(c);
      } catch (error) {
        if (!(error instanceof VaultError) || error.code !== "key_revoked") throw error;
      }
    }
    const writers = eligible.filter(
      (c) => c.role === "device_sig" && c.capabilities.includes("object_write"),
    );
    const recipients = eligible.filter((c) => ["device_enc", "recovery_enc"].includes(c.role));
    if (
      writers.length < 1 ||
      writers.length > 8 ||
      recipients.length < 2 ||
      recipients.length > 8 ||
      !recipients.some((c) => c.role === "device_enc") ||
      !recipients.some((c) => c.role === "recovery_enc")
    )
      throw new VaultError("invalid_registry");
    return { writers, recipients };
  }
  private taskRecipient(c: Json) {
    return {
      keyId: c.keyId,
      role: c.role,
      principalId: c.principalId,
      connectionId: c.connectionId,
      keyEpoch: c.keyEpoch,
    };
  }
  private taskJwe(message: Json, recipients: Json[]) {
    const jwe = message.jwe;
    exact(jwe, ["protected", "recipients", "iv", "ciphertext", "tag", "aad"]);
    resultRequire(
      equal(parsed(unb64(jwe.protected, 1024), false), JWE_HEADER) &&
        jwe.aad === b64(utf8.encode(canonical(message.context))) &&
        Array.isArray(jwe.recipients) &&
        jwe.recipients.length === recipients.length &&
        unb64(jwe.iv, 12).length === 12 &&
        unb64(jwe.tag, 16).length === 16,
    );
    for (let i = 0; i < recipients.length; i++) {
      const item = jwe.recipients[i];
      exact(item, ["header", "encrypted_key"]);
      exact(item.header, ["kid", "epk"]);
      resultRequire(
        item.header.kid === recipients[i].keyId && unb64(item.encrypted_key, 40).length === 40,
      );
      validate("PublicJWK", item.header.epk);
    }
    return jwe;
  }
  async taskAuthority(current?: EncryptedTask | null) {
    const { registry, device } = this.ready();
    const { writers, recipients } = this.taskSelection(registry, this.now());
    resultRequire(writers.some((c) => c.keyId === device.sigId));
    let previousRecipientKeyIds: string[] | undefined;
    if (current) {
      await this.openTask(current);
      previousRecipientKeyIds = parsed(
        unb64(current.signedObject.payload, 524288),
      ).context.recipients.map((r: Json) => r.keyId);
    }
    return {
      keyEpoch: registry.checkpoint.keyEpoch,
      registrySequence: registry.checkpoint.registrySequence,
      checkpointDigest: registry.digest,
      recipientKeyIds: recipients.map((c) => c.keyId),
      ...(previousRecipientKeyIds ? { previousRecipientKeyIds } : {}),
    };
  }
  async openTask(task: EncryptedTask): Promise<TaskContent> {
    this.requireOrdinarySession();
    if (!this.pin || !this.vault || !this.recovery || !this.recoveryJwk)
      throw new VaultError("locked");
    bounded(task, 1048576);
    validate("EncryptedTask", task);
    const vault = this.vault,
      owner = await this.owner,
      m = task.metadata;
    const written = Math.floor(utcSeconds(m.updatedAt));
    resultRequire(
      written >= 0 &&
        written <= this.now() &&
        utcSeconds(m.createdAt) >= 0 &&
        Math.floor(utcSeconds(m.createdAt)) <= written &&
        m.vaultId === vault.vaultId &&
        m.taskVersion === m.objectRevision &&
        m.deliveryRevision === 1 &&
        task.contractVersion === CONTRACT,
    );
    const matching = vault.registryHistory
      .map((b, i) => ({ b, i }))
      .filter(({ b }) =>
        equal(task.keyProofs, {
          checkpoint: b.checkpoint,
          certificates: b.entries.map((v) => v.certificate),
        }),
      );
    resultRequire(matching.length === 1);
    let registry: Registry | undefined;
    for (let i = 0; i <= matching[0].i; i++) {
      registry = await verifyRegistry(
        vault.registryHistory[i],
        vault.rootJwk,
        owner,
        vault.vaultId,
        registry,
        written,
      );
      resultRequire(registry.checkpoint.registrySequence === i + 1);
    }
    const historical = registry!,
      { writers, recipients } = this.taskSelection(historical, written);
    const raw = parsed(unb64(task.signedObject.payload, 524288));
    validate("ObjectMessage", raw);
    const author = cert(historical, raw.context.authorSigningKeyId, "device_sig", written);
    resultRequire(writers.some((w) => w.keyId === author.keyId));
    const message = await verified(task.signedObject, author.publicJwk, "fv-object+jws");
    validate("ObjectMessage", message);
    const c = message.context;
    validate("Context", c);
    resultRequire(
      c.contractVersion === CONTRACT &&
        c.profileId === "P1" &&
        c.ownerSubject === owner &&
        c.vaultId === vault.vaultId &&
        c.rootKeyId === this.pin.rootKeyId &&
        c.rootEpoch === 1 &&
        c.registrySequence === historical.checkpoint.registrySequence &&
        c.checkpointDigest === historical.digest &&
        c.keyEpoch === historical.checkpoint.keyEpoch &&
        c.keyEpoch === m.keyEpoch &&
        c.objectType === "task" &&
        c.objectId === m.taskId &&
        c.revision === m.taskVersion &&
        c.expectedRevision === m.taskVersion - 1 &&
        c.deliveryRevision === 1 &&
        c.priorEnvelopeFingerprint === null &&
        c.authorSigningKeyId === author.keyId &&
        (m.taskVersion === 1
          ? c.operationType === "create_task"
          : ["update_task", "transition_task"].includes(c.operationType)) &&
        equal(c.binding, this.taskBinding(m.taskId, m.taskVersion)) &&
        equal(c.resourceBindings, taskBindings(m.resourceBindings)) &&
        equal(
          c.recipients,
          recipients.map((r) => this.taskRecipient(r)),
        ) &&
        (await signingFingerprint(task.signedObject)) === m.envelopeFingerprint,
    );
    const jwe = this.taskJwe(message, recipients);
    const selected = await this.reader(recipients.map((r) => r.keyId));
    let plaintext: Uint8Array | undefined;
    try {
      const opened = await generalDecrypt(jwe, selected, {
        keyManagementAlgorithms: ["ECDH-ES+A256KW"],
        contentEncryptionAlgorithms: ["A256GCM"],
      });
      plaintext = opened.plaintext;
      resultRequire(
        equal(
          Array.from(opened.additionalAuthenticatedData ?? []),
          Array.from(utf8.encode(canonical(c))),
        ),
      );
      const payload = parsed(plaintext);
      bounded(payload, 65536);
      validate("PrivatePayload", payload);
      resultRequire(
        payload.objectId === c.objectId &&
          payload.objectType === "task" &&
          payload.revision === c.revision &&
          equal(payload.binding, c.binding),
      );
      return checkedTaskContent(payload.payload, m.resourceBindings);
    } catch (error) {
      if (error instanceof VaultError) throw error;
      throw new VaultError("decryption_failed");
    } finally {
      plaintext?.fill(0);
    }
  }
  private async prepareTask(args: SealTaskArgs, action?: TaskAction): Promise<PendingTask> {
    const { registry, device, vault } = this.ready(),
      { writers, recipients } = this.taskSelection(registry, this.now());
    const author = cert(registry, device.sigId, "device_sig", this.now());
    resultRequire(
      writers.some((w) => w.keyId === device.sigId) &&
        (!action || author.capabilities.includes("control_write")),
    );
    if (args.current) {
      await this.openTask(args.current);
      if (args.current.metadata.status === "archived") throw new VaultError("version_conflict");
    }
    const resources = taskBindings(args.resourceBindings),
      content = checkedTaskContent(args.content, resources);
    const taskId = args.current?.metadata.taskId ?? args.taskId ?? randomId("task_");
    validate("Identifier", taskId);
    if (args.taskId !== undefined && args.taskId !== taskId)
      throw new VaultError("binding_mismatch");
    const previous = args.current?.metadata,
      expectedVersion = previous?.taskVersion ?? 0,
      version = expectedVersion + 1;
    const allowed: Record<string, TaskAction[]> = {
      active: ["pause", "archive"],
      paused: ["resume", "archive"],
      archived: [],
    };
    if (
      action &&
      (!previous ||
        !allowed[previous.status].includes(action) ||
        !equal(resources, previous.resourceBindings))
    )
      throw new VaultError("version_conflict");
    const operationId = randomId(),
      mode = action ? "transition" : previous ? "update" : "create";
    const context = {
      contractVersion: CONTRACT,
      profileId: "P1",
      ownerSubject: await this.owner,
      vaultId: vault.vaultId,
      rootKeyId: vault.rootKeyId,
      rootEpoch: registry.checkpoint.rootEpoch,
      registrySequence: registry.checkpoint.registrySequence,
      checkpointDigest: registry.digest,
      keyEpoch: registry.checkpoint.keyEpoch,
      objectId: taskId,
      objectType: "task",
      revision: version,
      deliveryRevision: 1,
      priorEnvelopeFingerprint: null,
      expectedRevision: expectedVersion,
      stableOperationId: operationId,
      operationType: action ? "transition_task" : previous ? "update_task" : "create_task",
      authorSigningKeyId: device.sigId,
      binding: this.taskBinding(taskId, version),
      resourceBindings: resources,
      recipients: recipients.map((r) => this.taskRecipient(r)),
    };
    validate("Context", context);
    bounded(context, 16384);
    const payload = {
      privateSchemaVersion: 2,
      objectId: taskId,
      objectType: "task",
      revision: version,
      binding: context.binding,
      payload: content,
    };
    validate("PrivatePayload", payload);
    bounded(payload, 65536);
    const encryptor = new GeneralEncrypt(utf8.encode(canonical(payload)))
      .setProtectedHeader(JWE_HEADER)
      .setAdditionalAuthenticatedData(utf8.encode(canonical(context)));
    for (const r of recipients)
      encryptor.addRecipient(await key(r.publicJwk)).setUnprotectedHeader({ kid: r.keyId });
    const envelope = {
      contractVersion: CONTRACT,
      signedObject: await sign(
        { context, jwe: await encryptor.encrypt() },
        device.sig,
        device.sigId,
        "fv-object+jws",
      ),
    };
    validate("Carrier", envelope);
    bounded(envelope, 524288);
    const fingerprint = await signingFingerprint(envelope.signedObject);
    let transitionIntent: Signed | undefined;
    if (action && previous) {
      const intent = {
        artifactType: "task_transition_intent",
        contractVersion: CONTRACT,
        vaultId: vault.vaultId,
        ownerSubject: await this.owner,
        stableOperationId: operationId,
        taskId,
        action,
        expectedVersion,
        nextTaskVersion: version,
        nextExecutionEpoch:
          previous.executionEpoch +
          Number(
            ["pause", "archive"].includes(action) ||
              previous.keyEpoch !== registry.checkpoint.keyEpoch,
          ),
        nextEnvelopeFingerprint: fingerprint,
        registrySequence: registry.checkpoint.registrySequence,
        checkpointDigest: registry.digest,
        keyEpoch: registry.checkpoint.keyEpoch,
      };
      validate("TaskTransitionIntentPayload", intent);
      transitionIntent = await sign(intent, device.sig, device.sigId);
    }
    const body = {
      contractVersion: CONTRACT,
      expectedVersion,
      resourceBindings: resources,
      envelope,
      ...(mode === "create" ? { taskId } : {}),
      ...(transitionIntent ? { transitionIntent } : {}),
    };
    bounded(body, 589824);
    return {
      taskId,
      operationId,
      authorKeyId: device.sigId,
      mode,
      body,
      envelopeFingerprint: fingerprint,
      keyEpoch: registry.checkpoint.keyEpoch,
      registrySequence: registry.checkpoint.registrySequence,
      checkpointDigest: registry.digest,
    };
  }
  async sealTask(args: SealTaskArgs) {
    exact(args, [
      "content",
      "resourceBindings",
      "current",
      ...(args.taskId === undefined ? [] : ["taskId"]),
    ]);
    return this.prepareTask(args);
  }
  async transitionTask(args: { current: EncryptedTask; action: TaskAction }) {
    exact(args, ["current", "action"]);
    const content = await this.openTask(args.current);
    return this.prepareTask(
      { content, resourceBindings: args.current.metadata.resourceBindings, current: args.current },
      args.action,
    );
  }
  async validateTaskPending(pending: PendingTask) {
    const { registry, vault } = this.ready(),
      { writers, recipients } = this.taskSelection(registry, this.now());
    exact(pending, [
      "taskId",
      "operationId",
      "authorKeyId",
      "mode",
      "body",
      "envelopeFingerprint",
      "keyEpoch",
      "registrySequence",
      "checkpointDigest",
    ]);
    validate("Identifier", pending.taskId);
    validate("OperationIdentifier", pending.operationId);
    if (!["create", "update", "transition"].includes(pending.mode))
      throw new VaultError("invalid_data");
    const p = pending.body;
    exact(p, [
      "contractVersion",
      "expectedVersion",
      "resourceBindings",
      "envelope",
      ...(pending.mode === "create" ? ["taskId"] : []),
      ...(pending.mode === "transition" ? ["transitionIntent"] : []),
    ]);
    bounded(p, 589824);
    positive(p.expectedVersion, 0);
    taskBindings(p.resourceBindings);
    validate("Carrier", p.envelope);
    resultRequire(
      p.contractVersion === CONTRACT &&
        (pending.mode === "create") === (p.expectedVersion === 0) &&
        (pending.mode !== "create" || p.taskId === pending.taskId),
    );
    if (
      pending.keyEpoch !== registry.checkpoint.keyEpoch ||
      pending.registrySequence !== registry.checkpoint.registrySequence ||
      pending.checkpointDigest !== registry.digest
    )
      throw new VaultError("stale_epoch");
    const author = cert(registry, pending.authorKeyId, "device_sig", this.now());
    resultRequire(writers.some((w) => w.keyId === author.keyId));
    const message = await verified(p.envelope.signedObject, author.publicJwk, "fv-object+jws");
    validate("ObjectMessage", message);
    const c = message.context;
    validate("Context", c);
    resultRequire(
      c.ownerSubject === (await this.owner) &&
        c.vaultId === vault.vaultId &&
        c.rootKeyId === vault.rootKeyId &&
        c.rootEpoch === 1 &&
        c.contractVersion === CONTRACT &&
        c.profileId === "P1" &&
        c.keyEpoch === pending.keyEpoch &&
        c.registrySequence === pending.registrySequence &&
        c.checkpointDigest === pending.checkpointDigest &&
        c.objectType === "task" &&
        c.objectId === pending.taskId &&
        c.revision === p.expectedVersion + 1 &&
        c.expectedRevision === p.expectedVersion &&
        c.deliveryRevision === 1 &&
        c.priorEnvelopeFingerprint === null &&
        c.stableOperationId === pending.operationId &&
        c.authorSigningKeyId === author.keyId &&
        c.operationType ===
          { create: "create_task", update: "update_task", transition: "transition_task" }[
            pending.mode
          ] &&
        equal(c.binding, this.taskBinding(pending.taskId, c.revision)) &&
        equal(c.resourceBindings, p.resourceBindings) &&
        equal(
          c.recipients,
          recipients.map((r) => this.taskRecipient(r)),
        ) &&
        (await signingFingerprint(p.envelope.signedObject)) === pending.envelopeFingerprint,
    );
    this.taskJwe(message, recipients);
    if (pending.mode === "transition") {
      resultRequire(author.capabilities.includes("control_write"));
      const intent = await verified(p.transitionIntent!, author.publicJwk);
      validate("TaskTransitionIntentPayload", intent);
      for (const [name, value] of Object.entries({
        ownerSubject: await this.owner,
        vaultId: vault.vaultId,
        taskId: pending.taskId,
        stableOperationId: pending.operationId,
        expectedVersion: p.expectedVersion,
        nextTaskVersion: c.revision,
        nextEnvelopeFingerprint: pending.envelopeFingerprint,
        keyEpoch: pending.keyEpoch,
        registrySequence: pending.registrySequence,
        checkpointDigest: pending.checkpointDigest,
      }))
        resultRequire(intent[name] === value);
    }
    return pending;
  }
  async sealDraft(args: TaskDraftSummary & { draft: TaskDraft }): Promise<Json> {
    this.requireOrdinarySession();
    if (!this.wrapping || !this.vault || !this.pin) throw new VaultError("locked");
    exact(args, ["slot", "revision", "baseVersion", "taskId", "draft"]);
    positive(args.revision);
    positive(args.baseVersion, 0);
    validate("Identifier", args.taskId);
    if (args.slot !== "new" && args.slot !== args.taskId) throw new VaultError("binding_mismatch");
    checkedTaskDraft(args.draft);
    return seal(
      this.wrapping,
      {
        profile: "folioview.task-draft.v1",
        ownerSubject: await this.owner,
        vaultId: this.vault.vaultId,
        rootKeyId: this.pin.rootKeyId,
        slot: args.slot,
        revision: args.revision,
        baseVersion: args.baseVersion,
        taskId: args.taskId,
      },
      args.draft,
    );
  }
  async openDraft(record: Json): Promise<TaskDraftRecord> {
    this.requireOrdinarySession();
    if (!this.wrapping || !this.vault || !this.pin) throw new VaultError("locked");
    exact(record, [
      "profile",
      "ownerSubject",
      "vaultId",
      "rootKeyId",
      "slot",
      "revision",
      "baseVersion",
      "taskId",
      "iv",
      "ciphertext",
    ]);
    resultRequire(
      record.profile === "folioview.task-draft.v1" &&
        record.ownerSubject === (await this.owner) &&
        record.vaultId === this.vault.vaultId &&
        record.rootKeyId === this.pin.rootKeyId,
    );
    positive(record.revision);
    positive(record.baseVersion, 0);
    validate("Identifier", record.taskId);
    resultRequire(record.slot === "new" || record.slot === record.taskId);
    const draft = checkedTaskDraft(await open(this.wrapping, record, 65552));
    return {
      slot: record.slot,
      revision: record.revision,
      baseVersion: record.baseVersion,
      taskId: record.taskId,
      draft,
    };
  }
  async validatePending(pending: PendingSnapshot) {
    const { registry, vault } = this.ready();
    exact(pending, [
      "snapshotId",
      "operationId",
      "authorKeyId",
      "expectedRevision",
      "carrier",
      "source",
    ]);
    positive(pending.expectedRevision, 0);
    validate("OperationIdentifier", pending.operationId);
    validate("Carrier", pending.carrier);
    bounded(pending.carrier, 524288);
    const author = cert(registry, pending.authorKeyId, "device_sig", this.now());
    const message = await verified(pending.carrier.signedObject, author.publicJwk, "fv-object+jws");
    validate("ObjectMessage", message);
    const c = message.context;
    if (
      c.ownerSubject !== (await this.owner) ||
      c.vaultId !== vault.vaultId ||
      c.rootKeyId !== vault.rootKeyId ||
      c.authorSigningKeyId !== pending.authorKeyId ||
      c.objectId !== pending.snapshotId ||
      c.objectType !== "holdings_snapshot" ||
      c.operationType !== "commit_snapshot" ||
      c.stableOperationId !== pending.operationId ||
      c.expectedRevision !== pending.expectedRevision ||
      c.revision !== pending.expectedRevision + 1 ||
      !equal(c.binding, this.binding(pending.source, c.revision)) ||
      c.rootEpoch !== registry.checkpoint.rootEpoch ||
      c.keyEpoch !== registry.checkpoint.keyEpoch ||
      c.registrySequence > registry.checkpoint.registrySequence ||
      message.jwe.aad !== b64(utf8.encode(canonical(c)))
    )
      throw new VaultError("binding_mismatch");
    for (const r of c.recipients) {
      const proof = cert(registry, r.keyId, undefined, this.now());
      if (
        !equal(r, {
          keyId: proof.keyId,
          role: proof.role,
          principalId: proof.principalId,
          connectionId: proof.connectionId,
          keyEpoch: proof.keyEpoch,
        })
      )
        throw new VaultError("key_revoked");
    }
    return pending;
  }
  async verifyReceipt(pending: PendingSnapshot, receipt: Json) {
    this.ready();
    const c = parsed(unb64(pending.carrier.signedObject.payload, 524288)).context;
    exact(receipt, [
      "contractVersion",
      "vaultId",
      "resourceRef",
      "snapshotId",
      "revision",
      "sourceEpoch",
      "stableOperationId",
      "envelopeFingerprint",
      "snapshotPath",
      "storedAt",
    ]);
    if (
      receipt.contractVersion !== CONTRACT ||
      receipt.vaultId !== this.vault!.vaultId ||
      !equal(receipt.resourceRef, pending.source.resourceRef) ||
      receipt.snapshotId !== pending.snapshotId ||
      receipt.revision !== pending.expectedRevision + 1 ||
      receipt.sourceEpoch !== pending.source.sourceEpoch ||
      receipt.stableOperationId !== pending.operationId ||
      receipt.envelopeFingerprint !== (await signingFingerprint(pending.carrier.signedObject)) ||
      receipt.snapshotPath !==
        `/api/v2/holdings/sources/${pending.source.resourceRef.resourceId}/snapshots/${pending.snapshotId}` ||
      typeof receipt.storedAt !== "string" ||
      !/^\d{4}-\d\d-\d\dT.*Z$/.test(receipt.storedAt) ||
      c.ownerSubject !== (await this.owner) ||
      c.vaultId !== this.vault!.vaultId ||
      c.stableOperationId !== pending.operationId ||
      c.objectId !== pending.snapshotId ||
      c.authorSigningKeyId !== pending.authorKeyId ||
      !equal(c.binding, this.binding(pending.source, pending.expectedRevision + 1))
    )
      throw new VaultError("binding_mismatch");
  }
  /** Authenticate an old upload for reconciliation only, without reviving its write authority. */
  private async renewalHoldingsPending(pending: PendingSnapshot) {
    if (!this.root || !this.wrapping || !this.vault || !this.pin) throw new VaultError("locked");
    const vault = this.vault;
    await this.checkVault(vault, this.pin);
    bounded(pending, 589824);
    exact(pending, [
      "snapshotId",
      "operationId",
      "authorKeyId",
      "expectedRevision",
      "carrier",
      "source",
    ]);
    exact(pending.source, ["resourceRef", "sourceEpoch"]);
    validate("Identifier", pending.snapshotId);
    validate("OperationIdentifier", pending.operationId);
    validate("KeyId", pending.authorKeyId);
    positive(pending.expectedRevision, 0);
    validate("Carrier", pending.carrier);
    bounded(pending.carrier, 524288);
    const message = parsed(unb64(pending.carrier.signedObject.payload, 524288));
    validate("ObjectMessage", message);
    const c = message.context;
    if (
      c.ownerSubject !== (await this.owner) ||
      c.vaultId !== vault.vaultId ||
      c.rootKeyId !== vault.rootKeyId ||
      c.objectId !== pending.snapshotId ||
      c.objectType !== "holdings_snapshot" ||
      c.operationType !== "commit_snapshot" ||
      c.authorSigningKeyId !== pending.authorKeyId ||
      c.stableOperationId !== pending.operationId ||
      c.expectedRevision !== pending.expectedRevision ||
      c.revision !== pending.expectedRevision + 1 ||
      c.deliveryRevision !== 1 ||
      c.priorEnvelopeFingerprint !== null ||
      !equal(c.resourceBindings, []) ||
      !equal(c.binding, this.binding(pending.source, c.revision))
    )
      throw new VaultError("binding_mismatch");
    let registry: Registry | undefined;
    for (let i = 0; i < c.registrySequence; i++) {
      if (!vault.registryHistory[i]) throw new VaultError("untrusted_vault");
      registry = await verifyRegistry(
        vault.registryHistory[i],
        vault.rootJwk,
        await this.owner,
        vault.vaultId,
        registry,
        this.now(),
      );
      if (registry.checkpoint.registrySequence !== i + 1) throw new VaultError("untrusted_vault");
    }
    const historical = registry!;
    if (
      historical.digest !== c.checkpointDigest ||
      historical.checkpoint.rootEpoch !== c.rootEpoch ||
      historical.checkpoint.keyEpoch !== c.keyEpoch
    )
      throw new VaultError("untrusted_vault");
    const author = historical.certificates.get(pending.authorKeyId);
    if (!author || author.role !== "device_sig" || !author.capabilities.includes("object_write"))
      throw new VaultError("invalid_signature");
    const certificates = [author];
    const recipientIds = new Set<string>();
    for (const recipient of c.recipients) {
      const proof = historical.certificates.get(recipient.keyId);
      if (
        !proof ||
        recipientIds.has(recipient.keyId) ||
        !["device_enc", "recovery_enc"].includes(proof.role) ||
        !equal(recipient, this.taskRecipient(proof))
      )
        throw new VaultError("untrusted_vault");
      recipientIds.add(recipient.keyId);
      certificates.push(proof);
    }
    if (
      !c.recipients.some((r: Json) => r.role === "device_enc") ||
      !c.recipients.some((r: Json) => r.role === "recovery_enc") ||
      !equal([...recipientIds], [...recipientIds].sort())
    )
      throw new VaultError("untrusted_vault");
    // Inspection proves there was a possible authorized interval, not that the upload was saved.
    const possibleAt = Math.max(
      historical.checkpoint.issuedAt,
      ...certificates.map((p) => p.notBefore),
    );
    if (possibleAt > this.now()) throw new VaultError("untrusted_vault");
    for (const proof of certificates) cert(historical, proof.keyId, undefined, possibleAt);
    await verified(pending.carrier.signedObject, author.publicJwk, "fv-object+jws");
    const jwe = this.taskJwe(message, c.recipients);
    unb64(jwe.ciphertext, 196608);
    for (const recipient of jwe.recipients) await key(recipient.header.epk);
    return { vault, historical, certificates, context: c };
  }
  async inspectRenewalHoldingsPending(pending: PendingSnapshot): Promise<PendingSnapshot> {
    await this.renewalHoldingsPending(pending);
    return pending;
  }
  /** Both authenticated GETs must prove the exact original upload; no content is decrypted. */
  async verifyRenewalHoldingsReceipt(
    pending: PendingSnapshot,
    receipt: Json,
    value: SnapshotResponse,
  ): Promise<void> {
    const {
      vault,
      historical,
      certificates,
      context: c,
    } = await this.renewalHoldingsPending(pending);
    bounded(value, 1048576);
    exact(value, ["contractVersion", "carrier", "keyProofs", "receipt"]);
    validate("KeyProofs", value.keyProofs);
    if (
      value.contractVersion !== CONTRACT ||
      !equal(value.carrier, pending.carrier) ||
      !equal(value.receipt, receipt) ||
      !equal(value.keyProofs, {
        checkpoint: historical.bundle.checkpoint,
        certificates: historical.bundle.entries.map((entry) => entry.certificate),
      })
    )
      throw new VaultError("binding_mismatch");
    exact(receipt, [
      "contractVersion",
      "vaultId",
      "resourceRef",
      "snapshotId",
      "revision",
      "sourceEpoch",
      "stableOperationId",
      "envelopeFingerprint",
      "snapshotPath",
      "storedAt",
    ]);
    if (
      receipt.contractVersion !== CONTRACT ||
      receipt.vaultId !== vault.vaultId ||
      !equal(receipt.resourceRef, pending.source.resourceRef) ||
      receipt.snapshotId !== pending.snapshotId ||
      receipt.revision !== pending.expectedRevision + 1 ||
      receipt.sourceEpoch !== pending.source.sourceEpoch ||
      receipt.stableOperationId !== pending.operationId ||
      receipt.envelopeFingerprint !== (await signingFingerprint(pending.carrier.signedObject)) ||
      receipt.snapshotPath !==
        `/api/v2/holdings/sources/${pending.source.resourceRef.resourceId}/snapshots/${pending.snapshotId}`
    )
      throw new VaultError("binding_mismatch");
    const accepted = utcSeconds(receipt.storedAt);
    if (accepted < historical.checkpoint.issuedAt || accepted > this.now())
      throw new VaultError("binding_mismatch");
    for (const proof of certificates) cert(historical, proof.keyId, undefined, accepted);
    let atAcceptance = historical;
    for (let i = c.registrySequence; i < vault.registryHistory.length; i++) {
      const next = vault.registryHistory[i];
      // Checkpoints have second precision; same-second ordering is not inferred.
      if (parsed(unb64(next.checkpoint.payload)).issuedAt >= Math.floor(accepted)) break;
      atAcceptance = await verifyRegistry(
        next,
        vault.rootJwk,
        await this.owner,
        vault.vaultId,
        atAcceptance,
        accepted,
      );
      if (atAcceptance.checkpoint.keyEpoch !== c.keyEpoch) throw new VaultError("binding_mismatch");
      // An unrelated directory update does not invalidate an authority replica's original upload.
      for (const proof of certificates) cert(atAcceptance, proof.keyId, undefined, accepted);
    }
  }
  private binding(source: Source, revision: number) {
    validate("ResourceRef", source.resourceRef);
    positive(source.sourceEpoch);
    if (source.resourceRef.kind !== "holdings" || source.resourceRef.sourceService !== "portfolio")
      throw new VaultError("invalid_data");
    return {
      taskId: null,
      taskVersion: null,
      runId: null,
      manifestId: null,
      taskEnvelopeFingerprint: null,
      manifestFingerprint: null,
      connectionId: null,
      grantId: null,
      grantEpoch: null,
      executionEpoch: null,
      resourceRef: source.resourceRef,
      sourceRevision: revision,
      sourceEpoch: source.sourceEpoch,
    };
  }
  async sealSnapshot(args: {
    content: Json;
    source: Source;
    expectedRevision: number;
    snapshotId?: string;
    operationId?: string;
  }): Promise<PendingSnapshot> {
    const { registry, device, vault } = this.ready();
    positive(args.expectedRevision, 0);
    const revision = args.expectedRevision + 1,
      snapshotId = args.snapshotId ?? randomId("snapshot_"),
      operationId = args.operationId ?? randomId();
    validate("OperationIdentifier", operationId);
    args = { ...args, content: { ...args.content, data: { ...args.content.data, snapshotId } } };
    validate("ResourceContent", args.content);
    if (args.content.data.kind !== "holdings" || args.content.data.snapshotId !== snapshotId)
      throw new VaultError("invalid_data");
    const recipients = [...registry.active]
      .map((k) => cert(registry, k, undefined, this.now()))
      .filter((c) => ["device_enc", "recovery_enc"].includes(c.role))
      .sort((a, b) => (a.keyId < b.keyId ? -1 : 1));
    if (
      recipients.length > 8 ||
      !recipients.some((c) => c.role === "device_enc") ||
      !recipients.some((c) => c.role === "recovery_enc")
    )
      throw new VaultError("invalid_registry");
    const binding = this.binding(args.source, revision);
    const context = {
      contractVersion: CONTRACT,
      profileId: "P1",
      ownerSubject: await this.owner,
      vaultId: vault.vaultId,
      rootKeyId: vault.rootKeyId,
      rootEpoch: registry.checkpoint.rootEpoch,
      registrySequence: registry.checkpoint.registrySequence,
      checkpointDigest: registry.digest,
      keyEpoch: registry.checkpoint.keyEpoch,
      objectId: snapshotId,
      objectType: "holdings_snapshot",
      revision,
      deliveryRevision: 1,
      priorEnvelopeFingerprint: null,
      expectedRevision: args.expectedRevision,
      stableOperationId: operationId,
      operationType: "commit_snapshot",
      authorSigningKeyId: device.sigId,
      binding,
      resourceBindings: [],
      recipients: recipients.map((c) => ({
        keyId: c.keyId,
        role: c.role,
        principalId: c.principalId,
        connectionId: c.connectionId,
        keyEpoch: c.keyEpoch,
      })),
    };
    validate("Context", context);
    bounded(context, 16384);
    const payload = {
      privateSchemaVersion: 2,
      objectId: snapshotId,
      objectType: "holdings_snapshot",
      revision,
      binding,
      payload: args.content,
    };
    validate("PrivatePayload", payload);
    bounded(payload, 196608);
    const encryptor = new GeneralEncrypt(utf8.encode(canonical(payload)))
      .setProtectedHeader(JWE_HEADER)
      .setAdditionalAuthenticatedData(utf8.encode(canonical(context)));
    for (const recipient of recipients)
      encryptor
        .addRecipient(await key(recipient.publicJwk))
        .setUnprotectedHeader({ kid: recipient.keyId });
    const jwe = await encryptor.encrypt();
    const carrier = {
      contractVersion: CONTRACT,
      signedObject: await sign({ context, jwe }, device.sig, device.sigId, "fv-object+jws"),
    };
    validate("Carrier", carrier);
    bounded(carrier, 524288);
    bounded(
      { contractVersion: CONTRACT, expectedRevision: args.expectedRevision, carrier },
      589824,
    );
    return {
      snapshotId,
      operationId,
      authorKeyId: device.sigId,
      expectedRevision: args.expectedRevision,
      carrier,
      source: args.source,
    };
  }
  async openSnapshot(value: SnapshotResponse, source: Source) {
    const { vault, registry, device } = this.ready();
    bounded(value, 1048576);
    exact(value, ["contractVersion", "carrier", "keyProofs", "receipt"]);
    if (value.contractVersion !== CONTRACT) throw new VaultError("invalid_data");
    validate("Carrier", value.carrier);
    validate("KeyProofs", value.keyProofs);
    const message = parsed(unb64(value.carrier.signedObject.payload, 524288));
    validate("ObjectMessage", message);
    const c = message.context;
    validate("Context", c);
    if (
      c.ownerSubject !== (await this.owner) ||
      c.vaultId !== vault.vaultId ||
      c.rootKeyId !== vault.rootKeyId ||
      c.objectType !== "holdings_snapshot" ||
      c.operationType !== "commit_snapshot" ||
      c.deliveryRevision !== 1 ||
      c.priorEnvelopeFingerprint !== null ||
      c.rootEpoch !== 1 ||
      c.keyEpoch > registry.checkpoint.keyEpoch ||
      c.registrySequence > registry.checkpoint.registrySequence ||
      !equal(c.resourceBindings, []) ||
      !equal(
        c.binding,
        this.binding({ ...source, sourceEpoch: c.binding.sourceEpoch }, c.revision),
      ) ||
      c.binding.sourceEpoch > source.sourceEpoch
    )
      throw new VaultError("binding_mismatch");
    const historical = await verified(value.keyProofs.checkpoint, vault.rootJwk);
    validate("RegistryCheckpointPayload", historical);
    if (
      historical.ownerSubject !== (await this.owner) ||
      historical.vaultId !== vault.vaultId ||
      historical.rootKeyId !== vault.rootKeyId ||
      historical.registrySequence !== c.registrySequence ||
      (await sha(canonical(historical))) !== c.checkpointDigest
    )
      throw new VaultError("untrusted_vault");
    const trustedHistory = vault.registryHistory.find((b) =>
      equal(b.checkpoint, value.keyProofs.checkpoint),
    );
    if (!trustedHistory) throw new VaultError("untrusted_vault");
    const historicalCertificates = new Map<string, Json>(),
      historicalActive = new Set<string>();
    for (const entry of trustedHistory.entries) {
      const p = await verified(entry.certificate, vault.rootJwk);
      historicalCertificates.set(p.keyId, p);
      if (entry.active && !historical.revokedKeyIds.includes(p.keyId))
        historicalActive.add(p.keyId);
    }
    let author: Json | undefined;
    const proofs = new Map<string, Json>();
    for (const signed of value.keyProofs.certificates) {
      const proof = await verified(signed, vault.rootJwk);
      validate("KeyCertificatePayload", proof);
      if (
        proof.ownerSubject !== (await this.owner) ||
        proof.vaultId !== vault.vaultId ||
        proof.issuerKeyId !== vault.rootKeyId ||
        proof.keyId !== (await thumb(proof.publicJwk)) ||
        proofs.has(proof.keyId) ||
        !equal(historicalCertificates.get(proof.keyId) ?? null, proof)
      )
        throw new VaultError("untrusted_vault");
      proofs.set(proof.keyId, proof);
      if (proof.keyId === c.authorSigningKeyId) author = proof;
    }
    if (
      !author ||
      !historicalActive.has(author.keyId) ||
      author.role !== "device_sig" ||
      !author.capabilities.includes("object_write")
    )
      throw new VaultError("invalid_signature");
    await verified(value.carrier.signedObject, author.publicJwk, "fv-object+jws");
    const receipt = value.receipt;
    exact(receipt, [
      "contractVersion",
      "vaultId",
      "resourceRef",
      "snapshotId",
      "revision",
      "sourceEpoch",
      "stableOperationId",
      "envelopeFingerprint",
      "snapshotPath",
      "storedAt",
    ]);
    if (
      receipt.contractVersion !== CONTRACT ||
      receipt.vaultId !== vault.vaultId ||
      !equal(receipt.resourceRef, source.resourceRef) ||
      receipt.snapshotId !== c.objectId ||
      receipt.revision !== c.revision ||
      receipt.sourceEpoch !== c.binding.sourceEpoch ||
      receipt.stableOperationId !== c.stableOperationId ||
      receipt.envelopeFingerprint !== (await signingFingerprint(value.carrier.signedObject)) ||
      receipt.snapshotPath !==
        `/api/v2/holdings/sources/${source.resourceRef.resourceId}/snapshots/${c.objectId}`
    )
      throw new VaultError("binding_mismatch");
    const jwe = message.jwe;
    exact(jwe, ["protected", "recipients", "iv", "ciphertext", "tag", "aad"]);
    if (
      !equal(parsed(unb64(jwe.protected, 1024), false), JWE_HEADER) ||
      jwe.aad !== b64(utf8.encode(canonical(c))) ||
      !Array.isArray(jwe.recipients) ||
      jwe.recipients.length !== c.recipients.length ||
      unb64(jwe.iv, 12).length !== 12 ||
      unb64(jwe.tag, 16).length !== 16
    )
      throw new VaultError("invalid_data");
    for (let i = 0; i < jwe.recipients.length; i++) {
      const recipient = jwe.recipients[i];
      exact(recipient, ["header", "encrypted_key"]);
      exact(recipient.header, ["kid", "epk"]);
      if (
        recipient.header.kid !== c.recipients[i].keyId ||
        unb64(recipient.encrypted_key, 40).length !== 40
      )
        throw new VaultError("binding_mismatch");
      validate("PublicJWK", recipient.header.epk);
      const proof = proofs.get(recipient.header.kid);
      if (
        !proof ||
        !historicalActive.has(proof.keyId) ||
        !equal(c.recipients[i], {
          keyId: proof.keyId,
          role: proof.role,
          principalId: proof.principalId,
          connectionId: proof.connectionId,
          keyEpoch: proof.keyEpoch,
        }) ||
        !["device_enc", "recovery_enc"].includes(proof.role)
      )
        throw new VaultError("untrusted_vault");
    }
    if (
      !c.recipients.some((r: Json) => r.role === "device_enc") ||
      !c.recipients.some((r: Json) => r.role === "recovery_enc")
    )
      throw new VaultError("untrusted_vault");
    const selected = await this.reader(c.recipients.map((x: Json) => x.keyId));
    try {
      const opened = await generalDecrypt(jwe, selected, {
        keyManagementAlgorithms: ["ECDH-ES+A256KW"],
        contentEncryptionAlgorithms: ["A256GCM"],
      });
      if (
        !equal(
          Array.from(opened.additionalAuthenticatedData ?? []),
          Array.from(utf8.encode(canonical(c))),
        )
      )
        throw new VaultError("binding_mismatch");
      const payload = parsed(opened.plaintext);
      validate("PrivatePayload", payload);
      bounded(payload, 196608);
      if (
        payload.objectId !== c.objectId ||
        payload.objectType !== c.objectType ||
        payload.revision !== c.revision ||
        !equal(payload.binding, c.binding) ||
        payload.payload.data.snapshotId !== c.objectId ||
        payload.payload.data.kind !== "holdings"
      )
        throw new VaultError("binding_mismatch");
      return payload.payload;
    } catch (e) {
      if (e instanceof VaultError) throw e;
      throw new VaultError("decryption_failed");
    }
  }
}
