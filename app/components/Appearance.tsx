"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { DEFAULT_UI_COLOR, savedUiColor, saveUiColor } from "../lib/appearance";
import SettingsFont from "./SettingsFont";

function subscribe(changed: () => void) {
  window.addEventListener("storage", changed);
  window.addEventListener("ui-color-changed", changed);
  return () => { window.removeEventListener("storage", changed); window.removeEventListener("ui-color-changed", changed); };
}

function useUiColor() {
  return useSyncExternalStore(subscribe, savedUiColor, () => DEFAULT_UI_COLOR);
}

export default function Appearance() {
  const color = useUiColor();
  useEffect(() => { document.documentElement.style.setProperty("--ui-color", color); }, [color]);
  return <SettingsFont />;
}

export function AppearanceSettings() {
  const color = useUiColor();
  const [status, setStatus] = useState("");
  function choose(value: string) {
    try { saveUiColor(value); setStatus("UI color saved."); }
    catch { setStatus("Could not save your color. Allow site storage and try again."); }
  }
  return <div className="mb-5 space-y-2 border-b border-white/10 pb-5">
    <label htmlFor="ui-color" className="text-sm font-medium">UI color</label>
    <div className="flex flex-wrap items-center gap-3">
      <input id="ui-color" type="color" value={color} onChange={event => choose(event.target.value)} className="h-11 w-16 cursor-pointer rounded-lg border border-white/20 bg-zinc-900 p-1 focus-visible:outline-2 focus-visible:outline-cyan-200" />
      <span className="text-xs text-white/65">{color.toUpperCase()}</span>
      <button type="button" onClick={() => choose(DEFAULT_UI_COLOR)} className="rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-cyan-200">Restore cyan</button>
    </div>
    <p className="text-xs text-white/55">Updates the reactor, controls, panels and canvas immediately. Saved for this browser or desktop profile.</p>
    <p role="status" className="text-xs text-cyan-100/80">{status}</p>
  </div>;
}
