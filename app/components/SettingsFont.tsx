"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { chooseSettingsFont, parseSettingsFont, removeUploadedSettingsFont, savedSettingsFont, SETTINGS_FONTS, uploadSettingsFont } from "../lib/settings-font";

function subscribe(changed: () => void) {
  window.addEventListener("storage", changed);
  window.addEventListener("settings-font-changed", changed);
  return () => { window.removeEventListener("storage", changed); window.removeEventListener("settings-font-changed", changed); };
}

function useSettingsFont() {
  const raw = useSyncExternalStore(subscribe, savedSettingsFont, () => null);
  return useMemo(() => parseSettingsFont(raw), [raw]);
}

export default function SettingsFont() {
  const settings = useSettingsFont();
  useEffect(() => {
    const root = document.documentElement;
    const fallback = SETTINGS_FONTS[0].family;
    root.style.setProperty("--settings-font", SETTINGS_FONTS.find(item => item.id === settings.font)?.family || fallback);
    if (settings.font !== "custom" || !settings.upload) return;
    let disposed = false;
    const face = new FontFace("AssistantSettingsFont", `url("${settings.upload.data}")`);
    void face.load().then(loaded => {
      if (disposed) return;
      document.fonts.add(loaded);
      root.style.setProperty("--settings-font", `"AssistantSettingsFont", ${fallback}`);
    }).catch(() => { if (!disposed) root.style.setProperty("--settings-font", fallback); });
    return () => { disposed = true; document.fonts.delete(face); };
  }, [settings]);
  return null;
}

export function SettingsFontSettings() {
  const settings = useSettingsFont();
  const [status, setStatus] = useState("");
  const [uploading, setUploading] = useState(false);
  return <div className="mb-5 space-y-2 border-b border-white/10 pb-5">
    <label htmlFor="settings-font" className="text-sm font-medium">Settings font</label>
    <select id="settings-font" value={settings.font} disabled={uploading} onChange={event => {
      try { chooseSettingsFont(event.target.value); setStatus("Settings font saved."); }
      catch (error) { setStatus(error instanceof Error ? error.message : "Could not save the font."); }
    }} className="w-full rounded-lg border border-white/20 bg-zinc-900 p-3 text-sm focus:outline-cyan-200 disabled:opacity-40">
      {SETTINGS_FONTS.map(font => <option key={font.id} value={font.id}>{font.label}</option>)}
      {settings.upload && <option value="custom">Uploaded · {settings.upload.name}</option>}
    </select>
    <p className="text-sm leading-6 text-white/70">A quick preview: clear settings, comfortable reading. Aa Bb Cc · 0123456789.</p>
    <label htmlFor="settings-font-file" className="block text-sm font-medium">Upload your own font</label>
    <input id="settings-font-file" type="file" accept=".woff,.woff2,.ttf,.otf" disabled={uploading} className="w-full rounded-lg border border-white/20 p-2 text-sm focus-visible:outline-2 focus-visible:outline-cyan-200 disabled:opacity-40" onChange={async event => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      setUploading(true); setStatus("Checking the font…");
      try { await uploadSettingsFont(file); setStatus("Font uploaded and saved for this profile."); }
      catch (error) { setStatus(error instanceof Error ? error.message : "Could not load the font."); }
      finally { setUploading(false); }
    }} />
    <p className="text-xs leading-5 text-white/55">WOFF, WOFF2, TTF or OTF · up to 1 MiB. The file stays in this browser or desktop profile. Only Settings uses this font; if an uploaded font cannot load, the system font is used.</p>
    {settings.upload && <button type="button" disabled={uploading} className="rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-cyan-200 disabled:opacity-40" onClick={() => {
      try { removeUploadedSettingsFont(); setStatus("Uploaded font removed."); }
      catch (error) { setStatus(error instanceof Error ? error.message : "Could not remove the font."); }
    }}>Remove uploaded font</button>}
    <p role="status" className="text-xs text-cyan-100/80">{status}</p>
  </div>;
}
