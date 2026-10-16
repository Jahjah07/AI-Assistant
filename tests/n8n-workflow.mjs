import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const temporary = await mkdtemp(path.join(tmpdir(), 'jimmy-n8n-'));
const originalFetch = globalThis.fetch;
const originalDirectory = process.cwd();
try {
  for (const source of ['app/api/_security', 'app/api/_limits', 'app/api/n8n-workflow/workflow', 'app/api/n8n-workflow/route', 'app/lib/voice-commands', 'app/lib/todos', 'app/api/knowledge/store', 'app/lib/memory-retrieval', 'app/api/model-settings/settings', 'app/api/knowledge/public-web', 'app/api/knowledge/publishers', 'app/api/knowledge/research']) {
    const code = await readFile(`${source}.ts`, 'utf8');
    const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from "(\.[^"]+)"/g, 'from "$1.mjs"');
    await mkdir(path.dirname(path.join(temporary, source)), { recursive: true });
    await writeFile(path.join(temporary, `${source}.mjs`), output);
  }
  process.chdir(temporary);
  const load = source => import(pathToFileURL(path.join(temporary, `${source}.mjs`)));
  const { validateWorkflow, gmailReadExample } = await load('app/api/n8n-workflow/workflow');
  const { POST } = await load('app/api/n8n-workflow/route');
  const models = await load('app/api/model-settings/settings');
  await models.saveModelSettings({ model: 'friend:14b', keepLoaded: false });
  const { parseVoiceCommand } = await load('app/lib/voice-commands');
  assert.equal(parseVoiceCommand('Jimmy, create an n8n workflow that returns hello').kind, 'n8n-create');
  assert.equal(parseVoiceCommand('Can you build a workflow in n8n?').kind, 'n8n-create');
  assert.equal(parseVoiceCommand('Tell me about n8n workflows'), null);
  assert.equal(parseVoiceCommand('Do not create an n8n workflow'), null);
  const draft = { name: 'Jimmy test', active: true, settings: { callerPolicy: 'any' }, nodes: [
    { name: 'Start', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {}, credentials: { invented: { id: 'do-not-forward' } } },
    { name: 'Hello', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [240, 0], parameters: { assignments: { assignments: [{ name: 'message', value: 'Hello from Jimmy', type: 'string' }] } } },
  ], connections: [{ from: 0, to: 1, output: 0, input: 0 }] };
  const normalized = validateWorkflow(draft);
  assert.equal('active' in normalized, false);
  assert.equal('credentials' in normalized.nodes[0], false);
  assert.equal(normalized.settings.executionOrder, 'v1');
  assert.equal('callerPolicy' in normalized.settings, false);
  assert.throws(() => validateWorkflow({ ...draft, nodes: [...draft.nodes, draft.nodes[0]] }), /invalid node/);
  assert.throws(() => validateWorkflow({ ...draft, connections: [{ from: 0, to: 42, output: 0, input: 0 }] }), /unknown node/);
  assert.throws(() => validateWorkflow({ ...draft, nodes: [{ ...draft.nodes[0], position: [NaN, 0] }] }), /invalid node/);
  assert.throws(() => validateWorkflow({ ...draft, connections: [] }), /disconnected/);
  assert.throws(() => validateWorkflow({ ...draft, nodes: [draft.nodes[1]], connections: [] }), /trigger/);
  const gmailDraft = { name: 'Gmail read', nodes: [
    { ...draft.nodes[0], type: 'n8n-nodes-base.webhook', typeVersion: 2, parameters: { path: 'gmail', httpMethod: 'GET', authentication: 'headerAuth', responseMode: 'lastNode' } },
    { ...draft.nodes[1], name: 'Gmail', type: 'n8n-nodes-base.gmail', typeVersion: 2.1, parameters: { resource: 'message', operation: 'getAll', returnAll: true, filters: { readStatus: 'both' } } },
  ], connections: draft.connections };
  const gmailPrompt = 'Create an authenticated on-demand webhook to retrieve all Gmail messages, read and unread.';
  assert.equal(validateWorkflow(gmailReadExample, gmailPrompt).nodes.length, 3, 'The complete Gmail example must pass the same checks as generated drafts');
  assert.equal(validateWorkflow(gmailDraft, gmailPrompt).nodes[1].type, 'n8n-nodes-base.gmail');
  assert.throws(() => validateWorkflow({ ...gmailDraft, nodes: [draft.nodes[0], gmailDraft.nodes[1]] }, gmailPrompt), /webhook/);
  assert.throws(() => validateWorkflow({ ...gmailDraft, nodes: [gmailDraft.nodes[0], { ...gmailDraft.nodes[1], type: 'n8n-nodes-base.httpRequest' }] }, gmailPrompt), /native Gmail/);
  assert.throws(() => validateWorkflow({ ...gmailDraft, nodes: [gmailDraft.nodes[0], { ...gmailDraft.nodes[1], parameters: { ...gmailDraft.nodes[1].parameters, returnAll: false } }] }, gmailPrompt), /returnAll/);
  assert.throws(() => validateWorkflow({ ...gmailDraft, nodes: [gmailDraft.nodes[0], { ...gmailDraft.nodes[1], parameters: { ...gmailDraft.nodes[1].parameters, filters: { readStatus: 'unread' } } }] }, gmailPrompt), /readStatus/);
  process.env.JIMMY_AUTH_USERNAME = 'test'; process.env.JIMMY_AUTH_PASSWORD = 'test-password'; process.env.JIMMY_ALLOWED_HOSTS = 'localhost';
  const request = (prompt = 'Create a test workflow', auth = true) => new Request('http://localhost/api/n8n-workflow', { method: 'POST', headers: { host: 'localhost', 'content-type': 'application/json', ...(auth ? { authorization: `Basic ${Buffer.from('test:test-password').toString('base64')}` } : {}) }, body: JSON.stringify({ prompt, confirmed: true }) });
  assert.equal((await POST(request(undefined, false))).status, 401);
  const unconfirmed = request();
  const unconfirmedBody = await unconfirmed.json(); delete unconfirmedBody.confirmed;
  assert.equal((await POST(new Request(unconfirmed.url, { method: 'POST', headers: unconfirmed.headers, body: JSON.stringify(unconfirmedBody) }))).status, 400, 'Creation requires explicit confirmation');
  assert.equal((await POST(request(''))).status, 400);
  assert.equal((await POST(request('x'.repeat(4001)))).status, 400);
  delete process.env.N8N_API_KEY;
  assert.equal((await POST(request())).status, 503);
  process.env.N8N_API_KEY = 'test-key-never-exposed'; process.env.N8N_URL = 'http://localhost:5678';
  const calls = [];
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('https://raw.githubusercontent.com/n8n-io/n8n-docs/')) {
      assert.ok(!options.headers?.['X-N8N-API-KEY'], 'Documentation fetches must not receive n8n credentials');
      return new Response('# Webhook\nUse a connected webhook with configured authentication.');
    }
    const call = { url: String(url), body: JSON.parse(options.body), headers: options.headers }; calls.push(call);
    if (String(url).includes('11434')) assert.equal(call.body.model, 'friend:14b', 'Workflow generation uses the selected local brain');
    return String(url).includes('11434') ? Response.json({ message: { content: JSON.stringify(draft) } }) : Response.json({ id: 'test-id', name: draft.name, active: false });
  };
  const response = await POST(request()); const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.active, false); assert.equal(body.url, 'http://localhost:5678/workflow/test-id');
  assert.equal(calls.length, 2); assert.equal(calls[1].headers['X-N8N-API-KEY'], process.env.N8N_API_KEY);
  assert.equal('active' in calls[1].body, false);
  assert.equal(JSON.stringify(calls[0]).includes(process.env.N8N_API_KEY), false);
  assert.equal(JSON.stringify(body).includes(process.env.N8N_API_KEY), false);
  assert.equal(calls.some(call => /activate|executions/.test(call.url)), false);
  let attempts = 0, saves = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('11434')) {
      attempts++;
      if (attempts === 2) assert.match(JSON.parse(options.body).messages.at(-1).content, /Structural validation failed:.*disconnected/);
      return Response.json({ message: { content: JSON.stringify(attempts === 1 ? { ...draft, connections: [] } : draft) } });
    }
    saves++; return Response.json({ id: 'repaired', name: draft.name, active: false });
  };
  assert.equal((await POST(request())).status, 200);
  assert.equal(attempts, 2); assert.equal(saves, 1, 'Only the repaired, validated draft reaches n8n');
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('https://raw.githubusercontent.com/')) return new Response('# Gmail\n## Get Many messages\nUse Return All with read and unread filters.');
    if (String(url).includes('11434')) {
      assert.equal(JSON.parse(options.body).format.properties.connections.minItems, 2, 'The three-step Gmail endpoint requires two graph edges');
      return Response.json({ message: { content: JSON.stringify(gmailReadExample) } });
    }
    return Response.json({ id: 'gmail-draft', name: 'Gmail read-only endpoint', active: false });
  };
  assert.equal((await POST(request(`${gmailPrompt} Return sender, subject and preview.`))).status, 200);
  calls.length = 0;
  globalThis.fetch = async (url) => String(url).includes('11434') ? Response.json({ message: { content: '{}' } }) : (calls.push(url), Response.json({}));
  assert.equal((await POST(request())).status, 503); assert.equal(calls.length, 0, 'Invalid model output must never create a workflow');
  globalThis.fetch = async url => String(url).includes('11434') ? Response.json({ message: { content: JSON.stringify(draft) } }) : Response.json({}, { status: 401 });
  assert.match((await (await POST(request())).json()).error, /API key/);
  console.log('Passed: command routing, authentication, validation, inactive drafts, no generated credentials, server-only key, no activation/execution, invalid-output and rejected-key handling.');
} finally { globalThis.fetch = originalFetch; process.chdir(originalDirectory); await rm(temporary, { recursive: true, force: true }); }
