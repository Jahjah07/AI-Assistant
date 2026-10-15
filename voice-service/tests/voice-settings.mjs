// Usage: node voice-service/tests/voice-settings.mjs <path-to-playwright-index.mjs>
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { loadEnvFile } from 'node:process';
loadEnvFile('.env.local');
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({
    httpCredentials: {
      username: process.env.JIMMY_AUTH_USERNAME ?? process.env.JOHNNY_AUTH_USERNAME ?? '',
      password: process.env.JIMMY_AUTH_PASSWORD ?? process.env.JOHNNY_AUTH_PASSWORD ?? '',
    },
  });
  const page = await context.newPage();
  await page.goto(process.env.VOICE_TEST_URL || 'http://localhost:3100');
  await page.getByRole('button', { name: 'Voice settings', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  assert.equal(await page.locator('#voice-language option').count(), 2);
  assert.equal(await page.getByRole('radio').count(), 20);
  await dialog.getByRole('combobox').selectOption('b');
  assert.equal(await page.getByRole('radio').count(), 8);
  await page.locator('input[value="bm_george"]').check();
  await page.getByRole('button', { name: 'Use George', exact: true }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem('jimmy.kokoro.voice')), 'bm_george');
  await page.keyboard.press('Escape');
  assert.equal(await dialog.isVisible(), false);
  await page.reload();
  await page.getByRole('button', { name: 'Voice settings', exact: true }).click();
  await dialog.waitFor();
  assert.equal(await page.locator('input[value="bm_george"]').isChecked(), true);
  if (process.env.VERIFY_LIVE_TTS === '1') {
    const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/tts') && response.request().method() === 'POST', { timeout: 45000 });
    await page.getByRole('button', { name: '▶ Preview', exact: true }).click();
    const response = await responsePromise;
    assert.equal(response.status(), 200);
    assert.equal(response.headers()['x-tts-voice'], 'bm_george');
    await page.getByRole('status').filter({ hasText: 'Playing George' }).waitFor();
    await page.getByRole('button', { name: 'Stop preview', exact: true }).click();
    const wav = await context.request.post('http://localhost:3100/api/tts', {
      data: { text: "Hello, I'm Jimmy. How can I help you today?", voice: 'bm_george' },
    });
    assert.equal(wav.status(), 200);
    assert.equal((await wav.body()).subarray(0, 4).toString(), 'RIFF');
    console.log('Live British English preview passed through the Next.js and Kokoro APIs.');
  }
  await page.route('**/api/tts', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    assert.equal(route.request().postDataJSON().voice, 'bm_george');
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Preview test unavailable' }) });
  });
  await page.getByRole('button', { name: '▶ Preview', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Preview test unavailable' }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  const box = await dialog.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390);
  assert.ok(box.y >= 0 && box.y + box.height <= 844);
  await page.screenshot({ path: process.env.TEMP + '/jimmy-voice-settings.png' });
  await page.getByRole('button', { name: 'Close voice settings', exact: true }).click();
  assert.equal(await dialog.isVisible(), false);
  console.log('Passed: language groups, voice selection, saved preference, reload, preview payload/error, Escape, close button, mobile layout.');
} finally {
  await browser.close();
}
