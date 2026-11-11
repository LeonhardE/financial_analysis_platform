"use client";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { useAuth } from "./AuthProvider";
import type { HoldingsWorkspace } from "./useHoldingsWorkspace";
import { independentJson, INDEPENDENT_CONTRACT as CONTRACT } from "@/lib/independent-agent";
import styles from "./IndependentSetupPanel.module.css";

type PublicFile = Record<string, any>;
function publicOnly(value: any, depth = 0): void {
  if (depth > 32) throw new Error("invalid_file");
  if (value && typeof value === "object") {
    if (Object.keys(value).length > 256 || value.kty === "oct") throw new Error("invalid_file");
    for (const [k, v] of Object.entries(value)) {
      if (
        ["d", "p", "q", "dp", "dq", "qi", "k"].includes(k) ||
        /private|password|access_token|refresh_token|plaintext/i.test(k)
      )
        throw new Error("private_file");
      publicOnly(v, depth + 1);
    }
  }
}
export default function IndependentSetupPanel({ workspace: w }: { workspace: HoldingsWorkspace }) {
  const zh = useLocale().startsWith("zh"),
    auth = useAuth();
  const scope =
    w.phase === "unlocked" && w.canWriteState ? `${w.owner}:${w.vaultGeneration}` : null;
  const job = useRef<AbortController | null>(null);
  const current = useRef(scope);
  current.current = scope;
  const [file, setFile] = useState<PublicFile | null>(null),
    [result, setResult] = useState<PublicFile | null>(null);
  const [action, setAction] = useState("inspect"),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState("");
  const actions = zh
    ? [
        ["inspect", "核对准备资料"],
        ["bootstrap", "批准 Policy 初始状态"],
        ["initialize", "批准首次密钥创建"],
        ["review_pending", "确认原始公钥证明"],
        ["finalize", "批准原钥封存"],
        ["register", "准备正式登记"],
        ["certificate", "批准原钥证书续期"],
      ]
    : [
        ["inspect", "Review preparation"],
        ["bootstrap", "Approve initial Policy state"],
        ["initialize", "Approve first-key creation"],
        ["review_pending", "Confirm original-key proof"],
        ["finalize", "Approve original-key sealing"],
        ["register", "Prepare registration"],
        ["certificate", "Approve certificate renewal"],
      ];
  useEffect(() => {
    job.current?.abort();
    job.current = null;
    setBusy(false);
    setFile(null);
    setResult(null);
    setConfirmed(false);
    setStatus("");
    return () => job.current?.abort();
  }, [scope]);
  if (!scope) return null;
  const execute = async (work: () => Promise<PublicFile>) => {
    if (job.current) return;
    const start = scope,
      abort = new AbortController();
    job.current = abort;
    const timeout = setTimeout(() => abort.abort(), 60000);
    setBusy(true);
    setStatus("");
    try {
      const value = await work();
      if (current.current !== start || abort.signal.aborted) return;
      setResult(value);
      setStatus(
        zh ? "已准备，请核对并保存公开文件。" : "Prepared. Review and save the public file.",
      );
    } catch {
      if (current.current === start)
        setStatus(
          zh
            ? "准备已停止。请核对账户、原始资料和有效期；不要重建密钥重试。"
            : "Preparation stopped. Check the account, original artifacts and expiry; do not regenerate keys to retry.",
        );
    } finally {
      clearTimeout(timeout);
      if (job.current === abort) job.current = null;
      if (current.current === start) setBusy(false);
    }
  };
  const actor = () => ({
    connectionId: file!.configuration.connectionId,
    clientId: file!.configuration.clientId,
  });
  const request = () => ({
    configuration: file!.configuration,
    policyConfig: file!.policyConfig,
    ...file,
    action,
  });
  const save = () => {
    if (!result) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(result, null, 2) + "\n"], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `folioview-owner-${action}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const review = () =>
    execute(async () => {
      const expected = await w.prepareIndependentSetup({
        actor: actor(),
        request: {
          action: "inspect",
          configuration: file!.configuration,
          policyConfig: file!.policyConfig,
        },
      });
      const renewal = action === "certificate",
        c = file!.configuration;
      const path = renewal
        ? `/api/v1/connections/${c.connectionId}/certificate-reviews`
        : "/api/v1/enrollment-reviews";
      const body = renewal
        ? { certificateChain: file!.certificateChain }
        : {
            pendingOffer: file!.pendingOffer,
            finalOffer: file!.finalOffer ?? null,
            certificateChain: file!.certificateChain ?? null,
          };
      const response = await auth.requestPrivate("agent-policy", path, w.owner!, {
        signal: job.current!.signal,
        method: "POST",
        json: { contractVersion: CONTRACT, request: body },
        expectedPolicyIssuer: expected.issuer,
      });
      const value = await independentJson(response, undefined, 32768);
      if (current.current !== scope || job.current?.signal.aborted) throw new Error("cancelled");
      setFile({ ...file, review: value.review });
      setConfirmed(false);
      return { review: value.review };
    });
  const register = () =>
    execute(async () => {
      const ready = result!,
        h = ready.hub,
        v = w.vault!.vaultId,
        owner = w.owner!,
        c = file!.configuration;
      const assert = () => {
        if (current.current !== scope || job.current?.signal.aborted) throw new Error("cancelled");
      };
      await w.refreshVault(job.current!.signal, true);
      assert();
      const registryStatus = await w.prepareIndependentSetup({
        actor: actor(),
        request: {
          action: "registry_status",
          configuration: c,
          policyConfig: file!.policyConfig,
          pendingOffer: file!.pendingOffer,
        },
      });
      assert();
      if (h.registryUpdate && registryStatus.needsUpdate) {
        const response = await auth.requestPrivate(
          "agent-hub",
          `/api/v2/vaults/${v}/registry`,
          owner,
          {
            signal: job.current!.signal,
            method: "PUT",
            json: h.registryUpdate,
            headers: { "Idempotency-Key": "directory_" + h.operationId },
          },
        );
        await independentJson(response);
        assert();
        await w.refreshVault(job.current!.signal, true);
        assert();
      }
      const response = await auth.requestPrivate(
        "agent-hub",
        `/api/v2/executor-connections/${v}/${c.connectionId}/bindings`,
        owner,
        {
          signal: job.current!.signal,
          method: "POST",
          json: h.body,
          headers: { "Idempotency-Key": h.operationId },
        },
      );
      const receipt = await independentJson(response, undefined, 65536, 201);
      assert();
      const binding = await w.prepareIndependentSetup({
        actor: actor(),
        request: {
          action: "verify_hub",
          configuration: c,
          policyConfig: file!.policyConfig,
          pendingOffer: file!.pendingOffer,
          receipt,
        },
      });
      assert();
      const p = await auth.requestPrivate(
        "agent-policy",
        `/api/v1/connections/${c.connectionId}/controls`,
        owner,
        {
          signal: job.current!.signal,
          method: "POST",
          json: { contractVersion: CONTRACT, request: ready.policy },
          expectedPolicyIssuer: c.issuer,
        },
      );
      const policyReceipt = await independentJson(p, undefined, 65536, 201);
      assert();
      return {
        ...ready,
        hubReceipt: receipt,
        policyReceipt,
        bindingVerified: binding,
      };
    });
  const publishCertificate = () =>
    execute(async () => {
      const c = file!.configuration;
      const response = await auth.requestPrivate(
        "agent-policy",
        `/api/v1/connections/${c.connectionId}/controls`,
        w.owner!,
        {
          method: "POST",
          signal: job.current!.signal,
          json: { contractVersion: CONTRACT, request: result },
          expectedPolicyIssuer: c.issuer,
        },
      );
      return {
        request: result,
        receipt: await independentJson(response, job.current!.signal, 65536, 201),
      };
    });
  return (
    <details className={styles.panel}>
      <summary>{zh ? "独立执行端管理准备" : "Independent executor administration"}</summary>
      <p>
        {zh
          ? "仅供 Owner 首次登记和续期。先准备并核对公开资料；私钥始终留在已解锁的客户端。准备操作不会部署服务。"
          : "For Owner enrollment and renewal. Review public artifacts first; private keys stay in the unlocked client. Preparation does not deploy services."}
      </p>
      <p>
        {zh
          ? "首次登记请保持本页已解锁，按原创建进程的等待窗口完成。锁定、刷新或超时后会停止，不能删除旧记录或重建原钥继续。"
          : "Keep this page unlocked through the creator’s waiting window. Locking, reloading or expiry stops the ceremony; never erase reservations or regenerate original keys."}
      </p>
      <fieldset disabled={busy}>
        <label>
          {zh ? "操作" : "Operation"}
          <select
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setConfirmed(false);
              setResult(null);
            }}
          >
            {actions.map(([key, label]) => (
              <option value={key} key={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {zh ? "选择公开准备文件" : "Select public preparation file"}
          <input
            type="file"
            accept="application/json,.json"
            onChange={async (e) => {
              const input = e.currentTarget,
                selected = input.files?.[0],
                start = scope;
              setConfirmed(false);
              setResult(null);
              setFile(null);
              setStatus("");
              try {
                if (!selected || selected.size > 524288) throw new Error("invalid_file");
                const value = JSON.parse(await selected.text());
                publicOnly(value);
                if (!value.configuration || !value.policyConfig) throw new Error("invalid_file");
                if (current.current === start) setFile(value);
              } catch {
                if (current.current === start)
                  setStatus(
                    zh
                      ? "请选择有效的公开文件，不要提供私钥或账户秘密。"
                      : "Choose a valid public file without private keys or account secrets.",
                  );
              } finally {
                input.value = "";
              }
            }}
          />
        </label>
        {file && (
          <dl>
            <dt>{zh ? "Policy 地址" : "Policy address"}</dt>
            <dd>{file.configuration.issuer}</dd>
            <dt>{zh ? "执行端地址" : "Executor address"}</dt>
            <dd>{file.configuration.audience}</dd>
            <dt>{zh ? "登记连接" : "Connection"}</dt>
            <dd>{file.configuration.connectionId}</dd>
            <dt>{zh ? "资料范围与期限" : "Scope and expiry"}</dt>
            <dd>
              <pre>
                {JSON.stringify(
                  {
                    scope: file.draft?.scope ?? file.pendingOffer?.draft?.scope,
                    workload: file.draft?.workload ?? file.pendingOffer?.draft?.workload,
                    approvalExpiresAt: file.approvalExpiresAt,
                  },
                  null,
                  2,
                )}
              </pre>
            </dd>
          </dl>
        )}
        <label>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          {zh
            ? "我已核对本次操作、地址、原始公钥、资料范围和期限。"
            : "I reviewed this operation, destinations, original public keys, scope and expiry."}
        </label>
        <div className={styles.buttons}>
          <button
            type="button"
            disabled={!file || !confirmed}
            onClick={() =>
              execute(() =>
                w.prepareIndependentSetup({
                  actor: actor(),
                  request: request(),
                }),
              )
            }
          >
            {zh ? "准备并核对" : "Prepare and verify"}
          </button>
          {["review_pending", "register", "certificate"].includes(action) && (
            <button type="button" disabled={!file || !confirmed} onClick={review}>
              {zh ? "请求线上公开资料核对" : "Request live public-artifact review"}
            </button>
          )}
          <button type="button" disabled={!result} onClick={save}>
            {zh ? "保存公开结果" : "Save public result"}
          </button>
          {result?.action === "certificate" && (
            <button type="button" disabled={!confirmed} onClick={publishCertificate}>
              {zh ? "发布证书批准" : "Publish certificate approval"}
            </button>
          )}
          {result?.hub && result?.policy && (
            <button type="button" disabled={!confirmed} onClick={register}>
              {zh ? "发布已批准的登记" : "Publish approved registration"}
            </button>
          )}
        </div>
      </fieldset>
      {status && <p role="status">{status}</p>}
    </details>
  );
}
