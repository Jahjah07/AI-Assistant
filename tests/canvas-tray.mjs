import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Exercise the desktop's actual window/menu functions without starting voice services.
const source = await readFile('desktop/main.mjs', 'utf8');
const windows = [];
class Window extends EventEmitter {
  constructor(options) {
    super(); this.options = options; this.url = ''; this.visible = false; this.minimized = false; this.loads = 0;
    this.webContents = new EventEmitter();
    this.webContents.getURL = () => this.url;
    this.webContents.setWindowOpenHandler = handler => { this.popupHandler = handler; };
    windows.push(this);
  }
  isDestroyed() { return false; }
  isVisible() { return this.visible; }
  isMinimized() { return this.minimized; }
  restore() { this.minimized = false; }
  async loadURL(url) { this.url = url; this.loads++; }
  show() { this.visible = true; this.emit('show'); }
  hide() { this.visible = false; this.emit('hide'); }
  focus() { this.focused = true; }
  setTitle(title) { this.title = title; }
  close() { const event = { preventDefault() { this.prevented = true; } }; this.emit('close', event); return event; }
}
let menu;
const context = vm.createContext({ URL, Buffer, BrowserWindow: Window, fail: reason => { throw reason; },
  origin: 'http://127.0.0.1:3002', assistantName: 'Jarvis', closing: false, expanded: false, services: null, error: '', phase: 'Ready', muted: false, pinned: true,
  canvasWindow: null, tray: { setContextMenu: value => { menu = value; } },
  win: { getBounds: () => ({}), webContents: { getURL: () => 'http://127.0.0.1:3002/' } },
  screen: { getDisplayMatching: () => ({ workArea: { width: 1000, height: 700 } }) },
  Menu: { buildFromTemplate: template => template }, nativeImage: { createFromBitmap: () => ({}) },
});
vm.runInContext(source.slice(source.indexOf('function trusted('), source.indexOf('function registerIpc(')), context);
// Keep the reactor's layout outside this canvas lifecycle check.
vm.runInContext('resize = () => {}', context);
await context.openCanvas();
const canvas = windows[0];
assert.equal(canvas.options.title, 'Jarvis Canvas');
assert.ok(menu.some(item => item.label === 'Show floating Jarvis'));
assert.ok(menu.some(item => item.label === 'Shut down Jarvis and unload models'));
assert.equal(canvas.url, 'http://127.0.0.1:3002/canvas');
assert.equal(canvas.options.width, 1000);
assert.equal(canvas.options.height, 700);
assert.equal(canvas.options.webPreferences.nodeIntegration, false);
assert.equal(canvas.options.webPreferences.sandbox, true);
const session = '12345678-1234-1234-1234-123456789abc';
await context.openCanvas(session);
const loads = canvas.loads;
assert.ok(canvas.url.endsWith('?session=' + session));
assert.equal(canvas.close().prevented, true, 'X hides instead of destroying the canvas');
assert.equal(canvas.visible, false);
assert.equal(menu.find(item => item.label === 'Hide canvas to tray').enabled, false);
canvas.minimized = true;
menu.find(item => item.label === 'Open canvas').click();
assert.equal(canvas.visible, true);
assert.equal(canvas.minimized, false);
assert.equal(canvas.loads, loads, 'Restoring retains the document without reloading');
assert.equal(windows.length, 1, 'Tray reuses the existing canvas window');
menu.find(item => item.label === 'Hide canvas to tray').click();
assert.equal(canvas.visible, false);
let blocked = false;
canvas.webContents.emit('will-navigate', { preventDefault: () => { blocked = true; } }, 'https://example.com/canvas');
assert.equal(blocked, true);
assert.equal(canvas.popupHandler().action, 'deny');
context.closing = true;
assert.equal(canvas.close().prevented, undefined, 'Shutdown may close the canvas');
await context.openCanvas();
assert.equal(canvas.visible, false, 'Shutdown cannot reopen the canvas');
console.log('Passed: canvas tray open/hide/restore, session preservation, monitor bounds, navigation restrictions and shutdown.');

const handlers = new Map();
context.ipcMain = { handle: (name, handler) => handlers.set(name, handler) };
context.win.setTitle = title => { context.win.title = title; };
context.win.isDestroyed = () => false;
context.win.webContents.send = () => {};
context.win.webContents.mainFrame = { url: context.origin };
context.tray.setToolTip = text => { context.tray.tooltip = text; };
vm.runInContext(source.slice(source.indexOf('function registerIpc('), source.indexOf('async function boot(')), context);
context.registerIpc();
const rename = handlers.get('jimmy:assistant-name');
const event = { sender: context.win.webContents, senderFrame: context.win.webContents.mainFrame };
let hidden = false;
context.win.hide = () => { hidden = true; };
context.expanded = true;
canvas.show();
handlers.get('jimmy:hide')(event);
assert.equal(hidden, true, 'Minimize hides the main window');
assert.equal(canvas.visible, false, 'Minimize also hides the canvas without destroying it');
assert.equal(context.expanded, true, 'Hiding preserves dashboard mode instead of collapsing it');
assert.throws(() => rename({ sender: {} }, 'Nova'), /Only the Jimmy desktop window/);
assert.throws(() => rename(event, '<script>'), /Invalid assistant name/);
rename(event, 'Nova');
assert.equal(context.win.title, 'Nova');
assert.equal(canvas.title, 'Nova Canvas');
assert.match(context.tray.tooltip, /^Nova —/);
assert.ok(menu.some(item => item.label === 'Show floating Nova'));
context.phase = 'Say “Jimmy” to wake me';
assert.equal(context.state().phase, 'Say “Nova” to wake me');
context.assistantName = 'Jarvis';
assert.equal(context.state().phase, 'Say “Jarvis” to wake me', 'Existing status text follows later renames');
console.log('Passed: trusted rename IPC updates native titles, tray menu and tooltip; invalid names and other renderers are rejected.');
