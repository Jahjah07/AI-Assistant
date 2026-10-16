import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const source = await readFile('desktop/services.mjs', 'utf8');
let saved = { model: 'friend:14b', keepLoaded: true };
const unloaded = [];
const context = vm.createContext({ path, root: 'test-profile', AbortController, AbortSignal,
  process: { env: { OLLAMA_MODEL: 'environment:latest', VOICE_SERVICE_SECRET: 'test-only' } },
  mkdirSync() {},
  readFileSync() {
    if (!saved) throw Object.assign(new Error('Missing'), { code: 'ENOENT' });
    return JSON.stringify(saved);
  },
  fetch: async (_url, options) => { unloaded.push(JSON.parse(options.body)); return new Response('{}'); },
});
vm.runInContext(source.slice(source.indexOf('function modelSettings()')).replace('export class JimmyServices', 'class JimmyServices') + '\nglobalThis.Services = JimmyServices;', context);
const assistant = new context.Services(() => {});
const calls = [];
assistant.json = async (url, options) => { calls.push({ url, body: options?.body ? JSON.parse(options.body) : null }); return {}; };
await assistant.wake();
assert.equal(calls.find(call => call.url.endsWith('/generate')).body.model, 'friend:14b');
assert.equal(calls.find(call => call.url.endsWith('/generate')).body.keep_alive, -1);
saved = { model: 'other:latest', keepLoaded: false };
assert.deepEqual(Array.from(await assistant.stop()), []);
assert.equal(unloaded[0].model, 'other:latest', 'Shutdown reads the latest saved selection');
assert.equal(unloaded[0].keep_alive, 0);
saved = null;
const fallback = new context.Services(() => {});
fallback.json = assistant.json;
calls.length = 0;
await fallback.wake();
assert.equal(calls.find(call => call.url.endsWith('/generate')).body.model, 'environment:latest');
assert.equal(calls.find(call => call.url.endsWith('/generate')).body.keep_alive, '30m');
console.log('Passed: desktop wake/preload and shutdown follow saved models, with environment fallback for a fresh profile.');
