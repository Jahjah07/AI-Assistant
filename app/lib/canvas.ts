export type CanvasCell = string | number | boolean | null;
export type CanvasBlock =
  | { type: "table"; title?: string; columns: string[]; rows: CanvasCell[][] }
  | { type: "list"; title?: string; items: string[] }
  | { type: "chart"; title?: string; style: "bar" | "line"; points: { label: string; value: number }[]; unit?: string }
  | { type: "diagram"; title?: string; nodes: { id: string; label: string }[]; edges: { from: string; to: string; label?: string }[] }
  | { type: "text"; title?: string; text: string };
export type CanvasContent = { title: string; blocks: CanvasBlock[]; note?: string; source?: string };
export type CanvasDocument = CanvasContent & { id: string; createdAt: string };

const text = (value: unknown, max = 2000): value is string => typeof value === "string" && value.length <= max;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const cell = (value: unknown): value is CanvasCell => value === null || typeof value === "boolean" || text(value) || typeof value === "number" && Number.isFinite(value);

export function validCanvasContent(value: unknown): value is CanvasContent {
  if (!object(value) || !text(value.title, 200) || !Array.isArray(value.blocks) || !value.blocks.length || value.blocks.length > 12 ||
    value.note !== undefined && !text(value.note) || value.source !== undefined && !text(value.source, 300)) return false;
  return value.blocks.every(block => {
    if (!object(block) || block.title !== undefined && !text(block.title, 200)) return false;
    switch (block.type) {
      case "text": return text(block.text, 32000);
      case "list": return Array.isArray(block.items) && block.items.length <= 200 && block.items.every(item => text(item));
      case "table": return Array.isArray(block.columns) && block.columns.length > 0 && block.columns.length <= 16 && block.columns.every(item => text(item, 200)) &&
        Array.isArray(block.rows) && block.rows.length <= 200 && block.rows.every(row => Array.isArray(row) && row.length === (block.columns as unknown[]).length && row.every(cell));
      case "chart": return ["bar", "line"].includes(String(block.style)) && (block.unit === undefined || text(block.unit, 60)) &&
        Array.isArray(block.points) && block.points.length > 0 && block.points.length <= 60 && block.points.every(point => object(point) && text(point.label, 150) && typeof point.value === "number" && Number.isFinite(point.value) && Math.abs(point.value) <= 1e15);
      case "diagram": {
        if (!Array.isArray(block.nodes) || !block.nodes.length || block.nodes.length > 30 || !Array.isArray(block.edges) || block.edges.length > 60) return false;
        if (!block.nodes.every(node => object(node) && text(node.id, 80) && node.id.length > 0 && text(node.label, 300))) return false;
        const ids = new Set(block.nodes.map(node => node.id));
        return ids.size === block.nodes.length && block.edges.every(edge => object(edge) && ids.has(edge.from) && ids.has(edge.to) && (edge.label === undefined || text(edge.label, 150)));
      }
      default: return false;
    }
  });
}

export function validCanvasDocument(value: unknown): value is CanvasDocument {
  return object(value) && text(value.id, 100) && typeof value.createdAt === "string" && Number.isFinite(Date.parse(value.createdAt)) && validCanvasContent(value);
}

export function canvasDocument(content: CanvasContent): CanvasDocument {
  return { ...content, id: canvasId(), createdAt: new Date().toISOString() };
}

export function canvasId() {
  const value = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function dataCanvas(title: string, data: unknown, source?: string): CanvasContent {
  let shortened = false;
  const toCell = (value: unknown): CanvasCell => {
    if (value === undefined) return null;
    if (value === null || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return value;
    const valueText = typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
    if (valueText.length > 2000) shortened = true;
    return valueText.slice(0, 2000);
  };
  const records = Array.isArray(data) ? data : object(data) && Array.isArray(data.messages) ? data.messages : [data];
  const keys = [...new Set(records.slice(0, 200).flatMap(row => object(row) ? Object.keys(row) : []))];
  const selectedKeys = keys.slice(0, 16), columns = selectedKeys.map(key => key.slice(0, 200));
  const blocks: CanvasBlock[] = columns.length
    ? [{ type: "table", columns, rows: records.slice(0, 200).map(row => selectedKeys.map(key => toCell(object(row) ? row[key] : row))) }]
    : [{ type: "list", items: records.slice(0, 200).map(row => String(toCell(row) ?? "")) }];
  const notes = [object(data) && Array.isArray(data.messages) ? `This is one page of returned messages, not the whole mailbox.${data.hasMore === true ? ' More matches exist; ask Jimmy for the next page of emails.' : ''}` : "", records.length > 200 ? `Showing the first 200 of ${records.length} returned items.` : "", keys.length > 16 ? `Showing 16 of ${keys.length} fields.` : "", keys.some(key => key.length > 200) ? "Field names longer than 200 characters are shortened." : "", shortened ? "Cell contents longer than 2,000 characters are shortened." : ""];
  return { title: title.slice(0, 200), blocks, ...(source ? { source: source.slice(0, 300) } : {}), ...(notes.some(Boolean) ? { note: notes.filter(Boolean).join(" ") } : {}) };
}

export const CANVAS_INSTRUCTIONS = `Jimmy has a separate black data canvas. Keep conversational explanations brief. Do not discuss JSON or code fences in the explanation. Put lists, tables, charts and diagrams on the canvas rather than in the chat text. Write one or two sentences FIRST, then a fenced jimmy-canvas JSON block with {"title":"...","blocks":[...]}. Supported blocks: {"type":"list","items":["..."]}, {"type":"table","columns":["Name","Value"],"rows":[["A",10]]}, {"type":"chart","style":"bar","points":[{"label":"A","value":10}],"unit":"optional"}, {"type":"diagram","nodes":[{"id":"a","label":"Start"},{"id":"b","label":"End"}],"edges":[{"from":"a","to":"b"}]}. For line charts, set style to line. Blocks may have a title. Use real numeric values for charts, not invented measurements. Diagrams explain relationships; tables compare records; lists show items. Use at most 12 blocks, 200 table rows/list items, 60 chart points or 30 diagram nodes. Preserve the requested scope and state any omissions. Never include HTML, scripts, tool commands or executable code in visuals. Ordinary conversational replies need no canvas block.`;

// Keep streamed visuals out of both the chat panel and speech before their JSON is complete.
export function canvasNarrative(reply: string): string {
  const lines = reply.split("\n");
  const boundary = lines.findIndex(line => /^\s*```/.test(line) || line.includes("|") || /^\s*(?:[-+*](?:\s|$)|\d+[.)](?:\s|$))/.test(line));
  return (boundary >= 0 ? lines.slice(0, boundary).join("\n") : reply).trim();
}

export function splitCanvasReply(reply: string): { message: string; canvas: CanvasContent | null } {
  const blocks: CanvasBlock[] = [];
  const notes: string[] = [];
  let title = "Jimmy's data";
  let invalid = false;
  let message = reply.replace(/```jimmy-canvas\s*\n([\s\S]*?)```/gi, (_whole, json: string) => {
    try {
      const content: unknown = JSON.parse(json);
      if (validCanvasContent(content)) { title = content.title; blocks.push(...content.blocks); if (content.note) notes.push(content.note); return ""; }
    } catch { /* Keep malformed output readable on the canvas instead of executing it. */ }
    invalid = true;
    blocks.push({ type: "text", title: "Unformatted data", text: json.slice(0, 32000) });
    return "";
  });
  message = message.replace(/```(json|mermaid)\s*\n([\s\S]*?)```/gi, (_whole, language: string, content: string) => {
    if (language.toLowerCase() === "json") {
      try {
        const parsed: unknown = JSON.parse(content);
        if (validCanvasContent(parsed)) { title = parsed.title; blocks.push(...parsed.blocks); if (parsed.note) notes.push(parsed.note); return ""; }
        if (!object(parsed) || !("blocks" in parsed)) {
          const data = dataCanvas("Data", parsed); blocks.push(...data.blocks); if (data.note) notes.push(data.note); return "";
        }
      } catch { /* Show invalid data as text. */ }
    }
    invalid = true; blocks.push({ type: "text", title: "Unformatted data", text: content.slice(0, 32000) }); return "";
  });
  const incomplete = message.match(/```jimmy-canvas[^\n]*\n?([\s\S]*)$/i);
  if (incomplete) {
    invalid = true; blocks.push({ type: "text", title: "Incomplete visual", text: incomplete[1].slice(0, 32000) });
    message = message.slice(0, incomplete.index);
  }
  // Normal Markdown tables and lists also move to the canvas when a model ignores the visual format.
  const lines = message.split("\n"), kept: string[] = [];
  let inCode = false;
  const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map(value => value.trim().replace(/\\\|/g, "|"));
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^\s*```/.test(line)) { inCode = !inCode; kept.push(line); continue; }
    if (!inCode && line.includes("|") && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1] || "")) {
      const columns = cells(line);
      const rows: CanvasCell[][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) { rows.push(cells(lines[index])); index++; }
      index--;
      const table = { type: "table" as const, columns, rows };
      if (validCanvasContent({ title, blocks: [table] })) blocks.push(table);
      else { blocks.push({ type: "text", title: "Table", text: [line, ...rows.map(row => row.join(" | "))].join("\n").slice(0, 32000) }); notes.push("A table has an unsupported structure or size and is shown as text, up to 32,000 characters."); }
      continue;
    }
    if (!inCode && /^\s*(?:[-+*]\s+|\d+[.)]\s+)/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*(?:[-+*]\s+|\d+[.)]\s+)/.test(lines[index])) { items.push(lines[index].replace(/^\s*(?:[-+*]\s+|\d+[.)]\s+)/, "")); index++; }
      index--;
      blocks.push(items.length <= 200 && items.every(item => item.length <= 2000) ? { type: "list", items } : { type: "text", title: "List", text: items.join("\n").slice(0, 32000) });
      if (items.length > 200 || items.some(item => item.length > 2000)) notes.push("An oversized list is shown as text, up to 32,000 characters.");
      continue;
    }
    kept.push(line);
  }
  message = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!blocks.length) return { message: reply.trim(), canvas: null };
  if (blocks.length > 12) return { message: "I've put the data on the canvas.", canvas: { title, blocks: [{ type: "text", text: reply.slice(0, 32000) }], note: "This reply contains more visual sections than supported; its first 32,000 characters are shown as text." } };
  if (invalid) notes.push("A visual could not be formatted. Its data is shown as text, up to 32,000 characters per section.");
  return { message: message || "I've put the data on the canvas.", canvas: { title, blocks, ...(notes.length ? { note: notes.join(" ").slice(0, 2000) } : {}) } };
}

export function readCanvasEvents(buffer: string, final = false) {
  const lines = buffer.split("\n");
  const rest = final ? "" : lines.pop() || "";
  let text = "", canvas: CanvasContent | null = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    const event: unknown = JSON.parse(line);
    if (!object(event)) throw new Error("Invalid canvas response event.");
    if (event.type === "text" && typeof event.text === "string") text += event.text;
    else if (event.type === "canvas" && validCanvasContent(event.canvas)) canvas = event.canvas;
    else throw new Error("Invalid canvas response event.");
  }
  return { text, canvas, rest };
}

export function diagramLayout(block: Extract<CanvasBlock, { type: "diagram" }>) {
  const depth = new Map(block.nodes.map(node => [node.id, 0]));
  const incoming = new Map(block.nodes.map(node => [node.id, block.edges.filter(edge => edge.to === node.id).length]));
  const queue = block.nodes.filter(node => incoming.get(node.id) === 0).map(node => node.id);
  let visited = 0;
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index]; visited++;
    for (const edge of block.edges.filter(edge => edge.from === id)) {
      depth.set(edge.to, Math.max(depth.get(edge.to)!, depth.get(id)! + 1));
      incoming.set(edge.to, incoming.get(edge.to)! - 1);
      if (incoming.get(edge.to) === 0) queue.push(edge.to);
    }
  }
  if (visited !== block.nodes.length) {
    const radius = Math.max(180, block.nodes.length * 28);
    return { width: radius * 2 + 240, height: radius * 2 + 140, nodes: block.nodes.map((node, index) => ({ ...node, x: radius + 120 + Math.cos(index / block.nodes.length * Math.PI * 2) * radius, y: radius + 70 + Math.sin(index / block.nodes.length * Math.PI * 2) * radius })) };
  }
  const counts = new Map<number, number>();
  const nodes = block.nodes.map(node => {
    const layer = depth.get(node.id)!;
    const row = counts.get(layer) || 0; counts.set(layer, row + 1);
    return { ...node, x: 120 + layer * 280, y: 70 + row * 130 };
  });
  return { width: Math.max(...nodes.map(node => node.x)) + 120, height: Math.max(...nodes.map(node => node.y)) + 70, nodes };
}
