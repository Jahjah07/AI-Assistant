import catalog from "../../voice-service/app/kokoro-voices.json";

export const kokoroLanguages = catalog;
export const kokoroVoiceIds = new Set(catalog.flatMap(group => group.voices.map(voice => voice.id)));
export const KOKORO_VOICE_STORAGE_KEY = "jimmy.kokoro.voice";
export const SPEECH_SPEED_STORAGE_KEY = "jimmy.speech.speed";

export function savedSpeechSpeed(): number {
  try {
    const value = Number(localStorage.getItem(SPEECH_SPEED_STORAGE_KEY) ?? localStorage.getItem("johnny.speech.speed") ?? 1);
    return Number.isFinite(value) ? Math.max(0.6, Math.min(1.5, value)) : 1;
  } catch { return 1; }
}

export function savedKokoroVoice(): string | undefined {
  try {
    const voice = localStorage.getItem(KOKORO_VOICE_STORAGE_KEY) ?? localStorage.getItem("johnny.kokoro.voice");
    return voice && kokoroVoiceIds.has(voice) ? voice : undefined;
  } catch {
    return undefined;
  }
}
