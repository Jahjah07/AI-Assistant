// node desktop/screen-smoke.mjs <path-to-playwright-index.mjs>
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
loadEnvFile('.env.local');
const { _electron } = await import(pathToFileURL(process.argv[2]).href);
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3003'], { windowsHide: true, stdio: 'ignore' });
let electron;
try {
  let ready = false;
  for (let i = 0; i < 40; i++) {
    assert.equal(server.exitCode, null);
    try { if ((await fetch('http://127.0.0.1:3003')).status === 401) { ready = true; break; } } catch {}
    await delay(500);
  }
  assert.ok(ready);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  electron = await _electron.launch({ executablePath: path.resolve('node_modules/electron/dist/electron.exe'), args: ['desktop/main.mjs', '--desktop-test'], env });
  const page = await electron.firstWindow();
  await page.waitForURL('http://127.0.0.1:3003/');
  await electron.evaluate(({ desktopCapturer, nativeImage, screen, BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].hide();
    globalThis.__captureCount = 0;
    desktopCapturer.getSources = async options => {
      globalThis.__captureCount++;
      if (options.types.join(',') !== 'screen') throw new Error('Unexpected capture type');
      const display = screen.getDisplayMatching(BrowserWindow.getAllWindows()[0].getBounds());
      // Use a fixture, never the user's real screen, in the automated test.
      return [{ display_id: String(display.id), thumbnail: nativeImage.createFromBitmap(Buffer.alloc(16 * 16 * 4, 255), { width: 16, height: 16 }) }];
    };
  });
  await page.route('**/api/codex', route => route.fulfill({ json: { signedIn: false, pending: false } }));
  await page.route('**/api/tts', route => route.fulfill({ status: 503, json: { error: 'No audio in this test' } }));
  let imageReceived = false;
  await page.route('**/api/screen', route => {
    const body = route.request().postDataJSON(); assert.ok(body.image.startsWith('/9j/'));
    imageReceived = true;
    return route.fulfill({ json: { answer: 'A desktop snapshot was analysed.', model: 'qwen3-vl:2b' } });
  });
  assert.equal(await electron.evaluate(() => globalThis.__captureCount), 0);
  await page.evaluate(async () => { await window.jimmyDesktop.expand(true); });
  await page.getByPlaceholder('Type to Jimmy...').fill('Can you see my screen?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByText('A desktop snapshot was analysed.', { exact: true }).waitFor();
  assert.ok(imageReceived);
  assert.equal(await electron.evaluate(() => globalThis.__captureCount), 1);
  await page.addInitScript(() => {
    const NativeSocket = window.WebSocket;
    window.WebSocket = class {
      static OPEN = 1; readyState = 1;
      constructor(url) {
        if (!url.includes('/mock-voice')) return new NativeSocket(url);
        window.__voiceSocket = this;
        setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'ready' }) }), 20);
      }
      send() {} close() { this.readyState = 3; }
    };
  });
  await page.route('**/api/voice-ticket', route => route.fulfill({ json: { url: 'ws://localhost/mock-voice' } }));
  await page.reload();
  await page.waitForFunction(() => !document.querySelector('.reactor-clock')?.textContent.includes('--'));
  await page.getByRole('button', { name: 'Wake-word mic on', exact: true }).waitFor();
  await page.waitForFunction(() => window.__voiceSocket?.onmessage);
  const command = text => page.evaluate(text => window.__voiceSocket.onmessage({ data: JSON.stringify({ type: 'final', text }) }), text);
  await command('Jimmy, compact mode');
  await page.waitForFunction(() => document.documentElement.dataset.jimmyDesktop === 'compact');
  await command('Jimmy, fullscreen');
  await page.waitForFunction(() => document.documentElement.dataset.jimmyDesktop === 'expanded');
  const centred = await electron.evaluate(({ BrowserWindow, screen }) => {
    const bounds = BrowserWindow.getAllWindows()[0].getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    return Math.abs(bounds.x - area.x) <= 1 && Math.abs(bounds.y - area.y) <= 1 &&
      Math.abs(bounds.width - area.width) <= 1 && Math.abs(bounds.height - area.height) <= 1;
  });
  assert.ok(centred, 'Full dashboard must fit the monitor work area');
  await page.getByPlaceholder('Type to Jimmy...').waitFor();
  await electron.evaluate(({ screen }) => {
    const original = screen.getDisplayMatching;
    globalThis.__restoreDisplay = () => { screen.getDisplayMatching = original; };
    screen.getDisplayMatching = bounds => ({ ...original(bounds), workArea: { x: 0, y: 0, width: 1024, height: 576 }, scaleFactor: 1.5 });
    screen.emit('display-metrics-changed', {}, ['workArea', 'scaleFactor']);
  });
  await page.waitForFunction(() => window.innerWidth === 1024 && window.innerHeight === 576);
  const panel = await page.locator('#jimmy-chat').boundingBox();
  const controls = await page.locator('.jimmy-controls').boundingBox();
  const reactor = await page.locator('.reactor-stage').boundingBox();
  assert.ok(panel.x >= 0 && panel.x + panel.width <= 1024 && panel.y + panel.height <= 576);
  assert.ok(controls.y >= 0 && controls.y + controls.height <= 576);
  assert.ok(panel.y + panel.height <= controls.y, 'Chat must clear the controls on scaled laptop screens');
  assert.ok(reactor.width <= 316, 'Reactor scales to available screen height');
  await electron.evaluate(() => globalThis.__restoreDisplay());
  console.log('Passed: monitor scaling changes refit the dashboard and keep panels inside a 1024 × 576 laptop work area.');
  console.log('Passed: spoken compact and fullscreen commands resize the desktop and restore chat.');
  console.log('Passed: desktop preload IPC, capture only on command, monitor selection, JPEG snapshot, local vision request and chat reply.');
} finally {
  if (electron) await electron.close();
  if (server.exitCode === null) { server.kill(); await once(server, 'exit'); }
}
