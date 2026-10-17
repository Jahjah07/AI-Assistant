// Full integration check. Starts/stops Jimmy containers and unloads its model.
// node desktop/live-smoke.mjs <path-to-playwright-index.mjs>
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
const { _electron } = await import(pathToFileURL(process.argv[2]).href);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const electron = await _electron.launch({ executablePath: path.resolve('node_modules/electron/dist/electron.exe'),
  args: ['desktop/main.mjs', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'], env });
try {
  const page = await electron.firstWindow();
  console.log('Starting real desktop services with a simulated microphone…');
  await page.waitForURL('http://127.0.0.1:3002/', { timeout: 300000 });
  await page.waitForFunction(() => document.documentElement.dataset.jimmyDesktop === 'compact');
  await page.getByRole('button', { name: 'Wake-word mic on', exact: true }).waitFor();
  const before = await fetch('http://127.0.0.1:8766/health').then(r => r.json());
  assert.equal(before.status.state, 'not_loaded', 'Kokoro remains unloaded before first wake');
  console.log('Cold startup ready: recognition active, Kokoro not loaded.');
  const started = Date.now();
  await page.evaluate(() => window.jimmyDesktop.wake());
  const after = await fetch('http://127.0.0.1:8766/health').then(r => r.json());
  assert.equal(after.status.state, 'ready');
  console.log(`First wake loaded Kokoro and Ollama in ${((Date.now() - started) / 1000).toFixed(1)} seconds.`);
  const tts = await page.evaluate(async () => {
    const response = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Yes, Sir?' }) });
    return { status: response.status, bytes: (await response.arrayBuffer()).byteLength };
  });
  assert.equal(tts.status, 200);
  assert.ok(tts.bytes > 44);
  const second = Date.now();
  await page.evaluate(() => window.jimmyDesktop.wake());
  assert.ok(Date.now() - second < 2000, 'Second wake should reuse loaded models');
  const exited = once(electron.process(), 'exit');
  await page.evaluate(() => window.jimmyDesktop.shutdown()).catch(() => {});
  await Promise.race([exited, delay(90000).then(() => { throw new Error('Shutdown timed out'); })]);
  for (const port of [3002, 8765, 8766]) {
    let reachable = false;
    try { await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) }); reachable = true; } catch {}
    assert.equal(reachable, false, `Jimmy service on ${port} should have stopped`);
  }
  console.log('Passed: real cold start, first wake, warm reuse, TTS output, and all Jimmy service ports closed after shutdown.');
} finally { await electron.close().catch(() => {}); }
