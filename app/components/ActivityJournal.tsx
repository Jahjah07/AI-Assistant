"use client";

import { useEffect, useState } from "react";

type Settings = { enabled: boolean; browser: boolean; retentionDays: number; projects: string[] };
const inputStyle = "w-full rounded-lg border border-white/20 bg-zinc-900 p-2 text-sm";

export function ActivityIndicator() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const update = async () => {
      try {
        const response = await fetch("/api/activity?config=1", { signal: controller.signal });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!controller.signal.aborted) { setSettings(data.settings); setFailed(false); }
      } catch { if (!controller.signal.aborted) setFailed(true); }
    };
    void update(); const timer = setInterval(update, 10000);
    window.addEventListener("jimmy-activity", update);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener("jimmy-activity", update); };
  }, []);
  if (!settings?.enabled && !failed) return null;
  return <button type="button" className="activity-indicator" disabled={failed} title="Tracking enabled. Desktop app required for app and file recording. Click to pause all recording."
    onClick={async () => {
      try {
        const response = await fetch("/api/activity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "settings", ...settings, enabled: false }) });
        if (!response.ok) throw new Error();
        setSettings((await response.json()).settings); window.dispatchEvent(new Event("jimmy-activity"));
      } catch { setFailed(true); }
    }}>{failed ? "Journal unavailable" : "● Journal on · Pause"}</button>;
}

export default function ActivityJournal() {
  const [settings, setSettings] = useState<Settings>({ enabled: false, browser: false, retentionDays: 30, projects: [] });
  const [projects, setProjects] = useState("");
  const [day, setDay] = useState("");
  const [days, setDays] = useState<string[]>([]);
  const [journal, setJournal] = useState("");
  const [status, setStatus] = useState("");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/activity?day=${day}`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Could not load the journal.");
      const data = await response.json();
      if (controller.signal.aborted) return;
      setSettings(data.settings); setProjects(data.settings.projects.join("\n")); setDays(data.days); setJournal(data.journal); setLoaded(true);
    }).catch(error => { if (!controller.signal.aborted) setStatus(error.message); });
    return () => controller.abort();
  }, [day]);
  return <section className="space-y-4 text-sm">
    <h3 className="font-medium text-cyan-100">Daily activity journal</h3>
    <p className="text-xs leading-5 text-white/60">Records app names and window titles while the assistant’s Windows desktop app runs. Project folders add file-change paths and Git status. No chat contents, keystrokes, screenshots, or file contents are collected.</p>
    <label className="flex items-center gap-2"><input type="checkbox" disabled={!loaded} checked={settings.enabled} onChange={event => setSettings({ ...settings, enabled: event.target.checked })} /> Enable activity recording</label>
    <label className="flex items-center gap-2"><input type="checkbox" disabled={!loaded} checked={settings.browser} onChange={event => setSettings({ ...settings, browser: event.target.checked })} /> Accept page titles and URLs from the browser extension</label>
    <p className="text-xs text-white/50">Browser URLs omit query strings and fragments. Window titles can still contain sensitive names. Private browser windows are skipped where recognizable.</p>
    <label className="block">Keep journal days<input className={inputStyle} type="number" min={1} max={365} value={settings.retentionDays} onChange={event => setSettings({ ...settings, retentionDays: Number(event.target.value) })} /></label>
    <label className="block">Project folders (one absolute path per line)<textarea className={inputStyle} rows={3} value={projects} placeholder={"C:\\Projects\\Lupad\nC:\\Projects\\Portfolio"} onChange={event => setProjects(event.target.value)} /></label>
    <button className="rounded-full bg-cyan-100 px-4 py-2 text-zinc-950 disabled:opacity-40" disabled={!loaded} type="button" onClick={async () => {
      try {
        const response = await fetch("/api/activity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "settings", ...settings, projects: projects.split(/\r?\n/).map(item => item.trim()).filter(Boolean) }) });
        const data = await response.json(); if (!response.ok) throw new Error(data.error);
        setSettings(data.settings); setStatus("Saved. Desktop tracking updates within 10 seconds."); window.dispatchEvent(new Event("jimmy-activity"));
      } catch (error) { setStatus(error instanceof Error ? error.message : "Could not save settings."); }
    }}>Save journal settings</button>
    <p role="status" className="text-xs text-cyan-100">{status}</p>
    <label className="block">View a day<select className={inputStyle} value={day} onChange={event => setDay(event.target.value)}><option value="">Today</option>{days.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
    <pre className="jimmy-chat-scroll max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-white/5 p-3 text-xs font-sans">{journal || "Loading…"}</pre>
    <p className="text-xs leading-5 text-white/50">Markdown files live in storage/activity. Ask local Qwen “What did I work on today?” or “Do I have unpushed commits?” Journal lookup runs only for Qwen. If you later choose Codex, existing conversation history is sent as usual, including activity already discussed. Git status uses cached upstream information and never fetches or pushes.</p>
    <p className="text-xs text-white/50">Browser setup: see browser-extension/README.md. Journals reflect observed activity, not every action or its purpose.</p>
  </section>;
}
