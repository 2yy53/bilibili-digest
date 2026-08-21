importScripts(
  "settings.js",
  "lib/core.js",
  "lib/protobuf.js",
  "lib/bilibili.js",
  "lib/cache.js",
  "lib/deepseek.js",
);

const promptCache = new Map();
const activeRuns = new Map();

chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});

async function getSettings() {
  const values = await chrome.storage.local.get(BILI_DIGEST_SETTINGS.STORAGE_KEY);
  return BILI_DIGEST_SETTINGS.normalize(values[BILI_DIGEST_SETTINGS.STORAGE_KEY]);
}

async function loadPrompt(fileName, heading, variables = {}) {
  let markdown = promptCache.get(fileName);
  if (!markdown) {
    const response = await fetch(chrome.runtime.getURL(`prompts/${fileName}`));
    if (!response.ok) throw new Error(`提示词文件读取失败：${fileName}`);
    markdown = await response.text();
    promptCache.set(fileName, markdown);
  }
  const marker = `## ${heading}`;
  const start = markdown.indexOf(marker);
  if (start < 0) throw new Error(`提示词缺少章节：${heading}`);
  const sectionStart = start + marker.length;
  const next = markdown.indexOf("\n## ", sectionStart);
  const section = markdown.slice(sectionStart, next < 0 ? markdown.length : next);
  const fenced = section.match(/```(?:\w+)?\n([\s\S]*?)\n```/);
  if (!fenced) throw new Error(`提示词章节格式错误：${heading}`);
  let text = fenced[1];
  Object.entries(variables).forEach(([key, value]) => {
    text = text.split(`{${key}}`).join(String(value ?? ""));
  });
  return text;
}

const cache = BILI_DIGEST_CACHE.createCache(chrome.storage.local, BILI_DIGEST_CORE);
const adapter = BILI_DIGEST_BILIBILI.createAdapter({
  protobuf: BILI_DIGEST_PROTOBUF,
  core: BILI_DIGEST_CORE,
});
const deepseek = BILI_DIGEST_DEEPSEEK.createClient({
  getSettings,
  loadPrompt,
  core: BILI_DIGEST_CORE,
});

function serializeError(error) {
  return {
    code: error?.code || "API_CHANGED",
    message: error?.message || "发生未知错误。",
  };
}

async function notifyProgress(payload) {
  await chrome.runtime.sendMessage({ action: "courseRunProgress", ...payload }).catch(() => {});
}

async function loadCourse(bvid, refresh = false) {
  if (!/^BV[0-9A-Za-z]{10}$/.test(String(bvid || ""))) {
    throw new BILI_DIGEST_BILIBILI.DigestError("API_CHANGED", "无效的 BV 号。");
  }
  if (!refresh) {
    const stored = await cache.getCourse(bvid);
    if (stored) return stored;
  }
  const course = await adapter.loadCourse(bvid);
  await cache.setCourse(course);
  return course;
}

function selectedParts(course, selectedCids) {
  const selected = new Set((selectedCids || []).map(String));
  const parts = course.pages.filter((part) => selected.has(String(part.cid)));
  if (!parts.length) throw new BILI_DIGEST_BILIBILI.DigestError("NO_TEXT", "请至少选择一个分P。");
  return parts;
}

async function fetchPartTranscript({ bvid, cid, refresh = false }) {
  const course = await loadCourse(bvid);
  const part = course.pages.find((candidate) => String(candidate.cid) === String(cid));
  if (!part) throw new BILI_DIGEST_BILIBILI.DigestError("RESTRICTED_PART", "找不到对应分P。");
  if (!refresh) {
    const record = await cache.getPart(course.bvid, part.cid);
    if (record?.transcript) return { part, transcript: record.transcript, cached: true };
  }
  const transcript = await adapter.fetchPartTranscript(course, part);
  return { part, transcript, cached: false };
}

async function summarizeSelectedParts({ bvid, selectedCids, refresh = false }) {
  const course = await loadCourse(bvid);
  const parts = selectedParts(course, selectedCids);
  const previous = activeRuns.get(course.bvid);
  previous?.controller.abort();
  const token = { controller: new AbortController(), cancelled: false };
  activeRuns.set(course.bvid, token);

  const run = {
    status: "running", bvid: course.bvid, selectedCids: parts.map((part) => String(part.cid)),
    completedCids: [], currentCid: null, missingParts: [], startedAt: Date.now(), updatedAt: Date.now(),
  };
  await cache.setRun(course.bvid, run);
  const digests = [];

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (token.cancelled || token.controller.signal.aborted) break;
    run.currentCid = String(part.cid);
    run.updatedAt = Date.now();
    await cache.setRun(course.bvid, run);
    await notifyProgress({ bvid: course.bvid, status: "processing", index, total: parts.length, part });
    try {
      let record = refresh ? null : await cache.getPart(course.bvid, part.cid);
      if (!record?.digest || !record?.transcript) {
        const transcript = await adapter.fetchPartTranscript(course, part);
        const fingerprint = BILI_DIGEST_CORE.transcriptFingerprint(transcript);
        const digest = await deepseek.summarizePart(course, part, transcript, token.controller.signal);
        record = { transcript, digest, fingerprint, updatedAt: Date.now() };
        await cache.setPart(course.bvid, part.cid, record);
      }
      digests.push(record.digest);
      run.completedCids.push(String(part.cid));
      await notifyProgress({ bvid: course.bvid, status: "part-complete", index: index + 1, total: parts.length, part, digest: record.digest });
    } catch (error) {
      if (error.code === "CANCELLED" || token.cancelled) break;
      const failure = { cid: String(part.cid), page: part.page, title: part.title, errorCode: error.code || "API_CHANGED", message: error.message };
      run.missingParts.push(failure);
      await notifyProgress({ bvid: course.bvid, status: "part-error", index: index + 1, total: parts.length, part, error: serializeError(error) });
    }
    run.updatedAt = Date.now();
    await cache.setRun(course.bvid, run);
  }

  run.currentCid = null;
  run.status = token.cancelled || token.controller.signal.aborted ? "cancelled" : "parts-complete";
  run.updatedAt = Date.now();
  await cache.setRun(course.bvid, run);
  if (activeRuns.get(course.bvid) === token) activeRuns.delete(course.bvid);
  return { course, selectedCids: run.selectedCids, digests, missingParts: run.missingParts, status: run.status };
}

async function buildCourseMap({ bvid, selectedCids, refresh = false }) {
  const course = await loadCourse(bvid);
  const parts = selectedParts(course, selectedCids);
  const records = await Promise.all(parts.map((part) => cache.getPart(course.bvid, part.cid)));
  const digests = records.map((record) => record?.digest).filter(Boolean);
  const run = await cache.getRun(course.bvid);
  const missingParts = parts
    .filter((part) => !digests.some((digest) => String(digest.cid) === String(part.cid)))
    .map((part) => {
      const known = run?.missingParts?.find((item) => String(item.cid) === String(part.cid));
      return known || { cid: String(part.cid), page: part.page, title: part.title, errorCode: "NO_TEXT" };
    });
  const signature = cache.courseMapSignature(parts.map((part) => part.cid), records);
  if (!refresh) {
    const stored = await cache.getMap(course.bvid, signature);
    if (stored) return { courseMap: stored, cached: true, signature };
  }
  const controller = new AbortController();
  activeRuns.set(course.bvid, { controller, cancelled: false });
  try {
    const courseMap = await deepseek.buildCourseMap(course, parts.map((part) => part.cid), digests, missingParts, controller.signal);
    await cache.setMap(course.bvid, signature, courseMap);
    await cache.setRun(course.bvid, { ...(run || {}), status: "complete", currentCid: null, updatedAt: Date.now(), selectedCids: parts.map((part) => String(part.cid)), missingParts });
    return { courseMap, cached: false, signature };
  } finally {
    activeRuns.delete(course.bvid);
  }
}

async function cancelCourseRun({ bvid }) {
  const parsed = String(bvid || "");
  const active = activeRuns.get(parsed);
  if (active) { active.cancelled = true; active.controller.abort(); }
  const run = await cache.getRun(parsed);
  if (run) await cache.setRun(parsed, { ...run, status: "cancelled", currentCid: null, updatedAt: Date.now() });
  return { cancelled: Boolean(active || run) };
}

async function handleMessage(message) {
  switch (message?.action) {
    case "checkConfig": {
      const settings = await getSettings();
      return { hasAiKey: Boolean(settings.aiApiKey), model: settings.aiModel };
    }
    case "checkBilibiliLogin": return adapter.checkLogin();
    case "loadCourse": return { course: await loadCourse(message.bvid, message.refresh) };
    case "fetchPartTranscript": return fetchPartTranscript(message);
    case "summarizeSelectedParts": return summarizeSelectedParts(message);
    case "buildCourseMap": return buildCourseMap(message);
    case "cancelCourseRun": return cancelCourseRun(message);
    case "getCourseRunState": return { run: await cache.getRun(String(message.bvid || "")) };
    case "clearVideoCache": return { count: await cache.removeVideo(String(message.bvid || "")) };
    case "clearAllCache": return { count: await cache.clearAll() };
    case "openOptions": chrome.runtime.openOptionsPage(); return { opened: true };
    default: throw new Error("Unknown action");
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(
    (data) => sendResponse({ success: true, ...data }),
    (error) => sendResponse({ success: false, error: serializeError(error) }),
  );
  return true;
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;
  chrome.sidePanel.setOptions({ tabId: tab.id, path: "sidepanel.html", enabled: true });
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") chrome.runtime.openOptionsPage();
});
