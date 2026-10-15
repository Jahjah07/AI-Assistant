import { protectApiRequest } from "../_security";
import { acquireConcurrency, concurrencyLimitResponse, fetchWithTimeout, readJsonObject, readResponseText } from "../_limits";
import type { PlanMessage } from "../../lib/planning";
import { knowledgeContext } from "../knowledge/store";
import { keepModelsLoaded } from "../model-settings/settings";
import { documentationForTask } from "../knowledge/research";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const securityError = protectApiRequest(request, { scope: "plan", limit: 30 });
  if (securityError) return securityError;
  const body = await readJsonObject(request, 32_000);
  if (!body.ok) return body.response;
  const { messages, workflow } = body.value;
  if (typeof workflow !== "boolean" || !Array.isArray(messages) || !messages.length || messages.length > 16 ||
      !messages.every(message => message && ["user", "assistant"].includes(message.role) && typeof message.content === "string" && message.content.trim() && message.content.length <= 4000)) {
    return Response.json({ error: "Provide a valid planning conversation." }, { status: 400 });
  }
  const history = messages as PlanMessage[];
  const release = acquireConcurrency("plan", 1);
  if (!release) return concurrencyLimitResponse();
  try {
    const model = process.env.OLLAMA_MODEL || "qwen3:4b-instruct";
    const documentation = !workflow || /\b(?:api|sdk|http)\b/i.test(history.at(-1)?.content || "") ? await documentationForTask(history, request.signal) : "";
    const response = await fetchWithTimeout("http://127.0.0.1:11434/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, stream: false, ...(model.startsWith("qwen3:") ? { think: false } : {}), keep_alive: await keepModelsLoaded() ? -1 : "5m",
        format: { type: "object", required: ["question", "summary"], properties: { question: { type: "string" }, summary: { type: "string" } } },
        options: { temperature: 0, num_ctx: 4096, num_predict: 600 },
        messages: [{ role: "system", content: `You are Jimmy's planning assistant. You cannot execute actions. ${workflow ? "Plan an inactive n8n workflow draft. Gmail credentials must be connected by the user in n8n; creating a workflow does not connect Jimmy to Gmail." : "Help clarify and plan the requested task; no execution tools are available in this planning conversation."} Return JSON with question and summary. Ask ONE concise necessary question at a time if important requirements are missing; set summary to empty. For email workflows clarify unread versus all, on-demand versus scheduled, and what results the user wants only if unspecified. Never invent a five-message limit or any other fixed total message limit. A pagination page size is not a total limit: continue through every page until all matching messages have been retrieved. Respect corrections such as "all messages" as including both read and unread, overriding earlier unread-only assumptions. If wording is ambiguous, ask what the user means instead of inventing an unread filter. If the user explicitly said all unread messages, never ask whether they want all or a subset. If they specified sender, subject and preview, never ask which fields to return. A complete request needs a summary immediately, not another question. Respect 'all' and propose pagination when needed. Never ask for passwords or API keys. Do not repeat answered questions or ask about cosmetic choices such as the workflow name. Once requirements are clear, set question to empty and summarize the agreed plan in under 120 words, including stated assumptions. Do not claim anything was created. ${history.filter(message => message.role === "user").length >= 6 ? "Summarize now with explicit assumptions instead of asking further questions." : ""}` },
          { role: "system", content: await knowledgeContext(history) || "No relevant saved reference knowledge." },
          ...(documentation ? [{ role: "system", content: documentation }] : []),
          { role: "user", content: "Create an n8n workflow with an authenticated on-demand webhook that retrieves all unread Gmail messages with pagination and returns sender, subject and preview as JSON. I will connect credentials in n8n." },
          { role: "assistant", content: JSON.stringify({ question: "", summary: "Create an inactive n8n draft: an authenticated webhook retrieves all unread Gmail messages with pagination and returns sender, subject and preview as JSON. The user will connect Gmail OAuth and webhook credentials in n8n before activation." }) },
          ...history],
      }),
    }, 90_000, request.signal);
    if (!response.ok) throw new Error();
    const result = JSON.parse(await readResponseText(response, 20_000, 90_000, request.signal)) as { message?: { content?: string }; done_reason?: string };
    if (!result.message?.content || result.done_reason === "length") throw new Error();
    const plan = JSON.parse(result.message.content) as { question?: unknown; summary?: unknown };
    if (typeof plan.question !== "string" || typeof plan.summary !== "string") throw new Error();
    const question = plan.question.trim(), summary = plan.summary.trim();
    if ((!question && !summary) || (question && summary) || question.length > 600 || summary.length > 2500) throw new Error();
    return Response.json({ question, summary }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Jimmy could not prepare the plan. Try again or cancel the plan." }, { status: 503 }); }
  finally { release(); }
}
