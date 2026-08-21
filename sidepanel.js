const elements = Object.fromEntries([
  "notice","emptyState","courseView","courseTitle","courseOwner","courseDescription","selectionCount","partsList",
  "selectAll","selectNone","generateButton","cancelButton","progressCard","progressTitle","progressText","progressBar",
  "partStatuses","resultView","overview","learningSection","learningPath","modules","missingSection","missingParts","settingsButton",
  "downloadSubtitleButton","downloadSummaryButton","mindmapButton","expandAllButton","collapseAllButton",
].map((id) => [id, document.getElementById(id)]));

let activeTab = null;
let pageContext = null;
let course = null;
let running = false;
let activeMap = null;
let activeSignature = "";
let cacheLookupTimer = null;

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
  elements.downloadSubtitleButton.disabled = running || checked === 0;
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
    checkbox.addEventListener("change", () => { updateSelectionCount(); scheduleCachedLookup(); });
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

function disclosureStorageKey() {
  return `bili-note-open:${course?.bvid || "unknown"}:${activeSignature || "latest"}`;
}

function readDisclosureState() {
  try { return new Set(JSON.parse(localStorage.getItem(disclosureStorageKey()) || "[]")); }
  catch (_error) { return new Set(); }
}

function saveDisclosureState() {
  const openIds = [...elements.modules.querySelectorAll("details[open]")].map((node) => node.dataset.disclosureId).filter(Boolean);
  try { localStorage.setItem(disclosureStorageKey(), JSON.stringify(openIds)); } catch (_error) {}
}

function createDisclosure(title, takeaway, id, open) {
  const details = document.createElement("details");
  details.className = id.includes("-t-") ? "note-subtopic" : "note-section";
  details.dataset.disclosureId = id;
  details.open = open;
  const summary = el("summary", "note-summary");
  const text = el("span", "note-summary-text");
  text.append(el("span", "note-summary-title", title), el("span", "note-summary-takeaway", takeaway));
  summary.append(text);
  details.append(summary);
  details.addEventListener("toggle", saveDisclosureState);
  return details;
}

function renderStructuredSections(map) {
  const saved = readDisclosureState();
  map.sections.forEach((section, sectionIndex) => {
    const sectionId = `s-${sectionIndex}`;
    const sectionOpen = saved.size ? saved.has(sectionId) : sectionIndex === 0;
    const sectionDetails = createDisclosure(
      `${BILI_DIGEST_CORE.toChineseOrdinal(sectionIndex + 1)}、${section.title}`,
      section.takeaway,
      sectionId,
      sectionOpen,
    );
    const subtopicList = el("div", "subtopic-list");
    section.subtopics.forEach((subtopic, subtopicIndex) => {
      const subtopicId = `${sectionId}-t-${subtopicIndex}`;
      const subtopicDetails = createDisclosure(`${subtopicIndex + 1}. ${subtopic.title}`, subtopic.takeaway, subtopicId, saved.has(subtopicId));
      const knowledgeList = el("div", "knowledge-list");
      subtopic.knowledgePoints.forEach((point, pointIndex) => {
        const article = el("article", "knowledge-point");
        article.append(el("h4", "", `${subtopicIndex + 1}.${pointIndex + 1} ${point.title}`));
        [
          ["是什么", point.what],
          ["为什么要有", point.why],
          ["什么时候用", point.when],
        ].forEach(([label, value]) => {
          const paragraph = el("p", "knowledge-field");
          paragraph.append(el("strong", "", `${label}：`), document.createTextNode(value));
          article.append(paragraph);
        });
        const how = el("div", "knowledge-field");
        how.append(el("strong", "", "怎么用："));
        const steps = el("ol", "knowledge-steps");
        (point.how || []).forEach((step) => steps.append(el("li", "", step)));
        how.append(steps);
        article.append(how);
        const meta = el("div", "knowledge-meta");
        meta.append(el("span", "source-badge", `P${point.page} · ${sourceLabel(point.source)}`));
        (point.keyMoments || []).forEach((moment) => {
          const button = el("button", "moment");
          button.type = "button";
          button.append(el("span", "moment-time", formatDuration(moment.seconds)), el("span", "", moment.title));
          button.addEventListener("click", () => jumpToMoment(point, moment.seconds));
          meta.append(button);
        });
        article.append(meta);
        knowledgeList.append(article);
      });
      subtopicDetails.append(knowledgeList);
      subtopicList.append(subtopicDetails);
    });
    sectionDetails.append(subtopicList);
    elements.modules.append(sectionDetails);
  });
}

function renderLegacyModules(map) {
  elements.modules.append(el("p", "legacy-hint", "这是旧版缓存笔记；重新生成后可获得三级折叠结构和四问知识点。"));
  (map.modules || []).sort((a,b) => a.page - b.page).forEach((module, index) => {
    const card = el("article", "module-card");
    const top = el("div", "section-heading");
    top.append(el("span", "eyebrow", `${BILI_DIGEST_CORE.toChineseOrdinal(index + 1)}、P${module.page}`), el("span", "source-badge", sourceLabel(module.source)));
    card.append(top, el("h3", "", module.moduleTitle || module.title), el("p", "", module.oneSentence));
    if ((module.keyMoments || []).length) {
      const moments = el("div", "moments");
      module.keyMoments.forEach((moment) => {
        const button = el("button", "moment");
        button.type = "button";
        button.append(el("span", "moment-time", formatDuration(moment.seconds)), el("span", "", moment.title));
        button.addEventListener("click", () => jumpToMoment(module, moment.seconds));
        moments.append(button);
      });
      card.append(moments);
    }
    elements.modules.append(card);
  });
}

function renderResult(map, signature = "", shouldScroll = true) {
  activeMap = map;
  activeSignature = signature;
  elements.overview.textContent = map.overview;
  elements.learningPath.replaceChildren();
  (map.learningPath || []).forEach((step) => elements.learningPath.append(el("li", "", step)));
  elements.learningSection.classList.toggle("hidden", !(map.learningPath || []).length);
  elements.modules.replaceChildren();
  if (Array.isArray(map.sections)) renderStructuredSections(map);
  else renderLegacyModules(map);
  elements.missingParts.replaceChildren();
  (map.missingParts || []).forEach((part) => elements.missingParts.append(el("li", "", `P${part.page} ${part.title}（${part.errorCode}）`)));
  elements.missingSection.classList.toggle("hidden", !(map.missingParts || []).length);
  elements.downloadSummaryButton.disabled = false;
  elements.mindmapButton.disabled = !Array.isArray(map.sections);
  elements.expandAllButton.disabled = !Array.isArray(map.sections) || !map.sections.length;
  elements.collapseAllButton.disabled = elements.expandAllButton.disabled;
  elements.resultView.classList.remove("hidden");
  if (shouldScroll) elements.resultView.scrollIntoView({ behavior: "smooth", block: "start" });
}

function clearResult() {
  activeMap = null;
  activeSignature = "";
  elements.resultView.classList.add("hidden");
  elements.downloadSummaryButton.disabled = true;
  elements.mindmapButton.disabled = true;
  elements.expandAllButton.disabled = true;
  elements.collapseAllButton.disabled = true;
}

async function restoreCachedMap(exactOnly = false, announce = false) {
  if (!course || running) return false;
  const response = await send({ action: "getCachedCourseMap", bvid: course.bvid, selectedCids: selectedCids(), exactOnly });
  if (!response.courseMap) {
    if (exactOnly) clearResult();
    return false;
  }
  if (!response.exact && response.courseMap.selectedCids?.length) renderParts(response.courseMap.selectedCids);
  renderResult(response.courseMap, response.signature, false);
  if (announce) showNotice(response.exact ? "已从本地恢复对应分P的笔记。" : "已从本地恢复这个视频最近的笔记。", false);
  return true;
}

function scheduleCachedLookup() {
  clearTimeout(cacheLookupTimer);
  cacheLookupTimer = setTimeout(() => restoreCachedMap(true).catch(() => clearResult()), 120);
}

function safeFileName(value) {
  return String(value || "B站课程").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 80) || "B站课程";
}

function downloadMarkdown(content, suffix) {
  const blob = new Blob(["\uFEFF", content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeFileName(course.title)}-${suffix}.md`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function generate() {
  const cids = selectedCids();
  if (!cids.length || running) return;
  running = true;
  showNotice("");
  clearResult();
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
    renderResult(result.courseMap, result.signature);
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
    const restored = await restoreCachedMap(false, true);
    if (!restored && state.run?.status === "running") showNotice("检测到未结束的任务。再次点击生成会从已缓存的分P继续。", false);
    if (!restored && state.run?.status === "cancelled") showNotice("上次任务已取消；已完成的分P可以继续复用。", false);
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
elements.downloadSubtitleButton.addEventListener("click", async () => {
  if (!course || running) return;
  elements.downloadSubtitleButton.disabled = true;
  showNotice("正在准备字幕文件；缺少本地字幕时会从B站读取，但不会调用AI。", false);
  try {
    const result = await send({ action: "prepareSubtitleExport", bvid: course.bvid, selectedCids: selectedCids() });
    downloadMarkdown(BILI_DIGEST_CORE.transcriptsToMarkdown(result.course, result.entries), "字幕");
    showNotice(result.missingParts.length ? `字幕已下载；${result.missingParts.length} 个分P没有可用文本。` : "字幕 Markdown 已下载。", false);
  } catch (error) {
    showNotice(`${error.code ? `[${error.code}] ` : ""}${error.message}`, true);
  } finally {
    updateSelectionCount();
  }
});
elements.downloadSummaryButton.addEventListener("click", () => {
  if (!course || !activeMap) return;
  downloadMarkdown(BILI_DIGEST_CORE.courseMapToMarkdown(course, activeMap), "总结");
  showNotice("总结 Markdown 已下载。", false);
});
elements.mindmapButton.addEventListener("click", () => {
  if (!course || !activeMap?.sections) return;
  downloadMarkdown(BILI_DIGEST_CORE.courseMapToMindmapMarkdown(course, activeMap), "思维导图");
  showNotice("思维导图 Markdown 已在本地生成并下载，没有调用AI。", false);
});
elements.expandAllButton.addEventListener("click", () => {
  elements.modules.querySelectorAll("details").forEach((details) => { details.open = true; });
  saveDisclosureState();
});
elements.collapseAllButton.addEventListener("click", () => {
  elements.modules.querySelectorAll("details").forEach((details) => { details.open = false; });
  saveDisclosureState();
});
elements.settingsButton.addEventListener("click", () => send({ action: "openOptions" }).catch(() => chrome.runtime.openOptionsPage()));
document.addEventListener("DOMContentLoaded", initialize);
