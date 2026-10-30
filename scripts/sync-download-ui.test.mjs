import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const syncScript = path.join(__dirname, "sync-download-ui.mjs");

async function runSync(root, ...args) {
  return execFileAsync(process.execPath, [syncScript, ...args], {
    env: { ...process.env, OUROBOROS_SITE_ROOT: root },
  });
}

test("download UI follows disabled and enabled manifests", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "ouroboros-site-ui-"));
  try {
    await mkdir(path.join(fixture, "downloads"));
    await writeFile(
      path.join(fixture, "index.html"),
      await readFile(path.join(repoRoot, "index.html"), "utf8"),
    );
    await writeFile(
      path.join(fixture, "downloads", "OuroborosChatGPT.manifest.json"),
      JSON.stringify({
        availability: "disabled",
        file: null,
        sha256: null,
        production: false,
        expectedSignerSubject: null,
        expectedSignerThumbprint: null,
      }),
    );

    await runSync(fixture, "--check");

    await writeFile(
      path.join(fixture, "downloads", "OuroborosChatGPT.manifest.json"),
      JSON.stringify({
        availability: "enabled",
        file: "OuroborosChatGPT.exe",
        sha256: "0".repeat(64),
        production: true,
        expectedSignerSubject: "CN=Ouro Labs",
        expectedSignerThumbprint: "A".repeat(40),
      }),
    );
    await runSync(fixture);
    await runSync(fixture, "--check");

    const enabled = await readFile(path.join(fixture, "index.html"), "utf8");
    assert.match(enabled, /href="\.\/downloads\/OuroborosChatGPT\.exe"/);
    assert.match(enabled, /deskDl: 'Download for Windows'/);
    assert.match(enabled, /deskDl: 'Windows용 다운로드'/);

    await writeFile(
      path.join(fixture, "downloads", "OuroborosChatGPT.manifest.json"),
      JSON.stringify({
        availability: "disabled",
        file: null,
        sha256: null,
        production: false,
        expectedSignerSubject: null,
        expectedSignerThumbprint: null,
      }),
    );
    await runSync(fixture);
    const disabled = await readFile(path.join(fixture, "index.html"), "utf8");
    assert.doesNotMatch(disabled, /href=["'][^"']+\.exe/);
    assert.match(disabled, /aria-disabled="true"/);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test('rejects a redirected download control and unsafe enabled manifests', async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'ouroboros-site-ui-negative-'));
  await mkdir(path.join(fixture, 'downloads'));
  const source = await readFile(path.join(repoRoot, 'index.html'), 'utf8');
  const manifestPath = path.join(fixture, 'downloads/OuroborosChatGPT.manifest.json');
  for (const manifest of [
    { availability: 'unknown' },
    { availability: 'enabled', production: 'true', file: 'Installer.exe' },
    { availability: 'enabled', production: true, file: '../Installer.exe' },
    { availability: 'enabled', production: true, file: 'https://example.com/Installer.exe' },
  ]) {
    await writeFile(path.join(fixture, 'index.html'), source);
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(runSync(fixture), /download UI sync failed/);
  }
  await writeFile(manifestPath, JSON.stringify({ availability: 'enabled', production: true, file: 'Installer.exe' }));
  await runSync(fixture);
  const enabled = await readFile(path.join(fixture, 'index.html'), 'utf8');
  await writeFile(path.join(fixture, 'index.html'), enabled.replace('./downloads/Installer.exe', 'https://example.com/redirect'));
  await assert.rejects(runSync(fixture, '--check'), /not synchronized/);
});
