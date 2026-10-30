import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const script = new URL('./check-download-metadata.mjs', import.meta.url);
const bytes = Buffer.from('unsigned installer fixture');
const enabled = {
  availability: 'enabled', production: true, file: 'Installer.exe',
  sha256: createHash('sha256').update(bytes).digest('hex'),
  expectedSignerSubject: 'CN=Release Fixture', expectedSignerThumbprint: 'A'.repeat(40),
};
const disabled = {
  availability: 'disabled', production: false, file: null, sha256: null,
  expectedSignerSubject: null, expectedSignerThumbprint: null,
};

async function fixture({ manifest = enabled, raw, files = { 'Installer.exe': bytes }, html = '<a href="./downloads/Installer.exe">Download</a>', links = {} } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ouroboros-metadata-'));
  await mkdir(path.join(root, 'downloads'));
  await writeFile(path.join(root, 'index.html'), html);
  if (raw !== null) await writeFile(path.join(root, 'downloads/OuroborosChatGPT.manifest.json'), raw ?? JSON.stringify(manifest));
  for (const [file, content] of Object.entries(files)) {
    const destination = path.join(root, 'downloads', file);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
  for (const [file, target] of Object.entries(links)) {
    await symlink(target, path.join(root, 'downloads', file));
  }
  const { EXPECTED_SIGNER_SUBJECT, ...env } = process.env;
  return spawnSync(process.execPath, [script.pathname], { env: { ...env, OUROBOROS_SITE_ROOT: root }, encoding: 'utf8', timeout: 10000 });
}

for (const [name, setup] of [
  ['enabled metadata and digest', {}],
  ['disabled without installer or link', { manifest: disabled, files: {}, html: '<span aria-disabled="true">Unavailable</span>' }],
]) test(name, async () => { const r = await fixture(setup); assert.equal(r.status, 0, r.stderr); });

for (const [name, setup, error] of [
  ['missing manifest', { raw: null }, /ENOENT/],
  ['malformed manifest', { raw: '{' }, /not valid JSON/],
  ['invalid state', { manifest: { ...enabled, availability: 'pending' } }, /availability/],
  ['missing binary', { files: {} }, /exactly the manifested/],
  ['tampered binary', { files: { 'Installer.exe': 'tampered' } }, /does not match/],
  ['tampered digest', { manifest: { ...enabled, sha256: '0'.repeat(64) } }, /does not match/],
  ['invalid digest', { manifest: { ...enabled, sha256: 'no' } }, /SHA-256/],
  ['path traversal', { manifest: { ...enabled, file: '../Installer.exe' } }, /directly under/],
  ['URL instead of file', { manifest: { ...enabled, file: 'https://example.com/Installer.exe' } }, /directly under/],
  ['attribute injection', { manifest: { ...enabled, file: 'bad"name.exe' } }, /directly under/],
  ['false production', { manifest: { ...enabled, production: false } }, /production=true/],
  ['string production', { manifest: { ...enabled, production: 'true' } }, /boolean/],
  ['placeholder signer', { manifest: { ...enabled, expectedSignerSubject: 'unknown' } }, /placeholder/],
  ['invalid certificate pin', { manifest: { ...enabled, expectedSignerThumbprint: 'invalid' } }, /thumbprint/],
  ['unmanifested binary', { files: { 'Installer.exe': bytes, 'Extra.EXE': bytes } }, /exactly the manifested/],
  ['redirect link', { html: '<a href="https://example.com/Installer.exe">Download</a>' }, /canonical executable link/],
  ['digest query link', { html: '<a href="./downloads/Installer.exe?redirect=1">Download</a>' }, /canonical executable link/],
  ['duplicate link', { html: '<a href="./downloads/Installer.exe">A</a><a href="./downloads/Installer.exe">B</a>' }, /canonical executable link/],
  ['disabled binary', { manifest: disabled, html: '' }, /no executable/],
  ['disabled link', { manifest: disabled, files: {} }, /no executable/],
  ['disabled signed metadata', { manifest: { ...disabled, sha256: enabled.sha256 }, files: {}, html: '' }, /null file/],
]) test(`rejects ${name}`, async () => {
  const r = await fixture(setup);
  assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, error);
});

test('embedded public page JavaScript compiles', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  let count = 0;
  for (const [, attributes, source] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/\bsrc=/.test(attributes)) continue;
    new Function(source);
    count++;
  }
  assert.ok(count > 0);
});

for (const manifest of [disabled, enabled]) {
  const base = manifest.availability === 'disabled'
    ? { manifest, files: {}, html: '<span>Unavailable</span>' }
    : { manifest, files: { 'Installer.exe': bytes } };
  for (const relative of ['legacy/Unsigned.exe', '.hidden/deeper/.Unsigned.EXE']) {
    test(`rejects ${manifest.availability} nested executable ${relative}`, async () => {
      const result = await fixture({ ...base, files: { ...base.files, [relative]: bytes } });
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /no executable|exactly the manifested/);
    });
  }
  for (const [name, target] of [['cycle', '.'], ['dangling', 'missing-directory']]) {
    test(`rejects ${manifest.availability} symbolic link ${name}`, async () => {
      const result = await fixture({ ...base, links: { [name]: target } });
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /symbolic links/);
    });
  }
  test(`allows ${manifest.availability} nested non-executable files`, async () => {
    const result = await fixture({ ...base, files: { ...base.files, '.hidden/notes.txt': 'release notes' } });
    assert.equal(result.status, 0, result.stderr);
  });
}

test('rejects a symbolic link as the manifested executable', async () => {
  const result = await fixture({ files: {}, links: { 'Installer.exe': 'OuroborosChatGPT.manifest.json' } });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /symbolic links/);
});
