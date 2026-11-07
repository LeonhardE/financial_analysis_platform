import { NativeAccountBridge } from "./account-bridge.mjs";
const status = document.querySelector("#status"),
  button = document.querySelector("#continue");
try {
  const q = new URLSearchParams(location.search);
  if ([...q.keys()].join(",") !== "request") throw Error("invalid_request");
  const r = await fetch("/agent/v3/runtime/config", {
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
  });
  if (!r.ok) throw Error("unavailable");
  const config = await r.json();
  const bridge = new NativeAccountBridge({
    config,
    requestId: q.get("request"),
    onState: (state) => {
      if (state === "connected") status.textContent = "已关联 Muse，正在返回…";
      else if (state === "owner_opened" || state === "owner_attached")
        status.textContent = "请在 FolioView 中确认连接。";
    },
  });
  button.hidden = false;
  button.onclick = () => {
    try {
      bridge.open(config.ownerOrigins[0]);
      button.disabled = true;
    } catch {
      status.textContent = "请允许打开 FolioView 页面后重试。";
    }
  };
} catch {
  status.textContent = "连接请求暂时不可用，请从 Muse 重试。";
}
