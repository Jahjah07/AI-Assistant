import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile('app/lib/appearance.ts', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { validUiColor, savedUiColor, saveUiColor, DEFAULT_UI_COLOR, UI_COLOR_STORAGE_KEY } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const originalStorage = globalThis.localStorage, originalWindow = globalThis.window;
try {
  assert.equal(savedUiColor(), DEFAULT_UI_COLOR);
  for (const color of ['#ff0000', '#000000', '#FFFFFF', '#A1b2C3']) assert.ok(validUiColor(color));
  for (const color of ['', '#fff', 'red', '#ffffff00', 'url(evil)', null, 123]) assert.equal(validUiColor(color), false);
  const storage = new Map();
  const events = [];
  globalThis.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) };
  globalThis.window = { dispatchEvent: event => events.push(event.type) };
  saveUiColor('#FF22AA');
  assert.equal(savedUiColor(), '#ff22aa');
  assert.deepEqual(events, ['ui-color-changed']);
  assert.throws(() => saveUiColor('invalid'), /valid UI color/);
  assert.equal(savedUiColor(), '#ff22aa', 'Invalid input preserves the previous choice');
  storage.set(UI_COLOR_STORAGE_KEY, 'bad saved value');
  assert.equal(savedUiColor(), DEFAULT_UI_COLOR);
  globalThis.localStorage = { getItem() { throw new Error('Storage blocked'); }, setItem() { throw new Error('Storage blocked'); } };
  assert.equal(savedUiColor(), DEFAULT_UI_COLOR);
  assert.throws(() => saveUiColor('#112233'), /Storage blocked/);
  console.log('Passed: validated color persistence, change events, invalid-value fallback and blocked-storage handling.');
} finally { globalThis.localStorage = originalStorage; globalThis.window = originalWindow; }
