/* global chrome */
const form = document.querySelector('#settings');
chrome.storage.local.get(['username', 'password', 'enabled']).then(settings => {
  form.username.value = settings.username || ''; form.password.value = settings.password || ''; form.enabled.checked = Boolean(settings.enabled);
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await chrome.storage.local.set({ username: form.username.value.trim(), password: form.password.value, enabled: form.enabled.checked, lastEntry: '' });
    document.querySelector('#status').textContent = 'Saved. Visit a page to connect; the extension badge reports ON, OFF, or ! if unavailable.';
  } catch { document.querySelector('#status').textContent = 'Could not save the connection.'; }
});
