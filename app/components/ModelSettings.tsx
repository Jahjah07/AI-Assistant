"use client";

import { useEffect, useState } from "react";

export default function ModelSettings({ busy }: { busy: boolean }) {
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [changing, setChanging] = useState(false);
  const [status, setStatus] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/model-settings", { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Could not read model settings.");
      const data = await response.json();
      if (!controller.signal.aborted) { setEnabled(data.keepLoaded); setLoaded(true); }
    }).catch(error => { if (!controller.signal.aborted) setStatus(error.message); });
    return () => controller.abort();
  }, []);
  return <div className="mb-5 space-y-2 border-b border-white/10 pb-5">
    <label className="flex items-center justify-between gap-4 text-sm"><span>Keep voice and chat models loaded</span>
      <input type="checkbox" role="switch" aria-label="Keep voice and chat models loaded" checked={enabled} disabled={!loaded || changing || busy} className="h-5 w-5 shrink-0 accent-cyan-200" onChange={async event => {
        const next = event.target.checked; setChanging(true); setStatus(next ? "Loading Qwen and Kokoro… This may take a few minutes." : "Returning to normal loading…");
        try {
          const response = await fetch("/api/model-settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keepLoaded: next }) });
          const data = await response.json(); if (!response.ok) throw new Error(data.error);
          setEnabled(data.keepLoaded); setStatus(next ? "Ready. Qwen and Kokoro will preload when the desktop starts." : "Saved. Models load when needed; already loaded models may remain until their normal timeout or shutdown.");
        } catch (error) { setStatus(error instanceof Error ? error.message : "Could not update model settings."); }
        finally { setChanging(false); }
      }} />
    </label>
    <p className="text-xs leading-5 text-white/50">Keeps Qwen in memory and preloads Kokoro. Moonshine stays ready with the voice service; Silero stays ready while the microphone is connected. Uses more RAM/VRAM. Vision and image models still load only when needed.</p>
    <p role="status" className="text-xs text-cyan-100/80">{status}</p>
  </div>;
}
