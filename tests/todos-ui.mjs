// node tests/todos-ui.mjs <path-to-playwright-index.mjs>
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { loadEnvFile } from 'node:process';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
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
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const page = await browser.newPage({ httpCredentials: credentials, permissions: ['microphone'] });
  await page.addInitScript(() => {
    window.open = () => null; // Exercise the accessible canvas fallback without popups.
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class {
      static OPEN = 1;
      readyState = 1;
      constructor(url, protocols) {
        if (!String(url).includes('mock-voice')) return new NativeWebSocket(url, protocols);
        window.__voiceSocket = this;
        setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'ready', provider: 'moonshine', provider_status: 'ready' }) }), 30);
      }
      send() {}
      close() { this.readyState = 3; }
    };
  });
  const errors = [], calls = [], spoken = [];
  const helper = ts.transpileModule(await readFile('app/lib/todos.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const { splitTodoTime, todoTime, formatTodoTime } = await import('data:text/javascript;base64,' + Buffer.from(helper).toString('base64'));
  let modelCalls = 0;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const next = new Date(today + 'T00:00:00Z'); next.setUTCDate(next.getUTCDate() + 1); const tomorrow = next.toISOString().slice(0, 10);
  const clockStart = new Date(today + 'T04:00:00Z');
  await page.clock.install({ time: clockStart });
  let holdNextRead = false, releaseRead;
  let readStarted;
  const heldReadStarted = new Promise(resolve => { readStarted = resolve; });
  const days = new Map();
  const resolve = day => day === 'tomorrow' ? tomorrow : !day || day === 'today' ? today : day;
  const view = day => {
    const tasks = days.get(day) || [], open = tasks.flatMap((task, index) => task.done ? [] : [`${index + 1}. ${task.time ? `At ${formatTodoTime(task.time)}: ` : ''}${task.text}`]);
    const label = day === today ? 'today' : day === tomorrow ? 'tomorrow' : day;
    return { day, label, exists: days.has(day), tasks, reply: open.length ? `Your to-do list for ${label} has ${open.length} unfinished tasks:\n${open.join('\n')}` : `You have no tasks on your to-do list for ${label}.` };
  };
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/voice-ticket') return route.fulfill({ json: { url: 'ws://localhost/mock-voice' } });
    if (url.pathname === '/api/todos') {
      const body = route.request().method() === 'POST' ? route.request().postDataJSON() : null;
      if (!body && holdNextRead) { holdNextRead = false; readStarted(); await new Promise(resolve => { releaseRead = resolve; }); }
      const day = resolve(body?.day || url.searchParams.get('day'));
      calls.push(body || { action: 'list', day });
      if (body) {
        const tasks = days.get(day) || [];
        if (body.action === 'add' || body.action === 'create') {
          for (const text of (body.text || '').split(/[;\n]+/).map(text => text.trim()).filter(Boolean)) {
            const task = splitTodoTime(text);
            tasks.push({ id: String(Math.random()), text: task.text, done: false, createdAt: new Date().toISOString(), time: task.time || todoTime(body.time || '') });
          }
        } else {
          const index = body.id ? tasks.findIndex(task => task.id === body.id) : body.number - 1;
          if (body.action === 'done') tasks[index].done = body.done;
          if (body.action === 'time') tasks[index].time = todoTime(body.time);
          if (body.action === 'remove') tasks.splice(index, 1);
        }
        days.set(day, tasks);
      }
      return route.fulfill({ json: view(day) });
    }
    if (url.pathname === '/api/ollama-chat' || url.pathname === '/api/plan') modelCalls++;
    if (url.pathname === '/api/activity') return route.fulfill({ json: { enabled: false } });
    if (url.pathname === '/api/codex') return route.fulfill({ json: { signedIn: false } });
    if (url.pathname === '/api/tts' && route.request().method() === 'POST') spoken.push(route.request().postDataJSON().text);
    return route.fulfill({ status: 503, json: { error: 'Service disabled in test' } });
  });
  async function send(text) {
    const openCanvas = page.getByRole('dialog', { name: 'Jimmy data canvas', exact: true });
    if (await openCanvas.count()) await openCanvas.getByRole('button', { name: 'Close canvas', exact: true }).click();
    await page.getByPlaceholder('Type to Jimmy...').fill(text);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('#jimmy-chat button[type="submit"]').disabled);
  }
  await page.goto(base);
  await send('Jimmy, create me a todo list for tomorrow.');
  await page.getByText(/Your to-do list for tomorrow is ready/).waitFor();
  await page.getByRole('dialog', { name: 'Jimmy data canvas', exact: true }).waitFor();
  assert.ok(days.has(tomorrow));
  await send('Finish the presentation');
  await page.getByText(/Saved to your to-do list for tomorrow/).waitFor();
  assert.equal(days.get(tomorrow)[0].text, 'Finish the presentation');
  await page.getByRole('dialog', { name: 'Jimmy data canvas', exact: true }).getByText('Finish the presentation', { exact: true }).waitFor();
  await send('Add email the team to my to-do list');
  assert.equal(days.get(tomorrow).length, 2);
  await send('Set task 1 to 3 PM');
  assert.equal(days.get(tomorrow)[0].time, '15:00');
  await page.getByRole('dialog', { name: 'Jimmy data canvas' }).getByText('3 PM', { exact: true }).waitFor();
  const beforeAmbiguous = calls.length;
  await send('Set task 1 to 3');
  await page.getByText(/Please repeat with AM or PM/).waitFor(); assert.equal(calls.length, beforeAmbiguous);
  await send('Mark task 1 done');
  await page.getByText('Task 1 is marked done for tomorrow.', { exact: true }).waitFor();
  assert.equal(days.get(tomorrow)[0].done, true);
  await send('Do I have something to do today?');
  await page.getByText('Your to-do list for today is on the canvas. 0 remaining.', { exact: true }).waitFor();
  assert.equal(modelCalls, 0, 'Task creation, follow-up, completion and listing never use a model');
  await page.getByRole('dialog', { name: 'Jimmy data canvas' }).getByRole('button', { name: 'Close canvas' }).click();
  await page.getByRole('button', { name: 'Voice settings', exact: true }).click();
  await page.getByRole('button', { name: 'To-do list', exact: true }).click();
  await page.getByRole('button', { name: 'Tomorrow', exact: true }).click();
  await page.getByLabel('Mark task 2 done', { exact: true }).waitFor();
  assert.ok(await page.getByLabel('Mark task 1 done', { exact: true }).isChecked());
  assert.equal(await page.getByLabel('Time for task 1', { exact: true }).inputValue(), '15:00');
  await page.getByLabel('Tasks to add').fill('Review the portfolio\nBuy groceries');
  await page.getByLabel('Time for new tasks (optional, Manila)', { exact: true }).fill('09:30');
  await page.getByRole('button', { name: 'Add tasks', exact: true }).click();
  await page.getByText('Saved.', { exact: true }).waitFor();
  assert.equal(days.get(tomorrow).length, 4);
  assert.equal(days.get(tomorrow)[2].time, '09:30');
  await page.getByLabel('Time for task 2', { exact: true }).fill('14:15');
  await page.getByText('Saved.', { exact: true }).waitFor();
  assert.equal(days.get(tomorrow)[1].time, '14:15');
  await page.getByLabel('Remove task 4', { exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('input[type="checkbox"]').length === 3);
  assert.equal(days.get(tomorrow).length, 3);
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await page.getByRole('dialog').boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
  await page.getByRole('button', { name: 'Close voice settings', exact: true }).click();
  await send('Create a todo list for tomorrow');
  await send('Cancel');
  await page.getByText('Stopped adding tasks. Your saved list has been kept.', { exact: true }).waitFor();
  assert.equal(days.get(tomorrow).length, 3);
  await page.reload();
  await send("What's in my to-do list for tomorrow?");
  await page.getByRole('dialog', { name: 'Jimmy data canvas' }).getByText(/email the team/).waitFor();
  const beforeLongList = spoken.length;
  for (let index = 0; index < 4; index++) days.get(tomorrow).push({ id: 'long-' + index, text: 'Review presentation details '.repeat(15), done: false, createdAt: new Date().toISOString() });
  await send("What's in my to-do list for tomorrow?");
  for (let attempt = 0; attempt < 40 && spoken.length - beforeLongList < 1; attempt++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.ok(spoken.length - beforeLongList >= 1, 'Jimmy speaks the concise explanation');
  assert.ok(spoken.slice(beforeLongList).every(text => !text.includes('Review presentation details')), 'Long list contents stay on the canvas');
  await page.getByRole('dialog', { name: 'Jimmy data canvas' }).getByRole('button', { name: 'Close canvas' }).click();
  await page.getByRole('button', { name: 'Use mic / wake word', exact: true }).click();
  await page.waitForFunction(() => Boolean(window.__voiceSocket?.onmessage));
  await page.evaluate(() => window.__voiceSocket.onmessage({ data: JSON.stringify({ type: 'final', text: 'Jimmy, create me a to-do list for today at 6 PM.' }) }));
  await page.getByText(/Your to-do list for today is ready/).waitFor();
  await page.evaluate(() => window.__voiceSocket.onmessage({ data: JSON.stringify({ type: 'final', text: 'Review slides' }) }));
  await page.getByText(/Saved to your to-do list for today/).waitFor();
  assert.equal(days.get(today)[0].text, 'Review slides', 'A short spoken answer to the task question is accepted without another wake word');
  assert.equal(days.get(today)[0].time, '18:00', 'A scheduled time is kept while Jimmy asks which task to add');
  await page.clock.pauseAt(new Date(clockStart.getTime() + 60000));
  const preview = page.getByRole('dialog', { name: 'Jimmy data canvas', exact: true });
  await send("What's in my to-do list for tomorrow?"); await preview.waitFor();
  const previewBounds = await preview.boundingBox(); assert.ok(previewBounds.x >= 0 && previewBounds.x + previewBounds.width <= 390);
  await page.clock.fastForward(14000); assert.ok(await preview.isVisible());
  await send("What's in my to-do list for tomorrow?");
  await page.clock.fastForward(60000); assert.ok(await preview.isVisible(), 'Data stays on the canvas until explicitly dismissed');
  await send("What's in my to-do list?"); await preview.waitFor();
  const beforeHide = calls.length;
  await page.evaluate(() => window.__voiceSocket.onmessage({ data: JSON.stringify({ type: 'final', text: 'Jimmy, hide todo list.' }) }));
  await preview.waitFor({ state: 'hidden' }); assert.equal(calls.length, beforeHide, 'Hiding never changes saved tasks');
  await send("What's in my to-do list?"); await preview.waitFor();
  holdNextRead = true;
  const pendingRead = send("What's in my to-do list for tomorrow?");
  await heldReadStarted;
  await page.evaluate(() => window.__voiceSocket.onmessage({ data: JSON.stringify({ type: 'final', text: 'Jimmy, hide todo list.' }) }));
  releaseRead(); await pendingRead;
  assert.equal(await preview.count(), 0, 'A late fetch cannot reopen a manually dismissed preview');
  assert.equal(modelCalls, 0); assert.ok(spoken.every(text => text.length <= 1000)); assert.deepEqual(errors, []);
  console.log('Passed: to-do creation/follow-up/settings, separate canvas with concise chat and speech, responsive layout, persistent display, cancellation, reload, dismissal and late-fetch protection. API data mocked; no personal tasks changed.');
} finally { await browser?.close(); server.kill(); }
