import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { acquireConcurrency } from "../_limits";
import { ToolError } from "../../lib/n8n-tool-routing";
import type { Tool } from "./store";

type Window = { after: number; until: number; pageToken: string };
type Check = { lastCheckedAt?: number; pending?: Window };
const file = path.join(process.cwd(), "storage", "gmail-checks.json");
const timestamp = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const queryFor = (window: Window) => `is:unread after:${window.after - 1} before:${window.until}`;

async function readChecks(): Promise<Record<string, Check>> {
  try {
    const raw = await readFile(file, "utf8");
    if (raw.length > 512000) throw new Error();
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data) || Object.entries(data).some(([key, check]) => {
      const value = check as Check;
      return !/^[a-f0-9]{64}$/.test(key) || !value || typeof value !== "object" || Array.isArray(value) || value.lastCheckedAt === undefined && value.pending === undefined ||
        value.lastCheckedAt !== undefined && !timestamp(value.lastCheckedAt) ||
        value.pending !== undefined && (!timestamp(value.pending.after) || !timestamp(value.pending.until) || value.pending.after > value.pending.until || typeof value.pending.pageToken !== "string" || !value.pending.pageToken || value.pending.pageToken.length > 2000);
    })) throw new Error();
    return data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new ToolError("Could not read Gmail's saved check times. No check history was reset or overwritten.");
  }
}

export async function beginGmailCheck(tool: Tool, fallbackQuery: string, signal: AbortSignal, continuation?: unknown, now = new Date()) {
  const release = acquireConcurrency("gmail-check", 1);
  if (!release) throw new ToolError("An email check is already in progress. Wait for Jimmy's reply before checking again.");
  let ended = false;
  const cancel = () => { if (!ended) { ended = true; signal.removeEventListener("abort", cancel); release(); } };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    const checks = await readChecks();
    const key = createHash("sha256").update(JSON.stringify([process.env.N8N_URL || "http://localhost:5678", tool.id, tool.path, tool.encryptedSecret])).digest("hex");
    const previous = checks[key] || {};
    const cursor = continuation as { query?: unknown; pageToken?: unknown } | null;
    if (continuation !== undefined && (!previous.pending || cursor?.query !== queryFor(previous.pending) || cursor?.pageToken !== previous.pending.pageToken)) { cancel(); return null; }
    const after = previous.lastCheckedAt ?? Number(fallbackQuery.match(/\bafter:(\d+)/)?.[1]);
    const window: Window = previous.pending || { after, until: Math.floor(now.getTime() / 1000), pageToken: "" };
    if (!timestamp(window.after) || !timestamp(window.until) || window.after > window.until) throw new ToolError("The saved email check time is ahead of your computer's clock. Check its date and time before trying again.");
    const query = queryFor(window);
    return {
      input: { query, pageToken: window.pageToken, pageSize: 20 },
      context: `Routine incremental email check. Window: ${new Date(window.after * 1000).toISOString()} up to ${new Date(window.until * 1000).toISOString()}. Explain these times in Asia/Manila. ${previous.pending ? "Resuming remaining pages from the previous check first, so unseen older results are not skipped. After finishing, check again for newer arrivals." : previous.lastCheckedAt ? "Only unread messages received since the last completed routine check are requested." : "First routine check: start from Monday of this week."}`,
      cancel,
      complete: async (page: Record<string, unknown>) => {
        try {
          if (ended) throw new ToolError("The email check was cancelled; its saved time was not advanced.");
          signal.throwIfAborted();
          checks[key] = page.nextPageToken ? { ...previous, pending: { ...window, pageToken: page.nextPageToken as string } } : { lastCheckedAt: window.until };
          await mkdir(path.dirname(file), { recursive: true });
          await writeFile(`${file}.tmp`, JSON.stringify(checks, null, 2), { mode: 0o600 });
          await rename(`${file}.tmp`, file);
        } finally { cancel(); }
      },
    };
  } catch (error) { cancel(); throw error; }
}
