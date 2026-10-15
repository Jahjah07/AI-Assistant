/* global chrome */
const endpoint = 'http://127.0.0.1:3002/api/activity';
let pending = false;
async function recordActivePage(force = false) {
  if (pending) return;
  pending = true;
  try {
    const settings = await chrome.storage.local.get(['enabled', 'username', 'password', 'lastEntry']);
    if (!settings.enabled) {
      await chrome.action.setBadgeText({ text: 'OFF' });
      await chrome.action.setTitle({ title: 'Jimmy browser journal: disabled in extension options' });
      return;
    }
    if (!settings.username || !settings.password || await chrome.idle.queryState(300) !== 'active') return;
    const window = await chrome.windows.getLastFocused();
    if (!window.focused || window.incognito) return;
    const [tab] = await chrome.tabs.query({ active: true, windowId: window.id });
    if (!tab?.title || !tab.url || tab.incognito) return;
    const url = new URL(tab.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || ['localhost', '127.0.0.1'].includes(url.hostname)) return;
    url.search = ''; url.hash = '';
    const key = `${Math.floor(Date.now() / 300000)}|${tab.title}|${url.href}`;
    if (key === settings.lastEntry && !force) return;
    const credentials = new TextEncoder().encode(`${settings.username}:${settings.password}`);
    const authorization = `Basic ${btoa(String.fromCharCode(...credentials))}`;
    const response = await fetch(endpoint, {
      method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'record', kind: 'browser', text: tab.title.slice(0, 1000), url: url.href }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Jimmy returned ${response.status}`);
    const result = await response.json();
    if (result.recorded) await chrome.storage.local.set({ lastEntry: key });
    await chrome.action.setBadgeText({ text: result.enabled ? 'ON' : 'OFF' });
    await chrome.action.setTitle({ title: result.enabled ? 'Jimmy journal: recording enabled' : 'Jimmy journal: paused in Jimmy settings' });
  } catch {
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setTitle({ title: 'Jimmy journal unavailable. Check Jimmy is running and extension credentials are correct.' });
  } finally { pending = false; }
}
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
chrome.runtime.onInstalled.addListener(() => { chrome.alarms.create('journal', { periodInMinutes: 1 }); });
chrome.runtime.onStartup.addListener(() => { chrome.alarms.create('journal', { periodInMinutes: 1 }); });
chrome.alarms.onAlarm.addListener(() => { void recordActivePage(true); });
chrome.tabs.onActivated.addListener(() => { void recordActivePage(); });
chrome.tabs.onUpdated.addListener((_id, change, tab) => { if (tab.active && (change.title || change.status === 'complete')) void recordActivePage(); });
chrome.windows.onFocusChanged.addListener(() => { void recordActivePage(); });
chrome.storage.onChanged.addListener(() => { void recordActivePage(); });
chrome.action.onClicked.addListener(() => { void chrome.runtime.openOptionsPage(); });
