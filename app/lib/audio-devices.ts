export const AUDIO_INPUT_KEY = "jimmy.audio.input";
export const AUDIO_OUTPUT_KEY = "jimmy.audio.output";
export const VOICE_VOLUME_KEY = "jimmy.audio.voice-volume";
export class AudioOutputError extends Error {}

export function savedVoiceVolume(): number {
  try {
    const value = Number(localStorage.getItem(VOICE_VOLUME_KEY) ?? 1);
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
  } catch { return 1; }
}
export function saveVoiceVolume(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("Choose a voice volume between 0 and 100 percent.");
  localStorage.setItem(VOICE_VOLUME_KEY, String(value));
}
export function selectVoiceOutput(devices: Pick<MediaDeviceInfo, "kind" | "deviceId" | "label">[], target: string) {
  const name = target.toLowerCase().trim().replace(/^(?:my|the)\s+/, "");
  if (/^(?:system )?default(?: speaker| output)?$/.test(name)) return { deviceId: "", label: "System default" };
  const outputs = devices.filter(device => device.kind === "audiooutput" && device.deviceId && !["default", "communications"].includes(device.deviceId));
  const laptop = /^(?:laptop|built[- ]in|internal)(?: speakers?)?$/.test(name);
  const exact = outputs.filter(device => device.label.toLowerCase() === name);
  let matches = exact.length ? exact : outputs.filter(device => laptop ? /speakers?|realtek|built[- ]in|internal/i.test(device.label) && !/bluetooth|headphones?|headset|hdmi|display|usb|digital/i.test(device.label) : device.label.toLowerCase().includes(name));
  const builtIn = laptop ? matches.filter(device => /realtek|built[- ]in|internal/i.test(device.label)) : [];
  if (builtIn.length) matches = builtIn;
  if (matches.length !== 1) throw new Error(matches.length ? "More than one speaker matches. Choose the exact output in Settings → Audio devices." : "That speaker is not available. Connect it in Windows, then allow access/refresh devices and choose the output in Settings → Audio devices.");
  return matches[0];
}

export function savedAudioDevice(key: string): string {
  try { return localStorage.getItem(key) || ""; } catch { return ""; }
}

export function saveAudioDevice(key: string, id: string) {
  localStorage.setItem(key, id);
}

export function microphoneConstraints(id: string): MediaStreamConstraints {
  return { audio: {
    autoGainControl: true, channelCount: 1, echoCancellation: true, noiseSuppression: true,
    ...(id ? { deviceId: { exact: id } } : {}),
  } };
}

export async function routeAudio(audio: HTMLMediaElement, id = savedAudioDevice(AUDIO_OUTPUT_KEY)) {
  if (typeof audio.setSinkId !== "function") {
    if (id) throw new Error("This browser does not support speaker selection.");
    return;
  }
  await audio.setSinkId(id);
}
