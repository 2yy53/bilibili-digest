const elements = Object.fromEntries([
  "notice","emptyState","courseView","courseTitle","courseOwner","courseDescription","selectionCount","partsList",
  "selectAll","selectNone","generateButton","cancelButton","progressCard","progressTitle","progressText","progressBar",
  "partStatuses","resultView","overview","learningSection","learningPath","modules","missingSection","missingParts","settingsButton",
].map((id) => [id, document.getElementById(id)]));

let activeTab = null;
let pageContext = null;
let course = null;
let running = false;

function send(message) {
  return chrome.runtime.sendMessage(message).then((response) => {
    if (!response?.success) {
      const error = new Error(response?.error?.message || "请求失败");
      error.code = response?.error?.code;
      throw error;
    }
    return response;
  });
}

function showNotice(text, error = false) {
  elements.notice.textContent = text;
  elements.notice.classList.toggle("error", error);
  elements.notice.classList.toggle("hidden", !text);
}

function formatDuration(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const remain = value % 60;
  return hours ? `${hours}:${String(minutes).padStart(2,"0")}:${String(remain).padStart(2,"0")}` : `${minutes}:${String(remain).padStart(2,"0")}`;
}

function sourceLabel(source) {
  return ({ human_subtitle: "人工字幕", ai_subtitle: "B站 AI 字幕", protobuf_subtitle: "新版字幕", bilibili_ai_conclusion: "B站 AI 总结" })[source] || "来源未知";
}

function updateSelectionCount() {
  const checked = elements.partsList.querySelectorAll('input[type="checkbox"]:checked').length;
  elements.selectionCount.textContent = `${checked} / ${course?.pages.length || 0}`;
  elements.generateButton.disabled = running || checked === 0;
}

function selectedCids() {
  return [...elements.partsList.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
}

function renderParts(selected = []) {
  const selectedSet = new Set(selected.map(String));
  elements.partsList.replaceChildren();
  course.pages.forEach((part) => {
    const label = document.createElement("label");
    label.className = "part-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = String(part.cid);
    checkbox.checked = selectedSet.size ? selectedSet.has(String(part.cid)) : Number(part.page) === pageContext.page;
    checkbox.addEventListener("change", updateSelectionCount);
    const name = document.createElement("span");
    name.className = "part-name";
    name.textContent = `P${part.page} · ${part.title}`;
    const duration = document.createElement("span");
    duration.className = "part-duration";
    duration.textContent = formatDuration(part.duration);
    label.append(checkbox, name, duration);
    elements.partsList.append(label);
  });
  updateSelectionCount();
}

function appendStatus(text, error = false) {
  const row = document.createElement("div");
  row.className = `status-row${error ? " error" : ""}`;
  row.textContent = text;
  elements.partStatuses.append(row);
  elements.partStatuses.scrollTop = elements.partStatuses.scrollHeight;
}

function setProgress(done, total, title) {
  elements.progressCard.classList.remove("hidden");
  elements.progressTitle.textContent = title;
  elements.progressText.textContent = `${done} / ${total}`;
  elements.progressBar.style.width = `${total ? Math.min(100, (done / total) * 100) : 0}%`;
}

function el(name, className, text) {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function jumpToMoment(module, seconds) {
  const current = BILI_DIGEST_CORE.parseVideoUrl(activeTab.url);
  if (current?.bvid === course.bvid && Number(current.page) === Number(module.page)) {
    const response = await chrome.tabs.sendMessage(activeTab.id, { action: "seekTo", seconds }).catch(() => null);
    if (response?.success) return;
  }
  const url = `https://www.bilibili.com/video/${course.bvid}?p=${module.page}&t=${Math.floor(seconds)}`;
  await chrome.tabs.update(activeTab.id, { url });
  activeTab.url = url;
}

function renderResult(map) {
  elements.overview.textContent = map.overview;
  elements.learningPath.replaceChildren();
  (map.learningPath || []).forEach((step) => elements.learningPath.append(el("li", "", step)));
  elements.learningSection.classList.toggle("hidden", !(map.learningPath || []).length);
  elements.modules.replaceChildren();
  (map.modules || []).sort((a,b) => a.page - b.page).forEach((module) => {
    const card = el("article", "module-card");
    const top = el("div", "section-heading");
    top.append(el("span", "eyebrow", `P${module.page}`), el("span", "source-badge", sourceLabel(module.source)));
    card.append(top, el("h3", "", module.moduleTitle || module.title), el("p", "", module.oneSentence));
    if (module.role) card.append(el("p", "muted", `课程作用：${module.role}`));
    const tags = el("div", "tag-list");
    (module.topics || []).forEach((topic) => tags.append(el("span", "tag", topic)));
    if (tags.childNodes.length) card.append(tags);
    if ((module.dependencies || []).length) card.append(el("p", "muted", `前后依赖：${module.dependencies.join("；")}`));
    if ((module.keyMoments || []).length) {
      const moments = el("div", "moments");
      module.keyMoments.forEach((moment) => {
        const button = el("button", "moment");
        button.type = "button";
        button.append(el("span", "moment-time", formatDuration(moment.seconds)), el("span", "", `${moment.title}${moment.detail ? ` · ${moment.detail}` : ""}`));
        button.addEventListener("click", () => jumpToMoment(module, moment.seconds));
        moments.append(button);
      });
      card.append(moments);
    }
    elements.modules.append(card);
  });
  elements.missingParts.replaceChildren();
  (map.missingParts || []).forEach((part) => elements.missingParts.append(el("li", "", `P${part.page} ${part.title}（${part.errorCode}）`)));
  elements.missingSection.classList.toggle("hidden", !(map.missingParts || []).length);
  elements.resultView.classList.remove("hidden");
  elements.resultView.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function generate() {
  const cids = selectedCids();
  if (!cids.length || running) return;
  running = true;
  showNotice("");
  elements.resultView.classList.add("hidden");
  elements.partStatuses.replaceChildren();
  elements.generateButton.disabled = true;
  elements.cancelButton.classList.remove("hidden");
  setProgress(0, cids.length, "准备读取字幕…");
  try {
    const config = await send({ action: "checkConfig" });
    if (!config.hasAiKey) {
      showNotice("请先在设置中填写 DeepSeek API Key。", true);
      await send({ action: "openOptions" });
      return;
    }
    const summarized = await send({ action: "summarizeSelectedParts", bvid: course.bvid, selectedCids: cids });
    if (summarized.status === "cancelled") { showNotice("任务已取消，已经完成的分P仍保存在本地。"); return; }
    setProgress(cids.length, cids.length, "正在整理课程地图…");
    const result = await send({ action: "buildCourseMap", bvid: course.bvid, selectedCids: cids });
    renderResult(result.courseMap);
    showNotice(result.cached ? "已从本地缓存恢复课程地图。" : "课程地图已生成并保存在本地。", false);
  } catch (error) {
    showNotice(`${error.code ? `[${error.code}] ` : ""}${error.message}`, true);
  } finally {
    running = false;
    elements.cancelButton.classList.add("hidden");
    updateSelectionCount();
  }
}

async function initialize() {
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  pageContext = BILI_DIGEST_CORE.parseVideoUrl(activeTab?.url || "");
  if (!pageContext) return;
  try {
    const response = await send({ action: "loadCourse", bvid: pageContext.bvid });
    course = response.course;
    elements.emptyState.classList.add("hidden");
    elements.courseView.classList.remove("hidden");
    elements.courseTitle.textContent = course.title;
    elements.courseOwner.textContent = course.owner ? `UP主：${course.owner} · ${course.pages.length} 个分P` : `${course.pages.length} 个分P`;
    elements.courseDescription.textContent = course.description;
    const state = await send({ action: "getCourseRunState", bvid: course.bvid });
    renderParts(state.run?.selectedCids || []);
    if (state.run?.status === "running") showNotice("检测到未结束的任务。再次点击生成会从已缓存的分P继续。", false);
    if (state.run?.status === "cancelled") showNotice("上次任务已取消；已完成的分P可以继续复用。", false);
  } catch (error) {
    showNotice(`${error.code ? `[${error.code}] ` : ""}${error.message}`, true);
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.action !== "courseRunProgress" || message.bvid !== course?.bvid) return;
  if (message.status === "processing") setProgress(message.index, message.total, `正在处理 P${message.part.page}…`);
  if (message.status === "part-complete") { setProgress(message.index, message.total, `已完成 P${message.part.page}`); appendStatus(`✓ P${message.part.page} ${message.part.title}`); }
  if (message.status === "part-error") { setProgress(message.index, message.total, `P${message.part.page} 已跳过`); appendStatus(`! P${message.part.page} ${message.part.title}：${message.error.code}`, true); }
});

elements.selectAll.addEventListener("click", () => { elements.partsList.querySelectorAll("input").forEach((input) => { input.checked = true; }); updateSelectionCount(); });
elements.selectNone.addEventListener("click", () => { elements.partsList.querySelectorAll("input").forEach((input) => { input.checked = false; }); updateSelectionCount(); });
elements.generateButton.addEventListener("click", generate);
elements.cancelButton.addEventListener("click", async () => { if (course) await send({ action: "cancelCourseRun", bvid: course.bvid }).catch(() => {}); });
elements.settingsButton.addEventListener("click", () => send({ action: "openOptions" }).catch(() => chrome.runtime.openOptionsPage()));
document.addEventListener("DOMContentLoaded", initialize);
