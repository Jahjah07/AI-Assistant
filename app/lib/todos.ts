export type Todo = { id: string; text: string; done: boolean; createdAt: string; time?: string };
export type TodoView = { day: string; label: string; exists: boolean; tasks: Todo[]; reply: string };
export type TodoCommand = { kind: "todo"; action: "create" | "add" | "list" | "done" | "hide" | "time"; day?: string; text?: string; number?: number; done?: boolean; time?: string; timeError?: string };

export function todoTime(input: string): string | undefined {
  const value = input.trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, "");
  if (!value) return undefined;
  if (value === "noon") return "12:00";
  if (value === "midnight") return "00:00";
  const twelve = value.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/);
  const clock = value.match(/^(\d{2}):(\d{2})$/);
  const hour = Number(twelve?.[1] ?? clock?.[1]), minute = Number(twelve?.[2] ?? clock?.[2] ?? 0);
  if (minute > 59 || twelve && (hour < 1 || hour > 12) || !twelve && (!clock || hour > 23)) throw new Error("Please repeat with AM or PM (for example, at 3 PM), or use 24-hour HH:MM such as 15:00. No task time was guessed.");
  return `${String(twelve ? hour % 12 + (twelve[3] === "pm" ? 12 : 0) : hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
export function formatTodoTime(time: string) {
  const [hour, minute] = time.split(":");
  return `${Number(hour) % 12 || 12}${minute === "00" ? "" : `:${minute}`} ${Number(hour) >= 12 ? "PM" : "AM"}`;
}
export function splitTodoTime(text: string) {
  const match = text.match(/\s+at\s+(\d[\d: .apm]*|noon|midnight)\s*$/i);
  if (!match) return { text };
  return { text: text.slice(0, match.index).trim(), time: todoTime(match[1]) };
}

export function todoDate(when = "today", now = new Date()): string {
  if (when === "today" || when === "tomorrow") {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const field = (name: string) => parts.find(part => part.type === name)!.value;
    const date = new Date(`${field("year")}-${field("month")}-${field("day")}T00:00:00Z`);
    if (when === "tomorrow") date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(when) || !Number.isFinite(Date.parse(`${when}T00:00:00Z`)) || new Date(`${when}T00:00:00Z`).toISOString().slice(0, 10) !== when) throw new Error("Choose today, tomorrow, or a valid date in YYYY-MM-DD format.");
  return when;
}

export function todoDayLabel(day: string, now = new Date()) {
  if (day === todoDate("today", now)) return "today";
  if (day === todoDate("tomorrow", now)) return "tomorrow";
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" }).format(new Date(`${todoDate(day)}T00:00:00Z`));
}

export function parseTodoCommand(input: string): TodoCommand | null {
  // List-level time applies to new tasks; times at the end of individual tasks override it.
  const schedule = input.match(/((?:to[ -]?do|task)\s*list(?: (?:for )?(?:today|tomorrow|tommorow|\d{4}-\d{2}-\d{2}))?)\s+at\s+(\d{1,2}(?::\d{1,2})?(?:\s*[ap]\.?m\.?)?|noon|midnight)(?=\s*(?:[.!?]*$|[:,]|with\b))/i);
  const command = parseTodoBase(schedule ? input.replace(schedule[0], schedule[1]) : input);
  if (!command) return null;
  if (command.action !== "add" && command.action !== "create" && command.action !== "time") return schedule ? null : command;
  try {
    const time = schedule ? todoTime(schedule[2]) : command.time ? todoTime(command.time) : undefined;
    const task: { text?: string; time?: string } = command.text && !/[;\n]/.test(command.text) ? splitTodoTime(command.text) : { text: command.text };
    return { ...command, ...task, ...(task.time || time ? { time: task.time || time } : {}) };
  } catch (error) { return { ...command, timeError: error instanceof Error ? error.message : "Choose a valid task time." }; }
}

function parseTodoBase(input: string): TodoCommand | null {
  const text = input.trim().replace(/’/g, "'").replace(/^(?:hey\s+)?jimmy[\s,.:!-]*/i, "").replace(/^(?:(?:can|could|would) you\s+)?please\s+/i, "").replace(/^(?:can|could|would) you\s+/i, "").replace(/[.!?]+$/, "").replace(/\btommorow\b/gi, "tomorrow");
  const day = text.match(/\b(today|tomorrow|\d{4}-\d{2}-\d{2})\b/i)?.[1].toLowerCase();
  const list = "(?:to[ -]?do|task)\\s*list";
  const date = "(?:today|tomorrow|\\d{4}-\\d{2}-\\d{2})";
  if (new RegExp(`^(?:hide|close|dismiss) (?:my |the )?${list}$`, "i").test(text)) return { kind: "todo", action: "hide" };
  const reschedule = text.match(/^(?:set|change) (?:the time (?:of|for) )?(?:task|item) (\d+)(?:'s time| time)? (?:to|at) (.+?)(?: (?:on|for) (today|tomorrow|\d{4}-\d{2}-\d{2}))?$/i);
  if (reschedule) return { kind: "todo", action: "time", number: Number(reschedule[1]), time: reschedule[2], ...(reschedule[3] ? { day: reschedule[3].toLowerCase() } : {}) };
  const create = text.match(new RegExp(`^(?:create|make|start)(?: me)? (?:a |my |the )?${list}(?: (?:for )?(${date}))?(?:\\s*(?::|,|with\\b|containing\\b)\\s*(.*))?$`, "i"));
  if (create) return { kind: "todo", action: "create", ...(create[1] ? { day: create[1].toLowerCase() } : {}), ...(create[2]?.trim() ? { text: create[2].trim() } : {}) };
  if (new RegExp(`^(?:what(?:'s| is) (?:in|on) (?:my |the )?|(?:show|read|list|check)(?: me)? (?:my |the )?)${list}(?: (?:for )?${date})?$`, "i").test(text) || /^(?:do i have (?:anything|something|any tasks?) to do|what do i (?:have|need) to do)(?: (?:for )?(?:today|tomorrow|\d{4}-\d{2}-\d{2}))?$/i.test(text)) return { kind: "todo", action: "list", ...(day ? { day } : {}) };
  const done = text.match(/^(?:mark|complete|finish) (?:task|item) (\d+)(?: (?:as )?(done|complete|not done|incomplete))?(?: (?:on|for) (today|tomorrow|\d{4}-\d{2}-\d{2}))?$/i);
  if (done) return { kind: "todo", action: "done", number: Number(done[1]), done: !/^(?:not done|incomplete)$/i.test(done[2] || ""), ...(done[3] ? { day: done[3].toLowerCase() } : {}) };
  if (!/^add\b/i.test(text) || !new RegExp(list, "i").test(text)) return null;
  // Only scheduling words beside the list are dates; keep dates inside the task itself.
  const suffix = text.match(new RegExp(`\\s+(?:to|in|on) (?:my |the )?${list}(?: (?:for )?(${date}))?$`, "i"));
  if (suffix) {
    let task = text.slice(0, suffix.index).replace(/^add\s+/i, "");
    const before = task.match(new RegExp(`\\s+for (${date})$`, "i"));
    if (before) task = task.slice(0, before.index);
    if (/^(?:this(?: task)?|a task|something)$/i.test(task)) task = "";
    return { kind: "todo", action: "add", ...(suffix[1] || before?.[1] ? { day: (suffix[1] || before![1]).toLowerCase() } : {}), ...(task.trim() ? { text: task.trim() } : {}) };
  }
  const prefix = text.match(new RegExp(`^add (?:this task |a task )?(?:to|in|on) (?:my |the )?${list}(?: (?:for )?(${date}))?\\s*[:,-]?\\s*`, "i"));
  if (!prefix) return null;
  const task = text.slice(prefix[0].length);
  return { kind: "todo", action: "add", ...(prefix[1] ? { day: prefix[1].toLowerCase() } : {}), ...(task ? { text: task } : {}) };
}
