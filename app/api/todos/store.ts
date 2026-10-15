import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { todoDate, todoDayLabel, todoTime, splitTodoTime, formatTodoTime, type Todo, type TodoView } from "../../lib/todos";

const file = path.join(process.cwd(), "storage", "todos.json");
let queue: Promise<unknown> = Promise.resolve();
async function read(): Promise<Record<string, Todo[]>> {
  try {
    const data = JSON.parse(await readFile(file, "utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data) || Object.entries(data).some(([day, tasks]) => todoDate(day) !== day || !Array.isArray(tasks) || tasks.some(task => !task || typeof task.id !== "string" || typeof task.text !== "string" || typeof task.done !== "boolean" || typeof task.createdAt !== "string" || task.time !== undefined && (typeof task.time !== "string" || todoTime(task.time) !== task.time)))) throw new Error("Invalid to-do storage.");
    return data;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw new Error("Could not read saved tasks. The existing file has been left unchanged."); }
}
function view(days: Record<string, Todo[]>, day: string): TodoView {
  const tasks = days[day] || [], label = todoDayLabel(day);
  const open = tasks.flatMap((task, index) => task.done ? [] : [`${index + 1}. ${task.time ? `At ${formatTodoTime(task.time)}: ` : ""}${task.text}`]);
  return { day, label, exists: Object.hasOwn(days, day), tasks, reply: open.length ? `Your to-do list for ${label} has ${open.length} unfinished ${open.length === 1 ? "task" : "tasks"}:\n${open.join("\n")}` : tasks.length ? `All your tasks for ${label} are done.` : `You have no tasks on your to-do list for ${label}.` };
}
export async function getTodos(when?: string) {
  await queue;
  return view(await read(), todoDate(when));
}
export function changeTodos(input: Record<string, unknown>) {
  const work = queue.then(async () => {
    if (input.day !== undefined && typeof input.day !== "string") throw new Error("Choose a valid task date.");
    const day = todoDate(typeof input.day === "string" ? input.day : undefined), days = await read();
    const tasks = days[day] || [];
    if (input.time !== undefined && typeof input.time !== "string") throw new Error("Task time must be a time such as 15:00 or 3 PM.");
    const time = typeof input.time === "string" ? todoTime(input.time) : undefined;
    if (input.action === "create" || input.action === "add") {
      if (input.action === "add" && (typeof input.text !== "string" || !input.text.trim())) throw new Error("Tell me which task to add.");
      if (input.text !== undefined && typeof input.text !== "string") throw new Error("Task text must be text.");
      const lines = typeof input.text === "string" ? input.text.split(/[;\n]+/).map(text => text.trim()).filter(Boolean).map(splitTodoTime) : [];
      if (input.action === "add" && !lines.length) throw new Error("Tell me which task to add.");
      if (lines.length > 20 || lines.some(task => !task.text || task.text.length > 500)) throw new Error("Add up to 20 tasks at a time, each with 1 to 500 characters.");
      days[day] = [...tasks, ...lines.map(task => ({ id: randomUUID(), text: task.text, done: false, createdAt: new Date().toISOString(), ...(task.time || time ? { time: task.time || time } : {}) }))];
    } else if (input.action === "done" || input.action === "remove" || input.action === "time") {
      const task = typeof input.id === "string" ? tasks.find(task => task.id === input.id) : typeof input.number === "number" && Number.isInteger(input.number) ? tasks[input.number - 1] : undefined;
      if (!task) throw new Error("That task was not found. Ask what is in your to-do list first.");
      if (input.action === "done") { if (typeof input.done !== "boolean") throw new Error("Choose whether the task is done."); task.done = input.done; }
      if (input.action === "time") { if (typeof input.time !== "string") throw new Error("Provide a task time, or an empty time to clear it."); if (time) task.time = time; else delete task.time; }
      days[day] = input.action === "remove" ? tasks.filter(item => item.id !== task.id) : tasks;
    } else throw new Error("Choose create, add, done, time or remove.");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify(days, null, 2), { mode: 0o600 });
    await rename(`${file}.tmp`, file);
    return view(days, day);
  });
  queue = work.then(() => undefined, () => undefined);
  return work;
}
