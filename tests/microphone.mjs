// node tests/microphone.mjs <path-to-playwright-index.mjs>
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3104'], {
  windowsHide: true, stdio: 'ignore', env: { ...process.env, JIMMY_AUTH_USERNAME: 'test', JIMMY_AUTH_PASSWORD: 'test-password', JIMMY_ALLOWED_HOSTS: '127.0.0.1' },
});
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    assert.equal(server.exitCode, null, 'Test server exited');
    try { if ((await fetch('http://127.0.0.1:3104')).status === 401) { ready = true; break; } } catch {}
    await delay(250);
  }
  assert.ok(ready);
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ permissions: ['microphone'], httpCredentials: { username: 'test', password: 'test-password' } });
  const page = await context.newPage();
  const errors = [];
  const chats = [];
  let signedIn = false;
  let loginPending = false;
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async options => {
      window.__micRequests = (window.__micRequests || 0) + 1;
      const stream = await getUserMedia(options);
      window.__track = stream.getAudioTracks()[0];
      return stream;
    };
    window.Audio = class { play() { this.onplaying?.(); setTimeout(() => this.onended?.(), 50); return Promise.resolve(); } pause() { this.onpause?.(); } };
    window.WebSocket = class {
      static OPEN = 1;
      readyState = 1;
      constructor() { window.__socket = this; setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'ready' }) }), 20); }
      send() {}
      close() { this.readyState = 3; }
    };
  });
  await page.route('**/api/voice-ticket', route => route.fulfill({ json: { url: 'ws://localhost/mock' } }));
  await page.route('**/api/codex', route => {
    if (route.request().method() === 'POST') {
      if (route.request().postDataJSON().action === 'login') {
        loginPending = true;
        return route.fulfill({ json: { authUrl: 'https://auth.openai.com/oauth/authorize?mock=1' } });
      }
      signedIn = false;
      loginPending = false;
    }
    return route.fulfill({ json: { signedIn, pending: loginPending, ...(loginPending ? { authUrl: 'https://auth.openai.com/oauth/authorize?mock=1' } : {}) } });
  });
  await page.route('**/api/tts', route => route.fulfill({ contentType: 'audio/wav', body: Buffer.from('fake') }));
  await page.route('**/api/ollama-chat', route => {
    const body = route.request().postDataJSON();
    chats.push(body);
    return route.fulfill({ body: 'Hello Sir.', headers: { 'X-Chat-Brain': body.brain === 'codex' ? 'codex' : 'qwen' } });
  });
  await page.goto('http://127.0.0.1:3104');
  await delay(250);
  assert.equal(await page.evaluate(() => window.__micRequests || 0), 0, 'No mic permission request on load');
  const hold = page.getByRole('button', { name: 'Hold to talk', exact: true });
  await hold.hover();
  await page.mouse.down();
  await page.waitForFunction(() => window.__track?.enabled === true);
  await page.getByText('Listening… release to send', { exact: true }).waitFor();
  await page.mouse.up();
  assert.equal(await page.evaluate(() => window.__track.enabled), false, 'Release disables capture');
  await page.evaluate(() => window.__socket.onmessage({ data: JSON.stringify({ type: 'speech_start' }) }));
  const final = text => page.evaluate(value => window.__socket.onmessage({ data: JSON.stringify({ type: 'final', text: value }) }), text);
  await final('Explain local databases');
  await page.waitForFunction(() => document.body.textContent.includes('Hello Sir.'));
  assert.equal(chats.length, 1, 'Push-to-talk works without wake word');
  assert.equal(chats[0].brain, 'auto');
  await page.getByText('Last reply: Qwen', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Voice settings', exact: true }).click();
  await page.getByRole('button', { name: 'General', exact: true }).click();
  const personality = 'Call me Captain. Be calm, warm, and concise.';
  await page.getByLabel('Personality', { exact: true }).fill(personality);
  await page.getByRole('button', { name: 'Save personality', exact: true }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem('jimmy.personality')), personality);
  await page.getByRole('button', { name: 'Close voice settings', exact: true }).click();
  await page.getByRole('button', { name: 'Voice settings', exact: true }).click();
  await page.getByRole('button', { name: 'General', exact: true }).click();
  assert.equal(await page.getByLabel('Personality', { exact: true }).inputValue(), personality);
  await page.getByRole('button', { name: 'Close voice settings', exact: true }).click();
  await delay(150);
  await page.getByRole('combobox', { name: 'Brain' }).selectOption('codex');
  await page.getByRole('button', { name: 'Sign in with ChatGPT', exact: true }).click();
  const signInLink = page.getByRole('link', { name: 'Continue to ChatGPT sign-in ↗' });
  await signInLink.waitFor();
  assert.match(await signInLink.getAttribute('href'), /^https:\/\/auth.openai.com\//);
  signedIn = true;
  loginPending = false;
  await page.getByText('ChatGPT connected', { exact: true }).waitFor();
  await hold.focus();
  await page.keyboard.down('Space');
  assert.equal(await page.evaluate(() => window.__track.enabled), true);
  await page.keyboard.up('Space');
  assert.equal(await page.evaluate(() => window.__track.enabled), false);
  await hold.focus();
  await page.keyboard.down('Enter');
  assert.equal(await page.evaluate(() => window.__track.enabled), true);
  await page.keyboard.up('Enter');
  assert.equal(await page.evaluate(() => window.__track.enabled), false);
  await final('Explain a coding task');
  await delay(150);
  assert.equal(chats.at(-1).brain, 'codex');
  assert.equal(chats.at(-1).personality, personality);
  await page.getByText('Last reply: Codex', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Use mic / wake word', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__track.enabled), true);
  await page.getByRole('button', { name: 'Wake-word mic on', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__track.enabled), false);
  const count = chats.length;
  await final('Jimmy, answer this while the mic is off');
  await delay(100);
  assert.equal(chats.length, count);
  await hold.focus();
  await page.keyboard.down('Space');
  await page.getByRole('combobox', { name: 'Brain' }).focus();
  assert.equal(await page.evaluate(() => window.__track.enabled), false, 'Focus loss stops recording');
  await page.keyboard.up('Space');
  await page.getByRole('button', { name: 'Sign out of Jimmy' }).click();
  await page.getByRole('button', { name: 'Sign in with ChatGPT', exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  const controls = await page.locator('.jimmy-controls').boundingBox();
  assert.ok(controls.x >= 0 && controls.x + controls.width <= 390, 'Mic controls fit mobile viewport');
  const chatsBeforeWorkflow = chats.length;
  let workflowCalls = 0;
  await page.route('**/api/plan', route => {
    const messages = route.request().postDataJSON().messages;
    return route.fulfill({ json: messages.length === 1 ? { question: 'Should it retrieve unread messages or all messages?', summary: '' } : { question: '', summary: 'Create an n8n workflow that retrieves all unread messages on demand.' } });
  });
  await page.route('**/api/n8n-workflow', route => {
    workflowCalls++;
    assert.equal(route.request().postDataJSON().confirmed, true);
    assert.match(route.request().postDataJSON().prompt, /n8n workflow/i);
    return route.fulfill({ json: { name: 'Test draft', nodeCount: 2, active: false, url: 'http://localhost:5678/workflow/test-draft' } });
  });
  await page.getByPlaceholder('Type to Jimmy...').fill('Create an n8n workflow that returns hello');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByText('Should it retrieve unread messages or all messages?', { exact: true }).waitFor();
  assert.equal(workflowCalls, 0, 'Planning must not create a workflow');
  await page.getByPlaceholder('Type to Jimmy...').fill('All unread messages, on demand');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('button', { name: 'Create it', exact: true }).waitFor();
  assert.equal(workflowCalls, 0, 'A ready plan still waits for confirmation');
  await page.getByPlaceholder('Type to Jimmy...').fill('Create it');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const workflowLink = page.getByRole('link', { name: 'Open workflow in n8n', exact: true });
  await workflowLink.waitFor();
  assert.equal(await workflowLink.getAttribute('href'), 'http://localhost:5678/workflow/test-draft');
  assert.equal(workflowCalls, 1);
  await page.getByPlaceholder('Type to Jimmy...').fill('Jimmy, plan a trip');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel plan', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Cancel plan', exact: true }).click();
  await page.getByText('Plan cancelled. Nothing was created.', { exact: true }).waitFor();
  assert.equal(workflowCalls, 1);
  assert.equal(chats.length, chatsBeforeWorkflow, 'Workflow requests use the dedicated local n8n tool');
  assert.deepEqual(errors, []);
  console.log('Passed: Auto selector/provider label, saved personality sent to chat, push-to-talk, Codex login/logout UI, mobile controls.');
} finally {
  await browser?.close();
  if (server.exitCode === null) { server.kill(); await once(server, 'exit'); }
}
