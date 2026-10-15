// node tests/screen-browser.mjs <path-to-playwright-index.mjs>
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { loadEnvFile } from 'node:process';
loadEnvFile('.env.local');
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ httpCredentials: {
    username: process.env.JIMMY_AUTH_USERNAME || process.env.JOHNNY_AUTH_USERNAME || '',
    password: process.env.JIMMY_AUTH_PASSWORD || process.env.JOHNNY_AUTH_PASSWORD || '',
  } });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__captures = 0; window.__stopped = 0; window.__cancelCapture = false;
    navigator.mediaDevices.getDisplayMedia = async () => {
      window.__captures++;
      if (window.__cancelCapture) throw new DOMException('Screen sharing cancelled', 'NotAllowedError');
      const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 450;
      const paint = () => {
        const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, 800, 450);
        context.fillStyle = '#000'; context.font = '30px sans-serif'; context.fillText('Task: Fix the login bug', 40, 100);
      };
      paint(); const stream = canvas.captureStream(10);
      const interval = setInterval(paint, 100);
      const track = stream.getVideoTracks()[0]; const stop = track.stop.bind(track);
      track.stop = () => { window.__stopped++; clearInterval(interval); stop(); };
      return stream;
    };
    const NativeAudio = window.Audio;
    window.Audio = class extends NativeAudio { play() { this.onplaying?.(); setTimeout(() => this.onended?.(), 10); return Promise.resolve(); } pause() { this.onpause?.(); } };
  });
  await page.route('**/api/codex', route => route.fulfill({ json: { signedIn: false, pending: false } }));
  await page.route('**/api/tts', route => route.fulfill({ contentType: 'audio/wav', body: Buffer.from('fake') }));
  let screenCalls = 0;
  await page.route('**/api/screen', route => {
    screenCalls++; const data = route.request().postDataJSON();
    assert.ok(data.image.startsWith('/9j/')); assert.ok(data.question);
    return route.fulfill({ json: { answer: 'You are working on a login bug.', model: 'qwen3-vl:2b' } });
  });
  await page.goto(process.env.VOICE_TEST_URL || 'http://localhost:3100');
  await page.waitForFunction(() => !document.querySelector('.reactor-clock')?.textContent.includes('--'));
  assert.equal(await page.evaluate(() => window.__captures), 0);
  await page.getByPlaceholder('Type to Jimmy...').fill('Can you see my screen?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByText('Click Share screen and choose a screen or window so I can look at one snapshot.', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__captures), 0, 'Voice/text request waits for a browser share gesture');
  await page.getByRole('button', { name: 'Share screen', exact: true }).click();
  await page.getByText('You are working on a login bug.', { exact: true }).waitFor();
  assert.equal(screenCalls, 1); assert.equal(await page.evaluate(() => window.__stopped), 1);
  await page.evaluate(() => { window.__cancelCapture = true; });
  await page.getByRole('button', { name: 'Share screen', exact: true }).click();
  await page.getByText('Screen sharing cancelled', { exact: true }).waitFor();
  assert.equal(screenCalls, 1, 'Cancelled sharing sends no image');
  assert.deepEqual(errors, []);
  console.log('Passed: no automatic capture, screen command, user share gesture, one-frame capture, capture stopped, local reply, cancellation.');

  if (process.env.VERIFY_LIVE_VISION === '1') {
    const fixture = await context.newPage();
    await fixture.setContent('<html><body style="font:32px Arial;background:white;color:black;padding:30px"><h1>Project tasks</h1><p>Current task: Fix the login bug.</p><p>Status: In progress</p></body></html>');
    const image = (await fixture.screenshot()).toString('base64');
    const response = await context.request.post((process.env.VOICE_TEST_URL || 'http://localhost:3100') + '/api/screen', { data: { image, question: 'What task is visible in this screenshot?' }, timeout: 200000 });
    const result = await response.json();
    assert.equal(response.status(), 200, JSON.stringify(result));
    assert.match(result.answer, /login/i);
    console.log('Live local vision correctly identified the login task from the synthetic screenshot.');
  }
} finally { await browser.close(); }
