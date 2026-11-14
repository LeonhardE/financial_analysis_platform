/** Task-page display transport only; packets still require the existing Owner Worker. */
import {
  exact,
  identifier,
  taskPage,
  taskPacketPage,
  sameTaskMetadata,
  TASK_CONTRACT,
} from "./task-types";
import { resultPage } from "./task-result-reader";
import { readReportProviders } from "./report-provider-attribution";
import { boundedJson, untilSignal } from "./workspace-cache";
type J = Record<string, any>;
import { taskOverviewRequest, overviewPath, type KnownTaskPacket } from "./task-overview-request";
export function overviewPacketIds(tasks: J[], known: KnownTaskPacket[]) {
  return tasks
    .filter(
      (t) =>
        !known.some(
          (k) =>
            k.taskId === t.taskId &&
            k.taskVersion === t.taskVersion &&
            k.envelopeFingerprint === t.envelopeFingerprint,
        ),
    )
    .slice(0, 4)
    .map((t) => t.taskId as string);
}
export type TaskOverview = {
  contractVersion: string;
  profile: string;
  vaultId: string;
  tasks: J;
  capabilities: J;
  feeds: { persistent: J; foreground: J; archived: J };
  connections: J;
  packets: J | null;
};
export function parseTaskOverview(
  v: unknown,
  vault: string,
  known: KnownTaskPacket[],
  packetLimit: 0 | 4 = 4,
): TaskOverview {
  if (
    !exact(v, [
      "contractVersion",
      "profile",
      "vaultId",
      "tasks",
      "capabilities",
      "feeds",
      "connections",
      "packets",
    ]) ||
    v.contractVersion !== TASK_CONTRACT ||
    v.profile !== "folioview.owner-task-overview.v1" ||
    v.vaultId !== vault ||
    !identifier(vault) ||
    !exact(v.feeds, ["persistent", "foreground", "archived"])
  )
    throw Error("invalid_response");
  const tasks = taskPage(v.tasks);
  if (tasks.some((t) => t.vaultId !== vault)) throw Error("invalid_response");
  const c = v.capabilities;
  if (
    !exact(c, [
      "contractVersion",
      "profile",
      "enabled",
      "actions",
      "dispatchSupported",
      "nativeScheduleAttested",
    ]) ||
    c.contractVersion !== TASK_CONTRACT ||
    c.profile !== "folioview.task-center.v1" ||
    typeof c.enabled !== "boolean" ||
    JSON.stringify(c.actions) !==
      JSON.stringify([
        "set_rules",
        "set_assignment",
        "remove_assignment",
        "trash",
        "restore",
        "purge",
      ]) ||
    c.dispatchSupported !== false ||
    c.nativeScheduleAttested !== false
  )
    throw Error("invalid_response");
  resultPage("persistent", v.feeds.persistent);
  resultPage("foreground", v.feeds.foreground);
  resultPage("foreground", v.feeds.archived);
  readReportProviders(v.connections, vault);
  const ids = packetLimit === 4 ? overviewPacketIds(tasks, known) : [];
  if (v.packets !== null) {
    if (!ids.length) throw Error("invalid_response");
    const p = taskPacketPage(v.packets, ids);
    if (
      p.items.some(
        (row) =>
          row.status === "ready" &&
          !sameTaskMetadata(
            row.packet.metadata,
            tasks.find((t) => t.taskId === row.taskId)!,
          ),
      )
    )
      throw Error("invalid_response");
  }
  return v as TaskOverview;
}
function freezeDisplay<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeDisplay(child);
    Object.freeze(value);
  }
  return value;
}
export type OverviewReceipt = { data: TaskOverview; at: number; serial: number; scope: string };
type Config = {
  scope: string | null;
  vault: string | null;
  active: boolean;
  visible: boolean;
  known: () => KnownTaskPacket[];
  send: (path: string, options: any) => Promise<Response>;
};
/** One page-local shared read; no Worker, permission or cross-session cache. */
export class TaskOverviewRead {
  private config: Config | null = null;
  private cached: OverviewReceipt | null = null;
  private pending: {
    promise: Promise<OverviewReceipt>;
    controller: AbortController;
    users: number;
    epoch: number;
  } | null = null;
  private running = new Set<{ controller: AbortController }>();
  private epoch = 0;
  private serial = 0;
  error = "";
  constructor(
    private changed: () => void,
    private now = Date.now,
  ) {}
  configure(next: Config) {
    if (this.config?.scope !== next.scope) {
      this.invalidate();
      this.cached = null;
      this.error = "";
    }
    if (!next.active || !next.visible) for (const row of this.running) row.controller.abort();
    this.config = next;
  }
  get receipt() {
    const r = this.cached;
    return r && r.scope === this.config?.scope ? r : null;
  }
  invalidate(abort = true) {
    this.epoch++;
    this.cached = null;
    if (abort) for (const row of this.running) row.controller.abort();
    this.pending = null;
  }
  async acquire(signal?: AbortSignal): Promise<OverviewReceipt> {
    const start = this.config;
    if (!start?.scope || !start.vault || !start.active || !start.visible || signal?.aborted)
      throw Error("cancelled");
    const age = this.cached ? this.now() - this.cached.at : -1;
    if (this.cached && age >= 0 && age < 30000)
      return untilSignal(Promise.resolve(this.cached), signal);
    if (this.pending?.controller.signal.aborted) this.pending = null;
    if (!this.pending) {
      const controller = new AbortController(),
        epoch = this.epoch;
      const entry = {
        controller,
        epoch,
        users: 0,
        promise: Promise.resolve(null as unknown as OverviewReceipt),
      };
      this.pending = entry;
      this.running.add(entry);
      this.error = "";
      entry.promise = Promise.resolve().then(async () => {
        let timeout = false;
        const timer = setTimeout(() => {
          timeout = true;
          controller.abort();
        }, 11500);
        const check = () => {
          if (
            controller.signal.aborted ||
            this.config?.scope !== start.scope ||
            !this.config.active ||
            !this.config.visible
          )
            throw Error(timeout ? "request_timeout" : "cancelled");
        };
        try {
          const known = structuredClone(start.known());
          const body = {
            contractVersion: TASK_CONTRACT,
            knownPacketVersions: known,
            packetLimit: 4,
          };
          if (!taskOverviewRequest(body)) throw Error("invalid_response");
          const response = await untilSignal(
            start.send(overviewPath(start.vault!), {
              method: "POST",
              json: body,
              signal: controller.signal,
              headers: { "X-FolioView-Contract": TASK_CONTRACT },
            }),
            controller.signal,
            () => Error(timeout ? "request_timeout" : "cancelled"),
          );
          check();
          if (!response.ok) {
            void response.body?.cancel().catch(() => {});
            throw Error(response.status >= 500 ? "service_unavailable" : "request_failed");
          }
          const raw = await boundedJson(response, 1048576, controller.signal, () =>
            Error(timeout ? "request_timeout" : "cancelled"),
          );
          check();
          const data = freezeDisplay(parseTaskOverview(raw, start.vault!, known));
          check();
          const receipt = { data, at: this.now(), serial: ++this.serial, scope: start.scope! };
          if (this.epoch === epoch) {
            this.cached = receipt;
            this.changed();
          }
          return receipt;
        } catch (e) {
          if (
            this.epoch === epoch &&
            this.config?.scope === start.scope &&
            !controller.signal.aborted
          ) {
            this.error = e instanceof Error ? e.message : "request_failed";
            this.changed();
          }
          throw e;
        } finally {
          clearTimeout(timer);
          this.running.delete(entry);
          if (this.pending === entry) this.pending = null;
        }
      });
    }
    const entry = this.pending;
    entry.users++;
    try {
      return await untilSignal(entry.promise, signal);
    } finally {
      if (--entry.users === 0 && this.running.has(entry)) entry.controller.abort();
    }
  }
}
