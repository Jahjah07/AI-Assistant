import { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, screen, shell, dialog, desktopCapturer } from 'electron';
import path from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { JimmyServices, origin, root } from './services.mjs';
import { startActivityTracker } from './activity.mjs';

app.setName('Jimmy');
app.setAppUserModelId('local.jimmy.assistant');
// Distinct from other Electron apps, with persistent voice settings.
const testMode = process.argv.includes('--desktop-test');
const legacyData = path.join(app.getPath('appData'), 'Johnny Desktop');
const userData = !testMode && existsSync(legacyData) ? legacyData : path.join(app.getPath('appData'), testMode ? 'Jimmy Desktop Test' : 'Jimmy Desktop');
mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);
if (testMode) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
}
let win;
let canvasWindow;
let tray;
let services;
let starting;
let closing = false;
let expanded = false;
let compactBounds;
let stopActivity;
let muted = false;
let pinned = true;
let error = '';
let phase = 'Starting up…';
let assistantName = 'Jimmy';

function trusted(url) {
  try { return new URL(url).origin === origin; } catch { return false; }
}
function state() { return { expanded, muted, phase: phase.replace(/\bJimmy\b/g, assistantName), error: error.replace(/\bJimmy\b/g, assistantName), awake: services?.awake || false }; }
function broadcast() {
  if (win && !win.isDestroyed()) win.webContents.send('jimmy:state-changed', state());
  tray?.setToolTip(`${assistantName} — ${muted ? 'Microphone muted' : state().phase}`.slice(0, 120));
  updateMenu();
}
function report(message) { phase = message; broadcast(); }

function resize(value) {
  if (!win || win.isDestroyed()) return;
  const current = win.getBounds();
  if (value && !expanded) compactBounds = current;
  expanded = value;
  const position = value ? current : compactBounds || current;
  const display = screen.getDisplayMatching(position);
  const area = display.workArea;
  const width = value ? area.width : Math.min(200, area.width);
  const height = value ? area.height : Math.min(312, area.height);
  win.setBounds({ width, height,
    x: value ? area.x + Math.round((area.width - width) / 2) : Math.max(area.x, Math.min(position.x, area.x + area.width - width)),
    y: value ? area.y + Math.round((area.height - height) / 2) : Math.max(area.y, Math.min(position.y, area.y + area.height - height)),
  });
  win.show();
  broadcast();
}

function hideAssistant() {
  canvasWindow?.hide();
  win?.hide();
}

function updateMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: state().error || state().phase, enabled: false },
    { type: 'separator' },
    { label: `Show floating ${assistantName}`, click: () => resize(false) },
    { label: 'Open chat / settings', click: () => resize(true) },
    { label: 'Open canvas', enabled: !closing && trusted(win?.webContents.getURL()), click: () => { win.webContents.send('jimmy:show-canvas'); } },
    { label: 'Hide canvas to tray', enabled: Boolean(canvasWindow?.isVisible()), click: () => canvasWindow?.hide() },
    { label: 'Hide to tray (keeps listening)', click: hideAssistant },
    { label: 'Mute microphone', type: 'checkbox', checked: muted, click: item => { muted = item.checked; broadcast(); } },
    { label: 'Always on top', type: 'checkbox', checked: pinned, click: item => { pinned = item.checked; win?.setAlwaysOnTop(pinned); } },
    { label: 'Retry startup', enabled: Boolean(error) && !closing, click: () => { void retry(); } },
    { type: 'separator' },
    { label: `Shut down ${assistantName} and unload models`, click: () => { void shutdown(); } },
  ]));
}

function trayIcon() {
  const size = 32;
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const distance = Math.hypot(x - 15.5, y - 15.5);
    const index = (y * size + x) * 4;
    const ring = (distance > 12 && distance < 15) || (distance > 8 && distance < 10);
    pixels[index] = ring ? 235 : 30;
    pixels[index + 1] = ring ? 222 : 24;
    pixels[index + 2] = ring ? 100 : 7;
    pixels[index + 3] = distance < 15.5 ? 255 : 0;
  }
  return nativeImage.createFromBitmap(pixels, { width: size, height: size });
}

async function external(url) {
  try {
    const parsed = new URL(url);
    if (['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password) {
      resize(false);
      await shell.openExternal(parsed.href);
    }
  } catch { /* Invalid navigation is ignored. */ }
}

async function openCanvas(session) {
  if (closing) return;
  if (!canvasWindow || canvasWindow.isDestroyed()) {
    const area = screen.getDisplayMatching(win.getBounds()).workArea;
    canvasWindow = new BrowserWindow({ width: Math.min(1200, area.width), height: Math.min(820, area.height), backgroundColor: '#051218', title: `${assistantName} Canvas`, show: false,
      autoHideMenuBar: true, icon: trayIcon(),
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
    canvasWindow.on('close', event => { if (!closing) { event.preventDefault(); canvasWindow.hide(); } });
    canvasWindow.on('show', updateMenu);
    canvasWindow.on('hide', updateMenu);
    canvasWindow.on('closed', () => { canvasWindow = null; updateMenu(); });
    canvasWindow.webContents.on('will-navigate', (event, target) => {
      if (!trusted(target) || new URL(target).pathname !== '/canvas') event.preventDefault();
    });
    canvasWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  }
  const url = session ? `${origin}/canvas?session=${session}` : canvasWindow.webContents.getURL() || `${origin}/canvas`;
  if (canvasWindow.webContents.getURL() !== url) await canvasWindow.loadURL(url);
  resize(false);
  if (canvasWindow.isMinimized()) canvasWindow.restore();
  canvasWindow.show(); canvasWindow.focus();
}

function registerIpc() {
  const handle = (name, handler) => ipcMain.handle(`jimmy:${name}`, (event, value) => {
    if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || !trusted(event.senderFrame.url)) {
      throw new Error('Only the Jimmy desktop window can use desktop controls.');
    }
    return handler(value);
  });
  handle('state', () => state());
  handle('assistant-name', name => {
    if (typeof name !== 'string' || !/^[\p{L}][\p{L}\p{N} '-]{0,23}$/u.test(name) || name !== name.trim()) throw new Error('Invalid assistant name.');
    assistantName = name;
    win.setTitle(name);
    canvasWindow?.setTitle(`${name} Canvas`);
    broadcast();
  });
  handle('expand', value => { resize(value === true); return state(); });
  handle('mute', value => { muted = value === true; broadcast(); return state(); });
  handle('hide', hideAssistant);
  handle('open-canvas', async session => {
    if (typeof session !== 'string' || !/^[a-f0-9-]{36}$/.test(session)) throw new Error('Invalid canvas session.');
    await openCanvas(session);
  });
  handle('close-canvas', () => canvasWindow?.close());
  handle('capture-screen', async () => {
    if (closing) throw new Error('Jimmy is shutting down.');
    const display = screen.getDisplayMatching(win.getBounds());
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1600, height: 1000 } });
    const source = sources.find(item => item.display_id === String(display.id));
    if (!source || source.thumbnail.isEmpty()) throw new Error('Could not capture this monitor.');
    return source.thumbnail.toJPEG(80).toString('base64');
  });
  handle('wake', async () => {
    if (closing) throw new Error('Jimmy is shutting down.');
    error = '';
    try { await services.wake(); }
    catch { error = 'Voice could not wake up. Check Docker and try saying Jimmy again.'; broadcast(); throw new Error(error); }
    broadcast();
    return state();
  });
  handle('shutdown', () => { setImmediate(() => { void shutdown(); }); return true; });
}

async function boot() {
  error = '';
  if (testMode) {
    services = { awake: false, wake: async () => { services.awake = true; report('Ready'); }, stop: async () => [] };
  } else {
    services = new JimmyServices(report);
    await services.start();
  }
  if (closing) return;
  await win.loadURL(origin);
  if (!testMode) { stopActivity?.(); stopActivity = startActivityTracker(root, origin); }
  broadcast();
}
async function retry() {
  if (starting || closing) return;
  await services?.stop();
  starting = boot().catch(fail).finally(() => { starting = null; });
}
function fail(reason) {
  if (closing) return;
  error = reason.message || 'Startup failed';
  phase = 'Startup needs attention';
  broadcast();
}
async function shutdown() {
  if (closing) return;
  closing = true;
  stopActivity?.();
  report('Shutting down…');
  // Destroy the renderer first: capture, playback and network requests end now.
  if (win && !win.isDestroyed()) win.destroy();
  if (canvasWindow && !canvasWindow.isDestroyed()) canvasWindow.destroy();
  services?.abort?.abort();
  if (starting) await starting.catch(() => {});
  const failures = await services?.stop() || [];
  if (failures.length) await dialog.showMessageBox({ type: 'warning', title: `${assistantName} shutdown`, message: failures.join('\n') });
  tray?.destroy();
  app.exit(0);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { win?.show(); });
  app.on('before-quit', event => { if (!closing) { event.preventDefault(); void shutdown(); } });
  app.on('window-all-closed', () => {});
  void app.whenReady().then(async () => {
  const area = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({ width: 200, height: 312, x: area.x + area.width - 224, y: area.y + area.height - 358,
    frame: false, transparent: true, resizable: false, alwaysOnTop: true, skipTaskbar: true,
    backgroundColor: '#00000000', title: 'Jimmy', show: false,
    webPreferences: { preload: path.join(root, 'desktop/preload.cjs'), contextIsolation: true, sandbox: true,
      nodeIntegration: false, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  let fitTimer;
  const fitMonitor = () => {
    if (!expanded || win.isDestroyed()) return;
    const bounds = win.getBounds();
    const available = screen.getDisplayMatching(bounds).workArea;
    if (['x', 'y', 'width', 'height'].some(key => bounds[key] !== available[key])) resize(true);
  };
  win.on('move', () => {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(fitMonitor, 150);
  });
  screen.on('display-metrics-changed', fitMonitor);
  screen.on('display-removed', fitMonitor);
  win.on('closed', () => {
    clearTimeout(fitTimer);
    screen.removeListener('display-metrics-changed', fitMonitor);
    screen.removeListener('display-removed', fitMonitor);
  });
  win.on('close', event => { if (!closing) { event.preventDefault(); resize(false); } });
  win.webContents.on('will-navigate', (event, url) => { if (!trusted(url)) { event.preventDefault(); void external(url); } });
  win.webContents.setWindowOpenHandler(({ url }) => { void external(url); return { action: 'deny' }; });
  win.webContents.on('context-menu', () => tray?.popUpContextMenu());
  const session = win.webContents.session;
  const auth = Buffer.from(`${process.env.JIMMY_AUTH_USERNAME}:${process.env.JIMMY_AUTH_PASSWORD}`).toString('base64');
  session.webRequest.onBeforeSendHeaders({ urls: [`${origin}/*`] }, (details, callback) => {
    if (win && !win.isDestroyed() && details.webContentsId === win.webContents.id || canvasWindow && !canvasWindow.isDestroyed() && details.webContentsId === canvasWindow.webContents.id) details.requestHeaders.Authorization = `Basic ${auth}`;
    callback({ requestHeaders: details.requestHeaders });
  });
  session.setPermissionCheckHandler((contents, permission, requestingOrigin) =>
    contents === win.webContents && trusted(requestingOrigin) && ['media', 'audioCapture', 'speaker-selection'].includes(permission));
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(contents === win.webContents && trusted(details.requestingUrl) &&
      (permission === 'speaker-selection' || (permission === 'media' &&
      (details.mediaTypes || []).every(type => type === 'audio'))));
  });
  tray = new Tray(trayIcon());
  tray.on('click', () => resize(false));
  registerIpc();
  await win.loadFile(path.join(root, 'desktop/loading.html'));
  win.showInactive();
  broadcast();
  starting = boot().catch(fail).finally(() => { starting = null; });
  }).catch(fail);
}
