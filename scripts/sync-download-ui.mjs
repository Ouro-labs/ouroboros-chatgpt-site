import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = process.env.OUROBOROS_SITE_ROOT
  ? path.resolve(process.env.OUROBOROS_SITE_ROOT)
  : path.resolve(__dirname, "..");
const indexPath = path.join(repoRoot, "index.html");
const manifestPath = path.join(repoRoot, "downloads", "OuroborosChatGPT.manifest.json");
const checkOnly = process.argv.includes("--check");

const disabledControl = '<span data-windows-download-control aria-disabled="true" style="margin-top:8px;font-size:15.5px;font-weight:600;padding:15px 30px;border-radius:999px;background:var(--soft);color:var(--mute)">{{deskDl}}</span>';
const enabledControl = (file) => `<a data-windows-download-control href="./downloads/${file}" download="${file}" style="margin-top:8px;font-size:15.5px;font-weight:600;padding:15px 30px;border-radius:999px;background:var(--pill);color:var(--pilltxt)" style-hover="background:var(--accent);color:var(--bg)">{{deskDl}}</a>`;

function fail(message) {
  console.error(`download UI sync failed: ${message}`);
  process.exit(1);
}

function replaceExactlyOnce(source, pattern, replacement, label) {
  const matches = source.match(pattern) ?? [];
  if (matches.length !== 1) {
    fail(`expected exactly one ${label}; found ${matches.length}`);
  }
  return source.replace(pattern, replacement);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
let current = await readFile(indexPath, "utf8");
let expected = current;

const controlPattern = /<(?:a|span) data-windows-download-control\b[^>]*>\{\{deskDl\}\}<\/(?:a|span)>/g;
const englishLabelPattern = /deskDl: '(?:Download for Windows|Windows download temporarily unavailable)'/g;
const koreanLabelPattern = /deskDl: '(?:Windows용 다운로드|Windows 다운로드 준비 중)'/g;

if (manifest.availability === "disabled") {
  expected = replaceExactlyOnce(expected, controlPattern, disabledControl, "Windows download control");
  expected = replaceExactlyOnce(expected, englishLabelPattern, "deskDl: 'Windows download temporarily unavailable'", "English Windows download label");
  expected = replaceExactlyOnce(expected, koreanLabelPattern, "deskDl: 'Windows 다운로드 준비 중'", "Korean Windows download label");
} else if (manifest.availability === "enabled") {
  if (manifest.production !== true || typeof manifest.file !== "string" || !/^[A-Za-z0-9._-]+\.exe$/i.test(manifest.file)) {
    fail("enabled downloads require production=true and a safe executable file name");
  }
  expected = replaceExactlyOnce(expected, controlPattern, enabledControl(manifest.file), "Windows download control");
  expected = replaceExactlyOnce(expected, englishLabelPattern, "deskDl: 'Download for Windows'", "English Windows download label");
  expected = replaceExactlyOnce(expected, koreanLabelPattern, "deskDl: 'Windows용 다운로드'", "Korean Windows download label");
} else {
  fail("manifest.availability must be disabled or enabled");
}

if (checkOnly) {
  if (current !== expected) {
    fail("index.html is not synchronized with the public download manifest");
  }
  console.log(`download UI sync ok: ${manifest.availability}`);
} else if (current !== expected) {
  await writeFile(indexPath, expected, "utf8");
  console.log(`download UI synchronized: ${manifest.availability}`);
} else {
  console.log(`download UI already synchronized: ${manifest.availability}`);
}
