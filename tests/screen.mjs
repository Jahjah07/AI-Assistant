import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const temp = await mkdtemp(path.join(tmpdir(), 'jimmy-screen-'));
const originalFetch = globalThis.fetch;
try {
  for (const source of ['app/api/_security', 'app/api/_limits', 'app/api/screen/route', 'app/lib/assistant', 'app/lib/voice-commands', 'app/lib/todos']) {
    const code = await readFile(`${source}.ts`, 'utf8');
    const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from "(\.[^"]+)"/g, 'from "$1.mjs"');
    await mkdir(path.dirname(path.join(temp, source)), { recursive: true });
    await writeFile(path.join(temp, `${source}.mjs`), output);
  }
  process.env.JIMMY_AUTH_USERNAME = 'test'; process.env.JIMMY_AUTH_PASSWORD = 'test-password';
  process.env.JIMMY_ALLOWED_HOSTS = 'localhost';
  const { POST } = await import(pathToFileURL(path.join(temp, 'app/api/screen/route.mjs')));
  const { parseVoiceCommand } = await import(pathToFileURL(path.join(temp, 'app/lib/voice-commands.mjs')));
  for (const command of ['Jimmy, can you see my screen?', 'Describe my screen', 'What is on my screen?', 'Read my screen, explain the error']) assert.equal(parseVoiceCommand(command)?.kind, 'screen-inspect');
  for (const command of ['Can you see my point?', 'What am I doing?', 'Open screen settings']) assert.equal(parseVoiceCommand(command), null);
  const image = Buffer.from([255, 216, 255, ...new Array(24).fill(0)]).toString('base64');
  const request = (body, auth = true) => new Request('http://localhost/api/screen', { method: 'POST', headers: {
    host: 'localhost', 'content-type': 'application/json', ...(auth ? { authorization: `Basic ${Buffer.from('test:test-password').toString('base64')}` } : {}),
  }, body: JSON.stringify(body) });
  assert.equal((await POST(request({ image, question: 'Describe this' }, false))).status, 401);
  assert.equal((await POST(request({ image: 'garbage', question: 'Describe this' }))).status, 400);
  assert.equal((await POST(request({ image, question: '' }))).status, 400);
  assert.equal((await POST(request({ image, question: 'x'.repeat(2001) }))).status, 400);
  let upstream;
  globalThis.fetch = async (url, options) => { upstream = { url, ...JSON.parse(options.body) }; return Response.json({ message: { content: 'A code editor is visible.' } }); };
  const response = await POST(request({ image, question: 'Describe this' }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).answer, 'A code editor is visible.');
  assert.equal(upstream.url, 'http://127.0.0.1:11434/api/chat');
  assert.equal(upstream.keep_alive, 0);
  assert.equal(upstream.model, 'qwen3-vl:2b');
  assert.deepEqual(upstream.messages[1].images, [image]);
  assert.match(upstream.messages[0].content, /untrusted/);
  globalThis.fetch = async () => Response.json({ error: 'model missing' }, { status: 404 });
  assert.match((await (await POST(request({ image, question: 'Describe this' }))).json()).error, /ollama pull/);
  globalThis.fetch = async () => Response.json({ message: { content: '' } });
  assert.equal((await POST(request({ image, question: 'Describe this' }))).status, 503);
  console.log('Passed: screen command recognition, authentication, input validation, local-only vision payload, memory release, model missing and empty reply errors.');
} finally { globalThis.fetch = originalFetch; await rm(temp, { recursive: true, force: true }); }
