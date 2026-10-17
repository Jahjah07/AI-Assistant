"use client";

import { randomMusicQuery } from "../lib/music";
import { nextSpeechChunk, speechText } from "../lib/speech-text";
import { formatTodoTime, type TodoCommand, type TodoView } from "../lib/todos";
import { isJimmyShutdown, requestLocalApp, type DesktopState } from "../lib/desktop";
import "./desktop.css";
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { selectTool, type ToolDescriptor } from "../lib/n8n-tool-routing";
import { ChatBubbleIcon, Cross2Icon } from "@radix-ui/react-icons";
import { parseBrowserLink } from "../lib/browser-links";
import { parseLocalAppCommand, type LocalAppCommand } from "../lib/local-apps";
import ArcReactor from "./ArcReactor";
import VoiceSettings from "./VoiceSettings";
import ResourceMonitor from "./ResourceMonitor";
import { ActivityIndicator } from "./ActivityJournal";
import { planAction, workflowFromChat, type TaskPlan } from "../lib/planning";
import { captureBrowserScreen } from "../lib/screen";
import { AUDIO_INPUT_KEY, AUDIO_OUTPUT_KEY, savedAudioDevice, saveAudioDevice, microphoneConstraints, routeAudio, savedVoiceVolume, saveVoiceVolume, selectVoiceOutput, AudioOutputError } from "../lib/audio-devices";
import CodexAccount from "./CodexAccount";
import { assistantCommand, assistantWakePattern, savedAssistantName, savedPersonality } from "../lib/assistant";
import { useAssistantName } from "../lib/assistant-name";
import { parseBrowserSearch, type BrowserSearch } from "../lib/browser-search";
import { savedKokoroVoice, savedSpeechSpeed, SPEECH_SPEED_STORAGE_KEY, KOKORO_VOICE_STORAGE_KEY, kokoroLanguages } from "../lib/kokoro";
import { parseVoiceCommand, COMMAND_HELP, type VoiceCommand } from "../lib/voice-commands";
import { canvasNarrative, readCanvasEvents, splitCanvasReply, type CanvasContent, type CanvasDocument, type CanvasBlock } from "../lib/canvas";
import { useCanvasWorkspace } from "../lib/canvas-workspace";
import { CanvasOverlay } from "./DataCanvas";
import { loadLocalModel, mayBeFileRequest, type FileCommand, type FileRequestContext } from "../lib/local-files";

const ModelViewer = dynamic(() => import("./ModelViewer"), { ssr: false });

type AudioState = "idle" | "listening" | "blocked";
type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  workflowUrl?: string;
  visual?: CanvasDocument;
};
type VoiceTiming = {
  speech_start?: number | null;
  speech_end?: number | null;
  asr_first_partial?: number | null;
  asr_final?: number | null;
  speech_end_to_asr_final_ms?: number | null;
  ollama_request?: number | null;
  ollama_first_token?: number | null;
  tts_first_audio?: number | null;
  speech_end_to_ollama_request_ms?: number | null;
  ollama_request_to_first_token_ms?: number | null;
  speech_end_to_tts_first_audio_ms?: number | null;
};
type QueuedSpeech = {
  prepared?: Promise<Blob | null>;
  audio?: Blob;
  text: string;
  generation: number;
};
type AudioContextWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };
type LocalCommand = VoiceCommand | BrowserSearch
  | { kind: "n8n-read" }
  | { kind: "work-start" }
  | { kind: "browser-link"; name: string }
  | { kind: "local-time"; mode: "time" | "date" }
  | { kind: "weather"; day: "today" | "tomorrow" }
  | { kind: "web-facts"; query: string }
  | { kind: "memory"; action: "remember" | "list" | "forget"; text?: string }
  | { kind: "clean-ui" }
  | { kind: "chat-visibility"; action: "hide" | "show" }
  | { kind: "image-hide" }
  | { kind: "image-generate"; prompt: string }
  | { kind: "image-regenerate"; prompt: string }
  | {
      kind: "youtube-control";
      action:
        | "pause"
        | "resume"
        | "next"
        | "lower-volume"
        | "mute"
        | "replay"
        | "similar"
        | "show-player"
        | "hide-player";
    }
  | { kind: "youtube-stop" }
  | { kind: "youtube-play"; query: string; random?: boolean }
  | ({ kind: "app" } & LocalAppCommand);

const WAKE_VISUAL_WINDOW_MS = 12000;
const WAKE_MIC_KEY = "jimmy.wake-word-mic";
const COMMAND_ARM_WINDOW_MS = 45000;
const LISTENING_REPLIES = ["Yes, Sir?"];
const YOUTUBE_PLAY_REPLIES = [
  "Playing {query}, Sir.",
  "Starting {query}, Sir.",
  "Putting on {query}, Sir.",
  "Here is {query}, Sir.",
  "Playing that now, Sir.",
];
const LISTENING_REPLY_CLEANUP_PATTERNS = [
  /\bhi\s+sir\b/gi,
  /\byes\s+sir\b/gi,
  /\bat\s+your\s+service\b/gi,
  /\bwhat\s+can\s+i\s+(?:do\s+for\s+you|help\s+with)\b/gi,
  /\bwhat\s+do\s+you\s+need\b/gi,
  /\bgo\s+ahead\b/gi,
  /\bi'?m\s+listening\b/gi,
];
const NON_COMMAND_TRANSCRIPT_PATTERNS = [
  /\([^)]*\)/gi,
  /\[[^\]]*\]/gi,
  /\bwind\s+blowing\b/i,
  /\bwater\s+splashing\b/i,
  /\bdogs?\s+barks?\b/i,
  /\bdogs?\s+barking\b/i,
  /\bcat\s+meows?\b/i,
  /\bfootsteps?\b/i,
  /\bdoor\s+(?:opens?|closes?|slams?)\b/i,
  /\btyping\b/i,
  /\bkeyboard\b/i,
  /\bfan\b/i,
  /\bbackground\s+noise\b/i,
  /\bstatic\b/i,
  /\bnoise\b/i,
  /\bsilence\b/i,
  /\bmusic\s+playing\b/i,
  /\bapplause\b/i,
  /\blaughter\b/i,
];
const COMMAND_VERB_PATTERN =
  /\b(?:remember|memorize|forget|memory|memories|open|launch|start|run|play|search|lookup|look\s+up|google|internet|web|latest|current|today|news|stop|close|turn\s+off|hide|minimi[sz]e|show|display|bring\s+back|clear|remove|pause|resume|continue|unpause|next|skip|time\s+for\s+work|what|when|where|why|how|tell|say|summarize|write|read|help|explain|create|generate|draw|make)\b/i;

function toPcm16Khz(input: Float32Array, inputSampleRate: number) {
  const ratio = inputSampleRate / 16_000;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Int16Array(outputLength);

  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const start = Math.floor(outputIndex * ratio);
    const end = Math.max(start + 1, Math.floor((outputIndex + 1) * ratio));
    let sum = 0;

    for (let inputIndex = start; inputIndex < end && inputIndex < input.length; inputIndex += 1) {
      sum += input[inputIndex];
    }

    const sample = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
    output[outputIndex] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  return output;
}

export default function AudioReactiveOrb() {
  const assistantName = useAssistantName();
  useEffect(() => {
    document.title = `${assistantName} | Arc Reactor`;
    void window.jimmyDesktop?.setAssistantName?.(assistantName).catch(console.error);
  }, [assistantName]);
  const canvas = useCanvasWorkspace();
  const { publish: publishCanvas } = canvas;
  const lastCanvasMessageRef = useRef<ChatMessage | null>(null);
  const [desktop, setDesktop] = useState<DesktopState | null>(null);
  const desktopMutedRef = useRef(false);
  const desktopAwakeRef = useRef(false);
  const desktopWakeRef = useRef<Promise<void> | null>(null);
  const continuousMicRef = useRef(false);
  const talkingRef = useRef(false);
  const directVoiceTurnRef = useRef(false);
  const brainRef = useRef("auto");
  const [continuousMic, setContinuousMic] = useState(false);
  const [talking, setTalking] = useState(false);
  const [voiceReady, setVoiceReady] = useState(false);
  const [brain, setBrain] = useState("auto");
  const [lastBrain, setLastBrain] = useState("");
  const [routingNote, setRoutingNote] = useState("");
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceDisposedRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const recorderProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastBrowserSearchRef = useRef<BrowserSearch | null>(null);
  const fileRequestRef = useRef<FileRequestContext | null>(null);
  const voiceSocketRef = useRef<WebSocket | null>(null);
  const voiceStartingRef = useRef(false);
  const realtimeVoiceReadyRef = useRef(false);
  const voiceTimingRef = useRef<VoiceTiming | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const privateToolHistoryRef = useRef(false);
  const gmailPageRef = useRef<{ query: string; pageToken: string } | null>(null);
  const readToolsRef = useRef<ToolDescriptor[]>([]);
  const refreshReadTools = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/n8n-tools?catalog=1", { signal, cache: "no-store" });
      if (response.ok) readToolsRef.current = (await response.json()).tools;
    } catch { /* Chat still checks tools on the server when the catalog is unavailable. */ }
  }, []);
  useEffect(() => {
    const controller = new AbortController(); void refreshReadTools(controller.signal);
    return () => controller.abort();
  }, [refreshReadTools]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatToggleRef = useRef<HTMLButtonElement>(null);
  const reactorStageRef = useRef<HTMLDivElement>(null);
  const { model: displayedModel, closeModel } = canvas;
  useLayoutEffect(() => {
    if (!displayedModel) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const defaultFocus = chatToggleRef.current;
    const stage = reactorStageRef.current!;
    document.documentElement.dataset.jimmyModel = "";
    const positionReactor = () => {
      const parent = stage.offsetParent!.getBoundingClientRect();
      const size = Math.min(180, stage.offsetWidth);
      stage.style.setProperty("--model-reactor-x", `${innerWidth - 24 - size / 2 - (parent.left + stage.offsetLeft + stage.offsetWidth / 2)}px`);
      stage.style.setProperty("--model-reactor-y", `${innerHeight - 24 - size / 2 - (parent.top + stage.offsetTop + stage.offsetHeight / 2)}px`);
      stage.style.setProperty("--model-reactor-scale", String(size / stage.offsetWidth));
    };
    positionReactor();
    const observer = new ResizeObserver(positionReactor); observer.observe(stage);
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); closeModel(); } };
    window.addEventListener("resize", positionReactor);
    window.addEventListener("keydown", escape);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", positionReactor);
      window.removeEventListener("keydown", escape);
      delete document.documentElement.dataset.jimmyModel;
      if (previousFocus?.isConnected && previousFocus !== document.body) previousFocus.focus(); else defaultFocus?.focus();
    };
  }, [displayedModel, closeModel]);
  const planRef = useRef<TaskPlan | null>(null);
  const pendingTodoDayRef = useRef<string | null>(null);
  const pendingTodoTimeRef = useRef<string | undefined>(undefined);
  const lastTodoDayRef = useRef<string | null>(null);
  const todoPreviewVersionRef = useRef(0);
  const hideTodoPreview = () => { todoPreviewVersionRef.current += 1; if (canvas.document?.source === "Saved to-do list") canvas.hide(); };
  const [activePlan, setActivePlan] = useState<TaskPlan | null>(null);
  const assistantModeRef = useRef<"off" | "listening" | "thinking">("off");
  const chatStatusRef = useRef<"idle" | "thinking" | "error">("idle");
  const wakeVisualUntilRef = useRef(0);
  const commandArmedUntilRef = useRef(0);
  const suppressMicUntilRef = useRef(0);
  const voiceSettingsOpenRef = useRef(false);
  const speakingRef = useRef(false);
  const speechGenerationRef = useRef(0);
  const synthesisTailRef = useRef<Promise<unknown>>(Promise.resolve());
  const ttsQueueRef = useRef<QueuedSpeech[]>([]);
  const ttsWorkerActiveRef = useRef(false);
  const ttsAbortRef = useRef<AbortController | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const kokoroSpeechFinishRef = useRef<(() => void) | null>(null);
  const acknowledgementRef = useRef(false);
  const chatAbortRef = useRef<AbortController | null>(null);
  const lastReplyRef = useRef("");
  const [audioState, setAudioState] = useState<AudioState>("idle");
  const [micError, setMicError] = useState("");
  const [assistantMode, setAssistantMode] = useState<
    "off" | "listening" | "thinking"
  >("off");
  const [chatStatus, setChatStatus] = useState<"idle" | "thinking" | "error">(
    "idle",
  );
  const [chatError, setChatError] = useState("");
  const [pendingScreenQuestion, setPendingScreenQuestion] = useState("");
  const [input, setInput] = useState("");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPreparingSpeech, setIsPreparingSpeech] = useState(false);
  const [pendingYouTubeUrl, setPendingYouTubeUrl] = useState("");
  const [youtubeVideoId, setYouTubeVideoId] = useState("");
  const [youtubeVideoIds, setYouTubeVideoIds] = useState<string[]>([]);
  const [youtubeVideoIndex, setYouTubeVideoIndex] = useState(0);
  const [youtubeQuery, setYouTubeQuery] = useState("");
  const [youtubeVolume, setYouTubeVolume] = useState(100);
  const [isYouTubePlayerVisible, setIsYouTubePlayerVisible] = useState(true);
  const [generatedImageUrl, setGeneratedImageUrl] = useState("");
  const [generatedImagePrompt, setGeneratedImagePrompt] = useState("");
  const [imageStatus, setImageStatus] = useState<"idle" | "generating" | "error">(
    "idle",
  );
  const [imageError, setImageError] = useState("");
  const [isChatVisible, setIsChatVisible] = useState(true);
  const [, setLastTranscript] = useState("");
  const [, setLastCommand] = useState("");
  const [, setLastIgnoredTranscript] = useState("");
  const [partialTranscript, setPartialTranscript] = useState("");
  const [, setLastVoiceTiming] = useState<VoiceTiming | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "What can I help you with?",
    },
  ]);
  useEffect(() => {
    if (chatStatus === "thinking") return;
    const index = messages.length - 1, message = messages[index];
    if (!message || message.role !== "assistant" || message.visual || lastCanvasMessageRef.current === message) return;
    const presentation = splitCanvasReply(message.content);
    if (!presentation.canvas) return;
    lastCanvasMessageRef.current = message;
    publishCanvas(presentation.canvas);
  }, [messages, chatStatus, publishCanvas]);
  const statusLabel =
    imageStatus === "generating"
      ? "Generating image"
      : isSpeaking
        ? "Speaking"
        : isPreparingSpeech
          ? "Preparing voice"
          : chatStatus === "thinking"
          ? "Thinking"
          : youtubeVideoId
            ? "Playing YouTube"
            : assistantMode === "listening"
              ? "Listening"
              : "Idle";
  const youtubePlaylistParam = youtubeVideoIds
    .filter((videoId) => videoId !== youtubeVideoId)
    .join(",");

  const wakeDesktop = async () => {
    if (!window.jimmyDesktop || desktopAwakeRef.current) return;
    if (!desktopWakeRef.current) {
      desktopWakeRef.current = window.jimmyDesktop.wake().then(state => {
        desktopAwakeRef.current = state.awake;
        setDesktop(state);
      }).finally(() => { desktopWakeRef.current = null; });
    }
    await desktopWakeRef.current;
  };

  useEffect(() => {
    assistantModeRef.current = assistantMode;
  }, [assistantMode]);

  useEffect(() => {
    chatStatusRef.current = chatStatus;
  }, [chatStatus]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [chatStatus, isChatVisible, messages]);

  useEffect(() => {
    return () => {
      voiceDisposedRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      voiceSocketRef.current?.close(1000, "Component unmounted");
      streamRef.current?.getTracks().forEach((track) => track.stop());
      recorderProcessorRef.current?.disconnect();
      silentGainRef.current?.disconnect();
      micSourceRef.current?.disconnect();
      void audioContextRef.current?.close();
      ttsAbortRef.current?.abort();
      chatAbortRef.current?.abort();
      kokoroSpeechFinishRef.current?.();
      ttsAudioRef.current?.pause();
    };
  }, []);

  const markTtsStarted = () => {
    if (voiceTimingRef.current && !voiceTimingRef.current.tts_first_audio) {
      const firstAudio = performance.timeOrigin + performance.now();
      const timing = {
        ...voiceTimingRef.current,
        tts_first_audio: firstAudio,
        speech_end_to_tts_first_audio_ms: voiceTimingRef.current.speech_end
          ? firstAudio - voiceTimingRef.current.speech_end
          : null,
      };
      voiceTimingRef.current = timing;
      setLastVoiceTiming(timing);
      console.info("[Jimmy voice timing]", timing);
    }
  };

  const prepareSpeech = (item: QueuedSpeech): Promise<Blob | null> => {
    if (item.prepared) return item.prepared;
    // Serialize inference, but overlap it with playback of the preceding sentence.
    item.prepared = synthesisTailRef.current.then(async () => {
      if (item.generation !== speechGenerationRef.current) return null;
      const controller = new AbortController();
      ttsAbortRef.current = controller;
      try {
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: item.text, voice: savedKokoroVoice() }),
          signal: controller.signal,
        });
        if (!response.ok) return null;
        const blob = await response.blob();
        if (item.generation !== speechGenerationRef.current) return null;
        item.audio = blob;
        return blob;
      } catch {
        return null;
      } finally {
        if (ttsAbortRef.current === controller) ttsAbortRef.current = null;
      }
    });
    synthesisTailRef.current = item.prepared;
    return item.prepared;
  };

  const prepareNextSpeech = () => {
    const next = ttsQueueRef.current[0];
    if (next) void prepareSpeech(next);
  };

  const playKokoroSpeech = async (item: QueuedSpeech) => {
    const { generation } = item;
    if (!item.audio) {
      setIsPreparingSpeech(true);
      setIsSpeaking(false);
    }
    const blob = item.audio || await prepareSpeech(item);
    if (generation !== speechGenerationRef.current) return;
    if (!blob) throw new Error("Kokoro is unavailable");
    const audioUrl = URL.createObjectURL(blob);
    const audio = new Audio(audioUrl);
    audio.playbackRate = savedSpeechSpeed();
    audio.volume = savedVoiceVolume();
    try { await routeAudio(audio); }
    catch { URL.revokeObjectURL(audioUrl); throw new AudioOutputError("The selected voice speaker is unavailable or blocked. Choose a connected output in Settings → Audio devices. Your reply is still in chat."); }
    if (generation !== speechGenerationRef.current) { URL.revokeObjectURL(audioUrl); return; }
    ttsAudioRef.current = audio;
    let finishPlayback: (() => void) | null = null;

    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };
        finishPlayback = finish;
        kokoroSpeechFinishRef.current = finish;
        audio.onplaying = () => {
          if (generation !== speechGenerationRef.current) return;
          setIsPreparingSpeech(false);
          setIsSpeaking(true);
          markTtsStarted();
          prepareNextSpeech();
        };
        audio.onwaiting = () => {
          if (generation !== speechGenerationRef.current) return;
          setIsSpeaking(false);
          setIsPreparingSpeech(true);
        };
        audio.onended = finish;
        audio.onpause = () => {
          if (generation !== speechGenerationRef.current) finish();
        };
        audio.onerror = () => reject(new Error("Kokoro audio playback failed"));
        void audio.play().catch(reject);
      });
    } finally {
      if (generation === speechGenerationRef.current) setIsSpeaking(false);
      if (kokoroSpeechFinishRef.current === finishPlayback) kokoroSpeechFinishRef.current = null;
      URL.revokeObjectURL(audioUrl);
      if (ttsAudioRef.current === audio) ttsAudioRef.current = null;
    }
  };

  const drainSpeechQueue = async () => {
    if (ttsWorkerActiveRef.current) return;
    ttsWorkerActiveRef.current = true;

    try {
      while (ttsQueueRef.current.length > 0) {
        const item = ttsQueueRef.current.shift();
        if (!item || item.generation !== speechGenerationRef.current) continue;

        try {
          await playKokoroSpeech(item);
        } catch (error) {
          if (item.generation === speechGenerationRef.current) {
            setChatError(error instanceof AudioOutputError ? error.message : "Kokoro is unavailable. Your reply is still available in chat.");
          }
        }
      }
    } finally {
      ttsWorkerActiveRef.current = false;
      if (ttsQueueRef.current.length > 0) {
        void drainSpeechQueue();
      } else {
        speakingRef.current = false;
        acknowledgementRef.current = false;
        suppressMicUntilRef.current = Date.now() + 350;
        setIsSpeaking(false);
        setIsPreparingSpeech(false);
      }
    }
  };

  const queueSpeech = (text: string, replaceCurrentSpeech: boolean, acknowledgement = false) => {
    const spokenText = speechText(text);
    if (typeof window === "undefined" || !spokenText) return;

    if (replaceCurrentSpeech) {
      speechGenerationRef.current += 1;
      ttsQueueRef.current = [];
      ttsAbortRef.current?.abort();
      ttsAudioRef.current?.pause();
      kokoroSpeechFinishRef.current?.();
      setIsSpeaking(false);
      setIsPreparingSpeech(true);
      acknowledgementRef.current = acknowledgement;
    }

    speakingRef.current = true;
    suppressMicUntilRef.current = Date.now() + 1500;
    let remaining = spokenText;
    while (remaining) {
      const space = remaining.length > 900 ? remaining.lastIndexOf(" ", 900) : remaining.length;
      const end = space > 0 ? space : Math.min(900, remaining.length);
      ttsQueueRef.current.push({ text: remaining.slice(0, end), generation: speechGenerationRef.current });
      remaining = remaining.slice(end).trimStart();
    }
    if (ttsAudioRef.current) prepareNextSpeech();
    void drainSpeechQueue();
  };

  const speak = (text: string) => {
    lastReplyRef.current = splitCanvasReply(text).message;
    queueSpeech(lastReplyRef.current, true);
  };

  const reportChatError = (message: string) => {
    setChatError(message);
    speak(message);
  };

  const stopSpeech = () => {
    chatAbortRef.current?.abort();
    speechGenerationRef.current += 1;
    ttsQueueRef.current = [];
    ttsAbortRef.current?.abort();
    ttsAudioRef.current?.pause();
    kokoroSpeechFinishRef.current?.();
    acknowledgementRef.current = false;
    speakingRef.current = false;
    setIsSpeaking(false);
    setIsPreparingSpeech(false);
    setChatStatus("idle");
    setAssistantMode("listening");
    suppressMicUntilRef.current = Date.now() + 350;
  };

  const startListening = async () => {
    try {
      if (!window.isSecureContext) {
        setMicError("Mic needs HTTPS or localhost");
        setAudioState("blocked");
        return;
      }

      const deviceId = savedAudioDevice(AUDIO_INPUT_KEY);
      const stream = await navigator.mediaDevices.getUserMedia(microphoneConstraints(deviceId));
      if (voiceDisposedRef.current) { stream.getTracks().forEach(track => track.stop()); return; }
      streamRef.current = stream;
      const audioWindow = window as AudioContextWindow;
      const AudioContextConstructor =
        audioWindow.AudioContext || audioWindow.webkitAudioContext;

      if (!AudioContextConstructor) {
        stream.getTracks().forEach(track => track.stop());
        setMicError("Audio is not supported here");
        setAudioState("blocked");
        return;
      }

      let audioContext: AudioContext;
      try {
        audioContext = new AudioContextConstructor({
          latencyHint: "interactive",
          sampleRate: 16_000,
        });
      } catch {
        audioContext = new AudioContextConstructor();
      }
      const source = audioContext.createMediaStreamSource(stream);
      const recorderProcessor = audioContext.createScriptProcessor(1024, 1, 1);
      const silentGain = audioContext.createGain();

      silentGain.gain.value = 0;
      source.connect(recorderProcessor);
      recorderProcessor.connect(silentGain);
      silentGain.connect(audioContext.destination);
      recorderProcessor.onaudioprocess = (event) => {
        const samples = Float32Array.from(event.inputBuffer.getChannelData(0));
        const socket = voiceSocketRef.current;
        const micSuppressed =
          (!speakingRef.current && Date.now() < suppressMicUntilRef.current) || voiceSettingsOpenRef.current;

        if (
          realtimeVoiceReadyRef.current &&
          socket?.readyState === WebSocket.OPEN &&
          (!micSuppressed || voiceSettingsOpenRef.current)
        ) {
          // Silence finishes any in-flight VAD turn without capturing previews.
          const pcm = toPcm16Khz(
            voiceSettingsOpenRef.current || desktopMutedRef.current || (!continuousMicRef.current && !talkingRef.current) ? new Float32Array(samples.length) : samples,
            audioContext.sampleRate,
          );
          socket.send(pcm.buffer);
          return;
        }

      };

      stream.getAudioTracks().forEach(track => { track.enabled = !desktopMutedRef.current && (continuousMicRef.current || talkingRef.current); });
      streamRef.current = stream;
      audioContextRef.current = audioContext;
      micSourceRef.current = source;
      recorderProcessorRef.current = recorderProcessor;
      silentGainRef.current = silentGain;
      setMicError("");
      setAudioState("listening");
    } catch (error) {
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      const message =
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Mic permission denied"
          : "Mic unavailable";

      setMicError(message);
      setAudioState("blocked");
    }
  };

  const switchMicrophone = async (id: string) => {
    // Acquire the replacement first so denied permission preserves the current mic.
    const replacement = await navigator.mediaDevices.getUserMedia(microphoneConstraints(id));
    try {
      const context = audioContextRef.current;
      const processor = recorderProcessorRef.current;
      if (voiceDisposedRef.current) throw new Error("The assistant is shutting down.");
      if (!context || !processor) { saveAudioDevice(AUDIO_INPUT_KEY, id); return; }
      const source = context.createMediaStreamSource(replacement);
      saveAudioDevice(AUDIO_INPUT_KEY, id);
      source.connect(processor);
      replacement.getAudioTracks().forEach(track => {
        track.enabled = !desktopMutedRef.current && (continuousMicRef.current || talkingRef.current);
      });
      micSourceRef.current?.disconnect();
      streamRef.current?.getTracks().forEach(track => track.stop());
      micSourceRef.current = source;
      streamRef.current = replacement;
      setMicError("");
    } finally {
      if (streamRef.current !== replacement) replacement.getTracks().forEach(track => track.stop());
    }
  };

  const switchSpeaker = async (id: string) => {
    const player = ttsAudioRef.current || new Audio();
    const previous = savedAudioDevice(AUDIO_OUTPUT_KEY);
    await routeAudio(player, id);
    try { saveAudioDevice(AUDIO_OUTPUT_KEY, id); }
    catch (error) { await routeAudio(player, previous); throw error; }
  };
  const switchVoiceVolume = (value: number) => {
    saveVoiceVolume(value);
    if (ttsAudioRef.current) ttsAudioRef.current.volume = value;
  };

  const getYouTubeQuery = (content: string) => {
    const match = content.match(
      /^(?:please\s+)?(?:play|search(?:\s+for)?)\s+(.+?)(?:\s+on\s+youtube)?[.!?]?$/i,
    );

    if (!match?.[1]) {
      return "";
    }

    return match[1]
      .replace(/\b(on\s+)?youtube\b/gi, "")
      .replace(/\b(?:and\s+)?(?:on\s+)?(?:your|you)\s+choice\b/gi, "")
      .replace(/\b(?:and\s+)?(?:on\s+)?(?:my\s+)?choice\b/gi, "")
      .replace(/\b(song|music|video)\b$/i, "")
      .trim();
  };

  const getImagePrompt = (content: string) => {
    const match = content.match(
      /^(?:please\s+)?(?:(?:generate|create|draw|make)\s+(?:an?\s+)?(?:image|picture|photo|art)?(?:\s+of)?|make\s+me\s+(?:an?\s+)?(?:image|picture|photo|art)\s+of)\s+(.+?)[.!?]?$/i,
    );

    return match?.[1]?.trim() || "";
  };

  const getRegenerateImageCommand = (content: string) => {
    if (
      /\b(?:make|generate|create|draw)\b.*\b(?:another|again|new|variant|variation)\b.*\b(?:image|picture|photo|art)?\b/i.test(
        content,
      ) ||
      /\b(?:another|again|new|variant|variation)\b.*\b(?:image|picture|photo|art)\b/i.test(
        content,
      )
    ) {
      return generatedImagePrompt;
    }

    return "";
  };

  const getMemoryCommand = (
    content: string,
  ): { action: "remember" | "list" | "forget"; text?: string } | null => {
    const rememberMatch = content.match(
      /^(?:please\s+)?(?:remember|memorize|save)\s+(?:that\s+)?(.+?)[.!?]?$/i,
    );

    if (rememberMatch?.[1]) {
      return { action: "remember", text: rememberMatch[1].trim() };
    }

    if (
      /\b(?:what|show|tell)\b.*\b(?:remember|memory|memories)\b/i.test(content) ||
      /\b(?:list|show)\s+(?:memory|memories)\b/i.test(content)
    ) {
      return { action: "list" };
    }

    const forgetMatch = content.match(
      /^(?:please\s+)?(?:forget|delete)\s+(?:memory|memories|that\s+)?(.+?)?[.!?]?$/i,
    );
    const clearMemoryMatch = content.match(
      /^(?:please\s+)?(?:clear|remove)\s+(?:memory|memories)(?:\s+(.+?))?[.!?]?$/i,
    );

    if (forgetMatch || clearMemoryMatch) {
      return {
        action: "forget",
        text: forgetMatch?.[1]?.trim() || clearMemoryMatch?.[1]?.trim() || "",
      };
    }

    return null;
  };

  const getWebFactsQuery = (content: string) => {
    const directMatch = content.match(
      /^(?:please\s+)?(?:search(?:\s+the\s+)?(?:web|internet)?(?:\s+for)?|look\s+up|lookup|google|find\s+information\s+(?:about|on))\s+(.+?)[.!?]?$/i,
    );

    if (directMatch?.[1]) {
      return directMatch[1].trim();
    }

    if (/\b(?:latest|current|today|news|internet|web)\b/i.test(content)) {
      return content.trim();
    }

    return "";
  };

  const cleanCommandText = (content: string) =>
    LISTENING_REPLY_CLEANUP_PATTERNS.reduce(
      (cleaned, pattern) => cleaned.replace(pattern, " "),
      content,
    )
      .replace(/\s+/g, " ")
      .replace(/^[,.:;!?-]+|[,.:;!?-]+$/g, "")
      .trim();

  const normalizeCommandMishears = (content: string) => {
    const normalized = content
      .replace(/\b(?:chup|chap|chet|chad|shat)\b/gi, "chat")
      .replace(/\b(?:hi|high|hidey)\s+(chat|debug|image|picture|photo|viewer)\b/gi, "hide $1")
      .replace(/\b(?:shoe|shows)\s+(chat|debug|image|picture|photo|viewer)\b/gi, "show $1")
      .replace(/\bheight\s+(chat|debug|image|picture|photo|viewer)\b/gi, "hide $1")
      .trim();

    return normalized;
  };

  const isUnroutedUiVisibilityCommand = (content: string) =>
    /\b(?:hide|close|clear|remove|show|open|display|bring\s+back|turn\s+(?:on|off))\b/i.test(
      content,
    ) &&
    /\b(?:chat|chup|chap|chet|chad|shat|image|picture|photo|viewer)\b/i.test(
      content,
    );

  const rejectUnroutedUiCommand = (content: string) => {
    const reply =
      "I heard a UI command, Sir, but I could not route it clearly. Try saying hide chat, show chat, or hide image.";

    armFollowUpCommands();
    setLastCommand("ui:unrouted");
    setMessages((currentMessages) => [
      ...currentMessages,
      { role: "user", content },
      { role: "assistant", content: reply },
    ]);
    speak(reply);
    setChatStatus("idle");
    setAssistantMode("listening");
  };

  const runMemoryCommand = async (
    content: string,
    command: { action: "remember" | "list" | "forget"; text?: string },
  ) => {
    setMessages((currentMessages) => [
      ...currentMessages,
      { role: "user", content },
    ]);
    setChatStatus("thinking");
    setAssistantMode("thinking");
    setChatError("");

    try {
      if (command.action === "list") {
        const response = await fetch("/api/memory");
        const data = (await response.json()) as {
          memories?: Array<{ text: string }>;
          error?: string;
        };

        if (!response.ok) {
          throw new Error(data.error || "Could not read memory.");
        }

        const memoryText = data.memories?.length
          ? data.memories.map((memory) => memory.text).join("; ")
          : "I do not remember anything yet, Sir.";
        const reply = data.memories?.length
          ? `I remember: ${memoryText}`
          : memoryText;

        setMessages((currentMessages) => [
          ...currentMessages,
          { role: "assistant", content: reply },
        ]);
        speak(reply);
      } else {
        const response = await fetch("/api/memory", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: command.action,
            text: command.text || "",
          }),
        });
        const data = (await response.json()) as {
          memory?: { text: string };
          removed?: number | "all";
          error?: string;
        };

        if (!response.ok) {
          throw new Error(data.error || "Could not update memory.");
        }

        const reply =
          command.action === "remember"
            ? `Remembered, Sir. ${data.memory?.text || command.text}`
            : data.removed === "all"
              ? "I forgot all saved memories, Sir."
              : `Forgot ${data.removed || 0} matching memories, Sir.`;

        setMessages((currentMessages) => [
          ...currentMessages,
          { role: "assistant", content: reply },
        ]);
        speak(reply);
      }

      setLastCommand(`memory:${command.action}`);
      armFollowUpCommands();
      setChatStatus("idle");
      setAssistantMode("listening");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not update memory.";

      setLastCommand(`memory:${command.action}:error`);
      setMessages((currentMessages) => [
        ...currentMessages,
        { role: "assistant", content: message },
      ]);
      setChatStatus("error");
      reportChatError(message);
      setAssistantMode("listening");

      armFollowUpCommands();
    }
  };

  const runWebFactsCommand = async (content: string, query: string) => {
    setMessages((currentMessages) => [
      ...currentMessages,
      { role: "user", content },
    ]);
    setChatStatus("thinking");
    setAssistantMode("thinking");
    setChatError("");

    try {
      const response = await fetch("/api/web-facts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      });
      const data = (await response.json()) as {
        answer?: string;
        sourceTitle?: string;
        sourceUrl?: string;
        error?: string;
      };

      if (!response.ok || !data.answer) {
        throw new Error(data.error || "Could not search the web.");
      }

      const source = data.sourceTitle
        ? ` Source: ${data.sourceTitle}${data.sourceUrl ? ` (${data.sourceUrl})` : ""}`
        : "";
      const reply = `${data.answer}${source}`;

      setMessages((currentMessages) => [
        ...currentMessages,
        { role: "assistant", content: reply },
      ]);
      speak(data.answer);
      setLastCommand(`web:${query}`);
      armFollowUpCommands();
      setChatStatus("idle");
      setAssistantMode("listening");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not search the web.";

      setMessages((currentMessages) => [
        ...currentMessages,
        { role: "assistant", content: message },
      ]);
      setLastCommand("web:error");
      setChatStatus("error");
      reportChatError(message);
      setAssistantMode("listening");

      armFollowUpCommands();
    }
  };

  const runWeatherCommand = async (
    content: string,
    day: "today" | "tomorrow",
  ) => {
    setMessages((currentMessages) => [
      ...currentMessages,
      { role: "user", content },
    ]);
    setChatStatus("thinking");
    setAssistantMode("thinking");
    setChatError("");

    try {
      const position = await new Promise<GeolocationPosition | null>((resolve) => {
        if (!navigator.geolocation) {
          resolve(null);
          return;
        }

        navigator.geolocation.getCurrentPosition(
          resolve,
          () => resolve(null),
          { enableHighAccuracy: false, maximumAge: 10 * 60_000, timeout: 5_000 },
        );
      });
      const params = new URLSearchParams({ day });

      if (position) {
        params.set("latitude", String(position.coords.latitude));
        params.set("longitude", String(position.coords.longitude));
      }

      const response = await fetch(`/api/weather?${params}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as {
        answer?: string;
        sourceTitle?: string;
        sourceUrl?: string;
        error?: string;
      };

      if (!response.ok || !data.answer) {
        throw new Error(data.error || "Could not retrieve the weather.");
      }

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          role: "assistant",
          content: `${data.answer} Source: ${data.sourceTitle || "Open-Meteo"}.`,
        },
      ]);
      speak(data.answer);
      setLastCommand(`weather:${day}`);
      armFollowUpCommands();
      setChatStatus("idle");
      setAssistantMode("listening");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not retrieve the weather.";

      setMessages((currentMessages) => [
        ...currentMessages,
        { role: "assistant", content: message },
      ]);
      setLastCommand("weather:error");
      setChatStatus("error");
      reportChatError(message);
      setAssistantMode("listening");

      armFollowUpCommands();
    }
  };

  const isNonCommandTranscript = (content: string) => {
    if (fileRequestRef.current?.question && Date.now() < commandArmedUntilRef.current && content.trim()) return false;
    if (parseVoiceCommand(content)) return false;
    const withoutCaptions = NON_COMMAND_TRANSCRIPT_PATTERNS.reduce(
      (cleaned, pattern) => cleaned.replace(pattern, " "),
      content,
    );
    const cleaned = cleanCommandText(withoutCaptions);

    if (!cleaned) {
      return true;
    }

    if (!COMMAND_VERB_PATTERN.test(cleaned) && cleaned.split(/\s+/).length <= 4) {
      return true;
    }

    return false;
  };

  const armFollowUpCommands = () => {
    commandArmedUntilRef.current = Date.now() + COMMAND_ARM_WINDOW_MS;
  };

  const isStopVideoCommand = (content: string) =>
    /\b(?:stop|close|turn\s+off|hide)\b.*\b(?:video|youtube|music|song|player)\b/i.test(
      content,
    ) ||
    /\b(?:stop|close|turn\s+off|hide)\s+(?:it|that)\b/i.test(content) ||
    /\b(?:put|turn)\b.*\b(?:music|song|youtube|video)\b.*\b(?:away|off)\b/i.test(
      content,
    );

  const isHideImageCommand = (content: string) =>
    /\b(?:hide|close|clear|remove|turn\s+off)\b.*\b(?:image|picture|photo|viewer|comfy|comfyui)\b/i.test(
      content,
    ) ||
    /\b(?:hide|close|clear|remove)\s+(?:it|that)\b/i.test(content);

  const getChatVisibilityCommand = (content: string): "hide" | "show" | "" => {
    // Spoken "Chat GPT" names the website, not the chat panel.
    const normalized = content.toLowerCase().replace(/\bchat\s+g\s*p\s*t\b/g, "chatgpt");

    if (/\b(?:hide|close|remove|turn\s+off)\b.*\b(?:chat|conversation|transcript|messages?)\b/.test(normalized)) {
      return "hide";
    }

    if (/\b(?:show|open|bring\s+back|display|turn\s+on)\b.*\b(?:chat|conversation|transcript|messages?)\b/.test(normalized)) {
      return "show";
    }

    return "";
  };

  const getLocalTimeCommand = (content: string): "time" | "date" | "" => {
    const normalized = content.toLowerCase().trim();

    if (
      /\b(?:what|tell|say)\b.*\btime\b/.test(normalized) ||
      /\btime\s+is\s+it\b/.test(normalized)
    ) {
      return "time";
    }

    if (
      /\b(?:what|tell|say)\b.*\b(?:date|day)\b/.test(normalized) ||
      /\b(?:date|day)\s+is\s+it\b/.test(normalized)
    ) {
      return "date";
    }

    return "";
  };

  const isCleanUiCommand = (content: string) =>
    /^\s*(?:clean|clear|declutter)\s+(?:ui|interface|screen)\s*[.!?]?\s*$/i.test(
      content,
    ) ||
    /\b(?:clean|clear|declutter|hide)\b.*\b(?:ui|interface|screen|everything|all panels|all windows)\b/i.test(
      content,
    ) ||
    /\b(?:clean|clear|declutter)\s+(?:it|this|the screen)\b/i.test(content);

  const routeLocalCommand = (content: string): LocalCommand | null => {
    if (/^(?:(?:hey\s+)?jimmy[\s,]+)?(?:please\s+)?(?:it[’']?s\s+)?time\s+for\s+work[.!?]*$/i.test(content.trim())) {
      return { kind: "work-start" };
    }
    const voiceCommand = parseVoiceCommand(content);
    if (voiceCommand) return voiceCommand;
    try { if (selectTool(content, readToolsRef.current)) return { kind: "n8n-read" }; }
    catch { return { kind: "n8n-read" }; }
    if (isCleanUiCommand(content)) {
      return { kind: "clean-ui" };
    }

    const browserSearch = parseBrowserSearch(content, lastBrowserSearchRef.current);
    if (browserSearch) return browserSearch;

    const memoryCommand = getMemoryCommand(content);

    if (memoryCommand) {
      return { kind: "memory", ...memoryCommand };
    }

    const localTimeCommand = getLocalTimeCommand(content);

    if (localTimeCommand) {
      return { kind: "local-time", mode: localTimeCommand };
    }

    if (/\b(?:weather|forecast|temperature|rain|raining)\b/i.test(content)) {
      return {
        kind: "weather",
        day: /\btomorrow\b/i.test(content) ? "tomorrow" : "today",
      };
    }

    const webFactsQuery = getWebFactsQuery(content);

    if (webFactsQuery) {
      return { kind: "web-facts", query: webFactsQuery };
    }

    const chatVisibilityCommand = getChatVisibilityCommand(content);

    if (chatVisibilityCommand) {
      return { kind: "chat-visibility", action: chatVisibilityCommand };
    }

    if (isHideImageCommand(content)) {
      return { kind: "image-hide" };
    }

    const regeneratePrompt = getRegenerateImageCommand(content);

    if (regeneratePrompt) {
      return { kind: "image-regenerate", prompt: regeneratePrompt };
    }

    const imagePrompt = getImagePrompt(content);

    if (imagePrompt) {
      return { kind: "image-generate", prompt: imagePrompt };
    }

    const youtubeControl = getYouTubeControlCommand(content);

    if (youtubeControl) {
      return { kind: "youtube-control", action: youtubeControl };
    }

    const localApp = parseLocalAppCommand(content);

    if (localApp) {
      return { kind: "app", ...localApp };
    }

    const browserLink = parseBrowserLink(content);
    if (browserLink) return { kind: "browser-link", name: browserLink };

    if (isStopVideoCommand(content)) {
      return { kind: "youtube-stop" };
    }

    const musicQuery = randomMusicQuery(content);
    if (musicQuery) return { kind: "youtube-play", query: musicQuery, random: true };

    const youtubeQuery = getYouTubeQuery(content);

    if (youtubeQuery) {
      return { kind: "youtube-play", query: youtubeQuery };
    }

    return null;
  };

  const inspectScreen = async (question: string, capture?: Promise<string>) => {
    stopSpeech();
    setChatError("");
    if (!window.jimmyDesktop && !capture) {
      setPendingScreenQuestion(question);
      const reply = "Click Share screen and choose a screen or window so I can look at one snapshot.";
      setMessages(current => [...current, { role: "user", content: question }, { role: "assistant", content: reply }]);
      speak(reply);
      return;
    }
    const controller = new AbortController();
    chatAbortRef.current = controller;
    setChatStatus("thinking");
    setAssistantMode("thinking");
    setMessages(current => [...current, { role: "user", content: question }]);
    try {
      const image = await (capture || window.jimmyDesktop!.captureScreen());
      if (controller.signal.aborted) return;
      const response = await fetch("/api/screen", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image, question, assistantName: savedAssistantName() }), signal: controller.signal,
      });
      const data = await response.json() as { answer?: string; error?: string; model?: string };
      if (!response.ok || !data.answer) throw new Error(data.error || "Screen analysis failed.");
      if (controller.signal.aborted) return;
      setPendingScreenQuestion("");
      setMessages(current => [...current, { role: "assistant", content: data.answer! }]);
      setLastBrain("screen");
      setRoutingNote(`Local snapshot analysis with ${data.model}`);
      lastReplyRef.current = data.answer;
      speak(data.answer);
      armFollowUpCommands();
    } catch (error) {
      if (!controller.signal.aborted) reportChatError(error instanceof Error ? error.message : "Could not see the screen.");
    } finally {
      if (chatAbortRef.current === controller) {
        chatAbortRef.current = null;
        setChatStatus("idle");
        setAssistantMode("listening");
      }
    }
  };

  const advancePlan = async (content: string): Promise<void> => {
    const current = planRef.current;
    if (!current) return;
    const action = planAction(content);
    if (action === "cancel") {
      stopSpeech();
      planRef.current = null; setActivePlan(null); setChatError("");
      const reply = "Plan cancelled. Nothing was created.";
      setMessages(messages => [...messages, { role: "user", content }, { role: "assistant", content: reply }]);
      speak(reply); return;
    }
    if (action === "confirm") {
      if (!current.summary) {
        const reply = "Let me finish clarifying the task before you confirm the plan.";
        setMessages(messages => [...messages, { role: "assistant", content: reply }]);
        speak(reply); return;
      }
      if (current.workflow) {
        await runLocalCommand(content, { kind: "n8n-create", prompt: `Create an n8n workflow according to this approved plan: ${current.summary}` }, true);
      } else {
        planRef.current = null; setActivePlan(null);
        const reply = "The agreed plan is in chat. This planning conversation has not executed any actions.";
        setMessages(messages => [...messages, { role: "assistant", content: reply }]); speak(reply);
      }
      return;
    }
    stopSpeech();
    const controller = new AbortController(); chatAbortRef.current = controller;
    const allMessages = [...current.messages, { role: "user" as const, content }];
    const history = allMessages.length > 15 ? [allMessages[0], ...allMessages.slice(-14)] : allMessages;
    const pending = { workflow: current.workflow, messages: history };
    planRef.current = pending; setActivePlan(pending);
    setChatStatus("thinking"); setAssistantMode("thinking"); setChatError(""); setIsChatVisible(true);
    setMessages(messages => [...messages, { role: "user", content }]);
    try {
      const response = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflow: current.workflow, messages: history }), signal: controller.signal });
      const result = await response.json() as { question?: string; summary?: string; error?: string };
      if (!response.ok || (!result.question && !result.summary)) throw new Error(result.error || "Could not prepare the plan.");
      if (controller.signal.aborted) return;
      const reply = result.question || `${result.summary} ${current.workflow ? 'Say “Create it” to save this as an inactive n8n draft, or tell me what to change.' : 'Tell me what to change, or say “End plan” when finished.'}`;
      const next = { workflow: current.workflow, messages: [...history, { role: "assistant" as const, content: reply }], summary: result.summary || undefined };
      planRef.current = next; setActivePlan(next);
      setMessages(messages => [...messages, { role: "assistant", content: reply }]);
      lastReplyRef.current = reply; speak(reply); armFollowUpCommands();
    } catch (error) { if (!controller.signal.aborted) reportChatError(error instanceof Error ? error.message : "Planning failed."); }
    finally {
      if (chatAbortRef.current === controller) { chatAbortRef.current = null; setChatStatus("idle"); setAssistantMode("listening"); }
    }
  };

  const runTodoCommand = async (content: string, command: TodoCommand): Promise<void> => {
    if (command.timeError) {
      setMessages(current => [...current, { role: "user", content }, { role: "assistant", content: command.timeError! }]);
      speak(command.timeError); armFollowUpCommands(); return;
    }
    if (command.action === "hide") {
      hideTodoPreview();
      const reply = "To-do list hidden.";
      setMessages(current => [...current, { role: "user", content }, { role: "assistant", content: reply }]);
      speak(reply); armFollowUpCommands(); return;
    }
    const previewVersion = todoPreviewVersionRef.current;
    stopSpeech(); setChatError(""); setChatStatus("thinking"); setAssistantMode("thinking"); setIsChatVisible(true);
    setMessages(current => [...current, { role: "user", content }]);
    const controller = new AbortController(); chatAbortRef.current = controller;
    const day = command.day || (command.action === "add" || command.action === "done" || command.action === "time" ? pendingTodoDayRef.current || lastTodoDayRef.current || "today" : "today");
    const needsText = (command.action === "add" || command.action === "create") && !command.text;
    try {
      const listing = command.action === "list" || command.action === "add" && needsText;
      const response = await fetch(listing ? `/api/todos?day=${encodeURIComponent(day)}` : "/api/todos", { signal: controller.signal, ...(listing ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: command.action, day, ...(command.text ? { text: command.text } : {}), ...(command.time !== undefined ? { time: command.time } : {}), ...(command.action === "done" || command.action === "time" ? { number: command.number, ...(command.done !== undefined ? { done: command.done } : {}) } : {}) }) }) });
      const data = await response.json() as TodoView & { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not update the to-do list.");
      if (controller.signal.aborted) return;
      if (previewVersion === todoPreviewVersionRef.current) canvas.publish({ title: `To-do list · ${data.label}`, source: "Saved to-do list", ...(data.tasks.length > 200 ? { note: `Showing the first 200 of ${data.tasks.length} saved tasks. Settings → To-do list shows the complete list.` } : {}), blocks: [{ type: "table", columns: ["#", "Time", "Task", "Status"], rows: data.tasks.slice(0, 200).map((task, index) => [index + 1, task.time ? formatTodoTime(task.time) : "Not scheduled", task.text, task.done ? "Done" : "To do"]) }] });
      privateToolHistoryRef.current = true;
      lastTodoDayRef.current = data.day;
      pendingTodoDayRef.current = needsText ? data.day : null;
      pendingTodoTimeRef.current = needsText ? command.time : undefined;
      const reply = needsText ? `${command.action === "create" ? `Your to-do list for ${data.label} is ready. Existing tasks have been kept.` : `I can add a task to your list for ${data.label}.`} What would you like to add?`
        : command.action === "list" ? `Your to-do list for ${data.label} is on the canvas. ${data.tasks.filter(task => !task.done).length} remaining.` : command.action === "time" ? `Task ${command.number} is set for ${formatTodoTime(command.time!)} (${data.label}).` : command.action === "done" ? `Task ${command.number} is marked ${command.done ? "done" : "not done"} for ${data.label}.` : `Saved to your to-do list for ${data.label}. The updated list is on the canvas.`;
      setMessages(current => [...current, { role: "assistant", content: reply }]);
      setLastCommand("todo:" + command.action); setRoutingNote("Saved to-do lists are managed locally.");
      speak(reply); armFollowUpCommands();
    } catch (error) { if (!controller.signal.aborted) reportChatError(error instanceof Error ? error.message : "Could not update tasks."); }
    finally { if (chatAbortRef.current === controller) { chatAbortRef.current = null; setChatStatus("idle"); setAssistantMode("listening"); } }
  };

  const runLocalCommand = async (content: string, command: LocalCommand, confirmed = false): Promise<void> => {
    if (command.kind === "ui-sequence" || command.kind === "canvas" || command.kind === "desktop-view" || command.kind === "desktop-hide") {
      stopSpeech(); setChatError("");
      const replies: string[] = [];
      try {
        for (const step of command.kind === "ui-sequence" ? command.commands : [command]) {
          if (step.kind === "canvas") {
            if (step.action === "open") canvas.show(); else await canvas.hide();
            replies.push(step.action === "open" ? "Your data canvas is ready." : "Canvas hidden.");
          } else if (step.kind === "desktop-hide") {
            if (window.jimmyDesktop) {
              await window.jimmyDesktop.hide();
              replies.push(`Hidden to the tray. Say “${savedAssistantName()}, open dashboard” or use the tray icon to bring me back.`);
            } else replies.push("Hiding to the tray is available in the desktop app.");
          } else {
            await window.jimmyDesktop?.expand(step.expanded);
            canvas.closeModel();
            if (step.expanded) setIsChatVisible(true);
            replies.push(window.jimmyDesktop ? step.expanded ? "Full dashboard open, Sir." : "Back to the small circle, Sir."
              : step.expanded ? "Your dashboard is open." : "Compact circle mode is available in the desktop app, Sir.");
          }
        }
      } catch { replies.push("I couldn't finish the window commands. Please try again."); }
      const reply = replies.join(" ");
      setMessages(current => [...current, { role: "user", content }, { role: "assistant", content: reply }]);
      speak(reply); armFollowUpCommands(); return;
    }
    if (command.kind === "local-files") {
      chatAbortRef.current?.abort(); stopSpeech();
      if (command.action === "cancel") {
        fileRequestRef.current = null;
        chatAbortRef.current = null; setChatStatus("idle"); setAssistantMode("listening");
        const reply = "Laptop scan cancelled. No files were changed.";
        setMessages(current => [...current, { role: "user", content }, { role: "assistant", content: reply }]);
        speak(reply); armFollowUpCommands(); return;
      }
      fileRequestRef.current = { request: content.slice(0, 4000), command };
      setChatError(""); setChatStatus("thinking"); setAssistantMode("thinking");
      setMessages(current => [...current, { role: "user", content }]);
      const controller = new AbortController(); chatAbortRef.current = controller;
      try {
        const response = await fetch("/api/local-files", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command), signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not scan your laptop.");
        if (controller.signal.aborted) return;
        const preview = (data.canvas as CanvasContent).blocks.find((block): block is Extract<CanvasBlock, { type: "files" }> => block.type === "files" && block.autoPreview === true && block.entries.length === 1 && !!block.entries[0].modelToken);
        canvas.publish(preview ? { ...data.canvas, blocks: data.canvas.blocks.map((block: CanvasBlock) => block.type === "files" ? { ...block, autoPreview: false } : block) } : data.canvas, !preview);
        if (preview) await canvas.openModel(await loadLocalModel(preview.entries[0], controller.signal));
        setMessages(current => [...current, { role: "assistant", content: data.reply }]);
        lastReplyRef.current = data.reply;
        setLastBrain("local"); setRoutingNote("Read-only laptop scan; file listings stay on this device.");
        speak(data.reply); armFollowUpCommands();
      } catch (error) { if (!controller.signal.aborted) reportChatError(error instanceof Error ? error.message : "Could not scan your laptop."); }
      finally { if (chatAbortRef.current === controller) { chatAbortRef.current = null; setChatStatus("idle"); setAssistantMode("listening"); } }
      return;
    }
    if (command.kind === "todo") { await runTodoCommand(content, command); return; }
    pendingTodoDayRef.current = null;
    if (command.kind === "audio-output" || command.kind === "voice-volume" || command.kind === "audio-settings") {
      stopSpeech(); setChatError(""); setChatStatus("thinking"); setAssistantMode("thinking");
      setMessages(current => [...current, { role: "user", content }]);
      try {
        let reply: string;
        if (command.kind === "audio-output") {
          const device = selectVoiceOutput(await navigator.mediaDevices.enumerateDevices(), command.target);
          await switchSpeaker(device.deviceId);
          reply = `My voice will use ${device.label}. Music output is unchanged.`;
        } else if (command.kind === "voice-volume") {
          switchVoiceVolume(command.percent / 100);
          reply = `My voice volume is ${command.percent} percent. Music volume is unchanged.`;
        } else {
          const response = await requestLocalApp({ action: "audio-settings", page: command.page });
          const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not open Windows settings.");
          reply = command.page === "bluetooth" ? "Opened Windows Bluetooth settings. Pair or connect your device there, then choose your voice output in the assistant’s audio settings." : "Opened the Windows volume mixer. Choose the Bluetooth speaker for your music app and keep my voice on your laptop speakers.";
        }
        setMessages(current => [...current, { role: "assistant", content: reply }]);
        speak(reply); armFollowUpCommands();
      } catch (error) { reportChatError(error instanceof Error ? error.message : "Could not change voice audio."); }
      finally { setChatStatus("idle"); setAssistantMode("listening"); }
      return;
    }
    if (command.kind === "knowledge-learn" || command.kind === "knowledge-note" || command.kind === "knowledge-list" || command.kind === "knowledge-discover") {
      stopSpeech(); setChatError(""); setChatStatus("thinking"); setAssistantMode("thinking");
      setMessages(current => [...current, { role: "user", content }]);
      const controller = new AbortController(); chatAbortRef.current = controller;
      try {
        const listing = command.kind === "knowledge-list";
        const response = await fetch("/api/knowledge", { signal: controller.signal,
          ...(listing ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command.kind === "knowledge-learn" ? { action: "learn", url: command.url } : command.kind === "knowledge-discover" ? { action: "discover", topic: command.topic } : { action: "note", text: command.text }) }) });
        const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not update knowledge.");
        const reply = listing ? data.entries.length ? `Saved knowledge: ${data.entries.slice(0, 10).map((entry: { title: string }) => entry.title).join("; ")}. You can review sources and forget entries in Settings, Knowledge.` : "My knowledge library is empty. You can teach me a lesson or give me an official n8n documentation link."
          : command.kind === "knowledge-learn" || command.kind === "knowledge-discover" ? `Saved reference: ${data.entry.title}. ${data.entry.official ? `Publisher identified: ${data.entry.publisher}.` : "I have not established that this source is official."} I can retrieve it for relevant tasks.` : "Saved your lesson. I will retrieve it when it matches the task.";
        setMessages(current => [...current, { role: "assistant", content: reply }]); speak(reply); armFollowUpCommands();
      } catch (error) { if (!controller.signal.aborted) reportChatError(error instanceof Error ? error.message : "Could not learn that."); }
      finally { if (chatAbortRef.current === controller) { chatAbortRef.current = null; setChatStatus("idle"); setAssistantMode("listening"); } }
      return;
    }
    if (command.kind === "task-plan" || (command.kind === "n8n-create" && !confirmed)) {
      const next = { workflow: command.kind === "n8n-create" || /\b(?:n8n|workflow)\b/i.test(command.prompt), messages: [] };
      planRef.current = next; setActivePlan(next);
      await advancePlan(command.prompt); return;
    }
    if (command.kind === "screen-inspect") { await inspectScreen(content); return; }
    if (command.kind === "n8n-create") {
      stopSpeech();
      setChatError("");
      setLastCommand("n8n:create");
      const controller = new AbortController();
      chatAbortRef.current = controller;
      setChatStatus("thinking");
      setAssistantMode("thinking");
      setMessages(current => [...current, { role: "user", content }]);
      try {
        const response = await fetch("/api/n8n-workflow", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: command.prompt, confirmed: true }), signal: controller.signal,
        });
        const data = await response.json() as { name?: string; nodeCount?: number; url?: string; error?: string };
        if (!response.ok || !data.name || !data.url) throw new Error(data.error || "n8n did not confirm workflow creation.");
        if (controller.signal.aborted) return;
        planRef.current = null; setActivePlan(null);
        const reply = `Created “${data.name}” in n8n with ${data.nodeCount} nodes, Sir. It's an inactive draft. Review its settings and connect any credentials before running it.`;
        setMessages(current => [...current, { role: "assistant", content: reply, workflowUrl: data.url }]);
        setIsChatVisible(true);
        setLastBrain("qwen");
        setRoutingNote("Created an inactive n8n workflow using the selected local model.");
        lastReplyRef.current = reply;
        speak(reply);
        armFollowUpCommands();
      } catch (error) {
        if (!controller.signal.aborted) reportChatError(error instanceof Error ? error.message : "Could not create the workflow.");
      } finally {
        if (chatAbortRef.current === controller) {
          chatAbortRef.current = null;
          setChatStatus("idle");
          setAssistantMode("listening");
        }
      }
      return;
    }
    if (command.kind.startsWith("speech-") || command.kind === "command-help") {
      const previousReply = lastReplyRef.current;
      stopSpeech();
      let reply = "";
      if (command.kind === "speech-stop") reply = "Stopped speaking.";
      if (command.kind === "speech-repeat") reply = previousReply || "I haven't said anything to repeat yet.";
      if (command.kind === "command-help") reply = COMMAND_HELP.replace(/\bJimmy\b/g, savedAssistantName());
      if (command.kind === "speech-speed") {
        const speed = command.direction === "normal" ? 1 : Math.max(0.6, Math.min(1.5,
          Math.round((savedSpeechSpeed() + (command.direction === "slower" ? -0.15 : 0.15)) * 100) / 100));
        try {
          localStorage.setItem(SPEECH_SPEED_STORAGE_KEY, String(speed));
          reply = `I'll speak at ${Math.round(speed * 100)} percent speed.`;
        } catch { reply = "I couldn't save the speech speed. Please allow site storage and try again."; }
      }
      if (command.kind === "speech-voice") {
        const voice = kokoroLanguages.flatMap(group => group.voices).find(item =>
          item.name.toLowerCase() === command.name || item.id === command.name.replaceAll(" ", "_"));
        if (!voice) reply = `I couldn't find an English voice named ${command.name}. Open voice settings to see the available names.`;
        else {
          try {
            localStorage.setItem(KOKORO_VOICE_STORAGE_KEY, voice.id);
            reply = `My voice is now ${voice.name}.`;
          } catch { reply = "I couldn't save the voice. Please allow site storage and try again."; }
        }
      }
      setMessages(current => [...current, { role: "user", content }, { role: "assistant", content: reply }]);
      setLastCommand(command.kind);
      armFollowUpCommands();
      if (command.kind === "command-help") lastReplyRef.current = reply;
      if (command.kind !== "speech-stop") {
        queueSpeech(reply, true, command.kind !== "speech-repeat" && command.kind !== "command-help");
      }
      return;
    }
    if (command.kind === "local-time") {
      runLocalTimeCommand(content, command.mode);
      return;
    }

    if (command.kind === "weather") {
      await runWeatherCommand(content, command.day);
      return;
    }

    if (command.kind === "work-start") {
      setChatError("");
      setLastCommand("work:start");
      setMessages(current => [...current, { role: "user", content }]);
      const tasks = [
        { name: "ChatGPT", body: { action: "open-link", name: "ChatGPT" } },
        { name: "Brave", body: { action: "open", app: "brave" } },
        { name: "Visual Studio Code", body: { action: "open", app: "visual-studio" } },
      ];
      const results = await Promise.allSettled(tasks.map(async task => {
        const response = await requestLocalApp(task.body);
        const data = await response.json() as { error?: string };
        if (!response.ok) throw new Error(data.error || `Could not open ${task.name}.`);
      }));
      const opened = tasks.filter((_, index) => results[index].status === "fulfilled").map(task => task.name);
      const failed = tasks.filter((_, index) => results[index].status === "rejected").map(task => task.name);
      const reply = failed.length
        ? `${opened.length ? `Opened ${opened.join(", ")}. ` : ""}I couldn't open ${failed.join(", ")}.`
        : "Time for work, Sir. Opened ChatGPT in your browser, Brave, and Visual Studio Code.";
      if (failed.length) setChatError(results.filter(result => result.status === "rejected").map(result => String(result.reason instanceof Error ? result.reason.message : result.reason)).join(" "));
      setMessages(current => [...current, { role: "assistant", content: reply }]);
      queueSpeech(reply, true, true);
      armFollowUpCommands();
      return;
    }

    if (command.kind === "browser-link") {
      setChatError("");
      setLastCommand("browser:open-link");
      setMessages(current => [...current, { role: "user", content }]);
      try {
        const response = await requestLocalApp({ action: "open-link", name: command.name });
        const data = await response.json() as { error?: string; reply?: string };
        if (!response.ok) throw new Error(data.error || "Could not open the browser shortcut.");
        const reply = data.reply || `Asked your default browser to open ${command.name}.`;
        setMessages(current => [...current, { role: "assistant", content: reply }]);
        queueSpeech(reply, true, true);
        armFollowUpCommands();
      } catch (error) {
        reportChatError(error instanceof Error ? error.message : "Could not open the browser shortcut.");
      }
      return;
    }

    if (command.kind === "browser-search") {
      setChatError("");
      setLastCommand("browser:search");
      setMessages(current => [...current, { role: "user", content }]);
      try {
        const response = await requestLocalApp({ action: "search", query: command.query, images: command.images });
        const data = await response.json() as { error?: string };
        if (!response.ok) throw new Error(data.error || "Could not open the browser search.");
        lastBrowserSearchRef.current = command;
        const reply = `Opened ${command.images ? "image search" : "search results"} for ${command.query} in your default browser.`;
        setMessages(current => [...current, { role: "assistant", content: reply }]);
        speak(reply);
        armFollowUpCommands();
      } catch (error) {
        reportChatError(error instanceof Error ? error.message : "Could not open the browser search.");
      }
      return;
    }

    if (command.kind === "web-facts") {
      await runWebFactsCommand(content, command.query);
      return;
    }

    if (command.kind === "memory") {
      await runMemoryCommand(content, command);
      return;
    }

    if (command.kind === "clean-ui") {
      setLastCommand("ui:clean");
      cleanUiByCommand(content);
      return;
    }

    if (command.kind === "chat-visibility") {
      setLastCommand(`chat:${command.action}`);
      setChatVisibilityByCommand(content, command.action);
      return;
    }

    if (command.kind === "image-hide") {
      setLastCommand("image:hide");
      hideImageViewer(content);
      return;
    }

    if (command.kind === "image-generate" || command.kind === "image-regenerate") {
      setLastCommand(`${command.kind === "image-regenerate" ? "image:regenerate" : "image:generate"} ${command.prompt}`);
      await generateImage(content, command.prompt);
      return;
    }

    if (command.kind === "youtube-control") {
      setLastCommand(`youtube:${command.action}`);
      await runYouTubeControl(content, command.action);
      return;
    }

    if (command.kind === "app") {
      setLastCommand(`app:${command.action}${command.app ? `:${command.app}` : ""}`);
      await runLocalAppCommand(content, command);
      return;
    }

    if (command.kind === "youtube-stop") {
      setLastCommand("youtube:stop");
      stopYouTube(content);
      return;
    }

    if (command.kind === "youtube-play") {
      setLastCommand(`youtube:play ${command.query}`);
      setMessages((currentMessages) => [
        ...currentMessages,
        { role: "user", content },
      ]);
      await openYouTube(command.query, command.random);
      setChatStatus("idle");
      setAssistantMode("listening");
    }
  };

  const cleanUiByCommand = (content: string) => {
    const reply = "Cleaned up the UI, Sir.";

    setIsChatVisible(false);
    setIsYouTubePlayerVisible(false);
    setGeneratedImageUrl("");
    setGeneratedImagePrompt("");
    setImageStatus("idle");
    setImageError("");
    armFollowUpCommands();
    setMessages((currentMessages) => [
      ...currentMessages,
      { role: "user", content },
      { role: "assistant", content: reply },
    ]);
    speak(reply);
    setChatStatus("idle");
    setAssistantMode("listening");
  };

  const runLocalTimeCommand = (content: string, mode: "time" | "date") => {
    const now = new Date();
    const reply =
      mode === "time"
        ? `It's ${now.toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}, Sir.`
        : `It's ${now.toLocaleDateString([], {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
          })}, Sir.`;

    setLastCommand(`local:${mode}`);
    setMessages((currentMessages) => [
      ...currentMessages,
      { role: "user", content },
      { role: "assistant", content: reply },
    ]);
    speak(reply);
    armFollowUpCommands();
    setChatStatus("idle");
    setAssistantMode("listening");
  };

  const setChatVisibilityByCommand = (content: string, command: "hide" | "show") => {
    const nextVisible = command === "show";
    const reply = nextVisible
      ? "Showing the chat, Sir."
      : "Hiding the chat, Sir.";

    setIsChatVisible(nextVisible);
    armFollowUpCommands();
    setMessages((currentMessages) => [
      ...currentMessages,
      { role: "user", content },
      { role: "assistant", content: reply },
    ]);
    speak(reply);
    setChatStatus("idle");
    setAssistantMode("listening");
  };

  const hideImageViewer = (content: string) => {
    const reply = generatedImageUrl
      ? "Hiding the image viewer, Sir."
      : "There is no image viewer open right now, Sir.";

    setGeneratedImageUrl("");
    setGeneratedImagePrompt("");
    setImageStatus("idle");
    setImageError("");
    armFollowUpCommands();
    setMessages((currentMessages) => [
      ...currentMessages,
      { role: "user", content },
      { role: "assistant", content: reply },
    ]);
    speak(reply);
    setChatStatus("idle");
    setAssistantMode("listening");
  };

  const getYouTubeControlCommand = (
    content: string,
  ):
    | "pause"
    | "resume"
    | "next"
    | "lower-volume"
    | "mute"
    | "replay"
    | "similar"
    | "show-player"
    | "hide-player"
    | "" => {
    const normalized = content.toLowerCase();

    if (/\b(?:hide|close|put\s+away)\b.*\b(?:youtube\s+)?player\b/.test(normalized)) {
      return "hide-player";
    }

    if (/\b(?:show|open|bring\s+back|display)\b.*\b(?:youtube\s+)?player\b/.test(normalized)) {
      return "show-player";
    }

    if (/\b(?:pause|hold)\b.*\b(?:video|youtube|music|song|player|it)?\b/.test(normalized)) {
      return "pause";
    }

    if (/\b(?:resume|continue|unpause)\b.*\b(?:video|youtube|music|song|player|it)?\b/.test(normalized)) {
      return "resume";
    }

    if (/\b(?:next|skip)\b.*\b(?:video|youtube|music|song|track|one|it)?\b/.test(normalized)) {
      return "next";
    }

    if (/\b(?:lower|decrease|turn\s+down|reduce)\b.*\bvolume\b/.test(normalized)) {
      return "lower-volume";
    }

    if (/\b(?:mute|silence)\b.*\b(?:video|youtube|music|song|player|it)?\b/.test(normalized)) {
      return "mute";
    }

    if (/\b(?:replay|restart|start\s+over)\b.*\b(?:video|youtube|music|song|player|it)?\b/.test(normalized)) {
      return "replay";
    }

    if (/\bplay\b.*\b(?:something|song|music|video)?\s*similar\b/.test(normalized)) {
      return "similar";
    }

    return "";
  };

  const postYouTubeCommand = (
    func: "pauseVideo" | "playVideo" | "mute" | "setVolume" | "seekTo",
    args: Array<number | boolean> = [],
  ) => {
    const iframe = document.querySelector<HTMLIFrameElement>(
      'iframe[title^="YouTube player"]',
    );

    iframe?.contentWindow?.postMessage(
      JSON.stringify({
        event: "command",
        func,
        args,
      }),
      "https://www.youtube.com",
    );
  };

  const runYouTubeControl = async (
    content: string,
    command:
      | "pause"
      | "resume"
      | "next"
      | "lower-volume"
      | "mute"
      | "replay"
      | "similar"
      | "show-player"
      | "hide-player",
  ) => {
    let reply = "There is no YouTube video playing right now, Sir.";

    if (command === "similar") {
      if (!youtubeQuery) {
        armFollowUpCommands();
        setMessages((currentMessages) => [
          ...currentMessages,
          { role: "user", content },
          { role: "assistant", content: reply },
        ]);
        speak(reply);
        setChatStatus("idle");
        setAssistantMode("listening");
        return;
      }

      setMessages((currentMessages) => [
        ...currentMessages,
        { role: "user", content },
      ]);
      await openYouTube(`${youtubeQuery} similar`);
      setChatStatus("idle");
      setAssistantMode("listening");
      return;
    }

    if (youtubeVideoId) {
      if (command === "pause") {
        postYouTubeCommand("pauseVideo");
        reply = "Paused it, Sir.";
      } else if (command === "resume") {
        postYouTubeCommand("playVideo");
        reply = "Resuming it, Sir.";
      } else if (command === "lower-volume") {
        const nextVolume = Math.max(10, youtubeVolume - 20);

        postYouTubeCommand("setVolume", [nextVolume]);
        setYouTubeVolume(nextVolume);
        reply = `Lowered the volume to ${nextVolume}%, Sir.`;
      } else if (command === "mute") {
        postYouTubeCommand("mute");
        setYouTubeVolume(0);
        reply = "Muted it, Sir.";
      } else if (command === "replay") {
        postYouTubeCommand("seekTo", [0, true]);
        postYouTubeCommand("playVideo");
        reply = "Replaying it, Sir.";
      } else if (command === "show-player") {
        setIsYouTubePlayerVisible(true);
        reply = "Showing the YouTube player, Sir.";
      } else if (command === "hide-player") {
        setIsYouTubePlayerVisible(false);
        reply = "Hiding the YouTube player, Sir.";
      } else {
        const nextIndex =
          youtubeVideoIds.length > 0
            ? (youtubeVideoIndex + 1) % youtubeVideoIds.length
            : 0;
        const nextVideoId = youtubeVideoIds[nextIndex];

        if (nextVideoId) {
          setYouTubeVideoIndex(nextIndex);
          setYouTubeVideoId(nextVideoId);
          setIsYouTubePlayerVisible(true);
          setPendingYouTubeUrl(
            `https://www.youtube.com/watch?v=${nextVideoId}&autoplay=1`,
          );
          reply = "Playing the next result, Sir.";
        } else {
          reply = "I do not have another YouTube result queued, Sir.";
        }
      }
    }

    armFollowUpCommands();
    setMessages((currentMessages) => [
      ...currentMessages,
      { role: "user", content },
      { role: "assistant", content: reply },
    ]);
    speak(reply);
    setChatStatus("idle");
    setAssistantMode("listening");
  };

  const generateImage = async (content: string, prompt: string) => {
    setMessages((currentMessages) => [
      ...currentMessages,
      { role: "user", content },
    ]);
    setImageStatus("generating");
    setImageError("");
    setGeneratedImagePrompt(prompt);
    setChatStatus("thinking");
    setAssistantMode("thinking");


    try {
      const response = await fetch("/api/comfy-image", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt }),
      });
      const data = (await response.json()) as {
        imageUrl?: string;
        error?: string;
      };

      if (!response.ok || !data.imageUrl) {
        throw new Error(data.error || "ComfyUI did not return an image.");
      }

      const reply = `Generated it, Sir.`;

      setGeneratedImageUrl(data.imageUrl);
      setImageStatus("idle");
      setMessages((currentMessages) => [
        ...currentMessages,
        { role: "assistant", content: reply },
      ]);
      speak(reply);
      armFollowUpCommands();
      setChatStatus("idle");
      setAssistantMode("listening");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not generate the image.";

      setImageStatus("error");
      setImageError(message);
      setMessages((currentMessages) => [
        ...currentMessages,
        { role: "assistant", content: message },
      ]);

      armFollowUpCommands();
      setChatStatus("error");
      reportChatError(message);
      setAssistantMode("listening");
    }
  };

  const runLocalAppCommand = async (
    content: string,
    command: LocalAppCommand,
  ) => {
    setMessages((currentMessages) => [
      ...currentMessages,
      { role: "user", content },
    ]);
    setChatStatus("thinking");
    setAssistantMode("thinking");
    setChatError("");

    try {
      const response = await requestLocalApp(command);
      const data = (await response.json()) as {
        displayName?: string;
        reply?: string;
        error?: string;
      };

      if (!response.ok || !data.displayName) {
        throw new Error(data.error || "Could not open that app.");
      }

      const reply = data.reply || (
        command.action === "close-all"
          ? "Closing the approved apps, Sir."
          : command.action === "close"
            ? `Closing ${data.displayName}, Sir.`
            : `Opening ${data.displayName}, Sir.`);

      setMessages((currentMessages) => [
        ...currentMessages,
        { role: "assistant", content: reply },
      ]);
      speak(reply);
      armFollowUpCommands();
      setChatStatus("idle");
      setAssistantMode("listening");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not open that app.";

      setMessages((currentMessages) => [
        ...currentMessages,
        { role: "assistant", content: message },
      ]);
      setChatStatus("error");
      reportChatError(message);
      setAssistantMode("listening");

      armFollowUpCommands();
    }
  };

  const stopYouTube = (content: string) => {
    const reply = youtubeVideoId
      ? "Stopped the video, Sir. Silence has been restored, tragically."
      : "There is no video playing right now, Sir.";

    setYouTubeVideoId("");
    setYouTubeVideoIds([]);
    setYouTubeVideoIndex(0);
    setYouTubeQuery("");
    setYouTubeVolume(100);
    setIsYouTubePlayerVisible(true);
    setPendingYouTubeUrl("");
    armFollowUpCommands();
    setMessages((currentMessages) => [
      ...currentMessages,
      { role: "user", content },
      { role: "assistant", content: reply },
    ]);
    speak(reply);
    setChatStatus("idle");
    setAssistantMode("listening");
  };

  const openYouTube = async (query: string, random = false) => {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    let url = searchUrl;
    let videoId = "";
    let resolvedToVideo = false;

    try {
      const response = await fetch("/api/youtube-resolve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, random }),
      });
      const data = (await response.json()) as {
        url?: string;
        videoId?: string;
        videoIds?: string[];
        searchUrl?: string;
      };

      if (response.ok && data.url && data.videoId) {
        url = data.url;
        videoId = data.videoId;
        setYouTubeVideoIds(data.videoIds?.length ? data.videoIds : [data.videoId]);
        setYouTubeVideoIndex(0);
        resolvedToVideo = true;
      } else {
        url = data.searchUrl || searchUrl;
        setYouTubeVideoIds([]);
        setYouTubeVideoIndex(0);
      }
    } catch {
      url = searchUrl;
      setYouTubeVideoIds([]);
      setYouTubeVideoIndex(0);
    }

    if (window.jimmyDesktop) {
      const response = await requestLocalApp({ action: "open-youtube", url });
      const data = await response.json() as { error?: string };
      const reply = response.ok
        ? `Opened ${query} on YouTube in your browser.${resolvedToVideo ? "" : " Choose a result to start playback."}`
        : data.error || "Could not open YouTube in your browser.";
      setYouTubeVideoId("");
      setYouTubeVideoIds([]);
      setPendingYouTubeUrl("");
      setYouTubeQuery(query);
      setMessages(current => [...current, { role: "assistant", content: reply }]);
      speak(reply);
      armFollowUpCommands();
      return;
    }

    setPendingYouTubeUrl(url);
    setYouTubeQuery(query);
    setYouTubeVolume(100);
    setIsYouTubePlayerVisible(true);

    if (videoId) {
      setYouTubeVideoId(videoId);
    }

    const playReply =
      YOUTUBE_PLAY_REPLIES[Math.floor(Math.random() * YOUTUBE_PLAY_REPLIES.length)]
        .replace("{query}", query);
    const reply = resolvedToVideo
      ? playReply
      : `I found YouTube search results for ${query}, Sir, but I could not pick the first video automatically.`;

    setMessages((currentMessages) => [
      ...currentMessages,
      { role: "assistant", content: reply },
    ]);
    speak(reply);
    armFollowUpCommands();
  };

  const askJimmy = async (content: string) => {
    content = assistantCommand(content);
    if (!content) return;
    const windowCommand = parseVoiceCommand(content);
    if (windowCommand?.kind === "ui-sequence" || windowCommand?.kind === "canvas" || windowCommand?.kind === "desktop-view" || windowCommand?.kind === "desktop-hide") {
      await runLocalCommand(content, windowCommand); return;
    }
    if (pendingTodoDayRef.current && !(window.jimmyDesktop && isJimmyShutdown(content)) && !routeLocalCommand(content)) {
      if (/^(?:(?:hey\s+)?jimmy[\s,.:!-]*)?(?:cancel|never\s?mind|stop adding tasks)[.!?]*$/i.test(content.trim())) {
        pendingTodoDayRef.current = null;
        const reply = "Stopped adding tasks. Your saved list has been kept.";
        setMessages(current => [...current, { role: "user", content }, { role: "assistant", content: reply }]); speak(reply); return;
      }
      if (!/^(?:what|why|how|when|where|who|do i|can you|could you)\b/i.test(content.trim())) {
        await runTodoCommand(content, { kind: "todo", action: "add", day: pendingTodoDayRef.current, time: pendingTodoTimeRef.current, text: content }); return;
      }
      pendingTodoDayRef.current = null;
    }
    if (window.jimmyDesktop && isJimmyShutdown(content)) {
      stopSpeech();
      voiceDisposedRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      streamRef.current?.getTracks().forEach(track => track.stop());
      voiceSocketRef.current?.close(1000, "Jimmy shutdown");
      await window.jimmyDesktop.shutdown();
      return;
    }
    if (planRef.current && !routeLocalCommand(content)) { await advancePlan(content); return; }
    const confirming = !planRef.current && planAction(content) === "confirm";
    const workflowPrompt = confirming ? workflowFromChat(messagesRef.current) : null;
    if (workflowPrompt || (confirming && /\bcreate\b/i.test(content))) {
      if (workflowPrompt) { await runLocalCommand(content, { kind: "n8n-create", prompt: workflowPrompt }, true); return; }
      const reply = "I can save an inactive workflow directly in n8n, but I don't have a clear workflow ready to create. Tell me what the workflow should do, or say: Create an n8n workflow that retrieves Gmail messages.";
      setMessages(current => [...current, { role: "user", content }, { role: "assistant", content: reply }]);
      speak(reply); armFollowUpCommands(); return;
    }
    if (parseVoiceCommand(content)?.kind === "screen-inspect") { await inspectScreen(content); return; }
    try { await wakeDesktop(); }
    catch (error) {
      setChatStatus("error");
      reportChatError(error instanceof Error ? error.message : `${savedAssistantName()} could not wake up. Try again.`);
      return;
    }
    let localCommand = routeLocalCommand(content);
    if (localCommand?.kind !== "browser-search") lastBrowserSearchRef.current = null;

    if (localCommand?.kind === "local-files" && localCommand.action !== "cancel" || (!localCommand || ["browser-search", "app"].includes(localCommand.kind)) && mayBeFileRequest(content, fileRequestRef.current)) {
      stopSpeech(); setChatError(""); setChatStatus("thinking"); setAssistantMode("thinking");
      const controller = new AbortController(); chatAbortRef.current = controller;
      try {
        const previous = fileRequestRef.current;
        const response = await fetch("/api/local-files", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "interpret", text: content, ...(previous ? { previous } : {}) }), signal: controller.signal });
        const data = await response.json() as { command?: FileCommand | null; question?: string; error?: string };
        if (!response.ok) throw new Error(data.error || "Could not interpret that laptop request.");
        if (controller.signal.aborted) return;
        if (data.command) {
          chatAbortRef.current = null;
          await runLocalCommand(content, data.command); return;
        }
        if (data.question) {
          fileRequestRef.current = { request: (previous?.question ? `${previous.request}\n${content}` : content).slice(-4000), ...(previous?.command ? { command: previous.command } : {}), question: data.question };
          setMessages(current => [...current, { role: "user", content }, { role: "assistant", content: data.question! }]);
          speak(data.question); armFollowUpCommands(); return;
        }
        fileRequestRef.current = null;
        if (localCommand?.kind === "local-files") localCommand = null;
      } catch (error) {
        if (!controller.signal.aborted) { setMessages(current => [...current, { role: "user", content }]); reportChatError(error instanceof Error ? error.message : "Could not interpret that laptop request."); }
        return;
      } finally { if (chatAbortRef.current === controller) { chatAbortRef.current = null; setChatStatus("idle"); setAssistantMode("listening"); } }
    }

    if (localCommand && localCommand.kind !== "n8n-read") {
      await runLocalCommand(content, localCommand);
      return;
    }

    if (isUnroutedUiVisibilityCommand(content)) {
      rejectUnroutedUiCommand(content);
      return;
    }

    fileRequestRef.current = null;

    setLastCommand("ollama:chat");
    const nextMessages: ChatMessage[] = [
      ...messagesRef.current,
      { role: "user", content },
    ];

    setMessages(nextMessages);
    setChatStatus("thinking");
    setChatError("");
    setAssistantMode("thinking");

    const chatController = new AbortController();
    chatAbortRef.current?.abort();
    chatAbortRef.current = chatController;

    try {
      if (voiceTimingRef.current) {
        const requestAt = performance.timeOrigin + performance.now();
        const timing = {
          ...voiceTimingRef.current,
          ollama_request: requestAt,
          speech_end_to_ollama_request_ms: voiceTimingRef.current.speech_end
            ? requestAt - voiceTimingRef.current.speech_end
            : null,
        };
        voiceTimingRef.current = timing;
        setLastVoiceTiming(timing);
      }
      const response = await fetch("/api/ollama-chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messages: nextMessages.slice(-12).map(({ role, content }) => ({ role, content })), brain: brainRef.current, personality: savedPersonality(), assistantName: savedAssistantName(), localToolHistory: privateToolHistoryRef.current, gmailPage: gmailPageRef.current, canvas: true,
          ...(/\b(?:canvas|chart|graph|diagram|table|that|these|those|it|them|above|which|compare|highest|lowest|largest|smallest|summari[sz]e|sort|filter|group)\b/i.test(content) && canvas.document && !canvas.document.blocks.some(block => block.type === "files") ? { canvasContext: JSON.stringify({ title: canvas.document.title, blocks: canvas.document.blocks, source: canvas.document.source, note: canvas.document.note }).slice(0, 12000) } : {}) }),
        signal: chatController.signal,
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error || "Ollama did not reply.");
      }

      if (!response.body) {
        throw new Error("Ollama returned an empty response stream.");
      }

      setLastBrain(response.headers.get("X-Chat-Brain") || "");
      setRoutingNote(response.headers.get("X-Chat-Routing-Note") || "");
      if (response.headers.get("X-Jimmy-Tool-Result") === "1") privateToolHistoryRef.current = true;
      const gmailPage = response.headers.get("X-Jimmy-Gmail-Page");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let reply = "";
      const framed = response.headers.get("Content-Type")?.includes("application/x-ndjson");
      let eventBuffer = "";
      let sourceCanvas: CanvasContent | null = null;
      let narrated = "";
      let speechBuffer = "";
      let speechStarted = false;
      let receivedFirstToken = false;
      let lastPaintAt = 0;

      const queueReadySpeech = (final: boolean) => {
        if (chatController.signal.aborted) return;
        while (speechBuffer) {
          const chunk = nextSpeechChunk(speechBuffer, final, speechStarted);
          if (!chunk) break;
          speechBuffer = chunk.rest;
          if (speechText(chunk.text)) {
            queueSpeech(chunk.text, !speechStarted);
            speechStarted = true;
          }
        }
      };

      setMessages([...nextMessages, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (chatController.signal.aborted) return;

        if (done) {
          const finalChunk = decoder.decode();
          if (framed) {
            const events = readCanvasEvents(eventBuffer + finalChunk, true);
            reply += events.text; sourceCanvas = events.canvas || sourceCanvas;
          } else reply += finalChunk;
          break;
        }

        let textChunk = decoder.decode(value, { stream: true });
        if (framed) {
          eventBuffer += textChunk;
          if (eventBuffer.length > 8 * 1024 * 1024) throw new Error("Canvas response exceeded its size limit.");
          const events = readCanvasEvents(eventBuffer);
          eventBuffer = events.rest; textChunk = events.text; sourceCanvas = events.canvas || sourceCanvas;
        }
        if (textChunk && !receivedFirstToken) {
          receivedFirstToken = true;
          if (voiceTimingRef.current) {
            const firstTokenAt = performance.timeOrigin + performance.now();
            const timing = {
              ...voiceTimingRef.current,
              ollama_first_token: firstTokenAt,
              ollama_request_to_first_token_ms:
                voiceTimingRef.current.ollama_request
                  ? firstTokenAt - voiceTimingRef.current.ollama_request
                  : null,
            };
            voiceTimingRef.current = timing;
            setLastVoiceTiming(timing);
          }
        }
        reply += textChunk;
        const narrative = canvasNarrative(reply);
        lastReplyRef.current = narrative;
        if (narrative.startsWith(narrated)) speechBuffer += narrative.slice(narrated.length);
        narrated = narrative;
        queueReadySpeech(false);

        if (Date.now() - lastPaintAt >= 50) {
          lastPaintAt = Date.now();
          const visibleReply = narrative;
          setMessages([
            ...nextMessages,
            { role: "assistant", content: visibleReply },
          ]);
        }
      }

      reply = reply.trim();

      if (!reply) {
        throw new Error("Ollama did not return a reply.");
      }

      if (gmailPage !== null) {
        try { gmailPageRef.current = JSON.parse(decodeURIComponent(gmailPage)); }
        catch { gmailPageRef.current = null; }
      }

      const presentation = splitCanvasReply(reply);
      const derived = presentation.canvas?.blocks.map(block => ({ ...block, title: `${block.title || block.type} · ${savedAssistantName()}'s interpretation`.slice(0, 200) })) || [];
      const visualContent = sourceCanvas ? { ...sourceCanvas, blocks: [...sourceCanvas.blocks, ...derived].slice(0, 12) as CanvasBlock[], note: [sourceCanvas.note, presentation.canvas?.note, sourceCanvas.blocks.length + derived.length > 12 ? "Additional model visuals beyond the 12-section limit are omitted." : ""].filter(Boolean).join(" ").slice(0, 2000) } : presentation.canvas;
      const visual = visualContent ? canvas.publish(visualContent) : undefined;
      lastReplyRef.current = presentation.message;
      if (presentation.message.startsWith(narrated)) speechBuffer += presentation.message.slice(narrated.length);
      else if (!speechStarted) speechBuffer = presentation.message;
      speechBuffer = speechBuffer.trim();
      queueReadySpeech(true);

      setMessages([...nextMessages, { role: "assistant", content: presentation.message, ...(visual ? { visual } : {}) }]);
      armFollowUpCommands();
      setChatStatus("idle");
      setAssistantMode("listening");
    } catch (error) {
      if (chatController.signal.aborted) return;
      setChatStatus("error");
      setAssistantMode("listening");
      reportChatError(
        error instanceof Error
          ? error.message
          : "Could not reach local Ollama.",
      );
      armFollowUpCommands();
    }
  };

  const handleTranscript = async (text: string) => {
    if (voiceSettingsOpenRef.current || desktopMutedRef.current) return;
    const transcript = text.trim();
    if (directVoiceTurnRef.current) {
      if (transcript) { stopSpeech(); await askJimmy(transcript); }
      return;
    }
    if (!continuousMicRef.current) return;
    setLastTranscript(transcript);
    const wakeMatch = transcript.match(assistantWakePattern());

    if (window.jimmyDesktop && !desktopAwakeRef.current) {
      if (!wakeMatch || desktopWakeRef.current) return;
      // Shutdown never needs to load a speech model first.
      if (isJimmyShutdown(assistantCommand(transcript))) { await askJimmy(transcript); return; }
      try { await wakeDesktop(); }
      catch { setMicError(`Could not wake the voice. Say ${savedAssistantName()} to retry.`); return; }
      setMicError("");
    }

    // Wake words always regain attention. Acknowledgements must not swallow
    // the follow-up they invited, including while the new voice is still loading.
    const direct = parseVoiceCommand(assistantCommand(transcript));
    if (pendingTodoDayRef.current && !direct && (wakeMatch || (!speakingRef.current && Date.now() < commandArmedUntilRef.current))) {
      const answer = assistantCommand(transcript);
      if (answer) await askJimmy(answer);
      return;
    }
    if (planRef.current && !direct && (wakeMatch || (Date.now() < commandArmedUntilRef.current && (!speakingRef.current || planAction(transcript) !== "answer")))) {
      const answer = assistantCommand(transcript);
      if (answer) await askJimmy(answer);
      return;
    }
    if (speakingRef.current || chatStatusRef.current === "thinking") {
      const followUp = acknowledgementRef.current && Date.now() < commandArmedUntilRef.current;
      if (wakeMatch) {
        stopSpeech();
      } else if (Date.now() < commandArmedUntilRef.current &&
        lastBrowserSearchRef.current && parseBrowserSearch(transcript, lastBrowserSearchRef.current)) {
        stopSpeech();
        await askJimmy(transcript);
        return;
      } else if (direct && (followUp || direct.kind === "speech-stop" || direct.kind === "todo" && direct.action === "hide")) {
        await runLocalCommand(transcript, direct);
        return;
      } else if (followUp && COMMAND_VERB_PATTERN.test(transcript) && !isNonCommandTranscript(transcript)) {
        stopSpeech();
        await askJimmy(normalizeCommandMishears(cleanCommandText(transcript)));
        return;
      } else {
        return;
      }
    }

    if (!wakeMatch && Date.now() < commandArmedUntilRef.current) {
      if (isNonCommandTranscript(transcript)) {
        setLastIgnoredTranscript(transcript);
        return;
      }

      const command = cleanCommandText(transcript);

      if (!command) {
        return;
      }

      wakeVisualUntilRef.current = Date.now() + WAKE_VISUAL_WINDOW_MS;
      await askJimmy(normalizeCommandMishears(command));
      return;
    }

    if (!wakeMatch) {
      if (isNonCommandTranscript(transcript)) {
        setLastIgnoredTranscript(transcript);
        return;
      }

      return;
    }

    const commandAfterWake = transcript
      .slice(wakeMatch.index! + wakeMatch[0].length)
      .trim();
    const commandBeforeWake = transcript.slice(0, wakeMatch.index).trim();
    const command = normalizeCommandMishears(
      cleanCommandText(commandAfterWake || commandBeforeWake),
    );

    if (!command || /^(?:are )?you there[?!.]*$/i.test(command)) {
      wakeVisualUntilRef.current = Date.now() + 4500;
      armFollowUpCommands();
      setLastCommand("wake:armed");
      queueSpeech(
        LISTENING_REPLIES[
          Math.floor(Math.random() * LISTENING_REPLIES.length)
        ],
        true,
        true,
      );
      return;
    }

    armFollowUpCommands();
    wakeVisualUntilRef.current = Date.now() + WAKE_VISUAL_WINDOW_MS;
    await askJimmy(command);
  };

  const connectRealtimeVoice = async () => {
    if (voiceDisposedRef.current) return;
    try {
      const ticketResponse = await fetch("/api/voice-ticket", {
        cache: "no-store",
      });
      const ticket = (await ticketResponse.json()) as {
        url?: string;
        error?: string;
      };

      if (!ticketResponse.ok || !ticket.url) {
        throw new Error(ticket.error || "Real-time voice is unavailable.");
      }

      if (voiceDisposedRef.current) return;
      const socket = new WebSocket(ticket.url);
      socket.binaryType = "arraybuffer";
      voiceSocketRef.current = socket;

      socket.onmessage = (event) => {
        if (typeof event.data !== "string") {
          return;
        }

        void (async () => {
          const message = JSON.parse(event.data) as {
            type?: string;
            text?: string;
            provider_status?: string;
            provider?: string;
            at_ms?: number;
            reason?: string;
            timing?: VoiceTiming;
          };

          if (message.type === "ready") {
            realtimeVoiceReadyRef.current = true;
            setVoiceReady(true);
            setMicError("");
            return;
          }

          if (message.type === "speech_start") {
            directVoiceTurnRef.current = talkingRef.current || directVoiceTurnRef.current;
            setPartialTranscript("");
            voiceTimingRef.current = { speech_start: message.at_ms };
            setLastVoiceTiming(voiceTimingRef.current);
            return;
          }

          if (message.type === "partial" && message.text) {
            setPartialTranscript(message.text);
            if (voiceTimingRef.current && message.at_ms) {
              voiceTimingRef.current = {
                ...voiceTimingRef.current,
                asr_first_partial:
                  voiceTimingRef.current.asr_first_partial || message.at_ms,
              };
              setLastVoiceTiming(voiceTimingRef.current);
            }
            return;
          }

          if (message.type === "final") {
            setPartialTranscript("");
            voiceTimingRef.current = message.timing || voiceTimingRef.current;
            setLastVoiceTiming(voiceTimingRef.current);
            if (message.text) {
              await handleTranscript(message.text);
            }
            directVoiceTurnRef.current = false;
            return;
          }

          if (message.type === "error") {
            setPartialTranscript("");
            setMicError(message.reason || "Moonshine transcription failed.");
          }
        })().catch((error) => {
          console.error("Invalid real-time voice event", error);
        });
      };

      const voiceUnavailable = () => {
        if (voiceSocketRef.current !== socket) {
          return;
        }
        realtimeVoiceReadyRef.current = false;
        setVoiceReady(false);
        voiceSocketRef.current = null;
        setMicError("Voice service unavailable. Start the voice service, then reload to reconnect.");
        setPartialTranscript("");
        if (window.jimmyDesktop && !voiceDisposedRef.current) {
          reconnectTimerRef.current = setTimeout(() => { void connectRealtimeVoice(); }, 10000);
        }
      };
      socket.onerror = voiceUnavailable;
      socket.onclose = voiceUnavailable;
    } catch (error) {
      setMicError("Voice service unavailable. Start the voice service, then reload to reconnect.");
      realtimeVoiceReadyRef.current = false;
      setVoiceReady(false);
      if (window.jimmyDesktop && !voiceDisposedRef.current) {
        reconnectTimerRef.current = setTimeout(() => { void connectRealtimeVoice(); }, 10000);
      }
      console.info(
        "Real-time voice unavailable.",
        error,
      );
    }
  };

  const startVoiceAssistant = async () => {
    if (voiceStartingRef.current) return;
    if (audioContextRef.current) {
      if (!voiceSocketRef.current) void connectRealtimeVoice();
      return;
    }

    voiceStartingRef.current = true;
    try {
      await startListening();
      const audioContext = audioContextRef.current as AudioContext | null;

      if (!audioContext) {
        return;
      }

      void connectRealtimeVoice();
      setAssistantMode("listening");
      setChatStatus("idle");
      setChatError("");
    } catch {
      setMicError("Mic unavailable");
      setAudioState("blocked");
      setAssistantMode("off");
    } finally {
      voiceStartingRef.current = false;
    }
  };

  const updateMicTracks = () => {
    streamRef.current?.getAudioTracks().forEach(track => {
      track.enabled = !desktopMutedRef.current && (continuousMicRef.current || talkingRef.current);
    });
  };

  const beginTalking = async () => {
    if (talkingRef.current || desktopMutedRef.current) return;
    stopSpeech();
    suppressMicUntilRef.current = 0;
    talkingRef.current = true;
    directVoiceTurnRef.current = true;
    setTalking(true);
    voiceDisposedRef.current = false;
    await startVoiceAssistant();
    await audioContextRef.current?.resume();
    updateMicTracks();
  };

  const endTalking = () => {
    talkingRef.current = false;
    setTalking(false);
    updateMicTracks();
  };

  const toggleContinuousMic = async () => {
    if (!talkingRef.current) directVoiceTurnRef.current = false;
    continuousMicRef.current = !continuousMicRef.current;
    setContinuousMic(continuousMicRef.current);
    try { localStorage.setItem(WAKE_MIC_KEY, String(continuousMicRef.current)); } catch { /* Listening still works when storage is unavailable. */ }
    if (continuousMicRef.current) {
      voiceDisposedRef.current = false;
      await startVoiceAssistant();
      await audioContextRef.current?.resume();
    }
    updateMicTracks();
  };

  const startDesktopListening = useEffectEvent(async () => {
    if (!window.jimmyDesktop) return;
    try { if (localStorage.getItem(WAKE_MIC_KEY) === "false") return; } catch { /* Desktop listening defaults on. */ }
    continuousMicRef.current = true;
    setContinuousMic(true);
    voiceDisposedRef.current = false;
    try {
      await startVoiceAssistant();
      await audioContextRef.current?.resume();
      updateMicTracks();
    } catch { setMicError("Could not start the microphone. Toggle the wake-word mic to retry."); }
  });

  useEffect(() => {
    const api = window.jimmyDesktop;
    if (!api) return;
    let disposed = false;
    const update = (state: DesktopState) => {
      if (disposed) return;
      desktopMutedRef.current = state.muted;
      desktopAwakeRef.current = state.awake;
      streamRef.current?.getAudioTracks().forEach(track => { track.enabled = !state.muted && (continuousMicRef.current || talkingRef.current); });
      setDesktop(state);
      document.documentElement.dataset.jimmyDesktop = state.expanded ? "expanded" : "compact";
    };
    const unsubscribe = api.onState(update);
    void api.getState().then(state => { update(state); if (!disposed) void startDesktopListening(); });
    return () => { disposed = true; unsubscribe(); delete document.documentElement.dataset.jimmyDesktop; };
  }, []);

  useEffect(() => {
    const stopHolding = () => {
      talkingRef.current = false;
      setTalking(false);
      streamRef.current?.getAudioTracks().forEach(track => {
        track.enabled = !desktopMutedRef.current && continuousMicRef.current;
      });
    };
    window.addEventListener("blur", stopHolding);
    return () => window.removeEventListener("blur", stopHolding);
  }, []);

  const sendMessage = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const content = assistantCommand(input);

    if (!content || (chatStatus === "thinking" && !(planRef.current && planAction(content) === "cancel") && !parseVoiceCommand(content) && !(window.jimmyDesktop && isJimmyShutdown(content)))) {
      return;
    }

    setInput("");
    await askJimmy(content);
  };

  return (
    <div className="jimmy-shell relative grid h-full min-h-[620px] w-full place-items-center" data-model={canvas.model ? "" : undefined}>
      {canvas.model && <div className="jimmy-model-stage"><ModelViewer key={`${canvas.model.name}-${canvas.model.lastModified}`} file={canvas.model} onError={message => { canvas.closeModel(); reportChatError(`Could not open model: ${message}`); }} /></div>}
      {canvas.inline && <CanvasOverlay document={canvas.document} onClose={canvas.hide} onSeparate={canvas.show} onModel={canvas.openModel} />}
      <div className="jimmy-bottom">
      {desktop?.error || partialTranscript || audioState === "blocked" || micError || (chatError && !isChatVisible) ? <div className="jimmy-notices">
        {desktop?.error ? <p role="alert" className="desktop-error">{desktop.error}</p> : null}
        {chatError && !isChatVisible ? <p role="alert" className="desktop-error">{chatError}</p> : null}
        {partialTranscript && !micError ? (
          <div role="status" className="rounded-xl bg-black/70 px-4 py-2 text-sm text-cyan-100">{partialTranscript}</div>
        ) : null}
        {audioState === "blocked" || micError ? (
          <div role="alert" className="rounded-xl border border-amber-200/30 bg-black/55 px-4 py-2 text-sm text-amber-100 backdrop-blur-md">
            {micError || `Allow microphone access, then reload ${assistantName}.`}
          </div>
        ) : null}
      </div> : null}
      <div className="jimmy-controls">
        <button className="canvas-launch" type="button" onClick={canvas.show}>Open canvas</button>
        <ActivityIndicator />
        <span id="ptt-keys" className="sr-only">Focus Hold to talk, then hold Space or Enter. Release to send.</span>
        <button type="button" aria-label="Hold to talk" aria-describedby="ptt-keys" title="Hold Space or Enter while this button is focused" aria-pressed={talking} disabled={desktop?.muted}
          onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); void beginTalking(); }}
          onPointerUp={endTalking} onPointerCancel={endTalking} onLostPointerCapture={endTalking} onBlur={endTalking}
          onKeyDown={event => { if ((event.key === " " || event.key === "Enter") && !event.repeat) { event.preventDefault(); void beginTalking(); } }}
          onKeyUp={event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); endTalking(); } }}>
          {talking ? voiceReady ? "Listening… release to send" : "Connecting microphone…" : "Hold to talk"}
        </button>
        <button type="button" aria-pressed={continuousMic} onClick={() => void toggleContinuousMic()}>
          {continuousMic ? "Wake-word mic on" : "Use mic / wake word"}
        </button>
        <label>Brain <select aria-label="Brain" aria-describedby={brain !== "qwen" ? "brain-privacy" : undefined} title={brain === "qwen" ? "Local Ollama" : "Codex replies use your ChatGPT account. Auto may send coding and complex requests to OpenAI."} value={brain} disabled={chatStatus === "thinking"} onChange={event => {
          brainRef.current = event.target.value; setBrain(event.target.value);
        }}><option value="auto">Auto · choose for the task</option><option value="qwen">Ollama · local</option><option value="codex">Codex · ChatGPT account</option></select></label>
        {brain !== "qwen" ? <><CodexAccount /><small id="brain-privacy" className="sr-only">{brain === "auto" ? "Auto may send coding or complex requests and saved memories to OpenAI when connected." : "Chat and saved memories are sent to OpenAI using your ChatGPT plan."}</small></> : null}
        {lastBrain ? <small role="status" title={routingNote}>Last reply: {lastBrain === "codex" ? "Codex" : lastBrain === "screen" ? "Local vision" : lastBrain === "local" ? "Local laptop" : "Local Ollama"}</small> : null}
      </div>
      </div>
      {desktop ? <div className="desktop-toolbar">
        <span className="desktop-drag" title={`Drag to move ${assistantName}`}>⠿</span>
        <button type="button" onClick={() => void window.jimmyDesktop?.expand(!desktop.expanded)} title={desktop.expanded ? "Circle mode" : "Open dashboard"} aria-label={desktop.expanded ? `Collapse ${assistantName}` : `Open ${assistantName} chat`}>{desktop.expanded ? "○" : "+"}</button>
        <button type="button" onClick={() => void window.jimmyDesktop?.mute(!desktop.muted)} aria-label={desktop.muted ? "Unmute microphone" : "Mute microphone"}>{desktop.muted ? "Mic off" : "Mic on"}</button>
        <button type="button" onClick={() => void window.jimmyDesktop?.hide()} title="Minimize to tray · keeps listening" aria-label={`Minimize ${assistantName} to tray`}>−</button>
      </div> : null}
      <button type="button" disabled={chatStatus === "thinking"} title="Analyse one screen snapshot locally"
        onClick={() => { void inspectScreen(pendingScreenQuestion || "Describe what I am doing on this screen.", window.jimmyDesktop ? undefined : captureBrowserScreen()); }}
        className="absolute top-5 left-4 z-20 rounded-lg border border-white/20 bg-black/50 px-3 py-2 text-sm text-cyan-100 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-cyan-200 disabled:opacity-40">
        {desktop ? "Look at screen" : "Share screen"}
      </button>
      <button ref={chatToggleRef} type="button" aria-label={isChatVisible ? "Hide chat" : "Show chat"}
        title={isChatVisible ? "Hide chat" : "Show chat"} aria-expanded={isChatVisible} aria-controls="jimmy-chat"
        onClick={() => setIsChatVisible(visible => !visible)}
        className={`absolute top-5 right-[4.25rem] z-30 grid h-11 w-11 place-items-center rounded-full border text-cyan-100 shadow-lg backdrop-blur-md transition hover:bg-cyan-100/15 focus-visible:outline-2 focus-visible:outline-cyan-200 ${isChatVisible ? "border-cyan-200/50 bg-cyan-100/10" : "border-white/20 bg-black/50"}`}>
        <ChatBubbleIcon width="21" height="21" aria-hidden="true" />
      </button>
      <VoiceSettings onInputChange={switchMicrophone} onOutputChange={switchSpeaker} onVolumeChange={switchVoiceVolume} chatVisible={isChatVisible} onChatVisibleChange={setIsChatVisible} busy={isSpeaking || isPreparingSpeech || chatStatus === "thinking"} onOpenChange={open => {
        if (!open) void refreshReadTools();
        voiceSettingsOpenRef.current = open;
        suppressMicUntilRef.current = Date.now() + 500;
      }} />
      {(!desktop || desktop.expanded) && <ResourceMonitor />}
      <div className="reactor-stage" ref={reactorStageRef}>
        <ArcReactor speaking={isSpeaking} busy={isPreparingSpeech || chatStatus === "thinking" || imageStatus === "generating" || desktop?.phase === "Waking up…"} status={desktop?.muted ? "Mic muted" : desktop?.error ? "Needs attention" : micError && desktop ? "Mic unavailable" : desktop && !continuousMic ? "Wake-word mic off" : desktop && !voiceReady ? "Connecting microphone…" : desktop && !desktop.awake ? desktop.phase : statusLabel} />
        {canvas.model ? <button type="button" className="model-return" aria-label="Return to dashboard" title="Return to dashboard · Escape" onClick={canvas.closeModel} /> : desktop && !desktop.expanded ? <button type="button" className="desktop-open-core" aria-label={`Open ${assistantName} chat`} onClick={() => void window.jimmyDesktop?.expand(true)} /> : null}
      </div>
      {youtubeVideoId || generatedImageUrl || imageStatus !== "idle" ? (
        <div className="absolute left-4 top-4 flex max-w-[calc(100vw-420px)] items-start gap-3 max-lg:bottom-28 max-lg:left-3 max-lg:top-auto max-lg:max-w-[min(92vw,760px)] max-lg:flex-col">
          {youtubeVideoId ? (
            <section
              className={
                isYouTubePlayerVisible
                  ? "w-[min(420px,32vw)] rounded-[8px] border border-white/15 bg-black/40 p-3 text-sm text-white shadow-2xl shadow-black/30 backdrop-blur-md max-lg:w-[min(92vw,420px)]"
                  : "pointer-events-none h-px w-px overflow-hidden opacity-0"
              }
            >
              <div className="aspect-video overflow-hidden rounded-[8px] bg-black">
                <iframe
                  key={youtubeVideoId}
                  title={`YouTube player for ${youtubeQuery}`}
                  src={`https://www.youtube.com/embed/${youtubeVideoId}?autoplay=1&playsinline=1&rel=0&enablejsapi=1${youtubePlaylistParam ? `&playlist=${youtubePlaylistParam}` : ""}&origin=${
                    typeof window === "undefined"
                      ? ""
                      : encodeURIComponent(window.location.origin)
                  }`}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  className="h-full w-full border-0"
                />
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-cyan-50">{youtubeQuery}</p>
                <a
                  href={pendingYouTubeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded-full border border-white/15 px-3 py-1.5 text-xs text-cyan-100 transition hover:bg-white/10"
                >
                  YouTube
                </a>
              </div>
            </section>
          ) : null}
          {generatedImageUrl || imageStatus !== "idle" ? (
            <section className="w-[min(280px,24vw)] rounded-[8px] border border-white/15 bg-black/40 p-3 text-sm text-white shadow-2xl shadow-black/30 backdrop-blur-md max-lg:w-[min(92vw,320px)]">
              <div className="grid aspect-square place-items-center overflow-hidden rounded-[8px] bg-black/60">
                {generatedImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={generatedImageUrl}
                    alt={generatedImagePrompt || "Generated ComfyUI image"}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="px-4 text-center text-cyan-100/80">
                    {imageStatus === "generating"
                      ? "Generating image..."
                      : imageError || "No image"}
                  </span>
                )}
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-cyan-50">
                  {generatedImagePrompt || "ComfyUI image"}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setGeneratedImageUrl("");
                    setGeneratedImagePrompt("");
                    setImageStatus("idle");
                    setImageError("");
                  }}
                  className="shrink-0 rounded-full border border-white/15 px-3 py-1.5 text-xs text-cyan-100 transition hover:bg-white/10"
                >
                  Hide
                </button>
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
      {isChatVisible ? (
      <aside id="jimmy-chat" aria-labelledby="jimmy-chat-title" className="jimmy-chat-panel"
        onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setIsChatVisible(false); chatToggleRef.current?.focus(); } }}>
        <div className="mb-4 flex shrink-0 items-center justify-between gap-3 border-b border-cyan-200/15 pb-3">
          <h2 id="jimmy-chat-title" className="text-sm font-medium text-cyan-50">Conversation</h2>
          <button type="button" aria-label="Close chat" onClick={() => { setIsChatVisible(false); chatToggleRef.current?.focus(); }}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-cyan-100/65 transition hover:bg-white/10 hover:text-cyan-50 focus-visible:outline-2 focus-visible:outline-cyan-200">
            <Cross2Icon width="18" height="18" aria-hidden="true" />
          </button>
        </div>
        {activePlan && <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2 rounded-lg border border-cyan-200/20 bg-cyan-100/5 p-2 text-xs text-cyan-100">
          <span className="mr-auto">{activePlan.summary ? "Plan ready" : "Planning"}</span>
          {activePlan.summary && activePlan.workflow && <button type="button" disabled={chatStatus === "thinking"} onClick={() => void advancePlan("Create it")} className="rounded-md bg-cyan-100 px-2 py-1.5 text-zinc-950 disabled:opacity-40">Create it</button>}
          <button type="button" onClick={() => void advancePlan("Cancel plan")} className="rounded-md border border-white/20 px-2 py-1.5 hover:bg-white/10">Cancel plan</button>
        </div>}
        <div className="jimmy-chat-scroll min-h-0 flex-1 space-y-3 overflow-y-auto pr-2">
          {messages.map((message, index) => (
            <div
              key={`${message.role}-${index}-${message.content.slice(0, 12)}`}
              className={
                message.role === "assistant"
                  ? "mr-8 rounded-[8px] bg-white/10 px-3 py-2 text-cyan-50"
                  : "ml-8 rounded-[8px] bg-cyan-100 px-3 py-2 text-zinc-950"
              }
            >
              <p className="mb-1 text-xs font-medium opacity-60">
                {message.role === "assistant" ? assistantName : "You"}
              </p>
              <p className="leading-6 break-words">{message.role === "assistant" ? splitCanvasReply(message.content).message : message.content}</p>
              {(message.visual || message.role === "assistant" && splitCanvasReply(message.content).canvas) && <button type="button" className="canvas-launch mt-3" onClick={() => canvas.publish(message.visual || splitCanvasReply(message.content).canvas!)}>Show on canvas</button>}
              {message.workflowUrl && <a href={message.workflowUrl} target="_blank" rel="noreferrer"
                className="mt-3 inline-block rounded-lg border border-cyan-200/30 px-3 py-2 text-xs text-cyan-100 transition hover:bg-cyan-100/10 focus-visible:outline-2 focus-visible:outline-cyan-200">Open workflow in n8n</a>}
            </div>
          ))}
          {chatStatus === "thinking" ? (
            <div className="mr-8 rounded-[8px] bg-white/10 px-3 py-2 text-cyan-100/80">
              {assistantName} is thinking...
            </div>
          ) : null}
          {chatError ? (
            <div className="rounded-[8px] bg-amber-200/15 px-3 py-2 text-amber-100">
              {chatError}
            </div>
          ) : null}
          <div ref={chatEndRef} />
        </div>
        <form className="mt-3 flex gap-2" onSubmit={sendMessage}>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={`Type to ${assistantName}...`}
            className="min-w-0 flex-1 rounded-full border border-white/10 bg-white/10 px-4 py-2 text-white outline-none transition placeholder:text-white/45 focus:border-cyan-200/70"
          />
          <button
            type="submit"
            disabled={chatStatus === "thinking" && !(activePlan && planAction(assistantCommand(input)) === "cancel") && !parseVoiceCommand(assistantCommand(input)) && !(desktop && isJimmyShutdown(assistantCommand(input)))}
            className="rounded-full bg-cyan-100 px-4 py-2 font-medium text-zinc-950 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            Send
          </button>
        </form>
        {pendingYouTubeUrl && !youtubeVideoId ? (
          <a
            href={pendingYouTubeUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 rounded-full border border-white/15 px-4 py-2 text-center text-xs text-cyan-100 transition hover:bg-white/10"
          >
            Open YouTube
          </a>
        ) : null}
      </aside>
      ) : null}
    </div>
  );
}
