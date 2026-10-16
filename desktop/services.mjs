import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, createWriteStream, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import nextEnv from '@next/env';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
nextEnv.loadEnvConfig(root, false);
for (const key of ['AUTH_USERNAME', 'AUTH_PASSWORD', 'ALLOWED_HOSTS', 'ALLOWED_ORIGINS', 'OLLAMA_PATH', 'BROWSER_LINKS']) {
  if (process.env[`JOHNNY_${key}`] !== undefined) process.env[`JIMMY_${key}`] ??= process.env[`JOHNNY_${key}`];
}
export const origin = process.argv.includes('--desktop-test') ? 'http://127.0.0.1:3003' : 'http://127.0.0.1:3002';
const exec = promisify(execFile);
const composeArgs = ['compose', '--env-file', path.join(root, '.env.local'), '-f', path.join(root, 'voice-service/compose.yaml')];
function modelSettings() {
  try { return JSON.parse(readFileSync(path.join(root, 'storage/model-settings.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}

export class JimmyServices {
  constructor(report) {
    this.report = report;
    this.abort = new AbortController();
    this.next = null;
    this.voiceStarted = false;
    this.ollama = null;
    this.warming = null;
    this.awake = false;
    mkdirSync(path.join(root, '.jimmy-runtime'), { recursive: true });
  }

  async command(file, args, timeout = 30000) {
    return exec(file, args, { cwd: root, windowsHide: true, timeout,
      env: { ...process.env, VOICE_TTS_LAZY_LOAD: '1' },
      signal: this.abort.signal, maxBuffer: 1024 * 1024 });
  }

  launch(file, args, name, env = process.env) {
    const log = createWriteStream(path.join(root, '.jimmy-runtime', `${name}.log`), { flags: 'a' });
    const child = spawn(file, args, { cwd: root, windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.on('error', error => { log.write(`${error.message}\n`); });
    child.on('close', () => log.end());
    return child;
  }

  async json(url, options = {}, timeout = 5000) {
    const response = await fetch(url, { ...options,
      signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(timeout)]) });
    if (!response.ok) throw new Error(`Service returned HTTP ${response.status}`);
    return response.json();
  }

  async until(check, message, timeout = 180000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      this.abort.signal.throwIfAborted();
      try { if (await check()) return; } catch (error) {
        if (this.abort.signal.aborted) throw error;
      }
      await delay(1500, undefined, { signal: this.abort.signal });
    }
    throw new Error(message);
  }

  async start() {
    if (!existsSync(path.join(root, '.next/BUILD_ID'))) throw new Error('Run npm run build before starting the desktop assistant.');
    if (!process.env.JIMMY_AUTH_USERNAME || !process.env.JIMMY_AUTH_PASSWORD || !process.env.VOICE_SERVICE_SECRET) {
      throw new Error('Configure Jimmy authentication and VOICE_SERVICE_SECRET in .env.local first.');
    }
    this.report('Starting Jimmy server…');
    this.next = this.launch(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '3002'], 'desktop-server', {
      ...process.env, ELECTRON_RUN_AS_NODE: '1', OLLAMA_KEEP_ALIVE: process.env.OLLAMA_KEEP_ALIVE || '30m',
      VOICE_SERVICE_PUBLIC_WS_URL: 'ws://127.0.0.1:8765/ws/voice', TTS_SERVICE_URL: 'http://127.0.0.1:8766',
    });
    await this.until(async () => {
      if (this.next.exitCode !== null) return false;
      const response = await fetch(origin, { signal: AbortSignal.timeout(2000) });
      return response.status === 401 || response.ok;
    }, 'Desktop server could not start. Check .jimmy-runtime/desktop-server.log and port 3002.', 30000);
    // Do not accidentally attach to a different process already using this port.
    await delay(500, undefined, { signal: this.abort.signal });
    if (this.next.exitCode !== null) throw new Error('Port 3002 is already in use or Jimmy could not start.');

    this.report('Starting Docker for voice recognition…');
    try { await this.command('docker', ['info'], 10000); } catch {
      this.abort.signal.throwIfAborted();
      await this.command('docker', ['desktop', 'start', '--detach'], 30000);
      await this.until(async () => { await this.command('docker', ['info'], 10000); return true; }, 'Docker did not become ready. Start Docker Desktop and choose Retry in the tray.', 240000);
    }
    this.report('Loading the listening model…');
    await this.command('docker', ['volume', 'create', 'johnny-voice-models']);
    this.voiceStarted = true;
    await this.command('docker', [...composeArgs, 'up', '-d', '--no-build', 'voice', 'tts'], 120000);
    await this.until(async () => {
      const data = await this.json('http://127.0.0.1:8765/health');
      return data.asr_status?.state === 'ready';
    }, 'Moonshine could not load. Check npm run voice:logs.', 240000);

    this.report('Starting Ollama…');
    try { await this.json('http://127.0.0.1:11434/api/version'); } catch {
      this.abort.signal.throwIfAborted();
      const ollama = process.env.JIMMY_OLLAMA_PATH || path.join(process.env.LOCALAPPDATA || '', 'Programs/Ollama/ollama.exe');
      this.ollama = this.launch(existsSync(ollama) ? ollama : 'ollama', ['serve'], 'desktop-ollama');
      await this.until(() => this.json('http://127.0.0.1:11434/api/version'), 'Ollama did not start. Install Ollama, then retry.', 60000);
    }
    this.report('Say “Jimmy” to wake me');
    if (modelSettings().keepLoaded === true) await this.wake();
  }

  wake() {
    if (this.awake) return Promise.resolve();
    if (this.warming) return this.warming;
    this.report('Waking up…');
    this.warming = (async () => {
      const settings = modelSettings();
      await Promise.all([
        this.json('http://127.0.0.1:8766/warm', { method: 'POST', headers: {
          'X-Voice-Service-Secret': process.env.VOICE_SERVICE_SECRET,
        } }, 240000),
        this.json('http://127.0.0.1:11434/api/generate', { method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: settings.model || process.env.OLLAMA_MODEL || 'qwen3:4b-instruct', keep_alive: settings.keepLoaded === true ? -1 : '30m', stream: false }),
        }, 240000),
      ]);
      this.awake = true;
      this.report('Ready');
    })().finally(() => { this.warming = null; });
    return this.warming;
  }

  async stop() {
    this.abort.abort();
    if (this.warming) await this.warming.catch(() => {});
    const failures = [];
    // Only unload the configured Jimmy model, not other users' Ollama models.
    try {
      const response = await fetch('http://127.0.0.1:11434/api/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelSettings().model || process.env.OLLAMA_MODEL || 'qwen3:4b-instruct', keep_alive: 0, stream: false }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok && response.status !== 404) failures.push('Ollama model unload failed');
    } catch { if (this.awake) failures.push('Could not confirm Ollama model unload'); }
    if (this.voiceStarted) {
      try { await exec('docker', [...composeArgs, 'stop', 'voice', 'tts'], { cwd: root, windowsHide: true, timeout: 60000 }); }
      catch { failures.push('Voice containers could not stop; run npm run voice:down'); }
    }
    if (this.next && this.next.exitCode === null) this.next.kill();
    if (this.ollama && this.ollama.exitCode === null) this.ollama.kill();
    return failures;
  }
}
