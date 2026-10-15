"use client";
import { useEffect, useState } from "react";

type Tool = { id: string; name: string; path: string; method: string; phrases: string[]; enabled: boolean; headerName: string; hasSecret: boolean; parameters: Record<string, string | number | boolean> };
const fresh: Tool = { id: "", name: "", path: "", method: "GET", phrases: [], enabled: false, headerName: "", hasSecret: false, parameters: {} };

export default function N8nTools() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [tool, setTool] = useState(fresh);
  const [secret, setSecret] = useState("");
  const [secretVisible, setSecretVisible] = useState(false);
  const [phrases, setPhrases] = useState("");
  const [defaults, setDefaults] = useState("{}");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  function select(next: Tool) { setTool(next); setSecret(""); setSecretVisible(false); setPhrases(next.phrases.join("\n")); setDefaults(JSON.stringify(next.parameters, null, 2)); setStatus(""); }
  function generateSecret() {
    try {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      setSecret(Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join(""));
      setSecretVisible(true);
      setStatus("New secret generated. Copy it into n8n’s Header Auth credential, then save this tool. Generating alone does not change either saved credential.");
    } catch { setStatus("Could not generate a secure secret. Your current value was kept."); }
  }
  async function copySecret() {
    try {
      await navigator.clipboard.writeText(secret);
      setSecretVisible(false);
      setStatus("Copied; secret hidden. Paste it into n8n’s Header Auth credential and save this tool. The secret remains on your clipboard until replaced.");
    } catch { setStatus("Could not copy. Select and copy the generated secret manually, then choose Hide secret."); }
  }
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/n8n-tools", { signal: controller.signal }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      if (!controller.signal.aborted) { setTools(data.tools); if (data.tools[0]) select(data.tools[0]); }
    }).catch(error => { if (!controller.signal.aborted) setStatus(error.message); });
    return () => controller.abort();
  }, []);
  async function update(action: string) {
    setBusy(true); setStatus(action === "test" ? "Calling the saved production webhook…" : "Saving…");
    try {
      let parameters = {};
      if (action === "save") { try { parameters = JSON.parse(defaults); } catch { throw new Error("Default parameters must be valid JSON."); } }
      const response = await fetch("/api/n8n-tools", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...(tool.id ? { id: tool.id } : {}), ...(action === "save" ? { name: tool.name.trim(), path: tool.path.trim(), method: tool.method, enabled: tool.enabled, headerName: tool.headerName.trim(), secret, phrases: phrases.split("\n").map(text => text.trim()).filter(Boolean), parameters } : {}) }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      if (action === "test") { setStatus(`Read tool responded${data.count != null ? ` with ${data.count} items` : " with a JSON object (item count unknown)"}. No email content is shown in this test.`); return; }
      setTools(data.tools); select(data.tools.find((entry: Tool) => entry.id === tool.id || entry.name === tool.name.trim()) || data.tools[0] || fresh);
      setStatus(action === "delete" ? "Tool removed." : "Saved. This tool is ready for its next request when enabled.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not update tools."); }
    finally { setBusy(false); }
  }
  const field = "mt-1 w-full rounded-lg border border-white/15 bg-zinc-900 p-2 text-sm";
  const button = "rounded-full border border-cyan-200/30 px-3 py-2 text-xs text-cyan-100 disabled:opacity-40";
  return <section className="space-y-4 text-sm">
    <h3 className="font-medium text-cyan-100">n8n read tools</h3>
    <p className="text-xs leading-5 text-white/60">Connect Gmail, Google Sheets, or another read workflow without changing the assistant’s code. Register only workflows that retrieve data: this connector cannot verify what their nodes do.</p>
    <div className="flex flex-wrap gap-2">{tools.map(entry => <button type="button" className={button} disabled={busy} key={entry.id} aria-pressed={tool.id === entry.id} onClick={() => select(entry)}>{entry.name}{entry.enabled ? " · On" : " · Off"}</button>)}<button type="button" className={button} disabled={busy} onClick={() => select(fresh)}>Add tool</button></div>
    <fieldset disabled={busy} className="space-y-3 disabled:opacity-60">
      <label className="block">Tool name<input className={field} value={tool.name} maxLength={48} placeholder="Gmail or Google Sheets" onChange={event => setTool({ ...tool, name: event.target.value })} /></label>
      <label className="block">Webhook path<input className={field} value={tool.path} maxLength={240} placeholder="gmail/messages" onChange={event => setTool({ ...tool, path: event.target.value })} /><span className="text-xs text-white/50">The part after /webhook/ in your production URL. Uses the backend’s configured n8n server.</span></label>
      <label className="block">HTTP method<select className={field} value={tool.method} onChange={event => setTool({ ...tool, method: event.target.value })}><option>GET</option><option>POST</option></select></label>
      <label className="block">Voice and chat phrases<textarea className={field} rows={3} value={phrases} placeholder={"check my emails\nread my sheet"} onChange={event => setPhrases(event.target.value)} /><span className="text-xs text-white/50">One phrase per line, at the start of your request. You can also say “Use {tool.name || "tool name"}”.</span></label>
      <label className="block">Authentication header name<input className={field} value={tool.headerName} placeholder="The header name in n8n’s Header Auth credential" onChange={event => setTool({ ...tool, headerName: event.target.value })} /></label>
      <div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block min-w-0 flex-1">Webhook secret<input className={field} type={secretVisible ? "text" : "password"} autoComplete="new-password" spellCheck={false} value={secret} maxLength={4096} placeholder={tool.hasSecret ? "Saved securely; leave blank to keep it" : "The value from the same Header Auth credential"} onChange={event => { setSecret(event.target.value); setSecretVisible(false); }} /></label>
          <button type="button" className={button} onClick={generateSecret}>Generate secret</button>
          {secretVisible && <><button type="button" className={button} onClick={() => void copySecret()}>Copy secret</button><button type="button" className={button} onClick={() => setSecretVisible(false)}>Hide secret</button></>}
        </div>
        <p className="mt-1 text-xs text-white/50">Generated secrets are shown until copied or hidden. Use the same header name and secret in n8n and the assistant. Saved secrets cannot be revealed here.</p>
      </div>
      <label className="block">Default parameters (JSON)<textarea className={field} rows={3} value={defaults} onChange={event => setDefaults(event.target.value)} /><span className="text-xs text-white/50">Optional defaults, such as spreadsheetId and range. Override them with: Use Google Sheets with {`{"range":"Sheet1!A1:C20"}`}.</span></label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={tool.enabled} onChange={event => setTool({ ...tool, enabled: event.target.checked })} />Enable this read tool</label>
    </fieldset>
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={() => void update("save")}>Save tool</button><button type="button" className={button} disabled={busy || !tool.id || !tools.find(entry => entry.id === tool.id)?.enabled} onClick={() => void update("test")}>Test saved tool (runs workflow)</button><button type="button" className={button} disabled={busy || !tool.id} onClick={() => void update("delete")}>Remove tool</button></div>
    <p role="status" className="text-xs text-cyan-100">{status}</p>
    <div className="space-y-2 text-xs leading-5 text-white/50">
      <p>For Gmail, select the connected Gmail account in n8n. The paginated Gmail workflow responds when its last node finishes, with Response Data → First Entry JSON (messages and nextPageToken). Publish the workflow. Match the header name and value from its Header Auth credential; your n8n API key is separate.</p>
      <p>“Check my emails” requests unread mail since your last completed routine check, up to this request’s time. The first check starts on Monday in Manila time. Check times survive restarts and advance only after a complete reply; unfinished pages resume first so they are not skipped. “Check my emails this week” explicitly repeats the weekly search. Searches and “check all my emails” do not change your routine check time. Each request returns up to 20 previews; say “next page of emails” to continue. Spam and trash are excluded. These commands require the updated Gmail workflow.</p>
      <p>If n8n hides the existing secret, create a dedicated Header Auth credential for this workflow with a name such as X-Jimmy-Key and a secret you can copy into the assistant. Select that credential on the Webhook node. Keep credentials used by other workflows unchanged.</p>
      <p>GET sends parameters in the query; POST sends JSON. Workflows receive your spoken/typed request as “request”, plus any parameters. They must implement any filtering you want; the assistant cannot invent filters for a workflow that does not support them.</p>
      <p>Credentials are encrypted on the backend using VOICE_SERVICE_SECRET and never returned to this panel or sent to the model. Keep that server secret stable; changing it requires re-entering webhook secrets. Results stay in this chat session. Auto uses local Qwen for these results and later replies in this session; explicitly choosing Codex sends the conversation to your ChatGPT account. Large results are excerpted for the model and marked incomplete.</p>
    </div>
  </section>;
}
