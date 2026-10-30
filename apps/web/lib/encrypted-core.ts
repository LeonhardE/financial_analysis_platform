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
  private wrapping?: CryptoKey;
  private root?: CryptoKey;
  private recovery?: CryptoKey;
  private recoveryJwk?: Json;
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
  constructor(
    uid: string,
    private readonly now = () => Math.floor(Date.now() / 1000),
  ) {
    if (!uid || uid.length > 128) throw new VaultError("wrong_account");
    this.owner = sha(uid);
  }
  async beginCreate(material: PasskeyMaterial) {
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
  private async loadDevice(d: DeviceSeal) {
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
    this.device = {
      deviceId: m.deviceId,
      sig: await key(m.signingPrivateJwk, true, true),
      enc: await key(m.encryptionPrivateJwk, false, true),
      sigJwk: pub(m.signingPrivateJwk),
      encJwk: pub(m.encryptionPrivateJwk),
      sigId: d.signingKeyId,
      encId: d.encryptionKeyId,
    };
    this.deviceSeal = d;
  }

  private async newDevice() {
    if (!this.vault || !this.wrapping) throw new VaultError("locked");
    const sig = await makeKey(true),
      enc = await makeKey();
    const deviceId = randomId("device_");
    this.device = {
      deviceId,
      sig: await key(sig.privateJwk, true, true),
      enc: await key(enc.privateJwk, false, true),
      sigJwk: sig.publicJwk,
      encJwk: enc.publicJwk,
      sigId: sig.keyId,
      encId: enc.keyId,
    };
    this.deviceSeal = await seal(
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
    local?: { pin?: Pin; device?: DeviceSeal; pending?: Json },
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
    exact(master, ["ownerSubject", "vaultId", "rootKeyId", "rootPrivateJwk", "recoveryPrivateJwk"]);
    if (
      master.ownerSubject !== owner ||
      master.vaultId !== vault.vaultId ||
      master.rootKeyId !== vault.rootKeyId ||
      (await thumb(master.rootPrivateJwk)) !== master.rootKeyId
    )
      throw new VaultError("untrusted_vault");
    this.vault = vault;
    this.root = await key(master.rootPrivateJwk, true, true);
    this.recovery = await key(master.recoveryPrivateJwk, false, true);
    this.recoveryJwk = pub(master.recoveryPrivateJwk);
    this.registry = await this.checkVault(vault, local?.pin);
    this.pin = local?.pin;
    const recovery = cert(this.registry, await thumb(this.recoveryJwk), "recovery_enc", this.now());
    if (recovery.role !== "recovery_enc") throw new VaultError("untrusted_vault");
    if (local?.pending) {
      const e = local.pending;
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
      if (
        e.kind === "registration" &&
        pendingRegistry.checkpoint.previousDigest !== value.baseDigest
      )
        throw new VaultError("registry_conflict");
      this.pendingEnvelope = e;
      this.pendingDevice = {
        kind: e.kind,
        operation: value.operation,
        baseDigest: value.baseDigest,
      };
      const sig = this.registry.certificates.has(this.device!.sigId),
        enc = this.registry.certificates.has(this.device!.encId);
      if (sig && enc) {
        cert(this.registry, this.device!.sigId, "device_sig", this.now());
        cert(this.registry, this.device!.encId, "device_enc", this.now());
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
        this.registry.checkpoint.revokedKeyIds.some((id: string) =>
          [this.device!.sigId, this.device!.encId].includes(id),
        )
      )
        throw new VaultError("key_revoked");
      return { needsDeviceRegistration: true };
    }
    if (local?.device) {
      await this.loadDevice(local.device);
      cert(this.registry, this.device!.sigId, "device_sig", this.now());
      cert(this.registry, this.device!.encId, "device_enc", this.now());
      return { needsDeviceRegistration: false };
    }
    return { needsDeviceRegistration: true };
  }

  async prepareDeviceRegistration(vault: Vault) {
    if (!this.wrapping || !this.root || !this.vault) throw new VaultError("locked");
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
    const registry = await this.checkVault(vault, this.pin);
    if (!this.device || !this.deviceSeal) throw new VaultError("device_required");
    cert(registry, this.device.sigId, "device_sig", this.now());
    cert(registry, this.device.encId, "device_enc", this.now());
    return this.adoptVault(vault, registry);
  }
  /** Owner history is authenticated at acceptance time, not a new key-authorized write. */
  async acceptResultVault(vault: Vault) {
    if (!this.root || !this.recovery || !this.recoveryJwk) throw new VaultError("locked");
    const record = await this.adoptVault(vault, await this.checkVault(vault, this.pin));
    return { ...record, canWriteState: this.resultStateAvailable() };
  }
  async unlockForResults(
    vault: Vault,
    material: PasskeyMaterial,
    local?: { pin?: Pin; device?: DeviceSeal },
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
    exact(master, ["ownerSubject", "vaultId", "rootKeyId", "rootPrivateJwk", "recoveryPrivateJwk"]);
    if (
      master.ownerSubject !== owner ||
      master.vaultId !== vault.vaultId ||
      master.rootKeyId !== vault.rootKeyId ||
      (await thumb(master.rootPrivateJwk)) !== master.rootKeyId
    )
      throw new VaultError("untrusted_vault");
    this.root = await key(master.rootPrivateJwk, true, true);
    this.recovery = await key(master.recoveryPrivateJwk, false, true);
    this.recoveryJwk = pub(master.recoveryPrivateJwk);
    this.registry = await this.checkVault(vault, local?.pin ?? this.pin);
    this.vault = vault;
    this.pin = local?.pin ?? this.pin;
    this.device = undefined;
    this.deviceSeal = undefined;
    if (local?.device) await this.loadDevice(local.device);
    return { canWriteState: this.resultStateAvailable() };
  }
  private resultStateAvailable() {
    if (!this.registry || !this.device) return false;
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
    return {
      pin: this.pin,
      device: this.deviceSeal,
      history,
      pending: this.pendingEnvelope ?? null,
    };
  }
  private ready() {
    if (!this.pin || !this.registry || !this.device || !this.vault) throw new VaultError("locked");
    cert(this.registry, this.device.sigId, "device_sig", this.now());
    return { registry: this.registry, device: this.device, vault: this.vault };
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
    const recoveryId = await thumb(this.recoveryJwk);
    const selectedKey =
      this.device && recipientIds.includes(this.device.encId)
        ? this.device.enc
        : recipientIds.includes(recoveryId)
          ? this.recovery
          : null;
    if (!selectedKey) throw new VaultError("missing_key");
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
    const jwe = this.taskJwe(message, recipients),
      recoveryId = await thumb(this.recoveryJwk);
    const selected =
      this.device && recipients.some((r) => r.keyId === this.device!.encId)
        ? this.device.enc
        : recipients.some((r) => r.keyId === recoveryId)
          ? this.recovery
          : undefined;
    if (!selected) throw new VaultError("missing_key");
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
    const historicalActive = new Map<string, Json>();
    for (const entry of trustedHistory.entries) {
      const p = await verified(entry.certificate, vault.rootJwk);
      if (entry.active && !historical.revokedKeyIds.includes(p.keyId))
        historicalActive.set(p.keyId, p);
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
        !equal(historicalActive.get(proof.keyId) ?? null, proof)
      )
        throw new VaultError("untrusted_vault");
      proofs.set(proof.keyId, proof);
      if (proof.keyId === c.authorSigningKeyId) author = proof;
    }
    if (!author || author.role !== "device_sig" || !author.capabilities.includes("object_write"))
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
    const selected = c.recipients.some((x: Json) => x.keyId === device.encId)
      ? device.enc
      : this.recovery;
    const selectedId = selected === device.enc ? device.encId : await thumb(this.recoveryJwk!);
    if (!selected || !c.recipients.some((x: Json) => x.keyId === selectedId))
      throw new VaultError("missing_key");
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
