const apiKeyInput = document.getElementById("apiKey");
const saveStatus = document.getElementById("saveStatus");
const dataStatus = document.getElementById("dataStatus");
const loginStatus = document.getElementById("loginStatus");

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.success) throw new Error(response?.error?.message || "操作失败");
  return response;
}

function setStatus(element, text, error = false) {
  element.textContent = text;
  element.classList.toggle("error", error);
}

async function load() {
  const stored = await chrome.storage.local.get(BILI_DIGEST_SETTINGS.STORAGE_KEY);
  apiKeyInput.value = BILI_DIGEST_SETTINGS.normalize(stored[BILI_DIGEST_SETTINGS.STORAGE_KEY]).aiApiKey;
  try {
    const login = await send({ action: "checkBilibiliLogin" });
    loginStatus.textContent = login.isLogin ? "已登录" : "未登录";
    loginStatus.classList.add(login.isLogin ? "ok" : "warn");
  } catch (_error) {
    loginStatus.textContent = "无法检查";
    loginStatus.classList.add("warn");
  }
}

document.getElementById("saveButton").addEventListener("click", async () => {
  const settings = BILI_DIGEST_SETTINGS.normalize({ aiApiKey: apiKeyInput.value });
  if (!settings.aiApiKey) { setStatus(saveStatus, "请输入 DeepSeek API Key。", true); return; }
  try {
    await chrome.storage.local.set({ [BILI_DIGEST_SETTINGS.STORAGE_KEY]: settings });
    setStatus(saveStatus, "设置已保存。重新打开侧边栏即可使用。", false);
  } catch (_error) { setStatus(saveStatus, "保存失败，请重试。", true); }
});

document.getElementById("clearCurrent").addEventListener("click", async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const parsed = BILI_DIGEST_CORE.parseVideoUrl(tab?.url || "");
    if (!parsed) throw new Error("当前标签页不是支持的B站视频。");
    const result = await send({ action: "clearVideoCache", bvid: parsed.bvid });
    setStatus(dataStatus, `已清除当前视频的 ${result.count} 条缓存记录。`);
  } catch (error) { setStatus(dataStatus, error.message, true); }
});

document.getElementById("clearAll").addEventListener("click", async () => {
  if (!confirm("清除全部课程、字幕、摘要和任务状态缓存？DeepSeek API Key不会被删除。")) return;
  try {
    const result = await send({ action: "clearAllCache" });
    setStatus(dataStatus, `已清除 ${result.count} 条课程缓存。`);
  } catch (error) { setStatus(dataStatus, error.message, true); }
});

document.addEventListener("DOMContentLoaded", load);
