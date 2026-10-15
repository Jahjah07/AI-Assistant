import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type Tool = { id: string; name: string; path: string; method: "GET" | "POST"; phrases: string[]; enabled: boolean; headerName: string; encryptedSecret: string; parameters: Record<string, string | number | boolean> };
const file = path.join(process.cwd(), "storage", "n8n-tools.json");
const gmail: Tool = { id: "gmail", name: "Gmail", path: "gmail/messages", method: "GET", enabled: false, headerName: "", encryptedSecret: "", parameters: {}, phrases: ["check my emails", "get my emails", "read my emails", "check my gmail", "get my gmail", "read my gmail", "check my email", "get my email", "read my email", "get my gmails"] };
let writing = false;

function key() {
  const secret = process.env.VOICE_SERVICE_SECRET || "";
  if (secret.length < 32) throw new Error("Configure VOICE_SERVICE_SECRET before storing tool credentials.");
  return createHash("sha256").update(`jimmy-n8n-tools:${secret}`).digest();
}
function encrypt(value: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, encrypted, cipher.getAuthTag()]).toString("base64");
}
export function toolSecret(tool: Tool) {
  try {
    const bytes = Buffer.from(tool.encryptedSecret, "base64"), decipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(-16));
    return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString("utf8");
  } catch { throw new Error(`Re-enter ${tool.name}'s webhook secret in Settings → n8n tools. The encryption key may have changed.`); }
}
export async function readTools(): Promise<Tool[]> {
  try {
    const data = JSON.parse(await readFile(file, "utf8"));
    if (!Array.isArray(data) || data.length > 20) throw new Error("Invalid n8n tool settings.");
    return data;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return [gmail]; throw error; }
}
export function publicTool(tool: Tool) {
  const { encryptedSecret, ...visible } = tool;
  return { ...visible, hasSecret: Boolean(encryptedSecret) };
}
export function parameters(input: unknown): Tool["parameters"] {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length > 32 || Object.entries(input).some(([name, value]) => !/^[a-z][a-z0-9_]{0,63}$/i.test(name) || ["constructor", "prototype"].includes(name) || !(typeof value === "string" && value.length <= 2000 || typeof value === "number" && Number.isFinite(value) || typeof value === "boolean"))) throw new Error("Parameters must be a JSON object with up to 32 named text, number or boolean values.");
  return input as Tool["parameters"];
}
export async function changeTool(body: Record<string, unknown>) {
  if (writing) throw new Error("Tool settings are already changing. Try again.");
  writing = true;
  try {
    const tools = await readTools();
    if (body.action === "delete") {
      if (typeof body.id !== "string" || !tools.some(tool => tool.id === body.id)) throw new Error("Choose an existing tool.");
    } else if (body.action === "save") {
      const { name, path: webhookPath, method, phrases, enabled, headerName, secret } = body;
      if (typeof name !== "string" || !/^[a-z][a-z0-9 -]{0,47}$/i.test(name) || typeof webhookPath !== "string" || !/^[a-z0-9_-]+(?:\/[a-z0-9_-]+)*$/i.test(webhookPath) || webhookPath.length > 240 || !["GET", "POST"].includes(String(method)) || typeof enabled !== "boolean" || !Array.isArray(phrases) || !phrases.length || phrases.length > 10 || phrases.some(phrase => typeof phrase !== "string" || phrase.length < 3 || phrase.length > 80) || typeof headerName !== "string" || headerName && (!/^[a-z0-9-]{1,80}$/i.test(headerName) || /^(?:host|content-length|connection|transfer-encoding|cookie)$/i.test(headerName)) || typeof secret !== "string" || secret.length > 4096 || /[\r\n]/.test(secret)) throw new Error("Check the tool name, webhook path, method, phrases and authentication fields.");
      const existing = tools.find(tool => tool.id === body.id);
      if (body.id && !existing) throw new Error("This tool no longer exists. Refresh settings.");
      if (tools.some(tool => tool.id !== existing?.id && tool.name.toLowerCase() === name.toLowerCase())) throw new Error("Give each tool a different name.");
      const encryptedSecret = secret ? encrypt(secret) : existing?.encryptedSecret || "";
      if (enabled && (!headerName || !encryptedSecret)) throw new Error("Enter the webhook's authentication header name and secret before enabling the tool.");
      const tool: Tool = { id: existing?.id || randomUUID(), name, path: webhookPath, method: method as Tool["method"], phrases: phrases.map(phrase => phrase.trim().toLowerCase()), enabled, headerName, encryptedSecret, parameters: parameters(body.parameters ?? {}) };
      if (existing) tools.splice(tools.indexOf(existing), 1, tool); else tools.push(tool);
      if (tools.length > 20) throw new Error("Keep at most 20 tools.");
    } else throw new Error("Choose save or delete.");
    const next = body.action === "delete" ? tools.filter(tool => tool.id !== body.id) : tools;
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 });
    await rename(`${file}.tmp`, file);
    return next.map(publicTool);
  } finally { writing = false; }
}
