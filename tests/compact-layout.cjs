// Runs the real page in an isolated, hidden Electron window; APIs and desktop state are mocked.
/* eslint-disable @typescript-eslint/no-require-imports -- This test is also an Electron CommonJS entrypoint. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function checkCanvas(win, BrowserWindow) {
  const run = async code => {
    const result = await win.webContents.executeJavaScript(`(() => { try { return { value: eval(${JSON.stringify(code)}) }; } catch (error) { return { failure: String(error) }; } })()`);
    if (result.failure) throw new Error(`${result.failure}: ${code.slice(0, 180)}`);
    return result.value;
  };
  const wait = async (condition, target = win) => {
    for (let index = 0; index < 100; index++) {
      if (await target.webContents.executeJavaScript(condition)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Canvas UI condition timed out: ' + condition);
  };
  win.setSize(1200, 820);
  await run(`window.__desktopState({ expanded: true, muted: false, awake: true, phase: 'Ready', error: '' })`);
  const send = async text => {
    await run(`if (document.querySelector('dialog[open]')) [...document.querySelectorAll('dialog button')].find(button => button.textContent === 'Close canvas').click()`);
    await run(`(() => { const input = document.querySelector('#jimmy-chat input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(text)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await new Promise(resolve => setTimeout(resolve, 50));
    await run(`document.querySelector('#jimmy-chat form').requestSubmit()`);
    await wait(`Boolean(document.querySelector('dialog[open]'))`);
  };
  const report = { title: 'Study plan · the week ahead', note: 'Example data for the interface test.', blocks: [
    { type: 'table', title: 'Your work, at a glance', columns: ['Subject', 'Hours', 'Priority'], rows: [['Presentation', 6, 'High'], ['Research', 4, 'Medium'], ['Review', 2, 'Medium']] },
    { type: 'chart', title: 'Time allocation', style: 'bar', unit: 'hours', points: [{ label: 'Presentation', value: 6 }, { label: 'Research', value: 4 }, { label: 'Review', value: 2 }] },
    { type: 'diagram', title: 'From research to delivery', nodes: [{ id: 'a', label: 'Read the sources' }, { id: 'b', label: 'Build the slides' }, { id: 'c', label: 'Rehearse and present' }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }] },
    { type: 'list', title: 'Before you start', items: ['Gather the reference material.', 'Check the submission date.'] },
  ] };
  await run(`window.__modelReply = ${JSON.stringify('I have organized the report on your canvas.\n\n```jimmy-canvas\n' + JSON.stringify(report) + '\n```')}`);
  await send('Compare these supplied study values.');
  assert.equal(await run(`document.querySelectorAll('dialog .canvas-block').length`), 4);
  assert.equal(await run(`document.querySelectorAll('dialog table').length`), 2);
  assert.equal(await run(`document.querySelectorAll('dialog svg').length`), 2);
  assert.ok(!(await run(`document.querySelector('#jimmy-chat').innerText`)).includes('Gather the reference material.'));
  assert.ok(!(await run(`JSON.stringify(window.__speech)`)).includes('jimmy-canvas'));
  assert.equal(await run(`Boolean(document.activeElement.closest('dialog'))`), true, 'Popup fallback receives keyboard focus');
  const url = await run('window.__canvasURL');
  const viewer = new BrowserWindow({ width: 1200, height: 900, show: false, backgroundColor: '#030506', webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false } });
  try {
    await viewer.loadURL(new URL(url, 'http://127.0.0.1:3108').href);
    await wait(`document.querySelectorAll('.canvas-block').length === 4`, viewer);
    assert.equal(await viewer.webContents.executeJavaScript(`typeof window.require + ':' + typeof window.jimmyDesktop`), 'undefined:undefined');
    await viewer.webContents.executeJavaScript('document.fonts.ready');
    await new Promise(resolve => setTimeout(resolve, 150));
    await fs.writeFile('.jimmy-runtime/canvas-demo.png', (await viewer.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
    await run(`window.__modelReply = ${JSON.stringify('Here is a line chart.\n```jimmy-canvas\n' + JSON.stringify({ title: 'Trend', blocks: [{ type: 'chart', style: 'line', points: [{ label: 'Jan', value: -4 }, { label: 'Feb', value: 0 }, { label: 'Mar', value: 8 }] }] }) + '\n```')}`);
    await send('Graph that table.');
    assert.ok((await run('window.__lastChatBody.canvasContext')).includes('Presentation'));
    assert.ok((await run('window.__lastChatBody.messages')).every(message => !('visual' in message)), 'Canvas payloads are not repeated in conversation history');
    await wait(`document.querySelector('h1')?.textContent === 'Trend'`, viewer);
    await viewer.reload();
    await wait(`document.querySelector('h1')?.textContent === 'Trend'`, viewer);
    assert.ok(!(await viewer.webContents.executeJavaScript('JSON.stringify(localStorage)')).includes('Presentation'), 'Source data is not persisted in browser storage');
    const raw = { title: 'Gmail', source: 'Gmail · test fixture', blocks: [{ type: 'table', columns: ['Subject', 'Preview'], rows: [['PRIVATE-EMAIL-SENTINEL', '<img src=x onerror="window.__evil=true">']] }] };
    await run(`window.__modelContentType = 'application/x-ndjson'; window.__modelReply = ${JSON.stringify(JSON.stringify({ type: 'text', text: 'Your email results are on the canvas.' }) + '\n' + JSON.stringify({ type: 'canvas', canvas: raw }) + '\n')}`);
    await send('Check my emails.');
    await wait(`document.body.innerText.includes('PRIVATE-EMAIL-SENTINEL')`, viewer);
    assert.ok(!(await run(`document.querySelector('#jimmy-chat').innerText`)).includes('PRIVATE-EMAIL-SENTINEL'));
    assert.equal(await viewer.webContents.executeJavaScript(`document.querySelectorAll('img').length`), 0, 'Email HTML is never executed');
    assert.equal(await viewer.webContents.executeJavaScript('Boolean(window.__evil)'), false);
    await send("What's in my to-do list?");
    await wait(`document.body.innerText.includes('PRIVATE-TODO-SENTINEL')`, viewer);
    assert.ok(!(await run(`document.querySelector('#jimmy-chat').innerText`)).includes('PRIVATE-TODO-SENTINEL'));
    await viewer.setSize(390, 844);
    assert.equal(await viewer.webContents.executeJavaScript('document.documentElement.scrollWidth <= innerWidth'), true, 'The separate canvas fits a phone-width viewport');
    const invalidReply = 'I could not format that chart.\n```jimmy-canvas\n{"title":"Bad","blocks":[{"type":"html","text":"<script>evil()</script>"}]}\n```';
    await run(`window.__modelContentType = 'text/plain'; window.__modelReply = ${JSON.stringify(invalidReply)}`);
    await send('Explain this unrelated dataset.');
    await wait(`Boolean(document.querySelector('.canvas-text'))`, viewer);
    assert.equal(await viewer.webContents.executeJavaScript(`document.querySelectorAll('.canvas-block script').length`), 0);
    const other = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    try {
      await other.loadURL('http://127.0.0.1:3108/canvas?session=00000000-0000-0000-0000-000000000000');
      await new Promise(resolve => setTimeout(resolve, 150));
      assert.equal(await other.webContents.executeJavaScript(`document.querySelectorAll('.canvas-block').length`), 0, 'Unrelated sessions do not receive this canvas data');
    } finally { other.destroy(); }
    await run(`document.querySelector('.canvas-overlay button').click(); document.querySelector('button[aria-label="Voice settings"]').click()`);
    await wait(`Boolean(document.querySelector('#voice-settings-title')?.closest('dialog[open]'))`);
    await run(`[...document.querySelectorAll('nav[aria-label="Settings sections"] button')].find(button => button.textContent === 'General').click()`);
    await wait(`Boolean(document.querySelector('#assistant-name'))`);
    const reactorFont = await run(`getComputedStyle(document.querySelector('.arc-reactor')).fontFamily`);
    assert.ok((await run(`getComputedStyle(document.querySelector('.settings-dialog')).fontFamily`)).includes('system-ui'), 'Settings starts with a readable system font');
    await run(`(() => { const select = document.querySelector('#settings-font'); select.value = 'verdana'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await wait(`getComputedStyle(document.querySelector('.settings-dialog')).fontFamily.includes('Verdana')`);
    assert.equal(await run(`getComputedStyle(document.querySelector('.arc-reactor')).fontFamily`), reactorFont, 'Settings font changes leave the reactor font alone');
    await run(`[...document.querySelectorAll('nav[aria-label="Settings sections"] button')].find(button => button.textContent === 'Voice').click()`);
    assert.ok((await run(`getComputedStyle(document.querySelector('.settings-dialog')).fontFamily`)).includes('Verdana'));
    await run(`[...document.querySelectorAll('nav[aria-label="Settings sections"] button')].find(button => button.textContent === 'General').click()`);
    await wait(`document.querySelector('#settings-font')?.value === 'verdana'`);
    const fontData = (await fs.readFile('app/fonts/Orbitron.ttf')).toString('base64');
    await run(`(() => { const bytes = Uint8Array.from(atob(${JSON.stringify(fontData)}), char => char.charCodeAt(0)); const transfer = new DataTransfer(); transfer.items.add(new File([bytes], 'My-readable-font.ttf', { type: 'font/ttf' })); const input = document.querySelector('#settings-font-file'); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await wait(`document.querySelector('#settings-font')?.value === 'custom' && getComputedStyle(document.querySelector('.settings-dialog')).fontFamily.includes('AssistantSettingsFont')`);
    assert.equal(await run(`Array.from(document.fonts).some(font => font.family === 'AssistantSettingsFont' && font.status === 'loaded')`), true, 'The real TTF loads through the browser font parser');
    await wait(`document.documentElement.style.getPropertyValue('--settings-font').includes('AssistantSettingsFont')`, viewer);
    await viewer.reload();
    await wait(`document.documentElement.style.getPropertyValue('--settings-font').includes('AssistantSettingsFont')`, viewer);
    await run(`[...document.querySelectorAll('button')].find(button => button.textContent === 'Remove uploaded font').click()`);
    await wait(`document.querySelector('#settings-font')?.value === 'system' && getComputedStyle(document.querySelector('.settings-dialog')).fontFamily.includes('system-ui')`);
    assert.equal(await run(`JSON.parse(localStorage.getItem('jimmy.settings-font')).upload`), undefined);
    win.webContents.invalidate();
    await new Promise(resolve => setTimeout(resolve, 150));
    await fs.writeFile('.jimmy-runtime/readable-settings.png', (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
    const initialColors = await run(`({ reactor: getComputedStyle(document.querySelector('.arc-reactor')).color, control: getComputedStyle(document.querySelector('button[aria-label="Voice settings"]')).color })`);
    await run(`(() => { const input = document.querySelector('#ui-color'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '#e76f51'); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await wait(`document.documentElement.style.getPropertyValue('--ui-color') === '#e76f51'`);
    const changedColors = await run(`({ reactor: getComputedStyle(document.querySelector('.arc-reactor')).color, control: getComputedStyle(document.querySelector('button[aria-label="Voice settings"]')).color })`);
    assert.notEqual(changedColors.reactor, initialColors.reactor, 'The reactor uses the selected color');
    assert.notEqual(changedColors.control, initialColors.control, 'Tailwind controls use the selected color');
    await wait(`document.documentElement.style.getPropertyValue('--ui-color') === '#e76f51'`, viewer);
    await viewer.reload();
    await wait(`document.documentElement.style.getPropertyValue('--ui-color') === '#e76f51'`, viewer);
    await fs.writeFile('.jimmy-runtime/ui-color-settings.png', (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
    await fs.writeFile('.jimmy-runtime/ui-color-canvas.png', (await viewer.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
    await run(`[...document.querySelectorAll('button')].find(button => button.textContent === 'Restore cyan').click()`);
    await wait(`document.documentElement.style.getPropertyValue('--ui-color') === '#79e0e5'`);
    await wait(`document.querySelectorAll('#chat-model option').length === 2`);
    await run(`(() => { const select = document.querySelector('#chat-model'); select.value = 'friend:14b'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await run(`[...document.querySelectorAll('button')].find(button => button.textContent === 'Save chat model').click()`);
    await wait(`window.__lastModelSettingsBody?.model === 'friend:14b'`);
    assert.equal(await run(`window.__modelSettings.model`), 'friend:14b');
    await run(`[...document.querySelectorAll('nav[aria-label="Settings sections"] button')].find(button => button.textContent === 'Voice').click()`);
    await run(`[...document.querySelectorAll('nav[aria-label="Settings sections"] button')].find(button => button.textContent === 'General').click()`);
    await wait(`document.querySelector('#chat-model')?.value === 'friend:14b'`);
    await run(`(() => { const input = document.querySelector('#assistant-name'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Nova'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await new Promise(resolve => setTimeout(resolve, 50));
    await run(`[...document.querySelectorAll('button')].find(button => button.textContent === 'Save name').click()`);
    await wait(`document.title === 'Nova | Arc Reactor'`);
    assert.equal(await run(`document.querySelector('#voice-settings-title').textContent`), 'Nova’s settings');
    assert.equal(await run(`document.querySelector('#jimmy-chat input').placeholder`), 'Type to Nova...');
    await wait(`document.querySelector('.canvas-brand').textContent === 'NOVA / CANVAS'`, viewer);
    await viewer.reload();
    await wait(`document.title === 'Nova | Data Canvas'`, viewer);
    await run(`[...document.querySelectorAll('nav[aria-label="Settings sections"] button')].find(button => button.textContent === 'Voice').click()`);
    await wait(`Boolean(document.querySelector('input[name="kokoro-voice"]'))`);
    await run(`document.querySelector('input[value="af_heart"]').click();`);
    await run(`[...document.querySelectorAll('button')].find(button => button.textContent === '▶ Preview').click()`);
    await wait(`window.__lastTtsBody?.voice === 'af_heart'`);
    assert.equal(await run('window.__lastTtsBody.text'), "Hello, I'm Nova. How can I help you today?");
    await run(`(() => { const select = document.querySelector('#voice-language'); select.value = 'b'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await wait(`Boolean(document.querySelector('input[value="bf_alice"]'))`);
    await run(`[...document.querySelectorAll('button')].find(button => button.textContent === '▶ Preview').click()`);
    await wait(`window.__lastTtsBody?.voice.startsWith('b')`);
    assert.equal(await run('window.__lastTtsBody.text'), "Hello, I'm Nova. How can I help you today?");
    await run(`document.querySelector('button[aria-label="Close voice settings"]').click()`);
    await send('Nova, explain this dataset.');
    assert.equal(await run('window.__lastChatBody.assistantName'), 'Nova', 'The new identity reaches chat requests');
    assert.equal(await run(`window.__lastChatBody.messages.at(-1).content`), 'explain this dataset.', 'Renamed typed commands reach the existing router');
    await run(`document.querySelector('.canvas-overlay button').click()`);
    for (const expanded of [false, true]) {
      win.setSize(expanded ? 1200 : 200, expanded ? 820 : 312);
      await run(`window.__desktopState({ expanded: ${expanded}, muted: false, awake: false, phase: 'Waking up…', error: '' })`);
      await wait(`innerWidth === ${expanded ? 1200 : 200} && document.documentElement.dataset.jimmyDesktop === '${expanded ? "expanded" : "compact"}'`);
      for (const name of ['WWWWWWWWWWWWWWWWWWWWWWWW', 'Écho des Étoiles', 'Nova']) {
        await run(`localStorage.setItem('jimmy.assistant-name', ${JSON.stringify(name)}); window.dispatchEvent(new Event('assistant-name-changed'))`);
        await wait(`document.querySelector('.reactor-name')?.textContent === ${JSON.stringify(name.toUpperCase())} && document.querySelector('.reactor-name').scrollWidth <= document.querySelector('.reactor-name').clientWidth`);
        assert.equal(await run(`getComputedStyle(document.querySelector('.reactor-name')).textOverflow`), 'clip', 'The name fits without ellipsis');
        if (name === 'Nova') {
          const size = await run(`(() => { const el = document.querySelector('.reactor-name'); return { font: parseFloat(getComputedStyle(el).fontSize), width: el.clientWidth, natural: el.scrollWidth, compact: document.documentElement.dataset.jimmyDesktop }; })()`);
          assert.ok(size.font >= 20, `Short names regain the normal font size: ${JSON.stringify(size)}`);
        }
      }
    }
    const command = async text => {
      await run(`(() => { const input = document.querySelector('#jimmy-chat input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(text)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await new Promise(resolve => setTimeout(resolve, 50));
      await run(`document.querySelector('#jimmy-chat form').requestSubmit()`);
    };
    await command('Nova, minimize');
    await wait(`window.__hideCount === 1`);
    assert.equal(await run(`document.documentElement.dataset.jimmyDesktop`), 'expanded', 'Minimize hides without collapsing to circle mode');
    await command('Nova, open dashboard');
    await wait(`window.__expandCalls?.at(-1) === true`);
    await command('Nova, circle mode');
    await wait(`window.__expandCalls?.at(-1) === false`);
    await command('Nova, show dashboard');
    await wait(`window.__expandCalls?.at(-1) === true`);
  } finally { viewer.destroy(); }
  console.log('Passed: real chat → canvas, lists/tables/charts/diagrams, framed email data, to-do routing, concise speech, popup fallback, separate-window sync/reload, privacy, responsive width and rejected executable content. APIs mocked.');
}

async function main() {
  if (process.versions.electron) {
    const { app, BrowserWindow, session } = require('electron');
    app.disableHardwareAcceleration();
    await fs.mkdir(path.join(process.env.JIMMY_LAYOUT_TEST_DIR, 'user-data'), { recursive: true });
    app.setPath('userData', path.join(process.env.JIMMY_LAYOUT_TEST_DIR, 'user-data'));
    await app.whenReady();
    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
      details.requestHeaders.Authorization = 'Basic ' + Buffer.from(`${process.env.JIMMY_AUTH_USERNAME || process.env.JOHNNY_AUTH_USERNAME}:${process.env.JIMMY_AUTH_PASSWORD || process.env.JOHNNY_AUTH_PASSWORD}`).toString('base64');
      callback({ requestHeaders: details.requestHeaders });
    });
    const win = new BrowserWindow({ width: 200, height: 312, useContentSize: true, frame: false, show: false, transparent: true, webPreferences: { preload: path.join(process.env.JIMMY_LAYOUT_TEST_DIR, 'preload.cjs'), contextIsolation: false, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
    await win.loadURL('http://127.0.0.1:3108');
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await win.webContents.executeJavaScript(`Boolean(document.querySelector('.desktop-toolbar') && document.querySelector('.activity-indicator'))`)) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await win.webContents.executeJavaScript('document.fonts.ready');
    const check = () => win.webContents.executeJavaScript(`(() => {
      const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width }; };
      const controls = [...document.querySelectorAll('.jimmy-controls button')].filter(el => el.getBoundingClientRect().width).map(el => ({ text: el.textContent, top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom }));
      return { reactor: box('.reactor-face'), toolbar: box('.desktop-toolbar'), bottom: box('.jimmy-bottom'), controls, notices: document.querySelector('.jimmy-notices')?.textContent || '', height: innerHeight, compact: document.documentElement.dataset.jimmyDesktop };
    })()`);
    for (const errorsVisible of [false, true]) {
      if (errorsVisible) {
        await win.webContents.executeJavaScript(`window.__desktopState({ expanded: false, muted: false, awake: false, phase: 'Ready', error: 'Voice service unavailable. Check Settings.' })`);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const layout = await check();
      if (errorsVisible) assert.match(layout.notices, /Voice service unavailable/);
      assert.equal(layout.compact, 'compact');
      assert.ok(layout.reactor.width >= 120, JSON.stringify(layout));
      assert.ok(layout.reactor.top >= layout.toolbar.bottom, 'Toolbar stays above the reactor');
      assert.ok(layout.bottom.top >= layout.reactor.bottom, 'Bottom controls and notices stay below the reactor');
      assert.ok(layout.bottom.bottom <= layout.height + 1, JSON.stringify(layout));
      assert.equal(layout.controls.length, 3, 'Journal, push-to-talk and wake-word controls remain visible');
      for (const button of layout.controls) assert.ok(button.top >= layout.reactor.bottom && button.bottom <= layout.height, button.text);
      win.webContents.invalidate();
      await new Promise(resolve => setTimeout(resolve, 150));
      await fs.writeFile(path.join(process.cwd(), '.jimmy-runtime', errorsVisible ? 'compact-with-notice.png' : 'compact-fixed.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
    }
    console.log('Passed: real compact renderer at 200×312, journal on, all controls visible, no reactor overlap, and bounded error notices. No microphone or app commands used.');
    if (process.argv.includes('--canvas')) await checkCanvas(win, BrowserWindow);
    app.exit(0);
    return;
  }
  const { spawn } = require('node:child_process');
  const { loadEnvFile } = require('node:process');
  loadEnvFile('.env.local');
  await fs.mkdir('.jimmy-runtime', { recursive: true });
  const temporary = await fs.mkdtemp(path.resolve('.jimmy-runtime/layout-test-'));
  const preload = `
    let state = { expanded: false, muted: false, awake: false, phase: 'Ready', error: '' };
    window.jimmyDesktop = { getState: async () => state, wake: async () => { state = { ...state, awake: true }; return state; }, hide: async () => { window.__hideCount = (window.__hideCount || 0) + 1; }, expand: async expanded => { (window.__expandCalls ||= []).push(expanded); state = { ...state, expanded }; window.__desktopState(state); return state; }, onState: callback => { window.__desktopState = next => { state = next; callback(next); }; return () => {}; } };
    window.open = url => { window.__canvasURL = url; return null; };
    window.__speech = [];
    window.__modelSettings = { keepLoaded: false, model: 'qwen3:4b-instruct', models: [{ name: 'qwen3:4b-instruct', size: 2e9 }, { name: 'friend:14b', size: 9e9 }], modelsError: '' };
    const originalFetch = window.fetch.bind(window);
    window.fetch = (url, options) => {
      if (!String(url).includes('/api/')) return originalFetch(url, options);
      if (String(url).includes('/api/resources')) return Promise.resolve(Response.json({ error: 'Resources are not part of this UI fixture.' }, { status: 503 }));
      if (String(url).includes('/api/model-settings')) {
        if (options?.method === 'POST') { window.__lastModelSettingsBody = JSON.parse(options.body); Object.assign(window.__modelSettings, window.__lastModelSettingsBody); }
        return Promise.resolve(Response.json(window.__modelSettings));
      }
      if (String(url).includes('/api/ollama-chat')) { window.__lastChatBody = JSON.parse(options.body); return Promise.resolve(new Response(window.__modelReply || 'Hello.', { headers: { 'Content-Type': window.__modelContentType || 'text/plain', 'X-Chat-Brain': 'qwen' } })); }
      if (String(url).includes('/api/todos')) return Promise.resolve(Response.json({ day: '2026-10-15', label: 'today', exists: true, tasks: [{ id: 'fixture', text: 'PRIVATE-TODO-SENTINEL', done: false, time: '15:00' }], reply: 'Your task: PRIVATE-TODO-SENTINEL' }));
      if (String(url).includes('/api/tts') && options?.method === 'POST') { window.__lastTtsBody = JSON.parse(options.body); window.__speech.push(window.__lastTtsBody.text); }
      if (String(url).includes('/api/activity')) return Promise.resolve(Response.json({ settings: { enabled: true, browser: false, retentionDays: 30, projects: [] } }));
      return Promise.resolve(Response.json({ tools: [], signedIn: false, pending: false, keepLoaded: false, defaultVoice: 'am_michael' }));
    };
  `;
  await fs.writeFile(path.join(temporary, 'preload.cjs'), preload);
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3108'], { windowsHide: true, stdio: 'ignore' });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      assert.equal(server.exitCode, null, 'Isolated test server must start on port 3108');
      try { ready = (await fetch('http://127.0.0.1:3108')).status === 401; } catch {}
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.ok(ready);
    const env = { ...process.env, JIMMY_LAYOUT_TEST_DIR: temporary };
    delete env.ELECTRON_RUN_AS_NODE;
    const electron = spawn(path.resolve('node_modules/electron/dist/electron.exe'), [__filename, ...process.argv.slice(2)], { env, windowsHide: true, stdio: 'inherit' });
    const timer = setTimeout(() => electron.kill(), 60000);
    try { await new Promise((resolve, reject) => { electron.once('error', reject); electron.once('exit', code => code === 0 ? resolve() : reject(new Error(`Layout test exited ${code}`))); }); }
    finally { clearTimeout(timer); }
  } finally {
    server.kill();
    // Electron may take a moment to release its isolated profile files.
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
main().catch(error => { console.error(error); if (process.versions.electron) require('electron').app.exit(1); else process.exitCode = 1; });
