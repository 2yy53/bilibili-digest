import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { publicFiles } from "./release-files.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fail = (message) => { console.error(`检查失败：${message}`); process.exit(1); };
for (const file of publicFiles) {
  const target = path.join(root, file);
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) fail(`缺少发布文件 ${file}`);
}

let manifest;
try { manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8")); }
catch (error) { fail(`manifest.json 无效：${error.message}`); }
if (manifest.manifest_version !== 3) fail("必须使用 Manifest V3");
if ((manifest.permissions || []).includes("cookies")) fail("不得申请 cookies 权限");
const expectedHosts = new Set([
  "https://www.bilibili.com/*", "https://api.bilibili.com/*",
  "https://aisubtitle.hdslb.com/*", "https://api.deepseek.com/*",
]);
for (const host of manifest.host_permissions || []) if (!expectedHosts.has(host)) fail(`存在计划外 host 权限：${host}`);
for (const host of expectedHosts) if (!(manifest.host_permissions || []).includes(host)) fail(`缺少 host 权限：${host}`);

const referenced = new Set([
  manifest.background?.service_worker, manifest.side_panel?.default_path, manifest.options_ui?.page,
  ...(manifest.content_scripts || []).flatMap((item) => item.js || []),
].filter(Boolean));
for (const file of ["background.js", "sidepanel.html", "options.html"]) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  for (const match of source.matchAll(/(?:importScripts\(|(?:src|href)=)[\s\n]*["']([^"']+)["']/g)) {
    if (!/^(?:https?:|#)/.test(match[1])) referenced.add(match[1]);
  }
}
for (const file of referenced) if (!publicFiles.includes(file)) fail(`运行时引用未进入发布列表：${file}`);

const scanFiles = publicFiles.filter((file) => /\.(?:js|json|html|css|md)$/i.test(file));
const source = scanFiles.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const runtimeSource = publicFiles.filter((file) => /\.(?:js|json|html)$/i.test(file))
  .map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
if (/api\.supadata\.ai|Supadata/i.test(runtimeSource)) fail("运行时不得依赖 Supadata");
if (/\bSESSDATA\s*[:=]/i.test(source)) fail("源码不得读取或声明 SESSDATA");
if (/\bsk-[A-Za-z0-9_-]{20,}\b/.test(source)) fail("发现疑似 API Key");
if (!/deepseek-v4-flash/.test(source)) fail("缺少固定 DeepSeek V4 Flash 模型");

for (const file of publicFiles.filter((item) => item.endsWith(".js"))) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, file)], { stdio: "inherit" });
  if (result.status !== 0) fail(`${file} 语法检查失败`);
}
const testFiles = fs.readdirSync(path.join(root, "tests"))
  .filter((file) => file.endsWith(".test.js"))
  .sort()
  .map((file) => path.join("tests", file));
const tests = spawnSync(process.execPath, ["--test", "--test-isolation=none", ...testFiles], { cwd: root, stdio: "inherit" });
if (tests.status !== 0) fail("测试失败");
console.log(`发布检查通过（${publicFiles.length} 个文件）。`);
