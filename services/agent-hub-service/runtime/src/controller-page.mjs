import { connect } from "./controller.mjs";
const status = document.querySelector("#status"),
  link = document.querySelector("#owner");
try {
  const result = await connect();
  status.textContent =
    result.state.state === "connected"
      ? "连接已恢复，可以使用获准任务。"
      : "连接已准备，请在 FolioView 中确认资源和任务。";
  link.href = result.approvalUrl;
  link.hidden = false;
} catch (error) {
  status.textContent =
    error.message === "lost_private_keys"
      ? "此运行环境的连接密钥不可用。请在 FolioView 中修复连接；现有资源和报告会保留。"
      : "连接暂时不可用，请稍后重试或在 FolioView 查看连接状态。";
}
