// node tests/audio-devices.mjs <path-to-playwright-index.mjs>
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvFile } from 'node:process';
import { spawn } from 'node:child_process';
loadEnvFile('.env.local');
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const base = process.env.VOICE_TEST_URL || 'http://localhost:3107';
const server = process.env.VOICE_TEST_URL ? null : spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--port', '3107'], { windowsHide: true, stdio: 'ignore' });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { ready = (await fetch(base, { headers: { authorization: 'Basic ' + Buffer.from((process.env.JIMMY_AUTH_USERNAME || process.env.JOHNNY_AUTH_USERNAME || '') + ':' + (process.env.JIMMY_AUTH_PASSWORD || process.env.JOHNNY_AUTH_PASSWORD || '')).toString('base64') }, signal: AbortSignal.timeout(2000) })).ok; } catch {}
    if (ready) break; await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, 'Audio test server is ready');
  const context = await browser.newContext({ permissions: ['microphone'], httpCredentials: {
    username: process.env.JIMMY_AUTH_USERNAME || process.env.JOHNNY_AUTH_USERNAME || '', password: process.env.JIMMY_AUTH_PASSWORD || process.env.JOHNNY_AUTH_PASSWORD || '',
  } });
  await context.addInitScript(() => {
    window.__streams = []; window.__inputs = []; window.__outputs = []; window.__played = [];
    window.__devices = [
      { kind: 'audioinput', deviceId: 'mic-a', label: 'USB microphone' },
      { kind: 'audioinput', deviceId: 'mic-b', label: 'Headset microphone' },
      { kind: 'audioinput', deviceId: 'denied', label: 'Denied microphone' },
      { kind: 'audiooutput', deviceId: 'speaker-a', label: 'Headphones' },
      { kind: 'audiooutput', deviceId: 'laptop', label: 'Speakers (Realtek Audio)' },
      { kind: 'audiooutput', deviceId: 'default', label: 'Default - Headphones' },
      { kind: 'audiooutput', deviceId: 'denied', label: 'Denied speaker' },
    ];
    navigator.mediaDevices.enumerateDevices = async () => [...window.__devices];
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async options => {
      const id = options.audio?.deviceId?.exact || '';
      window.__inputs.push(id);
      if (id === 'denied') throw new DOMException('Microphone permission denied', 'NotAllowedError');
      const stream = await capture({ audio: true });
      window.__streams.push(stream);
      return stream;
    };
    HTMLMediaElement.prototype.setSinkId = async function (id) {
      if (id === 'denied') throw new DOMException('Speaker permission denied', 'NotAllowedError');
      if (id && !window.__devices.some(device => device.deviceId === id)) throw new DOMException('Speaker disconnected', 'NotFoundError');
      this.__sink = id;
      window.__outputs.push(id);
    };
    const NativeAudio = window.Audio;
    window.Audio = class extends NativeAudio {
      play() { window.__played.push({ sink: this.__sink, volume: this.volume }); this.onplaying?.(); setTimeout(() => this.onended?.(), 60); return Promise.resolve(); }
      pause() { this.onpause?.(); }
    };
    window.__music = new Audio(); window.__music.setSinkId('speaker-a'); window.__music.volume = 0.8;
    const NativeSocket = window.WebSocket;
    window.WebSocket = class {
      static OPEN = 1; readyState = 1;
      constructor(url) { if (!url.includes('/mock')) return new NativeSocket(url); setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'ready' }) }), 20); }
      send() {} close() { this.readyState = 3; }
    };
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const settingsCalls = [];
  await page.route('**/api/local-app', route => { settingsCalls.push(route.request().postDataJSON()); return route.fulfill({ json: { action: 'audio-settings' } }); });
  await page.route('**/api/codex', route => route.fulfill({ json: { signedIn: false, pending: false } }));
  await page.route('**/api/voice-ticket', route => route.fulfill({ json: { url: 'ws://localhost/mock' } }));
  await page.route('**/api/tts', route => route.fulfill(route.request().method() === 'GET' ? { json: { defaultVoice: 'am_michael' } } : { contentType: 'audio/wav', body: Buffer.from('fake') }));
  await page.route('**/api/ollama-chat', route => route.fulfill({ body: 'Hello Sir. Here is another sentence.', headers: { 'X-Chat-Brain': 'qwen' } }));
  await page.goto(base);
  await page.waitForFunction(() => !document.querySelector('.reactor-clock')?.textContent.includes('--'));
  assert.equal(await page.evaluate(() => window.__streams.length), 0, 'No microphone request on page load');
  await page.getByRole('button', { name: 'Use mic / wake word', exact: true }).click();
  await page.waitForFunction(() => window.__streams.length === 1);
  await page.getByRole('button', { name: 'Voice settings', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Audio devices', exact: true }).click();
  await page.getByLabel('Microphone', { exact: true }).selectOption('mic-b');
  await page.getByRole('status').filter({ hasText: 'Microphone updated' }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__streams.map(s => s.getAudioTracks()[0].readyState)), ['ended', 'live']);
  assert.equal(await page.evaluate(() => localStorage.getItem('jimmy.audio.input')), 'mic-b');
  await page.getByLabel('Microphone', { exact: true }).selectOption('denied');
  await page.getByRole('status').filter({ hasText: 'Microphone permission denied' }).waitFor();
  assert.equal(await page.getByLabel('Microphone', { exact: true }).inputValue(), 'mic-b');
  assert.equal(await page.evaluate(() => window.__streams.at(-1).getAudioTracks()[0].readyState), 'live');
  await page.getByLabel('Jimmy voice output', { exact: true }).selectOption('speaker-a');
  await page.getByRole('status').filter({ hasText: 'Voice output updated' }).waitFor();
  await page.getByLabel('Jimmy voice output', { exact: true }).selectOption('denied');
  await page.getByRole('status').filter({ hasText: 'Speaker permission denied' }).waitFor();
  assert.equal(await page.getByLabel('Jimmy voice output', { exact: true }).inputValue(), 'speaker-a');
  await page.getByRole('button', { name: 'Use laptop speakers', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Voice output updated' }).waitFor();
  assert.equal(await page.getByLabel('Jimmy voice output', { exact: true }).inputValue(), 'laptop');
  await page.getByRole('slider', { name: 'Jimmy voice volume', exact: true }).evaluate(element => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, '30');
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => localStorage.getItem('jimmy.audio.voice-volume') === '0.3');
  assert.deepEqual(await page.evaluate(() => ({ sink: window.__music.__sink, volume: window.__music.volume })), { sink: 'speaker-a', volume: 0.8 });
  await page.getByRole('button', { name: 'Pair / connect Bluetooth device', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Windows Bluetooth settings opened' }).waitFor();
  await page.getByRole('button', { name: 'Open Windows volume mixer', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Windows volume mixer opened' }).waitFor();
  assert.deepEqual(settingsCalls.map(call => call.page), ['bluetooth', 'mixer']);
  await page.evaluate(() => {
    window.__devices.push({ kind: 'audioinput', deviceId: 'new-mic', label: 'New microphone' });
    navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
  });
  await page.locator('#audio-input option[value="new-mic"]').waitFor({ state: 'attached' });
  await page.setViewportSize({ width: 390, height: 844 });
  const box = await dialog.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 844);
  await page.screenshot({ path: join(tmpdir(), 'jimmy-settings-mobile.png') });
  await dialog.getByRole('button', { name: 'Voice', exact: true }).click();
  await page.getByRole('button', { name: '▶ Preview', exact: true }).click();
  await page.waitForFunction(() => window.__played.some(item => item.sink === 'laptop' && item.volume === 0.3));
  await dialog.getByRole('button', { name: 'General', exact: true }).click();
  await page.getByLabel('Personality', { exact: true }).fill('Keep replies brief.');
  await page.getByRole('button', { name: 'Save personality', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Personality saved' }).waitFor();
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1100, height: 850 });
  const previousRoutes = await page.evaluate(() => window.__outputs.length);
  await page.getByPlaceholder('Type to Jimmy...').fill('Tell me about the moon');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.waitForFunction(count => window.__outputs.length > count && window.__outputs.at(-1) === 'laptop', previousRoutes);
  await page.getByPlaceholder('Type to Jimmy...').fill('Set your voice volume to 25 percent');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.waitForFunction(() => localStorage.getItem('jimmy.audio.voice-volume') === '0.25');
  assert.deepEqual(await page.evaluate(() => ({ sink: window.__music.__sink, volume: window.__music.volume })), { sink: 'speaker-a', volume: 0.8 });
  await page.waitForFunction(() => window.__played.at(-1)?.volume === 0.25);
  await page.evaluate(() => { window.__devices = window.__devices.filter(device => device.deviceId !== 'laptop'); });
  const beforeDisconnected = await page.evaluate(() => window.__outputs.length);
  await page.getByPlaceholder('Type to Jimmy...').fill('Tell me about the moon');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByText(/selected voice speaker is unavailable or blocked/).waitFor();
  assert.ok(!(await page.evaluate(count => window.__outputs.slice(count), beforeDisconnected)).includes(''), 'Disconnected pinned voice output never falls back to system-default music output');
  assert.equal(await page.evaluate(() => localStorage.getItem('jimmy.audio.output')), 'laptop');
  await page.reload();
  await page.waitForFunction(() => !document.querySelector('.reactor-clock')?.textContent.includes('--'));
  await page.getByRole('button', { name: 'Use mic / wake word', exact: true }).click();
  await page.waitForFunction(() => window.__inputs.includes('mic-b'));
  await page.getByRole('button', { name: 'Voice settings', exact: true }).click();
  await dialog.getByRole('button', { name: 'Audio devices', exact: true }).click();
  assert.equal(await page.getByLabel('Jimmy voice output', { exact: true }).inputValue(), 'laptop');
  assert.equal(await page.getByRole('slider', { name: 'Jimmy voice volume', exact: true }).inputValue(), '25');
  await page.getByLabel('Jimmy voice output', { exact: true }).selectOption('');
  await page.getByRole('status').filter({ hasText: 'Voice output updated' }).waitFor();
  await page.getByLabel('Microphone', { exact: true }).selectOption('');
  await page.getByRole('status').filter({ hasText: 'Microphone updated' }).waitFor();
  await page.setViewportSize({ width: 1100, height: 850 });
  await page.screenshot({ path: join(tmpdir(), 'jimmy-settings-desktop.png') });
  await dialog.getByRole('button', { name: 'General', exact: true }).click();
  await page.evaluate(() => { delete HTMLMediaElement.prototype.setSinkId; });
  await dialog.getByRole('button', { name: 'Audio devices', exact: true }).click();
  assert.equal(await page.getByLabel('Jimmy voice output', { exact: true }).isDisabled(), true);
  await page.getByText('This browser uses the system default speaker.', { exact: false }).waitFor();
  assert.deepEqual(errors, []);
  console.log('Passed: sidebar, live microphone replacement, denied switches preserve devices, speaker routing and previews, persistence, defaults, device refresh, general settings, mobile layout.');
} finally { await browser.close(); server?.kill(); }
