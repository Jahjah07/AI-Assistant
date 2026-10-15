import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile('browser-extension/background.js', 'utf8');
let settings = { enabled: true, username: 'test', password: 'test', lastEntry: '' };
let tab = { active: true, title: 'Presentation', url: 'https://docs.example.com/deck?token=secret#fragment', incognito: false };
let focused = true, idle = 'active';
const requests = [];
let activate;
const listener = { addListener() {} };
const chrome = {
  storage: { local: { get: async () => settings, set: async value => { settings = { ...settings, ...value }; }, setAccessLevel() {} }, onChanged: listener },
  idle: { queryState: async () => idle }, windows: { getLastFocused: async () => ({ focused, id: 1 }), onFocusChanged: listener },
  tabs: { query: async () => [tab], onActivated: { addListener: callback => { activate = callback; } }, onUpdated: listener },
  action: { setBadgeText: async () => {}, setTitle: async () => {}, onClicked: listener },
  runtime: { onInstalled: listener, onStartup: listener }, alarms: { onAlarm: listener },
};
vm.runInNewContext(source, { chrome, URL, Date, TextEncoder, btoa, AbortSignal, fetch: async (_url, options) => {
  requests.push(JSON.parse(options.body)); return Response.json({ recorded: true, enabled: true });
} });
const run = async () => { activate(); await new Promise(resolve => setTimeout(resolve, 20)); };
await run(); assert.equal(requests.length, 1); assert.equal(requests[0].url, 'https://docs.example.com/deck');
await run(); assert.equal(requests.length, 1, 'Repeated pages are suppressed');
settings.lastEntry = ''; tab.incognito = true; await run(); assert.equal(requests.length, 1);
tab.incognito = false; focused = false; await run(); assert.equal(requests.length, 1);
focused = true; idle = 'idle'; await run(); assert.equal(requests.length, 1);
idle = 'active'; tab.url = 'chrome://settings'; await run(); assert.equal(requests.length, 1);
tab.url = 'http://localhost:3002'; await run(); assert.equal(requests.length, 1);
tab.url = 'https://example.com'; settings.enabled = false; await run(); assert.equal(requests.length, 1);
console.log('Passed: browser sends only active foreground pages; opt-in, private-window, idle, local-page, URL filtering, and duplicate guards.');
