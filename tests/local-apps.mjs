import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = process.cwd(), nativeExec = childProcess.execFile;
await mkdir(path.join(root, '.jimmy-runtime'), { recursive: true });
const temporary = await mkdtemp(path.join(root, '.jimmy-runtime', 'apps-test-'));
try {
  for (const source of ['app/lib/local-apps', 'app/lib/browser-links', 'app/lib/browser-search', 'app/api/_security', 'app/api/_limits', 'app/api/local-app/installed', 'app/api/local-app/route']) {
    const code = ts.transpileModule(await readFile(source + '.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from "(\.[^"]+)"/g, 'from "$1.mjs"');
    await mkdir(path.dirname(path.join(temporary, source)), { recursive: true });
    await writeFile(path.join(temporary, source + '.mjs'), code);
  }
  process.chdir(temporary);
  const load = name => import(pathToFileURL(path.join(temporary, name + '.mjs')));
  const { parseLocalAppCommand, validAppName } = await load('app/lib/local-apps');
  for (const phrase of ['Open Roblox', 'Jimmy, launch Roblox!', 'Could you open my Roblox?', 'Please start Roblox', 'Run Roblox, please']) {
    assert.deepEqual(parseLocalAppCommand(phrase), { action: 'open', app: 'Roblox' });
  }
  assert.deepEqual(parseLocalAppCommand('open VSCode'), { action: 'open', app: 'visual-studio' });
  assert.deepEqual(parseLocalAppCommand('open my local n8n'), { action: 'open', app: 'n8n' });
  assert.deepEqual(parseLocalAppCommand('close all apps'), { action: 'close-all' });
  assert.deepEqual(parseLocalAppCommand('close Brave'), { action: 'close', app: 'brave' });
  for (const phrase of ['close Roblox', 'close to roblox', 'Close row blocks', 'quit rowblocks']) assert.deepEqual(parseLocalAppCommand(phrase), { action: 'close', app: 'Roblox' });
  assert.deepEqual(parseLocalAppCommand('close To Do'), { action: 'close', app: 'To Do' });
  for (const phrase of ['Do not open Roblox', 'Can you explain how to open Roblox?', 'open C:\\temp\\Roblox.exe', 'open Roblox; calc', 'open $(calc)', 'open Roblox in my browser', 'Do not close Roblox']) assert.equal(parseLocalAppCommand(phrase), null, phrase);
  for (const name of ['', '../Roblox', 'C:\\Roblox.exe', 'Roblox\ncalc', 'x'.repeat(101), 'Roblox`calc']) assert.equal(validAppName(name), false);

  const roblox = { name: 'Roblox Player', kind: 'shortcut', target: 'C:\\Apps\\Roblox Player.lnk' };
  const studio = { name: 'Roblox Studio', kind: 'shortcut', target: 'C:\\Apps\\Roblox Studio.lnk' };
  const calls = [], replies = [];
  childProcess.execFile = (...args) => {
    calls.push(args.slice(0, -1));
    const reply = replies.shift();
    queueMicrotask(() => args.at(-1)(reply instanceof Error ? reply : null, JSON.stringify(reply), ''));
    return {};
  };
  childProcess.execFile[promisify.custom] = (...args) => new Promise((resolve, reject) => {
    childProcess.execFile(...args, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr }));
  });
  syncBuiltinESMExports();
  const { openInstalledApp, closeInstalledApp, findInstalledApp, installedAppsScript } = await load('app/api/local-app/installed');
  assert.deepEqual(findInstalledApp('Roblox', [roblox]), roblox);
  assert.deepEqual(findInstalledApp('Roblox Player', [roblox, studio]), roblox);
  assert.throws(() => findInstalledApp('Roblox', [roblox, studio]), /several apps.*Roblox Player, Roblox Studio/);
  assert.throws(() => findInstalledApp('Roblox', [roblox, studio], 'close'), /Say “close”/);
  assert.throws(() => findInstalledApp('code', [{ ...roblox, name: 'Discord' }]), /couldn't find/);
  assert.throws(() => findInstalledApp('Missing app', []), /couldn't find/);
  assert.throws(() => findInstalledApp('Roblox', [{ ...roblox, target: 'https://example.com/app.exe' }]), /invalid installed-app catalog/);

  if (process.platform === 'win32') {
    replies.push([roblox], { stale: false, confirmed: true });
    const opened = await openInstalledApp('Roblox', new AbortController().signal);
    assert.equal(opened.displayName, 'Roblox Player');
    assert.equal(opened.launchConfirmed, true);
    const launchScript = calls.at(-1)[1].at(-1);
    assert.equal(JSON.parse(await readFile('storage/installed-apps.json', 'utf8')).roblox.target, roblox.target);
    assert.equal(calls.length, 2);
    replies.push({ stale: false, confirmed: false });
    const cached = await openInstalledApp('Roblox', new AbortController().signal);
    assert.equal(calls.length, 3, 'A cached app skips catalog discovery');
    assert.match(cached.reply, /couldn't confirm/);
    const moved = { ...roblox, target: 'C:\\Apps\\Moved Roblox.lnk' };
    replies.push({ stale: true }, [moved], { stale: false, confirmed: true });
    await openInstalledApp('Roblox', new AbortController().signal);
    assert.equal(JSON.parse(await readFile('storage/installed-apps.json', 'utf8')).roblox.target, moved.target, 'Moved apps are rediscovered and saved');
    const before = await readFile('storage/installed-apps.json', 'utf8');
    replies.push(new Error('Start failed'));
    await assert.rejects(openInstalledApp('Roblox', new AbortController().signal), /Start failed/);
    assert.equal(await readFile('storage/installed-apps.json', 'utf8'), before);
    replies.push([roblox, studio]);
    await assert.rejects(openInstalledApp('Roblox app', new AbortController().signal), /couldn't find/);
    replies.push([]);
    await assert.rejects(openInstalledApp('Missing', new AbortController().signal), /couldn't find/);
    await writeFile('storage/installed-apps.json', 'broken json');
    await assert.rejects(openInstalledApp('Roblox', new AbortController().signal), /No saved locations were overwritten/);
    assert.equal(await readFile('storage/installed-apps.json', 'utf8'), 'broken json');
    await writeFile('storage/installed-apps.json', before);

    // Exercise the actual PowerShell with fake Windows catalogs and launchers.
    const run = promisify(nativeExec), ps = calls[0][0];
    const quote = text => "'" + text.replaceAll("'", "''") + "'";
    const fixture = path.join(temporary, 'shortcuts');
    await mkdir(fixture);
    const fakeExe = path.join(fixture, 'RobloxPlayer.exe');
    await writeFile(fakeExe, 'not an executable');
    await writeFile(path.join(fixture, 'Fixture Game.url'), '[InternetShortcut]\nURL=steam://rungameid/1234\n');
    await writeFile(path.join(fixture, 'Web Page.url'), '[InternetShortcut]\nURL=https://example.com\n');
    const setup = `$shell = New-Object -ComObject WScript.Shell; $link = $shell.CreateShortcut(${quote(path.join(fixture, 'Roblox Player.lnk'))}); $link.TargetPath = ${quote(fakeExe)}; $link.Save()`;
    await run(ps, ['-NoProfile', '-Command', setup], { windowsHide: true });
    const replaceRoots = script => script.replace(/\$roots = @\('StartMenu'[^\n]+/, `$roots = @(${quote(fixture)})`);
    const storeMock = `function Get-StartApps { [pscustomobject]@{ Name = 'Fixture Store App'; AppID = 'Fixture_123!App' } }`;
    const catalog = JSON.parse((await run(ps, ['-NoProfile', '-Command', `${storeMock}\n${replaceRoots(installedAppsScript)}`], { windowsHide: true })).stdout);
    assert.deepEqual(catalog.map(app => app.name).sort(), ['Fixture Game', 'Fixture Store App', 'Roblox Player']);
    const testLaunch = replaceRoots(launchScript).replace(roblox.target, path.join(fixture, 'Roblox Player.lnk'));
    for (const mode of ['visible', 'no-window', 'failed', 'stale']) {
      const mocks = `
        function Start-Sleep {}
        function Start-Process {
          if ($env:ELECTRON_RUN_AS_NODE) { throw 'Electron mode leaked' }
          if ('${mode}' -eq 'failed') { throw 'Fixture launch failed' }
        }
        function Get-Process { [pscustomobject]@{ Path = $executable; MainWindowHandle = $(if ('${mode}' -eq 'visible') { 1 } else { 0 }) } }
      `;
      const script = mode === 'stale' ? testLaunch.replace('Roblox Player.lnk', 'Missing.lnk') : testLaunch;
      const result = run(ps, ['-NoProfile', '-Command', `${mocks}\n${script}`], { windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 15000 });
      if (mode === 'failed') await assert.rejects(result, /Fixture launch failed/);
      else assert.deepEqual(JSON.parse((await result).stdout), mode === 'stale' ? { stale: true } : { stale: false, confirmed: mode === 'visible' });
    }
    const outside = testLaunch.replace(path.join(fixture, 'Roblox Player.lnk'), path.join(fixture, '..', 'outside.lnk'));
    assert.deepEqual(JSON.parse((await run(ps, ['-NoProfile', '-Command', outside], { windowsHide: true })).stdout), { stale: true });
    for (const app of [
      { name: 'Fixture Store App', kind: 'store', target: 'Fixture_123!App' },
      { name: 'Fixture Game', kind: 'shortcut', target: path.join(fixture, 'Fixture Game.url') },
    ]) {
      replies.push([app], { stale: false, confirmed: false });
      assert.equal((await openInstalledApp(app.name, new AbortController().signal)).launchConfirmed, false);
      const script = replaceRoots(calls.at(-1)[1].at(-1));
      const mocks = `${storeMock}\nfunction Start-Process { if ($env:ELECTRON_RUN_AS_NODE) { throw 'Electron mode leaked' } }`;
      assert.deepEqual(JSON.parse((await run(ps, ['-NoProfile', '-Command', `${mocks}\n${script}`], { windowsHide: true })).stdout), { stale: false, confirmed: false }, 'Store and protocol games report a launch request without inventing window confirmation');
    }
    const beforeInvalid = await readFile('storage/installed-apps.json', 'utf8');
    replies.push([{ ...roblox, name: 'New app' }], { stale: false });
    await assert.rejects(openInstalledApp('New app', new AbortController().signal), /did not confirm/);
    assert.equal(await readFile('storage/installed-apps.json', 'utf8'), beforeInvalid, 'Malformed launch results cannot update the cache');
    replies.push({ stale: false, found: true, remaining: 0 });
    assert.equal((await closeInstalledApp('Fixture Store App', new AbortController().signal)).reply, 'Closed Fixture Store App.');
    const storeCloseScript = calls.at(-1)[1].at(-1);
    replies.push({ stale: false, found: false, remaining: 0 });
    assert.equal((await closeInstalledApp('Roblox', new AbortController().signal)).reply, 'Roblox Player is not running.');
    const exeCloseScript = replaceRoots(calls.at(-1)[1].at(-1)).replace(moved.target, path.join(fixture, 'Roblox Player.lnk'));
    replies.push({ stale: false, found: true, remaining: 1 });
    await assert.rejects(closeInstalledApp('Roblox', new AbortController().signal), /still running/);
    await mkdir(path.join(fixture, 'package'), { recursive: true });
    await writeFile(path.join(fixture, 'package', 'MicrosoftGame.config'), '<Game><ExecutableList><Executable Name="RobloxPlayer.exe" Id="App" /></ExecutableList></Game>');
    for (const [script, appPath] of [[storeCloseScript, path.join(fixture, 'package', 'RobloxPlayer.exe')], [exeCloseScript, fakeExe]]) {
      for (const mode of ['close', 'none', 'reused', 'denied', 'game-config']) {
        const mocks = `
          ${storeMock}
          function Get-AppxPackage { [pscustomobject]@{ PackageFamilyName = 'Fixture_123'; InstallLocation = ${quote(path.join(fixture, 'package'))} } }
          function Get-AppxPackageManifest { [pscustomobject]@{ Package = @{ Applications = @{ Application = @([pscustomobject]@{ Id = 'App'; Executable = $(if ('${mode}' -eq 'game-config') { 'GameLaunchHelper.exe' } else { 'RobloxPlayer.exe' }) }) } } } }
          function Start-Sleep {}
          $originalPath = ${quote(appPath)}
          $otherPath = ${quote(path.join(fixture, 'package-other', 'RobloxPlayer.exe'))}
          $processList = @([pscustomobject]@{ Id = 101; Path = $originalPath }, [pscustomobject]@{ Id = 102; Path = $otherPath }, [pscustomobject]@{ Id = 103; Path = ${quote(path.join(fixture, 'package', 'OtherApp.exe'))} })
          if ('${mode}' -eq 'none') { $processList = @($processList | Where-Object { $_.Id -ne 101 }) }
          $stopped = @()
          $queries = 0
          function Get-Process {
            param([int]$Id)
            if ($Id) {
              if ('${mode}' -eq 'reused' -and $Id -eq 101) { return [pscustomobject]@{ Id = 101; Path = $otherPath } }
              return $script:processList | Where-Object { $_.Id -eq $Id }
            }
            $script:queries++
            if ('${mode}' -eq 'reused' -and $script:queries -gt 1) { return $script:processList | Where-Object { $_.Id -ne 101 } }
            return $script:processList
          }
          function Stop-Process {
            param($InputObject)
            if ($InputObject.Path -ne $originalPath) { throw 'Attempted to stop an unrelated app' }
            if ('${mode}' -eq 'denied') { throw 'Access denied to fixture app' }
            $script:stopped += $InputObject.Id
            $script:processList = @($script:processList | Where-Object { $_.Id -ne $InputObject.Id })
          }
        `;
        const assertions = `if (!($processList | Where-Object { $_.Id -eq 102 }) -or !($processList | Where-Object { $_.Id -eq 103 })) { throw 'Unrelated process was removed' }; if ('${mode}' -eq 'reused' -and $stopped.Count) { throw 'Reused PID was stopped' }`;
        const result = run(ps, ['-NoProfile', '-Command', `${mocks}\n${script}\n${assertions}`], { windowsHide: true, timeout: 15000 });
        if (mode === 'denied') await assert.rejects(result, /Access denied to fixture app/);
        else assert.deepEqual(JSON.parse((await result).stdout), { stale: false, found: mode !== 'none', remaining: 0 });
      }
    }
    if (process.argv.includes('--live-scan')) {
      const live = JSON.parse((await run(ps, ['-NoProfile', '-Command', installedAppsScript], { windowsHide: true, timeout: 20000 })).stdout);
      console.log(`Read-only live catalog: ${live.length} apps; game matches: ${live.filter(app => /Roblox|Valorant|Riot/i.test(app.name)).map(app => app.name).join(', ') || 'none'}. No apps launched.`);
    }
  }

  process.env.JIMMY_AUTH_USERNAME = 'test'; process.env.JIMMY_AUTH_PASSWORD = 'test-pass'; process.env.JIMMY_ALLOWED_HOSTS = 'localhost';
  delete process.env.JIMMY_BROWSER_LINKS; delete process.env.JOHNNY_BROWSER_LINKS;
  const { POST } = await load('app/api/local-app/route');
  const request = (body, authenticated = true) => new Request('http://localhost/api/local-app', { method: 'POST', headers: { host: 'localhost', 'Content-Type': 'application/json', ...(authenticated ? { authorization: 'Basic ' + Buffer.from('test:test-pass').toString('base64') } : {}) }, body: JSON.stringify(body) });
  assert.equal((await POST(request({ action: 'open', app: 'Roblox' }, false))).status, 401);
  const callCount = calls.length;
  assert.equal((await POST(request({ action: 'open', app: "Roblox'; calc" }))).status, 400);
  assert.equal((await POST(request({ action: 'open', app: 'C:\\Roblox.exe' }))).status, 400);
  assert.equal((await POST(request({ action: 'close', app: 'Roblox; calc' }))).status, 400);
  assert.equal(calls.length, callCount, 'Invalid names never invoke PowerShell');
  replies.push({});
  assert.equal((await POST(request({ action: 'open', app: 'chatgpt' }))).status, 200, 'Website shortcuts still work');
  assert.match(calls.at(-1)[1].at(-1), /https:\/\/chatgpt.com\//);
  const commandFailure = new Error('Command failed: powershell.exe -Command PRIVATE-SCRIPT-CONTENTS');
  replies.push(commandFailure);
  const loggedErrors = [], originalConsoleError = console.error;
  console.error = (...details) => loggedErrors.push(details);
  try {
    const failed = await POST(request({ action: 'open', app: 'brave' }));
    assert.equal(failed.status, 500);
    assert.deepEqual(await failed.json(), { error: "I couldn't complete that app command. Please try again." });
    assert.equal(loggedErrors[0][1], commandFailure, 'Diagnostics stay in server logs rather than chat or speech');
  } finally { console.error = originalConsoleError; }
  if (process.platform === 'win32') {
    replies.push([]);
    assert.equal((await POST(request({ action: 'open', app: 'Missing' }))).status, 404);
    replies.push([roblox, studio]);
    assert.equal((await POST(request({ action: 'open', app: 'Roblox' + ' Studio Player' }))).status, 404);
    replies.push({ stale: false, confirmed: false });
    const response = await POST(request({ action: 'open', app: 'Roblox' }));
    assert.equal(response.status, 200);
    assert.match((await response.json()).reply, /couldn't confirm/);
    await writeFile('storage/installed-apps.json', '{}');
    replies.push([roblox, studio]);
    const ambiguous = await POST(request({ action: 'open', app: 'Roblox' }));
    assert.equal(ambiguous.status, 409, 'Ambiguous discoveries ask for the full name without launching');
    await writeFile('storage/installed-apps.json', JSON.stringify({ roblox }));
    replies.push({ stale: false, found: true, remaining: 0 });
    const closed = await POST(request({ action: 'close', app: 'Roblox' }));
    assert.equal(closed.status, 200);
    assert.equal((await closed.json()).reply, 'Closed Roblox Player.');
  }
  console.log('Passed: app command routing, name validation, matching, caching, rediscovery, launch confirmation, PowerShell shortcut/store discovery, authentication and browser compatibility. Launches mocked.');
} finally {
  childProcess.execFile = nativeExec;
  syncBuiltinESMExports();
  process.chdir(root);
  await rm(temporary, { recursive: true, force: true });
}
