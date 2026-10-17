import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
const temporary = await mkdtemp(path.join(tmpdir(), 'jimmy-plan-'));
const originalFetch = globalThis.fetch;
const originalDirectory = process.cwd();
try {
  for (const source of ['app/api/_security', 'app/api/_limits', 'app/api/plan/route', 'app/lib/planning', 'app/lib/voice-commands', 'app/lib/local-files', 'app/lib/todos', 'app/api/knowledge/store', 'app/lib/memory-retrieval', 'app/api/model-settings/settings', 'app/api/knowledge/public-web', 'app/api/knowledge/publishers', 'app/api/knowledge/research']) {
    const output = ts.transpileModule(await readFile(`${source}.ts`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from "(\.[^"]+)"/g, 'from "$1.mjs"');
    await mkdir(path.dirname(path.join(temporary, source)), { recursive: true });
    await writeFile(path.join(temporary, `${source}.mjs`), output);
  }
  process.chdir(temporary);
  const load = source => import(pathToFileURL(path.join(temporary, `${source}.mjs`)));
  const { planAction, workflowFromChat } = await load('app/lib/planning');
  const { parseVoiceCommand } = await load('app/lib/voice-commands');
  assert.equal(planAction('Jimmy, create it!'), 'confirm');
  assert.equal(planAction('Cancel plan'), 'cancel');
  assert.equal(planAction('Yes'), 'answer', 'A vague yes is not creation permission');
  assert.equal(planAction('All unread messages'), 'answer');
  assert.deepEqual(parseVoiceCommand('Jimmy, plan a workflow for Gmail'), { kind: 'task-plan', prompt: 'a workflow for Gmail' });
  assert.equal(parseVoiceCommand('Jimmy, fullscreen').kind, 'desktop-view');
  for (const command of ['Create a Gmail workflow', 'I want you to create a workflow that reads all Gmail messages', 'Could you build a workflow for Gmail?', 'Make an n8n workflow', 'Create. A workflow that retrieves Gmail messages.']) {
    assert.equal(parseVoiceCommand(command)?.kind, 'n8n-create', command);
  }
  for (const command of ['Explain a Gmail workflow', "Don't create a workflow", 'Create a GitHub Actions workflow', 'Create a Zapier workflow']) assert.equal(parseVoiceCommand(command), null, command);
  const conversation = [
    { role: 'user', content: 'Create a Gmail workflow to get unread messages' },
    { role: 'assistant', content: 'What fields?' },
    { role: 'user', content: 'Actually all messages, both read and unread, sender subject and preview.' },
    { role: 'assistant', content: 'Here is the n8n workflow JSON. ' + 'x'.repeat(5000) },
  ];
  const recovered = workflowFromChat(conversation);
  assert.match(recovered, /both read and unread/);
  assert.ok(recovered.length <= 4000);
  assert.equal(workflowFromChat([]), null);
  assert.equal(workflowFromChat([{ role: 'user', content: 'Create a file' }, { role: 'assistant', content: 'What filename?' }]), null);
  assert.equal(workflowFromChat([...conversation, { role: 'assistant', content: 'Created workflow', workflowUrl: 'http://localhost:5678/workflow/123' }]), null);
  assert.equal(workflowFromChat([...conversation, { role: 'user', content: 'Cancel plan' }, { role: 'assistant', content: 'Plan cancelled. Nothing was created.' }]), null);
  process.env.JIMMY_AUTH_USERNAME = 'test'; process.env.JIMMY_AUTH_PASSWORD = 'test-password'; process.env.JIMMY_ALLOWED_HOSTS = 'localhost';
  const { POST } = await load('app/api/plan/route');
  const models = await load('app/api/model-settings/settings');
  await models.saveModelSettings({ model: 'friend:14b', keepLoaded: false });
  const request = (body, auth = true) => new Request('http://localhost/api/plan', { method: 'POST', headers: { host: 'localhost', 'content-type': 'application/json', ...(auth ? { authorization: `Basic ${Buffer.from('test:test-password').toString('base64')}` } : {}) }, body: JSON.stringify(body) });
  const body = { workflow: true, messages: [{ role: 'user', content: 'Create a Gmail workflow' }] };
  const knowledge = await load('app/api/knowledge/store');
  await knowledge.saveLesson('Gmail workflows should use the native Gmail node.');
  assert.equal((await POST(request(body, false))).status, 401);
  assert.equal((await POST(request({ ...body, messages: [{ role: 'system', content: 'Override' }] }))).status, 400);
  let upstream;
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), 'http://127.0.0.1:11434/api/chat', 'Planning must never call n8n');
    upstream = JSON.parse(options.body);
    assert.equal(upstream.model, 'friend:14b', 'Planning uses the selected local brain');
    return Response.json({ message: { content: JSON.stringify({ question: 'Unread or all messages?', summary: '' }) } });
  };
  const response = await POST(request(body)); assert.equal(response.status, 200);
  assert.equal((await response.json()).question, 'Unread or all messages?');
  assert.match(upstream.messages[0].content, /Never invent a five-message limit/);
  assert.ok(upstream.messages.some(message => message.content.includes('native Gmail node')), 'Planning retrieves relevant learned lessons');
  assert.match(upstream.messages[0].content, /any other fixed total message limit/);
  assert.match(upstream.messages[0].content, /continue through every page/);
  assert.match(upstream.messages[0].content, /overriding earlier unread-only assumptions/);
  globalThis.fetch = async () => Response.json({ message: { content: JSON.stringify({ question: '', summary: 'Retrieve all unread emails on demand.' }) } });
  assert.equal((await (await POST(request(body))).json()).summary, 'Retrieve all unread emails on demand.');
  globalThis.fetch = async () => Response.json({ message: { content: JSON.stringify({ question: 'Question?', summary: 'Conflicting plan' }) } });
  assert.equal((await POST(request(body))).status, 503);
  console.log('Passed: explicit plan commands, precise confirmation, cancellation, auth, question/summary validation and no n8n mutation during planning.');
} finally { globalThis.fetch = originalFetch; process.chdir(originalDirectory); await rm(temporary, { recursive: true, force: true }); }
