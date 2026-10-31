"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useHoldingsWorkspace, type HoldingsWorkspace } from "@/components/useHoldingsWorkspace";
import type { HoldingsResourceContent } from "@/lib/holdings-csv";
import styles from "./ResourcesPanel.module.css";
import ResourceLibrary from "./ResourceLibrary";
import type { ResourceSelection } from "@/lib/resource-library";
import { PasskeyHelp } from "./PasskeyHelp";

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
function Workspace({ model }: { model: HoldingsWorkspace }) {
  const t = useTranslations("resources");
  const file = useRef<HTMLInputElement>(null);
  const busy = Boolean(model.busy);
  const preview = model.preview;
  const canImport =
    model.authenticated &&
    model.configured &&
    model.phase === "unlocked" &&
    !model.needsDeviceApproval &&
    !busy &&
    !model.hasPending;
  const errorKey = `errors.${model.error}`;
  return (
    <>
      <div className={styles.vault}>
        <div>
          <span className={styles.eyebrow}>{t("privateResources")}</span>
          <h2>{t("vaultTitle")}</h2>
          <p>{t("vaultHelp")}</p>
        </div>
        <span
          className={styles.status}
          data-unlocked={model.authenticated && model.phase === "unlocked"}
        >
          {t(!model.authenticated || model.phase !== "unlocked" ? "locked" : "unlocked")}
        </span>
      </div>
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
        <p role="status">{t("loading")}</p>
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
          <button type="button" className={styles.secondary} onClick={model.lock}>
            {t("lock")}
          </button>
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
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.secondary}
              disabled={busy}
              onClick={() => void model.readStored()}
            >
              {t("reloadHoldings")}
            </button>
            <button type="button" className={styles.secondary} onClick={model.lock}>
              {t("lock")}
            </button>
          </div>
          <div className={styles.upload}>
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
            <p>{t("chooseHelp")}</p>
            <input
              ref={file}
              className="sr-only"
              tabIndex={-1}
              type="file"
              accept=".csv,text/csv"
              aria-label={t("chooseFile")}
              disabled={!canImport}
              onChange={(event) => {
                const selected = event.target.files?.[0];
                event.target.value = "";
                if (selected) void model.importFile(selected);
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
                  disabled={busy || model.hasPending}
                  onClick={model.discardPreview}
                >
                  {t("cancelPreview")}
                </button>
              </div>
              <p className={styles.note}>
                {t("reportDate", { date: preview.reportDate ?? t("unknown") })} ·{" "}
                {t("timePrecision")}
              </p>
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
                  onClick={() => void model.save()}
                >
                  {t(model.busy === "saving" ? "saving" : "confirmSave")}
                </button>
              </div>
            </section>
          )}
          {model.content && (
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
      <div className={styles.feedback} aria-live="polite">
        {(model.busy === "saving" || model.busy === "reading") && (
          <p role="status">
            {t(model.busy === "reading" ? "reading" : model.hasPending ? "retrying" : "saving")}
          </p>
        )}
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
  active,
  onCreateTask,
}: {
  model: HoldingsWorkspace;
  onOpenWatchlist?: () => void;
  active?: boolean;
  onCreateTask?: (selection: ResourceSelection) => void;
}) {
  const t = useTranslations("resources");
  return (
    <section className={styles.panel} aria-labelledby="resources-title">
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 id="resources-title">{t("title")}</h1>
          <p>{t("description")}</p>
        </div>
        {onOpenWatchlist && (
          <button type="button" className={styles.secondary} onClick={onOpenWatchlist}>
            {t("openWatchlist")} <span aria-hidden="true">↗</span>
          </button>
        )}
      </header>
      <ResourceLibrary
        holdingsVersion={model.content?.data.snapshotId}
        active={active}
        onOpenWatchlist={onOpenWatchlist}
        onCreateTask={onCreateTask}
      >
        <div className={styles.brokers} aria-label={t("providers")}>
          <button type="button" className={styles.broker} aria-pressed="true">
            <span className={styles.logo}>W</span>
            <span>
              <strong>Wealthsimple</strong>
              <small>{t("holdingsCsv")}</small>
            </span>
            <span className={styles.badge}>{t("available")}</span>
          </button>
          {["Robinhood", "Interactive Brokers"].map((name) => (
            <button className={styles.broker} type="button" disabled key={name}>
              <span className={styles.logo}>{name === "Robinhood" ? "R" : "IB"}</span>
              <span>
                <strong>{name}</strong>
                <small>{t("planned")}</small>
              </span>
            </button>
          ))}
        </div>
        <div className={styles.columns}>
          <div className={styles.workspace}>
            <Workspace model={model} />
          </div>
          <aside className={styles.guide} aria-labelledby="wealthsimple-guide">
            <span className={styles.eyebrow}>{t("exportGuide")}</span>
            <h2 id="wealthsimple-guide">{t("guideTitle")}</h2>
            <p>{t("guideIntro")}</p>
            <ol>
              {["login", "documents", "generate", "holdings", "date", "accounts", "download"].map(
                (step) => (
                  <li key={step}>{t(`guide.${step}`)}</li>
                ),
              )}
            </ol>
            <a href={GUIDE} target="_blank" rel="noreferrer noopener">
              {t("officialInstructions")} <span aria-hidden="true">↗</span>
            </a>
            <div className={styles.guideNote}>
              <h3>{t("correctReport")}</h3>
              <p>{t("reportHelp")}</p>
              <p>{t("compatibility")}</p>
            </div>
            <div className={styles.guideNote}>
              <h3>{t("privacyTitle")}</h3>
              <p>{t("privacyHelp")}</p>
              <p>{t("passkeyRecovery")}</p>
            </div>
          </aside>
        </div>
      </ResourceLibrary>
    </section>
  );
}

type ResourcesProps = {
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
