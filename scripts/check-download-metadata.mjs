import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = process.env.OUROBOROS_SITE_ROOT
  ? path.resolve(process.env.OUROBOROS_SITE_ROOT)
  : path.resolve(__dirname, "..");
const manifestPath = path.join(repoRoot, "downloads", "OuroborosChatGPT.manifest.json");

const placeholderPattern = /^(?:0+|n\/a|na|none|null|unknown|unsigned|todo|tbd|placeholder|changeme|change-me|cn\s*=\s*(?:todo|unknown|placeholder|changeme))$/i;

function fail(message) {
  console.error(`download metadata check failed: ${message}`);
  process.exit(1);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlaceholder(value) {
  return !isNonEmptyString(value) || placeholderPattern.test(value.trim());
}

function readManifest(raw) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(`manifest is not valid JSON: ${error.message}`);
  }
}

const manifest = readManifest(await readFile(manifestPath, "utf8"));
const indexHtml = await readFile(path.join(repoRoot, "index.html"), "utf8");

if (!new Set(["disabled", "enabled"]).has(manifest.availability)) {
  fail("manifest.availability must be disabled or enabled");
}

const executableFiles = (await readdir(path.join(repoRoot, "downloads")))
  .filter((name) => name.toLowerCase().endsWith(".exe"));
const executableLinks = [...indexHtml.matchAll(/href=["']([^"']+\.exe(?:[?#][^"']*)?)["']/gi)]
  .map((match) => match[1]);

if (manifest.availability === "disabled") {
  if (manifest.production !== false || manifest.file !== null || manifest.sha256 !== null || manifest.expectedSignerSubject !== null || manifest.expectedSignerThumbprint !== null) {
    fail("disabled downloads require production=false and null file, hash, signer, and signer thumbprint");
  }
  if (executableFiles.length !== 0 || executableLinks.length !== 0) {
    fail("disabled downloads must publish no executable file or link");
  }
  console.log("download metadata ok: Windows download is safely disabled");
  process.exit(0);
}

if (!isNonEmptyString(manifest.file)) {
  fail("manifest.file must be a non-empty file name");
}

if (!/^[A-Za-z0-9._-]+\.exe$/i.test(manifest.file)) {
  fail("manifest.file must name a file directly under downloads/");
}

if (!/^[a-f0-9]{64}$/.test(manifest.sha256 ?? "")) {
  fail("manifest.sha256 must be a lowercase 64-character SHA-256 hex digest");
}

if (typeof manifest.production !== "boolean") {
  fail("manifest.production must be a boolean");
}

if (executableFiles.length !== 1 || executableFiles[0] !== manifest.file) {
  fail(`downloads/ must contain exactly the manifested executable; found ${executableFiles.join(", ") || "none"}`);
}

const expectedLink = `./downloads/${manifest.file}`;
if (executableLinks.length !== 1 || executableLinks[0] !== expectedLink) {
  fail(`index.html must contain only the canonical executable link ${expectedLink}; found ${executableLinks.join(", ") || "none"}`);
}
if (manifest.production !== true) {
  fail("a publicly linked executable must have production=true");
}

if (manifest.expectedSignerSubject !== null && manifest.expectedSignerSubject !== undefined) {
  if (isPlaceholder(manifest.expectedSignerSubject)) {
    fail("manifest.expectedSignerSubject must not be empty, zero, or a placeholder");
  }
}

const configuredSignerSubject = process.env.EXPECTED_SIGNER_SUBJECT || manifest.expectedSignerSubject;
if (isPlaceholder(configuredSignerSubject)) {
  fail("production manifests require a real expectedSignerSubject or EXPECTED_SIGNER_SUBJECT");
}

if (!/^[A-F0-9]{40}$/i.test(manifest.expectedSignerThumbprint ?? "")) {
  fail("production manifests require a 40-character signer certificate thumbprint");
}

const downloadPath = path.join(repoRoot, "downloads", manifest.file);
const downloadBytes = await readFile(downloadPath).catch((error) => {
  fail(`cannot read downloads/${manifest.file}: ${error.message}`);
});

const actualSha256 = createHash("sha256").update(downloadBytes).digest("hex");
if (actualSha256 !== manifest.sha256) {
  fail(`manifest.sha256 ${manifest.sha256} does not match downloads/${manifest.file} ${actualSha256}`);
}

console.log(`download metadata ok: downloads/${manifest.file} sha256=${actualSha256} production=${manifest.production}`);
