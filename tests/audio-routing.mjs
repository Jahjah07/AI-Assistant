import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { promisify } from 'node:util';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
const temporary = await mkdtemp(path.join(tmpdir(), 'jimmy-audio-'));
const nativeExec = childProcess.execFile, nativeStorage = globalThis.localStorage;
try {
  for (const source of ['app/lib/audio-devices', 'app/lib/voice-commands', 'app/lib/local-files', 'app/lib/todos', 'app/lib/browser-links', 'app/lib/browser-search', 'app/lib/local-apps', 'app/api/_security', 'app/api/_limits', 'app/api/local-app/installed', 'app/api/local-app/route']) {
    const code = ts.transpileModule(await readFile(source + '.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from "(\.[^"]+)"/g, 'from "$1.mjs"');
    await mkdir(path.dirname(path.join(temporary, source)), { recursive: true }); await writeFile(path.join(temporary, source + '.mjs'), code);
  }
  const load = name => import(pathToFileURL(path.join(temporary, name + '.mjs')));
  const { parseBrowserLink, resolveBrowserLink } = await load('app/lib/browser-links');
  for (const phrase of ['Jimmy open my local n8n', 'Jimmy, open n8n', 'Open local n8n', 'Could you open my n8n in my browser?']) {
    assert.equal(parseBrowserLink(phrase), 'n8n');
  }
  assert.equal(parseBrowserLink('Do not open n8n'), null);
  assert.equal(resolveBrowserLink('n8n'), 'http://localhost:5678/');
  assert.equal(resolveBrowserLink('n8n', '{}', 'http://localhost:6789/api/v1'), 'http://localhost:6789/');
  assert.equal(resolveBrowserLink('n8n', '{"n8n":"http://localhost:7890"}'), 'http://localhost:7890/');
  assert.throws(() => resolveBrowserLink('n8n', '{}', 'javascript:alert(1)'));
  assert.throws(() => resolveBrowserLink('n8n', '{}', 'http://user:secret@localhost:5678'));
  const values = new Map(); globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const audio = await load('app/lib/audio-devices');
  assert.equal(audio.savedVoiceVolume(), 1); audio.saveVoiceVolume(0.3); assert.equal(audio.savedVoiceVolume(), 0.3);
  assert.throws(() => audio.saveVoiceVolume(1.01)); assert.throws(() => audio.saveVoiceVolume(NaN));
  const devices = [
    { kind: 'audiooutput', deviceId: 'default', label: 'Default - Speakers' },
    { kind: 'audiooutput', deviceId: 'communications', label: 'Speakers' },
    { kind: 'audioinput', deviceId: 'mic', label: 'Realtek microphone' },
    { kind: 'audiooutput', deviceId: 'internal', label: 'Speakers (Realtek Audio)' },
    { kind: 'audiooutput', deviceId: 'bluetooth', label: 'Headphones (Bluetooth)' },
  ];
  assert.equal(audio.selectVoiceOutput(devices, 'my laptop speakers').deviceId, 'internal');
  assert.equal(audio.selectVoiceOutput(devices, 'Bluetooth').deviceId, 'bluetooth');
  assert.equal(audio.selectVoiceOutput(devices, 'system default').deviceId, '');
  assert.throws(() => audio.selectVoiceOutput([...devices, { kind: 'audiooutput', deviceId: 'other', label: 'Internal Speakers' }], 'laptop speakers'), /More than one/);
  assert.throws(() => audio.selectVoiceOutput([], 'laptop speakers'), /not available/);
  let sink;
  await audio.routeAudio({ setSinkId: async id => { sink = id; } }, 'internal'); assert.equal(sink, 'internal');
  await assert.rejects(audio.routeAudio({ setSinkId: async () => { throw new Error('Disconnected'); } }, 'internal'), /Disconnected/);
  assert.equal(sink, 'internal', 'An unavailable selected device never silently falls back to the music speaker');
  const { parseVoiceCommand } = await load('app/lib/voice-commands');
  assert.equal(parseVoiceCommand('Jimmy, use laptop speakers for your voice').kind, 'audio-output');
  assert.equal(parseVoiceCommand('Set your voice volume to 30 percent').percent, 30);
  assert.equal(parseVoiceCommand('Open Bluetooth settings').page, 'bluetooth');
  assert.equal(parseVoiceCommand('Connect my Bluetooth speaker').page, 'bluetooth');
  assert.equal(parseVoiceCommand('Open Windows volume mixer').page, 'mixer');
  assert.equal(parseVoiceCommand('Do not change your voice volume to 30 percent'), null);
  const calls = [];
  let launchError = null;
  childProcess.execFile = (...args) => { calls.push(args.slice(0, -1)); queueMicrotask(() => args.at(-1)(launchError, '', '')); return {}; };
  syncBuiltinESMExports();
  process.env.JIMMY_AUTH_USERNAME = 'test'; process.env.JIMMY_AUTH_PASSWORD = 'test-pass'; process.env.JIMMY_ALLOWED_HOSTS = 'localhost';
  const { POST } = await load('app/api/local-app/route');
  const request = (page, auth = true) => new Request('http://localhost/api/local-app', { method: 'POST', headers: { host: 'localhost', 'Content-Type': 'application/json', ...(auth ? { authorization: 'Basic ' + Buffer.from('test:test-pass').toString('base64') } : {}) }, body: JSON.stringify({ action: 'audio-settings', page }) });
  assert.equal((await POST(request('bluetooth', false))).status, 401);
  assert.equal((await POST(request("bluetooth'; Start-Process calc"))).status, 400); assert.equal(calls.length, 0);
  for (const page of ['bluetooth', 'mixer']) assert.equal((await POST(request(page))).status, process.platform === 'win32' ? 200 : 400);
  if (process.platform === 'win32') {
    assert.deepEqual(calls.map(call => call[1].at(-1)), ["Start-Process -FilePath 'ms-settings:bluetooth'", "Start-Process -FilePath 'ms-settings:apps-volume'"]);
    assert.ok(calls.every(call => call[2].windowsHide === true));
  }
  process.env.N8N_URL = 'http://localhost:6789/api/v1';
  delete process.env.JIMMY_BROWSER_LINKS; delete process.env.JOHNNY_BROWSER_LINKS;
  const openLink = new Request('http://localhost/api/local-app', { method: 'POST', headers: { host: 'localhost', 'Content-Type': 'application/json', authorization: 'Basic ' + Buffer.from('test:test-pass').toString('base64') }, body: JSON.stringify({ action: 'open-link', name: 'n8n' }) });
  assert.equal((await POST(openLink)).status, 200);
  assert.equal(calls.at(-1)[1].at(-1), "Start-Process -FilePath 'http://localhost:6789/' -ErrorAction Stop");
  const openCode = () => new Request('http://localhost/api/local-app', { method: 'POST', headers: { host: 'localhost', 'Content-Type': 'application/json', authorization: 'Basic ' + Buffer.from('test:test-pass').toString('base64') }, body: JSON.stringify({ action: 'open', app: 'visual-studio' }) });
  assert.equal((await POST(openCode())).status, 200);
  const launchScript = calls.at(-1)[1].at(-1);
  assert.match(launchScript, /\$env:ELECTRON_RUN_AS_NODE = \$null/);
  assert.match(launchScript, /Start-Process -FilePath \$path -ErrorAction Stop/);
  assert.match(launchScript, /MainWindowHandle -ne 0/);
  launchError = new Error('The launch could not be confirmed');
  const failedLaunch = await POST(openCode());
  assert.equal(failedLaunch.status, 500);
  assert.match((await failedLaunch.json()).error, /launch could not be confirmed/);
  if (process.platform === 'win32') {
    const run = promisify(nativeExec);
    const mocks = `
      function Test-Path { $true }
      function Start-Sleep {}
      function Start-Process {
        if ($env:ELECTRON_RUN_AS_NODE) { throw 'Electron Node mode leaked to the app' }
        if ($mode -eq 'failed') { throw 'Simulated start failure' }
      }
      $checks = 0
      function Get-Process {
        $script:checks++
        $handle = if ($mode -eq 'wrong-path' -or $mode -eq 'visible' -and $script:checks -ge 2) { 1 } else { 0 }
        $processPath = if ($mode -eq 'wrong-path') { 'C:\\other\\Code.exe' } else { $path }
        [pscustomobject]@{ Path = $processPath; MainWindowHandle = $handle }
      }
    `;
    for (const mode of ['visible', 'failed', 'no-window', 'wrong-path']) {
      const result = run(calls.at(-1)[0], ['-NoProfile', '-Command', `$mode = '${mode}'; ${mocks}\n${launchScript}`], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, timeout: 15000 });
      if (mode === 'visible') assert.match((await result).stdout, /Code\.exe/);
      else await assert.rejects(result, mode === 'failed' ? /Simulated start failure/ : /launch could not be confirmed/);
    }
  }
  console.log('Passed: audio routing, voice commands, authenticated Windows shortcuts, app launch environment, delayed window confirmation, launch failures, and rejection of missing or unrelated windows. App launches and settings were mocked.');
} finally { childProcess.execFile = nativeExec; syncBuiltinESMExports(); if (nativeStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = nativeStorage; await rm(temporary, { recursive: true, force: true }); }
