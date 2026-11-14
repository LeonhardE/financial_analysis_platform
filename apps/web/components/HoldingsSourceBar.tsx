"use client";
import { useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { HoldingsWorkspace } from "./useHoldingsWorkspace";
import type { DisplayNamesModel } from "./useDisplayNames";
import type { ResourceLibraryModel } from "./useResourceLibrary";
import type { ResourceSelection } from "@/lib/resource-library";
import { useTasks } from "./useTasks";
import { ReportDialog } from "./ReportDialog";
import { InlineError, LoadingIndicator } from "./WorkspaceFeedback";
import styles from "./ResourcesPanel.module.css";
import { factsContent, formatHoldingsTime } from "@/lib/holdings-facts";

function RelatedTasks({
  model,
  source,
}: {
  model: HoldingsWorkspace;
  source: { resourceId: string; incarnation: string };
}) {
  const t = useTranslations("resources.manage"),
    tasks = useTasks(model, { active: true });
  const linked = tasks.items.filter((task) =>
    task.resourceBindings.some(
      (binding) =>
        binding.ref.resourceId === source.resourceId &&
        binding.ref.incarnation === source.incarnation,
    ),
  );
  return (
    <section aria-label={t("relatedTasks")}>
      <h3>{t("relatedTasks")}</h3>
      <LoadingIndicator busy={tasks.loading} hasContent={linked.length > 0} label={t("loading")} />
      {tasks.listError ? (
        <InlineError
          message={t("tasksFailed")}
          onRetry={() => void tasks.reloadTasks()}
          retryLabel={t("retry")}
        />
      ) : !tasks.loading && !linked.length ? (
        <p className={styles.note}>{t("noTasks")}</p>
      ) : null}
      <ul className={styles.relatedTasks}>
        {linked.map((task) => (
          <li key={task.taskId}>
            {tasks.taskNames[task.taskId] ? (
              <a
                href={`/tasks#task/${task.taskId}`}
                onClick={(event) => {
                  if (
                    event.button === 0 &&
                    !event.metaKey &&
                    !event.ctrlKey &&
                    !event.altKey &&
                    !event.shiftKey
                  ) {
                    event.preventDefault();
                    window.history.pushState(null, "", `/tasks#task/${task.taskId}`);
                  }
                }}
              >
                {tasks.taskNames[task.taskId]}
              </a>
            ) : tasks.nameErrors[task.taskId] ? (
              <button type="button" onClick={() => tasks.retryTaskName(task.taskId)}>
                {t("retryName")}
              </button>
            ) : (
              <LoadingIndicator busy label={t("loadingName")} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function HoldingsSourceBar({
  model,
  names,
  library,
  onCreateTask,
  onUpdate,
  children,
}: {
  model: HoldingsWorkspace;
  names: DisplayNamesModel;
  library: ResourceLibraryModel;
  onCreateTask?: (selection: ResourceSelection) => void;
  onUpdate: () => void;
  children: ReactNode;
}) {
  const locale = useLocale();
  const t = useTranslations("resources"),
    [settings, setSettings] = useState(false),
    [draft, setDraft] = useState(""),
    [discardName, setDiscardName] = useState(false);
  const sources = model.sources ?? [];
  const rows = sources.filter(
    (source) =>
      !library.catalogue.data?.groups
        .find((g) => g.kind === "holdings")
        ?.items.some(
          (item) =>
            item.ref?.resourceId === source.resourceRef.resourceId && item.state === "deleted",
        ),
  );
  const selected =
    sources.find((s) => s.resourceRef.resourceId === model.selectedSourceId) ??
    (!model.newSource ? sources.at(-1) : undefined);
  const selectedRef = selected?.resourceRef;
  const title = selectedRef
    ? (names.name(selectedRef) ?? t("lifecycle.source", { number: sources.indexOf(selected!) + 1 }))
    : t("lifecycle.new");
  const sourceItem = library.catalogue.data?.groups
    .find((g) => g.kind === "holdings")
    ?.items.find(
      (item) =>
        item.ref?.resourceId === selectedRef?.resourceId &&
        item.ref?.incarnation === selectedRef?.incarnation,
    );
  const operationBlocked = Boolean((model.busy && model.busy !== "reading") || names.busy);
  const blocked = operationBlocked || Boolean(model.preview);
  const pending = selectedRef && names.pending(selectedRef);
  const editable =
    model.canWriteState &&
    !model.busy &&
    !model.sourceMutation &&
    !model.sourceCreationId &&
    model.sourceMetadata?.state === "active";
  return (
    <>
      <div className={styles.sourceBar}>
        <label className={styles.sourcePicker}>
          <span className="sr-only">{t("lifecycle.select")}</span>
          <select
            value={model.newSource ? "new" : (selectedRef?.resourceId ?? "new")}
            disabled={blocked}
            onChange={(e) => {
              setSettings(false);
              void model.selectHoldingsSource(e.target.value);
            }}
          >
            {(model.newSource || !sources.length) && (
              <option value="new">{t("lifecycle.new")}</option>
            )}
            {rows.map((source) => (
              <option key={source.resourceRef.resourceId} value={source.resourceRef.resourceId}>
                {names.name(source.resourceRef) ??
                  t("lifecycle.source", { number: sources.indexOf(source) + 1 })}
              </option>
            ))}
            {selected && !rows.includes(selected) && (
              <option value={selected.resourceRef.resourceId}>
                {t("lifecycle.states.deleted")}
              </option>
            )}
          </select>
        </label>
        <LoadingIndicator busy={names.loading} hasContent label={t("manage.loadingNames")} />
        <div className={styles.sourceActions}>
          <button
            type="button"
            className={styles.secondary}
            disabled={blocked}
            onClick={() => void model.readStored()}
          >
            {t("manage.refresh")}
          </button>
          {selected && !model.newSource && (
            <button
              type="button"
              className={styles.secondary}
              disabled={operationBlocked}
              onClick={() => {
                setDiscardName(false);
                setDraft(names.name(selected.resourceRef) ?? "");
                names.clearError();
                setSettings(true);
              }}
            >
              {t("lifecycle.settings")}
            </button>
          )}
          {!model.newSource && sources.length < 10 && (
            <button
              type="button"
              className={styles.primary}
              disabled={
                operationBlocked ||
                Boolean(model.preview?.intent === "edit" || model.preview?.intent === "manual") ||
                !model.canWriteState ||
                Boolean(model.hasPending || model.sourceMutation || model.sourceCreationId)
              }
              onClick={model.beginNewSource}
            >
              {t("manage.add")}
            </button>
          )}
        </div>
      </div>
      {selected && !model.newSource && (
        <p className={styles.note}>
          {model.content && factsContent(model.content) && !model.content.data.importSnapshot
            ? t("editing.manualSource")
            : "Wealthsimple"}{" "}
          ·{" "}
          {model.content
            ? t(
                factsContent(model.content) && model.content.data.editKind !== "import"
                  ? "editing.updatedAt"
                  : "importedAt",
                { time: formatHoldingsTime(model.content.fetchedAt, locale) },
              )
            : t("holdingsCsv")}
        </p>
      )}
      {(pending || model.sourceMutation || model.sourceCreationId) && !settings && selected && (
        <button type="button" className={styles.secondary} onClick={() => setSettings(true)}>
          {t("manage.finishPending")}
        </button>
      )}
      {model.sourceCreationId && !selected && children}
      <ReportDialog
        id="holdings-source-settings"
        open={settings && model.phase === "unlocked" && Boolean(selectedRef)}
        identity={`${names.scope}:${selectedRef?.resourceId}`}
        title={t("lifecycle.settings")}
        closeLabel={t("manage.close")}
        onClose={() => setSettings(false)}
      >
        <form
          className={styles.nameForm}
          onSubmit={(e) => {
            e.preventDefault();
            if (selectedRef) void names.rename(selectedRef, draft.trim());
          }}
        >
          <label>
            {t("manage.name")}
            <input
              value={draft}
              maxLength={80}
              placeholder={title}
              disabled={!editable || names.busy || pending || !names.enabled}
              onChange={(e) => setDraft(e.target.value)}
            />
          </label>
          <button
            className={styles.primary}
            type="submit"
            disabled={
              !editable ||
              names.busy ||
              pending ||
              !names.enabled ||
              !draft.trim() ||
              draft.trim() === names.name(selectedRef!)
            }
          >
            {t(names.busy ? "manage.savingName" : "manage.saveName")}
          </button>
        </form>
        {pending && selectedRef && (
          <div className={styles.warning}>
            <p>{t("manage.namePending")}</p>
            <div className={styles.sourceActions}>
              <button
                type="button"
                className={styles.secondary}
                disabled={names.busy}
                onClick={() => void names.recover(selectedRef)}
              >
                {t("manage.checkName")}
              </button>
              <button
                type="button"
                className={styles.secondary}
                disabled={names.busy || !editable}
                onClick={() => void names.recover(selectedRef, true)}
              >
                {t("manage.retryNameSave")}
              </button>
              <button
                type="button"
                className={styles.secondary}
                disabled={names.busy}
                onClick={() => setDiscardName(true)}
              >
                {t("manage.resumeEditing")}
              </button>
            </div>
          </div>
        )}
        {pending && selectedRef && discardName && (
          <div className={styles.warning} role="group" aria-label={t("manage.resumeEditing")}>
            <p>{t("manage.discardNameHelp")}</p>
            <div className={styles.sourceActions}>
              <button
                type="button"
                className={styles.secondary}
                disabled={names.busy}
                onClick={() => setDiscardName(false)}
              >
                {t("manage.keepWaiting")}
              </button>
              <button
                type="button"
                className={styles.primary}
                disabled={names.busy}
                onClick={() => {
                  void names.discard(selectedRef).then(() => setDiscardName(false));
                }}
              >
                {t("manage.confirmResume")}
              </button>
            </div>
          </div>
        )}
        {names.error && (
          <InlineError
            message={t(`manage.errors.${names.error}`)}
            retryLabel={t("manage.retry")}
            onRetry={() => void names.reload()}
          />
        )}
        {!names.loading && names.ready && !names.enabled && (
          <p className={styles.note}>{t("manage.namingUnavailable")}</p>
        )}
        <div className={styles.sourceActions}>
          <button
            type="button"
            className={styles.secondary}
            disabled={!editable}
            onClick={() => {
              setSettings(false);
              onUpdate();
            }}
          >
            {t("manage.update")}
          </button>
          {onCreateTask && sourceItem && (
            <button
              type="button"
              className={styles.secondary}
              disabled={
                !editable ||
                library.catalogue.loading ||
                !["active", "ready"].includes(sourceItem.state)
              }
              onClick={() => {
                setSettings(false);
                library.useForTask(sourceItem, onCreateTask);
              }}
            >
              {t("manage.useInTask")}
            </button>
          )}
          <a
            href="/agents"
            className={styles.secondary}
            onClick={(event) => {
              if (
                !event.metaKey &&
                !event.ctrlKey &&
                !event.shiftKey &&
                !event.altKey &&
                event.button === 0
              ) {
                event.preventDefault();
                setSettings(false);
                window.history.pushState(null, "", "/agents");
              }
            }}
          >
            {t("manage.sharing")}
          </a>
        </div>
        {settings && selectedRef && <RelatedTasks model={model} source={selectedRef} />}
        <details className={styles.advanced}>
          <summary>{t("manage.advanced")}</summary>
          {children}
        </details>
      </ReportDialog>
    </>
  );
}
