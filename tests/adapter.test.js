const test = require("node:test");
const assert = require("node:assert/strict");
const bili = require("../lib/bilibili");
const core = require("../lib/core");
const protobuf = require("../lib/protobuf");

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

const coursePayload = {
  code: 0,
  data: {
    bvid: "BV1Ab411C7xQ", aid: 42, title: "测试课程", desc: "简介",
    owner: { name: "老师", mid: 7 }, pages: [{ page: 1, cid: 101, part: "第一课", duration: 300 }],
  },
};
const navPayload = {
  code: 0,
  data: {
    isLogin: true,
    wbi_img: {
      img_url: "https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png",
      sub_url: "https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png",
    },
  },
};

test("适配器加载多P元数据并用当前网页登录态获取人工字幕", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/x/web-interface/view?")) return jsonResponse(coursePayload);
    if (String(url).endsWith("/x/web-interface/nav")) return jsonResponse(navPayload);
    if (String(url).includes("/x/player/wbi/v2")) return jsonResponse({ code: 0, data: { subtitle: { subtitles: [{ lan: "zh-CN", lan_doc: "中文", ai_type: 0, subtitle_url: "//aisubtitle.hdslb.com/caption.json" }] } } });
    if (String(url).includes("aisubtitle.hdslb.com")) return jsonResponse({ body: [{ from: 2, to: 4, content: "课程开始" }] });
    throw new Error(`unexpected ${url}`);
  };
  const adapter = bili.createAdapter({ fetchImpl, now: () => 1702204169000, protobuf, core });
  const course = await adapter.loadCourse("BV1Ab411C7xQ");
  const transcript = await adapter.fetchPartTranscript(course, course.pages[0]);
  assert.equal(course.pages[0].cid, "101");
  assert.equal(transcript.source, "human_subtitle");
  assert.equal(transcript.segments[0].text, "课程开始");
  assert.ok(calls.every((call) => call.options.credentials === "include"));
});

test("无字幕时使用B站AI conclusion并标记低置信度", async () => {
  const fetchImpl = async (url) => {
    const text = String(url);
    if (text.includes("/x/web-interface/view?")) return jsonResponse(coursePayload);
    if (text.endsWith("/x/web-interface/nav")) return jsonResponse(navPayload);
    if (text.includes("/x/player/wbi/v2")) return jsonResponse({ code: 0, data: { subtitle: { subtitles: [] } } });
    if (text.includes("/x/v2/subtitle/web/view")) return new Response(new Uint8Array(), { status: 200 });
    if (text.includes("/view/conclusion/get")) return jsonResponse({ code: 0, data: { model_result: {
      summary: "平台生成的课程概述",
      subtitle: [{ part_subtitle: [{ content: "平台生成的分段字幕", start_timestamp: 8, end_timestamp: 11 }] }],
      outline: [{ title: "第一章" }],
    } } });
    throw new Error(`unexpected ${url}`);
  };
  const adapter = bili.createAdapter({ fetchImpl, now: () => 1702204169000, protobuf, core });
  const course = await adapter.loadCourse("BV1Ab411C7xQ");
  const transcript = await adapter.fetchPartTranscript(course, course.pages[0]);
  assert.equal(transcript.source, "bilibili_ai_conclusion");
  assert.equal(transcript.confidence, "low");
  assert.deepEqual(transcript.segments[0], { id: "segment-0-8000", start: 8, end: 11, text: "平台生成的分段字幕" });
});
