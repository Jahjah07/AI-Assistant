"use client";

import { useCallback, useEffect, useState } from "react";

export default function ModelSettings({ busy }: { busy: boolean }) {
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [changing, setChanging] = useState(false);
  const [status, setStatus] = useState("");
  const [models, setModels] = useState<{ name: string; size: number }[]>([]);
  const [model, setModel] = useState("");
  const [savedModel, setSavedModel] = useState("");
  const [modelsError, setModelsError] = useState("");
  const [refreshing, setRefreshing] = useState(true);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/model-settings", { signal, cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not read model settings.");
      if (!signal?.aborted) {
        setEnabled(data.keepLoaded); setModels(data.models || []); setModel(data.model || ""); setSavedModel(data.model || "");
        setModelsError(data.modelsError || ""); setLoaded(true);
      }
    } catch (error) { if (!signal?.aborted) setStatus(error instanceof Error ? error.message : "Could not read model settings."); }
    finally { if (!signal?.aborted) setRefreshing(false); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const initial = window.setTimeout(() => void refresh(controller.signal), 0);
    return () => { window.clearTimeout(initial); controller.abort(); };
  }, [refresh]);
  async function save(settings: { model?: string; keepLoaded?: boolean }) {
    setChanging(true); setStatus("Updating model settings… Preloading can take a few minutes.");
    try {
      const response = await fetch("/api/model-settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update model settings.");
      setEnabled(data.keepLoaded); setModel(data.model); setSavedModel(data.model);
      setStatus(`Saved ${data.model}. Applies to the next local chat or plan.${data.keepLoaded ? " Chat and voice models will preload at desktop startup." : " Models load when needed."}`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not update model settings."); }
    finally { setChanging(false); }
  }
  const disabled = !loaded || changing || busy || refreshing;
  return <div className="mb-5 space-y-2 border-b border-white/10 pb-5">
    <label htmlFor="chat-model" className="text-sm font-medium">Local brain model · Ollama</label>
    <select id="chat-model" value={model} disabled={disabled || Boolean(modelsError) || !models.length} onChange={event => setModel(event.target.value)}
      className="w-full rounded-lg border border-white/20 bg-zinc-900 p-3 text-sm focus:outline-cyan-200 disabled:opacity-40">
      {!models.some(item => item.name === model) && <option value={model}>{model || "No model selected"} · not listed</option>}
      {models.map(item => <option key={item.name} value={item.name}>{item.name}{item.size ? ` · ${(item.size / 2 ** 30).toFixed(1)} GiB on disk` : ""}</option>)}
    </select>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={disabled || model === savedModel || !models.some(item => item.name === model)} onClick={() => void save({ model })}
        className="rounded-lg border border-cyan-200/30 px-3 py-2 text-sm text-cyan-100 hover:bg-white/10 disabled:opacity-40">Save chat model</button>
      <button type="button" disabled={changing || refreshing || busy} onClick={() => { setRefreshing(true); void refresh(); }}
        className="rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-40">{refreshing ? "Refreshing…" : "Refresh models"}</button>
    </div>
    <p className="text-xs leading-5 text-white/50">Choose an installed text-generation model for local chat, planning and workflows. To add one, run <code>ollama pull MODEL_NAME</code>, then refresh. Larger models and longer context use more RAM/VRAM; disk size is not memory usage. This choice is saved on this PC and applies when Brain uses local Ollama.</p>
    {modelsError && <p role="status" className="text-xs text-amber-200">{modelsError}</p>}
    {loaded && !modelsError && !models.length && <p role="status" className="text-xs text-amber-200">No installed models found. Pull a model in Ollama, then refresh.</p>}
    <label className="flex items-center justify-between gap-4 text-sm"><span>Keep voice and chat models loaded</span>
      <input type="checkbox" role="switch" aria-label="Keep voice and chat models loaded" checked={enabled} disabled={disabled} className="h-5 w-5 shrink-0 accent-cyan-200" onChange={event => void save({ keepLoaded: event.target.checked })} />
    </label>
    <p className="text-xs leading-5 text-white/50">Keeps the selected chat model in memory and preloads Kokoro. Moonshine stays ready with the voice service; Silero stays ready while the microphone is connected. Uses more RAM/VRAM. Vision and image models still load only when needed.</p>
    <p role="status" className="text-xs text-cyan-100/80">{status}</p>
  </div>;
}
