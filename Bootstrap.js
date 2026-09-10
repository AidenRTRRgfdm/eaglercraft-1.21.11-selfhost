#!/usr/bin/env node
'use strict';

// Downloads only the artifacts pinned by the checked-in manifests.
// Does not start a server, replace worlds, or accept the Minecraft EULA.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { spawnSync } = require('node:child_process');

const root = __dirname;
const args = new Set(process.argv.slice(2));
const allowed = new Set(['--paper', '--cloudflared', '--help']);

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function safePath(directory, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative)) throw new Error('Invalid artifact filename.');
  const result = path.resolve(directory, relative);
  if (!result.startsWith(`${path.resolve(directory)}${path.sep}`)) throw new Error('Artifact path escapes its directory.');
  return result;
}

async function download(url, file, expected, bytes) {
  if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error(`Invalid SHA256 for ${file}.`);
  if (new URL(url).protocol !== 'https:') throw new Error('Downloads require HTTPS.');
  if (fs.existsSync(file)) {
    if (await sha256(file) !== expected) throw new Error(`Hash mismatch in existing ${file}; move it aside and rerun setup.`);
    console.log(`[setup] Verified ${path.relative(root, file)}`);
    return;
  }
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.download-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  console.log(`[setup] Downloading ${path.relative(root, file)}`);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Eaglercraft-GDLauncher-Bridge/1.0 (self-host setup)' },
      signal: AbortSignal.timeout(180_000),
    });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} downloading ${url}`);
    const hash = crypto.createHash('sha256');
    let received = 0;
    const limit = bytes ?? 150_000_000;
    const verify = new Transform({ transform(chunk, encoding, callback) {
      received += chunk.length;
      if (received > limit) return callback(new Error('Download exceeded the expected size limit.'));
      hash.update(chunk);
      callback(null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body), verify, fs.createWriteStream(temporary, { flags: 'wx', mode: 0o644 }));
    if (bytes !== undefined && received !== bytes) throw new Error(`Unexpected download size: ${received} instead of ${bytes}.`);
    if (hash.digest('hex') !== expected) throw new Error(`SHA256 mismatch downloading ${url}`);
    // link() refuses to overwrite a file created by another setup process.
    await fsp.link(temporary, file);
    console.log(`[setup] SHA256 verified ${path.relative(root, file)}`);
  } finally {
    await fsp.rm(temporary, { force: true });
  }
}

async function installCloudflared() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error('--cloudflared installs the pinned Apple Silicon macOS build only; install Cloudflare cloudflared for your platform separately.');
  }
  const manifest = JSON.parse(await fsp.readFile(path.join(root, 'cloudflared-source.json'), 'utf8'));
  const binary = path.join(root, 'bin', 'cloudflared');
  if (fs.existsSync(binary)) {
    if (await sha256(binary) !== manifest.binary_sha256) throw new Error('Existing cloudflared does not match the pinned binary SHA256.');
    await fsp.chmod(binary, 0o755);
    console.log('[setup] Verified bin/cloudflared');
    return;
  }
  await fsp.mkdir(path.join(root, 'bin'), { recursive: true });
  const temporary = await fsp.mkdtemp(path.join(root, 'bin', '.cloudflared-'));
  try {
    const archive = path.join(temporary, 'cloudflared.tgz');
    await download(manifest.download_url, archive, manifest.archive_sha256);
    const unpack = spawnSync('tar', ['-xzf', archive, '-C', temporary, 'cloudflared'], { encoding: 'utf8' });
    if (unpack.error || unpack.status !== 0) throw new Error(`Could not extract cloudflared: ${unpack.error?.message || unpack.stderr}`);
    const extracted = path.join(temporary, 'cloudflared');
    if (!(await fsp.lstat(extracted)).isFile()) throw new Error('cloudflared archive member is not a regular file.');
    if (await sha256(extracted) !== manifest.binary_sha256) throw new Error('Extracted cloudflared SHA256 mismatch.');
    await fsp.chmod(extracted, 0o755);
    await fsp.link(extracted, binary);
    console.log('[setup] Installed verified bin/cloudflared');
  } finally {
    await fsp.rm(temporary, { recursive: true, force: true });
  }
}

async function main() {
  for (const arg of args) if (!allowed.has(arg)) throw new Error(`Unknown argument: ${arg}`);
  if (args.has('--help')) {
    console.log('Usage: node Bootstrap.js [--paper] [--cloudflared]\nAlways fetches the pinned proxy/plugin JARs. --paper downloads Paper into backend/; --cloudflared installs the Apple Silicon macOS tunnel client.');
    return;
  }
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24 or newer is required.');
  if (args.has('--cloudflared') && (process.platform !== 'darwin' || process.arch !== 'arm64')) {
    throw new Error('--cloudflared requires Apple Silicon macOS; omit this option on other systems.');
  }
  const templates = JSON.parse(await fsp.readFile(path.join(root, 'config-templates.json'), 'utf8'));
  for (const [relative, content] of Object.entries(templates)) {
    const file = safePath(root, relative);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    try {
      await fsp.writeFile(file, content, { flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  const manifest = JSON.parse(await fsp.readFile(path.join(root, 'proxy-downloads.json'), 'utf8'));
  for (const artifact of manifest.artifacts) {
    await download(artifact.source, safePath(path.join(root, 'proxy'), artifact.file), artifact.sha256, artifact.bytes);
  }
  if (args.has('--paper')) {
    const paper = JSON.parse(await fsp.readFile(path.join(root, 'paper-download.json'), 'utf8'));
    await download(paper.download.url, safePath(path.join(root, 'backend'), paper.download.name), paper.download.checksums.sha256, paper.download.size);
    console.log('[setup] Paper downloaded. Follow README.md to install it in GDLauncher. No EULA was accepted.');
  }
  if (args.has('--cloudflared')) await installCloudflared();
  if (process.platform === 'darwin') {
    for (const command of ['Start Bridge.command', 'Start Public Link.command']) {
      await fsp.chmod(path.join(root, command), 0o755);
    }
  }
  console.log('[setup] Downloads complete. Configure/start the Paper backend, then run npm start.');
}

main().catch((error) => {
  console.error(`[setup] ${error.message}`);
  process.exitCode = 1;
});
