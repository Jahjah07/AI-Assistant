import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const originalFetch = globalThis.fetch;
const originalDirectory = process.cwd();
const temporary = await mkdtemp(path.join(tmpdir(), 'jimmy-resources-'));
try {
  for (const source of ['app/api/_security', 'app/api/resources/route', 'app/api/model-settings/settings']) {
    const code = await readFile(`${source}.ts`, 'utf8');
    const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from "(\.[^"]+)"/g, 'from "$1.mjs"');
    await mkdir(path.dirname(path.join(temporary, source)), { recursive: true });
    await writeFile(path.join(temporary, `${source}.mjs`), output);
  }
  process.env.JIMMY_AUTH_USERNAME = 'test'; process.env.JIMMY_AUTH_PASSWORD = 'test-password'; process.env.JIMMY_ALLOWED_HOSTS = 'localhost';
  process.env.OLLAMA_MODEL = 'chat'; process.env.OLLAMA_VISION_MODEL = 'vision:v2';
  process.env.TTS_SERVICE_URL = 'http://127.0.0.1:8766';
  process.env.VOICE_SERVICE_PUBLIC_WS_URL = 'ws://127.0.0.1:8765/ws/voice';
  process.env.COMFYUI_URL = 'http://127.0.0.1:8188';
  let ttsState = 'ready';
  let disconnected = false;
  let installed = [{ name: 'chat:latest' }, { model: 'vision:v2' }];
  let running = [{ name: 'chat:latest' }];
  const urls = [];
  globalThis.fetch = async url => {
    urls.push(String(url));
    if (disconnected) throw new Error('Backend stopped');
    const target = new URL(url);
    if (target.pathname === '/api/tags') return Response.json({ models: installed });
    if (target.pathname === '/api/ps') return Response.json({ models: running });
    if (target.pathname === '/system_stats') return Response.json({ system: {}, devices: [] });
    return Response.json(target.port === '8766' ? { ok: true, configured_tts: 'kokoro', status: { state: ttsState } } : { ok: true, vad: 'silero-onnx-cpu', configured_asr: 'moonshine', asr_status: { state: ttsState } });
  };
  process.chdir(temporary);
  const { GET } = await import(pathToFileURL(path.join(temporary, 'app/api/resources/route.mjs')));
  const request = auth => new Request('http://localhost/api/resources', { headers: { host: 'localhost', ...(auth ? { authorization: `Basic ${Buffer.from('test:test-password').toString('base64')}` } : {}) } });
  assert.equal((await GET(request(false))).status, 401);
  const [first, second] = await Promise.all([GET(request(true)), GET(request(true))]);
  const sample = await first.json();
  assert.equal(first.status, 200);
  assert.deepEqual(sample.backends, {
    kokoro: 'Online', silero: 'Online', moonshine: 'Online', ollama: 'Online', comfyui: 'Online',
    chat: { name: 'chat', status: 'Online' }, vision: { name: 'vision:v2', status: 'Standby' },
  });
  assert.equal(first.headers.get('cache-control'), 'no-store');
  assert.deepEqual(sample, await second.json(), 'Concurrent requests share one sample');
  assert.ok(sample.cpuPercent === null || sample.cpuPercent >= 0 && sample.cpuPercent <= 100);
  assert.ok(sample.ram.usedGB >= 0 && sample.ram.usedGB <= sample.ram.totalGB);
  assert.ok(sample.ram.percent >= 0 && sample.ram.percent <= 100);
  if (sample.gpu) {
    assert.ok(sample.gpu.name && sample.gpu.percent >= 0 && sample.gpu.percent <= 100);
    assert.ok(sample.gpu.usedGB >= 0 && sample.gpu.totalGB > 0);
  }
  assert.deepEqual(await (await GET(request(true))).json(), sample, 'Polling reuses the five-second cache');
  for (const [state, expected] of [['loading', 'Loading'], ['not_loaded', 'Standby'], ['failed', 'Offline']]) {
    ttsState = state;
    const variant = await import(pathToFileURL(path.join(temporary, 'app/api/resources/route.mjs')).href + '?state=' + state);
    const backends = (await (await variant.GET(request(true))).json()).backends;
    assert.equal(backends.kokoro, expected);
    assert.equal(backends.moonshine, expected);
  }
  installed = []; running = [];
  const missing = await import(pathToFileURL(path.join(temporary, 'app/api/resources/route.mjs')).href + '?missing');
  assert.equal((await (await missing.GET(request(true))).json()).backends.chat.status, 'Missing');
  installed = [{ name: 'chat:latest' }]; running = null;
  const unknown = await import(pathToFileURL(path.join(temporary, 'app/api/resources/route.mjs')).href + '?unknown');
  assert.equal((await (await unknown.GET(request(true))).json()).backends.chat.status, 'Unavailable');
  disconnected = true;
  const offline = await import(pathToFileURL(path.join(temporary, 'app/api/resources/route.mjs')).href + '?offline');
  assert.deepEqual((await (await offline.GET(request(true))).json()).backends, {
    kokoro: 'Offline', silero: 'Offline', moonshine: 'Offline', ollama: 'Offline', comfyui: 'Offline',
    chat: { name: 'chat', status: 'Offline' }, vision: { name: 'vision:v2', status: 'Offline' },
  });
  assert.ok(urls.every(url => ['/health', '/api/tags', '/api/ps', '/system_stats'].includes(new URL(url).pathname)), 'Status checks must never warm models or capture audio');
  console.log('Passed: authenticated telemetry, polling cache, speech states, loaded/standby/missing models, unavailable services, read-only checks.');
} finally { globalThis.fetch = originalFetch; process.chdir(originalDirectory); await rm(temporary, { recursive: true, force: true }); }
