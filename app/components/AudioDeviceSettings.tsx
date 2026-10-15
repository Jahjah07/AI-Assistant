"use client";

import { useEffect, useState } from "react";
import { AUDIO_INPUT_KEY, AUDIO_OUTPUT_KEY, savedAudioDevice, savedVoiceVolume, selectVoiceOutput } from "../lib/audio-devices";
import { requestLocalApp } from "../lib/desktop";
import { useAssistantName } from "../lib/assistant-name";

export default function AudioDeviceSettings({ onInputChange, onOutputChange, onVolumeChange }: {
  onInputChange: (id: string) => Promise<void>;
  onOutputChange: (id: string) => Promise<void>;
  onVolumeChange: (value: number) => void;
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const name = useAssistantName();
  const [input, setInput] = useState(() => savedAudioDevice(AUDIO_INPUT_KEY));
  const [output, setOutput] = useState(() => savedAudioDevice(AUDIO_OUTPUT_KEY));
  const [volume, setVolume] = useState(savedVoiceVolume);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const outputSupported = typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;

  async function refresh() {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) throw new Error("Audio devices require HTTPS or localhost in a supported browser.");
      setDevices(await navigator.mediaDevices.enumerateDevices());
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not list audio devices."); }
  }

  useEffect(() => {
    const media = navigator.mediaDevices;
    let active = true;
    const update = () => {
      void media?.enumerateDevices().then(list => { if (active) setDevices(list); }).catch(() => {
        if (active) setStatus("Could not list audio devices. Allow microphone access and refresh.");
      });
    };
    update();
    media?.addEventListener("devicechange", update);
    return () => { active = false; media?.removeEventListener("devicechange", update); };
  }, []);

  async function change(kind: "input" | "output", id: string) {
    setBusy(true); setStatus("");
    try {
      await (kind === "input" ? onInputChange(id) : onOutputChange(id));
      if (kind === "input") setInput(id); else setOutput(id);
      setStatus(`${kind === "input" ? "Microphone" : "Voice output"} updated. Saved for this browser.`);
      await refresh();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not switch audio device."); }
    finally { setBusy(false); }
  }

  async function allowDevices() {
    setBusy(true); setStatus("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      await refresh();
      setStatus("Available devices refreshed.");
    } catch { setStatus("Microphone access was unavailable. Check your browser and system permissions."); }
    finally { setBusy(false); }
  }

  async function chooseOutput() {
    const media = navigator.mediaDevices as MediaDevices & {
      selectAudioOutput?: () => Promise<MediaDeviceInfo>;
    };
    try {
      const device = await media.selectAudioOutput?.();
      if (device) await change("output", device.deviceId);
    } catch { setStatus("Speaker selection was cancelled or denied."); }
  }
  async function chooseLaptop() {
    try { const device = selectVoiceOutput(await navigator.mediaDevices.enumerateDevices(), "laptop speakers"); await change("output", device.deviceId); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Choose your laptop speakers from the output list."); }
  }
  async function openSettings(page: "bluetooth" | "mixer") {
    setBusy(true); setStatus("");
    try {
      const response = await requestLocalApp({ action: "audio-settings", page });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setStatus(page === "bluetooth" ? "Windows Bluetooth settings opened. Pair/connect your speaker there, then refresh this list." : "Windows volume mixer opened. Choose the Bluetooth speaker for your music app.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not open Windows settings."); }
    finally { setBusy(false); }
  }

  const selectStyle = "mt-2 w-full rounded-lg border border-white/20 bg-zinc-900 p-3 text-sm focus:outline-cyan-200 disabled:opacity-40";
  return <div className="space-y-6">
    <div><h3 className="text-lg font-medium">Audio devices</h3>
      <p className="mt-1 text-sm text-white/55">Keep music on your Bluetooth speaker and {name}’s voice on your laptop speakers.</p></div>
    {(["input", "output"] as const).map(kind => {
      const id = kind === "input" ? input : output;
      const available = devices.filter(device => device.kind === `audio${kind}` && device.deviceId && device.deviceId !== "default" && (kind !== "output" || device.deviceId !== "communications"));
      return <div key={kind}>
        <label htmlFor={`audio-${kind}`} className="text-sm font-medium">{kind === "input" ? "Microphone" : `${name} voice output`}</label>
        <select id={`audio-${kind}`} value={id} disabled={busy || (kind === "output" && !outputSupported)}
          onChange={event => void change(kind, event.target.value)} className={selectStyle}>
          <option value="">System default</option>
          {id && !available.some(device => device.deviceId === id) && <option value={id}>Saved device unavailable — choose another</option>}
          {available.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${kind === "input" ? "Microphone" : "Speaker"} ${index + 1}`}</option>)}
        </select>
        {kind === "output" && <p className="mt-2 text-xs leading-5 text-white/50">{outputSupported ? `Choose the actual laptop speaker entry to keep ${name} there when Windows changes its default. System default follows Windows. This selection applies to speech and voice previews; music and YouTube keep their own output.` : "This browser uses the system default speaker. Device selection is unavailable."}</p>}
      </div>;
    })}
    <label className="block text-sm font-medium">{name} voice volume · {Math.round(volume * 100)}%
      <input type="range" aria-label={`${name} voice volume`} min="0" max="100" step="1" value={Math.round(volume * 100)} disabled={busy} className="mt-3 w-full accent-cyan-200" onChange={event => {
        const value = Number(event.target.value) / 100;
        try { onVolumeChange(value); setVolume(value); setStatus(`${name}’s voice volume saved. Music volume is unchanged.`); }
        catch (error) { setStatus(error instanceof Error ? error.message : "Could not save voice volume."); }
      }} />
      <span className="mt-1 block text-xs font-normal text-white/50">Only {name}’s speech and voice previews. Music volume is controlled by its player or Windows.</span>
    </label>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy || !outputSupported} onClick={() => void chooseLaptop()} className="rounded-lg border border-cyan-200/30 px-3 py-2 text-sm text-cyan-100 hover:bg-white/10 disabled:opacity-40">Use laptop speakers</button>
      <button type="button" disabled={busy} onClick={() => void allowDevices()} className="rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-40">Allow access / refresh devices</button>
      {outputSupported && typeof navigator !== "undefined" && "selectAudioOutput" in (navigator.mediaDevices || {}) && <button type="button" disabled={busy} onClick={() => void chooseOutput()} className="rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-40">Choose another speaker</button>}
    </div>
    <div className="space-y-3 rounded-xl border border-white/10 p-3">
      <p className="text-xs leading-5 text-white/60">Connect your Bluetooth speaker/headphones in Windows. Set your music app to that device in the volume mixer, and leave {name} pinned to the laptop speaker above.</p>
      <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} className="rounded-lg border border-white/20 px-3 py-2 text-xs hover:bg-white/10 disabled:opacity-40" onClick={() => void openSettings("bluetooth")}>Pair / connect Bluetooth device</button><button type="button" disabled={busy} className="rounded-lg border border-white/20 px-3 py-2 text-xs hover:bg-white/10 disabled:opacity-40" onClick={() => void openSettings("mixer")}>Open Windows volume mixer</button></div>
    </div>
    <p className="text-xs leading-5 text-white/50">Changes apply immediately. Microphone capture stays paused while settings are open.</p>
    <p role="status" className="min-h-10 text-xs leading-5 text-cyan-100/80">{busy ? "Switching audio device…" : status}</p>
  </div>;
}
