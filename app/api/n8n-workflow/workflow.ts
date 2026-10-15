import { randomUUID } from "node:crypto";

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const nodeTypes = ["manualTrigger", "set", "httpRequest", "scheduleTrigger", "gmail", "if", "merge", "code", "stickyNote", "webhook", "respondToWebhook", "filter", "splitInBatches", "wait", "googleSheets", "googleCalendar", "telegram", "slack", "switch", "noOp"].map(type => `n8n-nodes-base.${type}`);

export const gmailReadExample = {
  name: "Gmail read-only endpoint",
  nodes: [
    { name: "Request", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [0, 0], parameters: { path: "jimmy-gmail-read", httpMethod: "GET", authentication: "headerAuth", responseMode: "lastNode", options: {} }, notes: "Connect header-auth credentials and choose a unique path before activation." },
    { name: "Read Gmail", type: "n8n-nodes-base.gmail", typeVersion: 2.1, position: [240, 0], parameters: { resource: "message", operation: "getAll", returnAll: true, simple: true, filters: { readStatus: "both" }, options: {} }, notes: "Connect Gmail OAuth credentials before testing. This draft has not been executed." },
    { name: "Fields", type: "n8n-nodes-base.set", typeVersion: 3.4, position: [480, 0], parameters: { assignments: { assignments: [
      { name: "sender", value: "={{ $json.From || $json.from || '' }}", type: "string" },
      { name: "subject", value: "={{ $json.Subject || $json.subject || '' }}", type: "string" },
      { name: "preview", value: "={{ $json.snippet || '' }}", type: "string" },
    ] }, options: {} } },
  ],
  connections: [{ from: 0, to: 1, output: 0, input: 0 }, { from: 1, to: 2, output: 0, input: 0 }],
};

export function validateWorkflow(value: unknown, prompt = "") {
  if (!record(value) || typeof value.name !== "string" || !value.name.trim() || value.name.length > 128 ||
      !Array.isArray(value.nodes) || !value.nodes.length || value.nodes.length > 20 || !Array.isArray(value.connections) || value.connections.length > 100) {
    throw new Error("Qwen returned an invalid workflow. Try a simpler request.");
  }
  const names = new Set<string>();
  const nodes = value.nodes.map(node => {
    if (!record(node) || typeof node.name !== "string" || !node.name.trim() || node.name.length > 100 || names.has(node.name) ||
        typeof node.type !== "string" || !nodeTypes.includes(node.type) ||
        typeof node.typeVersion !== "number" || !Number.isFinite(node.typeVersion) || node.typeVersion <= 0 ||
        !Array.isArray(node.position) || node.position.length !== 2 || !node.position.every(number => typeof number === "number" && Number.isFinite(number)) || !record(node.parameters)) {
      throw new Error("Qwen returned an invalid node. Try a simpler workflow request.");
    }
    names.add(node.name);
    const parameters = { ...node.parameters };
    if (node.type === "n8n-nodes-base.set" && Array.isArray(parameters.assignments)) {
      parameters.assignments = { assignments: parameters.assignments };
    }
    const typeVersion = node.type === "n8n-nodes-base.set" ? 3.4 : node.type === "n8n-nodes-base.manualTrigger" ? 1 : node.typeVersion;
    return { id: randomUUID(), name: node.name, type: node.type, typeVersion,
      position: node.position, parameters,
      ...(typeof node.notes === "string" ? { notes: node.notes.slice(0, 2000), notesInFlow: true } : {}),
    };
  });
  const connections = Object.create(null) as Record<string, { main: { node: string; type: string; index: number }[][] }>;
  for (const edge of value.connections) {
    if (!record(edge) || ![edge.from, edge.to, edge.output, edge.input].every(index => Number.isInteger(index) && (index as number) >= 0) ||
        (edge.from as number) >= nodes.length || (edge.to as number) >= nodes.length || (edge.output as number) > 10 || (edge.input as number) > 10) {
      throw new Error("The workflow has a connection to an unknown node or output.");
    }
    const source = nodes[edge.from as number].name;
    const output = edge.output as number;
    const branches = (connections[source] ??= { main: [] }).main;
    while (branches.length <= output) branches.push([]);
    branches[output].push({ node: nodes[edge.to as number].name, type: "main", index: edge.input as number });
  }
  const executable = nodes.filter(node => node.type !== "n8n-nodes-base.stickyNote");
  const triggers = executable.filter(node => ["manualTrigger", "webhook", "scheduleTrigger"].some(type => node.type === `n8n-nodes-base.${type}`));
  if (!triggers.length) throw new Error("The workflow needs a supported trigger.");
  const reachable = new Set(triggers.map(node => node.name));
  const pending = [...reachable];
  while (pending.length) {
    for (const edge of connections[pending.shift()!]?.main.flat() || []) {
      if (!reachable.has(edge.node)) { reachable.add(edge.node); pending.push(edge.node); }
    }
  }
  if (executable.some(node => !reachable.has(node.name)) || executable.length > 1 && triggers.some(node => !connections[node.name]?.main.flat().length)) {
    throw new Error(`The workflow has disconnected nodes. Unreachable node indices: ${nodes.flatMap((node, index) => !reachable.has(node.name) && node.type !== "n8n-nodes-base.stickyNote" ? [index] : []).join(", ") || "a trigger has no outgoing edge"}. Node indices: ${nodes.map((node, index) => `${index}=${node.name}`).join(", ")}. Return every necessary connection using these indices.`);
  }
  if (/\b(?:webhook|on-demand)\b/i.test(prompt) && !nodes.some(node => node.type === "n8n-nodes-base.webhook")) throw new Error("The workflow needs the approved on-demand webhook, not a manual trigger.");
  if (/\bauthenticated\b/i.test(prompt) && /\bwebhook\b/i.test(prompt) && nodes.some(node => node.type === "n8n-nodes-base.webhook" && !["headerAuth", "basicAuth", "jwtAuth"].includes(String(node.parameters.authentication)))) throw new Error("The workflow must configure the requested webhook authentication, with credentials left for the user to connect.");
  if (/\bgmail\b/i.test(prompt) && /\b(?:read|retrieve|fetch|get|search)\b/i.test(prompt) && !/\bhttp(?: request)?\b/i.test(prompt)) {
    const gmail = nodes.filter(node => node.type === "n8n-nodes-base.gmail");
    if (!gmail.some(node => node.parameters.resource === "message" && ["get", "getAll"].includes(String(node.parameters.operation)))) throw new Error("The workflow must use the native Gmail message node for Gmail retrieval.");
    for (const node of gmail) {
      const parameters = node.parameters;
      if (parameters.operation !== "getAll") continue;
      if (/\ball\b/i.test(prompt) && parameters.returnAll !== true) throw new Error("The workflow must retrieve all matching Gmail messages with returnAll: true.");
      if (/\b(?:all (?:gmail )?(?:messages|emails)|read and unread|unread and read|both read)\b/i.test(prompt) &&
        (!record(parameters.filters) || parameters.filters.readStatus !== "both")) throw new Error("The workflow must explicitly set Gmail filters.readStatus to both for read and unread messages.");
    }
  }
  // n8n creates an unpublished draft. Do not forward activation, credentials, or model-generated settings.
  return { name: value.name.trim(), nodes, connections, settings: { executionOrder: "v1", timezone: "Asia/Manila" } };
}

export const workflowSchema = {
  type: "object", required: ["name", "nodes", "connections"],
  properties: {
    name: { type: "string" },
    nodes: { type: "array", items: { type: "object", required: ["name", "type", "typeVersion", "position", "parameters"], properties: {
      name: { type: "string" }, type: { type: "string", enum: nodeTypes }, typeVersion: { type: "number" },
      position: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
      parameters: { type: "object" }, notes: { type: "string" },
    } } },
    connections: { type: "array", minItems: 0, items: { type: "object", required: ["from", "to", "output", "input"], properties: {
      from: { type: "integer" }, to: { type: "integer" }, output: { type: "integer" }, input: { type: "integer" },
    } } },
  },
};
