'use strict';
// Prototype Vault viewer app. One job: open a personal link in a window whose contents the operating system excludes
// from screenshots, screen recording and screen sharing (macOS: NSWindowSharingNone; Windows: WDA_EXCLUDEFROMCAPTURE).
// Links look like  prototypevault://open?u=<the personal link>  and are copied from the console's "App link" button.
// Nothing else: no menus, no local storage beyond the session cookie, navigation locked to the vault the link points at.
// Limits: Linux has no such flag, and no software stops a phone camera pointed at the screen.
const { app, BrowserWindow, shell } = require('electron');

const SCHEME = 'prototypevault';
let win = null,
  lockedOrigin = null,
  pending = null;

function linkFrom(arg) {
  try {
    const u = new URL(String(arg || ''));
    if (u.protocol !== SCHEME + ':') return null;
    const target = new URL(u.searchParams.get('u') || '');
    return /^https?:$/.test(target.protocol) ? target.href : null;
  } catch {
    return null;
  }
}
const PASTE_PAGE =
  'data:text/html;charset=utf-8,' +
  encodeURIComponent(`<!doctype html><meta charset="utf-8"><title>Prototype Vault</title>
<style>body{font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;margin:80px auto;padding:0 24px;color:#1c1f26}input{width:100%;font-size:15px;padding:10px;border:1px solid #c8ccd4;border-radius:8px;box-sizing:border-box}button{margin-top:12px;font-size:15px;padding:10px 16px;border:0;border-radius:8px;background:#4f46e5;color:#fff}p{color:#5b6270}</style>
<h1>Prototype Vault</h1><p>Paste the link you were sent. This window is excluded from screenshots and screen sharing.</p>
<form onsubmit="location.href=document.querySelector('input').value.trim();return false"><input placeholder="https://prototypes.company.com/p/…?k=…" autofocus><button>Open</button></form>`);

function open(target) {
  if (!win) {
    win = new BrowserWindow({
      width: 1280,
      height: 860,
      title: 'Prototype Vault',
      autoHideMenuBar: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    win.setContentProtection(true);
    win.on('closed', () => {
      win = null;
      lockedOrigin = null;
    });
    const allowed = (url) => {
      try {
        const o = new URL(url).origin;
        if (!lockedOrigin && /^https?:/.test(url)) lockedOrigin = o;
        return o === lockedOrigin;
      } catch {
        return false;
      }
    };
    win.webContents.on('will-navigate', (e, url) => {
      if (!allowed(url)) {
        e.preventDefault();
        if (/^https?:/.test(url)) shell.openExternal(url);
      }
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url) && !allowed(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
  }
  if (target) {
    lockedOrigin = new URL(target).origin;
    win.loadURL(target);
  } else win.loadURL(PASTE_PAGE);
  win.show();
  win.focus();
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.setAsDefaultProtocolClient(SCHEME);
  app.on('open-url', (e, url) => {
    e.preventDefault();
    pending = linkFrom(url);
    if (app.isReady()) open(pending);
  }); // macOS
  app.on('second-instance', (e, argv) => open(argv.map(linkFrom).find(Boolean) || null)); // Windows, Linux
  app.whenReady().then(() => open(pending || process.argv.map(linkFrom).find(Boolean) || null));
  app.on('window-all-closed', () => app.quit());
}
