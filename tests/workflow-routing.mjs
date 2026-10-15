// node tests/workflow-routing.mjs <path-to-playwright-index.mjs>
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
  const errors = [], plans = [], creations = [], chats = [];
  let failCreation = true;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/plan') {
      plans.push(route.request().postDataJSON());
      return route.fulfill({ json: { question: '', summary: 'An inactive authenticated webhook retrieves all read and unread Gmail messages with pagination, returning sender, subject and preview. The user connects Gmail credentials.' } });
    }
    if (url.pathname === '/api/n8n-workflow') {
      creations.push(route.request().postDataJSON());
      if (failCreation) return route.fulfill({ status: 503, json: { error: 'Test: n8n unavailable' } });
      return route.fulfill({ json: { name: 'Gmail read endpoint', nodeCount: 3, url: 'http://localhost:5678/workflow/test-only' } });
    }
    if (url.pathname === '/api/ollama-chat') {
      chats.push(route.request().postDataJSON());
      return route.fulfill({ contentType: 'text/plain', body: 'Here is an n8n workflow for retrieving all Gmail messages, read and unread, via an authenticated webhook. It returns sender, subject and preview. Connect your Gmail credentials before running it.' });
    }
    if (url.pathname === '/api/activity') return route.fulfill({ json: { enabled: false } });
    if (url.pathname === '/api/codex') return route.fulfill({ json: { signedIn: false } });
    return route.fulfill({ status: 503, json: { error: 'Disabled in routing test' } });
  });
  async function open() {
    await page.goto(base);
    await page.getByPlaceholder('Type to Jimmy...').waitFor();
  }
  async function send(text) {
    await page.getByPlaceholder('Type to Jimmy...').fill(text);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
  }
  await open();
  await send('I want you to create a workflow that retrieves all Gmail messages.');
  await page.getByText('Plan ready', { exact: true }).waitFor();
  assert.equal(plans.length, 1); assert.equal(creations.length, 0); assert.equal(chats.length, 0);
  await send('Create it.');
  await page.getByText('Test: n8n unavailable', { exact: true }).waitFor();
  assert.equal(creations.length, 1);
  assert.ok(await page.getByRole('button', { name: 'Create it', exact: true }).isVisible(), 'Failed creation preserves the plan');
  failCreation = false;
  await page.getByRole('button', { name: 'Create it', exact: true }).click();
  await page.getByRole('link', { name: 'Open workflow in n8n' }).waitFor();
  assert.equal(creations.length, 2); assert.ok(creations.every(body => body.confirmed === true));
  assert.equal(chats.length, 0, 'Confirmation never becomes ordinary chat');

  await open();
  await send('Help me automate reading my email.');
  await page.getByText(/Here is an n8n workflow/).waitFor();
  await page.getByRole('button', { name: 'Send', exact: true }).waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled);
  await send('Create it.');
  await page.getByRole('link', { name: 'Open workflow in n8n' }).waitFor();
  assert.equal(creations.length, 3); assert.equal(chats.length, 1);
  assert.match(creations.at(-1).prompt, /read and unread/);

  await open();
  await send('Create it.');
  await page.getByText(/I don't have a clear workflow ready to create/).waitFor();
  assert.equal(creations.length, 3); assert.equal(chats.length, 1);
  assert.deepEqual(errors, []);
  console.log('Passed: browser request → plan → confirmation → n8n save, failed-plan retention/retry, conversational recovery, and no creation without workflow context. All APIs mocked; no workflows created.');
} finally { await browser?.close(); server.kill(); }
