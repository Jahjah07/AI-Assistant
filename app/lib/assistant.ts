export const DEFAULT_PERSONALITY = "Address me as Sir. Be useful and concise, with occasional playful dry wit. Keep sarcasm friendly, never cruel.";
export const PERSONALITY_STORAGE_KEY = "jimmy.personality";
export const DEFAULT_ASSISTANT_NAME = "Jimmy";
export const ASSISTANT_NAME_STORAGE_KEY = "jimmy.assistant-name";

export function validAssistantName(value: unknown): value is string {
  return typeof value === "string" && /^[\p{L}][\p{L}\p{N} '-]{0,23}$/u.test(value) && value === value.trim();
}

export function savedAssistantName() {
  try {
    const name = localStorage.getItem(ASSISTANT_NAME_STORAGE_KEY);
    return validAssistantName(name) ? name : DEFAULT_ASSISTANT_NAME;
  } catch { return DEFAULT_ASSISTANT_NAME; }
}

export function assistantWakePattern(name = savedAssistantName()) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}_])(?:hey\\s+)?(?:${escaped}|jimmy)(?![\\p{L}\\p{N}_])[\\s,.:;!?-]*`, "iu");
}

export function assistantCommand(input: string, name = savedAssistantName()) {
  const wake = assistantWakePattern(name).exec(input.trim());
  let command = wake?.index === 0 ? input.trim().slice(wake[0].length).trim() : input.trim();
  const ending = assistantWakePattern(name).exec(command);
  if (ending && /^(?:shut\s*down|expand|collapse)\s+$/i.test(command.slice(0, ending.index)) && ending.index + ending[0].length === command.length) {
    command = command.slice(0, ending.index) + "Jimmy";
  }
  return command;
}

export function savedPersonality() {
  try { return localStorage.getItem(PERSONALITY_STORAGE_KEY)?.trim() || DEFAULT_PERSONALITY; }
  catch { return DEFAULT_PERSONALITY; }
}

const CODE_TASK = /```|\b(?:code|coding|codebase|programming|debug|refactor|stack trace|typescript|javascript|python|sql|regex|unit tests?|pull request|algorithm|api endpoint|database schema)\b|\b(?:build|implement|fix|review|write)\b[\s\S]*\b(?:function|script|app|website|component|server|bug|software)\b/i;
const COMPLEX_TASK = /\b(?:in[- ]depth|complex|multi[- ]step|trade[- ]offs?|architecture|prove|proof|detailed analysis|reason through)\b/i;
const FOLLOW_UP = /^(?:yes|no|continue|go on|try again|why|how so|what about|and what about|also|make (?:it|that)|change (?:it|that)|do (?:it|that)|explain (?:it|that)|can you (?:make|change|explain) (?:it|that))\b[\s\S]*$/i;

export function selectAutoBrain(messages: { role: string; content: string }[]): "qwen" | "codex" {
  // shortcut: explicit task rules can miss intent, select a brain manually when they misroute a request.
  for (const message of [...messages].reverse()) {
    if (message.role !== "user") continue;
    if (CODE_TASK.test(message.content) || COMPLEX_TASK.test(message.content)) return "codex";
    if (!FOLLOW_UP.test(message.content.trim())) return "qwen";
  }
  return "qwen";
}
