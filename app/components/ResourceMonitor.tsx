"use client";

import { useEffect, useState } from "react";

type Resources = {
  cpuPercent: number | null;
  ram: { percent: number; usedGB: number; totalGB: number };
  gpu: { name: string; percent: number; usedGB: number; totalGB: number } | null;
  backends: {
    kokoro: string; silero: string; moonshine: string; ollama: string; comfyui: string;
    chat: { name: string; status: string }; vision: { name: string; status: string };
  };
};

type Sample = { at: number; cpu: number | null; ram: number | null; gpu: number | null; vram: number | null };

export function trendPath(points: { at: number; value: number | null }[], now: number) {
  let previous = 0;
  return points.map(point => {
    if (point.value == null || !Number.isFinite(point.value) || point.at < now - 180000) { previous = 0; return ""; }
    const x = 2 + 196 * Math.max(0, Math.min(1, (point.at - now + 180000) / 180000));
    const y = 42 - 40 * Math.max(0, Math.min(100, point.value)) / 100;
    const command = previous && point.at - previous <= 15000 ? "L" : "M";
    previous = point.at;
    return `${command}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

export default function ResourceMonitor() {
  const [data, setData] = useState<Resources | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [history, setHistory] = useState<Sample[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    const remember = (next?: Resources) => {
      const at = Date.now();
      const point: Sample = { at, cpu: next?.cpuPercent ?? null, ram: next?.ram.percent ?? null, gpu: next?.gpu?.percent ?? null,
        vram: next?.gpu && next.gpu.totalGB > 0 ? 100 * next.gpu.usedGB / next.gpu.totalGB : null };
      setHistory(samples => [...samples.filter(sample => sample.at >= at - 180000), point].slice(-37));
    };
    const update = async () => {
      if (document.hidden || pending) return;
      pending = true;
      try {
        const response = await fetch("/api/resources", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Unavailable");
        const next: Resources = await response.json();
        if (!controller.signal.aborted) { setData(next); setUnavailable(false); remember(next); }
      } catch { if (!controller.signal.aborted) { setUnavailable(true); remember(); } }
      finally { pending = false; }
    };
    void update();
    const timer = setInterval(() => { void update(); }, 5000);
    document.addEventListener("visibilitychange", update);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", update); };
  }, []);
  const readings = [
    { key: "cpu" as const, label: "CPU", percent: data?.cpuPercent, detail: "Processor load" },
    { key: "ram" as const, label: "RAM", percent: data?.ram.percent, detail: data ? `${data.ram.usedGB.toFixed(1)} / ${data.ram.totalGB.toFixed(1)} GB` : "System memory" },
    { key: "gpu" as const, label: "GPU", percent: data?.gpu?.percent, detail: data?.gpu ? "Graphics load" : "Telemetry unavailable" },
    { key: "vram" as const, label: "VRAM", percent: data?.gpu && data.gpu.totalGB > 0 ? Math.round(100 * data.gpu.usedGB / data.gpu.totalGB) : null, detail: data?.gpu ? `${data.gpu.usedGB.toFixed(1)} / ${data.gpu.totalGB.toFixed(1)} GB` : "Telemetry unavailable" },
  ];
  return <aside className="resource-panel" aria-label="System resource usage">
    <div className="resource-header"><h2 className="resource-heading">System</h2><span title="Up to 3 minutes of history, sampled every 5 seconds while visible">3 MIN</span></div>
    {readings.map(reading => <div className="resource-reading" data-metric={reading.key} data-unavailable={unavailable || reading.percent == null} key={reading.label} title={reading.key === "gpu" || reading.key === "vram" ? data?.gpu?.name : undefined}>
      <div className="resource-value"><span><i aria-hidden="true" />{reading.label}</span><strong data-pressure={!unavailable && reading.percent != null && reading.percent >= 90 ? "high" : undefined}>{!unavailable && reading.percent != null ? `${reading.percent}%` : "—"}</strong></div>
      <p>{unavailable ? "Unavailable" : reading.detail}</p>
      <svg className="resource-trend" viewBox="0 0 200 46" preserveAspectRatio="none" role="img" aria-label={`${reading.label} usage history, up to 3 minutes, sampled every 5 seconds`}>
        <path className="resource-grid" d="M2 2H198 M2 22H198 M2 42H198" />
        <path className="resource-line" d={trendPath(history.map(sample => ({ at: sample.at, value: sample[reading.key] })), history.at(-1)?.at || 0)} />
        {!unavailable && reading.percent != null && <circle cx="198" cy={42 - 40 * Math.max(0, Math.min(100, reading.percent)) / 100} r="2.5" />}
      </svg>
      <meter min={0} max={100} value={!unavailable ? reading.percent ?? 0 : 0} aria-label={`${reading.label} usage`} />
    </div>)}
    <div className="backend-status" aria-label="Backend status">
      {[
        ["Kokoro TTS", data?.backends?.kokoro, "Speech output"],
        ["Silero VAD", data?.backends?.silero, "Speech detection service"],
        ["Moonshine STT", data?.backends?.moonshine, "Speech transcription"],
        ["Ollama", data?.backends?.ollama, "Local model server"],
        ["Chat model", data?.backends?.chat?.status, data?.backends?.chat?.name],
        ["Vision model", data?.backends?.vision?.status, data?.backends?.vision?.name],
        ["ComfyUI", data?.backends?.comfyui, "Image generation service"],
      ].map(([name, health, detail]) => {
        const status = unavailable ? "Unavailable" : health || "Checking";
        return <div key={name} className="backend-status-row" title={detail}><span>{name}{(name === "Chat model" || name === "Vision model") && <small className="backend-model">{detail}</small>}</span><span data-status={status} title={status === "Standby" ? "Available, unloaded to save memory" : status === "Missing" ? "Model is not installed" : undefined}>{status}</span></div>;
      })}
    </div>
  </aside>;
}
