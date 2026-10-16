import { parseTodoCommand, type TodoCommand } from "./todos";

export type VoiceCommand =
  | TodoCommand
  | { kind: "canvas"; action: "open" | "close" }
  | { kind: "speech-stop" }
  | { kind: "speech-repeat" }
  | { kind: "speech-speed"; direction: "slower" | "faster" | "normal" }
  | { kind: "speech-voice"; name: string }
  | { kind: "audio-output"; target: string }
  | { kind: "voice-volume"; percent: number }
  | { kind: "audio-settings"; page: "bluetooth" | "mixer" }
  | { kind: "screen-inspect" }
  | { kind: "desktop-view"; expanded: boolean }
  | { kind: "desktop-hide" }
  | { kind: "n8n-create"; prompt: string }
  | { kind: "task-plan"; prompt: string }
  | { kind: "knowledge-learn"; url: string }
  | { kind: "knowledge-note"; text: string }
  | { kind: "knowledge-discover"; topic: string }
  | { kind: "knowledge-list" }
  | { kind: "command-help" };

export function parseVoiceCommand(input: string): VoiceCommand | null {
  const text = input.toLowerCase().trim()
    .replace(/^(?:hey\s+)?jimmy[\s,.:!-]*/, "")
    .replace(/^please\s+/, "").replace(/[.!?,]+$/, "")
    .replace(/,?\s+please$/, "").trim();
  if (/^(?:open|show|display) (?:the |my )?(?:canvas|blackboard|data canvas|black screen)$/.test(text)) return { kind: "canvas", action: "open" };
  if (/^(?:close|hide) (?:the |my )?(?:canvas|blackboard|data canvas|black screen)$/.test(text)) return { kind: "canvas", action: "close" };
  if (/^(?:stop (?:speaking|talking)|be quiet|quiet)$/.test(text)) return { kind: "speech-stop" };
  if (/^(?:(?:open|show) (?:my |the |windows )?bluetooth(?: settings)?|(?:connect|pair)(?: my| a| the)? bluetooth (?:speaker|headphones|headset))$/.test(text)) return { kind: "audio-settings", page: "bluetooth" };
  if (/^(?:open|show) (?:the |windows )?volume mixer$/.test(text)) return { kind: "audio-settings", page: "mixer" };
  const voiceVolume = text.match(/^(?:set|change|turn) (?:your |jimmy'?s )?voice volume (?:to )?(\d{1,3})\s*(?:percent|%)?$/);
  if (voiceVolume) return { kind: "voice-volume", percent: Number(voiceVolume[1]) };
  const output = text.match(/^(?:use|switch to) (.+?) for (?:your|jimmy'?s) (?:voice|speech)$/)
    || text.match(/^(?:change|set|switch) (?:your |the )?voice output to (.+)$/)
    || text.match(/^speak (?:through|using) (.+)$/)
    || text.match(/^use ((?:my |the )?laptop speakers)$/);
  if (output) return { kind: "audio-output", target: output[1] };
  const todo = parseTodoCommand(input);
  if (todo) return todo;
  if (/^(?:(?:can|could) you )?(?:learn|study)(?: from)? (?:the )?n8n (?:documentation|docs)$/.test(text)) return { kind: "knowledge-learn", url: "https://docs.n8n.io/integrations" };
  const lesson = input.trim().replace(/^(?:hey\s+)?jimmy[\s,.:!-]*/i, "").replace(/^please\s+/i, "");
  const learnUrl = lesson.match(/^(?:learn|study)(?: from)?\s+(https:\/\/\S+?)\s*$/i);
  if (learnUrl) return { kind: "knowledge-learn", url: learnUrl[1].replace(/[.,!?]+$/, "") };
  const note = lesson.match(/^(?:learn that|save (?:this )?lesson[: ,]*)\s+(.+)/i);
  if (note) return { kind: "knowledge-note", text: note[1].trim() };
  const topic = lesson.match(/^(?:(?:can|could) you )?(?:learn|study)(?: from)?\s+(?:the\s+)?(.+?)\s+(?:documentation|docs)[.!?]*$/i)
    || lesson.match(/^(?:learn|study) about\s+(.+?)[.!?]*$/i);
  if (topic) return { kind: "knowledge-discover", topic: topic[1].replace(/^official\s+/i, "").trim() };
  if (/^(?:what have you (?:learned|learnt)|(?:show|list) (?:your )?(?:knowledge|lessons))$/.test(text)) return { kind: "knowledge-list" };
  const planning = input.trim().replace(/^(?:hey\s+)?jimmy[\s,.:!-]*/i, "").match(/^(?:please\s+)?plan(?:\s+mode)?[,:]?\s+(.+)/i);
  if (planning) return { kind: "task-plan", prompt: planning[1].trim() };
  if (/^(?:(?:(?:can|could|would) you|i (?:want|need) you to|i['’]d like you to) )?(?:create|build|make)\b/.test(text) && /\bworkflow\b/.test(text) &&
    (/\bn8n\b/.test(text) || !/\b(?:github actions?|gitlab|power automate|zapier|make\.com)\b/.test(text))) {
    return { kind: "n8n-create", prompt: input.trim() };
  }
  if (/^(?:minimi[sz]e(?: (?:yourself|jimmy|the assistant|the window|to (?:the )?tray))?|hide (?:yourself|jimmy|the assistant|to (?:the )?tray))$/.test(text)) return { kind: "desktop-hide" };
  if (/^(?:(?:go |enter )?full\s*screen|(?:show|open) (?:your |the |my )?(?:full )?(?:ui|dashboard)|expand(?: jimmy)?)$/.test(text)) return { kind: "desktop-view", expanded: true };
  if (/^(?:(?:(?:go to|enter|switch to) )?(?:compact|circle)(?: mode)?|go small|(?:go back|return) to (?:the )?(?:small )?circle|collapse(?: jimmy)?)$/.test(text)) return { kind: "desktop-view", expanded: false };
  if (/^(?:(?:can|could) you (?:see|look at|check) my screen|(?:look at|check|describe|read) my screen|what(?:'s| is) on my screen|what am i (?:doing|working on) on (?:my |the )?screen)(?:\s*[,;:]\s*.+)?$/.test(text)) return { kind: "screen-inspect" };
  if (/^(?:repeat that|say that again|repeat your last (?:answer|reply))$/.test(text)) return { kind: "speech-repeat" };
  if (/^(?:speak|talk) (?:a little )?(slower|faster)$/.test(text)) {
    return { kind: "speech-speed", direction: text.endsWith("slower") ? "slower" : "faster" };
  }
  if (/^(?:speak|talk) (?:at )?(?:normal speed|normally)$/.test(text)) return { kind: "speech-speed", direction: "normal" };
  const voice = text.match(/^(?:change|switch|set) (?:your |the )?voice to ([a-z_ -]+)$/);
  if (voice) return { kind: "speech-voice", name: voice[1].trim() };
  if (/^(?:what can you do|(?:show|list) (?:your )?commands|help with commands)$/.test(text)) return { kind: "command-help" };
  return null;
}

export const COMMAND_HELP = "You can say: Time for work to open ChatGPT, Brave, and Visual Studio Code. Stop speaking. Repeat that. Speak slower, speak faster, or speak at normal speed. Change your voice to George. Can you see my screen? Open dashboard. Show dashboard. Fullscreen. Circle mode. Minimize to hide in the tray while listening continues. Jimmy, go small. Create an n8n workflow that does a task. Open my local n8n. Plan a task. Cancel plan. Create me a to-do list for tomorrow. Add a task to my to-do list. What is in my to-do list? Do I have something to do today? Mark task 1 done. Set task 1 to 3 PM. Add finish my slides to my to-do list for tomorrow at 3 PM. Hide to-do list. Open Bluetooth settings. Use laptop speakers for your voice. Set your voice volume to 30 percent. Open Windows volume mixer. Open canvas. Hide canvas. I can also tell the time and date, check the weather, open apps, open ChatGPT or configured website shortcuts, search the web or find images in your browser, control YouTube, remember things, and generate images. In the floating desktop app, say Jimmy, shut down to close Jimmy and unload its models. Say Jimmy before a command, or give a follow-up after my reply.";
