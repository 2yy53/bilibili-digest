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

test("课程地图校验保留缺失分P并补齐模型漏掉的模块", () => {
  const digests = [{ cid: "1", page: 1, title: "基础", oneSentence: "基础内容", topics: [], prerequisites: [], outcomes: [], keyMoments: [], source: "human_subtitle", confidence: "high" }];
  const map = core.validateCourseMap({ overview: "课程概述", learningPath: ["先学基础"], modules: [] }, {
    bvid: "BV1Ab411C7xQ", selectedCids: ["1", "2"], digests,
    missingParts: [{ cid: "2", page: 2, title: "进阶", errorCode: "NO_TEXT" }],
  });
  assert.equal(map.modules.length, 1);
  assert.equal(map.missingParts[0].errorCode, "NO_TEXT");
});
