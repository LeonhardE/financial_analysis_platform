import { connect as r } from "./controller.mjs";
var e = document.querySelector("#status"),
  o = document.querySelector("#owner");
try {
  let t = await r();
  ((e.textContent =
    t.state.state === "connected"
      ? "\u8FDE\u63A5\u5DF2\u6062\u590D\uFF0C\u53EF\u4EE5\u4F7F\u7528\u83B7\u51C6\u4EFB\u52A1\u3002"
      : "\u8FDE\u63A5\u5DF2\u51C6\u5907\uFF0C\u8BF7\u5728 FolioView \u4E2D\u786E\u8BA4\u8D44\u6E90\u548C\u4EFB\u52A1\u3002"),
    (o.href = t.approvalUrl),
    (o.hidden = !1));
} catch (t) {
  e.textContent =
    t.message === "lost_private_keys"
      ? "\u6B64\u8FD0\u884C\u73AF\u5883\u7684\u8FDE\u63A5\u5BC6\u94A5\u4E0D\u53EF\u7528\u3002\u8BF7\u5728 FolioView \u4E2D\u4FEE\u590D\u8FDE\u63A5\uFF1B\u73B0\u6709\u8D44\u6E90\u548C\u62A5\u544A\u4F1A\u4FDD\u7559\u3002"
      : "\u8FDE\u63A5\u6682\u65F6\u4E0D\u53EF\u7528\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u6216\u5728 FolioView \u67E5\u770B\u8FDE\u63A5\u72B6\u6001\u3002";
}
