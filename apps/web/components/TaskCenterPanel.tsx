"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { HoldingsWorkspace } from "./useHoldingsWorkspace";
import type { TaskModel } from "./useTasks";
import type { TaskCenterModel } from "./useTaskCenter";
import type { PersistentWorkspaceModel } from "./usePersistentWorkspace";
import type { TaskRequest } from "./TasksPanel";
import { defaultTask } from "@/lib/task-forms";
import { nextCenterOccurrence } from "@/lib/task-center-schedule";
import { bindingKey } from "@/lib/task-types";
import { ReportDialog } from "./ReportDialog";
import { InlineError, LoadingIndicator } from "./WorkspaceFeedback";
import styles from "./TaskCenterPanel.module.css";
type J = Record<string, any>;
type Schedule = {
  frequency: "daily" | "weekly";
  days: number[];
  localTime: string;
  timeZone: string;
};
const providerName = (p: string) => (p === "muse" ? "Muse" : p === "chatgpt" ? "ChatGPT" : "Agent");
export function TaskRunningMark({ label }: { label: string }) {
  return <span className={styles.spinner} role="img" aria-label={label} />;
}
export function TaskCenterView({
  workspace,
  model,
  center,
  persistent,
  request,
  onRequestConsumed,
  onNavigate,
  results,
  unreadCounts = {},
  unreadPartial = false,
  resultsFocusKey,
}: {
  workspace: HoldingsWorkspace;
  model: TaskModel;
  center: TaskCenterModel;
  persistent?: PersistentWorkspaceModel;
  request?: TaskRequest | null;
  onRequestConsumed?: () => void;
  onNavigate?: (view: "agents" | "inbox") => void;
  results?: ReactNode;
  unreadCounts?: Record<string, number>;
  unreadPartial?: boolean;
  resultsFocusKey?: string;
}) {
  const t = useTranslations("taskCenter"),
    locale = useLocale();
  const [choosingRun, setChoosingRun] = useState(false),
    [runAgents, setRunAgents] = useState<string[]>([]);
  const [mode, setMode] = useState<"browse" | "edit" | "trash">("browse"),
    [tab, setTab] = useState<"overview" | "results">("overview"),
    [step, setStep] = useState(1),
    [providers, setProviders] = useState<string[]>([]),
    [scheduled, setScheduled] = useState(false),
    [schedule, setSchedule] = useState<Schedule>({
      frequency: "daily",
      days: [],
      localTime: "",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
    [progress, setProgress] = useState(false),
    [deleting, setDeleting] = useState(false),
    [localBusy, setLocalBusy] = useState(false),
    [localError, setLocalError] = useState(""),
    [copied, setCopied] = useState("");
  const finishing = useRef(false),
    reopen = useRef<string | null>(null),
    live = useRef({ scope: center.scope });
  live.current = { scope: center.scope };
  const selected = model.selected,
    form = model.form,
    task = selected?.taskId,
    record = task ? center.records[task] : null;
  const assignments: J[] = record?.assignments ?? [];
  const currentAssignments = assignments.filter(
    (a) => a.assignment.status === "active" && a.plan?.currentAssignment,
  );
  const requests = task ? (center.manual[task] ?? []) : [],
    currentRequest = requests.find((r) => r.aggregate?.hasActiveExecutors) ?? requests.at(-1),
    running = Boolean(currentRequest?.aggregate?.hasActiveExecutors);
  useEffect(() => {
    if (resultsFocusKey) {
      setTab("results");
      setMode("browse");
      setProgress(false);
    }
  }, [resultsFocusKey]);
  const busy = model.busy || center.busy || localBusy,
    writable = model.canWrite && !model.historical && selected?.status !== "archived";
  const available = ["muse", "chatgpt"].flatMap((provider) => {
    const rows =
      persistent?.views.filter(
        (v) =>
          v.connection.provider === provider &&
          v.connection.status === "active" &&
          ["active", "expiring"].includes(v.credential?.status ?? ""),
      ) ?? [];
    return rows.length === 1 ? rows : [];
  });
  useEffect(() => {
    if (!center.scope) {
      setMode("browse");
      setProgress(false);
      setChoosingRun(false);
      setDeleting(false);
      setProviders([]);
      setLocalError("");
      finishing.current = false;
    }
  }, [center.scope]);
  useEffect(() => {
    if (mode !== "browse" || !selected) return;
    const d = record?.rules?.definition;
    setProviders(
      record?.rules
        ? currentAssignments.map((a) => a.assignment.provider)
        : currentAssignments.length
          ? currentAssignments.map((a) => a.assignment.provider)
          : (persistent?.views
              .filter((v) => v.tasks.some((x) => x.taskId === selected.taskId))
              .map((v) => v.connection.provider) ?? []),
    );
    setScheduled(Boolean(d?.schedule ?? form?.deliveryExpectation));
    if (d?.schedule)
      setSchedule({
        frequency: d.schedule.frequency,
        days: d.schedule.days,
        localTime: d.schedule.localTime,
        timeZone: d.schedule.timeZone,
      });
    else if (form?.deliveryExpectation) {
      const v = form.deliveryExpectation;
      setSchedule({
        frequency: v.cadence === "daily" ? "daily" : "weekly",
        days:
          v.cadence === "weekdays"
            ? [1, 2, 3, 4, 5]
            : v.cadence === "weekly"
              ? [v.weekday === 0 ? 7 : v.weekday!]
              : [],
        localTime: v.localTime,
        timeZone: v.timeZone,
      });
    }
  }, [mode, selected?.taskId, record, persistent?.views, form?.deliveryExpectation]);
  useEffect(() => {
    if (reopen.current && !model.form && !model.dirty && !model.busy) {
      const id = reopen.current;
      reopen.current = null;
      void model.openTask(id);
    }
  }, [model.form, model.dirty, model.busy, model.openTask]);
  const start = (seed?: TaskRequest["binding"]) => {
    const content = defaultTask(seed ? "brief" : "custom");
    content.name = "";
    content.goal = "";
    content.outputSpec.label = t("report");
    content.outputSpec.language = locale === "zh" ? "zh" : "en";
    model.startNew(seed, content);
    setProviders([]);
    setScheduled(false);
    setSchedule((s) => ({ ...s, localTime: "", days: [], frequency: "daily" }));
    setStep(1);
    setMode("edit");
    setLocalError("");
  };
  useEffect(() => {
    if (
      request?.owner === workspace.owner &&
      request &&
      model.canWrite &&
      !model.form &&
      !model.busy
    ) {
      start(request.binding);
      onRequestConsumed?.();
    }
  }, [request?.nonce, model.canWrite, model.busy]);
  const configure = async () => {
    const snapshot = live.current.scope;
    if (!selected || !snapshot) return;
    setLocalBusy(true);
    setLocalError("");
    try {
      if (center.enabled) {
        let state = await center.api(center.base(selected.taskId));
        const desired = scheduled ? schedule : null,
          d = state.rules?.definition;
        const sameSchedule =
          desired === null
            ? d?.schedule === null
            : d?.schedule &&
              ["frequency", "days", "localTime", "timeZone"].every(
                (k) => JSON.stringify(d.schedule[k]) === JSON.stringify((desired as J)[k]),
              );
        let previous = persistent?.tasks.find((v) => v.taskId === selected.taskId)?.authority;
        if (!d)
          previous = await center.api(
            `/api/v2/persistent-content/${selected.vaultId}/tasks/${selected.taskId}/authority`,
          );
        if (
          !d ||
          d.taskVersion !== selected.taskVersion ||
          d.executionEpoch !== selected.executionEpoch ||
          !sameSchedule
        ) {
          await center.command(selected.taskId, "set_rules", desired, state);
          state = await center.api(center.base(selected.taskId));
        }
        for (const row of state.assignments) {
          if (row.assignment.status === "active" && !providers.includes(row.assignment.provider))
            await center.command(selected.taskId, "remove_assignment", row.assignment.assignmentId);
        }
        for (const provider of providers) {
          const view = available.find((v) => v.connection.provider === provider);
          if (!view || !persistent) throw Error("connection_unavailable");
          const result = await persistent.execute(async (c, api, assert) => {
            const packet = await api(`/api/v2/tasks/${selected.taskId}`);
            if (JSON.stringify(packet.metadata) !== JSON.stringify(selected))
              throw Error("version_conflict");
            const content = await workspace.openTask(packet);
            assert();
            const taskValue = {
              taskId: selected.taskId,
              title: content.name,
              packet,
              content,
              authority: previous ?? {},
              plan: null,
            };
            const review = await c.review(view.connection);
            await c.approve(view.connection, [taskValue], review, false, {
              previous,
              beforePublish: async (_task, p, context) => {
                const slot = await center.api(
                  `/api/v3/provider-connections/${selected.vaultId}/${provider}`,
                );
                if (
                  !slot.slot?.currentCredential ||
                  slot.slot.currentCredential.connectionId !== view.connection.connectionId
                )
                  throw Error("connection_unavailable");
                await center.command(selected.taskId, "set_assignment", {
                  slot: slot.slot,
                  identityState: context.identityState,
                  authorityFingerprint:
                    p.kind === "no_change" ? p.authority.fingerprint : p.fingerprint,
                });
              },
            });
            return true;
          });
          if (result !== true) throw Error("authorization_pending");
        }
        await center.load(selected.taskId, true);
      }
      if (live.current.scope === snapshot) {
        setMode("browse");
        setTab("overview");
      }
    } catch (e) {
      if (live.current.scope === snapshot)
        setLocalError(e instanceof Error ? e.message : "request_failed");
    } finally {
      if (live.current.scope === snapshot) setLocalBusy(false);
    }
  };
  useEffect(() => {
    if (
      finishing.current &&
      !model.busy &&
      !model.dirty &&
      !model.pending &&
      selected &&
      mode === "edit"
    ) {
      finishing.current = false;
      void configure();
    }
  }, [model.busy, model.dirty, model.pending, selected?.taskId, selected?.taskVersion]);
  const next = () => {
    if (step === 1) {
      if (!form?.name.trim() || !form.goal.trim()) {
        setLocalError("validation_failed");
        return;
      }
      setStep(2);
      setLocalError("");
      return;
    }
    if (scheduled && center.enabled) {
      try {
        new Intl.DateTimeFormat("en", { timeZone: schedule.timeZone });
        if (
          !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.localTime) ||
          (schedule.frequency === "weekly" && !schedule.days.length)
        )
          throw Error();
      } catch {
        setLocalError("invalid_schedule");
        return;
      }
    }
    setStep(3);
    setLocalError("");
    if (model.dirty) void model.save(false);
  };
  const confirm = () => {
    if (model.dirty) {
      finishing.current = true;
      void model.save(true);
    } else void configure();
  };
  const run = async () => {
    if (!task || !runAgents.length) return;
    setChoosingRun(false);
    try {
      await center.command(task, "manual_intent", runAgents);
      setProgress(true);
    } catch {
      setProgress(true);
    }
  };
  const remove = async () => {
    if (!selected) return;
    setLocalBusy(true);
    try {
      const state = await center.api(center.base(selected.taskId));
      if (!state.rules) await center.command(selected.taskId, "set_rules", null, state);
      await center.command(selected.taskId, "trash");
      setDeleting(false);
      setProgress(false);
      await model.discardDraft();
      await model.reloadTasks();
      setMode("browse");
      window.dispatchEvent(
        new CustomEvent("folioview-task-lifecycle", {
          detail: {
            taskId: selected.taskId,
            vaultId: workspace.vault!.vaultId,
            rootKeyId: workspace.vault!.rootKeyId,
            action: "trash",
          },
        }),
      );
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "request_failed");
    } finally {
      setLocalBusy(false);
    }
  };
  const copyRequest = async (provider: string) => {
    if (!task || !currentRequest) return;
    try {
      await navigator.clipboard.writeText(
        `FolioView: use your saved private connection to execute the existing manual request ${currentRequest.snapshot.requestId} for task ${task} (${form?.name ?? ""}). Pick up the original request with pendingManual/beginManual; do not create another request, change scope, renew credentials or share secrets. Return the authorized report through FolioView.`,
      );
      setCopied(provider);
    } catch {
      setLocalError("clipboard_unavailable");
    }
  };
  const failure = localError || center.error || model.error;
  const failureLabel = failure
    ? t.has(`errors.${failure}`)
      ? t(`errors.${failure}`)
      : t("errors.request_failed")
    : "";
  const modeLabel = scheduled ? t("scheduled") : t("manual");
  const nextOccurrence = scheduled ? nextCenterOccurrence(schedule) : null;
  const scheduleLabel = scheduled
    ? `${schedule.frequency === "weekly" ? schedule.days.map((d) => t(`days.${d}`)).join("、") : t("daily")} ${schedule.localTime} · ${schedule.timeZone}`
    : t("manual");
  return (
    <section className={styles.panel} aria-labelledby="task-center-title">
      <header className={styles.heading}>
        <h1 id="task-center-title">{t("title")}</h1>
        <div className={styles.actions}>
          <button className={styles.textButton} disabled={busy} onClick={() => void model.reload()}>
            {t("refresh")}
          </button>
          <button
            className={styles.textButton}
            disabled={busy || !center.enabled || model.dirty}
            onClick={() => {
              setMode("trash");
              void center.trashList();
            }}
          >
            {t("trash")}
          </button>
          <button
            className={styles.primary}
            disabled={busy || !model.canWrite || model.dirty || Boolean(model.pending)}
            onClick={() => start()}
          >
            {t("new")}
          </button>
        </div>
      </header>
      {failureLabel && (
        <InlineError
          message={failureLabel}
          onRetry={() => {
            setLocalError("");
            if (task) void center.load(task, true);
            else void model.reload();
          }}
          retryLabel={t("retry")}
        />
      )}
      {center.pending && (
        <div className={styles.notice} role="status">
          <span>{t("unknownSave")}</span>
          <button onClick={() => void center.recover(center.pending!.taskId)} disabled={busy}>
            {t("checkSave")}
          </button>
          <button onClick={() => void center.recover(center.pending!.taskId, true)} disabled={busy}>
            {t("retryOriginal")}
          </button>
          <button
            onClick={() => void center.recover(center.pending!.taskId, false, true)}
            disabled={busy}
          >
            {t("abandonSave")}
          </button>
        </div>
      )}
      {model.pendingOperations.length > 0 && (
        <div className={styles.notice}>
          <span>{t("unknownSave")}</span>
          {model.pendingOperations.map((p) => (
            <button
              key={p.operationId}
              disabled={busy}
              onClick={() => void model.recoverPending(p.taskId)}
            >
              {t("checkSave")}
            </button>
          ))}
          {model.pending && (
            <button disabled={busy} onClick={() => void model.resendPending()}>
              {t("retryOriginal")}
            </button>
          )}
        </div>
      )}
      {model.drafts.length > 0 && !model.dirty && (
        <details className={styles.drafts}>
          <summary>{t("drafts")}</summary>
          {model.drafts.map((d, i) => (
            <button
              key={d.slot}
              disabled={busy}
              onClick={() => {
                void model.restoreDraft(d.slot);
                setMode("edit");
                setStep(1);
              }}
            >
              {d.slot === "new"
                ? t("newDraft")
                : (model.taskNames[d.taskId] ?? t("savedDraft", { number: i + 1 }))}
            </button>
          ))}
        </details>
      )}
      {mode === "trash" ? (
        <div className={styles.detail}>
          <div className={styles.heading}>
            <h2>{t("trash")}</h2>
            <button onClick={() => setMode("browse")}>{t("back")}</button>
          </div>
          <LoadingIndicator
            busy={center.loading}
            hasContent={center.trash.length > 0}
            label={t("loading")}
          />
          {!center.loading && !center.trash.length && (
            <p className={styles.empty}>{t("trashEmpty")}</p>
          )}
          {center.trash.map((r: J) => (
            <div key={r.taskId} className={styles.trashRow}>
              <strong>{r.title ?? t("deletedTask")}</strong>
              <span>{r.canRestore ? t("recoverable") : t("expired")}</span>
              <button
                disabled={busy || !r.canRestore}
                onClick={() => {
                  void center
                    .command(r.taskId, "restore")
                    .then(() =>
                      Promise.all([center.trashList(), model.reloadTasks()]).then(() =>
                        window.dispatchEvent(
                          new CustomEvent("folioview-task-lifecycle", {
                            detail: {
                              taskId: r.taskId,
                              vaultId: workspace.vault!.vaultId,
                              rootKeyId: workspace.vault!.rootKeyId,
                              action: "restore",
                            },
                          }),
                        ),
                      ),
                    )
                    .catch(() => {});
                }}
              >
                {t("restore")}
              </button>
            </div>
          ))}
          {center.trashCursor && (
            <button disabled={center.loading} onClick={() => void center.trashList(true)}>
              {t("loadMore")}
            </button>
          )}
        </div>
      ) : (
        <div className={styles.layout}>
          <aside className={styles.list} aria-label={t("taskList")}>
            <LoadingIndicator
              busy={model.loading}
              hasContent={model.items.length > 0}
              label={t("loading")}
            />
            {model.listError && (
              <InlineError
                message={t("errors.request_failed")}
                retryLabel={t("retry")}
                onRetry={() => void model.reloadTasks()}
              />
            )}
            {!model.loading && !model.items.length && (
              <p className={styles.empty}>{t("noTasks")}</p>
            )}
            {model.items.map((item) => {
              const active = (center.manual[item.taskId] ?? []).some(
                  (r) => r.aggregate?.hasActiveExecutors,
                ),
                unread = unreadCounts[item.taskId] ?? 0;
              return (
                <div
                  key={item.taskId}
                  className={styles.taskRow}
                  data-selected={item.taskId === task}
                >
                  {unread > 0 && (
                    <span
                      className={styles.badge}
                      aria-label={t(unreadPartial ? "unreadAtLeast" : "unread", { count: unread })}
                    >
                      {unread > 99 ? "99+" : unreadPartial ? `${unread}+` : unread}
                    </span>
                  )}
                  <button
                    className={styles.taskButton}
                    disabled={center.busy || localBusy || model.dirty || Boolean(model.pending)}
                    onClick={() => {
                      setMode("browse");
                      setTab("overview");
                      setLocalError("");
                      void model.openTask(item.taskId);
                    }}
                  >
                    <span className={styles.taskTitle}>
                      {model.taskNames[item.taskId] ??
                        (model.nameErrors[item.taskId] ? (
                          t("nameUnavailable")
                        ) : (
                          <span className={styles.nameSkeleton} aria-label={t("loadingName")} />
                        ))}
                      {active && <TaskRunningMark label={t("running")} />}
                    </span>
                    <small>{t(`statuses.${item.status}`)}</small>
                  </button>
                  {model.nameErrors[item.taskId] && (
                    <button
                      className={styles.retryName}
                      onClick={() => model.retryTaskName(item.taskId)}
                    >
                      {t("retry")}
                    </button>
                  )}
                </div>
              );
            })}
          </aside>
          <div className={styles.detail}>
            {mode === "edit" && form ? (
              <div key={`edit-${step}`} className={styles.transition}>
                <div className={styles.heading}>
                  <h2>{selected ? t("edit") : t("new")}</h2>
                  <span className={styles.step}>{t("step", { step })}</span>
                </div>
                <ol className={styles.steps}>
                  {[1, 2, 3].map((n) => (
                    <li key={n} data-current={step === n}>
                      {t(`steps.${n}`)}
                    </li>
                  ))}
                </ol>
                {step === 1 ? (
                  <div className={styles.form}>
                    <label>
                      {t("name")}
                      <input
                        autoFocus
                        maxLength={80}
                        value={form.name}
                        onChange={(e) => model.setForm({ ...form, name: e.target.value })}
                      />
                    </label>
                    <label>
                      {t("goal")}
                      <textarea
                        rows={5}
                        maxLength={2000}
                        value={form.goal}
                        onChange={(e) => model.setForm({ ...form, goal: e.target.value })}
                      />
                    </label>
                    <details>
                      <summary>{t("advanced")}</summary>
                      <label>
                        {t("reportLanguage")}
                        <select
                          value={form.outputSpec.language}
                          onChange={(e) =>
                            model.setForm({
                              ...form,
                              outputSpec: {
                                ...form.outputSpec,
                                language: e.target.value as "en" | "zh",
                              },
                            })
                          }
                        >
                          <option value="en">English</option>
                          <option value="zh">中文</option>
                        </select>
                      </label>
                    </details>
                  </div>
                ) : step === 2 ? (
                  <div className={styles.form}>
                    <fieldset>
                      <legend>{t("resources")}</legend>
                      {model.catalogueLoading && (
                        <LoadingIndicator
                          busy
                          hasContent={model.catalogue.length > 0}
                          label={t("loading")}
                        />
                      )}{" "}
                      {model.catalogue
                        .filter((o) => o.binding)
                        .map((o, i) => (
                          <label
                            className={styles.check}
                            key={o.binding ? bindingKey(o.binding) : i}
                          >
                            <input
                              type="checkbox"
                              disabled={!o.selectable}
                              checked={model.bindings.some(
                                (b) => bindingKey(b) === bindingKey(o.binding!),
                              )}
                              onChange={(e) =>
                                model.setBindings(
                                  e.target.checked
                                    ? [...model.bindings, o.binding!]
                                    : model.bindings.filter(
                                        (b) => bindingKey(b) !== bindingKey(o.binding!),
                                      ),
                                )
                              }
                            />
                            {t(`kinds.${o.binding!.ref.kind}`)}
                            {model.catalogue.filter(
                              (x) => x.binding?.ref.kind === o.binding?.ref.kind,
                            ).length > 1
                              ? ` ${i + 1}`
                              : ""}
                          </label>
                        ))}
                    </fieldset>
                    <fieldset>
                      <legend>{t("executors")}</legend>
                      {available.map((v) => (
                        <label className={styles.check} key={v.connection.provider}>
                          <input
                            type="checkbox"
                            disabled={!center.enabled || !model.bindings.length}
                            checked={providers.includes(v.connection.provider)}
                            onChange={(e) =>
                              setProviders((p) =>
                                e.target.checked
                                  ? [...p, v.connection.provider]
                                  : p.filter((x) => x !== v.connection.provider),
                              )
                            }
                          />
                          {providerName(v.connection.provider)}
                        </label>
                      ))}
                      {(!available.length || !center.enabled) && (
                        <a
                          href="/agents"
                          onClick={(e) => {
                            if (onNavigate) {
                              e.preventDefault();
                              onNavigate("agents");
                            }
                          }}
                        >
                          {t("manageAgents")}
                        </a>
                      )}
                    </fieldset>
                    <fieldset>
                      <legend>{t("runMode")}</legend>
                      <div className={styles.segment}>
                        <button
                          type="button"
                          aria-pressed={!scheduled}
                          disabled={!center.enabled}
                          onClick={() => setScheduled(false)}
                        >
                          {t("manual")}
                        </button>
                        <button
                          type="button"
                          aria-pressed={scheduled}
                          disabled={!center.enabled}
                          onClick={() => setScheduled(true)}
                        >
                          {t("scheduled")}
                        </button>
                      </div>
                      {scheduled && (
                        <div className={styles.schedule}>
                          <label>
                            {t("frequency")}
                            <select
                              disabled={!center.enabled}
                              value={schedule.frequency}
                              onChange={(e) =>
                                setSchedule((s) => ({
                                  ...s,
                                  frequency: e.target.value as "daily" | "weekly",
                                  days: [],
                                }))
                              }
                            >
                              <option value="daily">{t("daily")}</option>
                              <option value="weekly">{t("weekly")}</option>
                            </select>
                          </label>
                          {schedule.frequency === "weekly" && (
                            <div className={styles.days}>
                              {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                                <label key={n}>
                                  <input
                                    type="checkbox"
                                    disabled={!center.enabled}
                                    checked={schedule.days.includes(n)}
                                    onChange={(e) =>
                                      setSchedule((s) => ({
                                        ...s,
                                        days: (e.target.checked
                                          ? [...s.days, n]
                                          : s.days.filter((d) => d !== n)
                                        ).sort((a, b) => a - b),
                                      }))
                                    }
                                  />
                                  {t(`days.${n}`)}
                                </label>
                              ))}
                            </div>
                          )}
                          <label>
                            {t("time")}
                            <input
                              disabled={!center.enabled}
                              type="time"
                              required
                              value={schedule.localTime}
                              onChange={(e) =>
                                setSchedule((s) => ({ ...s, localTime: e.target.value }))
                              }
                            />
                          </label>
                          <label>
                            {t("timeZone")}
                            <input
                              disabled={!center.enabled}
                              required
                              list="task-time-zones"
                              value={schedule.timeZone}
                              onChange={(e) =>
                                setSchedule((s) => ({ ...s, timeZone: e.target.value }))
                              }
                            />
                            <datalist id="task-time-zones">
                              {[
                                "America/Toronto",
                                "America/New_York",
                                "America/Los_Angeles",
                                "Europe/London",
                                "Asia/Shanghai",
                                "Asia/Tokyo",
                                "UTC",
                              ].map((z) => (
                                <option key={z} value={z} />
                              ))}
                            </datalist>
                          </label>
                        </div>
                      )}
                    </fieldset>
                  </div>
                ) : (
                  <div className={styles.review}>
                    <h3>{form.name}</h3>
                    <p>{form.goal}</p>
                    <dl>
                      <dt>{t("resources")}</dt>
                      <dd>
                        {model.bindings.map((b) => t(`kinds.${b.ref.kind}`)).join("、") ||
                          t("none")}
                      </dd>
                      <dt>{t("executors")}</dt>
                      <dd>{providers.map(providerName).join("、") || t("noExecutor")}</dd>
                      <dt>{t("runMode")}</dt>
                      <dd>{scheduleLabel}</dd>
                    </dl>
                    {model.preview && !model.preview.valid && (
                      <InlineError message={t("errors.validation_failed")} />
                    )}
                  </div>
                )}
                <footer className={styles.footer}>
                  <button
                    disabled={busy}
                    onClick={() => {
                      reopen.current = task ?? null;
                      finishing.current = false;
                      void model.discardDraft();
                      setMode("browse");
                    }}
                  >
                    {t("cancel")}
                  </button>
                  {step > 1 && (
                    <button disabled={busy} onClick={() => setStep((n) => n - 1)}>
                      {t("back")}
                    </button>
                  )}
                  <button
                    className={styles.primary}
                    disabled={
                      busy ||
                      Boolean(model.pending) ||
                      (step === 3 && Boolean(model.dirty && !model.confirmation))
                    }
                    onClick={step === 3 ? confirm : next}
                  >
                    {busy ? t("saving") : step === 3 ? t("confirm") : t("next")}
                  </button>
                </footer>
              </div>
            ) : selected && form ? (
              <>
                <div className={styles.heading}>
                  <h2 className={styles.taskHeading}>
                    {form.name}
                    {running && <TaskRunningMark label={t("running")} />}
                  </h2>
                </div>
                <div className={styles.tabs} role="tablist" aria-label={t("taskViews")}>
                  <button
                    role="tab"
                    aria-selected={tab === "overview"}
                    onClick={() => setTab("overview")}
                  >
                    {t("overview")}
                  </button>
                  <button
                    role="tab"
                    aria-selected={tab === "results"}
                    onClick={() => {
                      if (results) setTab("results");
                      else onNavigate?.("inbox");
                    }}
                  >
                    {t("results")}
                    {(unreadCounts[selected.taskId] ?? 0) > 0 && (
                      <span className={styles.badge}>
                        {unreadPartial
                          ? `${unreadCounts[selected.taskId]}+`
                          : unreadCounts[selected.taskId]}
                      </span>
                    )}
                  </button>
                  <button
                    role="tab"
                    aria-selected={false}
                    disabled={!writable || busy}
                    onClick={() => {
                      setMode("edit");
                      setStep(1);
                    }}
                  >
                    {t("settings")}
                  </button>
                </div>
                {tab === "results" ? (
                  results
                ) : (
                  <div className={styles.transition} key="overview">
                    <p className={styles.goal}>{form.goal}</p>
                    <dl>
                      <dt>{t("resources")}</dt>
                      <dd>
                        {model.bindings.map((b) => t(`kinds.${b.ref.kind}`)).join("、") ||
                          t("none")}
                      </dd>
                      <dt>{t("executors")}</dt>
                      <dd>{providers.map(providerName).join("、") || t("noExecutor")}</dd>
                      <dt>{t("runMode")}</dt>
                      <dd>
                        {scheduleLabel}
                        {scheduled && (
                          <small className={styles.hint}>
                            {nextOccurrence
                              ? t("nextExpected", {
                                  date: new Intl.DateTimeFormat(locale, {
                                    dateStyle: "medium",
                                    timeStyle: "short",
                                    timeZone: schedule.timeZone,
                                  }).format(new Date(nextOccurrence)),
                                })
                              : ""}{" "}
                            · {t("dstHint")}
                          </small>
                        )}
                        {scheduled && (
                          <small className={styles.hint}>
                            {currentAssignments.some((r) => r.plan?.status === "enabled")
                              ? t("agentReportedPlan")
                              : t("planUnconfirmed")}
                          </small>
                        )}
                      </dd>
                    </dl>
                    {currentRequest && !running && (
                      <p className={styles.hint}>
                        {t("lastRun", {
                          state: t.has(`stages.${currentRequest.aggregate.state}`)
                            ? t(`stages.${currentRequest.aggregate.state}`)
                            : t("stages.awaiting_confirmation"),
                        })}{" "}
                        <button className={styles.textButton} onClick={() => setProgress(true)}>
                          {t("viewProgress")}
                        </button>
                      </p>
                    )}
                    <footer className={styles.footer}>
                      <button
                        className={styles.textButton}
                        disabled={busy || !center.enabled}
                        onClick={() => setDeleting(true)}
                      >
                        {t("delete")}
                      </button>
                      <button
                        className={styles.primary}
                        disabled={
                          busy ||
                          !center.enabled ||
                          !writable ||
                          selected.status !== "active" ||
                          (!running && !currentAssignments.length)
                        }
                        onClick={() => {
                          if (running) setProgress(true);
                          else {
                            setRunAgents(currentAssignments.map((a) => a.assignment.assignmentId));
                            setChoosingRun(true);
                          }
                        }}
                      >
                        {running ? t("viewProgress") : t("runNow")}
                      </button>
                    </footer>
                  </div>
                )}
              </>
            ) : (
              <div className={styles.empty}>
                <LoadingIndicator busy={model.busy} hasContent={false} label={t("loading")} />
                {!model.busy && (
                  <>
                    <h2>{t("selectTask")}</h2>
                    <p>{t("selectTaskHint")}</p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      <ReportDialog
        id="task-run-choice"
        identity={`${center.scope}:${task}:choose`}
        open={choosingRun && Boolean(center.scope) && Boolean(task)}
        title={t("runNow")}
        closeLabel={t("close")}
        onClose={() => setChoosingRun(false)}
      >
        <div className={styles.form}>
          <fieldset>
            <legend>{t("executors")}</legend>
            {currentAssignments.map((a) => (
              <label className={styles.check} key={a.assignment.assignmentId}>
                <input
                  type="checkbox"
                  checked={runAgents.includes(a.assignment.assignmentId)}
                  onChange={(e) =>
                    setRunAgents((v) =>
                      e.target.checked
                        ? [...v, a.assignment.assignmentId]
                        : v.filter((id) => id !== a.assignment.assignmentId),
                    )
                  }
                />
                {providerName(a.assignment.provider)}
              </label>
            ))}
          </fieldset>
          <button
            className={styles.primary}
            disabled={busy || !runAgents.length}
            onClick={() => void run()}
          >
            {t("runNow")}
          </button>
        </div>
      </ReportDialog>
      <ReportDialog
        id="task-run-progress"
        identity={`${center.scope}:${task ?? ""}:${currentRequest?.snapshot?.requestId ?? "pending"}`}
        open={progress && Boolean(center.scope) && Boolean(task)}
        title={t("progress")}
        closeLabel={t("close")}
        onClose={() => setProgress(false)}
      >
        <div className={styles.progress}>
          {currentRequest?.snapshot?.executors.map((e: J) => {
            const provider =
              assignments.find((a) => a.assignment.assignmentId === e.assignmentId)?.assignment
                .provider ?? "agent";
            return (
              <div className={styles.progressRow} key={e.assignmentId}>
                <strong>{providerName(provider)}</strong>
                <span>
                  {["waiting", "running"].includes(e.stage) && (
                    <TaskRunningMark label={t(`stages.${e.stage}`)} />
                  )}{" "}
                  {t(`stages.${e.stage}`)}
                </span>
                {e.stage === "waiting" && (
                  <button onClick={() => void copyRequest(provider)}>
                    {copied === provider
                      ? t("copied")
                      : t("continueInAgent", { agent: providerName(provider) })}
                  </button>
                )}
              </div>
            );
          })}
          {!currentRequest && <p>{t(center.pending ? "unknownSave" : "noRun")}</p>}
          {currentRequest?.canCancel && task && (
            <button onClick={() => void center.cancel(task, currentRequest.snapshot.requestId)}>
              {t("cancelRun")}
            </button>
          )}
          <small>{t("canLeave")}</small>
        </div>
      </ReportDialog>
      <ReportDialog
        id="delete-task"
        identity={`${center.scope}:${task}:trash`}
        open={deleting && Boolean(center.scope) && Boolean(task)}
        title={t("delete")}
        closeLabel={t("close")}
        onClose={() => setDeleting(false)}
      >
        <p>{t("deleteConfirm")}</p>
        <div className={styles.footer}>
          <button onClick={() => setDeleting(false)}>{t("cancel")}</button>
          <button className={styles.danger} disabled={busy} onClick={() => void remove()}>
            {t("moveToTrash")}
          </button>
        </div>
      </ReportDialog>
    </section>
  );
}
