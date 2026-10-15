# Jimmy browser journal

For Chrome, Brave, and Edge (Chromium). This extension observes the active page's
title and URL only, when the browser is focused and the computer is not idle.
It does not inspect page contents, chats, forms, cookies, or browsing history.
URLs omit query strings and fragments; titles and URL paths may still be sensitive.
Private browsing is disabled. Localhost pages are skipped.

1. Build/restart Jimmy's desktop app.
2. Open Jimmy settings → Activity journal. Enable activity recording and browser
   recording, then save.
3. Open your browser's extensions page (`chrome://extensions`,
   `brave://extensions`, or `edge://extensions`), enable Developer mode, and choose
   **Load unpacked**. Select this `browser-extension` folder.
4. Open this extension's options and enter the same username/password Jimmy uses
   (from your local environment settings). Enable browser journaling and save.
   These credentials are stored in this browser profile's local extension storage,
   not synced to an online account. Do not share them.
5. Visit a normal page. The badge shows ON when an entry was accepted, OFF when
   Jimmy has recording paused, or ! when Jimmy cannot be reached/authenticated.

Pause all recording using Jimmy's **Journal on · Pause** control, or pause only
the browser using the extension options. Disabling tracking stops new entries;
existing Markdown journals stay until the retention period expires. Uninstalling
the extension removes its stored credentials. No browsing history is backfilled.
