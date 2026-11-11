/** Validated JSON protocol values. These primitives are internal trusted-client composition. */
export type PublicJson = Record<string, any>;
export type SignedObject = { protected: string; payload: string; signature: string };
export const CONTRACT: string;
export const PROFILE: string;
export const BINDING: readonly string[];
export const CONSENT_PROFILE: string;
export class RuntimeDenied extends Error {
  readonly code: string;
}
export function deny(code: string): never;
export function exact(value: unknown, fields: string[]): void;
export function canonical(value: unknown): Uint8Array;
export function same(left: unknown, right: unknown): boolean;
export function bytes(value: string): Uint8Array;
export function parsed(value: Uint8Array, canonical?: boolean): any;
export function integer(value: unknown, minimum?: number): number;
export function identifier(value: string): string;
export function digest(value: unknown): Promise<string>;
export function fingerprint(value: PublicJson): Promise<string>;
export function array(value: unknown, maximum: number, minimum?: number): any[];
export function unique(value: any[]): any[];
export function publicKey(value: PublicJson): Promise<PublicJson>;
export function keyId(value: PublicJson): Promise<string>;
export function verify(value: PublicJson, key: PublicJson, typ: string): Promise<PublicJson>;
export function sign(
  value: PublicJson,
  key: CryptoKey,
  kid: string,
  typ: string,
): Promise<SignedObject>;
export function validate(schema: string, value: unknown): void;
export function resultContent(value: PublicJson, outputSpec: PublicJson): void;
export function context(value: PublicJson): PublicJson;
export function reference(value: PublicJson): PublicJson;
export function privatePayload(
  value: PublicJson,
  context: PublicJson,
  outputSpec?: PublicJson | null,
): PublicJson;
export function inspect(value: PublicJson): {
  carrier: PublicJson;
  context: PublicJson;
  payload: PublicJson;
};
export function open(
  value: PublicJson,
  key: CryptoKey,
  expectedContext: PublicJson,
): Promise<PublicJson>;
export function seal(
  value: PublicJson,
  context: PublicJson,
  recipients: Record<string, PublicJson>,
  key: CryptoKey,
): Promise<PublicJson>;
export class Registry {
  constructor(anchor: PublicJson);
  readonly anchor: PublicJson;
  sequence: number;
  current: {
    keys: Map<string, PublicJson>;
    revoked: Set<string>;
    digest: string;
    keyEpoch: number;
    issuedAt: number;
  };
  snapshots: Map<number, PublicJson>;
  history: Map<number, string>;
  load(bundles: PublicJson[], now: number): Promise<this>;
  cert(
    kid: string,
    role: string,
    connection: string | null,
    now: number,
    sequence?: number,
  ): PublicJson;
  agent(identity: PublicJson, now: number, sequence?: number): { sig: PublicJson; enc: PublicJson };
  pin(): { rootKeyId: string; registrySequence: number; checkpointDigest: string };
  binding(
    signed: PublicJson,
    identity: PublicJson,
    actor: PublicJson,
    now: number,
  ): Promise<PublicJson>;
}
export function shape(value: PublicJson): PublicJson;
export function applyConsent(
  signed: PublicJson,
  current: PublicJson | null,
  identity: PublicJson,
  registry: Registry,
  sources: PublicJson[],
): Promise<PublicJson>;
export function verifyConsentChain(args: {
  consent: PublicJson | null;
  receipts: PublicJson[];
  identity: PublicJson;
  registry: Registry;
  pin?: { version: number; digest: string } | null;
}): Promise<PublicJson | null>;
export function permissionFor(consent: PublicJson | null, context: PublicJson): PublicJson;
export function matchBinding(value: PublicJson, identity: PublicJson): void;
export function verifyEnvelope(
  value: PublicJson,
  args: {
    registry: Registry;
    identity: PublicJson;
    expected: PublicJson;
    now: number;
    purpose?: "agent_read" | "new_publication" | "owner_history";
  },
): Promise<{ context: PublicJson; fingerprint: string }>;
export function requestProof(args: {
  identity: PublicJson;
  audience: string;
  path: string;
  request: PublicJson;
  now: number;
  privateKey: CryptoKey;
}): Promise<PublicJson>;
export function verifyManifest(
  value: PublicJson,
  args: {
    identity: PublicJson;
    taskContext: PublicJson;
    taskFingerprint: string;
    consent: PublicJson | null;
    now: number;
  },
): Promise<{ manifest: PublicJson; fingerprint: string }>;
export const AGENT_CREDENTIAL_PROFILE: string;
export const DEFAULT_CREDENTIAL_SECONDS: number;
export const CREDENTIAL_NOTICE_SECONDS: number;
export function credentialStatus(
  lease: PublicJson,
  now: number,
): "active" | "expiring" | "expired" | "revoked";
export function requireCurrentCredential(
  lease: PublicJson,
  args: { identity: PublicJson; audience: string; now: number },
): PublicJson;
export function approveCredential(
  signed: SignedObject,
  args: {
    registry: Registry;
    identity: PublicJson;
    currentLease?: PublicJson | null;
    setupIntentId: string;
    audience: string;
    now: number;
  },
): Promise<PublicJson>;
