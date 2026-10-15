import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

type Notification = {
  method?: string;
  params?: { threadId?: string; delta?: string; turn?: { status?: string; error?: { message?: string } } };
};
type Account = { account: { type: string; planType?: string } | null };

export class CodexAuthenticationError extends Error {}

function executable() {
  if (process.env.CODEX_CLI_PATH) return process.env.CODEX_CLI_PATH;
  if (process.platform !== "win32") return "codex";
  const cli = join(process.env.APPDATA || "", "npm/node_modules/@openai/codex/bin/codex.js");
  if (existsSync(cli)) {
    const require = createRequire(cli);
    const platformPackage = require.resolve(`@openai/codex-win32-${process.arch}/package.json`);
    return join(platformPackage, "..", "vendor", `${process.arch === "arm64" ? "aarch64" : "x86_64"}-pc-windows-msvc`, "bin/codex.exe");
  }
  throw new Error("Install Codex CLI, or set CODEX_CLI_PATH to its executable.");
}

class CodexClient {
  private sequence = 0;
  private closed = false;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  onNotification: (message: Notification) => void = () => {};
  onFailure: (error: Error) => void = () => {};

  constructor(private child: ChildProcessWithoutNullStreams) {
    let buffer = "";
    child.stderr.resume();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 1_000_000) { this.close(new Error("Codex event exceeded its size limit.")); return; }
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line) as Notification & { id?: number; result?: unknown; error?: { message?: string } };
          if (message.id !== undefined && message.method) {
            this.send({ id: message.id, error: { code: -32601, message: "Jimmy does not grant Codex tool or approval requests." } });
          } else if (message.id !== undefined) {
            const pending = this.pending.get(message.id);
            if (!pending) continue;
            clearTimeout(pending.timer);
            this.pending.delete(message.id);
            if (message.error) pending.reject(new Error(message.error.message || "Codex request failed."));
            else pending.resolve(message.result);
          } else this.onNotification(message);
        } catch { this.close(new Error("Codex returned an invalid event.")); }
      }
    });
    child.on("error", () => this.close(new Error("Could not start Codex. Check its installation and CODEX_CLI_PATH.")));
    child.on("exit", () => this.close(new Error("Codex app-server stopped.")));
    child.stdin.on("error", () => this.close(new Error("Codex connection closed.")));
  }

  send(message: object) {
    if (this.closed) throw new Error("Codex connection closed.");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request<T>(method: string, params: object): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => this.close(new Error("Codex request timed out.")), 30_000);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      try { this.send({ id, method, params }); } catch (error) {
        clearTimeout(timer); this.pending.delete(id); reject(error);
      }
    });
  }

  close(error = new Error("Codex connection closed.")) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    this.child.stdin.end();
    this.child.kill();
    this.onFailure(error);
  }
}

async function connect() {
  const home = join(process.cwd(), ".jimmy-runtime/codex");
  const cwd = join(home, "chat");
  await mkdir(cwd, { recursive: true });
  const env: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: home };
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  delete env.CODEX_ACCESS_TOKEN;
  const command = executable();
  const script = /\.[cm]?js$/i.test(command);
  const client = new CodexClient(spawn(script ? process.execPath : command, [...(script ? [command] : []), "app-server", "--listen", "stdio://",
    "-c", 'model_provider="openai"', "-c", 'web_search="disabled"', "-c", "project_doc_max_bytes=0",
    ...["shell_tool", "view_image", "apps", "plugins", "multi_agent", "skill_search"].flatMap(feature => ["-c", `features.${feature}=false`]),
  ], { cwd, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }));
  try {
    await client.request("initialize", { clientInfo: { name: "jimmy", title: "Jimmy", version: "0.1.0" } });
    client.send({ method: "initialized", params: {} });
    return { client, cwd };
  } catch (error) { client.close(); throw error; }
}

let login: { client: CodexClient; authUrl: string; timer: ReturnType<typeof setTimeout> } | undefined;
let loginStarting: Promise<{ authUrl: string }> | undefined;

function finishLogin() {
  const active = login;
  login = undefined;
  if (active) { clearTimeout(active.timer); active.client.close(); }
}

export async function codexAccount() {
  const client = login?.client || (await connect()).client;
  try {
    const { account } = await client.request<Account>("account/read", { refreshToken: false });
    const signedIn = account?.type === "chatgpt";
    if (signedIn && login?.client === client) finishLogin();
    return { signedIn, plan: signedIn ? account?.planType : undefined, pending: Boolean(login), authUrl: login?.authUrl };
  } finally { if (client !== login?.client) client.close(); }
}

export function startCodexLogin() {
  if (login) return Promise.resolve({ authUrl: login.authUrl });
  loginStarting ??= beginLogin().finally(() => { loginStarting = undefined; });
  return loginStarting;
}

async function beginLogin() {
  const { client } = await connect();
  try {
    const result = await client.request<{ authUrl: string }>("account/login/start", { type: "chatgpt" });
    const url = new URL(result.authUrl);
    if (url.protocol !== "https:" || url.hostname !== "auth.openai.com") throw new Error("Codex returned an unexpected sign-in URL.");
    login = { client, authUrl: result.authUrl, timer: setTimeout(finishLogin, 10 * 60_000) };
    client.onFailure = () => { if (login?.client === client) finishLogin(); };
    client.onNotification = message => { if (message.method === "account/login/completed") finishLogin(); };
    return { authUrl: result.authUrl };
  } catch (error) { client.close(); throw error; }
}

export async function signOutCodex() {
  await loginStarting?.catch(() => {});
  finishLogin();
  const { client } = await connect();
  try { await client.request("account/logout", {}); } finally { client.close(); }
}

export async function codexChat(instructions: string, messages: { role: string; content: string }[], signal: AbortSignal) {
  const { client, cwd } = await connect();
  try {
    const { account } = await client.request<Account>("account/read", { refreshToken: false });
    if (account?.type !== "chatgpt") throw new CodexAuthenticationError("Choose Codex and sign in with ChatGPT in Jimmy first.");
    const { thread } = await client.request<{ thread: { id: string; model: string } }>("thread/start", {
      cwd, ephemeral: true, sandbox: "read-only", approvalPolicy: "never",
      ...(process.env.CODEX_MODEL ? { model: process.env.CODEX_MODEL } : {}),
      baseInstructions: instructions,
      developerInstructions: "Answer only using the supplied conversation and context. Do not use tools or read files.",
    });
    let stop = () => client.close();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let finished = false;
        let characters = 0;
        const encoder = new TextEncoder();
        const timer = setTimeout(() => fail(new Error("Codex reply timed out after 90 seconds.")), 90_000);
        const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); client.onFailure = () => {}; client.close(); };
        const fail = (error: Error) => { if (finished) return; finished = true; controller.error(error); cleanup(); };
        const abort = () => fail(new Error("Codex reply cancelled."));
        stop = () => { finished = true; cleanup(); };
        signal.addEventListener("abort", abort, { once: true });
        client.onFailure = fail;
        client.onNotification = message => {
          if (finished || message.params?.threadId !== thread.id) return;
          if (message.method === "item/agentMessage/delta" && message.params.delta) {
            characters += message.params.delta.length;
            if (characters > 100_000) { fail(new Error("Codex reply exceeded its size limit.")); return; }
            controller.enqueue(encoder.encode(message.params.delta));
          }
          if (message.method === "turn/completed") {
            if (message.params.turn?.status !== "completed") { fail(new Error(message.params.turn?.error?.message || "Codex could not complete the reply.")); return; }
            finished = true; controller.close(); cleanup();
          }
        };
        if (signal.aborted) { abort(); return; }
        void client.request("turn/start", {
          threadId: thread.id,
          input: [{ type: "text", text: JSON.stringify({ conversation: messages }) }],
          sandboxPolicy: { type: "readOnly", access: { type: "restricted", readableRoots: [cwd], includePlatformDefaults: false } },
        }).catch(error => fail(error instanceof Error ? error : new Error("Codex turn failed.")));
      },
      cancel() { stop(); },
    });
    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
  } catch (error) { client.close(); throw error; }
}
