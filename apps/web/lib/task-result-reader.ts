import { metadata as foregroundMetadata, metadataPage } from "./inbox-types";
import type { HoldingsWorkspace } from "@/components/useHoldingsWorkspace";
import type { DisplayLru } from "./workspace-cache";
import type { ResultContent } from "./encrypted-types";
export type ResultRow = {
  kind: "persistent" | "foreground";
  metadata: Record<string, any>;
  triggerKind: "manual" | "scheduled" | "legacy_unknown";
};
export type ResultDetail = {
  row: ResultRow;
  content: ResultContent;
  historical: boolean;
  version: string;
};
type J = Record<string, any>;
export const RESULT_CONTRACT = "folioview.agent-workspace.v2.0";
const fields = (v: any, k: string[]) =>
  v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).length === k.length &&
  k.every((x) => Object.hasOwn(v, x));
const id = (v: any) => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v);
export function persistentResultMetadata(v: any) {
  if (
    !fields(v, [
      "resultId",
      "taskId",
      "runId",
      "connectionId",
      "receivedAt",
      "stateVersion",
      "read",
      "starred",
      "archived",
    ]) ||
    !["resultId", "taskId", "runId", "connectionId"].every((k) => id(v[k])) ||
    !["receivedAt", "stateVersion"].every((k) => Number.isSafeInteger(v[k]) && v[k] >= 0) ||
    !["read", "starred", "archived"].every((k) => typeof v[k] === "boolean")
  )
    throw Error("invalid_response");
  return v as J;
}
export function resultPage(kind: ResultRow["kind"], body: J) {
  if (kind === "foreground") {
    const p = metadataPage(body);
    return {
      ...p,
      items: p.items.map(
        (metadata) => ({ kind, metadata, triggerKind: "legacy_unknown" }) as ResultRow,
      ),
    };
  }
  if (
    !fields(body, ["contractVersion", "profile", "items", "nextCursor"]) ||
    body.contractVersion !== RESULT_CONTRACT ||
    body.profile !== "folioview.persistent-content.v1" ||
    !Array.isArray(body.items) ||
    body.items.length > 20 ||
    (body.nextCursor !== null &&
      (typeof body.nextCursor !== "string" ||
        !/^pidx_[a-f0-9]{64}:[0-9]{1,2}$/.test(body.nextCursor)))
  )
    throw Error("invalid_response");
  return {
    items: body.items.map(
      (m: any) =>
        ({
          kind,
          metadata: persistentResultMetadata(m),
          triggerKind: "legacy_unknown",
        }) as ResultRow,
    ),
    nextCursor: body.nextCursor as string | null,
  };
}
export const resultKey = (r: ResultRow) => `${r.kind}:${r.metadata.resultId}`;
export function immutableMetadata(meta: J) {
  return Object.fromEntries(
    Object.keys(meta)
      .filter((k) => !["read", "starred", "archived", "stateVersion"].includes(k))
      .sort()
      .map((k) => [k, meta[k]]),
  );
}
export function resultRecordPath(
  kind: ResultRow["kind"],
  vault: string,
  result: string,
  revision?: number,
) {
  if (
    !id(vault) ||
    !id(result) ||
    (revision !== undefined && (!Number.isInteger(revision) || revision < 1 || revision > 32))
  )
    throw Error("invalid_response");
  return kind === "persistent"
    ? `/api/v2/persistent-results/${vault}/${result}`
    : `/api/v2/results/${result}${revision ? `?revision=${revision}` : ""}`;
}
export async function readTaskResult({
  row,
  workspace,
  api,
  cache,
  scope,
  assert,
  fresh = true,
  revision,
}: {
  row: ResultRow;
  workspace: HoldingsWorkspace;
  api: (path: string, options?: any) => Promise<J>;
  cache: DisplayLru<unknown>;
  scope: string;
  assert: () => void;
  fresh?: boolean;
  revision?: number;
}): Promise<ResultDetail> {
  const key = `task-results:${scope}:${resultKey(row)}:${revision ?? "head"}`;
  const cached = cache.get(key) as
    { scope: string; version: string; detail: ResultDetail } | undefined;
  if (
    !fresh &&
    cached?.scope === scope &&
    JSON.stringify(immutableMetadata(row.metadata)) ===
      JSON.stringify(immutableMetadata(cached.detail.row.metadata))
  ) {
    assert();
    return { ...cached.detail, row: { ...cached.detail.row, metadata: row.metadata } };
  }
  const raw = await api(
    resultRecordPath(row.kind, workspace.vault!.vaultId, row.metadata.resultId, revision),
  );
  assert();
  const meta: J =
    row.kind === "persistent"
      ? persistentResultMetadata(raw.metadata)
      : foregroundMetadata(raw.metadata);
  if (
    meta.resultId !== row.metadata.resultId ||
    meta.taskId !== row.metadata.taskId ||
    meta.connectionId !== row.metadata.connectionId ||
    meta.runId !== row.metadata.runId ||
    (revision !== undefined && meta.revision !== revision)
  )
    throw Error("invalid_response");
  let content: ResultContent, version: string;
  if (row.kind === "persistent") {
    version = JSON.stringify([
      immutableMetadata(meta),
      raw.envelope,
      raw.manifest,
      raw.manifestFingerprint,
      raw.identity,
      raw.binding,
      raw.receipt,
    ]);
    content =
      cached?.scope === scope && cached.version === version
        ? cached.detail.content
        : await workspace.openPersistentResult({ record: raw, resultId: meta.resultId });
    assert();
  } else {
    const evidence = await api(
      `/api/v2/results/${meta.resultId}/revisions/${meta.revision}/evidence`,
    );
    assert();
    if (
      evidence.contractVersion !== RESULT_CONTRACT ||
      evidence.profile !== "folioview.owner-result-evidence.v1" ||
      !evidence.authorProof ||
      !Number.isInteger(evidence.authorProof.registrySequence) ||
      evidence.authorProof.registrySequence < 1 ||
      evidence.authorProof.registrySequence > 32 ||
      !Array.isArray(evidence.registryProofs) ||
      evidence.registryProofs.length !== evidence.authorProof.registrySequence
    )
      throw Error("invalid_response");
    const bundles = [];
    for (let n = 0; n < evidence.registryProofs.length; n++) {
      const p = evidence.registryProofs[n],
        path = `/api/v2/results/${meta.resultId}/revisions/${meta.revision}/registries/${n + 1}`;
      if (
        !fields(p, ["registrySequence", "checkpointDigest", "path"]) ||
        p.registrySequence !== n + 1 ||
        p.path !== path ||
        !/^[a-f0-9]{64}$/.test(p.checkpointDigest)
      )
        throw Error("invalid_response");
      bundles.push(workspace.vault!.registryHistory[n] ?? (await api(path)));
      assert();
    }
    version = JSON.stringify([
      immutableMetadata(meta),
      raw.signedObject,
      raw.keyProofs,
      evidence,
      bundles,
    ]);
    content =
      cached?.scope === scope && cached.version === version
        ? cached.detail.content
        : await workspace.openResult({
            result: raw as any,
            evidence: evidence as any,
            registryBundles: bundles as any,
          });
    assert();
  }
  const detail = {
    row: { ...row, metadata: meta },
    content,
    historical: revision !== undefined,
    version,
  };
  cache.set(key, { scope, version, detail });
  assert();
  return detail;
}
export function stateReceipt(row: ResultRow, changes: J, response: J) {
  const meta: J =
    row.kind === "persistent" ? persistentResultMetadata(response) : foregroundMetadata(response);
  if (
    JSON.stringify(immutableMetadata(meta)) !== JSON.stringify(immutableMetadata(row.metadata)) ||
    meta.stateVersion !== row.metadata.stateVersion + 1 ||
    !["read", "starred", "archived"].every(
      (k) => meta[k] === (k in changes ? changes[k] : row.metadata[k]),
    )
  )
    throw Error("invalid_response");
  return { ...row, metadata: meta };
}
