const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../lib/core");
const cacheModule = require("../lib/cache");
const deepseekModule = require("../lib/deepseek");

function memoryStorage() {
  const values = {};
  return {
    async get(key) {
      if (key === null) return { ...values };
      const keys = Array.isArray(key) ? key : [key];
      return Object.fromEntries(keys.filter((item) => item in values).map((item) => [item, values[item]]));
    },
    async set(entries) { Object.assign(values, entries); },
    async remove(keys) { (Array.isArray(keys) ? keys : [keys]).forEach((key) => delete values[key]); },
    values,
  };
}

test("缓存按bvid+cid隔离并让选择集合或内容变化使聚合键失效", async () => {
  const storage = memoryStorage();
  const cache = cacheModule.createCache(storage, core, () => 1000);
  await cache.setPart("BV1AB411C7XQ", "1", { digest: { cid: "1" }, fingerprint: "a" });
  assert.equal((await cache.getPart("BV1AB411C7XQ", "1")).fingerprint, "a");
  const first = cache.courseMapSignature(["1"], [{ digest: { cid: "1" }, fingerprint: "a" }]);
  const changed = cache.courseMapSignature(["1"], [{ digest: { cid: "1" }, fingerprint: "b" }]);
  const selected = cache.courseMapSignature(["1", "2"], [{ digest: { cid: "1" }, fingerprint: "a" }]);
  assert.notEqual(first, changed);
  assert.notEqual(first, selected);
  assert.equal(await cache.removeVideo("BV1AB411C7XQ"), 1);
});

test("DeepSeek非法JSON重试一次并校验分P结构", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    const content = calls === 1 ? "not json" : JSON.stringify({ oneSentence: "本节介绍基础", topics: ["基础"], prerequisites: [], outcomes: ["理解基础"], keyMoments: [{ seconds: 3, title: "开始" }] });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  };
  const client = deepseekModule.createClient({
    fetchImpl,
    getSettings: async () => ({ aiApiKey: "test-only-placeholder" }),
    loadPrompt: async () => "只返回JSON",
    core,
  });
  const digest = await client.summarizePart(
    { title: "课程" }, { cid: "1", page: 1, title: "第一课" },
    { source: "ai_subtitle", confidence: "medium", segments: [{ start: 3, end: 4, text: "基础内容" }] },
  );
  assert.equal(calls, 2);
  assert.equal(digest.source, "ai_subtitle");
  assert.equal(digest.keyMoments[0].seconds, 3);
});

test("Manifest和运行时代码保持最小权限且不含Cookie/Supadata依赖", () => {
  const root = path.resolve(__dirname, "..");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.ok(!manifest.permissions.includes("cookies"));
  assert.deepEqual(manifest.host_permissions, [
    "https://www.bilibili.com/*", "https://api.bilibili.com/*",
    "https://aisubtitle.hdslb.com/*", "https://api.deepseek.com/*",
  ]);
  const runtime = ["background.js","content.js","sidepanel.js","options.js","settings.js","lib/bilibili.js","lib/deepseek.js"]
    .map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
  assert.doesNotMatch(runtime, /api\.supadata\.ai|Supadata/i);
  assert.doesNotMatch(runtime, /chrome\.cookies/);
  assert.match(runtime, /deepseek-v4-flash/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, "content.js"), "utf8"), /storage\.local/);
});
