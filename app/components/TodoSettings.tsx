"use client";
import { useEffect, useState } from "react";
import { todoDate, type TodoView } from "../lib/todos";

export default function TodoSettings() {
  const [day, setDay] = useState(() => todoDate());
  const [view, setView] = useState<TodoView | null>(null);
  const [text, setText] = useState("");
  const [time, setTime] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/todos?day=${day}`, { signal: controller.signal }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      if (!controller.signal.aborted) { setView(data); setStatus(""); }
    }).catch(error => { if (!controller.signal.aborted) setStatus(error.message); });
    return () => controller.abort();
  }, [day]);
  async function update(body: Record<string, unknown>) {
    setBusy(true); setStatus("Saving…");
    try {
      const response = await fetch("/api/todos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, day }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setView(data); setStatus("Saved."); if (body.action === "add") { setText(""); setTime(""); }
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not save tasks."); }
    finally { setBusy(false); }
  }
  const button = "rounded-full border border-cyan-200/30 px-3 py-2 text-xs text-cyan-100 disabled:opacity-40";
  return <section className="space-y-4 text-sm">
    <h3 className="font-medium text-cyan-100">To-do list</h3>
    <p className="text-xs leading-5 text-white/60">Saved locally across restarts. Today and tomorrow use Asia/Manila. You can also manage tasks by voice or chat.</p>
    <div className="flex flex-wrap items-end gap-2">
      <label>Date<input type="date" value={day} disabled={busy} onChange={event => { if (event.target.value) setDay(event.target.value); }} className="mt-1 block rounded-lg border border-white/15 bg-zinc-900 p-2" /></label>
      <button type="button" className={button} disabled={busy} onClick={() => setDay(todoDate())}>Today</button>
      <button type="button" className={button} disabled={busy} onClick={() => setDay(todoDate("tomorrow"))}>Tomorrow</button>
    </div>
    <form className="space-y-2" onSubmit={event => { event.preventDefault(); void update({ action: "add", text, time }); }}>
      <label className="block">Tasks to add<textarea rows={3} value={text} maxLength={10000} onChange={event => setText(event.target.value)} placeholder={"Finish the presentation\nEmail the project team"} className="mt-1 w-full rounded-lg border border-white/15 bg-zinc-900 p-2" /></label>
      <label className="block">Time for new tasks (optional, Manila)<input type="time" value={time} disabled={busy} onChange={event => setTime(event.target.value)} className="mt-1 block rounded-lg border border-white/15 bg-zinc-900 p-2" /></label>
      <p className="text-xs text-white/50">One task per line, or separate tasks with semicolons. End a task with “at 3 PM” to give it its own time.</p>
      <button type="submit" className={button} disabled={busy || !text.trim() || view?.day !== day}>Add tasks</button>
    </form>
    <p role="status" className="text-xs text-cyan-100">{status}</p>
    {view?.day === day ? <div className="space-y-2">
      <p className="text-xs text-white/60">{view.tasks.filter(task => !task.done).length} unfinished · {view.label}</p>
      {!view.tasks.length && <p className="text-white/50">No tasks for this date yet.</p>}
      {view.tasks.map((task, index) => <div key={task.id} className="flex items-start gap-3 rounded-lg border border-white/10 p-3">
        <input type="checkbox" aria-label={`Mark task ${index + 1} done`} checked={task.done} disabled={busy} className="mt-1 accent-cyan-200" onChange={event => void update({ action: "done", id: task.id, done: event.target.checked })} />
        <div className="min-w-0 flex-1"><span className={`break-words ${task.done ? "text-white/40 line-through" : "text-white/85"}`}>{index + 1}. {task.text}</span>
          <label className="mt-2 flex flex-wrap items-center gap-2 text-xs text-white/50">Time<input type="time" aria-label={`Time for task ${index + 1}`} value={task.time || ""} disabled={busy} onChange={event => void update({ action: "time", id: task.id, time: event.target.value })} className="rounded-lg border border-white/15 bg-zinc-900 p-1.5 text-white/80" /></label>
        </div>
        <button type="button" className="shrink-0 text-xs text-white/50 hover:text-white disabled:opacity-40" disabled={busy} aria-label={`Remove task ${index + 1}`} onClick={() => void update({ action: "remove", id: task.id })}>Remove</button>
      </div>)}
    </div> : <p className="text-xs text-white/50">Loading tasks…</p>}
    <p className="text-xs leading-5 text-white/50">Try “Create me a to-do list for tomorrow”, “Add finish my slides to my to-do list”, “What’s in my to-do list?”, or “Mark task 1 done”. After a voice reply, use the displayed task number. These lists do not schedule alarms or move unfinished tasks to another day automatically.</p>
  </section>;
}
