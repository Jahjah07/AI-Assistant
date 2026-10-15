import { randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, rm, access } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sileroURL = 'https://raw.githubusercontent.com/snakers4/silero-vad/v6.2.1/src/silero_vad/data/silero_vad_16k_op15.onnx';
const sileroHash = '7ed98ddbad84ccac4cd0aeb3099049280713df825c610a8ed34543318f1b2c49';

export async function createEnvironment(directory) {
  const template = await readFile(path.join(directory, '.env.local.example'), 'utf8');
  const content = template
    .replace('JIMMY_AUTH_PASSWORD=replace-with-a-long-random-password', `JIMMY_AUTH_PASSWORD=${randomBytes(32).toString('base64url')}`)
    .replace('VOICE_SERVICE_SECRET=replace-with-at-least-32-random-characters', `VOICE_SERVICE_SECRET=${randomBytes(32).toString('hex')}`);
  try {
    await writeFile(path.join(directory, '.env.local'), content, { flag: 'wx', mode: 0o600 });
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}

export function validateEnvironment(env) {
  if (!env.JIMMY_AUTH_USERNAME || env.JIMMY_AUTH_USERNAME.includes(':') ||
      !env.JIMMY_AUTH_PASSWORD || env.JIMMY_AUTH_PASSWORD.startsWith('replace-with-') ||
      !env.VOICE_SERVICE_SECRET || env.VOICE_SERVICE_SECRET.length < 32 || env.VOICE_SERVICE_SECRET.startsWith('replace-with-')) {
    throw new Error('Set a username, a private password and a VOICE_SERVICE_SECRET of at least 32 characters in .env.local. Existing files are never overwritten.');
  }
  const hosts = (env.JIMMY_ALLOWED_HOSTS || '').split(',').map(host => host.trim());
  if (!hosts.includes('localhost') || !hosts.includes('127.0.0.1')) throw new Error('Include localhost and 127.0.0.1 in JIMMY_ALLOWED_HOSTS in .env.local.');
}

export async function ensureSilero(directory) {
  const target = path.join(directory, 'voice-service/models/silero_vad_16k_op15.onnx');
  const matches = bytes => createHash('sha256').update(bytes).digest('hex') === sileroHash;
  try {
    if (!matches(await readFile(target))) throw new Error('Existing Silero model has an unexpected checksum. Move it aside and run setup again.');
    return;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  console.log('Downloading Silero VAD v6.2.1 (checksum verified)…');
  const response = await fetch(sileroURL, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Silero download failed (HTTP ${response.status}). Run setup again when connected.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!matches(bytes)) throw new Error('Silero download checksum did not match. No model was installed.');
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: 'wx' });
    await rename(temporary, target);
  } finally { await rm(temporary, { force: true }); }
}

function run(file, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: root, stdio: 'inherit', windowsHide: true });
    child.once('error', error => reject(new Error(`Could not run ${path.basename(file)}: ${error.message}. See SETUP.md.`)));
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${path.basename(file)} ${args[0]} failed (exit ${code}). Fix the reported error, then run npm run setup again.`)));
  });
}

async function setup() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || major === 22 && minor < 13) throw new Error('Install Node.js 22.13 or newer, then reopen your terminal.');
  if (process.platform !== 'win32') throw new Error('The desktop setup supports Windows. See README.md for the browser and voice services.');
  if (!process.env.npm_execpath) throw new Error('Run this using npm run setup.');
  console.log('Checking Docker Desktop (Linux containers) and Ollama. Start both apps first.');
  const docker = spawnSync('docker', ['info', '--format', '{{.OSType}}'], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  if (docker.status !== 0) throw new Error('Install and open Docker Desktop, wait for its engine to start, then retry. See SETUP.md.');
  if (docker.stdout.trim() !== 'linux') throw new Error('Switch Docker Desktop to Linux containers, then retry.');
  await run('docker', ['compose', 'version']);
  await run('ollama', ['--version']);
  try {
    const response = await fetch('http://127.0.0.1:11434/api/version', { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Ollama is not ready');
  } catch { throw new Error('Open Ollama, wait for it to start, then run setup again.'); }
  console.log('Installing the exact JavaScript dependencies from package-lock.json…');
  await run(process.execPath, [process.env.npm_execpath, 'ci']);
  const created = await createEnvironment(root);
  console.log(created ? 'Created private .env.local. Credentials are stored there, not printed.' : 'Keeping your existing .env.local and credentials.');
  const { default: nextEnv } = await import('@next/env');
  nextEnv.loadEnvConfig(root, false);
  validateEnvironment(process.env);
  try { await access(path.join(root, 'node_modules/electron/dist/electron.exe')); }
  catch { await run(process.execPath, [path.join(root, 'node_modules/electron/install.js')]); }
  await ensureSilero(root);
  console.log('Preparing the persistent voice-model cache and building voice images (first run can take a while)…');
  await run('docker', ['volume', 'create', 'johnny-voice-models']);
  await run('docker', ['compose', '--env-file', '.env.local', '-f', 'voice-service/compose.yaml', 'build', 'voice', 'tts']);
  console.log('Downloading and checking Moonshine and the default Kokoro voice in temporary containers…');
  const compose = ['compose', '--env-file', '.env.local', '-f', 'voice-service/compose.yaml', 'run', '--rm', '--no-deps'];
  await run('docker', [...compose, 'voice', 'python', '-c', 'import asyncio; from app.config import Settings; from app.asr import MoonshineAsr; s=Settings(); m=MoonshineAsr(s.moonshine_model,s.moonshine_cache); asyncio.run(m.load()); assert m.status.state == "ready", m.status.error']);
  await run('docker', [...compose, 'tts', 'python', '-c', 'import asyncio; from app.config import Settings; from app.tts import KokoroTts; s=Settings(); m=KokoroTts(s.tts_language,s.tts_voice,s.tts_speed); asyncio.run(m.load()); assert m.status.state == "ready", m.status.error']);
  console.log('Downloading the configured chat model…');
  await run('ollama', ['pull', process.env.OLLAMA_MODEL || 'qwen3:4b-instruct']);
  console.log('Building the desktop interface…');
  await run(process.execPath, [process.env.npm_execpath, 'run', 'build']);
  console.log('\nSetup complete. Run npm run desktop:start.\nRename your assistant in Settings > General.\nOptional integrations and troubleshooting: SETUP.md.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  setup().catch(error => { console.error(`\nSetup stopped: ${error.message}`); process.exitCode = 1; });
}
