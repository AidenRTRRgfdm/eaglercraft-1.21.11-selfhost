#!/usr/bin/env node
'use strict';

// Dependency-free launcher for the Velocity/Eaglercraft bridge. GDLauncher
// owns the Minecraft backend; this process owns only the Java proxy.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

const proxyDirectory = path.join(__dirname, 'proxy');

function initializeProxy() {
  const settings = path.join(proxyDirectory, 'plugins', 'eaglerxserver', 'settings.toml');
  if (!fs.existsSync(settings)) {
    const template = fs.readFileSync(`${settings}.example`, 'utf8');
    if (!template.includes('__SERVER_UUID__')) throw new Error('Missing server UUID template marker.');
    fs.writeFileSync(settings, template.replace('__SERVER_UUID__', crypto.randomUUID()), { flag: 'wx', mode: 0o600 });
  }
  const secret = path.join(proxyDirectory, 'forwarding.secret');
  if (!fs.existsSync(secret)) {
    fs.writeFileSync(secret, crypto.randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
  }
}

function javaMajor(java) {
  const version = spawnSync(java, ['-version'], {
    encoding: 'utf8', timeout: 10_000, windowsHide: true,
  });
  if (version.error || version.status !== 0) return null;
  const match = `${version.stderr}\n${version.stdout}`.match(/version\s+"(\d+)(?:\.(\d+))?/);
  return match ? Number(match[1] === '1' ? match[2] : match[1]) : null;
}

function findJava() {
  if (process.env.JAVA_BIN) {
    if ((javaMajor(process.env.JAVA_BIN) || 0) < 25) {
      throw new Error('JAVA_BIN must point to a working Java 25 or newer executable.');
    }
    return process.env.JAVA_BIN;
  }

  const candidates = [];
  if (process.env.JAVA_HOME) {
    candidates.push(path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'));
  }
  if (process.platform === 'darwin') {
    const managed = path.join(os.homedir(), 'Library', 'Application Support',
      'gdlauncher_carbon', 'data', 'managed_javas');
    if (fs.existsSync(managed)) {
      for (const entry of fs.readdirSync(managed).sort().reverse()) {
        candidates.push(path.join(managed, entry, 'Contents', 'Home', 'bin', 'java'));
        candidates.push(path.join(managed, entry, 'bin', 'java'));
      }
    }
    const installed = spawnSync('/usr/libexec/java_home', ['-v', '25'], {
      encoding: 'utf8', timeout: 10_000,
    });
    if (installed.status === 0 && installed.stdout.trim()) {
      candidates.push(path.join(installed.stdout.trim(), 'bin', 'java'));
    }
  }
  candidates.push(process.platform === 'win32' ? 'java.exe' : 'java');
  for (const candidate of [...new Set(candidates)]) {
    if ((javaMajor(candidate) || 0) >= 25) return candidate;
  }
  throw new Error('Java 25 or newer was not found. Install it, or set JAVA_BIN to its java executable.');
}

function backendAddress(host, port) {
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('BACKEND_PORT must be an integer from 1 to 65535.');
  }
  const unbracketed = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (net.isIP(unbracketed) === 6) return `[${unbracketed}]:${Number(port)}`;
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(host)) {
    throw new Error('BACKEND_HOST must be an IP address or hostname, without a scheme, path, or port.');
  }
  return `${host}:${Number(port)}`;
}

function configureBackend() {
  const configFile = path.join(proxyDirectory, 'velocity.toml');
  const original = fs.readFileSync(configFile, 'utf8');
  if (process.env.BACKEND_HOST === undefined && process.env.BACKEND_PORT === undefined) return;

  // Restrict changes to one normal quoted lobby address in the [servers]
  // table. Refuse an unexpected configuration rather than rewriting it.
  const lines = original.split(/(?<=\n)/);
  let inServers = false;
  const matches = [];
  for (let index = 0; index < lines.length; index++) {
    const header = lines[index].match(/^\s*\[([^\]]+)\]\s*(?:#.*)?\r?\n?$/);
    if (header) inServers = header[1].trim() === 'servers';
    if (inServers) {
      const match = lines[index].match(/^(\s*lobby\s*=\s*)(["'])([^"'\r\n]+)\2(\s*(?:#.*)?\r?\n?)$/);
      if (match) matches.push({ index, match });
    }
  }
  if (matches.length !== 1) throw new Error('Expected exactly one quoted lobby entry in velocity.toml [servers].');
  const { index, match } = matches[0];
  const current = match[3].match(/^(\[[^\]]+\]|[^:]+):(\d+)$/);
  if (!current) throw new Error('The existing lobby backend address is not a host:port value.');
  const address = backendAddress(process.env.BACKEND_HOST ?? current[1], process.env.BACKEND_PORT ?? current[2]);
  lines[index] = `${match[1]}${match[2]}${address}${match[2]}${match[4]}`;
  const updated = lines.join('');
  if (updated !== original) {
    const temporary = `${configFile}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporary, updated, { flag: 'wx', mode: fs.statSync(configFile).mode & 0o777 });
      fs.renameSync(temporary, configFile);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
  console.log(`[bridge] Backend: ${address}`);
}

function start() {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24 or newer is required.');
  const jar = path.join(proxyDirectory, 'velocity.jar');
  fs.accessSync(jar, fs.constants.R_OK);
  const java = findJava();
  const heap = process.env.PROXY_MEMORY_MB ?? '512';
  if (!/^\d+$/.test(heap) || Number(heap) < 128 || Number(heap) > 8192) {
    throw new Error('PROXY_MEMORY_MB must be a whole number from 128 to 8192.');
  }
  initializeProxy();
  configureBackend();
  console.log(`[bridge] Starting Velocity with Java ${javaMajor(java)} and ${Number(heap)} MB maximum heap.`);
  console.log('[bridge] Start the Minecraft backend in GDLauncher. Type end here, or press Ctrl+C, to stop this bridge.');

  const child = spawn(java, ['-Xms128M', `-Xmx${Number(heap)}M`, '-jar', jar], {
    cwd: proxyDirectory, stdio: 'inherit', shell: false,
  });
  let stopping = false;
  let forced = false;
  let stopTimer;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    console.log('[bridge] Stopping Velocity; allowing up to 30 seconds to save and shut down.');
    child.kill('SIGTERM');
    stopTimer = setTimeout(() => {
      forced = true;
      console.error('[bridge] Velocity did not stop within 30 seconds; terminating it.');
      child.kill('SIGKILL');
    }, 30_000);
    stopTimer.unref();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  child.on('error', (error) => {
    console.error(`[bridge] Java launch failed: ${error.message}`);
    process.exitCode = 1;
  });
  child.on('close', (code, signal) => {
    clearTimeout(stopTimer);
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    if (forced) process.exitCode = 137;
    else if (stopping && (code === 0 || code === 143 || signal === 'SIGTERM' || signal === 'SIGINT')) process.exitCode = 0;
    else process.exitCode = code ?? (signal ? 128 + (os.constants.signals[signal] || 1) : 1);
    console.log(`[bridge] Velocity stopped${signal ? ` (${signal})` : ` (exit ${code})`}.`);
  });
}

try {
  start();
} catch (error) {
  console.error(`[bridge] ${error.message}`);
  process.exitCode = 1;
}
