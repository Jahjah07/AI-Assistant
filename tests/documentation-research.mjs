import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import dns from 'node:dns/promises';
import https from 'node:https';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const directory = process.cwd(), originalFetch = globalThis.fetch, originalLookup = dns.lookup, originalRequest = https.request;
const temporary = await mkdtemp(path.join(tmpdir(), 'jimmy-research-'));
const requests = [], searches = [];
const pages = new Map([
  ['https://docs.python.org/3/library/json.html', { text: '<html><title>Python JSON documentation</title><body><nav>Navigation clutter</nav><main><h1>JSON API</h1><p>Use json.loads to decode JSON.</p><script>evil()</script></main></body></html>' }],
  ['https://docs.python.org/3/', { text: '<html><title>Python documentation</title><main>Python language reference and installation documentation.</main></html>' }],
  ['https://cedarflow.dev/', { text: '<html><title>CedarFlow</title><a href="https://docs.cedarflow.dev/guide/">Documentation</a></html>' }],
  ['https://docs.cedarflow.dev/guide/', { text: '<html><title>CedarFlow documentation</title><main>CedarFlow software framework integration guide.</main></html>' }],
  ['https://sampledocs.com/docs/', { text: '<html><title>Community notes</title><main>User-supplied community documentation.</main></html>' }],
  ['https://docs.python.org/3/private', { status: 302, location: 'https://127.0.0.1/secret' }],
  ['https://docs.python.org/3/huge', { text: 'x'.repeat(1024 * 1024 + 1) }],
]);
try {
  for (const source of ['app/api/_security', 'app/api/_limits', 'app/lib/memory-retrieval', 'app/lib/voice-commands', 'app/lib/local-files', 'app/lib/todos', 'app/api/knowledge/store', 'app/api/knowledge/public-web', 'app/api/knowledge/publishers', 'app/api/knowledge/research', 'app/api/knowledge/route']) {
    const output = ts.transpileModule(await readFile(`${source}.ts`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from "(\.[^"]+)"/g, 'from "$1.mjs"');
    await mkdir(path.dirname(path.join(temporary, source)), { recursive: true }); await writeFile(path.join(temporary, `${source}.mjs`), output);
  }
  process.chdir(temporary);
  const load = name => import(pathToFileURL(path.join(temporary, name + '.mjs')));
  dns.lookup = async () => [{ address: '8.8.8.8', family: 4 }];
  https.request = (url, options, callback) => {
    requests.push(url.href);
    const request = new EventEmitter();
    request.end = () => queueMicrotask(() => {
      options.lookup(url.hostname, {}, (error, address) => { assert.equal(error, null); assert.equal(address, '8.8.8.8', 'Transport uses the validated DNS result'); });
      const page = pages.get(url.href) || { status: 404, text: 'Not found' };
      const response = new EventEmitter(); let destroyed = false;
      response.statusCode = page.status || 200; response.headers = { 'content-type': 'text/html', ...(page.location ? { location: page.location } : {}) };
      response.destroy = () => { destroyed = true; }; callback(response);
      if (!destroyed) { response.emit('data', Buffer.from(page.text || '')); if (!destroyed) response.emit('end'); }
    });
    return request;
  };
  globalThis.fetch = async target => {
    const url = new URL(target); searches.push(url.href);
    if (url.hostname === 'www.bing.com') return new Response('<rss><channel><item><link>https://attacker.com/python</link></item><item><link>https://docs.python.org/3/library/json.html</link></item></channel></rss>');
    if (url.searchParams.get('action') === 'wbsearchentities') return Response.json({ search: url.searchParams.get('search') === 'CedarFlow' ? [{ id: 'Q1001', label: 'CedarFlow', description: 'software framework' }] : [] });
    if (url.pathname.includes('Q1001')) return Response.json({ entities: { Q1001: { claims: { P856: [{ rank: 'preferred', mainsnak: { datavalue: { value: 'https://cedarflow.dev/' } } }] } } } });
    throw new Error('Unexpected search destination');
  };
  const web = await load('app/api/knowledge/public-web');
  const store = await load('app/api/knowledge/store');
  const research = await load('app/api/knowledge/research');
  const { parseVoiceCommand } = await load('app/lib/voice-commands');
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '172.16.1.1', '192.168.0.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2001:db8::1', '2002:7f00:1::1']) assert.equal(web.publicAddress(address), false, address);
  assert.equal(web.publicAddress('8.8.8.8'), true); assert.equal(web.publicAddress('2606:4700:4700::1111'), true);
  for (const url of ['http://example.com', 'https://localhost/', 'https://localhost./', 'https://2130706433/', 'https://0x7f000001/', 'https://[::ffff:127.0.0.1]/', 'https://user:pass@example.com', 'https://example.com:8443']) assert.throws(() => web.publicUrl(url));
  const parsed = web.documentText(pages.get('https://docs.python.org/3/library/json.html').text);
  assert.match(parsed.text, /json.loads/); assert.ok(!parsed.text.includes('evil()') && !parsed.text.includes('Navigation clutter'));
  await assert.rejects(web.publicText('https://docs.python.org/3/private'), /public HTTPS/);
  await assert.rejects(web.publicText('https://docs.python.org/3/huge'), /fetch limit/);
  const before = requests.length;
  dns.lookup = async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }];
  await assert.rejects(web.publicText('https://docs.python.org/3/'), /Private/); assert.equal(requests.length, before);
  dns.lookup = async () => [{ address: '8.8.8.8', family: 4 }];
  assert.deepEqual(parseVoiceCommand('Jimmy, learn from the React documentation'), { kind: 'knowledge-discover', topic: 'React' });
  assert.deepEqual(parseVoiceCommand('Study about CedarFlow'), { kind: 'knowledge-discover', topic: 'CedarFlow' });
  const signal = new AbortController().signal;
  const python = await research.discoverDocumentation('Python', signal, 'json');
  assert.equal(python.official, true); assert.equal(python.publisher, 'Python'); assert.match(python.text, /json.loads/);
  assert.ok(!requests.some(url => url.includes('attacker.com')), 'Search ranking cannot bypass the publisher check');
  const custom = await research.discoverDocumentation('CedarFlow', signal);
  assert.equal(custom.official, true); assert.match(custom.evidence, /Q1001/); assert.equal(custom.source, 'https://docs.cedarflow.dev/guide/');
  const supplied = await store.learnDocumentation('https://sampledocs.com/docs/');
  assert.equal(supplied.official, false, 'A supplied URL is not automatically called official');
  const count = (await store.readKnowledge()).length;
  await assert.rejects(research.discoverDocumentation('UnknownProduct', signal), /could not confidently identify/);
  assert.equal((await store.readKnowledge()).length, count);
  searches.length = 0;
  const context = await research.documentationForTask([{ role: 'user', content: 'Configure the Python JSON API for SecretProject with password shh.' }], signal);
  assert.match(context, /Documentation looked up/);
  assert.ok(searches.every(query => !query.includes('SecretProject') && !query.includes('shh')), 'Automatic queries exclude raw conversation/private details');
  searches.length = 0;
  assert.equal(await research.documentationForTask([{ role: 'user', content: 'Hello, how are you?' }], signal), ''); assert.equal(searches.length, 0);
  dns.lookup = async () => new Promise(() => {});
  const controller = new AbortController(); const cancelled = web.publicText('https://docs.python.org/3/', controller.signal); controller.abort();
  await assert.rejects(cancelled);
  console.log('Passed: public HTTPS/IP/DNS/redirect/body boundaries, HTML extraction, generic learning commands, scoped search, publisher evidence, unknown publishers, unverified links, automatic query privacy, cache persistence and cancellation.');
} finally { dns.lookup = originalLookup; https.request = originalRequest; globalThis.fetch = originalFetch; process.chdir(directory); await rm(temporary, { recursive: true, force: true }); }
