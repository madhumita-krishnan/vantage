'use strict';
// Sign-in screen and the "you have left" screen.
/* exported renderLogin, renderLeft */
/* global $, esc, ic, api, render */

async function renderLogin(app) {
  let a = {};
  try {
    a = await (await fetch('/api/auth')).json();
  } catch {
    /* server unreachable: show the token form anyway */
  }
  const google = a.google
    ? `
      <div class="stack" style="gap:var(--s2)">
        <a class="btn primary" href="/auth/google" style="width:100%">Sign in with Google</a>
        <div class="hint">Your prototypes, links and results are visible only to you.</div>
      </div>
      ${a.serverToken ? '<div class="divider">or</div>' : ''}`
    : '';
  const sso = !a.sso
    ? ''
    : a.ssoEmail && !a.ssoAdmin
      ? `<div class="warn">You are signed in as <b>${esc(a.ssoEmail)}</b> through your company sign-in, but that
           address is not on this server's admin list. Ask whoever runs the Vantage to add it (ADMIN_EMAILS), then reload.</div>`
      : `
      <div class="stack" style="gap:var(--s2)">
        <button class="btn primary" type="button" id="ssoGo" style="width:100%">Continue with company sign-in</button>
        <div class="hint">Uses your company identity provider through the proxy in front of this server. No separate password.</div>
      </div>
      <div class="divider">or</div>`;
  const tokenForm = !a.serverToken
    ? ''
    : `
      <form class="stack" id="loginForm" style="gap:var(--s2)">
        <div class="field">
          <label>Admin token</label>
          <div class="form">
            <input type="password" id="tok" placeholder="Paste the token" autofocus autocomplete="current-password">
            <button class="btn primary" type="submit">Sign in</button>
          </div>
        </div>
        <div class="hint">Printed in the terminal where the server runs, along with a link that signs you in without
          pasting. For a server you run yourself, or as a fallback when company sign-in is not configured.</div>
        <p id="err" style="color:var(--danger);margin:0"></p>
      </form>`;
  const intro = a.google
    ? 'Sign in to share prototypes with named people through private, expiring links.'
    : 'Vantage is self-hosted by your company. There is nothing to sign up for: access is granted by whoever runs the server.';
  app.innerHTML = `
    <div class="gate"><div class="card">
      <div class="lock">${ic('lock', 'lg')}</div>
      <h1>Sign in</h1>
      <p>${intro}</p>
      <div class="stack" style="gap:var(--s4)">${google}${sso}${tokenForm}</div>
      <footer>Every sign-in and every failed attempt is recorded in the access log.</footer>
    </div></div>`;
  if ($('#ssoGo')) $('#ssoGo').onclick = () => location.reload();
  if ($('#loginForm'))
    $('#loginForm').onsubmit = async (e) => {
      e.preventDefault();
      token = $('#tok').value.trim();
      try {
        me = await api('/me');
        sessionStorage.setItem('vantage_token', token);
        render();
      } catch {
        token = '';
        $('#err').textContent = 'That token was not accepted.';
      }
    };
}

function renderLeft(app) {
  const n = left.shares;
  const t = left.tokens;
  const after = left.sso
    ? 'Your company sign-in still exists; it is managed by your company, not by this server. Ask whoever runs the Vantage to remove you from the admin list so this console no longer opens for you.'
    : 'Nothing else about you is kept here.';
  app.innerHTML = `
    <div class="gate"><div class="card">
      <div class="lock">${ic('lock', 'lg')}</div>
      <h1>You have left</h1>
      <p>${n} prototype${n === 1 ? '' : 's'} you shared ${n === 1 ? 'was' : 'were'} deleted with all their files, links,
        recordings and results, and ${t} connected tool${t === 1 ? ' was' : 's were'} disconnected.</p>
      <p>${after}</p>
      <footer>Access-log entries mentioning you stay for the retention period, because they are security records.</footer>
    </div></div>`;
}
