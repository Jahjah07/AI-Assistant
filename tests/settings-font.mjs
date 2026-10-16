import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile('app/lib/settings-font.ts', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { SETTINGS_FONT_STORAGE_KEY, MAX_FONT_BYTES, savedSettingsFont, parseSettingsFont, chooseSettingsFont, uploadSettingsFont, removeUploadedSettingsFont } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const original = { localStorage: globalThis.localStorage, window: globalThis.window, FontFace: globalThis.FontFace, FileReader: globalThis.FileReader };
try {
  const store = new Map(), events = [];
  globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  globalThis.window = { dispatchEvent: event => events.push(event.type) };
  let invalidFont = false;
  globalThis.FontFace = class { async load() { if (invalidFont) throw new Error('Invalid font'); return this; } };
  globalThis.FileReader = class {
    readAsDataURL(blob) {
      void blob.arrayBuffer().then(bytes => {
        this.result = 'data:application/octet-stream;base64,' + Buffer.from(bytes).toString('base64');
        this.onload();
      });
    }
  };
  assert.deepEqual(parseSettingsFont(savedSettingsFont()), { font: 'system' });
  chooseSettingsFont('verdana');
  assert.equal(parseSettingsFont(savedSettingsFont()).font, 'verdana');
  assert.equal(events.at(-1), 'settings-font-changed');
  assert.throws(() => chooseSettingsFont('evil; url(remote)'), /available settings font/);
  assert.throws(() => chooseSettingsFont('custom'), /available settings font/);
  await assert.rejects(uploadSettingsFont(new File(['bad'], 'script.svg')), /WOFF/);
  await assert.rejects(uploadSettingsFont(new File([], 'empty.ttf')), /non-empty/);
  await assert.rejects(uploadSettingsFont({ name: 'large.ttf', size: MAX_FONT_BYTES + 1 }), /1 MiB/);
  const file = new File(['fixture-font-bytes'], 'Readable.ttf');
  invalidFont = true;
  await assert.rejects(uploadSettingsFont(file), /could not be loaded/);
  assert.equal(parseSettingsFont(savedSettingsFont()).font, 'verdana');
  invalidFont = false;
  await uploadSettingsFont(file);
  const uploaded = parseSettingsFont(savedSettingsFont());
  assert.equal(uploaded.font, 'custom');
  assert.equal(uploaded.upload.name, 'Readable.ttf');
  assert.ok(uploaded.upload.data.startsWith('data:application/octet-stream;base64,'));
  chooseSettingsFont('arial');
  assert.equal(parseSettingsFont(savedSettingsFont()).upload.name, 'Readable.ttf', 'Preset changes keep the uploaded font available');
  chooseSettingsFont('custom');
  removeUploadedSettingsFont();
  assert.deepEqual(parseSettingsFont(savedSettingsFont()), { font: 'system' });
  for (const raw of ['{broken', 'null', JSON.stringify({ font: 'custom', upload: { name: 'Remote', data: 'https://example.com/font.ttf' } }), JSON.stringify({ font: 'unknown' })]) {
    assert.deepEqual(parseSettingsFont(raw), { font: 'system' });
  }
  store.set(SETTINGS_FONT_STORAGE_KEY, uploaded.upload.data);
  assert.deepEqual(parseSettingsFont(savedSettingsFont()), { font: 'system' });
  globalThis.localStorage = { getItem() { throw new Error('Blocked'); }, setItem() { throw new Error('Blocked'); } };
  assert.equal(savedSettingsFont(), null);
  assert.throws(() => chooseSettingsFont('arial'), /Allow site storage/);
  console.log('Passed: saved font choices, upload size/type and native-load validation, local-only font data, switching/removal and blocked-storage fallback.');
} finally { Object.assign(globalThis, original); }
