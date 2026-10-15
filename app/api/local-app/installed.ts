import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { validAppName } from "../../lib/local-apps";
import { acquireConcurrency } from "../_limits";

type InstalledApp = { name: string; kind: "shortcut" | "store"; target: string };
export class AppDiscoveryError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
const execFileAsync = promisify(execFile);
const powershell = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const cacheFile = () => path.join(process.cwd(), "storage", "installed-apps.json");
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const normalize = (name: string) => name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const rootsScript = `$roots = @('StartMenu', 'CommonStartMenu', 'DesktopDirectory', 'CommonDesktopDirectory') | ForEach-Object { [Environment]::GetFolderPath($_) } | Where-Object { $_ } | Select-Object -Unique`;
const shortcutScript = `
function Read-AppShortcut($file) {
  if ($file.Extension -eq '.lnk') {
    $link = $shell.CreateShortcut($file.FullName)
    if ($link.TargetPath -match '^[a-zA-Z]:\\\\' -and [IO.Path]::GetExtension($link.TargetPath) -eq '.exe' -and (Test-Path -LiteralPath $link.TargetPath -PathType Leaf)) {
      return @{ executable = $link.TargetPath; identity = $link.TargetPath + '|' + $link.Arguments }
    }
  } elseif ($file.Extension -eq '.url') {
    $url = Get-Content -LiteralPath $file.FullName | Where-Object { $_ -match '^URL=' } | Select-Object -First 1
    if ($url -match '^URL=(steam://rungameid/[0-9]+|com.epicgames.launcher://apps/[^\\s]+)$') {
      return @{ executable = ''; identity = $url }
    }
  }
}
`;

// shortcut: searches Windows app registrations and shortcuts, not every drive; add another catalog if portable apps need discovery.
export const installedAppsScript = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
${rootsScript}
$shell = New-Object -ComObject WScript.Shell
${shortcutScript}
$seen = @{}
$apps = @(
  foreach ($root in $roots) {
    foreach ($file in @(Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -in '.lnk', '.url' -and $_.BaseName -notmatch '^(Uninstall|Remove|Setup)\\b' })) {
      $shortcut = Read-AppShortcut $file
      if ($shortcut -and !$seen.ContainsKey($shortcut.identity)) {
        $seen[$shortcut.identity] = $true
        @{ name = $file.BaseName; kind = 'shortcut'; target = $file.FullName }
      }
    }
  }
  foreach ($app in @(Get-StartApps -ErrorAction Stop)) {
    if ($app.AppID -match '^[\\w.-]+![\\w.-]+$') {
      @{ name = $app.Name; kind = 'store'; target = $app.AppID }
    }
  }
)
ConvertTo-Json -InputObject $apps -Compress
`;

function validApp(value: unknown): value is InstalledApp {
  if (!value || typeof value !== "object") return false;
  const app = value as InstalledApp;
  return typeof app.name === "string" && app.name.length > 0 && app.name.length <= 200 && typeof app.target === "string" && app.target.length <= 2000 &&
    (app.kind === "shortcut" && /^[a-z]:\\[^\r\n]*\.(?:lnk|url)$/i.test(app.target) || app.kind === "store" && /^[\w.-]+![\w.-]+$/.test(app.target));
}

export function findInstalledApp(name: string, apps: unknown, action: "open" | "close" = "open"): InstalledApp {
  if (!Array.isArray(apps) || !apps.every(validApp)) throw new AppDiscoveryError("Windows returned an invalid installed-app catalog. No app was launched.", 503);
  const query = normalize(name);
  const exact = apps.filter(app => normalize(app.name) === query);
  const matches = exact.length ? exact : apps.filter(app => query.split(" ").every(word => normalize(app.name).split(" ").includes(word)));
  if (!matches.length) throw new AppDiscoveryError(`I couldn't find ${name} in this device's installed apps or Start menu and desktop shortcuts.`, 404);
  if (matches.length > 1) throw new AppDiscoveryError(`I found several apps matching ${name}: ${[...new Set(matches.map(app => app.name))].slice(0, 8).join(", ")}. Say “${action}” followed by the full app name.`, 409);
  return matches[0];
}

async function readCache(): Promise<Record<string, InstalledApp>> {
  try {
    const text = await readFile(cacheFile(), "utf8");
    if (text.length > 1024 * 1024) throw new Error();
    const cache = JSON.parse(text);
    if (!cache || typeof cache !== "object" || Array.isArray(cache) || !Object.values(cache).every(validApp)) throw new Error();
    return cache;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new AppDiscoveryError("Jimmy couldn't read its saved app locations. No saved locations were overwritten.", 503);
  }
}

async function saveCache(cache: Record<string, InstalledApp>) {
  await mkdir(path.dirname(cacheFile()), { recursive: true });
  await writeFile(`${cacheFile()}.tmp`, JSON.stringify(cache, null, 2));
  await rename(`${cacheFile()}.tmp`, cacheFile());
}

function appTargetScript(app: InstalledApp) {
  return `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
$env:ELECTRON_RUN_AS_NODE = $null
$target = ${quote(app.target)}
$executable = ''
${app.kind === "store" ? `
if (!(Get-StartApps | Where-Object { $_.AppID -eq $target })) { '{"stale":true}'; exit 0 }
` : `
$target = [IO.Path]::GetFullPath($target)
${rootsScript}
if (!($roots | Where-Object { $target.StartsWith($_.TrimEnd('\\') + '\\', [StringComparison]::OrdinalIgnoreCase) }) -or !(Test-Path -LiteralPath $target -PathType Leaf)) { '{"stale":true}'; exit 0 }
$shell = New-Object -ComObject WScript.Shell
${shortcutScript}
$shortcut = Read-AppShortcut (Get-Item -LiteralPath $target)
if (!$shortcut) { '{"stale":true}'; exit 0 }
$executable = $shortcut.executable
`}
`;
}

function launchScript(app: InstalledApp) {
  return `${appTargetScript(app)}
${app.kind === "store" ? "Start-Process -FilePath (Join-Path $env:WINDIR 'explorer.exe') -ArgumentList ('shell:AppsFolder\\' + $target) -ErrorAction Stop" : "Start-Process -FilePath $target -ErrorAction Stop"}
$confirmed = $false
if ($executable) {
  $processName = [IO.Path]::GetFileNameWithoutExtension($executable)
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    if (Get-Process -Name $processName -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $executable -and $_.MainWindowHandle -ne 0 }) { $confirmed = $true; break }
    Start-Sleep -Milliseconds 250
  }
}
@{ stale = $false; confirmed = $confirmed } | ConvertTo-Json -Compress
`;
}

function closeScript(app: InstalledApp) {
  return `${appTargetScript(app)}
${app.kind === "store" ? `
$family = $target.Split('!')[0]
$package = Get-AppxPackage | Where-Object { $_.PackageFamilyName -eq $family } | Select-Object -First 1
if (!$package.InstallLocation) { '{"stale":true}'; exit 0 }
$directory = $package.InstallLocation.TrimEnd('\\') + '\\'
$manifest = Get-AppxPackageManifest -Package $package.PackageFullName
$entry = $manifest.Package.Applications.Application | Where-Object { $_.Id -eq $target.Split('!')[1] } | Select-Object -First 1
if (!$entry.Executable) { throw 'Windows did not identify the executable for this Store app. No processes were stopped.' }
$entryExecutable = $entry.Executable
if ([IO.Path]::GetFileName($entryExecutable) -eq 'GameLaunchHelper.exe') {
  [xml]$gameConfig = Get-Content -LiteralPath (Join-Path $directory 'MicrosoftGame.config') -Raw
  $gameEntry = $gameConfig.SelectNodes('//*[local-name()="Executable"]') | Where-Object { $_.GetAttribute('Id') -eq $target.Split('!')[1] } | Select-Object -First 1
  if (!$gameEntry -or !$gameEntry.GetAttribute('Name')) { throw 'Windows did not identify the game executable. No processes were stopped.' }
  $entryExecutable = $gameEntry.GetAttribute('Name')
}
$executable = [IO.Path]::GetFullPath((Join-Path $directory $entryExecutable))
if (!$executable.StartsWith($directory, [StringComparison]::OrdinalIgnoreCase)) { throw 'The Store app executable is outside its package. No processes were stopped.' }
` : `
if (!$executable -or [IO.Path]::GetFileNameWithoutExtension($executable) -in 'steam', 'EpicGamesLauncher', 'RiotClientServices', 'RobloxPlayerLauncher') { throw 'This shortcut uses a shared game launcher. I cannot safely identify the game process to close.' }
`}
$processes = @(Get-Process | Where-Object { $_.Path -eq $executable })
foreach ($process in $processes) {
  try { [void]$process.CloseMainWindow() } catch {}
}
if ($processes.Count) { Start-Sleep -Milliseconds 900 }
foreach ($process in $processes) {
  $current = Get-Process -Id $process.Id -ErrorAction SilentlyContinue
  if ($current -and $current.Path -eq $process.Path) { Stop-Process -InputObject $current -ErrorAction Stop }
}
if ($processes.Count) { Start-Sleep -Milliseconds 250 }
$remaining = @(Get-Process | Where-Object { $_.Path -eq $executable })
@{ stale = $false; found = [bool]$processes.Count; remaining = $remaining.Count } | ConvertTo-Json -Compress
`;
}

async function runScript(script: string, signal: AbortSignal) {
  const { stdout } = await execFileAsync(powershell, ["-NoProfile", "-NonInteractive", "-Command", script], { signal, windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout.trim());
}

export async function openInstalledApp(name: string, signal: AbortSignal) {
  if (!validAppName(name)) throw new AppDiscoveryError("Say an app name of 1–100 characters, without a file path or command.", 400);
  if (process.platform !== "win32") throw new AppDiscoveryError("Installed-app discovery currently requires Windows.", 400);
  const release = acquireConcurrency("installed-app-launch", 1);
  if (!release) throw new AppDiscoveryError("An app search or launch is already running. Wait for it to finish.", 409);
  try {
    const cache = await readCache();
    const key = normalize(name);
    let app = Object.hasOwn(cache, key) ? cache[key] : undefined;
    let result = app ? await runScript(launchScript(app), signal) : null;
    let discovered = false;
    if (!app || result?.stale) {
      if (app) { delete cache[key]; await saveCache(cache); }
      app = findInstalledApp(name, await runScript(installedAppsScript, signal));
      result = await runScript(launchScript(app), signal);
      if (result?.stale) throw new AppDiscoveryError(`The saved shortcut for ${app.name} is no longer available. No app was launched.`, 404);
      discovered = true;
    }
    if (!result || result.stale !== false || typeof result.confirmed !== "boolean") throw new AppDiscoveryError("Windows did not confirm the app launch request.", 503);
    if (discovered) {
      cache[key] = app;
      try { await saveCache(cache); }
      catch { throw new AppDiscoveryError(`Windows received the request to open ${app.name}, but Jimmy couldn't save its location for next time.`, 503); }
    }
    return { displayName: app.name, launchConfirmed: result.confirmed, reply: result.confirmed ? `Started the installed launcher for ${app.name}.` : `Asked Windows to open ${app.name}, but I couldn't confirm its window is open yet.` };
  } finally { release(); }
}

export async function closeInstalledApp(name: string, signal: AbortSignal) {
  if (!validAppName(name)) throw new AppDiscoveryError("Say an app name without a file path or command.", 400);
  if (process.platform !== "win32") throw new AppDiscoveryError("Installed-app commands currently require Windows.", 400);
  const release = acquireConcurrency("installed-app-launch", 1);
  if (!release) throw new AppDiscoveryError("An app command is already running. Wait for it to finish.", 409);
  try {
    const cache = await readCache();
    const key = normalize(name);
    const app = Object.hasOwn(cache, key) ? cache[key] : findInstalledApp(name, await runScript(installedAppsScript, signal), "close");
    const result = await runScript(closeScript(app), signal);
    if (result?.stale) throw new AppDiscoveryError(`The saved app location for ${app.name} is no longer available. Open it again to refresh its location before closing it.`, 404);
    if (!result || result.stale !== false || typeof result.found !== "boolean" || !Number.isInteger(result.remaining) || result.remaining < 0) throw new AppDiscoveryError("Windows did not confirm the result of the close command.", 503);
    if (result.remaining) throw new AppDiscoveryError(`${app.name} is still running. Windows could not close all of its matching processes.`, 503);
    return { displayName: app.name, reply: result.found ? `Closed ${app.name}.` : `${app.name} is not running.` };
  } finally { release(); }
}
