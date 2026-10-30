"use client";

import { useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { HoldingsWorkspace } from "./useHoldingsWorkspace";
import { useTasks, type TaskModel } from "./useTasks";
import type { ResourceBindingMetadata, TaskContent } from "@/lib/encrypted-types";
import { defaultTask } from "@/lib/task-forms";
import { bindingKey } from "@/lib/task-types";
import styles from "./TasksPanel.module.css";
import { PasskeyHelp } from "./PasskeyHelp";

export type TaskSeed = ResourceBindingMetadata;
export type TaskRequest = { owner: string; binding: TaskSeed; nonce: number };

export function TasksView({
  workspace,
  model,
  request,
  onRequestConsumed,
}: {
  workspace: HoldingsWorkspace;
  model: TaskModel;
  request?: TaskRequest | null;
  onRequestConsumed?: () => void;
}) {
  const t = useTranslations("tasks"),
    locale = useLocale();
  const action = useRef<"save" | "pause" | "resume" | "archive">("save");
  const unlocked =
    model.unlocked &&
    workspace.authenticated &&
    workspace.phase === "unlocked" &&
    !workspace.needsDeviceApproval &&
    model.owner === workspace.owner;
  const form = unlocked ? model.form : null;
  const selected = unlocked ? model.selected : null;
  const busy = Boolean(model.busy || workspace.busy);
  const hasUnreviewedDraft = Boolean(
    selected && !model.dirty && model.drafts.some((row) => row.slot === selected.taskId),
  );
  const readonly =
    busy ||
    !model.canWrite ||
    model.historical ||
    selected?.status === "archived" ||
    Boolean(model.pending) ||
    hasUnreviewedDraft;
  const date = (value: string) => {
    const time = new Date(value);
    return Number.isFinite(time.getTime())
      ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(time)
      : "—";
  };
  const bindingIdentity = (binding: ResourceBindingMetadata) =>
    `${bindingKey(binding)}:${binding.sourceEpoch}`;
  const short = (id: string) => (id.length > 22 ? `${id.slice(0, 12)}…${id.slice(-6)}` : id);
  const change = (next: TaskContent) => model.setForm(next);
  const start = (template: "brief" | "custom", seed?: TaskSeed) => {
    const next = defaultTask(template);
    next.name = t(template === "brief" ? "briefName" : "customName");
    next.goal = template === "brief" ? t("briefGoal") : "";
    next.outputSpec.label = t("reportLabel");
    next.outputSpec.language = locale === "zh" ? "zh" : "en";
    next.outputSpec.sections = [
      { sectionId: "overview", title: t("overviewTitle"), instructions: "" },
    ];
    if (template === "brief")
      next.outputSpec.sections.push({
        sectionId: "risks",
        title: t("riskTitle"),
        instructions: "",
      });
    model.startNew(seed, next);
    if (seed) onRequestConsumed?.();
  };
  const submit = (type: typeof action.current, confirmed = false) => {
    action.current = type;
    void (type === "save" ? model.save(confirmed) : model.transition(type, confirmed));
  };
  const requested =
    request?.owner === workspace.owner && request.owner === model.owner ? request.binding : null;
  const requestedReady = Boolean(
    requested &&
    model.catalogue.some(
      (row) =>
        row.selectable &&
        row.binding &&
        bindingIdentity(row.binding) === bindingIdentity(requested),
    ),
  );
  const failure = model.error || (workspace.phase !== "unlocked" ? workspace.error : "");
  const errorKey = `errors.${failure}`;
  const headVersion = Math.max(
    selected?.taskVersion ?? 1,
    ...model.history.map((row) => row.taskVersion),
  );
  return (
    <section className={styles.panel} aria-labelledby="tasks-title">
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 id="tasks-title">{t("title")}</h1>
          <p>{t("description")}</p>
        </div>
        {model.owner && model.configured && (
          <div className={styles.actions}>
            <span className={styles.badge}>{t(unlocked ? "unlocked" : "locked")}</span>
            {unlocked && (
              <button className={styles.secondary} onClick={workspace.lock}>
                {t("lock")}
              </button>
            )}
            <button
              className={styles.secondary}
              disabled={busy}
              onClick={() => void model.reload()}
            >
              {t("refresh")}
            </button>
          </div>
        )}
      </header>
      {!model.configured ? (
        <div className={styles.empty}>
          <h2>{t("unavailableTitle")}</h2>
          <p>{t("unavailable")}</p>
        </div>
      ) : !workspace.authenticated ? (
        <div className={styles.empty}>
          <h2>{t("signInTitle")}</h2>
          <p>{t("signInHelp")}</p>
          <button
            className={styles.primary}
            disabled={!["anonymous", "error"].includes(workspace.authStatus)}
            onClick={() => void workspace.signIn()}
          >
            {t("signIn")}
          </button>
        </div>
      ) : (
        <>
          {workspace.phase === "checking" ? (
            <p role="status">{t("loading")}</p>
          ) : (
            !unlocked && (
              <div className={styles.banner}>
                <div>
                  <strong>
                    {t(workspace.phase === "needs-vault" ? "createTitle" : "unlockTitle")}
                  </strong>
                  <p>{t(workspace.phase === "needs-vault" ? "createHelp" : "unlockHelp")}</p>
                  <PasskeyHelp
                    workspace={workspace}
                    mode={workspace.phase === "needs-vault" ? "create" : "unlock"}
                    unlockOptions={{ forResults: true, enableState: true }}
                  />
                </div>
                <button
                  className={styles.primary}
                  disabled={Boolean(busy || workspace.needsDeviceApproval)}
                  onClick={() =>
                    void (workspace.phase === "needs-vault"
                      ? workspace.create()
                      : workspace.unlock({ forResults: true, enableState: true }))
                  }
                >
                  {t(workspace.phase === "needs-vault" ? "create" : "unlock")}
                </button>
              </div>
            )
          )}
          {unlocked && !model.canWrite && (
            <div className={styles.banner}>
              <p>{t("readOnlyHelp")}</p>
              <PasskeyHelp
                workspace={workspace}
                unlockOptions={{ forResults: true, enableState: true }}
              />
              <button
                className={styles.secondary}
                disabled={Boolean(busy || workspace.needsDeviceApproval)}
                onClick={() => void workspace.unlock({ forResults: true, enableState: true })}
              >
                {t("enableChanges")}
              </button>
            </div>
          )}
          {failure && (
            <div className={styles.error} role="alert">
              <strong>{t("attention")}</strong>
              <p>{t(t.has(errorKey) ? errorKey : "errors.request_failed")}</p>
            </div>
          )}
          {unlocked && model.notice && t.has(`notices.${model.notice}`) && (
            <p className={styles.hint} role="status">
              {t(`notices.${model.notice}`)}
            </p>
          )}
          {unlocked && model.drafts.length > 0 && (
            <div className={styles.recovery}>
              <strong>{t("draftsTitle")}</strong>
              <p>{t("draftsHelp")}</p>
              {model.drafts.map((row) => (
                <div className={styles.draftRow} key={row.slot}>
                  <span>
                    {row.slot === "new" ? t("newDraft") : short(row.taskId)} ·{" "}
                    {t("version", { version: row.baseVersion })}
                  </span>
                  <button
                    className={styles.secondary}
                    disabled={busy || model.dirty || Boolean(model.pending)}
                    onClick={() => void model.restoreDraft(row.slot)}
                  >
                    {t("restore")}
                  </button>
                </div>
              ))}
            </div>
          )}
          {unlocked && model.pendingOperations.length > 0 && (
            <div className={styles.recovery}>
              <strong>{t("pendingTitle")}</strong>
              <p>{t("pendingHelp")}</p>
              {model.pendingOperations.map((row) => (
                <div className={styles.draftRow} key={row.operationId}>
                  <span>{short(row.taskId)}</span>
                  <div className={styles.actions}>
                    <button
                      className={styles.secondary}
                      disabled={busy || model.dirty || Boolean(model.pending)}
                      onClick={() => void model.recoverPending(row.taskId)}
                    >
                      {t("recover")}
                    </button>
                    <button
                      className={styles.textButton}
                      disabled={busy}
                      onClick={() => void model.discardPending(row.taskId, row.operationId)}
                    >
                      {t("discardPending")}
                    </button>
                  </div>
                </div>
              ))}
              {model.pending && (
                <button
                  className={styles.primary}
                  disabled={busy || !model.canWrite}
                  onClick={() => void model.resendPending()}
                >
                  {t("retry")}
                </button>
              )}
            </div>
          )}
          {requested && (
            <div className={styles.recovery}>
              <strong>{t("selectedResource")}</strong>
              <p>{t("selectedResourceHelp", { kind: t(`kinds.${requested.ref.kind}`) })}</p>
              {!requestedReady && <p>{t("resourceUnavailable")}</p>}
              <div className={styles.actions}>
                <button
                  className={styles.primary}
                  disabled={
                    !unlocked ||
                    !model.canWrite ||
                    busy ||
                    Boolean(form) ||
                    !requestedReady ||
                    model.items.length >= 32 ||
                    model.drafts.some((row) => row.slot === "new")
                  }
                  onClick={() => start("brief", requested)}
                >
                  {t("startSelected")}
                </button>
                <button className={styles.secondary} disabled={busy} onClick={onRequestConsumed}>
                  {t("cancel")}
                </button>
              </div>
            </div>
          )}
          <div className={styles.layout}>
            <aside className={styles.listColumn} aria-label={t("title")}>
              <button
                className={styles.primary}
                disabled={!unlocked || !model.canWrite || busy || Boolean(form)}
                onClick={() => start("brief")}
              >
                {t("new")}
              </button>
              {model.loading && <p role="status">{t("loading")}</p>}
              <div className={styles.list}>
                {model.items.map((item) => (
                  <button
                    className={styles.task}
                    data-selected={selected?.taskId === item.taskId}
                    key={item.taskId}
                    disabled={!unlocked || busy || model.dirty || Boolean(model.pending)}
                    onClick={() => void model.openTask(item.taskId)}
                  >
                    <strong>
                      {selected?.taskId === item.taskId && form ? form.name : t("encryptedTask")}
                    </strong>
                    <span>{short(item.taskId)}</span>
                    <div>
                      <span>{t(`statuses.${item.status}`)}</span>
                      <span>{t("version", { version: item.taskVersion })}</span>
                    </div>
                    <small>{date(item.updatedAt)}</small>
                  </button>
                ))}
              </div>
            </aside>
            {!form ? (
              <div className={styles.empty}>
                <h2>{t("emptyTitle")}</h2>
                <p>{t("emptyHelp")}</p>
                <p>{t("templateHelp")}</p>
                <div className={styles.actions}>
                  <button
                    className={styles.primary}
                    disabled={!unlocked || !model.canWrite || busy}
                    onClick={() => start("brief")}
                  >
                    {t("brief")}
                  </button>
                  <button
                    className={styles.secondary}
                    disabled={!unlocked || !model.canWrite || busy}
                    onClick={() => start("custom")}
                  >
                    {t("custom")}
                  </button>
                </div>
              </div>
            ) : (
              <div className={styles.editor}>
                <div className={styles.editorTop}>
                  <span className={styles.badge}>
                    {t(model.historical ? "historical" : model.dirty ? "dirty" : "saved")}
                  </span>
                  <button
                    className={styles.textButton}
                    disabled={busy || Boolean(model.pending)}
                    onClick={() => void model.discardDraft()}
                  >
                    {t("discard")}
                  </button>
                </div>
                {selected && (
                  <div className={styles.actions}>
                    <label>
                      {t("history")}
                      <select
                        aria-label={t("history")}
                        value={selected.taskVersion}
                        disabled={busy || model.dirty || Boolean(model.pending)}
                        onChange={(event) => void model.loadVersion(Number(event.target.value))}
                      >
                        {Array.from({ length: headVersion }, (_, index) => index + 1)
                          .reverse()
                          .map((version) => (
                            <option key={version} value={version}>
                              {t("version", { version })}
                            </option>
                          ))}
                      </select>
                    </label>
                    {model.historical && (
                      <button
                        className={styles.secondary}
                        disabled={busy}
                        onClick={() => void model.openTask(selected.taskId)}
                      >
                        {t("current")}
                      </button>
                    )}
                  </div>
                )}
                <fieldset disabled={readonly} className={styles.form}>
                  <label>
                    {t("name")}
                    <input
                      value={form.name}
                      maxLength={80}
                      onChange={(event) => change({ ...form, name: event.target.value })}
                    />
                  </label>
                  <label>
                    {t("goal")}
                    <textarea
                      rows={4}
                      value={form.goal}
                      maxLength={2000}
                      onChange={(event) => change({ ...form, goal: event.target.value })}
                    />
                  </label>
                  <section>
                    <h2>{t("resources")}</h2>
                    <p>{t("resourcesHelp")}</p>
                    <p>{t("resourceLimit")}</p>
                    {model.catalogue.length === 0 && <p>{t("noResources")}</p>}
                    {model.catalogue.map((option, index) => {
                      const key = option.binding
                        ? bindingIdentity(option.binding)
                        : `unavailable_${index}`;
                      const checked = Boolean(
                        option.binding &&
                        model.bindings.some((row) => bindingIdentity(row) === key),
                      );
                      return (
                        <label className={styles.resource} key={key}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={
                              (!option.selectable && !checked) ||
                              (!checked && model.bindings.length >= 10)
                            }
                            onChange={(event) => {
                              if (option.binding)
                                model.setBindings(
                                  event.target.checked
                                    ? [...model.bindings, option.binding]
                                    : model.bindings.filter((row) => bindingIdentity(row) !== key),
                                );
                            }}
                          />
                          <span>
                            <strong>{t(`kinds.${option.kind}`)}</strong>
                            {option.binding && (
                              <small>
                                {short(option.binding.ref.resourceId)} ·{" "}
                                {t("sourceEpoch", { epoch: option.binding.sourceEpoch })}
                              </small>
                            )}
                            <small>
                              {option.selectable
                                ? t(
                                    option.encryptedEvidence === "not_prepared"
                                      ? "notPrepared"
                                      : "notChecked",
                                  )
                                : t("resourceUnavailable")}
                            </small>
                          </span>
                        </label>
                      );
                    })}
                    {model.bindings
                      .filter(
                        (binding) =>
                          !model.catalogue.some(
                            (row) =>
                              row.binding &&
                              bindingIdentity(row.binding) === bindingIdentity(binding),
                          ),
                      )
                      .map((binding) => (
                        <label className={styles.resource} key={bindingIdentity(binding)}>
                          <input
                            type="checkbox"
                            checked
                            onChange={() =>
                              model.setBindings(
                                model.bindings.filter(
                                  (row) => bindingIdentity(row) !== bindingIdentity(binding),
                                ),
                              )
                            }
                          />
                          <span>
                            {t(`kinds.${binding.ref.kind}`)} · {t("resourceUnavailable")}
                          </span>
                        </label>
                      ))}
                  </section>
                  <section>
                    <h2>{t("inputPolicy")}</h2>
                    <label className={styles.check}>
                      <input
                        type="checkbox"
                        checked={form.inputPolicy.allowPartial}
                        onChange={(event) =>
                          change({
                            ...form,
                            inputPolicy: {
                              ...form.inputPolicy,
                              allowPartial: event.target.checked,
                            },
                          })
                        }
                      />
                      {t("partial")}
                    </label>
                    <label className={styles.check}>
                      <input
                        type="checkbox"
                        checked={form.inputPolicy.allowUnknownAsOf}
                        onChange={(event) =>
                          change({
                            ...form,
                            inputPolicy: {
                              ...form.inputPolicy,
                              allowUnknownAsOf: event.target.checked,
                            },
                          })
                        }
                      />
                      {t("unknownAsOf")}
                    </label>
                    <label>
                      {t("maxAge")}
                      <input
                        type="number"
                        min={1}
                        max={10080}
                        value={
                          form.inputPolicy.maxFetchedAgeSeconds < 0
                            ? ""
                            : form.inputPolicy.maxFetchedAgeSeconds / 60
                        }
                        onChange={(event) =>
                          change({
                            ...form,
                            inputPolicy: {
                              ...form.inputPolicy,
                              maxFetchedAgeSeconds:
                                event.target.value === "" ? -1 : Number(event.target.value) * 60,
                            },
                          })
                        }
                      />
                    </label>
                  </section>
                  <section>
                    <h2>{t("output")}</h2>
                    <div className={styles.columns}>
                      <label>
                        {t("label")}
                        <input
                          value={form.outputSpec.label}
                          maxLength={40}
                          onChange={(event) =>
                            change({
                              ...form,
                              outputSpec: { ...form.outputSpec, label: event.target.value },
                            })
                          }
                        />
                      </label>
                      <label>
                        {t("language")}
                        <select
                          value={form.outputSpec.language}
                          onChange={(event) =>
                            change({
                              ...form,
                              outputSpec: {
                                ...form.outputSpec,
                                language: event.target.value as "zh" | "en",
                              },
                            })
                          }
                        >
                          <option value="en">English</option>
                          <option value="zh">中文</option>
                        </select>
                      </label>
                      <label>
                        {t("verbosity")}
                        <select
                          value={form.outputSpec.verbosity}
                          onChange={(event) =>
                            change({
                              ...form,
                              outputSpec: {
                                ...form.outputSpec,
                                verbosity: event.target.value as "concise" | "standard",
                              },
                            })
                          }
                        >
                          <option value="concise">{t("concise")}</option>
                          <option value="standard">{t("standard")}</option>
                        </select>
                      </label>
                    </div>
                    <h3>{t("sections")}</h3>
                    {form.outputSpec.sections.map((part, index) => (
                      <div className={styles.sectionEditor} key={part.sectionId}>
                        <label>
                          {t("sectionTitle")} {index + 1}
                          <input
                            value={part.title}
                            maxLength={120}
                            onChange={(event) =>
                              change({
                                ...form,
                                outputSpec: {
                                  ...form.outputSpec,
                                  sections: form.outputSpec.sections.map((value, i) =>
                                    i === index ? { ...value, title: event.target.value } : value,
                                  ),
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          {t("instructions")}
                          <textarea
                            rows={2}
                            value={part.instructions}
                            maxLength={1000}
                            onChange={(event) =>
                              change({
                                ...form,
                                outputSpec: {
                                  ...form.outputSpec,
                                  sections: form.outputSpec.sections.map((value, i) =>
                                    i === index
                                      ? { ...value, instructions: event.target.value }
                                      : value,
                                  ),
                                },
                              })
                            }
                          />
                        </label>
                        <button
                          className={styles.textButton}
                          disabled={form.outputSpec.sections.length <= 1}
                          onClick={() =>
                            change({
                              ...form,
                              outputSpec: {
                                ...form.outputSpec,
                                sections: form.outputSpec.sections.filter((_, i) => i !== index),
                              },
                            })
                          }
                        >
                          {t("removeSection")}
                        </button>
                      </div>
                    ))}
                    <button
                      className={styles.secondary}
                      disabled={form.outputSpec.sections.length >= 8}
                      onClick={() =>
                        change({
                          ...form,
                          outputSpec: {
                            ...form.outputSpec,
                            sections: [
                              ...form.outputSpec.sections,
                              {
                                sectionId: `section_${crypto.randomUUID().replaceAll("-", "")}`,
                                title: "",
                                instructions: "",
                              },
                            ],
                          },
                        })
                      }
                    >
                      {t("addSection")}
                    </button>
                  </section>
                  <section>
                    <h2>{t("expectation")}</h2>
                    <p>{t("expectationHelp")}</p>
                    <label>
                      {t("cadence")}
                      <select
                        value={form.deliveryExpectation?.cadence ?? "none"}
                        onChange={(event) => {
                          const cadence = event.target.value as
                            "none" | "daily" | "weekdays" | "weekly";
                          const base = form.deliveryExpectation ?? {
                            localTime: "09:00",
                            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
                            graceMinutes: 60,
                          };
                          const rule = {
                            localTime: base.localTime,
                            timeZone: base.timeZone,
                            graceMinutes: base.graceMinutes,
                          };
                          change({
                            ...form,
                            deliveryExpectation:
                              cadence === "none"
                                ? null
                                : cadence === "weekly"
                                  ? {
                                      ...rule,
                                      cadence,
                                      weekday: form.deliveryExpectation?.weekday ?? 1,
                                    }
                                  : { ...rule, cadence },
                          });
                        }}
                      >
                        {["none", "daily", "weekdays", "weekly"].map((value) => (
                          <option key={value} value={value}>
                            {t(value)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {form.deliveryExpectation && (
                      <div className={styles.columns}>
                        <label>
                          {t("localTime")}
                          <input
                            type="time"
                            value={form.deliveryExpectation.localTime}
                            onChange={(event) =>
                              change({
                                ...form,
                                deliveryExpectation: {
                                  ...form.deliveryExpectation!,
                                  localTime: event.target.value,
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          {t("timeZone")}
                          <input
                            value={form.deliveryExpectation.timeZone}
                            maxLength={80}
                            onChange={(event) =>
                              change({
                                ...form,
                                deliveryExpectation: {
                                  ...form.deliveryExpectation!,
                                  timeZone: event.target.value,
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          {t("grace")}
                          <input
                            type="number"
                            min={0}
                            max={1440}
                            value={
                              form.deliveryExpectation.graceMinutes < 0
                                ? ""
                                : form.deliveryExpectation.graceMinutes
                            }
                            onChange={(event) =>
                              change({
                                ...form,
                                deliveryExpectation: {
                                  ...form.deliveryExpectation!,
                                  graceMinutes:
                                    event.target.value === "" ? -1 : Number(event.target.value),
                                },
                              })
                            }
                          />
                        </label>
                        {form.deliveryExpectation.cadence === "weekly" && (
                          <label>
                            {t("weekday")}
                            <select
                              value={form.deliveryExpectation.weekday}
                              onChange={(event) =>
                                change({
                                  ...form,
                                  deliveryExpectation: {
                                    ...form.deliveryExpectation!,
                                    weekday: Number(event.target.value),
                                  },
                                })
                              }
                            >
                              {Array.from({ length: 7 }, (_, day) => (
                                <option key={day} value={day}>
                                  {t(`weekDays.${day}`)}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                      </div>
                    )}
                    {model.nextExpectedAt && (
                      <p>{t("nextExpected", { date: date(model.nextExpectedAt) })}</p>
                    )}
                  </section>
                </fieldset>
                {model.conflictCurrent && (
                  <div className={styles.recovery}>
                    <p>{t("rebaseHelp")}</p>
                    <button
                      className={styles.secondary}
                      disabled={readonly}
                      onClick={() => void model.rebaseDraft()}
                    >
                      {t("rebase")}
                    </button>
                  </div>
                )}
                {model.preview && (
                  <div className={styles.preview} aria-live="polite">
                    <strong>{t("preview")}</strong>
                    {model.preview.valid ? (
                      <p>{t("validPreview")}</p>
                    ) : (
                      <ul>
                        {model.preview.errors.map((code) => (
                          <li key={code}>{t(`validation.${code}`)}</li>
                        ))}
                      </ul>
                    )}
                    <h3>{form.name}</h3>
                    <p>{form.goal}</p>
                    <ol>
                      {form.outputSpec.sections.map((part) => (
                        <li key={part.sectionId}>
                          <strong>{part.title}</strong>
                          <p>{part.instructions}</p>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                {model.confirmation && (
                  <div className={styles.recovery} role="status">
                    <strong>{t("confirmationTitle")}</strong>
                    {model.confirmationReasons.map((reason) => (
                      <p key={reason}>{t(`confirmations.${reason}`)}</p>
                    ))}
                    <div className={styles.actions}>
                      <button
                        className={styles.primary}
                        disabled={readonly}
                        onClick={() => submit(action.current, true)}
                      >
                        {t("confirm")}
                      </button>
                      <button
                        className={styles.secondary}
                        disabled={busy}
                        onClick={model.cancelConfirmation}
                      >
                        {t("cancel")}
                      </button>
                    </div>
                  </div>
                )}
                <div className={styles.actions}>
                  <button className={styles.secondary} disabled={readonly} onClick={model.review}>
                    {t("preview")}
                  </button>
                  <button
                    className={styles.primary}
                    disabled={readonly || !model.dirty}
                    onClick={() => submit("save")}
                  >
                    {t("save")}
                  </button>
                  {selected && !model.historical && selected.status !== "archived" && (
                    <>
                      <button
                        className={styles.secondary}
                        disabled={readonly || model.dirty}
                        onClick={() => submit(selected.status === "paused" ? "resume" : "pause")}
                      >
                        {t(selected.status === "paused" ? "resume" : "pause")}
                      </button>
                      <button
                        className={styles.secondary}
                        disabled={readonly || model.dirty}
                        onClick={() => submit("archive")}
                      >
                        {t("archive")}
                      </button>
                    </>
                  )}
                </div>
                {selected && !model.dirty && !model.historical && (
                  <div className={styles.handoff}>
                    <h2>{t("handoffTitle")}</h2>
                    <p>{t("handoffHelp")}</p>
                    <code>{selected.taskId}</code>
                    <button
                      className={styles.secondary}
                      disabled={busy}
                      onClick={() => void model.copyHandoff()}
                    >
                      {t("copyId")}
                    </button>
                    <small>{t("copyHint")}</small>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export default function TasksPanel({
  workspace,
  active,
  request,
  onRequestConsumed,
}: {
  workspace: HoldingsWorkspace;
  active: boolean;
  request?: TaskRequest | null;
  onRequestConsumed?: () => void;
}) {
  const model = useTasks(workspace, { active });
  return (
    <TasksView
      workspace={workspace}
      model={model}
      request={request}
      onRequestConsumed={onRequestConsumed}
    />
  );
}
