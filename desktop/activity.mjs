import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { watch } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';

const exec = promisify(execFile);
export function startActivityTracker(root, origin) {
  const authorization = `Basic ${Buffer.from(`${process.env.JIMMY_AUTH_USERNAME}:${process.env.JIMMY_AUTH_PASSWORD}`).toString('base64')}`;
  let stopped = false, pending = false, collector, lastWindow = '', projectsKey = '', lastGit = 0;
  let settings = { enabled: false, projects: [] };
  const watchers = [];
  const changes = new Set();
  const gitStates = new Map();
  async function request(body) {
    const response = await fetch(`${origin}/api/activity${body ? '' : '?config=1'}`, {
      headers: { Authorization: authorization, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Activity service unavailable');
    return response.json();
  }
  const record = (kind, text) => request({ action: 'record', kind, text });
  const stopCollector = () => { collector?.kill(); collector = undefined; lastWindow = ''; };
  async function tick() {
    if (pending || stopped) return;
    pending = true;
    try {
      settings = (await request()).settings;
      if (stopped) return;
      if (!settings.enabled) { stopCollector(); }
      else if (!collector && process.platform === 'win32') {
        collector = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
          ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'desktop/activity.ps1')], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
        const child = collector;
        createInterface({ input: child.stdout }).on('line', line => {
          try {
            const { app, title } = JSON.parse(line);
            if (stopped || !settings.enabled || !app || !title || /incognito|inprivate/i.test(title) || /^jimmy$/i.test(title) || /^(?:LockApp|LogonUI)$/i.test(app)) return;
            const text = `${app} — ${title}`;
            const key = `${Math.floor(Date.now() / 300000)}|${text}`;
            if (key !== lastWindow) { lastWindow = key; void record('window', text).catch(() => { lastWindow = ''; }); }
          } catch { /* Non-JSON output is not activity. */ }
        });
        child.on('error', () => { if (collector === child) collector = undefined; });
        child.on('exit', () => { if (collector === child) collector = undefined; });
      }
      const nextProjects = JSON.stringify(settings.enabled ? settings.projects : []);
      if (nextProjects !== projectsKey) {
        watchers.splice(0).forEach(watcher => watcher.close()); changes.clear(); gitStates.clear(); lastGit = 0;
        projectsKey = nextProjects;
        if (settings.enabled) for (const project of settings.projects) {
          try {
            const watcher = watch(project, { recursive: true }, (event, filename) => {
              if (!filename || /(?:^|[/\\])(?:\.git|node_modules|\.next|\.venv|dist|build|storage|\.jimmy-runtime)(?:[/\\]|$)/.test(filename)) return;
              if (changes.size < 100) changes.add(`${path.join(project, filename)} (${event === 'rename' ? 'created, removed, or renamed' : 'changed'})`);
            });
            watcher.on('error', () => watcher.close()); watchers.push(watcher);
          } catch { await record('file', `Cannot watch project folder: ${project}`); }
        }
      }
      if (!settings.enabled) return;
      for (const text of changes) await record('file', text);
      changes.clear();
      if (Date.now() - lastGit >= 60_000) {
        lastGit = Date.now();
        for (const project of settings.projects) {
          try {
            const options = { windowsHide: true, timeout: 5000, maxBuffer: 32768, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } };
            const { stdout: status } = await exec('git', ['--no-pager', '-C', project, 'status', '--porcelain=v1', '--branch', '--untracked-files=normal'], options);
            const { stdout: commit } = await exec('git', ['--no-pager', '-C', project, 'log', '-1', '--format=%h %aI %s'], options).catch(() => ({ stdout: 'No commits yet' }));
            const text = `${project} | ${status.trim().replace(/\r?\n/g, '; ')} | Latest commit: ${commit.trim()} | Upstream comparison uses cached local refs; no fetch or push.`;
            if (gitStates.get(project) !== text) { await record('git', text.slice(0, 4000)); gitStates.set(project, text); }
          } catch { /* Non-Git folders still have file activity. */ }
        }
      }
    } catch { stopCollector(); watchers.splice(0).forEach(watcher => watcher.close()); projectsKey = ''; }
    finally { pending = false; }
  }
  const timer = setInterval(() => { void tick(); }, 10_000);
  void tick();
  return () => { stopped = true; clearInterval(timer); stopCollector(); watchers.forEach(watcher => watcher.close()); };
}
