import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const temporary = await mkdtemp(path.join(tmpdir(), 'jimmy-canvas-'));
try {
  for (const source of ['app/lib/canvas', 'app/api/ollama-chat/canvas-response']) {
    const code = ts.transpileModule(await readFile(source + '.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from "(\.[^"]+)"/g, 'from "$1.mjs"');
    await mkdir(path.dirname(path.join(temporary, source)), { recursive: true }); await writeFile(path.join(temporary, source + '.mjs'), code);
  }
  const load = source => import(pathToFileURL(path.join(temporary, source + '.mjs')));
  const { validCanvasContent, validCanvasDocument, canvasDocument, splitCanvasReply, canvasNarrative, dataCanvas, diagramLayout, readCanvasEvents } = await load('app/lib/canvas');
  const content = { title: 'Expenses', blocks: [
    { type: 'table', columns: ['Month', 'Amount'], rows: [['Jan', 10], ['Feb', -5]] },
    { type: 'chart', style: 'line', points: [{ label: 'Jan', value: 10 }, { label: 'Feb', value: -5 }] },
    { type: 'diagram', nodes: [{ id: 'a', label: 'Read' }, { id: 'b', label: 'Summarize' }], edges: [{ from: 'a', to: 'b' }] },
  ] };
  assert.ok(validCanvasContent(content));
  assert.ok(validCanvasDocument(canvasDocument(content)));
  for (const blocks of [
    [{ type: 'html', text: '<script>alert(1)</script>' }],
    [{ type: 'chart', style: 'bar', points: [{ label: 'x', value: NaN }] }],
    [{ type: 'chart', style: 'line', points: [{ label: 'x', value: Infinity }] }],
    [{ type: 'table', columns: ['x'], rows: [[1, 2]] }],
    [{ type: 'table', columns: ['x'], rows: [[{ html: 'bad' }]] }],
    [{ type: 'diagram', nodes: [{ id: 'a', label: 'A' }], edges: [{ from: 'a', to: 'missing' }] }],
    [{ type: 'diagram', nodes: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }], edges: [] }],
    [{ type: 'list', items: Array(201).fill('too many') }],
  ]) assert.equal(validCanvasContent({ title: 'Invalid', blocks }), false);
  const reply = 'Here is the comparison.\n\n```jimmy-canvas\n' + JSON.stringify(content) + '\n```';
  const split = splitCanvasReply(reply);
  assert.equal(split.message, 'Here is the comparison.'); assert.deepEqual(split.canvas.blocks, content.blocks);
  assert.deepEqual(splitCanvasReply(reply.replace('```jimmy-canvas', '```json')).canvas.blocks, content.blocks, 'A valid visual schema in a normal JSON fence also renders as visuals');
  assert.equal(canvasNarrative(reply.slice(0, reply.length - 10)), 'Here is the comparison.');
  assert.equal(canvasNarrative('Here it is.\n```jimmy-ca'), 'Here it is.');
  const markdown = splitCanvasReply('Your options:\n- Alpha\n- Beta\n\nName | Count\n--- | ---\nOne | 12\nTwo | 8\n\nThese are examples.');
  assert.equal(markdown.canvas.blocks[0].type, 'list');
  assert.deepEqual(markdown.canvas.blocks[1].rows, [['One', '12'], ['Two', '8']]);
  assert.equal(markdown.message, 'Your options:\n\nThese are examples.');
  const code = 'Try this:\n```js\nconst x = 1;\n- not a list\n```';
  assert.equal(splitCanvasReply(code).canvas, null, 'Code is not mistaken for a list');
  assert.equal(splitCanvasReply('Hello there.').canvas, null);
  const invalid = splitCanvasReply('Here is the data.\n```jimmy-canvas\n{"blocks":"broken"}\n```');
  assert.equal(invalid.canvas.blocks[0].type, 'text'); assert.ok(invalid.canvas.note);
  const rawJson = splitCanvasReply('```json\n[{"name":"Actual record","count":10}]\n```');
  assert.equal(rawJson.canvas.blocks[0].type, 'table');
  assert.ok(!rawJson.message.includes('Actual record'));
  const records = dataCanvas('Gmail', { messages: [{ subject: 'Actual subject', body: '<img src=x onerror=alert(1)>' }, { subject: 'Second' }], nextPageToken: 'do-not-display' }, 'Gmail tool');
  assert.deepEqual(records.blocks[0].columns, ['subject', 'body']);
  assert.equal(records.blocks[0].rows[1][1], null);
  assert.ok(!JSON.stringify(records).includes('do-not-display'));
  assert.ok(validCanvasContent(records), 'Untrusted HTML is treated as ordinary cell text');
  assert.ok(dataCanvas('Big result', Array.from({ length: 201 }, () => ({ text: 'x'.repeat(2100) }))).note.includes('first 200'));
  assert.equal(dataCanvas('Empty', []).blocks[0].items.length, 0);
  const dag = diagramLayout(content.blocks[2]);
  assert.ok(dag.nodes[1].x > dag.nodes[0].x);
  const cyclic = diagramLayout({ ...content.blocks[2], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }] });
  assert.ok(cyclic.nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y)));
  const encoded = JSON.stringify({ type: 'text', text: 'Hello 🌍' }) + '\n' + JSON.stringify({ type: 'canvas', canvas: records }) + '\n';
  let rest = '', combined = '', received;
  for (let index = 0; index < encoded.length; index += 3) {
    const chunk = readCanvasEvents(rest + encoded.slice(index, index + 3)); rest = chunk.rest; combined += chunk.text; received = chunk.canvas || received;
  }
  assert.equal(rest, ''); assert.equal(combined, 'Hello 🌍'); assert.deepEqual(received, records);
  assert.equal(readCanvasEvents(JSON.stringify({ type: 'text', text: 'last' }), true).text, 'last');
  assert.throws(() => readCanvasEvents('{"type":"execute","command":"bad"}\n'), /Invalid canvas/);
  const { canvasResponse } = await load('app/api/ollama-chat/canvas-response');
  const bytes = new TextEncoder().encode('Hi 🌍');
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, 5)); controller.enqueue(bytes.slice(5)); controller.close(); } }), { headers: { 'X-Jimmy-Tool-Result': '1' } });
  const wrapped = canvasResponse(response, records);
  assert.equal(wrapped.headers.get('X-Jimmy-Tool-Result'), '1');
  const events = readCanvasEvents(await wrapped.text(), true);
  assert.equal(events.text, 'Hi 🌍'); assert.deepEqual(events.canvas, records);
  let cancelled = false;
  const cancellation = canvasResponse(new Response(new ReadableStream({ cancel() { cancelled = true; } })), records);
  await cancellation.body.cancel(); assert.ok(cancelled);
  const failure = canvasResponse(new Response(new ReadableStream({ start(controller) { controller.error(new Error('Provider failed')); } })), records);
  await assert.rejects(failure.text(), /Provider failed/);
  console.log('Passed: safe visual schema, Markdown extraction, raw tool tables, limits/notes, diagrams/cycles, framed UTF-8 streaming, cancellation and failure propagation.');
} finally { await rm(temporary, { recursive: true, force: true }); }
