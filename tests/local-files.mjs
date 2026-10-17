import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import childProcess from 'node:child_process';
import { promisify } from 'node:util';
import { syncBuiltinESMExports } from 'node:module';
import ts from 'typescript';

const root = process.cwd();
await mkdir('.jimmy-runtime', { recursive: true });
const temporary = await mkdtemp(path.join(root, '.jimmy-runtime', 'files-test-'));
const originalExec = childProcess.execFile;
const originalFetch = globalThis.fetch;
try {
  for (const source of ['app/lib/local-files', 'app/lib/voice-commands', 'app/lib/todos', 'app/lib/canvas', 'app/api/_security', 'app/api/_limits', 'app/api/model-settings/settings', 'app/api/local-files/scan', 'app/api/local-files/intent', 'app/api/local-files/route']) {
    const code = ts.transpileModule(await readFile(source + '.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from "(\.[^"]+)"/g, 'from "$1.mjs"');
    await mkdir(path.dirname(path.join(temporary, source)), { recursive: true });
    await writeFile(path.join(temporary, source + '.mjs'), code);
  }
  const load = source => import(pathToFileURL(path.join(temporary, source + '.mjs')));
  const { parseFileCommand, mayBeFileRequest, fileSearchFollowUp } = await load('app/lib/local-files');
  const { parseVoiceCommand } = await load('app/lib/voice-commands');
  const expected = { kind: 'local-files', action: 'search', scope: 'Downloads', query: 'gengar-keycap' };
  assert.deepEqual(parseVoiceCommand('Jimmy, find gengar-keycap in my Downloads and show it on the canvas'), expected);
  assert.deepEqual(parseFileCommand('find a file in my download folder and the name is gengar-keycap'), { ...expected, scope: 'my download folder' });
  assert.deepEqual(parseFileCommand('find a file called invoice'), { ...expected, scope: 'computer', query: 'invoice' });
  for (const phrase of ["What's making my storage full?", 'find whats making my storage full', 'What is taking up space on my laptop?', 'check my storage', 'find the largest files']) {
    assert.deepEqual(parseVoiceCommand(phrase), { kind: 'local-files', action: 'storage', scope: 'computer' }, phrase);
  }
  assert.deepEqual(parseVoiceCommand('Analyze storage in Downloads'), { kind: 'local-files', action: 'storage', scope: 'Downloads' });
  assert.equal(parseVoiceCommand('Cancel scan').action, 'cancel');
  for (const phrase of ['Do not find files in Downloads', 'Explain how to find files in Downloads', 'delete my largest files', 'find pictures of cats', 'open ChatGPT', 'open ChatGPT in my browser', 'find gengar pictures on Google', 'show my to-do list']) assert.equal(parseFileCommand(phrase), null, phrase);
  for (const phrase of ["My SSD is almost full, figure out what's eating it", 'Could you dig up that gengar keycap I downloaded?', 'Where did I save my invoice file?', 'My laptop is running out of room']) assert.equal(mayBeFileRequest(phrase, null), true);
  assert.equal(mayBeFileRequest('Maybe Desktop instead', { request: 'Find gengar', command: expected }), true);
  const previousSearch = { request: 'Find Gengar K-Cups in Downloads', command: { ...expected, query: 'Gengar K-Cups' } };
  assert.equal(mayBeFileRequest('Find the Gengar K-Cups.', previousSearch), true);
  assert.deepEqual(fileSearchFollowUp('Find the Gengar K-Cups.', previousSearch), { ...expected, query: 'Gengar K-Cups' });
  assert.equal(fileSearchFollowUp('Find gengar on Google', previousSearch), null);
  assert.equal(fileSearchFollowUp('Find gengar in Desktop', previousSearch), null);
  assert.equal(fileSearchFollowUp('Find the largest files', previousSearch), null);
  assert.equal(fileSearchFollowUp('Find a model and delete it', previousSearch), null);
  assert.equal(mayBeFileRequest('gengar-keycap', { request: 'Find a file', question: 'What is it called?' }), true);
  assert.equal(mayBeFileRequest('How are you?', null), false);
  const { fileIntentResult, interpretFileRequest, validateFileContext } = await load('app/api/local-files/intent');
  const intent = (action, scope = '', query = '', question = '') => ({ action, scope, query, question });
  assert.deepEqual(fileIntentResult(intent('search', 'downloads', 'gengar keycap'), 'Could you dig up gengar keycap? I downloaded it.'), { command: { ...expected, scope: 'downloads', query: 'gengar keycap' }, question: '' });
  assert.equal(fileIntentResult(intent('search', 'desktop', 'gengar-keycap'), 'Try Desktop instead', { request: 'Find gengar-keycap', command: expected }).command.scope, 'desktop');
  assert.ok(fileIntentResult(intent('search', 'computer', 'invented-file'), 'Find my model').question);
  assert.ok(fileIntentResult(intent('search', 'computer'), 'Find my file').question);
  assert.ok(fileIntentResult(intent('search', 'computer', '3D model'), 'Bring up that 3D model').question);
  assert.ok(fileIntentResult(intent('storage', 'C:\\Invented'), 'Check storage').question);
  assert.equal(fileIntentResult(intent('none'), 'What is a 3MF file?').command, null);
  assert.throws(() => fileIntentResult(intent('delete'), 'Delete a file'), /Invalid/);
  assert.equal(validateFileContext({ request: 1 }), false);
  let modelResult = intent('storage', 'computer'), modelRequest;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:11434/api/chat');
    modelRequest = JSON.parse(options.body);
    return Response.json({ message: { content: JSON.stringify(modelResult) } });
  };
  assert.equal((await interpretFileRequest('My laptop is running out of space, find out why', undefined, new AbortController().signal)).command.action, 'storage');
  assert.equal(modelRequest.stream, false);
  assert.equal(modelRequest.options.temperature, 0);
  assert.ok(modelRequest.format.properties.action.enum.includes('clarify'));
  assert.deepEqual((await interpretFileRequest('Find the Gengar K-Cups.', previousSearch, new AbortController().signal)).command, { ...expected, query: 'Gengar K-Cups' });

  const fixture = path.join(temporary, 'fixture');
  await mkdir(path.join(fixture, 'nested'), { recursive: true });
  await writeFile(path.join(fixture, 'gengar-keycap.3mf'), 'model');
  await writeFile(path.join(fixture, 'nested', 'large.bin'), Buffer.alloc(2048));
  await writeFile(path.join(fixture, 'notes.txt'), 'notes');
  const { scanFiles, selectRoots, previewTokens, readModelToken } = await load('app/api/local-files/scan');
  const signal = new AbortController().signal;
  const laptop = { home: fixture, folders: { downloads: fixture }, drives: [fixture] };
  assert.deepEqual(await selectRoots('my download folder', laptop), [await realpath(fixture)]);
  await assert.rejects(() => selectRoots(path.dirname(fixture), laptop), /Only local fixed drives/);
  await assert.rejects(() => selectRoots('\\\\server\\share', laptop), /Choose Downloads/);
  const search = await scanFiles([fixture], 'gengar keycap', signal);
  assert.equal(search.matches, 1);
  assert.equal(search.files[0].name, 'gengar-keycap.3mf');
  assert.equal(search.suggested, false);
  const misheard = await scanFiles([fixture], 'Gengar K-Cups', signal);
  assert.equal(misheard.suggested, true);
  assert.equal(misheard.files[0].name, 'gengar-keycap.3mf');
  assert.equal(misheard.matches, 1);
  assert.equal((await scanFiles([fixture], 'unrelated model', signal)).matches, 0, 'Generic words alone must not suggest files');
  const storage = await scanFiles([fixture], undefined, signal);
  assert.equal(storage.totalBytes, 2058);
  assert.equal(storage.largest[0].name, 'large.bin');
  assert.equal(storage.folders[0][0], path.join(fixture, 'nested'));
  assert.equal(storage.partial, false);
  assert.equal((await scanFiles([fixture], undefined, signal, { entries: 1, milliseconds: 20000 })).partial, true);
  await assert.rejects(() => scanFiles([fixture], '...', signal), /letters or numbers/);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(() => scanFiles([fixture], undefined, aborted.signal), /abort/i);
  const [model] = previewTokens(search.files);
  assert.ok(model.modelToken);
  assert.equal((await readModelToken(model.modelToken)).toString(), 'model');
  assert.equal(previewTokens(storage.largest).find(file => file.name === 'large.bin').modelToken, undefined);
  await assert.rejects(() => readModelToken('not-a-token'), /expired/);
  // Junction creation on Windows does not require developer mode or administrator access.
  await symlink(fixture, path.join(fixture, 'loop'), 'junction');
  const linked = await scanFiles([fixture], 'gengar', signal);
  assert.equal(linked.matches, 1);
  assert.ok(linked.skipped >= 1, 'Directory links must not be traversed');
  const { validCanvasContent } = await load('app/lib/canvas');
  assert.ok(validCanvasContent({ title: 'Files', blocks: [{ type: 'files', entries: [model], autoPreview: true }] }));
  assert.equal(validCanvasContent({ title: 'Files', blocks: [{ type: 'files', entries: [{ ...model, modelToken: '../secret' }] }] }), false);

  childProcess.execFile = () => {};
  childProcess.execFile[promisify.custom] = async () => ({ stdout: JSON.stringify({ folders: { downloads: fixture }, drives: [fixture] }) });
  syncBuiltinESMExports();
  process.env.JIMMY_AUTH_USERNAME = 'test'; process.env.JIMMY_AUTH_PASSWORD = 'test'; process.env.JIMMY_ALLOWED_HOSTS = 'localhost';
  const { POST } = await load('app/api/local-files/route');
  const request = (body, extra = {}) => new Request('http://localhost/api/local-files', { method: 'POST', headers: { host: 'localhost', origin: 'http://localhost', authorization: 'Basic ' + btoa('test:test'), 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) });
  const interpreted = await POST(request({ action: 'interpret', text: 'My laptop is running out of space, find out why' }));
  assert.equal((await interpreted.json()).command.action, 'storage');
  modelResult = intent('clarify', '', '', 'What part of the filename do you remember?');
  assert.match((await (await POST(request({ action: 'interpret', text: 'Could you find my 3D model?' }))).json()).question, /filename/);
  assert.equal((await POST(request({ action: 'interpret', text: 'test', previous: { request: 123 } }))).status, 400);
  modelResult = intent('delete');
  assert.equal((await POST(request({ action: 'interpret', text: 'Delete my files' }))).status, 503);
  modelResult = intent('none');
  assert.equal((await (await POST(request({ action: 'interpret', text: 'What is a 3MF file?' }))).json()).command, null);
  const result = await POST(request({ action: 'search', scope: 'Downloads', query: 'gengar' }));
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.ok(validCanvasContent(data.canvas));
  assert.equal(data.canvas.blocks[0].autoPreview, true);
  assert.ok(!data.reply.includes(fixture), 'Local paths must not enter the chat history');
  const suggestionResult = await POST(request({ action: 'search', scope: 'Downloads', query: 'Gengar K-Cups' }));
  const suggestionData = await suggestionResult.json();
  assert.match(suggestionData.reply, /possible match/);
  assert.match(suggestionData.canvas.note, /No exact filename match/);
  assert.equal(suggestionData.canvas.blocks[0].autoPreview, false, 'Possible matches must require the user to choose');
  assert.equal(suggestionData.canvas.blocks[0].entries[0].name, 'gengar-keycap.3mf');
  const download = await POST(request({ action: 'model', token: data.canvas.blocks[0].entries[0].modelToken }));
  assert.equal(download.status, 200);
  assert.equal(await download.text(), 'model');
  assert.equal(download.headers.get('cache-control'), 'no-store');
  await writeFile(path.join(fixture, 'gengar-keycap-v2.stl'), 'second model');
  const multiple = await (await POST(request({ action: 'search', scope: 'Downloads', query: 'gengar' }))).json();
  assert.equal(multiple.canvas.blocks[0].entries.length, 2);
  assert.equal(multiple.canvas.blocks[0].autoPreview, false, 'Ambiguous searches must not choose a model');
  const report = await POST(request({ action: 'storage', scope: 'Downloads' }));
  const reportData = await report.json();
  assert.ok(validCanvasContent(reportData.canvas));
  assert.ok(!reportData.reply.includes(fixture));
  assert.equal((await POST(request({ action: 'delete', scope: 'Downloads' }))).status, 400);
  assert.equal((await POST(request({ action: 'model', token: 'not-a-token' }))).status, 400);
  assert.equal((await POST(request({ action: 'search', query: 'x' }, { authorization: '' }))).status, 401);
  assert.equal((await POST(request({ action: 'search', query: 'x' }, { origin: 'https://evil.example' }))).status, 403);
  assert.equal((await POST(request({ action: 'search', query: 'x' }, { 'x-forwarded-for': '192.168.1.2' }))).status, 403);
  await rm(path.join(fixture, 'gengar-keycap.3mf'));
  await assert.rejects(() => readModelToken(model.modelToken));
  console.log('Passed: natural file intent validation, clarifications, follow-up context, local-only structured inference, scoped search, bounded storage scans, cancellation, preview tokens and endpoint security. Inference mocked; scans use fixtures.');
  if (process.argv.includes('--live-intent')) {
    globalThis.fetch = originalFetch;
    const examples = [
      ["My laptop's nearly out of room. Can you figure out what's eating all the space?", undefined, 'storage'],
      ['Could you dig up gengar-keycap? Pretty sure I downloaded it.', undefined, 'search'],
      ['Maybe Desktop instead.', { request: 'Find gengar-keycap in Downloads', command: expected }, 'search'],
      ['Can you bring up that 3D model for me?', undefined, 'clarify'],
      ["What's a 3MF file?", undefined, 'none'],
      ['gengar-keycap', { request: 'Could you find the model I downloaded?', question: 'What is it called?' }, 'search'],
    ];
    for (const [text, previous, action] of examples) {
      const actual = await interpretFileRequest(text, previous, new AbortController().signal);
      assert.equal(actual.command?.action || (actual.question ? 'clarify' : 'none'), action, text);
      if (actual.command?.action === 'search') assert.match(actual.command.query, /gengar/i);
      if (text.includes('downloaded it')) assert.equal(actual.command.scope.toLowerCase(), 'downloads');
      if (text.includes('Desktop instead')) assert.equal(actual.command.scope.toLowerCase(), 'desktop');
      console.log(`Live local model passed: ${text}`);
    }
  }
} finally {
  globalThis.fetch = originalFetch;
  childProcess.execFile = originalExec; syncBuiltinESMExports();
  await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
