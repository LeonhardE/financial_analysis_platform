/** Owner Worker only. Source labels are independent of financial data and Agent grants. */
import { GeneralEncrypt, generalDecrypt, importJWK, base64url, calculateJwkThumbprint } from "jose";
import {
  Registry,
  canonical,
  parsed,
  bytes,
  exact,
  same,
  integer,
  identifier,
  digest,
  fingerprint,
  sign,
  verify,
  validate,
} from "../../../packages/encrypted-workspace/dist/core.mjs";
import { CONTRACT, VaultError, type Json, type Vault } from "./encrypted-types";
export const DISPLAY_PROFILE = "folioview.private-display-name.v1";
const HEADER = {
  alg: "ECDH-ES+A256KW",
  enc: "A256GCM",
  typ: "fv-owner-display-name+jwe",
  cty: "application/json",
};
const BASE = ["contractVersion", "profile", "ownerSubject", "vaultId", "rootKeyId", "ref"];
const CONTEXT = [...BASE, "purpose", "revision", "stableOperationId", "recipientKeyId"];
const CONTROL = [
  ...CONTEXT,
  "artifactType",
  "deviceSigningKeyId",
  "registrySequence",
  "checkpointDigest",
  "keyEpoch",
  "issuedAt",
  "expectedRevision",
  "previousFingerprint",
  "envelope",
];
const STATE = [
  ...BASE,
  "revision",
  "stableOperationId",
  "operationFingerprint",
  "recipientKeyId",
  "acceptedAt",
];
function fail(code = "binding_mismatch"): never {
  throw new VaultError(code);
}
const bounded = (v: unknown, n: number) => {
  if (canonical(v).length > n) fail("invalid_data");
};
const key = (v: unknown) => {
  if (typeof v !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(v)) fail();
};
const operation = (v: unknown) => {
  if (typeof v !== "string" || !/^[A-Za-z0-9_-]{22,128}$/.test(v)) fail();
};
const hex = (v: unknown) => {
  if (typeof v !== "string" || !/^[a-f0-9]{64}$/.test(v)) fail();
};
const context = (p: Json) => Object.fromEntries(CONTEXT.map((k) => [k, p[k]]));
function reference(ref: Json) {
  exact(ref, ["kind", "sourceService", "resourceId", "incarnation"]);
  if (ref.kind !== "holdings" || ref.sourceService !== "portfolio") fail();
  identifier(ref.resourceId);
  identifier(ref.incarnation);
}
export function displayName(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.length ||
    [...value].length > 80 ||
    value !== value.trim() ||
    /\p{C}/u.test(value) ||
    new TextEncoder().encode(value).length > 320
  )
    fail("display_name_invalid");
  return value;
}
function envelope(e: Json, c: Json) {
  bounded(e, 8192);
  exact(e, ["protected", "aad", "iv", "ciphertext", "tag", "recipients"]);
  if (!Array.isArray(e.recipients) || e.recipients.length !== 1) fail();
  const r = e.recipients[0];
  exact(r, ["header", "encrypted_key"]);
  const h = parsed(bytes(e.protected)),
    rh = r.header;
  const protectedEpk = Object.hasOwn(h, "epk");
  exact(h, [...Object.keys(HEADER), ...(protectedEpk ? ["epk"] : [])]);
  exact(rh, ["kid", ...(protectedEpk ? [] : ["epk"])]);
  if (
    !same(Object.fromEntries(Object.keys(HEADER).map((k) => [k, h[k]])), HEADER) ||
    rh.kid !== c.recipientKeyId ||
    e.aad !== base64url.encode(canonical(c))
  )
    fail();
  validate("PublicJWK", protectedEpk ? h.epk : rh.epk);
  if (
    bytes(e.iv).length !== 12 ||
    bytes(e.tag).length !== 16 ||
    bytes(r.encrypted_key).length !== 40 ||
    bytes(e.ciphertext).length < 1 ||
    bytes(e.ciphertext).length > 1536 ||
    bytes(e.protected).length > 1024
  )
    fail();
}
type Context = {
  ownerSubject: string;
  vault: Vault;
  deviceSigningKey?: CryptoKey;
  deviceSigningKeyId?: string;
  recoveryPublic?: Json;
  now: () => number;
  reader: (ids: string[]) => Promise<CryptoKey>;
};
export class DisplayNameOwner {
  constructor(private readonly ctx: Context) {}
  private async registry() {
    const v = this.ctx.vault,
      bundles = v.registryHistory;
    if (!bundles.length || bundles.length > 32) fail();
    const last = parsed(bytes(bundles.at(-1)!.checkpoint.payload), true);
    return new Registry({
      rootJwk: v.rootJwk,
      rootKeyId: v.rootKeyId,
      ownerSubject: this.ctx.ownerSubject,
      vaultId: v.vaultId,
      rootEpoch: 1,
      registrySequence: bundles.length,
      checkpointDigest: await digest(last),
    }).load(bundles, this.ctx.now());
  }
  private scope(p: Json, ref: Json) {
    reference(ref);
    if (
      p.contractVersion !== CONTRACT ||
      p.profile !== DISPLAY_PROFILE ||
      p.ownerSubject !== this.ctx.ownerSubject ||
      p.vaultId !== this.ctx.vault.vaultId ||
      p.rootKeyId !== this.ctx.vault.rootKeyId ||
      !same(p.ref, ref)
    )
      fail();
  }
  private async proof(ref: Json, item: Json, registry: Registry) {
    exact(item, ["state", "command"]);
    exact(item.state, STATE);
    bounded(item.command, 12288);
    exact(item.command, ["protected", "payload", "signature"]);
    if (bytes(item.command.signature).length !== 64) fail();
    const p = parsed(bytes(item.command.payload), true),
      s = item.state;
    exact(p, CONTROL);
    this.scope(p, ref);
    this.scope(s, ref);
    if (p.artifactType !== "private_display_name_update" || p.purpose !== "owner_display_name")
      fail();
    integer(p.expectedRevision, 0);
    integer(p.revision, 1);
    integer(p.registrySequence, 1);
    integer(p.keyEpoch, 1);
    integer(p.issuedAt, 0);
    integer(s.acceptedAt, 0);
    key(p.deviceSigningKeyId);
    key(p.recipientKeyId);
    key(s.recipientKeyId);
    hex(p.checkpointDigest);
    operation(p.stableOperationId);
    hex(s.operationFingerprint);
    if (
      p.revision !== p.expectedRevision + 1 ||
      (p.expectedRevision === 0) !== (p.previousFingerprint === null)
    )
      fail();
    if (p.previousFingerprint !== null) hex(p.previousFingerprint);
    if (
      s.revision !== p.revision ||
      s.stableOperationId !== p.stableOperationId ||
      s.recipientKeyId !== p.recipientKeyId ||
      s.operationFingerprint !== (await fingerprint(item.command)) ||
      s.acceptedAt < p.issuedAt ||
      s.acceptedAt > p.issuedAt + 300 ||
      s.acceptedAt > this.ctx.now()
    )
      fail();
    const snapshot = registry.snapshots.get(p.registrySequence);
    if (
      !snapshot ||
      registry.history.get(p.registrySequence) !== p.checkpointDigest ||
      snapshot.keyEpoch !== p.keyEpoch ||
      p.issuedAt < snapshot.issuedAt
    )
      fail();
    const cert = registry.cert(
      p.deviceSigningKeyId,
      "device_sig",
      null,
      s.acceptedAt,
      p.registrySequence,
    );
    registry.cert(p.recipientKeyId, "recovery_enc", null, s.acceptedAt, p.registrySequence);
    if (!cert.capabilities.includes("control_write") || p.issuedAt < cert.notBefore) fail();
    if (!same(await verify(item.command, cert.publicJwk, "fv-control+jws"), p)) fail();
    envelope(p.envelope, context(p));
    return p;
  }
  private async open(ref: Json, item: Json, registry: Registry) {
    const p = await this.proof(ref, item, registry),
      c = context(p);
    const reader = await this.ctx.reader([p.recipientKeyId]);
    const { plaintext } = await generalDecrypt(p.envelope, reader, {
      keyManagementAlgorithms: ["ECDH-ES+A256KW"],
      contentEncryptionAlgorithms: ["A256GCM"],
    });
    if (plaintext.length > 1024) fail();
    const value = parsed(plaintext, true);
    exact(value, ["contractVersion", "profile", "purpose", "contextDigest", "displayName"]);
    if (
      value.contractVersion !== CONTRACT ||
      value.profile !== DISPLAY_PROFILE ||
      value.purpose !== "owner_display_name" ||
      value.contextDigest !== (await digest(c))
    )
      fail();
    return { ref, state: item.state, name: displayName(value.displayName) };
  }
  async read(args: Json) {
    exact(args, ["ref", "item"]);
    reference(args.ref);
    return args.item === null
      ? { ref: args.ref, state: null, name: null }
      : this.open(args.ref, args.item, await this.registry());
  }
  async readMany(args: Json) {
    exact(args, ["refs", "items"]);
    if (
      !Array.isArray(args.refs) ||
      args.refs.length > 10 ||
      !Array.isArray(args.items) ||
      args.items.length > 10
    )
      fail();
    args.refs.forEach(reference);
    const registry = await this.registry(),
      seen = new Set(),
      results = [];
    for (const item of args.items) {
      const ref = item.state?.ref;
      if (
        !args.refs.some((r: Json) => same(r, ref)) ||
        seen.has(ref.resourceId + ":" + ref.incarnation)
      )
        fail();
      seen.add(ref.resourceId + ":" + ref.incarnation);
      results.push(await this.open(ref, item, registry));
    }
    return results;
  }
  async prepare(args: Json) {
    exact(args, ["ref", "item", "name"]);
    reference(args.ref);
    const name = displayName(args.name);
    const registry = await this.registry(),
      now = this.ctx.now(),
      kid = this.ctx.deviceSigningKeyId;
    if (!kid || !this.ctx.deviceSigningKey || !this.ctx.recoveryPublic) fail("unlock_required");
    const certificate = registry.cert(kid, "device_sig", null, now);
    if (!certificate.capabilities.includes("control_write")) fail();
    const recovery = await importJWK(this.ctx.recoveryPublic, "ECDH-ES+A256KW");
    const recipientKeyId = await calculateJwkThumbprint(this.ctx.recoveryPublic);
    registry.cert(recipientKeyId, "recovery_enc", null, now);
    const previous =
      args.item === null ? null : (await this.open(args.ref, args.item, registry)).state;
    const operationId = "name_" + base64url.encode(crypto.getRandomValues(new Uint8Array(32)));
    const c = {
      contractVersion: CONTRACT,
      profile: DISPLAY_PROFILE,
      ownerSubject: this.ctx.ownerSubject,
      vaultId: this.ctx.vault.vaultId,
      rootKeyId: this.ctx.vault.rootKeyId,
      ref: args.ref,
      purpose: "owner_display_name",
      revision: (previous?.revision ?? 0) + 1,
      stableOperationId: operationId,
      recipientKeyId,
    };
    integer(c.revision, 1);
    const privateValue = {
      contractVersion: CONTRACT,
      profile: DISPLAY_PROFILE,
      purpose: "owner_display_name",
      contextDigest: await digest(c),
      displayName: name,
    };
    const encrypted = await new GeneralEncrypt(canonical(privateValue))
      .setProtectedHeader(HEADER)
      .setAdditionalAuthenticatedData(canonical(c))
      .addRecipient(recovery)
      .setUnprotectedHeader({ kid: recipientKeyId })
      .encrypt();
    envelope(encrypted, c);
    const payload = {
      ...c,
      artifactType: "private_display_name_update",
      deviceSigningKeyId: kid,
      registrySequence: registry.sequence,
      checkpointDigest: registry.current.digest,
      keyEpoch: registry.current.keyEpoch,
      issuedAt: now,
      expectedRevision: previous?.revision ?? 0,
      previousFingerprint: previous?.operationFingerprint ?? null,
      envelope: encrypted,
    };
    const command = await sign(payload, this.ctx.deviceSigningKey, kid, "fv-control+jws");
    bounded(command, 12288);
    return { ref: args.ref, operationId, body: { contractVersion: CONTRACT, command } };
  }
  async receipt(args: Json) {
    exact(args, ["packet", "receipt"]);
    const { packet, receipt } = args;
    exact(packet, ["ref", "operationId", "body"]);
    exact(packet.body, ["contractVersion", "command"]);
    operation(packet.operationId);
    exact(receipt, ["contractVersion", "profile", "item"]);
    if (
      packet.body.contractVersion !== CONTRACT ||
      receipt.contractVersion !== CONTRACT ||
      receipt.profile !== DISPLAY_PROFILE ||
      !receipt.item ||
      receipt.item.state?.stableOperationId !== packet.operationId ||
      (await fingerprint(packet.body.command)) !== (await fingerprint(receipt.item.command))
    )
      fail();
    const result = await this.open(packet.ref, receipt.item, await this.registry());
    return { ...result, operationId: packet.operationId };
  }
}
