type J = Record<string, any>;
import { exact, identifier, TASK_CONTRACT } from "./task-types";
export type KnownTaskPacket = { taskId: string; taskVersion: number; envelopeFingerprint: string };
export const overviewPath = (vault: string) => `/api/v3/tasks/${vault}/overview/query`;
export function taskOverviewRequest(
  v: unknown,
): v is { contractVersion: string; knownPacketVersions: KnownTaskPacket[]; packetLimit: 0 | 4 } {
  return (
    exact(v, ["contractVersion", "knownPacketVersions", "packetLimit"]) &&
    v.contractVersion === TASK_CONTRACT &&
    [0, 4].includes(v.packetLimit) &&
    Array.isArray(v.knownPacketVersions) &&
    v.knownPacketVersions.length <= 32 &&
    new Set(v.knownPacketVersions.map((k: J) => k?.taskId)).size === v.knownPacketVersions.length &&
    v.knownPacketVersions.every(
      (k: unknown) =>
        exact(k, ["taskId", "taskVersion", "envelopeFingerprint"]) &&
        identifier(k.taskId) &&
        Number.isSafeInteger(k.taskVersion) &&
        k.taskVersion >= 1 &&
        k.taskVersion <= 50 &&
        typeof k.envelopeFingerprint === "string" &&
        /^[a-f0-9]{64}$/.test(k.envelopeFingerprint),
    )
  );
}
