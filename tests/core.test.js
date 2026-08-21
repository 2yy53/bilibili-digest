const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../lib/core");

test("解析普通B站视频地址、裸BV号和分P", () => {
  assert.deepEqual(core.parseVideoUrl("https://www.bilibili.com/video/BV1Ab411C7xQ/?p=12&t=3"), { bvid: "BV1Ab411C7xQ", page: 12 });
  assert.deepEqual(core.parseVideoUrl("BV1Ab411C7xQ"), { bvid: "BV1Ab411C7xQ", page: 1 });
  assert.equal(core.parseVideoUrl("https://www.bilibili.com/bangumi/play/ep1"), null);
});

test("字幕轨优先级为中文人工、中文AI、其他人工、其他AI", () => {
  const tracks = [
    { lan: "en", subtitle_url: "https://aisubtitle.hdslb.com/en", ai_type: 0 },
    { lan: "ai-en", subtitle_url: "https://aisubtitle.hdslb.com/aien", ai_type: 1 },
    { lan: "ai-zh", lan_doc: "中文 AI", subtitle_url: "https://aisubtitle.hdslb.com/aizh", ai_type: 1 },
    { lan: "zh-CN", lan_doc: "中文", subtitle_url: "https://aisubtitle.hdslb.com/zh", ai_type: 0 },
  ];
  assert.equal(core.chooseSubtitleTrack(tracks).lan, "zh-CN");
  assert.equal(core.chooseSubtitleTrack(tracks.slice(0, 3)).lan, "ai-zh");
  assert.equal(core.chooseSubtitleTrack(tracks.slice(0, 2)).lan, "en");
});

test("字幕规范化保留时间并清理空白和标签", () => {
  assert.deepEqual(core.normalizeSegments([
    { from: 1.2, to: 2.5, content: "  你好 <b>课程</b>  " },
    { from: 3, to: 3.5, content: "" },
  ]), [{ id: "segment-0-1200", start: 1.2, end: 2.5, text: "你好 课程" }]);
});

test("长字幕按字符或时间窗口切块且不丢片段", () => {
  const segments = [
    { start: 0, end: 1, text: "a".repeat(6) },
    { start: 2, end: 3, text: "b".repeat(6) },
    { start: 20, end: 21, text: "c" },
  ];
  const chunks = core.splitTranscript(segments, { maxChars: 10, maxSeconds: 10 });
  assert.deepEqual(chunks.map((chunk) => chunk.length), [1, 1, 1]);
  assert.equal(chunks.flat().length, 3);
});

function structuredDigest() {
  return {
    schemaVersion: 2, cid: "1", page: 1, title: "基础", oneSentence: "基础内容", source: "human_subtitle", confidence: "high",
    sections: [{ title: "计算", takeaway: "先理解加法", subtopics: [{ title: "加法", takeaway: "把数量合并", knowledgePoints: [{
      id: "1:kp:1", title: "加法定义", what: "合并数量", why: "便于得到总量", when: "需要求总数时", how: ["写出加数", "计算结果"],
      keyMoments: [{ seconds: 3, title: "定义" }],
    }] }] }],
  };
}

test("分P摘要强制三级结构和四问，并把时间吸附到真实字幕时间", () => {
  const digest = core.validatePartDigest({
    oneSentence: "学会加法",
    sections: [{ title: "计算", takeaway: "先理解概念", subtopics: [{ title: "加法", takeaway: "合并数量", knowledgePoints: [{
      title: "加法定义", what: "合并数量", why: "求总量", when: "需要求和时", how: ["列出数字", "相加"], keyMoments: [{ seconds: 4, title: "定义" }],
    }] }] }],
  }, { cid: "1", page: 1, title: "基础" }, { source: "human_subtitle", confidence: "high", segments: [{ start: 3, text: "加法" }, { start: 8, text: "例子" }] });
  assert.equal(digest.schemaVersion, 2);
  assert.equal(digest.sections[0].subtopics[0].knowledgePoints[0].id, "1:kp:1");
  assert.equal(digest.keyMoments[0].seconds, 3);
  assert.throws(() => core.validatePartDigest({ oneSentence: "不完整", sections: [] }, { cid: "1" }, { segments: [] }), /三级知识结构/);
});

test("课程地图引用知识点ID、去重并补齐模型遗漏内容", () => {
  const digests = [structuredDigest()];
  const map = core.validateCourseMap({ overview: "课程概述", learningPath: ["先学基础"], sections: [{
    title: "数学基础", takeaway: "先学会合并数量", subtopics: [{ title: "加法", takeaway: "理解后再计算", knowledgePointIds: ["1:kp:1", "1:kp:1"] }],
  }] }, {
    bvid: "BV1Ab411C7xQ", selectedCids: ["1", "2"], digests,
    missingParts: [{ cid: "2", page: 2, title: "进阶", errorCode: "NO_TEXT" }],
  });
  assert.equal(map.schemaVersion, 2);
  assert.equal(map.sections[0].subtopics[0].knowledgePoints.length, 1);
  assert.equal(map.sections[0].subtopics[0].knowledgePoints[0].what, "合并数量");
  assert.equal(map.missingParts[0].errorCode, "NO_TEXT");
});

test("字幕、总结和思维导图Markdown由同一结构本地确定性生成", () => {
  const course = { bvid: "BV1Ab411C7xQ", title: "加法 <入门>" };
  const digest = structuredDigest();
  const map = core.validateCourseMap({ overview: "课程概述", learningPath: [], sections: [{
    title: "数学基础", takeaway: "先学加法", subtopics: [{ title: "加法", takeaway: "合并数量", knowledgePointIds: ["1:kp:1"] }],
  }] }, { bvid: course.bvid, selectedCids: ["1"], digests: [digest], missingParts: [] });
  const summary = core.courseMapToMarkdown(course, map);
  assert.match(summary, /## 一、数学基础/);
  assert.match(summary, /### 1\. 加法/);
  assert.match(summary, /#### 1\.1 加法定义/);
  assert.match(summary, /\*\*是什么：\*\* 合并数量/);
  assert.match(summary, /\?p=1&t=3/);
  const subtitles = core.transcriptsToMarkdown(course, [{ part: { page: 1, title: "基础" }, transcript: { source: "human_subtitle", confidence: "high", segments: [{ start: 3, text: "a * b" }] } }]);
  assert.match(subtitles, /\*\*0:03\*\* a \\\* b/);
  const mindmap = core.courseMapToMindmapMarkdown(course, map);
  assert.match(mindmap, /```mermaid\nmindmap/);
  assert.match(mindmap, /1\.1 加法定义/);
});
