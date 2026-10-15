import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import nextEnv from '@next/env';
import { createEnvironment, validateEnvironment, ensureSilero } from '../scripts/setup.mjs';

const temporary = await mkdtemp(path.join(tmpdir(), 'jimmy-setup-'));
const originalFetch = globalThis.fetch;
try {
  const template = await readFile('.env.local.example', 'utf8');
  await writeFile(path.join(temporary, '.env.local.example'), template);
  assert.equal(await createEnvironment(temporary), true);
  const generated = await readFile(path.join(temporary, '.env.local'), 'utf8');
  const [, env] = nextEnv.processEnv([{ path: '.env.local', contents: generated, env: {} }], temporary, { info() {}, error() {} }, true);
  validateEnvironment(env);
  assert.match(env.JIMMY_AUTH_PASSWORD, /^[A-Za-z0-9_-]{43}$/);
  assert.match(env.VOICE_SERVICE_SECRET, /^[a-f0-9]{64}$/);
  assert.ok(!generated.includes('replace-with-'));
  assert.equal(env.JIMMY_ALLOWED_HOSTS, 'localhost,127.0.0.1');
  assert.equal(env.BRAVE_PATH, '');
  assert.equal(env.COMFYUI_WORKFLOW_PATH, '');
  const existing = '# My settings must survive\n' + generated + '\nN8N_API_KEY=private-test-fixture\n';
  await writeFile(path.join(temporary, '.env.local'), existing);
  assert.equal(await createEnvironment(temporary), false);
  assert.equal(await readFile(path.join(temporary, '.env.local'), 'utf8'), existing);
  const second = path.join(temporary, 'friend');
  await mkdir(second);
  await writeFile(path.join(second, '.env.local.example'), template);
  await createEnvironment(second);
  assert.notEqual(await readFile(path.join(second, '.env.local'), 'utf8'), generated, 'Each friend receives fresh secrets');
  assert.throws(() => validateEnvironment({ ...env, VOICE_SERVICE_SECRET: 'too-short' }), /at least 32/);
  assert.throws(() => validateEnvironment({ ...env, JIMMY_AUTH_PASSWORD: 'replace-with-a-long-random-password' }), /private password/);
  assert.throws(() => validateEnvironment({ ...env, JIMMY_AUTH_USERNAME: 'bad:username' }), /username/);
  assert.throws(() => validateEnvironment({ ...env, JIMMY_ALLOWED_HOSTS: 'example.com' }), /localhost/);
  globalThis.fetch = async () => new Response('not a model');
  await assert.rejects(ensureSilero(temporary), /checksum did not match/);
  const model = path.join(temporary, 'voice-service/models/silero_vad_16k_op15.onnx');
  await assert.rejects(readFile(model), { code: 'ENOENT' });
  globalThis.fetch = async () => new Response('Missing', { status: 404 });
  await assert.rejects(ensureSilero(temporary), /HTTP 404/);
  await mkdir(path.dirname(model), { recursive: true });
  await writeFile(model, 'existing unexpected model');
  globalThis.fetch = async () => { throw new Error('Must not replace an existing model'); };
  await assert.rejects(ensureSilero(temporary), /Existing Silero model/);
  assert.equal(await readFile(model, 'utf8'), 'existing unexpected model');
  const privateFiles = ['.env.local', 'storage/secret.txt', 'storage/jimmy-memory.sqlite', 'storage/activity/day.md', '.jimmy-runtime/codex/auth.json', '.codex/auth.json', '.aws/credentials', 'models/custom-model.bin', 'voice-service/models/model.onnx', 'voice-service/models/model.onnx.download.tmp', 'node_modules/example/index.js', '.next/BUILD_ID'];
  const ignored = execFileSync('git', ['check-ignore', '--no-index', '--stdin'], { input: privateFiles.join('\n') + '\n', encoding: 'utf8' }).trim().split(/\r?\n/);
  assert.deepEqual(ignored, privateFiles);
  const sourceFiles = ['.env.local.example', 'scripts/setup.mjs', 'SETUP.md', 'app/fonts/Orbitron.ttf', 'voice-service/models/README.md'];
  for (const file of sourceFiles) {
    assert.throws(() => execFileSync('git', ['check-ignore', '--no-index', file], { stdio: 'pipe' }), error => error.status === 1, `${file} must be shareable`);
  }
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  assert.deepEqual(lock.packages[''].engines, pkg.engines);
  for (const entry of Object.values(lock.packages)) if (entry.resolved) assert.ok(entry.resolved.startsWith('https://registry.npmjs.org/'), 'Use the standard registry for portable installs');
  console.log('Passed: unique private configuration, existing configuration preservation, credential validation, model checksum/failure safety, Git exclusions and portable lockfile.');
} finally {
  globalThis.fetch = originalFetch;
  await rm(temporary, { recursive: true, force: true });
}
