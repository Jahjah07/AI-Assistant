import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { protectApiRequest } from "../_security";
import { chatModel } from "../model-settings/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const exec = promisify(execFile);
const cpuTimes = () => os.cpus().reduce((sum, cpu) => {
  sum.idle += cpu.times.idle;
  sum.total += Object.values(cpu.times).reduce((total, time) => total + time, 0);
  return sum;
}, { idle: 0, total: 0 });
let previous = cpuTimes();
let sampledAt = 0;
let sample: Promise<Awaited<ReturnType<typeof readResources>>> | undefined;

async function readHealth(url: string) {
  try {
    const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(1500) });
    return response.ok ? await response.json() : null;
  } catch { return null; }
}

function modelState(state: unknown) {
  switch (state) {
    case "ready": return "Online";
    case "loading": return "Loading";
    case "not_loaded": return "Standby";
    default: return "Offline";
  }
}

async function readBackendStatus() {
  let voiceHealth = "";
  try {
    const url = new URL(process.env.VOICE_SERVICE_PUBLIC_WS_URL || "ws://127.0.0.1:8765/ws/voice");
    if (url.protocol !== "ws:" && url.protocol !== "wss:") throw new Error();
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    url.pathname = "/health"; url.search = ""; url.hash = "";
    voiceHealth = url.href;
  } catch { /* Invalid configuration is reported as offline. */ }
  const [tts, voice, installed, running, images] = await Promise.all([
    readHealth(`${(process.env.TTS_SERVICE_URL || "http://127.0.0.1:8766").replace(/\/$/, "")}/health`),
    voiceHealth ? readHealth(voiceHealth) : Promise.resolve(null),
    readHealth("http://127.0.0.1:11434/api/tags"),
    readHealth("http://127.0.0.1:11434/api/ps"),
    readHealth(`${(process.env.COMFYUI_URL || "http://127.0.0.1:8188").replace(/\/$/, "")}/system_stats`),
  ]);
  const models = (name: string) => {
    const normalized = name.includes(":") ? name : `${name}:latest`;
    const contains = (list: unknown) => Array.isArray(list) && list.some(model =>
      model && [model.name, model.model].includes(normalized));
    const status = contains(running?.models) ? "Online"
      : !Array.isArray(installed?.models) ? "Offline"
      : !contains(installed.models) ? "Missing"
      : !Array.isArray(running?.models) ? "Unavailable" : "Standby";
    return { name, status };
  };
  return {
    kokoro: tts?.ok === true && tts.configured_tts === "kokoro" ? modelState(tts.status?.state) : "Offline",
    silero: voice?.ok === true && voice.vad === "silero-onnx-cpu" ? "Online" : "Offline",
    moonshine: voice?.ok === true && voice.configured_asr === "moonshine" ? modelState(voice.asr_status?.state) : "Offline",
    ollama: Array.isArray(installed?.models) || Array.isArray(running?.models) ? "Online" : "Offline",
    chat: models(await chatModel()),
    vision: models(process.env.OLLAMA_VISION_MODEL || "qwen3-vl:2b"),
    comfyui: images?.system && Array.isArray(images.devices) ? "Online" : "Offline",
  };
}

async function readResources() {
  const backends = readBackendStatus();
  const current = cpuTimes();
  const elapsed = current.total - previous.total;
  const cpuPercent = elapsed > 0 ? Math.max(0, Math.min(100, Math.round(100 * (1 - (current.idle - previous.idle) / elapsed)))) : null;
  previous = current;
  const total = os.totalmem();
  const used = Math.max(0, total - os.freemem());
  let gpu: { name: string; percent: number; usedGB: number; totalGB: number } | null = null;
  try {
    const executable = process.platform === "win32" ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "nvidia-smi.exe") : "nvidia-smi";
    const { stdout } = await exec(executable, ["--query-gpu=name,utilization.gpu,memory.used,memory.total", "--format=csv,noheader,nounits"], { windowsHide: true, timeout: 2500, maxBuffer: 4096 });
    const [name, utilization, memoryUsed, memoryTotal] = stdout.trim().split(/\r?\n/)[0].split(",").map(value => value.trim());
    const percent = Number(utilization), usedMiB = Number(memoryUsed), totalMiB = Number(memoryTotal);
    if (name && [percent, usedMiB, totalMiB].every(Number.isFinite) && totalMiB > 0) {
      gpu = { name, percent: Math.max(0, Math.min(100, percent)), usedGB: usedMiB / 1024, totalGB: totalMiB / 1024 };
    }
  } catch { /* Systems without NVIDIA telemetry still report CPU and RAM. */ }
  return { cpuPercent, ram: { percent: total > 0 ? Math.round(100 * used / total) : 0, usedGB: used / 2 ** 30, totalGB: total / 2 ** 30 }, gpu, backends: await backends };
}

export async function GET(request: Request) {
  const securityError = protectApiRequest(request, { scope: "resources", limit: 60 });
  if (securityError) return securityError;
  if (!sample || Date.now() - sampledAt >= 5000) {
    sampledAt = Date.now();
    sample = readResources();
  }
  return Response.json(await sample, { headers: { "Cache-Control": "no-store" } });
}
