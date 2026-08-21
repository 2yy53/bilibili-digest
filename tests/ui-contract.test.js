const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("侧栏提供三个Markdown导出入口和原生两层折叠控制", () => {
  const html = read("sidepanel.html");
  const script = read("sidepanel.js");
  for (const id of ["downloadSubtitleButton", "downloadSummaryButton", "mindmapButton", "expandAllButton", "collapseAllButton"]) {
    assert.equal((html.match(new RegExp(`id=["']${id}["']`, "g")) || []).length, 1);
  }
  assert.match(html, /aria-label="笔记工具"/);
  assert.match(script, /document\.createElement\("details"\)/);
  assert.match(script, /document\.createTextNode/);
  assert.match(script, /courseMapToMindmapMarkdown/);
});

test("窄侧栏排版保留15px正文、18px一级和16px二级层级", () => {
  const css = read("sidepanel.css");
  assert.match(css, /body[^}]*font-size:\s*15px[^}]*line-height:\s*1\.65/s);
  assert.match(css, /\.note-summary-title\s*\{[^}]*font-size:\s*18px/s);
  assert.match(css, /\.note-subtopic \.note-summary-title\s*\{[^}]*font-size:\s*16px/s);
  assert.doesNotMatch(css, /body[^}]*min-width:\s*320px/s);
});

test("提示词要求四问完整且课程聚合只引用知识点ID", () => {
  const partPrompt = read("prompts/part-summary.md");
  const coursePrompt = read("prompts/course-map.md");
  for (const field of ["what", "why", "when", "how"]) assert.match(partPrompt, new RegExp(`"${field}"`));
  assert.match(partPrompt, /视频未说明/);
  assert.match(coursePrompt, /knowledgePointIds/);
  assert.match(coursePrompt, /每个id必须且只能出现一次/);
});
