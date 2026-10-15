// node tests/n8n-tools-ui.mjs <path-to-playwright-index.mjs>
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { loadEnvFile } from 'node:process';
import { pathToFileURL } from 'node:url';
loadEnvFile('.env.local');
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const credentials = { username: process.env.JIMMY_AUTH_USERNAME || process.env.JOHNNY_AUTH_USERNAME || '', password: process.env.JIMMY_AUTH_PASSWORD || process.env.JOHNNY_AUTH_PASSWORD || '' };
const base = 'http://localhost:3107';
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--port', '3107'], { windowsHide: true, stdio: 'ignore' });
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { ready = (await fetch(base, { headers: { authorization: 'Basic ' + Buffer.from(credentials.username + ':' + credentials.password).toString('base64') } })).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, 'Isolated production server starts');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ httpCredentials: credentials });
  await page.addInitScript(() => {
    window.testClipboard = '';
    window.testClipboardFails = false;
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => {
      if (window.testClipboardFails) throw new Error('Clipboard blocked');
      window.testClipboard = text;
    } } });
  });
  const errors = [], saves = [], chats = [], spoken = [];
  let chatFailure = false;
  const toolFailure = 'The n8n tool timed out while waiting for results. No result was supplied to Jimmy. The workflow may still be running; check its execution in n8n before trying again.';
  let tests = 0;
  let tool = { id: 'gmail', name: 'Gmail', path: 'gmail/messages', method: 'GET', phrases: ['check my emails'], enabled: false, headerName: '', hasSecret: false, parameters: {} };
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/n8n-tools') {
      if (route.request().method() === 'GET') return route.fulfill({ json: { tools: [tool] } });
      const body = route.request().postDataJSON();
      if (body.action === 'test') { tests++; return route.fulfill({ json: { name: 'Gmail', count: 24, fetchedAt: new Date().toISOString() } }); }
      saves.push(body);
      tool = { ...tool, name: body.name, path: body.path, method: body.method, phrases: body.phrases, headerName: body.headerName, enabled: body.enabled, parameters: body.parameters, hasSecret: true };
      return route.fulfill({ json: { tools: [tool] } });
    }
    if (url.pathname === '/api/ollama-chat') {
      chats.push(route.request().postDataJSON());
      if (chatFailure) { await new Promise(resolve => setTimeout(resolve, 300)); return route.fulfill({ status: 502, json: { error: toolFailure } }); }
      return route.fulfill({ headers: { 'Content-Type': 'text/plain', 'X-Chat-Brain': 'qwen', 'X-Jimmy-Tool-Result': chats.length === 1 || chats.length === 3 ? '1' : '0', ...(chats.length === 1 ? { 'X-Jimmy-Gmail-Page': encodeURIComponent(JSON.stringify({ query: '"weather"', pageToken: 'page-two' })) } : chats.length === 3 ? { 'X-Jimmy-Gmail-Page': encodeURIComponent('null') } : {}) }, body: chats.length === 1 ? 'The Gmail tool returned 24 email previews.' : chats.length === 3 ? 'That is the final email page.' : 'Your conversation stays local in Auto.' });
    }
    if (url.pathname === '/api/activity') return route.fulfill({ json: { enabled: false } });
    if (url.pathname === '/api/codex') return route.fulfill({ json: { signedIn: false } });
    if (url.pathname === '/api/tts') {
      if (route.request().method() === 'POST') spoken.push(route.request().postDataJSON().text);
      return route.fulfill({ status: 503, json: { error: 'Voice disabled for test' } });
    }
    return route.fulfill({ status: 503, json: { error: 'Other services disabled in test' } });
  });
  await page.goto(base);
  await page.getByRole('button', { name: 'Voice settings', exact: true }).click();
  await page.getByRole('button', { name: 'n8n tools', exact: true }).click();
  await page.getByLabel('Webhook path', { exact: false }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('input')].some(input => input.value === 'gmail/messages'));
  assert.equal(await page.getByLabel('Webhook path', { exact: false }).inputValue(), 'gmail/messages');
  await page.getByLabel('Authentication header name').fill('X-Jimmy-Test');
  const secretInput = page.getByLabel('Webhook secret', { exact: true });
  await page.getByRole('button', { name: 'Generate secret', exact: true }).click();
  const generated = await secretInput.inputValue();
  assert.match(generated, /^[a-f0-9]{64}$/);
  assert.equal(await secretInput.getAttribute('type'), 'text');
  assert.equal(saves.length, 0, 'Generation does not save or call n8n');
  await page.evaluate(() => { window.testClipboardFails = true; });
  await page.getByRole('button', { name: 'Copy secret', exact: true }).click();
  await page.getByText(/Could not copy\. Select and copy/).waitFor();
  assert.equal(await secretInput.getAttribute('type'), 'text', 'Failed copy keeps the secret available');
  await page.evaluate(() => { window.testClipboardFails = false; });
  await page.getByRole('button', { name: 'Copy secret', exact: true }).click();
  await page.getByText(/Copied; secret hidden/).waitFor();
  assert.equal(await page.evaluate(() => window.testClipboard), generated);
  assert.equal(await secretInput.getAttribute('type'), 'password');
  assert.equal(await page.getByRole('button', { name: 'Copy secret', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Generate secret', exact: true }).click();
  assert.notEqual(await secretInput.inputValue(), generated);
  await page.getByRole('button', { name: 'Hide secret', exact: true }).click();
  assert.equal(await secretInput.getAttribute('type'), 'password');
  await secretInput.fill('browser-test-secret');
  await page.getByLabel('Enable this read tool').check();
  await page.getByRole('button', { name: 'Save tool', exact: true }).click();
  await page.getByText('Saved. This tool is ready for its next request when enabled.', { exact: true }).waitFor();
  assert.equal(saves.length, 1); assert.equal(saves[0].secret, 'browser-test-secret');
  assert.equal(await page.getByLabel('Webhook secret').inputValue(), '', 'The secret input clears after saving');
  await page.getByRole('button', { name: 'Test saved tool (runs workflow)', exact: true }).click();
  await page.getByText(/Read tool responded with 24 items/).waitFor(); assert.equal(tests, 1);
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const bounds = await page.getByRole('dialog').boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
    const styles = await page.getByRole('dialog').evaluate(dialog => {
      const elements = [dialog, dialog.querySelector('textarea')];
      return elements.map(element => ({ width: getComputedStyle(element).scrollbarWidth, color: getComputedStyle(element).scrollbarColor }));
    });
    for (const style of styles) {
      assert.equal(style.width, 'thin');
      assert.equal(style.color, 'rgb(79, 153, 163) rgb(9, 27, 36)');
    }
  }
  await page.getByRole('button', { name: 'Close voice settings', exact: true }).click();
  async function send(text) {
    await page.getByPlaceholder('Type to Jimmy...').fill(text);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled);
  }
  await send('Check my emails about the weather.');
  await page.getByText('The Gmail tool returned 24 email previews.', { exact: true }).waitFor();
  assert.equal(chats.length, 1, 'Configured read tools take priority over broad weather keyword routing');
  assert.equal(chats[0].localToolHistory, false);
  await send('Write a Python function.');
  await page.getByText('Your conversation stays local in Auto.', { exact: true }).waitFor();
  assert.equal(chats.length, 2); assert.equal(chats[1].localToolHistory, true);
  await send('Next page of emails.');
  await page.getByText('That is the final email page.', { exact: true }).waitFor();
  assert.deepEqual(chats[2].gmailPage, { query: '"weather"', pageToken: 'page-two' }, 'Continuation stays in this dashboard session and retains its search');
  chatFailure = true;
  const previousSpeech = spoken.length;
  await page.getByPlaceholder('Type to Jimmy...').fill('Check my emails.');
  const spokenError = page.waitForRequest(request => new URL(request.url()).pathname === '/api/tts' && request.method() === 'POST' && request.postDataJSON().text === toolFailure);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('button', { name: 'Hide chat', exact: true }).click();
  await spokenError;
  await page.waitForTimeout(500);
  assert.equal(await page.getByRole('button', { name: 'Show chat', exact: true }).count(), 1, 'Chat remains hidden');
  assert.equal(chats.at(-1).gmailPage, null, 'The final page clears the previous continuation');
  assert.deepEqual(spoken.slice(previousSpeech), [toolFailure], 'Task failure goes to TTS exactly once with chat hidden; TTS failure does not recurse');
  await page.getByRole('alert').filter({ hasText: 'Kokoro is unavailable' }).waitFor();
  assert.deepEqual(errors, []);
  console.log('Passed: n8n settings save/test, secret generation/copy/masking, themed scrollbars, responsive dialog, tool routing/local history, spoken task errors with hidden chat, and visible non-recursive TTS failures. All services mocked; no email fetched.');
} finally { await browser?.close(); server.kill(); }
