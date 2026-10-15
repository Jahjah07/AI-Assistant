import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = process.cwd();
const temporary = await mkdtemp(path.join(tmpdir(), 'jimmy-activity-'));
try {
  for (const source of ['app/api/_security', 'app/api/_limits', 'app/lib/memory-retrieval', 'app/api/activity/store', 'app/api/activity/route']) {
    const output = ts.transpileModule(await readFile(`${source}.ts`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from "(\.[^"]+)"/g, 'from "$1.mjs"');
    await mkdir(path.dirname(path.join(temporary, source)), { recursive: true });
    await writeFile(path.join(temporary, `${source}.mjs`), output);
  }
  process.chdir(temporary);
  process.env.JIMMY_AUTH_USERNAME = 'test'; process.env.JIMMY_AUTH_PASSWORD = 'test-password'; process.env.JIMMY_ALLOWED_HOSTS = 'localhost,example.com';
  const store = await import(pathToFileURL(path.join(temporary, 'app/api/activity/store.mjs')));
  const { GET, POST } = await import(pathToFileURL(path.join(temporary, 'app/api/activity/route.mjs')));
  const extension = `chrome-extension://${'a'.repeat(32)}`;
  const request = (body, { auth = true, origin, host = 'localhost' } = {}) => new Request(`${host === 'localhost' ? 'http' : 'https'}://${host}/api/activity`, {
    method: body ? 'POST' : 'GET', headers: { host, ...(origin ? { origin } : {}), ...(auth ? { authorization: `Basic ${Buffer.from('test:test-password').toString('base64')}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const settings = { action: 'settings', enabled: true, browser: true, retentionDays: 30, projects: [] };
  const event = { action: 'record', kind: 'window', text: 'Code — Lupad' };
  assert.equal((await GET(request(null, { auth: false }))).status, 401);
  assert.equal((await GET(request(null, { host: 'example.com' }))).status, 403);
  assert.equal((await POST(request(event, { origin: 'https://evil.example' }))).status, 403);
  assert.equal((await (await POST(request(event))).json()).recorded, false, 'Opt-in is required');
  assert.equal((await POST(request({ ...settings, projects: ['relative/path'] }))).status, 400);
  assert.equal((await POST(request({ ...settings, retentionDays: 0 }))).status, 400);
  assert.equal((await POST(request(settings, { origin: extension }))).status, 400, 'Extensions cannot enable tracking');
  assert.equal((await POST(request(settings))).status, 200);
  assert.equal((await (await POST(request(event))).json()).recorded, true);
  assert.equal((await (await POST(request(event))).json()).recorded, false, 'Duplicates are suppressed');
  assert.equal((await POST(request(event, { origin: extension }))).status, 400, 'Extension may only submit page activity');
  const browser = { action: 'record', kind: 'browser', text: 'Project Proposal\n# fake heading', url: 'https://docs.example.com/presentation/123?token=secret#private' };
  assert.equal((await POST(request(browser, { origin: extension }))).status, 200);
  for (const url of ['javascript:alert(1)', 'file:///private', 'https://name:password@example.com/']) {
    assert.equal((await POST(request({ ...browser, url }, { origin: extension }))).status, 400);
  }
  const journal = await store.readJournal(store.localDay());
  assert.match(journal, /Lupad/); assert.match(journal, /presentation\/123/);
  assert.ok(!journal.includes('secret') && !journal.includes('#private'));
  assert.ok(!journal.includes('\n# fake heading'), 'Titles cannot create forged journal entries');
  await POST(request({ ...settings, enabled: false }));
  assert.equal((await (await POST(request({ ...event, text: 'Should not record' }))).json()).recorded, false);
  assert.equal(await store.readJournal(store.localDay()), journal, 'Pause preserves old entries and rejects new ones');
  await assert.rejects(store.readJournal('../settings'), /date/);
  const date = new Date(); date.setDate(date.getDate() - 1);
  await writeFile(path.join('storage/activity', `${store.localDay(date)}.md`), `- ${date.toISOString()} **file** Yesterday portfolio presentation\n`);
  const context = await store.journalContext([{ role: 'user', content: 'What did I work on yesterday?' }]);
  assert.match(context, /Yesterday portfolio/); assert.ok(!context.includes('Code — Lupad'));
  await writeFile('storage/activity/2000-01-01.md', 'expired'); await writeFile('storage/activity/personal.md', 'keep');
  await POST(request({ ...settings, retentionDays: 2 }));
  assert.ok(!(await store.journalDays()).includes('2000-01-01'));
  assert.equal(await readFile('storage/activity/personal.md', 'utf8'), 'keep');
  console.log('Passed: activity opt-in/pause, auth and origin boundaries, extension restrictions, URL filtering, daily journal retrieval, date validation, deduplication, and retention.');
} finally { process.chdir(root); await rm(temporary, { recursive: true, force: true }); }
