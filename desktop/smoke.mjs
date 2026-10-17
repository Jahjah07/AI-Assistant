// node desktop/smoke.mjs <path-to-playwright-index.mjs>
// Uses fake microphone/audio and service responses; no real shutdown or model unload.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { loadEnvFile } from 'node:process';
loadEnvFile('.env.local');
const { _electron } = await import(pathToFileURL(process.argv[2]).href);
const next = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3003'], { windowsHide: true, stdio: 'ignore' });
let electron;
try {
  let ready = false;
  for (let i = 0; i < 40; i++) {
    assert.equal(next.exitCode, null, 'Test server exited or port 3003 is occupied');
    try { const response = await fetch('http://127.0.0.1:3003'); if (response.status === 401) { ready = true; break; } } catch {}
    await delay(500);
  }
  assert.ok(ready, 'Test server must be ready');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  electron = await _electron.launch({ executablePath: path.resolve('node_modules/electron/dist/electron.exe'), args: ['desktop/main.mjs', '--desktop-test'], env });
  console.log("Electron started");
  const page = await electron.firstWindow();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/codex', route => route.fulfill({ json: { signedIn: false, pending: false } }));
  await page.route('**/api/voice-ticket', route => route.fulfill({ json: { url: 'ws://localhost/mock-voice' } }));
  let ttsCalls = 0;
  let ollamaCalls = 0;
  await page.route('**/api/tts', route => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: { defaultVoice: 'am_michael' } });
    ttsCalls++;
    return route.fulfill({ contentType: 'audio/wav', body: Buffer.from('fake') });
  });
  await page.route('**/api/ollama-chat', route => { ollamaCalls++; return route.fulfill({ body: 'Hello.' }); });
  await page.addInitScript(() => {
    window.Audio = class {
      play() { this.onplaying?.(); setTimeout(() => this.onended?.(), 100); return Promise.resolve(); }
      pause() { this.onpause?.(); }
    };
    window.WebSocket = class {
      static OPEN = 1;
      readyState = 1;
      constructor() {
        window.__socket = this;
        setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'ready', provider: 'moonshine', provider_status: 'ready' }) }), 20);
      }
      send() {}
      close() { this.readyState = 3; }
    };
  });
  await page.waitForURL('http://127.0.0.1:3003/');
  await page.reload();
  await page.getByRole('button', { name: 'Wake-word mic on', exact: true }).waitFor();
  await page.waitForFunction(() => window.__socket && document.documentElement.dataset.jimmyDesktop === 'compact');
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await page.evaluate(() => typeof window.process), 'undefined');
  const spoken = text => page.evaluate(value => window.__socket.onmessage({ data: JSON.stringify({ type: 'final', text: value }) }), text);
  await spoken('Background tutorial talking about JavaScript.');
  await delay(150);
  assert.equal(ttsCalls, 0, 'No speech output before wake');
  assert.equal(ollamaCalls, 0, 'No LLM request before wake');
  await spoken('Jimmy, you there?');
  await page.waitForFunction(async () => (await window.jimmyDesktop.getState()).awake);
  await delay(300);
  assert.equal(ttsCalls, 1, 'Wake receives a local acknowledgement');
  assert.equal(ollamaCalls, 0, 'Greeting does not use Ollama');
  await page.getByRole('button', { name: 'Open Jimmy chat', exact: true }).first().click();
  await page.waitForFunction(() => document.documentElement.dataset.jimmyDesktop === 'expanded');
  const fullSize = await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize());
  assert.ok(fullSize[0] > 500);
  await page.getByRole('button', { name: 'Mute microphone', exact: true }).click();
  await page.waitForFunction(async () => (await window.jimmyDesktop.getState()).muted);
  await spoken('Jimmy, tell me a story.');
  await delay(150);
  assert.equal(ollamaCalls, 0, 'Muted microphone transcripts are ignored');
  await page.getByRole('button', { name: 'Unmute microphone', exact: true }).click();
  await page.getByRole('button', { name: 'Collapse Jimmy', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.jimmyDesktop === 'compact');
  await page.screenshot({ path: '.jimmy-runtime/desktop-compact.png', omitBackground: true });
  assert.deepEqual(errors, [], 'Renderer has no uncaught errors');
  const musicQueries = [];
  const openedUrls = [];
  await page.route('**/api/youtube-resolve', route => {
    musicQueries.push(route.request().postDataJSON());
    return route.fulfill({ json: { videoId: 'abcdefghijk', videoIds: ['abcdefghijk'], url: 'https://www.youtube.com/watch?v=abcdefghijk&autoplay=1' } });
  });
  await page.route('**/api/local-app', route => {
    openedUrls.push(route.request().postDataJSON());
    return route.fulfill({ json: { action: 'open-youtube' } });
  });
  await spoken('Jimmy, play some classical music.');
  for (let i = 0; i < 30 && openedUrls.length < 1; i++) await delay(100);
  assert.deepEqual(musicQueries[0], { query: 'classical music', random: true });
  assert.equal(openedUrls[0].action, 'open-youtube');
  assert.equal(await page.locator('iframe').count(), 0, 'Desktop music must not create an embedded player');
  await spoken('Jimmy, play some music.');
  for (let i = 0; i < 30 && openedUrls.length < 2; i++) await delay(100);
  assert.equal(musicQueries[1].random, true);
  assert.notEqual(musicQueries[1].query, 'some');
  const exited = once(electron.process(), 'exit');
  await spoken('Jimmy, shut down.').catch(() => {});
  await Promise.race([exited, delay(15000).then(() => { throw new Error('Shutdown did not exit Electron'); })]);
  electron = null;
  console.log('Passed: floating window, isolated renderer, wake greeting, expand/collapse, mute, and spoken shutdown.');
} finally {
  if (electron) await electron.close().catch(() => {});
  next.kill();
}
