"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { LoadingIndicator, InlineError } from "./WorkspaceFeedback";
import { useHoldingsWorkspace, type HoldingsWorkspace } from "@/components/useHoldingsWorkspace";
import type { HoldingsResourceContent } from "@/lib/holdings-csv";
import styles from "./ResourcesPanel.module.css";
import ResourceLibrary from "./ResourceLibrary";
import type { ResourceSelection } from "@/lib/resource-library";
import { PasskeyHelp } from "./PasskeyHelp";
import { useDisplayNames, type DisplayNamesModel } from "./useDisplayNames";
import { HoldingsSourceBar } from "./HoldingsSourceBar";
import type { WatchlistModel } from "./useWatchlist";
import type { ResourceLibraryModel } from "./useResourceLibrary";

const GUIDE =
  "https://help.wealthsimple.com/hc/en-ca/articles/35654428540571-Request-a-custom-statement";
function amount(value: string) {
  const [whole, decimal] = value.split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${decimal ? `.${decimal}` : ""}`;
}
function Holdings({ content }: { content: HoldingsResourceContent }) {
  const t = useTranslations("resources");
  return (
    <div className={styles.holdings}>
      {content.data.accounts.map((account) => (
        <section className={styles.account} key={account.accountId}>
          <h3>{account.displayName}</h3>
          <div className={styles.balances}>
            {account.balances.map((balance) => (
              <span key={balance.currency}>
                {t("reportedCash", { currency: balance.currency })}:{" "}
                <strong>
                  {balance.cashBalance === null ? t("unknown") : amount(balance.cashBalance)}
                </strong>
              </span>
            ))}
          </div>
          {account.positions.length ? (
            <div
              className={styles.tableScroll}
              tabIndex={0}
              role="region"
              aria-label={t("holdingsTable")}
            >
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{t("security")}</th>
                    <th>{t("quantity")}</th>
                    <th>{t("currency")}</th>
                    <th>{t("marketValue")}</th>
                  </tr>
                </thead>
                <tbody>
                  {account.positions.map((position) => (
                    <tr key={position.assetId}>
                      <td>
                        <strong>{position.symbol ?? t("unknownSymbol")}</strong>
                        <small>
                          {position.name}
                          {position.exchange ? ` · ${position.exchange}` : ""}
                        </small>
                      </td>
                      <td className={styles.number}>{amount(position.quantity)}</td>
                      <td>{position.currency}</td>
                      <td className={styles.number}>
                        {position.marketValue
                          ? `${position.marketValue.currency} ${amount(position.marketValue.amount)}`
                          : t("unknown")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={styles.note}>{t("noSupportedPositions")}</p>
          )}
        </section>
      ))}
      {content.data.excludedAssets.length > 0 && (
        <p className={styles.warning}>
          {t("excludedSummary", { count: content.data.excludedAssets.length })}
        </p>
      )}
      <p className={styles.note}>{t("cashHelp")}</p>
    </div>
  );
}
export function SourceManagement({ model }: { model: HoldingsWorkspace }) {
  const t = useTranslations("resources");
  const sources = model.sources ?? [];
  const busy = Boolean(model.busy);
  const metadata = model.sourceMetadata;
  const blocked =
    busy ||
    Boolean(model.hasPending || model.sourceMutation || model.sourceCreationId) ||
    !model.canWriteState;
  const selected = model.selectedSourceId ?? sources.at(-1)?.resourceRef.resourceId ?? "";
  if (!sources.length && !model.newSource && !model.sourceCreationId) return null;
  return (
    <section className={styles.sourceManagement} aria-labelledby="holdings-management-title">
      <h3 id="holdings-management-title">{t("lifecycle.title")}</h3>
      {model.newSource ? (
        <p role="status">{t("lifecycle.newHelp")}</p>
      ) : (
        metadata && <p role="status">{t(`lifecycle.states.${metadata.state}`)}</p>
      )}
      {metadata?.state === "active" &&
        metadata.snapshotId &&
        metadata.snapshotSourceEpoch !== null &&
        metadata.snapshotSourceEpoch < metadata.source.sourceEpoch && (
          <p className={styles.warning}>{t("lifecycle.historical")}</p>
        )}
      {model.sourceCreationId && (
        <div className={styles.warning} role="status">
          <p>{t("lifecycle.creationPending")}</p>
          <button
            type="button"
            className={styles.secondary}
            disabled={busy}
            onClick={() => void model.resumeSourceCreation()}
          >
            {t("lifecycle.resumeCreation")}
          </button>
          <p>{t("lifecycle.discardCreationHelp")}</p>
          <button
            type="button"
            className={styles.secondary}
            disabled={busy}
            onClick={() => void model.discardSourceCreation()}
          >
            {t("lifecycle.discardCreation")}
          </button>
        </div>
      )}
      {model.sourceMutation ? (
        <div className={styles.warning} role="status">
          <p>{t(model.staleSourceMutation ? "lifecycle.staleHelp" : "lifecycle.pendingHelp")}</p>
          <button
            type="button"
            className={styles.secondary}
            disabled={busy}
            onClick={() =>
              void (model.staleSourceMutation
                ? model.discardStaleSourceChange()
                : model.resumeSourceChange())
            }
          >
            {t(model.staleSourceMutation ? "lifecycle.discardStale" : "lifecycle.resume")}
          </button>
        </div>
      ) : model.sourceReview ? (
        <fieldset className={styles.sourceReview}>
          <legend>{t(`lifecycle.confirm.${model.sourceReview.action}`)}</legend>
          <p>{t(`lifecycle.effects.${model.sourceReview.action}`)}</p>
          <p>{t("lifecycle.copies")}</p>
          {model.preview && (
            <p>
              {t(
                model.sourceReview.action === "fence"
                  ? "lifecycle.previewKept"
                  : "lifecycle.previewClosed",
              )}
            </p>
          )}
          <div className={styles.sourceActions}>
            <button
              type="button"
              className={styles.secondary}
              disabled={busy}
              onClick={model.cancelSourceReview}
            >
              {t("lifecycle.cancel")}
            </button>
            <button
              type="button"
              className={`${styles.secondary} ${styles.danger}`}
              disabled={busy}
              onClick={() => void model.confirmSourceChange()}
            >
              {t(`lifecycle.confirmButton.${model.sourceReview.action}`)}
            </button>
          </div>
        </fieldset>
      ) : (
        metadata &&
        !model.newSource && (
          <details>
            <summary>{t("lifecycle.settings")}</summary>
            <div className={styles.sourceActions}>
              <button
                type="button"
                className={styles.secondary}
                disabled={blocked || metadata.state !== "active"}
                onClick={() => void model.reviewSourceChange("fence")}
              >
                {t("lifecycle.actions.fence")}
              </button>
              <button
                type="button"
                className={styles.secondary}
                disabled={blocked || metadata.state !== "active"}
                onClick={() => void model.reviewSourceChange("disconnect")}
              >
                {t("lifecycle.actions.disconnect")}
              </button>
              <button
                type="button"
                className={`${styles.secondary} ${styles.danger}`}
                disabled={blocked || !["active", "disconnected"].includes(metadata.state)}
                onClick={() => void model.reviewSourceChange("delete")}
              >
                {t("lifecycle.actions.delete")}
              </button>
            </div>
          </details>
        )
      )}
      {!metadata &&
        !model.newSource &&
        !model.sourceMutation &&
        !model.sourceCreationId &&
        sources.length > 0 && (
          <div role="status">
            <p>{t("lifecycle.unknown")}</p>
            {sources.find((source) => source.resourceRef.resourceId === selected)?.sourceEpoch ===
              1 && (
              <button
                type="button"
                className={styles.secondary}
                disabled={blocked}
                onClick={() => void model.initializeHoldingsSource()}
              >
                {t("lifecycle.initialize")}
              </button>
            )}
          </div>
        )}
      {sources.length >= 10 && <p className={styles.note}>{t("lifecycle.limit")}</p>}
    </section>
  );
}
function Workspace({
  model,
  names,
  library,
  onCreateTask,
}: {
  model: HoldingsWorkspace;
  names: DisplayNamesModel;
  library: ResourceLibraryModel;
  onCreateTask?: (selection: ResourceSelection) => void;
}) {
  const t = useTranslations("resources");
  const file = useRef<HTMLInputElement>(null);
  const [importOpen, setImportOpen] = useState(false),
    [dragging, setDragging] = useState(false),
    [dropError, setDropError] = useState(""),
    [importName, setImportName] = useState("");
  const busy = Boolean(model.busy);
  const hiddenHistory =
    model.sourceMetadata?.state === "deleted" || model.sourceMutation?.action === "delete";
  const preview = hiddenHistory ? null : model.preview;
  const canImport =
    model.authenticated &&
    model.configured &&
    model.phase === "unlocked" &&
    !model.needsDeviceApproval &&
    model.canWriteState &&
    !busy &&
    !model.hasPending &&
    !model.sourceMutation &&
    !model.sourceCreationId &&
    (model.newSource ||
      (model.sources ?? []).length === 0 ||
      model.sourceMetadata?.state === "active");
  const importVisible = importOpen || !model.content || Boolean(model.preview) || model.newSource;
  const errorKey = `errors.${model.error}`;
  const choose = (files: FileList | null) => {
    setDragging(false);
    setDropError("");
    if (!canImport || !files?.length) return;
    if (files.length !== 1) {
      setDropError("multipleFiles");
      return;
    }
    void model.importFile(files[0]);
  };
  const savePreview = () =>
    model.save(
      importName.trim()
        ? async (source) => {
            if (!(await names.rename(source.resourceRef, importName.trim(), true)))
              throw Error("display_name_pending");
          }
        : undefined,
    );
  return (
    <>
      {model.phase !== "unlocked" && (
        <div className={styles.vault}>
          <div>
            <h2>{t("vaultTitle")}</h2>
            <p>{t("vaultHelp")}</p>
          </div>
        </div>
      )}
      {!model.configured ? (
        <p className={styles.warning} role="status">
          {t("notConfigured")}
        </p>
      ) : !model.authenticated ? (
        <div className={styles.start}>
          <p>{t("signInHelp")}</p>
          <button
            className={styles.primary}
            type="button"
            disabled={model.authStatus !== "anonymous" && model.authStatus !== "error"}
            onClick={() => void model.signIn()}
          >
            {t("signIn")}
          </button>
        </div>
      ) : model.phase === "checking" || model.busy === "loading" ? (
        <LoadingIndicator busy label={t("loading")} />
      ) : ["archive-pending", "archive-deleted"].includes(model.phase) ||
        model.vault?.archive === null ? (
        <div className={styles.start} role="status">
          <p>{t("archiveUnavailable")}</p>
          <a href="/settings">{t("archiveSettings")}</a>
        </div>
      ) : model.phase === "needs-vault" ? (
        <div className={styles.start}>
          <p>{t("createHelp")}</p>
          <PasskeyHelp workspace={model} mode="create" />
          <button
            className={styles.primary}
            type="button"
            disabled={Boolean(busy || model.needsDeviceApproval)}
            onClick={() => void model.create()}
          >
            {t(model.busy === "creating" ? "creating" : "create")}
          </button>
          <p className={styles.note}>{t("passkeyHelp")}</p>
        </div>
      ) : model.phase === "renewal-only" ? (
        <div className={styles.start} role="status">
          <p>{t("renewalOnly")}</p>
        </div>
      ) : model.phase === "locked" || model.needsDeviceApproval ? (
        <div className={styles.start}>
          <p>{t("unlockHelp")}</p>
          <PasskeyHelp workspace={model} />
          <button
            className={styles.primary}
            type="button"
            disabled={Boolean(busy || model.needsDeviceApproval)}
            onClick={() => void model.unlock()}
          >
            {t(model.busy === "unlocking" ? "unlocking" : "unlock")}
          </button>
        </div>
      ) : (
        <>
          <HoldingsSourceBar
            model={model}
            names={names}
            library={library}
            onCreateTask={onCreateTask}
            onUpdate={() => {
              setImportOpen(true);
              requestAnimationFrame(() => file.current?.focus());
            }}
          >
            <SourceManagement model={model} />
          </HoldingsSourceBar>
          {importVisible && (
            <div className={styles.importFlow}>
              <ol className={styles.importSteps} aria-label={t("manage.importSteps")}>
                {["choose", "review", "save"].map((step, index) => (
                  <li
                    key={step}
                    data-current={index === (model.busy === "saving" ? 2 : preview ? 1 : 0)}
                  >
                    {t(`manage.steps.${step}`)}
                  </li>
                ))}
              </ol>
              <div
                className={styles.upload}
                data-dragging={dragging}
                aria-label={t("manage.dropZone")}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = canImport ? "copy" : "none";
                  setDragging(canImport);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                    setDragging(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  choose(event.dataTransfer.files);
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5" />
                </svg>
                <h3>{t("chooseTitle")}</h3>
                <p>{t("manage.dropHelp")}</p>
                <input
                  ref={file}
                  className="sr-only"
                  type="file"
                  accept=".csv,text/csv"
                  aria-label={t("chooseFile")}
                  disabled={!canImport}
                  onChange={(event) => {
                    choose(event.target.files);
                    event.target.value = "";
                  }}
                />
                <button
                  type="button"
                  className={styles.primary}
                  disabled={!canImport}
                  onClick={() => file.current?.click()}
                >
                  {t(model.busy === "parsing" ? "parsing" : "chooseFile")}
                </button>
                <small>{t("fileLimit")}</small>
              </div>
            </div>
          )}
          {dropError && <InlineError message={t(`manage.${dropError}`)} />}
          {model.busy === "parsing" && <LoadingIndicator busy label={t("parsing")} />}
          {model.hasPending && (
            <div className={styles.warning} role="status">
              <p>{t("pendingHelp")}</p>
              <button
                className={styles.secondary}
                type="button"
                disabled={busy}
                onClick={() => void model.save()}
              >
                {t(model.busy === "saving" ? "retrying" : "retryEncrypted")}
              </button>
              {!model.discardOperationId ? (
                <button
                  className={styles.secondary}
                  type="button"
                  disabled={busy}
                  onClick={() => void model.recoverPending()}
                >
                  {t(model.busy === "recovering" ? "recovering" : "recoverOrDiscard")}
                </button>
              ) : (
                <div
                  className={styles.guideNote}
                  role="group"
                  aria-label={t("discardConfirmation")}
                >
                  <p>{t("discardHelp")}</p>
                  <div className={styles.actions}>
                    <button
                      className={styles.secondary}
                      type="button"
                      disabled={busy}
                      onClick={model.keepPending}
                    >
                      {t("keepPending")}
                    </button>
                    <button
                      className={styles.primary}
                      type="button"
                      disabled={busy}
                      onClick={() => void model.discardPending()}
                    >
                      {t("confirmDiscard")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {preview && (
            <section className={styles.preview} aria-labelledby="import-preview-title">
              <div className={styles.sectionHeading}>
                <div>
                  <span className={styles.eyebrow}>{t("stepPreview")}</span>
                  <h2 id="import-preview-title">{t("previewTitle")}</h2>
                </div>
                <button
                  className={styles.secondary}
                  type="button"
                  disabled={
                    busy ||
                    model.hasPending ||
                    Boolean(model.sourceMutation || model.sourceCreationId) ||
                    (!model.newSource &&
                      (model.sources ?? []).length > 0 &&
                      model.sourceMetadata?.state !== "active")
                  }
                  onClick={model.discardPreview}
                >
                  {t("cancelPreview")}
                </button>
              </div>
              <p className={styles.note}>
                {t("reportDate", { date: preview.reportDate ?? t("unknown") })} ·{" "}
                {t("timePrecision")}
              </p>
              {(model.newSource || !(model.sources ?? []).length) && (
                <label className={styles.importName}>
                  {t("manage.nameOptional")}
                  <input
                    maxLength={80}
                    value={importName}
                    disabled={busy || !names.enabled}
                    onChange={(e) => setImportName(e.target.value)}
                  />
                </label>
              )}
              <fieldset className={styles.accountChoices} disabled={busy || model.hasPending}>
                <legend>{t("selectAccounts")}</legend>
                {preview.accounts.map((account) => {
                  const selected = preview.selectedAccountIds.includes(account.accountId);
                  return (
                    <label key={account.accountId}>
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={selected && preview.selectedAccountIds.length === 1}
                        onChange={() =>
                          model.selectAccounts(
                            selected
                              ? preview.selectedAccountIds.filter((id) => id !== account.accountId)
                              : [...preview.selectedAccountIds, account.accountId],
                          )
                        }
                      />
                      <span>
                        <strong>{account.displayName}</strong>
                        <small>
                          {t("accountRows", {
                            count: account.positionCount,
                            excluded: account.excludedCount,
                          })}
                        </small>
                      </span>
                    </label>
                  );
                })}
              </fieldset>
              <div className={styles.summary}>
                <div>
                  <small>{t("selectedAccounts")}</small>
                  <strong>{preview.stats.accounts}</strong>
                </div>
                <div>
                  <small>{t("positions")}</small>
                  <strong>{preview.stats.positions}</strong>
                </div>
                {Object.entries(preview.stats.totals).map(([currency, value]) => (
                  <div key={currency}>
                    <small>{t("reportedValue", { currency })}</small>
                    <strong>{amount(value)}</strong>
                  </div>
                ))}
              </div>
              <p className={styles.note}>{t("totalsHelp")}</p>
              <p className={styles.note}>{t("importScope")}</p>
              <details
                className={styles.reviewNotes}
                open={preview.stats.excluded > 0 || preview.stats.duplicates > 0}
              >
                <summary>{t("reviewNotes", { count: preview.warnings.length })}</summary>
                <ul>
                  {preview.warnings.map((warning) => (
                    <li key={warning.code}>
                      {t.has(`warnings.${warning.code}`)
                        ? t(`warnings.${warning.code}`)
                        : t("warnings.generic")}
                      {warning.count > 1 ? ` (${warning.count})` : ""}
                      {warning.row ? ` · ${t("row", { row: warning.row })}` : ""}
                    </li>
                  ))}
                </ul>
              </details>
              <Holdings content={preview.resourceContent} />
              <div className={styles.confirm}>
                <p>{t("confirmHelp")}</p>
                <button
                  className={styles.primary}
                  type="button"
                  disabled={busy || model.hasPending}
                  onClick={() => void savePreview()}
                >
                  {t(model.busy === "saving" ? "saving" : "confirmSave")}
                </button>
              </div>
            </section>
          )}
          <LoadingIndicator
            busy={Boolean(model.busy === "reading")}
            hasContent={Boolean(model.content)}
            label={t("loading")}
          />
          <LoadingIndicator
            busy={Boolean(model.contentRefreshing)}
            hasContent={Boolean(model.content)}
            label={t("refreshingSaved")}
          />
          {model.contentStale && (
            <InlineError
              message={t("cachedUpdateFailed")}
              onRetry={() => void model.readStored()}
              retryLabel={t("manage.retry")}
            />
          )}
          {model.content && !hiddenHistory && (
            <section className={styles.saved} aria-labelledby="saved-holdings-title">
              <div className={styles.sectionHeading}>
                <div>
                  <span className={styles.eyebrow}>{t("storedBadge")}</span>
                  <h2 id="saved-holdings-title">{t("savedTitle")}</h2>
                </div>
                <span className={styles.status}>{t("manualSnapshot")}</span>
              </div>
              <p className={styles.note}>
                {t("importedAt", { time: model.content.fetchedAt })} · {t("timePrecision")}
              </p>
              <Holdings content={model.content} />
            </section>
          )}
        </>
      )}
      <details className={styles.reviewNotes}>
        <summary>{t("guideTitle")}</summary>
        <ol>
          {["login", "documents", "generate", "holdings", "date", "accounts", "download"].map(
            (step) => (
              <li key={step}>{t(`guide.${step}`)}</li>
            ),
          )}
        </ol>
        <a href={GUIDE} target="_blank" rel="noreferrer noopener">
          {t("officialInstructions")} ↗
        </a>
      </details>
      <div className={styles.feedback} aria-live="polite">
        <LoadingIndicator
          busy={model.busy === "saving"}
          hasContent={Boolean(model.content || model.preview)}
          label={t(model.hasPending ? "retrying" : "saving")}
        />
        {model.error && (
          <div className={styles.error} role="alert">
            <p>
              {t.has(errorKey) ? t(errorKey) : t("errors.generic")}
              {model.errorRow ? ` · ${t("row", { row: model.errorRow })}` : ""}
            </p>
            {model.authenticated && model.configured && (
              <button
                className={styles.secondary}
                type="button"
                disabled={busy}
                onClick={() => void model.reload()}
              >
                {t("reloadWorkspace")}
              </button>
            )}
          </div>
        )}
        {model.notice && (
          <p className={styles.success} role="status">
            {t.has(`notices.${model.notice}`) ? t(`notices.${model.notice}`) : t("notices.saved")}
          </p>
        )}
      </div>
    </>
  );
}
function ResourcesView({
  model,
  onOpenWatchlist,
  active = true,
  onCreateTask,
  watchlist,
}: ResourcesProps & { model: HoldingsWorkspace }) {
  const t = useTranslations("resources"),
    names = useDisplayNames(model, active);
  return (
    <section className={styles.panel} aria-labelledby="resources-title">
      <header className={styles.heading}>
        <h1 id="resources-title">{t("title")}</h1>
      </header>
      <ResourceLibrary
        holdingsVersion={model.content?.data.snapshotId}
        active={active}
        watchlist={watchlist}
        onOpenWatchlist={onOpenWatchlist}
        onCreateTask={onCreateTask}
      >
        {(library) => (
          <div className={styles.workspace}>
            <Workspace
              key={`${names.scope}:${model.selectedSourceId}:${model.newSource}`}
              model={model}
              names={names}
              library={library}
              onCreateTask={onCreateTask}
            />
          </div>
        )}
      </ResourceLibrary>
    </section>
  );
}

type ResourcesProps = {
  watchlist?: WatchlistModel;
  active?: boolean;
  onOpenWatchlist?: () => void;
  onCreateTask?: (selection: ResourceSelection) => void;
};
function IndependentResources(props: ResourcesProps) {
  const model = useHoldingsWorkspace();
  return <ResourcesView model={model} {...props} />;
}

export default function ResourcesPanel({
  workspace,
  ...props
}: ResourcesProps & {
  workspace?: HoldingsWorkspace;
}) {
  return workspace ? (
    <ResourcesView model={workspace} {...props} />
  ) : (
    <IndependentResources {...props} />
  );
}
