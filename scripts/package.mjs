import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { publicFiles } from "./release-files.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = spawnSync(process.execPath, ["scripts/check.mjs"], { cwd: root, stdio: "inherit" });
if (check.status !== 0) process.exit(check.status || 1);
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const dist = path.join(root, "dist");
fs.mkdirSync(dist, { recursive: true });
const output = path.join(dist, `bilibili-course-map-v${manifest.version}.zip`);
const staging = fs.mkdtempSync(path.join(os.tmpdir(), "bili-course-map-"));
try {
  for (const file of publicFiles) {
    const target = path.join(staging, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, file), target);
  }
  if (process.platform === "win32") {
    const command = `Compress-Archive -Path '${staging.replaceAll("'", "''")}\\*' -DestinationPath '${output.replaceAll("'", "''")}' -Force`;
    const zipped = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], { stdio: "inherit" });
    if (zipped.status !== 0) process.exit(zipped.status || 1);
  } else {
    const zipped = spawnSync("zip", ["-X", "-q", "-r", output, "."], { cwd: staging, stdio: "inherit" });
    if (zipped.status !== 0) process.exit(zipped.status || 1);
  }
  console.log(`已创建 ${output}`);
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}
