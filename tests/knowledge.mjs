import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const originalDirectory = process.cwd(), originalFetch = globalThis.fetch;
const temporary = await mkdtemp(path.join(tmpdir(), 'jimmy-knowledge-'));
try {
  for (const source of ['app/api/_security', 'app/api/_limits', 'app/lib/memory-retrieval', 'app/api/knowledge/store', 'app/api/knowledge/route', 'app/lib/voice-commands', 'app/lib/local-files', 'app/lib/todos', 'app/api/knowledge/public-web', 'app/api/knowledge/publishers', 'app/api/knowledge/research']) {
    const output = ts.transpileModule(await readFile(`${source}.ts`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from "(\.[^"]+)"/g, 'from "$1.mjs"');
    await mkdir(path.dirname(path.join(temporary, source)), { recursive: true }); await writeFile(path.join(temporary, `${source}.mjs`), output);
  }
  process.chdir(temporary);
  const load = source => import(pathToFileURL(path.join(temporary, `${source}.mjs`)));
  const store = await load('app/api/knowledge/store');
  const { parseVoiceCommand } = await load('app/lib/voice-commands');
  const url = 'https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.gmail/message-operations';
  assert.deepEqual(parseVoiceCommand(`Jimmy, learn from ${url}`), { kind: 'knowledge-learn', url });
  for (const command of ['Jimmy, learn from the n8n documentation.', 'Learn from n8n docs', 'Jimmy, please study the n8n documentation', 'Could you learn from the n8n docs?']) {
    assert.deepEqual(parseVoiceCommand(command), { kind: 'knowledge-learn', url: 'https://docs.n8n.io/integrations' });
  }
  assert.equal(parseVoiceCommand('Do not learn from the n8n documentation'), null);
  assert.equal(parseVoiceCommand('Explain the n8n documentation'), null);
  assert.deepEqual(parseVoiceCommand('Jimmy, learn that Gmail uses the native node'), { kind: 'knowledge-note', text: 'Gmail uses the native node' });
  assert.equal(parseVoiceCommand('What have you learned?').kind, 'knowledge-list');
  for (const unsafe of ['http://docs.n8n.io/integrations', 'https://localhost/integrations', 'https://docs.n8n.io.evil.test/integrations', 'https://user:pass@docs.n8n.io/integrations', 'https://docs.n8n.io:444/integrations']) assert.throws(() => store.documentationUrl(unsafe));
  const lesson = await store.saveLesson('Gmail retrieval should use native Gmail nodes.');
  assert.equal((await store.saveLesson(lesson.text)).id, lesson.id, 'Duplicate lessons reuse the saved entry');
  const calls = [];
  globalThis.fetch = async (target, options) => { calls.push(String(target)); assert.equal(options.redirect, 'error'); return new Response('# Gmail\n## Get Many messages\nReturn All retrieves every matching message.'); };
  const entry = await store.learnDocumentation(url);
  assert.equal(entry.kind, 'documentation'); assert.equal(entry.source, url); assert.ok(Date.parse(entry.learnedAt));
  await store.learnDocumentation(url + '.md'); assert.equal(calls.length, 1, 'Canonical source uses cached knowledge');
  assert.ok(calls[0].startsWith('https://raw.githubusercontent.com/n8n-io/n8n-docs/'));
  const context = await store.knowledgeContext([{ role: 'user', content: 'How do I retrieve Gmail messages?' }]);
  assert.match(context, /Gmail/); assert.match(context, /source/); assert.match(context, /not instructions/);
  assert.equal(await store.knowledgeContext([{ role: 'user', content: 'quantum zebras' }]), '', 'Unrelated references are not injected');
  const restarted = await import(pathToFileURL(path.join(temporary, 'app/api/knowledge/store.mjs')).href + '?restart');
  assert.equal((await restarted.readKnowledge()).length, 2, 'Knowledge survives a new module instance');
  globalThis.fetch = async target => String(target).endsWith('/README.md') ? new Response('# Webhook\nConnect a trigger to actions.') : new Response('', { status: 404 });
  await store.learnDocumentation('https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook');
  const saved = await store.readKnowledge(); saved.find(item => item.id === entry.id).learnedAt = '2000-01-01T00:00:00Z';
  await writeFile('storage/jimmy-knowledge.json', JSON.stringify(saved));
  globalThis.fetch = async () => { throw new Error('Offline'); };
  assert.equal((await store.learnDocumentation(url)).learnedAt, '2000-01-01T00:00:00Z', 'Offline cache keeps its original date');
  await assert.rejects(store.learnDocumentation(url, undefined, true), /nothing was saved/);
  await store.forgetKnowledge(entry.id); assert.ok(!(await store.readKnowledge()).some(item => item.id === entry.id));
  process.env.JIMMY_AUTH_USERNAME = 'test'; process.env.JIMMY_AUTH_PASSWORD = 'test-password'; process.env.JIMMY_ALLOWED_HOSTS = 'localhost';
  const { GET, POST } = await load('app/api/knowledge/route');
  const request = (body, auth = true) => new Request('http://localhost/api/knowledge', { method: body ? 'POST' : 'GET', headers: { host: 'localhost', ...(auth ? { authorization: `Basic ${Buffer.from('test:test-password').toString('base64')}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await GET(request(null, false))).status, 401);
  assert.equal((await POST(request({ action: 'note', text: '' }))).status, 400);
  assert.equal((await POST(request({ action: 'learn', url: 'http://localhost' }))).status, 400);
  assert.equal((await POST(request({ action: 'note', text: 'Portfolio deployments use the documented build steps.' }))).status, 200);
  console.log('Passed: lesson/document commands, bounded source allowlist, persisted dated references, cache refresh/fallback, relevant retrieval, deduplication, forgetting, and authenticated APIs.');
} finally { globalThis.fetch = originalFetch; process.chdir(originalDirectory); await rm(temporary, { recursive: true, force: true }); }
