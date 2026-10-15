import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = process.cwd(), nativeExec = childProcess.execFile;
await mkdir('.jimmy-runtime', { recursive: true });
const temporary = await mkdtemp(path.join(root, '.jimmy-runtime', 'chrome-test-'));
try {
  for (const source of ['app/lib/browser-links', 'app/lib/browser-search', 'app/lib/local-apps', 'app/api/_security', 'app/api/_limits', 'app/api/local-app/installed', 'app/api/local-app/route']) {
    const code = ts.transpileModule(await readFile(source + '.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from "(\.[^"]+)"/g, 'from "$1.mjs"');
    await mkdir(path.dirname(path.join(temporary, source)), { recursive: true });
    await writeFile(path.join(temporary, source + '.mjs'), code);
  }
  const calls = [];
  let launchError = null;
  childProcess.execFile = (...args) => { calls.push(args.slice(0, -1)); queueMicrotask(() => args.at(-1)(launchError, '', '')); return {}; };
  syncBuiltinESMExports();
  process.env.JIMMY_AUTH_USERNAME = 'test'; process.env.JIMMY_AUTH_PASSWORD = 'test-pass'; process.env.JIMMY_ALLOWED_HOSTS = 'localhost';
  delete process.env.CHROME_PROFILE_DIRECTORY;
  delete process.env.JIMMY_BROWSER_LINKS; delete process.env.JOHNNY_BROWSER_LINKS;
  const { POST } = await import(pathToFileURL(path.join(temporary, 'app/api/local-app/route.mjs')));
  const request = body => new Request('http://localhost/api/local-app', { method: 'POST', headers: { host: 'localhost', 'Content-Type': 'application/json', authorization: 'Basic ' + Buffer.from('test:test-pass').toString('base64') }, body: JSON.stringify(body) });
  assert.equal((await POST(request({ action: 'open-link', name: 'chatgpt' }))).status, 200);
  assert.equal(calls.at(-1)[1].at(-1), "Start-Process -FilePath 'https://chatgpt.com/' -ErrorAction Stop", 'Unconfigured installs retain the system default browser');

  const fakeChrome = path.join(temporary, 'chrome.exe');
  await writeFile(fakeChrome, 'not an executable');
  process.env.CHROME_PATH = fakeChrome;
  process.env.CHROME_PROFILE_DIRECTORY = 'Profile 10';
  assert.equal((await POST(request({ action: 'open', app: 'chrome' }))).status, 200);
  const chromeScript = calls.at(-1)[1].at(-1);
  assert.match(chromeScript, /--profile-directory="Profile 10"/);
  assert.match(chromeScript, /--new-window/);
  assert.match(chromeScript, /The configured Chrome profile folder was not found/);
  assert.match(chromeScript, /\$env:ELECTRON_RUN_AS_NODE = \$null/);
  const browserRequests = [
    { action: 'open', app: 'chatgpt' },
    { action: 'open-link', name: 'n8n' },
    { action: 'search', query: "Jimmy's browser", images: false },
    { action: 'open-youtube', url: 'https://www.youtube.com/watch?v=test' },
  ];
  let urlScript;
  for (const body of browserRequests) {
    assert.equal((await POST(request(body))).status, 200, body.action);
    urlScript = calls.at(-1)[1].at(-1);
    assert.match(urlScript, /--profile-directory="Profile 10"/, 'Every browser path targets the configured profile');
    assert.ok(!urlScript.includes('--new-window'), 'URLs open in the selected profile without forcing another window');
    assert.match(urlScript, /"https?:\/\//);
  }
  const before = calls.length;
  process.env.CHROME_PROFILE_DIRECTORY = "Default'; calc; #";
  assert.equal((await POST(request({ action: 'open', app: 'chrome' }))).status, 400);
  assert.equal((await POST(request({ action: 'open-link', name: 'chatgpt' }))).status, 400);
  assert.equal(calls.length, before, 'Invalid profile directories never reach PowerShell');
  process.env.CHROME_PROFILE_DIRECTORY = 'Default';
  assert.equal((await POST(request({ action: 'open', app: 'brave' }))).status, 200);
  assert.ok(!calls.at(-1)[1].at(-1).includes('--profile-directory'), 'Other apps receive no Chrome flags');
  launchError = new Error('Chrome was not found. Set CHROME_PATH in .env.local');
  assert.equal((await POST(request({ action: 'open', app: 'chrome' }))).status, 500);
  assert.equal(calls.length, before + 2, 'A missing Chrome executable cannot fall back to a launcher that ignores the chosen profile');

  if (process.platform === 'win32') {
    const run = promisify(nativeExec);
    await mkdir(path.join(temporary, 'Google/Chrome/User Data/Profile 10'), { recursive: true });
    const mocks = `
      function Start-Process {
        param($FilePath, [string[]]$ArgumentList)
        if ($env:ELECTRON_RUN_AS_NODE) { throw 'Electron mode leaked' }
        if ($ArgumentList -notcontains '--profile-directory="Profile 10"') { throw 'Profile argument lost its quotes' }
      }
      function Get-Process { [pscustomobject]@{ Path = $path; MainWindowHandle = 1 } }
    `;
    const options = { windowsHide: true, timeout: 15000, env: { ...process.env, LOCALAPPDATA: temporary, ELECTRON_RUN_AS_NODE: '1' } };
    for (const script of [chromeScript, urlScript]) {
      assert.match((await run(calls[0][0], ['-NoProfile', '-Command', `${mocks}\n${script}`], options)).stdout, /chrome\.exe/);
    }
    await assert.rejects(run(calls[0][0], ['-NoProfile', '-Command', `${mocks}\n${chromeScript}`], { ...options, env: { ...options.env, LOCALAPPDATA: path.join(temporary, 'missing') } }), /profile folder was not found/);
  }
  console.log('Passed: shared Chrome profile for app/sites/search/YouTube, safe quoting, missing profile/executable failures, other-app isolation and system-browser fallback. Browser launches mocked.');
} finally {
  childProcess.execFile = nativeExec;
  syncBuiltinESMExports();
  await rm(temporary, { recursive: true, force: true });
}
