"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { HoldingsWorkspace } from "./useHoldingsWorkspace";
import type { AgentConsentModel } from "./useAgentConsent";
import type { AgentScope } from "@/lib/agent-connections";
import styles from "./AgentConsentCard.module.css";
import { PasskeyHelp } from "./PasskeyHelp";

export function AgentConsentCard({
  workspace,
  model: sourceModel,
  invalidHandoff = false,
}: {
  workspace: HoldingsWorkspace;
  model: AgentConsentModel;
  invalidHandoff?: boolean;
}) {
  const privateVisible =
    sourceModel.owner === workspace.owner &&
    workspace.authenticated &&
    workspace.phase === "unlocked" &&
    !workspace.needsDeviceApproval &&
    sourceModel.unlocked;
  const model = privateVisible
    ? sourceModel
    : {
        ...sourceModel,
        unlocked: false,
        canWrite: false,
        selected: null,
        content: null,
        setupCard: null,
        offer: null,
        offerReview: null,
        signedGrant: null,
        published: null,
        outbox: [],
      };
  const t = useTranslations("agentConsent"),
    locale = useLocale();
  const [offer, setOffer] = useState(""),
    [copyStatus, setCopyStatus] = useState(false),
    [discarding, setDiscarding] = useState<string | null>(null);
  const visibleScope = `${model.owner}:${workspace.vaultGeneration}:${model.unlocked}`;
  const scope = useRef(visibleScope);
  scope.current = visibleScope;
  useEffect(() => {
    setOffer("");
    setCopyStatus(false);
    setDiscarding(null);
  }, [visibleScope]);
  const copy = async (value: unknown) => {
    const started = scope.current;
    if (!model.unlocked || !value) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
      if (scope.current === started) setCopyStatus(true);
    } catch {
      if (scope.current === started) setCopyStatus(false);
    }
  };
  const busy = Boolean(model.busy || workspace.busy),
    authorization = model.authorization,
    selected = model.selected;
  const date = (timestamp: number) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(timestamp * 1000),
    );
  if (model.owner && (model.owner !== workspace.owner || !workspace.authenticated)) return null;
  if (
    !model.hasHandoff &&
    !invalidHandoff &&
    model.outbox.length === 0 &&
    !model.signedGrant &&
    !model.published &&
    !model.notice
  )
    return null;
  return (
    <section className={styles.card} aria-labelledby="agent-consent-title">
      <header>
        <div>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h2 id="agent-consent-title">{t("title")}</h2>
          <p>{t("description")}</p>
        </div>
        {model.unlocked && (
          <button className={styles.secondary} onClick={workspace.lock}>
            {t("lockLibrary")}
          </button>
        )}
      </header>
      {invalidHandoff && (
        <p className={styles.warning} role="alert">
          {t("errors.invalid_handoff")}
        </p>
      )}
      {model.error && (
        <p className={styles.warning} role="alert">
          {t(t.has(`errors.${model.error}`) ? `errors.${model.error}` : "errors.request_failed")}
        </p>
      )}
      {model.notice && t.has(`notices.${model.notice}`) && (
        <p className={styles.note} role="status">
          {t(`notices.${model.notice}`)}
        </p>
      )}
      {(model.hasHandoff || model.signedGrant || model.published) && (
        <>
          {model.stage === "incoming" && (
            <div className={styles.step}>
              <h3>{t("incomingTitle")}</h3>
              <p>{t("incomingHelp")}</p>
              <button
                className={styles.primary}
                disabled={
                  busy ||
                  !model.owner ||
                  !model.configured ||
                  workspace.phase === "needs-vault" ||
                  workspace.phase === "checking"
                }
                onClick={() => void model.claim()}
              >
                {t("reviewRequest")}
              </button>
            </div>
          )}
          {authorization && (
            <div className={styles.metadata}>
              <strong>Meta Muse</strong>
              <span>{authorization.clientId}</span>
              <span>{t("expires", { date: date(authorization.expiresAt) })}</span>
            </div>
          )}
          {!model.unlocked && (
            <div className={styles.unlock}>
              <p>{t(workspace.phase === "needs-vault" ? "createHelp" : "unlockHelp")}</p>
              <PasskeyHelp
                workspace={workspace}
                mode={workspace.phase === "needs-vault" ? "create" : "unlock"}
                unlockOptions={{ forResults: true, enableState: true }}
              />
              <button
                className={styles.secondary}
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
          )}
          {model.unlocked && !model.canWrite && (
            <div className={styles.unlock}>
              <p>{t("enableHelp")}</p>
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
          {authorization && model.stage !== "closed" && (
            <>
              <div className={styles.step}>
                <h3>{t("taskTitle")}</h3>
                <p>{t("oneTask")}</p>
                <label>
                  {t("task")}
                  <select
                    value={selected?.metadata.taskId ?? ""}
                    disabled={
                      !model.canWrite || busy || model.registered || Boolean(authorization.prepared)
                    }
                    onChange={(event) => {
                      if (event.target.value) void model.selectTask(event.target.value);
                    }}
                  >
                    <option value="">{t("chooseTask")}</option>
                    {model.tasks.map((task) => (
                      <option key={task.taskId} value={task.taskId}>
                        {task.taskId} · {t("version", { version: task.taskVersion })}
                      </option>
                    ))}
                  </select>
                </label>
                {model.content && (
                  <div className={styles.preview}>
                    <strong>{model.content.name}</strong>
                    <p>{model.content.goal}</p>
                    <ol>
                      {model.content.outputSpec.sections.map((section) => (
                        <li key={section.sectionId}>
                          <strong>{section.title}</strong>
                          <p>{section.instructions}</p>
                        </li>
                      ))}
                    </ol>
                    {selected && (
                      <ul>
                        {selected.metadata.resourceBindings.map((binding) => (
                          <li key={binding.ref.resourceId}>
                            {t(`kinds.${binding.ref.kind}`)} · {binding.ref.resourceId} ·{" "}
                            {t("sourceEpoch", { epoch: binding.sourceEpoch })}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className={styles.note}>{t("unknownAsOfHelp")}</p>
                  </div>
                )}
                <fieldset disabled={busy || Boolean(authorization.prepared) || !model.canWrite}>
                  <legend>{t("scopesTitle")}</legend>
                  {authorization.scopes.map((permission) => (
                    <label className={styles.check} key={permission}>
                      <input
                        type="checkbox"
                        checked={model.scopes.includes(permission)}
                        onChange={(event) =>
                          model.selectScopes(
                            event.target.checked
                              ? [...model.scopes, permission]
                              : model.scopes.filter((scope) => scope !== permission),
                          )
                        }
                      />
                      {t(`scopes.${permission.replaceAll(":", "_")}`)}
                    </label>
                  ))}
                </fieldset>
              </div>
              {selected && (
                <div className={styles.step}>
                  <h3>{t("helperTitle")}</h3>
                  <p>{t("helperHelp")}</p>
                  <p className={styles.note}>{t("foregroundLimits")}</p>
                  <div className={styles.actions}>
                    <button
                      className={styles.primary}
                      disabled={
                        busy ||
                        !model.canWrite ||
                        model.registered ||
                        Boolean(authorization.prepared)
                      }
                      onClick={() => void model.pairHelper()}
                    >
                      {t("pairHelper")}
                    </button>
                    <button
                      className={styles.secondary}
                      disabled={
                        busy ||
                        !model.canWrite ||
                        model.registered ||
                        Boolean(authorization.prepared)
                      }
                      onClick={() => void model.createManualCard()}
                    >
                      {t("manualSetup")}
                    </button>
                    <button
                      className={styles.textButton}
                      disabled={busy}
                      onClick={model.lockHelper}
                    >
                      {t("lockHelper")}
                    </button>
                  </div>
                  {model.setupCard && (
                    <details className={styles.manual} open={model.mode === "manual"}>
                      <summary>{t("publicSetup")}</summary>
                      <p>{t("publicCardHelp")}</p>
                      <button
                        className={styles.secondary}
                        onClick={() => void copy(model.setupCard)}
                      >
                        {t("copySetup")}
                      </button>
                      <pre>{JSON.stringify(model.setupCard, null, 2)}</pre>
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          void model.importOffer(offer);
                        }}
                      >
                        <label>
                          {t("pasteOffer")}
                          <textarea
                            rows={5}
                            maxLength={16384}
                            value={offer}
                            disabled={busy || model.registered}
                            onChange={(event) => setOffer(event.target.value)}
                          />
                        </label>
                        <button
                          className={styles.secondary}
                          disabled={busy || !offer || model.registered}
                          type="submit"
                        >
                          {t("inspectOffer")}
                        </button>
                      </form>
                    </details>
                  )}
                  {model.offer && model.offerReview && (
                    <div className={styles.keyReview}>
                      <h4>{t("keyReview")}</h4>
                      <p>{t("keySourceHelp")}</p>
                      <dl>
                        <dt>{t("signingFingerprint")}</dt>
                        <dd>
                          <code>{model.offer.agentSigningKeyId}</code>
                        </dd>
                        <dt>{t("encryptionFingerprint")}</dt>
                        <dd>
                          <code>{model.offer.agentEncryptionKeyId}</code>
                        </dd>
                        <dt>{t("offerFingerprint")}</dt>
                        <dd>
                          <code>{model.offerReview.offerFingerprint}</code>
                        </dd>
                      </dl>
                      <label className={styles.check}>
                        <input
                          type="checkbox"
                          checked={model.keysConfirmed}
                          disabled={busy || model.registered}
                          onChange={(event) =>
                            model.confirmKeys(event.target.checked, model.replacementConfirmed)
                          }
                        />
                        {t("confirmKeySource")}
                      </label>
                      {!model.offerReview.registered &&
                        model.offerReview.existingConnectionKeyIds.length > 0 && (
                          <div className={styles.warning}>
                            <p>{t("replacementHelp")}</p>
                            <label className={styles.check}>
                              <input
                                type="checkbox"
                                checked={model.replacementConfirmed}
                                disabled={busy}
                                onChange={(event) =>
                                  model.confirmKeys(model.keysConfirmed, event.target.checked)
                                }
                              />
                              {t("confirmReplacement")}
                            </label>
                          </div>
                        )}
                      <button
                        className={styles.primary}
                        disabled={
                          busy ||
                          !model.canWrite ||
                          model.registered ||
                          !model.keysConfirmed ||
                          (!model.offerReview.registered &&
                            model.offerReview.existingConnectionKeyIds.length > 0 &&
                            !model.replacementConfirmed)
                        }
                        onClick={() => void model.registerKeys()}
                      >
                        {t(model.offerReview.registered ? "reuseKeys" : "registerKeys")}
                      </button>
                      {model.registered && <p className={styles.note}>{t("keysRegisteredHelp")}</p>}
                    </div>
                  )}
                </div>
              )}
              {model.registered && !authorization.prepared && (
                <div className={styles.step}>
                  <h3>{t("prepareTitle")}</h3>
                  <p>{t("prepareHelp")}</p>
                  <button
                    className={styles.primary}
                    disabled={busy || !model.canWrite || !model.scopes.includes("tasks:read")}
                    onClick={() => void model.prepareGrant()}
                  >
                    {t("prepareGrant")}
                  </button>
                </div>
              )}
              {authorization.prepared && model.stage === "grant" && (
                <div className={styles.step}>
                  <h3>{t("grantTitle")}</h3>
                  <p>{t("grantHelp")}</p>
                  {authorization.prepared.tasks.map((task) => (
                    <div className={styles.preview} key={task.taskId}>
                      <strong>
                        {task.taskId} · {t("version", { version: task.taskVersion })}
                      </strong>
                      <ul>
                        {task.selectedResourceVersions?.map((source) => (
                          <li key={source.ref.resourceId}>
                            {t(`kinds.${source.ref.kind}`)} · {source.ref.resourceId} ·{" "}
                            {t("revision", { revision: source.revision })} ·{" "}
                            {t("sourceEpoch", { epoch: source.sourceEpoch })}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  <p className={styles.warning}>{t("recipientWarning")}</p>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={model.grantConfirmed}
                      disabled={busy || model.decisionSent}
                      onChange={(event) => model.confirmGrant(event.target.checked)}
                    />
                    {t("confirmGrant")}
                  </label>
                  <button
                    className={styles.primary}
                    disabled={
                      busy || !model.canWrite || !model.grantConfirmed || model.decisionSent
                    }
                    onClick={() => void model.approve()}
                  >
                    {t("approve")}
                  </button>
                  {model.decisionSent && <p className={styles.note}>{t("decisionNoRetry")}</p>}
                </div>
              )}
              {model.stage === "approved" && (
                <div className={styles.step}>
                  <h3>{t("approvedTitle")}</h3>
                  <p>{t("approvedHelp")}</p>
                  {model.mode === null && (
                    <div className={styles.warning}>
                      <p>{t("originalHelperHelp")}</p>
                      {model.offer && model.signedGrant && (
                        <dl>
                          <dt>{t("signingFingerprint")}</dt>
                          <dd>
                            <code>{model.offer.agentSigningKeyId}</code>
                          </dd>
                          <dt>{t("encryptionFingerprint")}</dt>
                          <dd>
                            <code>{model.offer.agentEncryptionKeyId}</code>
                          </dd>
                          <dt>{t("offerFingerprint")}</dt>
                          <dd>
                            <code>{model.signedGrant.offerFingerprint}</code>
                          </dd>
                        </dl>
                      )}
                      <button
                        className={styles.secondary}
                        disabled={busy || !model.canWrite}
                        onClick={model.confirmOriginalHelper}
                      >
                        {t("confirmOriginalHelper")}
                      </button>
                    </div>
                  )}
                  <button
                    className={styles.primary}
                    disabled={busy || !model.canWrite || model.mode === null}
                    onClick={() => void model.publish()}
                  >
                    {t("publish")}
                  </button>
                </div>
              )}
              {model.published && (
                <div className={styles.step}>
                  <h3>{t("publishedTitle")}</h3>
                  <p>{t(model.helperConfirmed ? "pairedPublished" : "manualPublished")}</p>
                  <button
                    className={styles.secondary}
                    onClick={() => void copy(model.published!.deliveryPin)}
                  >
                    {t("copyPin")}
                  </button>
                  <details>
                    <summary>{t("publicPin")}</summary>
                    <pre>{JSON.stringify(model.published.deliveryPin, null, 2)}</pre>
                  </details>
                  <p className={styles.note}>{t("notModelProof")}</p>
                </div>
              )}
              {!["approved", "published", "closed"].includes(model.stage) && (
                <div className={styles.actions}>
                  <button
                    className={styles.secondary}
                    disabled={busy || model.decisionSent}
                    onClick={() => void model.deny("deny")}
                  >
                    {t("deny")}
                  </button>
                  <button
                    className={styles.textButton}
                    disabled={busy || model.decisionSent}
                    onClick={() => void model.deny("cancel")}
                  >
                    {t("cancelRequest")}
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
      {model.outbox.length > 0 && (
        <div className={styles.step}>
          <h3>{t("pendingTitle")}</h3>
          <p>{t("pendingHelp")}</p>
          {model.outbox.map((entry) => {
            const id = `${entry.kind}:${entry.operationId}`;
            return (
              <div className={styles.pending} key={id}>
                <strong>{t(`pendingKinds.${entry.kind}`)}</strong>
                <span>{entry.taskId}</span>
                <div className={styles.actions}>
                  <button
                    className={styles.secondary}
                    disabled={busy || !model.canWrite}
                    onClick={() => void model.recover(entry)}
                  >
                    {t("recover")}
                  </button>
                  <button
                    className={styles.textButton}
                    disabled={busy || !model.unlocked}
                    onClick={() => setDiscarding(id)}
                  >
                    {t("discard")}
                  </button>
                </div>
                {discarding === id && (
                  <div className={styles.warning}>
                    <p>{t("discardHelp")}</p>
                    <button
                      className={styles.secondary}
                      disabled={busy}
                      onClick={() => {
                        void model.discardPending(entry);
                        setDiscarding(null);
                      }}
                    >
                      {t("confirmDiscard")}
                    </button>
                    <button className={styles.textButton} onClick={() => setDiscarding(null)}>
                      {t("cancel")}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {copyStatus && (
        <p className={styles.note} role="status">
          {t("copiedPublic")}
        </p>
      )}
    </section>
  );
}
