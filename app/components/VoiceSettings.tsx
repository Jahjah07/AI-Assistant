"use client";

import { useEffect, useRef, useState } from "react";
import { GearIcon } from "@radix-ui/react-icons";
import { AppearanceSettings } from "./Appearance";
import { SettingsFontSettings } from "./SettingsFont";
import AudioDeviceSettings from "./AudioDeviceSettings";
import ActivityJournal from "./ActivityJournal";
import ModelSettings from "./ModelSettings";
import KnowledgeSettings from "./KnowledgeSettings";
import N8nTools from "./N8nTools";
import TodoSettings from "./TodoSettings";
import { routeAudio, savedVoiceVolume } from "../lib/audio-devices";
import { kokoroLanguages, kokoroVoiceIds, KOKORO_VOICE_STORAGE_KEY, savedKokoroVoice, savedSpeechSpeed } from "../lib/kokoro";
import { DEFAULT_PERSONALITY, PERSONALITY_STORAGE_KEY, savedAssistantName, savedPersonality } from "../lib/assistant";
import { saveAssistantName, useAssistantName } from "../lib/assistant-name";

export default function VoiceSettings({ busy, onOpenChange, chatVisible, onChatVisibleChange, onInputChange, onOutputChange, onVolumeChange }: {
  onInputChange: (id: string) => Promise<void>;
  onOutputChange: (id: string) => Promise<void>;
  onVolumeChange: (value: number) => void;
  busy: boolean;
  chatVisible: boolean;
  onChatVisibleChange: (visible: boolean) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const assistantName = useAssistantName();
  const [nameDraft, setNameDraft] = useState("");
  const audio = useRef<HTMLAudioElement | null>(null);
  const controller = useRef<AbortController | null>(null);
  const objectUrl = useRef<string | null>(null);
  const [section, setSection] = useState("voice");
  const [selected, setSelected] = useState("am_michael");
  const [language, setLanguage] = useState("a");
  const [status, setStatus] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [personality, setPersonality] = useState(DEFAULT_PERSONALITY);
  const group = kokoroLanguages.find(item => item.code === language)!;
  const voice = group.voices.find(item => item.id === selected);

  function stopPreview() {
    controller.current?.abort();
    controller.current = null;
    audio.current?.pause();
    audio.current = null;
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
  }

  useEffect(() => () => stopPreview(), []);

  async function open() {
    setNameDraft(assistantName);
    setPersonality(savedPersonality());
    stopPreview();
    setStatus("");
    setPreviewing(false);
    const stored = savedKokoroVoice();
    let current = stored || "am_michael";
    if (!stored) {
      try {
        const response = await fetch("/api/tts", { signal: AbortSignal.timeout(5000) });
        if (response.ok) {
          const data = await response.json();
          if (kokoroVoiceIds.has(data.defaultVoice)) current = data.defaultVoice;
        }
      } catch { /* Use Michael when service settings cannot be reached. */ }
    }
    setSelected(current);
    setLanguage(current[0]);
    dialog.current?.showModal();
    onOpenChange(true);
  }

  function closed() {
    stopPreview();
    setPreviewing(false);
    onOpenChange(false);
  }

  async function preview() {
    if (previewing) {
      stopPreview();
      setPreviewing(false);
      setStatus("");
      return;
    }
    stopPreview();
    const request = new AbortController();
    controller.current = request;
    setPreviewing(true);
    setStatus("Preparing preview… The first use of a voice may take a moment.");
    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: group.preview.replaceAll("{name}", savedAssistantName()), voice: selected }),
        signal: request.signal,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Preview unavailable. Please try again.");
      }
      const blob = await response.blob();
      if (request.signal.aborted) return;
      objectUrl.current = URL.createObjectURL(blob);
      const player = new Audio(objectUrl.current);
      player.playbackRate = savedSpeechSpeed();
      player.volume = savedVoiceVolume();
      audio.current = player;
      player.onended = () => {
        stopPreview();
        setPreviewing(false);
        setStatus("");
      };
      player.onerror = () => {
        stopPreview();
        setPreviewing(false);
        setStatus("Could not play the preview. Please try again.");
      };
      await routeAudio(player);
      await player.play();
      if (!request.signal.aborted) setStatus(`Playing ${voice?.name}…`);
    } catch (error) {
      if (!request.signal.aborted) {
        stopPreview();
        setPreviewing(false);
        setStatus(error instanceof Error ? error.message : "Preview unavailable.");
      }
    }
  }

  function save() {
    try {
      localStorage.setItem(KOKORO_VOICE_STORAGE_KEY, selected);
      setStatus(`${voice?.name} selected. Saved for this browser; applies to ${assistantName}'s next speech.`);
    } catch {
      setStatus("Your browser could not save this choice. Allow site storage and try again.");
    }
  }

  const buttonStyle = "rounded-full border border-white/20 px-4 py-2 text-sm text-cyan-50 transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-cyan-200 disabled:opacity-40";

  return <>
    <button type="button" onClick={() => void open()} title="Voice settings" aria-label="Voice settings"
      aria-haspopup="dialog"
      className="absolute top-5 right-4 z-20 grid h-11 w-11 place-items-center rounded-full border border-white/20 bg-black/50 text-cyan-100 shadow-lg backdrop-blur-md transition hover:bg-cyan-100/15 focus-visible:outline-2 focus-visible:outline-cyan-200">
      <GearIcon width="22" height="22" aria-hidden="true" />
    </button>
    <dialog ref={dialog} onClose={closed} aria-labelledby="voice-settings-title"
      onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}
      className="settings-dialog fixed inset-0 m-auto max-h-[85dvh] w-[min(760px,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-cyan-200/20 bg-zinc-950 p-5 text-white shadow-2xl backdrop:bg-black/65 backdrop:backdrop-blur-sm">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0"><h2 id="voice-settings-title" className="text-lg font-medium">{assistantName}’s settings</h2>
          <p className="mt-1 text-sm text-white/55">Voice, audio devices, and preferences</p></div>
        <button type="button" autoFocus onClick={() => dialog.current?.close()} aria-label="Close voice settings" className={`${buttonStyle} shrink-0`}>✕</button>
      </div>
      <div className="grid min-h-0 gap-5 sm:grid-cols-[150px_minmax(0,1fr)]">
      <nav aria-label="Settings sections" className="flex flex-wrap gap-1 border-b border-white/10 pb-3 sm:flex-col sm:flex-nowrap sm:border-b-0 sm:border-r sm:pr-4">
        {[["voice", "Voice"], ["devices", "Audio devices"], ["general", "General"], ["todos", "To-do list"], ["activity", "Activity journal"], ["knowledge", "Knowledge"], ["tools", "n8n tools"]].map(([id, label]) =>
          <button key={id} type="button" aria-current={section === id ? "page" : undefined}
            onClick={() => { stopPreview(); setPreviewing(false); setStatus(""); setSection(id); }}
            className={`rounded-lg px-3 py-2.5 text-left text-sm transition focus-visible:outline-2 focus-visible:outline-cyan-200 ${section === id ? "bg-cyan-100/10 text-cyan-100" : "text-white/55 hover:bg-white/5 hover:text-white"}`}>{label}</button>)}
      </nav>
      <div className="min-w-0">
      {section === "knowledge" && <KnowledgeSettings />}
      {section === "tools" && <N8nTools />}
      {section === "todos" && <TodoSettings />}
      {section === "activity" && <ActivityJournal />}
      {section === "devices" && <AudioDeviceSettings onInputChange={onInputChange} onOutputChange={onOutputChange} onVolumeChange={onVolumeChange} />}
      {section === "general" && <>
      <AppearanceSettings />
      <SettingsFontSettings />
      <div className="mb-5 space-y-2">
        <label htmlFor="assistant-name" className="text-sm font-medium">Assistant name</label>
        <input id="assistant-name" value={nameDraft} maxLength={24} onChange={event => setNameDraft(event.target.value)}
          className="w-full rounded-lg border border-white/20 bg-zinc-900 p-3 text-sm focus:outline-cyan-200" />
        <p className="text-xs text-white/55">Saved on this device. Updates the interface, voice previews and wake name immediately. Say the saved name to wake your assistant.</p>
        <button type="button" className={buttonStyle} onClick={() => {
          try { const name = saveAssistantName(nameDraft); setNameDraft(name); setStatus(`Assistant renamed to ${name}. Say “${name}, open canvas” to try it.`); }
          catch (error) { setStatus(error instanceof Error ? error.message : "Could not save the name. Allow site storage and try again."); }
        }}>Save name</button>
      </div>
      <ModelSettings busy={busy} />
      <div className="mb-5 space-y-2">
        <label htmlFor="jimmy-personality" className="text-sm font-medium">Personality</label>
        <textarea id="jimmy-personality" value={personality} maxLength={1200} rows={3}
          onChange={event => setPersonality(event.target.value)}
          className="w-full rounded-lg border border-white/20 bg-zinc-900 p-3 text-sm focus:outline-cyan-200" />
        <p className="text-xs text-white/55">Tell {assistantName} how to address you, how much detail to give, and what tone to use. Applies to local Ollama and Codex chat replies.</p>
        <button type="button" className={buttonStyle} onClick={() => {
          try {
            localStorage.setItem(PERSONALITY_STORAGE_KEY, personality.trim() || DEFAULT_PERSONALITY);
            setStatus("Personality saved for this browser. Applies to the next chat reply.");
          } catch { setStatus("Your browser could not save this personality. Allow site storage and try again."); }
        }}>Save personality</button>
      </div>
      <label className="mb-5 flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-cyan-200/20 bg-cyan-200/5 p-4">
        <span><span className="block text-sm font-medium">Show chatbox</span>
          <span className="mt-1 block text-xs text-white/55">You can also say “hide chat” or “show chat”.</span></span>
        <input type="checkbox" role="switch" checked={chatVisible}
          onChange={event => onChatVisibleChange(event.target.checked)}
          aria-label="Show chatbox" className="h-5 w-5 shrink-0 accent-cyan-200" />
      </label>
      <p role="status" className="min-h-10 text-xs leading-5 text-cyan-100/80">{status}</p>
      </>}
      {section === "voice" && <>
      <h3 className="mb-4 text-lg font-medium">{assistantName}’s voice <span className="mt-1 block text-sm font-normal text-white/55">28 English voices · 2 accents</span></h3>
      <label htmlFor="voice-language" className="text-xs font-medium uppercase tracking-wider text-cyan-100/70">Accent</label>
      <select id="voice-language" value={language} onChange={event => {
        stopPreview(); setPreviewing(false); setStatus("");
        const next = kokoroLanguages.find(item => item.code === event.target.value)!;
        setLanguage(next.code); setSelected(next.voices[0].id);
      }} className="mt-2 mb-4 w-full rounded-lg border border-white/20 bg-zinc-900 p-3 text-sm focus:outline-cyan-200">
        {kokoroLanguages.map(item => <option key={item.code} value={item.code}>{item.language} ({item.voices.length})</option>)}
      </select>
      <fieldset className="grid max-h-[32dvh] grid-cols-2 gap-2 overflow-y-auto pr-1">
        <legend className="sr-only">Choose a voice</legend>
        {group.voices.map(item => <label key={item.id} className={`cursor-pointer rounded-lg border p-3 transition focus-within:outline-2 focus-within:outline-cyan-200 ${selected === item.id ? "border-cyan-200/70 bg-cyan-200/10" : "border-white/10 hover:bg-white/5"}`}>
          <span className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{item.name}</span>
            <input type="radio" name="kokoro-voice" value={item.id} checked={selected === item.id} onChange={() => {
              stopPreview(); setPreviewing(false); setStatus(""); setSelected(item.id);
            }} className="accent-cyan-200" /></span>
          <span className="mt-1 block text-xs text-white/50">{item.gender} · {item.id}</span>
        </label>)}
      </fieldset>
      <p className="mt-4 text-xs leading-5 text-white/50">Preview a voice, then save your choice for this browser. Microphone input is paused while settings are open.</p>
      <div className="mt-4 flex gap-2">
        <button type="button" disabled={busy} onClick={() => void preview()} className={buttonStyle}>{previewing ? "Stop preview" : "▶ Preview"}</button>
        <button type="button" onClick={save} className="flex-1 rounded-full bg-cyan-100 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-white focus-visible:outline-2 focus-visible:outline-cyan-200">Use {voice?.name}</button>
      </div>
      <p role="status" className="mt-3 min-h-10 text-xs leading-5 text-cyan-100/80">{busy ? `Wait for ${assistantName} to finish speaking before previewing.` : status}</p>
      <a href="https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md" target="_blank" rel="noreferrer" className="text-xs text-white/45 underline hover:text-cyan-100">Kokoro voice catalogue</a>
      </>}
      </div></div>
    </dialog>
  </>;
}
