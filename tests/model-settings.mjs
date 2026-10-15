import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = process.cwd(), originalFetch = globalThis.fetch;
const temporary = await mkdtemp(path.join(tmpdir(), 'jimmy-models-'));
try {
  for (const source of ['app/api/_security', 'app/api/_limits', 'app/api/model-settings/settings', 'app/api/model-settings/route']) {
    const output = ts.transpileModule(await readFile(`${source}.ts`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from "(\.[^"]+)"/g, 'from "$1.mjs"');
    await mkdir(path.dirname(path.join(temporary, source)), { recursive: true }); await writeFile(path.join(temporary, `${source}.mjs`), output);
  }
  process.chdir(temporary);
  process.env.JIMMY_AUTH_USERNAME = 'test'; process.env.JIMMY_AUTH_PASSWORD = 'test-password'; process.env.JIMMY_ALLOWED_HOSTS = 'localhost'; process.env.VOICE_SERVICE_SECRET = 'test-secret';
  const { GET, POST } = await import(pathToFileURL(path.join(temporary, 'app/api/model-settings/route.mjs')));
  const request = (body, auth = true) => new Request('http://localhost/api/model-settings', { method: body ? 'POST' : 'GET', headers: { host: 'localhost', ...(auth ? { authorization: `Basic ${Buffer.from('test:test-password').toString('base64')}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await GET(request(null, false))).status, 401);
  assert.equal((await (await GET(request())).json()).keepLoaded, false);
  assert.equal((await POST(request({ keepLoaded: 'true' }))).status, 400);
  const calls = [];
  let failed = false;
  globalThis.fetch = async (url, options) => { calls.push({ url: String(url), options }); return Response.json({}, { status: failed ? 503 : 200 }); };
  assert.equal((await POST(request({ keepLoaded: true }))).status, 200);
  assert.equal((await (await GET(request())).json()).keepLoaded, true);
  assert.ok(calls.some(call => call.url.endsWith('/warm') && call.options.headers['X-Voice-Service-Secret'] === 'test-secret'));
  assert.equal(JSON.parse(calls.find(call => call.url.endsWith('/generate')).options.body).keep_alive, -1);
  calls.length = 0;
  assert.equal((await POST(request({ keepLoaded: false }))).status, 200);
  assert.equal(JSON.parse(calls[0].options.body).keep_alive, '30m');
  assert.equal((await (await GET(request())).json()).keepLoaded, false);
  failed = true;
  assert.equal((await POST(request({ keepLoaded: true }))).status, 503);
  assert.equal((await (await GET(request())).json()).keepLoaded, false, 'Failed warm-up must not save an enabled preference');
  console.log('Passed: authenticated opt-in, warm both models, numeric keep-alive, persistence, idle timeout restoration, and failed warm-up handling.');
} finally { globalThis.fetch = originalFetch; process.chdir(root); await rm(temporary, { recursive: true, force: true }); }
