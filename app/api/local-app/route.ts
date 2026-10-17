import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { resolveBrowserLink, UnknownBrowserShortcutError } from "../../lib/browser-links";
import { browserSearchUrl } from "../../lib/browser-search";
import { validAppName } from "../../lib/local-apps";
import { AppDiscoveryError, closeInstalledApp, openInstalledApp } from "./installed";

import { readJsonObject } from "../_limits";
import { protectApiRequest } from "../_security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AppKey = "brave" | "chrome" | "visual-studio" | "steam";

type AppDefinition = {
  displayName: string;
  envVar: string;
  candidates: string[];
  processNames: string[];
};

const execFileAsync = promisify(execFile);
const POWERSHELL_PATH =
  "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";

const APPS: Record<AppKey, AppDefinition> = {
  brave: {
    displayName: "Brave",
    envVar: "BRAVE_PATH",
    candidates: [
      "C:\\Users\\Jahred Uy\\AppData\\Local\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
      "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
      "C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    ],
    processNames: ["brave"],
  },
  chrome: {
    displayName: "Chrome",
    envVar: "CHROME_PATH",
    candidates: [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    ],
    processNames: ["chrome"],
  },
  "visual-studio": {
    displayName: "Visual Studio Code",
    envVar: "VISUAL_STUDIO_PATH",
    candidates: [
      "C:\\Users\\Jahred Uy\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe",
      "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\Common7\\IDE\\devenv.exe",
      "C:\\Program Files\\Microsoft Visual Studio\\2022\\Professional\\Common7\\IDE\\devenv.exe",
      "C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise\\Common7\\IDE\\devenv.exe",
      "C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Community\\Common7\\IDE\\devenv.exe",
      "C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Professional\\Common7\\IDE\\devenv.exe",
      "C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Enterprise\\Common7\\IDE\\devenv.exe",
    ],
    processNames: ["Code", "devenv"],
  },
  steam: {
    displayName: "Steam",
    envVar: "STEAM_PATH",
    candidates: [
      "C:\\Program Files (x86)\\Steam\\steam.exe",
      "C:\\Program Files\\Steam\\steam.exe",
    ],
    processNames: ["steam"],
  },
};

function isAppKey(value: unknown): value is AppKey {
  return (
    value === "brave" ||
    value === "chrome" ||
    value === "visual-studio" ||
    value === "steam"
  );
}

function getCandidatePaths(app: AppDefinition) {
  const configuredPath = process.env[app.envVar];

  return configuredPath
    ? [configuredPath, ...app.candidates]
    : app.candidates;
}

function toPowerShellString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function getLaunchScript(app: AppDefinition, url?: string) {
  const paths = getCandidatePaths(app).map(toPowerShellString).join(",");
  const profile = app === APPS.chrome ? process.env.CHROME_PROFILE_DIRECTORY?.trim() : "";
  if (profile && !/^(?:Default|Profile \d+)$/.test(profile)) throw new AppDiscoveryError("CHROME_PROFILE_DIRECTORY must be Default or a profile folder such as Profile 10.", 400);
  const args = [
    ...(profile ? [`--profile-directory="${profile}"`] : []),
    ...(url ? [`"${url}"`] : app === APPS.chrome && profile ? ["--new-window"] : []),
  ];

  return [
    // The desktop server runs under Electron's Node mode; GUI apps must not inherit it.
    "$env:ELECTRON_RUN_AS_NODE = $null",
    ...(profile ? [
      `$profilePath = Join-Path $env:LOCALAPPDATA ${toPowerShellString(`Google\\Chrome\\User Data\\${profile}`)}`,
      `if (!(Test-Path -LiteralPath $profilePath -PathType Container)) { throw 'The configured Chrome profile folder was not found. Check CHROME_PROFILE_DIRECTORY; no other profile was opened.' }`,
    ] : []),
    `$paths = @(${paths})`,
    "foreach ($path in $paths) {",
    "  if (Test-Path -LiteralPath $path -PathType Leaf) {",
    `    Start-Process -FilePath $path${args.length ? ` -ArgumentList @(${args.map(toPowerShellString).join(",")})` : ""} -ErrorAction Stop`,
    "    $name = [System.IO.Path]::GetFileNameWithoutExtension($path)",
    "    for ($attempt = 0; $attempt -lt 40; $attempt++) {",
    "      $window = Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $path -and $_.MainWindowHandle -ne 0 }",
    "      if ($window) { Write-Output $path; exit 0 }",
    "      Start-Sleep -Milliseconds 250",
    "    }",
    `    throw ${toPowerShellString(`No visible ${app.displayName} window was found within 10 seconds. The launch could not be confirmed; the app may still open later.`)}`,
    "  }",
    "}",
    `Write-Error ${toPowerShellString(
      `${app.displayName} was not found. Set ${app.envVar} in .env.local if it is installed somewhere else.`,
    )}`,
    "exit 1",
  ].join("\n");
}

async function openBrowserUrl(url: string, signal: AbortSignal) {
  const script = process.env.CHROME_PROFILE_DIRECTORY?.trim()
    ? getLaunchScript(APPS.chrome, url)
    : `Start-Process -FilePath ${toPowerShellString(url)} -ErrorAction Stop`;
  await execFileAsync(POWERSHELL_PATH, ["-NoProfile", "-Command", script], { signal, timeout: 15000, windowsHide: true });
}

function getCloseScript(apps: AppDefinition[]) {
  const processNames = [
    ...new Set(apps.flatMap((app) => app.processNames)),
  ].map(toPowerShellString).join(",");

  return [
    `$names = @(${processNames})`,
    "$closed = @()",
    "foreach ($name in $names) {",
    "  $processes = Get-Process -Name $name -ErrorAction SilentlyContinue",
    "  foreach ($process in $processes) {",
    "    try {",
    "      if ($process.CloseMainWindow()) {",
    "        $closed += $process.ProcessName",
    "      }",
    "    } catch {}",
    "  }",
    "}",
    "Start-Sleep -Milliseconds 900",
    "foreach ($name in $names) {",
    "  $processes = Get-Process -Name $name -ErrorAction SilentlyContinue",
    "  foreach ($process in $processes) {",
    "    try {",
    "      if (!$process.HasExited) {",
    "        Stop-Process -Id $process.Id -Force",
    "        $closed += $process.ProcessName",
    "      }",
    "    } catch {}",
    "  }",
    "}",
    "Write-Output ($closed | Select-Object -Unique | ConvertTo-Json -Compress)",
    "exit 0",
  ].join("\n");
}

async function openNamedApp(name: string, signal: AbortSignal) {
  let url: string;
  try { url = resolveBrowserLink(name, process.env.JIMMY_BROWSER_LINKS ?? process.env.JOHNNY_BROWSER_LINKS ?? "{}", process.env.N8N_URL || "http://localhost:5678"); }
  catch (error) {
    if (error instanceof UnknownBrowserShortcutError) return openInstalledApp(name, signal);
    throw new AppDiscoveryError(error instanceof Error ? error.message : "Invalid browser shortcut.", 400);
  }
  await openBrowserUrl(url, signal);
  return { displayName: name, url, reply: process.env.CHROME_PROFILE_DIRECTORY?.trim() ? `Asked Chrome to open ${name} in your selected profile.` : `Asked your default browser to open ${name}.` };
}

export async function POST(request: Request) {
  const securityError = protectApiRequest(request, {
    scope: "local-app",
    limit: 12,
    loopbackOnly: true,
  });

  if (securityError) {
    return securityError;
  }

  try {
    const bodyResult = await readJsonObject(request, 4_096);

    if (!bodyResult.ok) {
      return bodyResult.response;
    }

    const { action, app: requestedApp } = bodyResult.value;
    if (action === "audio-settings") {
      const pages = { bluetooth: "ms-settings:bluetooth", mixer: "ms-settings:apps-volume" } as const;
      const page = bodyResult.value.page;
      if (page !== "bluetooth" && page !== "mixer") return Response.json({ error: "Choose Bluetooth settings or the volume mixer." }, { status: 400 });
      if (process.platform !== "win32") return Response.json({ error: "These shortcuts require Windows. Open your system's Bluetooth or sound settings." }, { status: 400 });
      await execFileAsync(POWERSHELL_PATH, ["-NoProfile", "-Command", `Start-Process -FilePath '${pages[page]}'`], { signal: request.signal, timeout: 15000, windowsHide: true });
      return Response.json({ action, page });
    }

    if (action === "open-youtube") {
      let url: URL;
      try {
        if (typeof bodyResult.value.url !== "string" || bodyResult.value.url.length > 2000) throw new Error();
        url = new URL(bodyResult.value.url);
        if (url.protocol !== "https:" || url.hostname !== "www.youtube.com" || url.port || url.username || url.password || !["/watch", "/results"].includes(url.pathname)) throw new Error();
      } catch { return Response.json({ error: "Invalid YouTube playback URL." }, { status: 400 }); }
      await openBrowserUrl(url.href, request.signal);
      return Response.json({ action });
    }

    if (action === "open-link") {
      const { name } = bodyResult.value;
      if (typeof name !== "string" || !name.trim() || name.length > 100) {
        return Response.json({ error: "Provide a shortcut name of 1–100 characters." }, { status: 400 });
      }
      return Response.json({ action, name, ...await openNamedApp(name, request.signal) });
    }

    if (action === "search") {
      const { query, images } = bodyResult.value;
      if (typeof query !== "string" || !query.trim() || query.length > 500 || typeof images !== "boolean") {
        return Response.json({ error: "Provide a search query of 1–500 characters and an image search mode." }, { status: 400 });
      }
      const url = browserSearchUrl(query.trim(), images);
      await openBrowserUrl(url, request.signal);
      return Response.json({ action, url });
    }

    if (action !== "open" && action !== "close" && action !== "close-all") {
      return Response.json({ error: "That app action is not allowed." }, { status: 400 });
    }

    if (action === "open" && !isAppKey(requestedApp)) {
      if (!validAppName(requestedApp)) return Response.json({ error: "Say an app name without a file path or command." }, { status: 400 });
      return Response.json({ action, app: requestedApp, ...await openNamedApp(requestedApp, request.signal) });
    }
    if (action === "close" && !isAppKey(requestedApp)) {
      if (!validAppName(requestedApp)) return Response.json({ error: "Say an app name without a file path or command." }, { status: 400 });
      return Response.json({ action, app: requestedApp, ...await closeInstalledApp(requestedApp, request.signal) });
    }

    if (action === "close-all") {
      await execFileAsync(
        POWERSHELL_PATH,
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          getCloseScript(Object.values(APPS)),
        ],
        {
          signal: request.signal,
          timeout: 15000,
          windowsHide: true,
        },
      );

      return Response.json({
        action,
        displayName: "approved apps",
      });
    }

    if (!isAppKey(requestedApp)) {
      return Response.json({ error: "That app is not allowed." }, { status: 400 });
    }

    const appKey = requestedApp;
    const app = APPS[appKey];
    const script = action === "close" ? getCloseScript([app]) : getLaunchScript(app);

    try { await execFileAsync(
      POWERSHELL_PATH,
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      {
        signal: request.signal,
        timeout: 15000,
        windowsHide: true,
      },
    ); } catch (error) {
      if (action === "open" && error instanceof Error && error.message.includes("was not found. Set")) {
        if (appKey === "chrome" && process.env.CHROME_PROFILE_DIRECTORY?.trim()) throw error;
        return Response.json({ action, app: appKey, ...await openInstalledApp(app.displayName, request.signal) });
      }
      throw error;
    }

    return Response.json({ action, app: appKey, displayName: app.displayName });
  } catch (error) {
    if (error instanceof AppDiscoveryError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Local app command failed", error);

    return Response.json(
      { error: "I couldn't complete that app command. Please try again." },
      { status: 500 },
    );
  }
}
