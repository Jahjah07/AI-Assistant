// node voice-service/tests/voice-commands.mjs <path-to-playwright-index.mjs>
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { loadEnvFile } from 'node:process';
loadEnvFile('.env.local');
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
try {
  const context = await browser.newContext({ permissions: ['microphone'], httpCredentials: {
    username: process.env.JIMMY_AUTH_USERNAME ?? process.env.JOHNNY_AUTH_USERNAME ?? '', password: process.env.JIMMY_AUTH_PASSWORD ?? process.env.JOHNNY_AUTH_PASSWORD ?? '',
  } });
  const page = await context.newPage();
  page.on('pageerror', error => console.error(error.message));
  const requests = [];
  let ollamaCalls = 0;
  await page.addInitScript(() => {
    window.__playing = false;
    window.__micFrames = 0;
    window.Audio = class {
      playbackRate = 1;
      play() { window.__audio = this; window.__playing = true; window.__rate = this.playbackRate; this.onplaying?.(); return Promise.resolve(); }
      pause() { window.__playing = false; this.onpause?.(); }
    };
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class {
      static OPEN = 1;
      static CONNECTING = 0;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState = 1;
      constructor(url, protocols) {
        if (!String(url).includes('mock-voice')) return new NativeWebSocket(url, protocols);
        window.__voiceSocket = this;
        setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'ready', provider: 'moonshine', provider_status: 'ready' }) }), 50);
      }
      send() { window.__micFrames++; }
      close() { this.readyState = 3; }
    };
  });
  await page.route('**/api/voice-ticket', route => route.fulfill({ json: { url: 'ws://localhost/mock-voice' } }));
  await page.route('**/api/tts', async route => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: { defaultVoice: 'am_michael' } });
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) await new Promise(resolve => setTimeout(resolve, 1000));
    return route.fulfill({ contentType: 'audio/wav', body: Buffer.from('mock audio') });
  });
  await page.route('**/api/ollama-chat', async route => {
    ollamaCalls++;
    await new Promise(resolve => setTimeout(resolve, 1500));
    await route.fulfill({ body: 'This late answer must not be spoken.' }).catch(() => {});
  });
  const browserSearches = [];
  await page.route('**/api/local-app', route => {
    browserSearches.push(route.request().postDataJSON());
    return route.fulfill({ json: { action: 'search' } });
  });
  await page.route('**/api/web-facts', () => { throw new Error('Explicit browser searches must not fetch web summaries'); });
  await page.goto(process.env.COMMAND_TEST_URL || 'http://localhost:3000');
  await page.getByRole('button', { name: 'Use mic / wake word', exact: true }).click();
  await page.waitForFunction(() => window.__voiceSocket && window.__micFrames > 0);
  async function typed(text) {
    await page.getByPlaceholder('Type to Jimmy...').fill(text);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
  }
  async function spoken(text) {
    await page.evaluate(value => window.__voiceSocket.onmessage({ data: JSON.stringify({ type: 'final', text: value }) }), text);
  }
  async function speaking() { await page.waitForFunction(() => window.__playing); }
  // Regression: a natural follow-up must not be swallowed by the wake acknowledgement.
  await spoken('Jimmy.');
  await page.getByText('Preparing voice', { exact: true }).waitFor();
  assert.equal(await page.getByText('Speaking', { exact: true }).count(), 0);
  await speaking();
  await page.getByText('Speaking', { exact: true }).waitFor();
  await spoken('Change your voice to George.');
  await page.waitForFunction(() => localStorage.getItem('jimmy.kokoro.voice') === 'bm_george', { timeout: 5000 });
  await typed('What can you do?');
  await speaking();
  const help = requests.at(-1).text;
  assert.ok(help.includes('Stop speaking'));
  const micFrames = await page.evaluate(() => window.__micFrames);
  await page.waitForFunction(count => window.__micFrames > count, micFrames);
  await spoken('Jimmy, speak slower.');
  await page.waitForFunction(() => localStorage.getItem('jimmy.speech.speed') === '0.85' && window.__rate === 0.85);
  await spoken('Stop speaking.');
  await page.waitForFunction(() => !window.__playing);
  const afterStop = requests.length;
  await page.waitForTimeout(300);
  assert.equal(requests.length, afterStop);
  await spoken('Jimmy.');
  await speaking();
  assert.equal(requests.at(-1).text, 'Yes, Sir?');
  await typed('Repeat that.');
  await speaking();
  assert.equal(requests.at(-1).text, help);
  await spoken('Jimmy, change your voice to George.');
  await page.waitForFunction(() => localStorage.getItem('jimmy.kokoro.voice') === 'bm_george');
  await page.waitForTimeout(200);
  assert.equal(requests.at(-1).voice, 'bm_george');
  await typed('Change your voice to Madeup.');
  await page.getByText(/couldn't find an English voice named madeup/).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('jimmy.kokoro.voice')), 'bm_george');
  await typed('Speak at normal speed.');
  await page.waitForFunction(() => window.__rate === 1);
  // Voice and speed acknowledgements intentionally allow a follow-up request.
  // Check that the controls themselves did not invoke Ollama.
  assert.equal(ollamaCalls, 0);
  await spoken('Stop speaking.');
  await page.waitForFunction(() => !window.__playing);
  const beforeCancelledReply = requests.length;
  await typed('Tell me a story.');
  await page.getByText('Jimmy is thinking...', { exact: true }).waitFor();
  await typed('Stop speaking.');
  await page.waitForTimeout(1800);
  assert.equal(requests.length, beforeCancelledReply);
  assert.equal(await page.evaluate(() => window.__playing), false);
  assert.equal(await page.getByText('This late answer must not be spoken.', { exact: true }).count(), 0);
  const beforeWork = browserSearches.length;
  const ollamaBeforeWork = ollamaCalls;
  await typed('time for work');
  await page.getByText('Time for work, Sir. Opened ChatGPT in your browser, Brave, and Visual Studio Code.', { exact: true }).waitFor();
  assert.deepEqual(browserSearches.slice(beforeWork), [
    { action: 'open-link', name: 'ChatGPT' },
    { action: 'open', app: 'brave' },
    { action: 'open', app: 'visual-studio' },
  ]);
  assert.equal(ollamaCalls, ollamaBeforeWork);
  const callsBeforeBrowserSearch = ollamaCalls;
  await typed('Now look up any images of Jarvis from Iron Man');
  await page.getByText('Opened image search for Jarvis from Iron Man in your default browser.', { exact: true }).waitFor();
  assert.deepEqual(browserSearches.at(-1), { action: 'search', query: 'Jarvis from Iron Man', images: true });
  await typed('Look up any images of Jarvis from Ireland');
  await page.getByText('Opened image search for Jarvis from Ireland in your default browser.', { exact: true }).waitFor();
  await speaking();
  await spoken('I mean the Jarvis from Iron Man');
  await page.waitForTimeout(500);
  assert.deepEqual(browserSearches.at(-1), { action: 'search', query: 'Jarvis from Iron Man', images: true });
  await typed('Search the internet for Moonshine AI');
  await page.getByText('Opened search results for Moonshine AI in your default browser.', { exact: true }).waitFor();
  assert.deepEqual(browserSearches.at(-1), { action: 'search', query: 'Moonshine AI', images: false });
  await typed('Open ChatGPT in the browser');
  await page.getByText('Opened ChatGPT in your default browser.', { exact: true }).waitFor();
  assert.deepEqual(browserSearches.at(-1), { action: 'open-link', name: 'ChatGPT' });
  await typed('Open chat GPT');
  await page.getByText('Opened chat GPT in your default browser.', { exact: true }).waitFor();
  assert.deepEqual(browserSearches.at(-1), { action: 'open-link', name: 'chat GPT' });
  const linksBeforeChatToggle = browserSearches.length;
  await typed('Hide chat');
  await page.waitForFunction(() => !document.querySelector('aside'));
  await spoken('Jimmy, show chat');
  await page.getByPlaceholder('Type to Jimmy...').waitFor();
  assert.equal(browserSearches.length, linksBeforeChatToggle);
  await typed('Now please open the CRM');
  await page.getByText('Opened CRM in your default browser.', { exact: true }).waitFor();
  assert.deepEqual(browserSearches.at(-1), { action: 'open-link', name: 'CRM' });
  assert.equal(ollamaCalls, callsBeforeBrowserSearch, 'Browser searches must bypass Ollama');
  await typed('Stop speaking.');
  await page.route('**/api/ollama-chat', route => route.fulfill({ body: 'First sentence. Second sentence. Third sentence.' }));
  const beforePipeline = requests.length;
  await typed('Tell me a short story.');
  await page.waitForFunction(() => window.__playing);
  for (let attempt = 0; attempt < 30 && requests.length < beforePipeline + 2; attempt++) await page.waitForTimeout(100);
  assert.equal(requests.length, beforePipeline + 2, 'Prepare only one sentence ahead during playback');
  assert.equal(requests.at(-1).text, 'Second sentence.');
  await page.waitForTimeout(200);
  assert.equal(await page.getByText('Preparing voice', { exact: true }).count(), 0);
  await page.evaluate(() => { window.__playing = false; window.__audio.onended(); });
  await page.waitForFunction(() => window.__playing);
  for (let attempt = 0; attempt < 30 && requests.length < beforePipeline + 3; attempt++) await page.waitForTimeout(100);
  assert.equal(requests.at(-1).text, 'Third sentence.');
  await typed('Stop speaking.');
  await page.waitForFunction(() => !window.__playing);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__playing), false, 'Stop discards prefetched speech');
  console.log('Passed: direct help, repeat after wake acknowledgment, slower/reset speed, voice change, unknown voice, spoken interruption, microphone capture during playback, no Ollama calls for controls, and cancelling late replies.');
} finally { await browser.close(); }
