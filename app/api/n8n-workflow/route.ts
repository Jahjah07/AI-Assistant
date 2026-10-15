import { protectApiRequest } from "../_security";
import { acquireConcurrency, concurrencyLimitResponse, fetchWithTimeout, readJsonObject, readResponseText, UpstreamTimeoutError } from "../_limits";
import { gmailReadExample, validateWorkflow, workflowSchema } from "./workflow";
import { workflowReferences } from "../knowledge/store";
import { keepModelsLoaded } from "../model-settings/settings";
import { documentationForTask } from "../knowledge/research";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const securityError = protectApiRequest(request, { scope: "n8n-create", limit: 10 });
  if (securityError) return securityError;
  const body = await readJsonObject(request, 8192);
  if (!body.ok) return body.response;
  if (body.value.confirmed !== true) {
    return Response.json({ error: "Review the plan and say Create it before saving a workflow." }, { status: 400 });
  }
  const prompt = body.value.prompt;
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 4000) {
    return Response.json({ error: "Describe the workflow in 1 to 4,000 characters." }, { status: 400 });
  }
  const key = process.env.N8N_API_KEY?.trim();
  if (!key) return Response.json({ error: "Add N8N_API_KEY to .env.local and restart Jimmy to connect n8n." }, { status: 503 });
  let base: URL;
  try {
    base = new URL((process.env.N8N_URL || "http://localhost:5678").replace(/\/api\/v1\/?$/, "").replace(/\/$/, "") + "/");
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error();
  } catch { return Response.json({ error: "Set N8N_URL to the n8n editor's HTTP or HTTPS address." }, { status: 503 }); }
  const release = acquireConcurrency("n8n-create", 1);
  if (!release) return concurrencyLimitResponse();
  let saving = false;
  try {
    const model = process.env.OLLAMA_MODEL || "qwen3:4b-instruct";
    const references = await workflowReferences(prompt, request.signal);
    const externalDocs = /\b(?:api|sdk|http)\b/i.test(prompt) ? await documentationForTask([{ role: "user", content: prompt }], request.signal) : "";
    // A webhook → Gmail → field mapping needs at least two connections.
    const readEndpoint = /\bgmail\b/i.test(prompt) && /\b(?:webhook|on-demand)\b/i.test(prompt) && /\b(?:retrieve|fetch|get|read|search)\b/i.test(prompt) && /\b(?:preview|subject|sender)\b/i.test(prompt);
    const schema = { ...workflowSchema, properties: { ...workflowSchema.properties, connections: { ...workflowSchema.properties.connections, minItems: readEndpoint ? 2 : 0 } } };
    const generate = async (previous?: unknown, correction?: string) => {
      const generated = await fetchWithTimeout("http://127.0.0.1:11434/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, stream: false, ...(model.startsWith("qwen3:") ? { think: false } : {}),
          keep_alive: await keepModelsLoaded() ? -1 : "5m", format: schema, options: { temperature: 0, num_ctx: 6144, num_predict: 3000 },
          messages: [
            { role: "system", content: `Generate an n8n 2.x workflow draft as JSON with name, nodes, connections. Use at most 20 real n8n-nodes-base nodes, and their actual parameter schemas. Never include credentials, API keys, activation flags, or invented credential IDs. Put instructions for missing credentials or user-specific values in node notes. Prefer a small complete workflow. For a simple test use manualTrigger v1 then set v3.4 with assignments.assignments [{name:"message",value:"Hello from Jimmy",type:"string"}]. Positions are [x,y], spaced 240 apart. Connections must be an array of edges using zero-based indices into the nodes array. For example [{"from":0,"to":1,"output":0,"input":0}] connects the first node to the second. Use output 0 normally; IF false branches use output 1. Common nodes: manualTrigger v1 parameters {}, set v3.4 assignments, httpRequest v4.2 method/url/options, scheduleTrigger v1.2 rule.interval, gmail v2.1 resource/operation. Example of a complete simple workflow: {"name":"Jimmy test","nodes":[{"name":"Start","type":"n8n-nodes-base.manualTrigger","typeVersion":1,"position":[0,0],"parameters":{}},{"name":"Hello","type":"n8n-nodes-base.set","typeVersion":3.4,"position":[240,0],"parameters":{"assignments":{"assignments":[{"name":"message","value":"Hello from Jimmy","type":"string"}]},"options":{}}}],"connections":[{"from":0,"to":1,"output":0,"input":0}]}. For Gmail retrieval, preserve the approved read/unread scope. When all matching messages are requested, use returnAll: true for Gmail getAll or implement pagination through every page; never add an unrequested total result cap. A page size is allowed only when subsequent pages are retrieved too. Adapt the nodes and parameters to the requested task. Do not use placeholder nodes that claim a task is implemented. Return only valid JSON.` },
            { role: "system", content: `${references}\nUse native Gmail for message retrieval. Gmail v2.1 example parameters: {"resource":"message","operation":"getAll","returnAll":true,"simple":true,"filters":{"readStatus":"both"}}. Use readStatus unread or read only when the approved plan requests it. Use webhook v2 with path, httpMethod, authentication and responseMode, connected to actions and respondToWebhook when needed. Credentials remain for the user to connect. Never substitute disconnected placeholder nodes.` },
            ...(/\bgmail\b/i.test(prompt) ? [{ role: "user", content: "Create an authenticated on-demand Gmail webhook to retrieve all read and unread messages and return sender, subject and preview. I will connect credentials." }, { role: "assistant", content: JSON.stringify(gmailReadExample) }] : []),
            ...(externalDocs ? [{ role: "system", content: externalDocs }] : []),
            { role: "user", content: prompt.trim() },
            ...(correction ? [{ role: "assistant", content: JSON.stringify(previous).slice(0, 16000) }, { role: "user", content: `Structural validation failed: ${correction} Repair the JSON while preserving my approved requirements. Do not claim it ran.` }] : []),
          ],
        }),
      }, 180_000, request.signal);
      if (!generated.ok) throw new Error("Qwen could not generate the workflow. Check Ollama.");
      const result = JSON.parse(await readResponseText(generated, 150_000, 180_000, request.signal)) as { message?: { content?: string }; done_reason?: string };
      if (!result.message?.content || result.done_reason === "length") throw new Error("Workflow generation was incomplete. Try a simpler request.");
      let raw: unknown;
      try { raw = JSON.parse(result.message.content); }
      catch { throw new Error("Qwen did not return valid workflow JSON. Try again with a simpler request."); }
      return raw;
    };
    let raw = await generate();
    let workflow;
    try { workflow = validateWorkflow(raw, prompt); }
    catch (error) {
      raw = await generate(raw, error instanceof Error ? error.message : "Invalid workflow");
      workflow = validateWorkflow(raw, prompt);
    }
    request.signal.throwIfAborted();
    saving = true;
    const saved = await fetchWithTimeout(new URL("api/v1/workflows", base), {
      method: "POST", redirect: "error", headers: { "Content-Type": "application/json", "X-N8N-API-KEY": key },
      body: JSON.stringify(workflow),
    }, 30_000, request.signal);
    if (!saved.ok) {
      const error = saved.status === 401 || saved.status === 403 ? "n8n rejected the API key. Check its expiry and workflow creation permission."
        : `n8n rejected the generated draft (HTTP ${saved.status}). Try a simpler workflow request.`;
      return Response.json({ error }, { status: 502 });
    }
    const created = JSON.parse(await readResponseText(saved, 250_000, 30_000, request.signal)) as { id?: string; name?: string; active?: boolean };
    if (!created.id || created.active !== false) throw new Error("n8n did not confirm an inactive draft. Check its workflow list before retrying.");
    return Response.json({ id: created.id, name: created.name || workflow.name, active: false,
      nodeCount: workflow.nodes.length, url: new URL(`workflow/${encodeURIComponent(created.id)}`, base).href,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = saving ? "n8n did not confirm creation. Check its workflow list before retrying to avoid a duplicate."
      : error instanceof UpstreamTimeoutError ? "Workflow generation timed out. Try a smaller workflow."
      : error instanceof Error && /^(Qwen|Workflow generation|The workflow|Could not learn|Knowledge)/.test(error.message) ? error.message
      : "Could not create the workflow. Check local Ollama and n8n.";
    return Response.json({ error: message }, { status: 503 });
  } finally { release(); }
}
