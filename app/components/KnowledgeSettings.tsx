"use client";
import { useEffect, useState } from "react";

type Entry = { id: string; title: string; text: string; source: string; kind: string; learnedAt: string; official?: boolean; publisher?: string; evidence?: string };
export default function KnowledgeSettings() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/knowledge", { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Could not read knowledge.");
      const data = await response.json(); if (!controller.signal.aborted) setEntries(data.entries);
    }).catch(error => { if (!controller.signal.aborted) setStatus(error.message); });
    return () => controller.abort();
  }, []);
  async function update(body: Record<string, string>) {
    setBusy(true); setStatus(body.action === "discover" ? "Finding the publisher and searching its documentation…" : body.action === "learn" ? "Reading documentation…" : "Saving…");
    try {
      const response = await fetch("/api/knowledge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      const refreshed = await fetch("/api/knowledge"); if (!refreshed.ok) throw new Error("Saved, but could not refresh the list.");
      setEntries((await refreshed.json()).entries); setStatus(body.action === "forget" ? "Forgotten." : "Saved for relevant future tasks.");
      if (body.action === "note") setText("");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not update knowledge."); }
    finally { setBusy(false); }
  }
  const button = "rounded-full border border-cyan-200/30 px-3 py-2 text-xs text-cyan-100 disabled:opacity-40";
  return <section className="space-y-4 text-sm">
    <h3 className="font-medium text-cyan-100">Knowledge library</h3>
    <p className="text-xs leading-5 text-white/60">Your assistant looks up documentation for technical tasks and saves references for later use. Name software or a service to discover its docs. Publisher evidence and retrieval dates are saved; search ranking alone does not establish an official source. This does not retrain the model.</p>
    <label className="block">Teach a lesson<textarea rows={3} maxLength={2000} value={text} onChange={event => setText(event.target.value)} className="mt-2 w-full rounded-lg bg-zinc-900 p-3" placeholder="For Gmail retrieval, use the native Gmail node rather than an HTTP placeholder." /></label>
    <button className={button} type="button" disabled={busy || !text.trim()} onClick={() => void update({ action: "note", text })}>Save lesson</button>
    <label className="block">Software or service<input value={topic} maxLength={80} onChange={event => setTopic(event.target.value)} className="mt-2 w-full rounded-lg bg-zinc-900 p-3" placeholder="React, Python, Docker…" /></label>
    <button className={button} type="button" disabled={busy || !topic.trim()} onClick={() => void update({ action: "discover", topic })}>Find and learn documentation</button>
    <label className="block">Documentation URL (optional)<input type="url" value={url} onChange={event => setUrl(event.target.value)} className="mt-2 w-full rounded-lg bg-zinc-900 p-3" placeholder="https://publisher.example/docs" /></label>
    <button className={button} type="button" disabled={busy || !url.trim()} onClick={() => void update({ action: "learn", url })}>Learn from documentation</button>
    <p role="status" className="text-xs text-cyan-100">{status}</p>
    <div className="jimmy-chat-scroll max-h-72 space-y-3 overflow-auto">
      {!entries.length && <p className="text-xs text-white/50">No saved knowledge yet. n8n workflow creation also saves the references it consults automatically.</p>}
      {entries.map(entry => <article key={entry.id} className="space-y-2 rounded-lg border border-white/10 p-3">
        <h4>{entry.title}</h4>
        <p className="text-xs text-white/50">{entry.kind === "documentation" ? entry.official ? `Publisher identified: ${entry.publisher}` : "Web reference · official publisher not established" : "User-taught lesson"} · {new Date(entry.learnedAt).toLocaleDateString()}</p>
        {entry.evidence && <p className="text-xs text-white/45">{entry.evidence}</p>}
        {entry.kind === "documentation" ? <a href={entry.source} target="_blank" rel="noreferrer" className="break-all text-xs text-cyan-100 underline">Source</a> : <p className="text-xs text-white/50">{entry.source}</p>}
        <p className="whitespace-pre-wrap break-words text-xs text-white/65">{entry.text.slice(0, 400)}{entry.text.length > 400 ? "…" : ""}</p>
        <div className="flex gap-2">{entry.kind === "documentation" && <button className={button} type="button" disabled={busy} onClick={() => void update({ action: "learn", url: entry.source })}>Refresh source</button>}
          <button className={button} type="button" disabled={busy} onClick={() => void update({ action: "forget", id: entry.id })}>Forget</button></div>
      </article>)}
    </div>
    <p className="text-xs leading-5 text-white/50">Automatic lookup sends public product names and general feature words to search/identity services, not your raw conversation or source code. If a publisher cannot be established, the assistant asks for a source instead of trusting a random result. Direct links without publisher evidence stay marked unverified. Cached references and lessons are shared with your selected chat brain, including Codex. Forgetting a reference removes its cache; a later lookup may fetch it again.</p>
  </section>;
}
