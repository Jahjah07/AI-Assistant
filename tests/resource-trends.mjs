import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Exercise the exported chart math without mounting the React component.
const source = (await readFile('app/components/ResourceMonitor.tsx', 'utf8')).replace(/^import .* from "react";\r?\n/m, '');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
const { trendPath } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const now = 1000000;
assert.equal(trendPath([], now), '');
assert.equal(trendPath([{ at: now, value: 50 }], now), 'M198.0,22.0');
assert.equal(trendPath([{ at: now - 5000, value: 10 }, { at: now, value: 90 }], now), 'M192.6,38.0 L198.0,6.0');
assert.equal(trendPath([{ at: now - 10000, value: 20 }, { at: now - 5000, value: null }, { at: now, value: 80 }], now).match(/M/g).length, 2, 'Missing telemetry breaks the line instead of becoming zero');
assert.equal(trendPath([{ at: now - 20000, value: 20 }, { at: now, value: 80 }], now).match(/M/g).length, 2, 'Suspended polling leaves a gap');
assert.equal(trendPath([{ at: now - 180001, value: 90 }, { at: now, value: 50 }], now).trim(), 'M198.0,22.0', 'Old samples are outside the visible window');
assert.equal(trendPath([{ at: now - 5000, value: -5 }, { at: now, value: 120 }], now), 'M192.6,42.0 L198.0,2.0');
assert.ok(!trendPath([{ at: now, value: NaN }], now).includes('NaN'));
console.log('Passed: time-scaled usage lines, spike positions, missing-data and background gaps, fixed percentage scale and bounds.');
