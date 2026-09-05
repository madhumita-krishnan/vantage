# Prototype Vault viewer app

A tiny desktop app (Electron) that opens a personal link in a window the operating system excludes from screenshots, screen recording and screen sharing. On macOS and Windows a capture of that window comes out black, the same mechanism banking and messaging apps use. It is optional: the browser remains the default way to open links, with the watermark and access log as the controls.

What it does not do: Linux has no such flag, and nothing stops a phone camera pointed at the screen. Treat it as a strong deterrent, not a guarantee, and say so to testers.

## Run it

```bash
cd viewer-app
npm install
npm start
```

Open a link from the console's **App link** button (it looks like `prototypevault://open?u=…`), or paste the normal personal link into the window that appears.

## Package it for testers

Any Electron packager works; for example:

```bash
npx @electron/packager . "Prototype Vault" --platform=darwin,win32 --overwrite
```

Sign and notarise the result the way your company signs internal apps, then distribute it through your device management. Once installed, `prototypevault://` links open in the app directly.

## What is inside

One file, [main.js](main.js): a `BrowserWindow` with `setContentProtection(true)`, sandboxed renderer, navigation locked to the origin of the link, external links handed to the system browser. The vault server does not know or care whether a link was opened in the app or a browser; the session, watermark and audit log are identical.
