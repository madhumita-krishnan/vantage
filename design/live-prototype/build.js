#!/usr/bin/env node
'use strict';
/* Builds design/live-prototype.html: every screen of Prototype Vault, live and clickable, in one file.
 * The console, the tester shell and the gate pages are the real files from server/public, unchanged apart from two
 * lines the browser needs when there is no server (see PATCHES); mock.js answers their requests from demo data.
 * Run: node design/live-prototype/build.js */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const css = read('server/public/vault.css');
const mock = read('design/live-prototype/mock.js');
const results = read('server/lib/results.js');
const sample = read('examples/sample-prototype/index.html');

// results.js is a CommonJS module; wrapped so the demo computes summaries and reports with the server's own code.
const resultsShim = `window.__RESULTS__ = (deps) => { const module = { exports: {} }; const require = () => deps; ${results}; return module.exports; };`;
const stylesheet = (html) => html.replace('<link rel="stylesheet" href="/vault.css" />', `<style>${css}</style>`);
// Insert before the page's own closing tag, the last one: the embedded sample prototype has closing tags of its own.
const beforeLast = (html, tag, insert) => {
  const i = html.lastIndexOf(tag);
  return html.slice(0, i) + insert + html.slice(i);
};
const PATCHES = [
  ["var id = location.pathname.split('/')[2];", 'var id = window.__SCREEN.shareId;'],
  ["$('#frame').src = r.url;", "$('#frame').srcdoc = r.html;"],
];

// A tiny tracker for the sample prototype: tells the shell which screen the tester is on, like tracker.js does.
const tracker =
  "<script>(function(){function tell(){try{parent.postMessage({vault:'location',path:'index.html'+location.hash},'*')}catch(e){}}window.addEventListener('hashchange',tell);tell();window.vault={event:function(){}}})()</script>";
const prototypeHtml = sample.replace('<head>', '<head>' + tracker);

const head = `<script>/*__SCREEN__*/</script><script>${resultsShim}</script><script>window.__PROTOTYPE__=${JSON.stringify(prototypeHtml).replace(/<\/script/g, '<\\/script')};</script><script>${mock}</script>`;

// The console: admin.html with its scripts inlined, plus a boot that opens the screen the frame was asked for.
let consoleDoc = stylesheet(read('server/public/admin.html'));
for (const n of ['core', 'form', 'signin', 'list', 'new-share', 'share', 'account'])
  consoleDoc = consoleDoc.replace(`<script src="/admin/${n}.js"></script>`, `<script>${read(`server/public/admin/${n}.js`)}</script>`);
consoleDoc = beforeLast(
  consoleDoc.replace('</head>', head + '</head>'),
  '</body>',
  `<script>
// Two console helpers rebound for a framed page: exports go to the parent page, which saves them the way its host
// allows; copying uses the copy command, which needs no clipboard permission.
download = async (path, name) => { const r = await fetch('/api' + path); if (!r.ok) return toast('Export failed'); parent.postMessage({ proto: 'download', name, blob: await r.blob() }, '*'); };
copy = (t) => { const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e) {} ta.remove(); if (ok) toast('Copied'); else prompt('Copy this', t); };
document.addEventListener('DOMContentLoaded',()=>{const S=window.__SCREEN;if(S.view)view=S.view;if(S.left)left=S.left;if(S.after)setTimeout(()=>{try{new Function(S.after)()}catch(e){}},700)})</script>`
);

// The tester shell.
let viewerDoc = stylesheet(read('server/public/viewer.html'));
for (const [a, b] of PATCHES) {
  if (!viewerDoc.includes(a)) throw new Error('viewer.html changed; patch not found: ' + a);
  viewerDoc = viewerDoc.replace(a, b);
}
viewerDoc = beforeLast(
  viewerDoc.replace('</head>', head + '</head>'),
  '</body>',
  `<script>(()=>{const S=window.__SCREEN;if(S.after)setTimeout(()=>{try{new Function(S.after)()}catch(e){}},900)})()</script>`
);

// The gate pages: the server renders gate.html with a title, a message and, sometimes, a form or a button.
const gateDoc = stylesheet(read('server/public/gate.html')).replace(
  '</head>',
  `<script>/*__SCREEN__*/</script></head>`
).replace(
  '</body>',
  `<script>(()=>{const S=window.__SCREEN;document.title=S.title+' · Prototype Vault';document.querySelector('h1').textContent=S.title;document.querySelector('.card p').innerHTML=S.message;document.querySelector('.card p').insertAdjacentHTML('afterend',S.extra||'');
const f=document.querySelector('form');if(f)f.onsubmit=(e)=>{e.preventDefault();parent.postMessage({proto:'goto',screen:f.passcode.value==='letmein'?'consent':'gate-passcode-wrong'},'*')};
const a=document.querySelector('a.btn');if(a)a.onclick=(e)=>{e.preventDefault();parent.postMessage({proto:'goto',screen:'consent'},'*')};})()</script></body>`
);

const PASSCODE_FORM =
  '<form method="post" action="/p/Qm4xT9vLp2Kd/passcode" class="form"><input type="password" name="passcode" placeholder="Passcode" autocomplete="off" autofocus required><button type="submit">Continue</button></form>';
const CK = 'Qm4xT9vLp2Kd';
const SCREENS = [
  // ---- console ----
  { id: 'signin', g: 'Console', t: 'Sign in', n: 'Google or the server token', doc: 'console', s: { state: 'signin' }, try: 'Paste anything as the token, or use the Google button.' },
  { id: 'list', g: 'Console', t: 'Prototypes', n: 'Every share, status at a glance', doc: 'console', s: { state: 'list', view: { page: 'list' } }, try: 'Open a share, or start a new one.' },
  { id: 'empty', g: 'Console', t: 'First run', n: 'Nothing shared yet, try the sample', doc: 'console', s: { state: 'empty', view: { page: 'list' } }, try: 'Type an email and share the sample with yourself.' },
  { id: 'new', g: 'Console', t: 'New share', n: 'Files, people, expiry, purpose, test setup', doc: 'console', s: { state: 'list', view: { page: 'new' } }, try: 'Switch the purpose; add tasks with a "when" rule; create it.' },
  { id: 'share-links', g: 'Console', t: 'Viewers & links', n: 'Links shown once, rotate, revoke', doc: 'console', s: { state: 'list', view: { page: 'share', id: CK, tab: 'links', links: { v1: 'https://prototypes.lumen.design/p/Qm4xT9vLp2Kd#k=u7Yb3QkL0x9zRt2WnV4pM8sD1eF6gH5j', v3: 'https://prototypes.lumen.design/p/Qm4xT9vLp2Kd#k=Ra9TqW2xLm4nP7vB0cD3eF5gH8jK1sZ6' } } }, try: 'Rotate a link, add a viewer, copy all.' },
  { id: 'share-activity', g: 'Console', t: 'Access log', n: 'Opens, passcodes, rejected attempts', doc: 'console', s: { state: 'list', view: { page: 'share', id: CK, tab: 'activity' } }, try: 'Read it bottom to top; two rejected links from one address.' },
  { id: 'share-results', g: 'Console', t: 'Feedback & results', n: 'Tasks, per tester, recordings, notes', doc: 'console', s: { state: 'list', view: { page: 'share', id: CK, tab: 'results' } }, try: 'Play a recording, add a moderator note, export the report.' },
  { id: 'share-settings', g: 'Console', t: 'Settings & files', n: 'Purpose, tasks, options, intro, danger zone', doc: 'console', s: { state: 'list', view: { page: 'share', id: CK, tab: 'settings' } }, try: 'Change the intro to "Your text" and save.' },
  { id: 'share-moderated', g: 'Console', t: 'Moderated share', n: 'Live results and moderator notes', doc: 'console', s: { state: 'list', view: { page: 'share', id: 'Hb7nR2wQx5Ae', tab: 'results' } }, try: 'Results refresh every five seconds while a session runs.' },
  { id: 'server', g: 'Console', t: 'Server', n: 'Status and policy of this vault', doc: 'console', s: { state: 'list', view: { page: 'server' } } },
  { id: 'account', g: 'Console', t: 'Account', n: 'Connected tools, leave, recent activity', doc: 'console', s: { state: 'list', view: { page: 'account' } }, try: 'Connect a tool to see the token shown once.' },
  { id: 'account-token', g: 'Console', t: 'Token issued', n: 'Shown once with the setup lines', doc: 'console', s: { state: 'list', view: { page: 'account', newToken: { token: 'pv_3kF9xQ2LmW7vR0tY8cB1nD5sG4hJ6pZa', item: { name: 'Claude Code on the studio laptop' } } } } },
  { id: 'leave', g: 'Console', t: 'Leave', n: 'Delete everything you made, confirm first', doc: 'console', s: { state: 'list', view: { page: 'account' }, after: "document.getElementById('leave').click()" } },
  { id: 'left', g: 'Console', t: 'You have left', n: 'What was deleted, what remains', doc: 'console', s: { state: 'signin', left: { shares: 5, tokens: 1, sso: false } } },
  // ---- tester ----
  { id: 'gate-invitation', g: 'Tester', t: 'Invitation required', n: 'Opened without a personal link', doc: 'gate', s: { title: 'Invitation required', message: 'This prototype is confidential. Open it using the personal link you were sent. If you do not have one, ask the person who shared it.' } },
  { id: 'gate-passcode', g: 'Tester', t: 'Passcode', n: 'Optional second factor', doc: 'gate', s: { title: 'Passcode', message: 'Hi Priya Shah. This prototype also needs the passcode you were given separately.', extra: PASSCODE_FORM }, try: 'The passcode is letmein.' },
  { id: 'gate-passcode-wrong', g: 'Tester', t: 'Wrong passcode', n: 'Limited per address and per share', doc: 'gate', s: { title: 'Passcode', message: 'That passcode is not correct.', extra: PASSCODE_FORM }, try: 'The passcode is letmein.' },
  { id: 'gate-signin', g: 'Tester', t: 'Sign in to open', n: 'Share requires the invited Google account', doc: 'gate', s: { title: 'Sign in to open', message: 'Hi Priya Shah. This prototype opens only for the Google account <b>priya@customer.com</b>, the address this link was sent to.', extra: '<a class="btn primary" href="/p/Qm4xT9vLp2Kd/signin" style="display:block;text-align:center">Sign in with Google</a>' } },
  { id: 'consent', g: 'Tester', t: 'Before you start', n: 'Intro text, what gets recorded, voice and screen', doc: 'viewer', s: { shareId: CK, viewerId: 'v1' }, try: 'Record my session, or Don’t record; both continue.' },
  { id: 'prototype', g: 'Tester', t: 'Prototype with tasks', n: 'Watermark, task panel, scheduled tasks', doc: 'viewer', s: { shareId: CK, viewerId: 'v1', consent: true }, try: 'Complete task 1 to reveal task 2; visit Billing address for the question.' },
  { id: 'feedback', g: 'Tester', t: 'Feedback', n: 'Free text, location attached', doc: 'viewer', s: { shareId: CK, viewerId: 'v1', consent: true, after: "document.getElementById('btnFeedback').click()" }, try: 'Send something; it appears on the results tab.' },
  { id: 'recording', g: 'Tester', t: 'Recording', n: 'Red pill, level meter, Stop', doc: 'viewer', s: { shareId: CK, viewerId: 'v1', consent: true, after: "var r=document.getElementById('recInd');r.hidden=false;document.getElementById('recWhat').textContent='Recording screen and voice';var vu=document.getElementById('vu');vu.hidden=false;setInterval(function(){for(var i=0;i<vu.children.length;i++)vu.children[i].style.height=(3+Math.round(Math.random()*11))+'px'},120);document.getElementById('recStop').onclick=function(){r.hidden=true}" } },
  { id: 'moderated', g: 'Tester', t: 'Moderated session', n: 'Tasks hidden, the moderator asks', doc: 'viewer', s: { shareId: 'Hb7nR2wQx5Ae', viewerId: 'v5', consent: true } },
  { id: 'view-only', g: 'Tester', t: 'View only', n: 'No tasks, no recording, no feedback', doc: 'viewer', s: { shareId: 'Zt3kW8mNc1Yf', viewerId: 'v7' } },
  { id: 'gate-expired', g: 'Tester', t: 'Expired', n: 'Past its date', doc: 'gate', s: { title: 'No longer available', message: 'This prototype link has expired.' } },
  { id: 'gate-withdrawn', g: 'Tester', t: 'Withdrawn', n: 'Share or viewer revoked', doc: 'gate', s: { title: 'No longer available', message: 'Access to this prototype has been withdrawn.' } },
  { id: 'gate-invalid', g: 'Tester', t: 'Link not valid', n: 'Rotated, revoked or mistyped', doc: 'gate', s: { title: 'Link not valid', message: 'This invitation link is not valid or has been revoked. Ask the person who shared it for a new link.' } },
  { id: 'gate-limit', g: 'Tester', t: 'Open limit reached', n: 'Per-viewer cap', doc: 'gate', s: { title: 'Open limit reached', message: 'This invitation has been used the maximum number of times.' } },
  { id: 'gate-mismatch', g: 'Tester', t: 'Not the invited address', n: 'Signed in with another Google account', doc: 'gate', s: { title: 'Not the invited address', message: 'You signed in as <b>tom.reyes@gmail.com</b>, but this link was sent to <b>priya@customer.com</b>. Sign in with that account, or ask the person who shared it to invite this one.' } },
  { id: 'gate-framed', g: 'Tester', t: 'Open it from your link', n: 'Prototype pasted into a new tab', doc: 'gate', s: { title: 'Open it from your link', message: 'This prototype only opens inside the page your personal link leads to.' } },
  { id: 'gate-slow', g: 'Tester', t: 'Slow down', n: 'Too many attempts', doc: 'gate', s: { title: 'Slow down', message: 'Too many attempts. Try again in a few minutes.' } },
  { id: 'gate-notfound', g: 'Tester', t: 'Not found', n: 'Link does not point to a prototype', doc: 'gate', s: { title: 'Not found', message: 'This link does not point to a prototype. Check that you copied the full address.' } },
];
const PHONE = ['consent', 'prototype', 'feedback', 'gate-passcode', 'list', 'share-links', 'new'];

const outer = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prototype Vault, Every Screen</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400&display=swap">
<style>
:root{color-scheme:light dark;--g:#f1f2f5;--g2:#ffffff;--ink:#1a1d24;--mute:#68707f;--line:#d9dce3;--acc:#2d5bff;--acc-ink:#fff;--frame:#c9cdd6;--shadow:0 20px 50px rgba(20,24,40,.18);--sans:'IBM Plex Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;--serif:'Fraunces',Georgia,'Times New Roman',serif;--mono:'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--g:#14161b;--g2:#1c1f26;--ink:#e6e9ef;--mute:#8b93a3;--line:#2a2e38;--acc:#7d9bff;--acc-ink:#0b0d12;--frame:#31353f;--shadow:0 20px 50px rgba(0,0,0,.5)}}
:root[data-theme="dark"]{--g:#14161b;--g2:#1c1f26;--ink:#e6e9ef;--mute:#8b93a3;--line:#2a2e38;--acc:#7d9bff;--acc-ink:#0b0d12;--frame:#31353f;--shadow:0 20px 50px rgba(0,0,0,.5)}
*{box-sizing:border-box}
[hidden]{display:none!important}
body{margin:0;background:var(--g);color:var(--ink);font:14px/20px var(--sans);height:100dvh;display:grid;grid-template-rows:56px 1fr;grid-template-columns:272px 1fr;overflow:hidden}
header{grid-column:1/-1;display:flex;align-items:center;gap:20px;padding:0 20px;border-bottom:1px solid var(--line);background:var(--g2)}
header h1{font:500 22px/1 var(--serif);margin:0;letter-spacing:-.01em}
header h1 i{font-style:italic;color:var(--mute);font-weight:500}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:8px;padding:2px;background:var(--g)}
.seg button{border:0;background:none;color:var(--mute);font:500 13px/24px var(--sans);padding:0 12px;border-radius:6px;cursor:pointer}
.seg button.on{background:var(--g2);color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,.12)}
.seg button:focus-visible,nav button:focus-visible,.card:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
header .sp{flex:1}
header .k{color:var(--mute);font-size:12px}
header .k kbd{font:11px/16px var(--mono);border:1px solid var(--line);border-radius:4px;padding:0 5px;background:var(--g)}
nav{border-right:1px solid var(--line);overflow:auto;padding:12px 0 40px;background:var(--g2)}
nav h2{font:600 11px/16px var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--mute);margin:16px 20px 6px;display:flex;justify-content:space-between}
nav h2 span{font-family:var(--mono);font-weight:400;letter-spacing:0}
nav button{display:block;width:100%;text-align:left;border:0;background:none;color:var(--ink);padding:7px 20px 7px 18px;border-left:2px solid transparent;cursor:pointer;font:inherit}
nav button b{display:block;font-weight:500}
nav button small{display:block;color:var(--mute);font-size:12px;line-height:16px}
nav button:hover{background:var(--g)}
nav button.on{border-left-color:var(--acc);background:var(--g)}
nav button.on b{color:var(--acc)}
main{overflow:auto;position:relative}
#stage{padding:28px 32px 40px;display:flex;flex-direction:column;align-items:center;gap:16px;min-height:100%}
.cap{width:100%;max-width:1280px;display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}
.cap b{font:600 15px/22px var(--sans)}
.cap code{font:12px/20px var(--mono);color:var(--mute)}
.cap .try{color:var(--mute);font-size:13px}
.cap .try:before{content:'Try: ';color:var(--ink);font-weight:500}
.dev{position:relative;border-radius:14px;background:var(--frame);padding:10px;box-shadow:var(--shadow);flex:none}
.dev.phone{border-radius:44px;padding:12px}
.dev .win{overflow:hidden;border-radius:6px;background:#fff}
.dev.phone .win{border-radius:34px}
.dev iframe{border:0;display:block;transform-origin:0 0;background:#fff}
#grid{display:grid;grid-template-columns:repeat(auto-fill,345px);gap:24px 20px;padding:24px 32px 48px}
#grid h2{grid-column:1/-1;font:500 20px/1.2 var(--serif);margin:16px 0 0;padding-top:16px;border-top:1px solid var(--line)}
#grid h2:first-child{border:0;padding:0;margin:0}
.card{display:block;text-align:left;border:0;background:none;color:inherit;cursor:pointer;padding:0;font:inherit}
.card .shot{border-radius:10px;background:var(--frame);padding:6px;overflow:hidden}
.card .win{overflow:hidden;border-radius:4px;background:#fff;position:relative}
.card .win:after{content:'';position:absolute;inset:0}
.card iframe{border:0;display:block;transform-origin:0 0;pointer-events:none;background:#fff}
.card.phone .shot{width:max-content;border-radius:22px;padding:6px}
.card.phone .win{border-radius:18px}
.card b{display:block;margin:10px 0 0;font-weight:500}
.card small{color:var(--mute);font-size:12px}
.card:hover .shot{outline:2px solid var(--acc)}
@media (max-width:900px){body{grid-template-columns:1fr}nav{display:none}}
@media (prefers-reduced-motion:no-preference){.card .shot{transition:outline-color .15s}}
</style>
<header>
  <h1>Prototype Vault <i>every screen</i></h1>
  <div class="seg" id="mode"><button class="on" data-m="one">One screen</button><button data-m="all">All screens</button></div>
  <div class="seg" id="device"><button class="on" data-d="desktop">Desktop</button><button data-d="phone">Phone</button></div>
  <span class="sp"></span>
  <span class="k">Real console and tester pages on demo data. Nothing you do here is saved. <kbd>←</kbd> <kbd>→</kbd> move between screens.</span>
</header>
<nav id="nav"></nav>
<main><div id="stage"></div><div id="grid" hidden></div></main>
<script>
const DOCS = ${JSON.stringify({ console: consoleDoc, viewer: viewerDoc, gate: gateDoc }).replace(/<\/script/g, '<\\/script')};
const SCREENS = ${JSON.stringify(SCREENS)};
const PHONE = ${JSON.stringify(PHONE)};
const $ = (s, r) => (r || document).querySelector(s);
let cur = location.hash.slice(1) || 'list', mode = 'one', device = 'desktop';
const byId = Object.fromEntries(SCREENS.map((s) => [s.id, s]));
const src = (s) => DOCS[s.doc].replace('/*__SCREEN__*/', 'window.__SCREEN=' + JSON.stringify(s.s).replace(/<\\/script/g, '<\\\\/script') + ';');
const size = (phone) => (phone ? [390, 844] : [1280, 800]);
function frame(s, phone, scale) {
  const [w, h] = size(phone);
  const f = document.createElement('iframe');
  f.title = s.t; f.width = w; f.height = h; if (scale < 0.5) f.loading = 'lazy';
  f.setAttribute('allow', 'clipboard-write; microphone; display-capture');
  f.style.transform = 'scale(' + scale + ')';
  f.srcdoc = src(s);
  const win = document.createElement('div'); win.className = 'win';
  win.style.width = w * scale + 'px'; win.style.height = h * scale + 'px'; win.appendChild(f);
  return win;
}
function renderNav() {
  const groups = [...new Set(SCREENS.map((s) => s.g))];
  $('#nav').innerHTML = groups.map((g) => '<h2>' + g + '<span>' + SCREENS.filter((s) => s.g === g).length + '</span></h2>' +
    SCREENS.filter((s) => s.g === g).map((s) => '<button data-id="' + s.id + '" class="' + (s.id === cur ? 'on' : '') + '"><b>' + s.t + '</b><small>' + s.n + '</small></button>').join('')).join('');
  document.querySelectorAll('#nav button').forEach((b) => (b.onclick = () => go(b.dataset.id)));
}
function renderStage() {
  const s = byId[cur] || SCREENS[0];
  const phone = device === 'phone';
  const st = $('#stage');
  const avail = Math.max(320, st.clientWidth - 64 - 20);
  const [w, h] = size(phone);
  const scale = Math.min(1, avail / w, (st.clientHeight - 140) / h);
  st.innerHTML = '';
  const cap = document.createElement('div'); cap.className = 'cap';
  cap.innerHTML = '<b>' + s.t + '</b><code>' + s.g.toLowerCase() + ' · ' + s.id + '</code>' + (s.try ? '<span class="try">' + s.try + '</span>' : '');
  const dev = document.createElement('div'); dev.className = 'dev' + (phone ? ' phone' : '');
  dev.appendChild(frame(s, phone, scale));
  st.append(cap, dev);
}
function renderGrid() {
  const g = $('#grid');
  const groups = [...new Set(SCREENS.map((s) => s.g))].concat('Phone');
  g.innerHTML = '';
  for (const grp of groups) {
    const h = document.createElement('h2'); h.textContent = grp; g.appendChild(h);
    const list = grp === 'Phone' ? PHONE.map((id) => byId[id]) : SCREENS.filter((s) => s.g === grp);
    for (const s of list) {
      const phone = grp === 'Phone';
      const c = document.createElement('button'); c.className = 'card' + (phone ? ' phone' : '');
      const shot = document.createElement('div'); shot.className = 'shot';
      shot.appendChild(frame(s, phone, phone ? 0.3 : 0.26));
      c.append(shot);
      c.insertAdjacentHTML('beforeend', '<b>' + s.t + '</b><small>' + s.n + '</small>');
      c.onclick = () => { device = phone ? 'phone' : 'desktop'; syncSeg('#device', device, 'd'); setMode('one'); go(s.id); };
      g.appendChild(c);
    }
  }
}
function syncSeg(sel, v, k) { document.querySelectorAll(sel + ' button').forEach((b) => b.classList.toggle('on', b.dataset[k] === v)); }
function go(id) { cur = byId[id] ? id : SCREENS[0].id; history.replaceState(null, '', '#' + cur); renderNav(); if (mode === 'one') renderStage(); }
function setMode(m) {
  mode = m; syncSeg('#mode', m, 'm');
  $('#stage').hidden = m !== 'one'; $('#grid').hidden = m !== 'all';
  if (m === 'all' && !$('#grid').children.length) renderGrid();
  if (m === 'one') renderStage();
}
document.querySelectorAll('#mode button').forEach((b) => (b.onclick = () => setMode(b.dataset.m)));
document.querySelectorAll('#device button').forEach((b) => (b.onclick = () => { device = b.dataset.d; syncSeg('#device', device, 'd'); if (mode === 'one') renderStage(); }));
// Exports from the console frames. Inside the artifact viewer the file goes through the viewer's own save prompt;
// opened as a plain file, the browser downloads it directly.
let downloads = null;
if (window.claude && window.claude.use) window.claude.use('downloads').then((d) => (downloads = d)).catch(() => {});
async function saveFile(name, blob) {
  if (downloads) {
    try { await downloads.save({ filename: name, data: blob }); } catch (e) { if (e && e.code !== 'declined') console.warn('save', e); }
    return;
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60e3);
}
window.addEventListener('message', (e) => {
  if (!e.data || !e.data.proto) return;
  if (e.data.proto === 'goto') go(e.data.screen);
  if (e.data.proto === 'download') saveFile(e.data.name, e.data.blob);
});
window.addEventListener('keydown', (e) => {
  if (e.target !== document.body && e.target !== document.documentElement) return;
  const i = SCREENS.findIndex((s) => s.id === cur);
  if (e.key === 'ArrowRight') go(SCREENS[(i + 1) % SCREENS.length].id);
  if (e.key === 'ArrowLeft') go(SCREENS[(i - 1 + SCREENS.length) % SCREENS.length].id);
});
let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => mode === 'one' && renderStage(), 150); });
renderNav(); renderStage();
</script>
`;
const out = path.join(ROOT, 'design', 'live-prototype.html');
fs.writeFileSync(out, outer);
console.log(`wrote ${path.relative(ROOT, out)} (${(outer.length / 1024).toFixed(0)} KB, ${SCREENS.length} screens)`);
