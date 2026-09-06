'use strict';
// Google sign-in, shared by the console (designers) and by shares that require testers to sign in as the invited
// address. The token exchange is the only outbound request the server ever makes.
const C = require('./crypto');

module.exports = function google(ctx) {
  const { CONFIG, H } = ctx;
  const { setCookie, parseCookies, isHttps, redirect, httpError } = H;

  // Sends the browser to Google. `state` is bound to the browser with a short-lived cookie.
  function start(req, res, redirectUri) {
    if (!CONFIG.googleClientId) throw httpError(404, 'Google sign-in is not configured');
    const state = C.randomToken(16);
    setCookie(res, 'oauth_state', state, { path: '/auth', maxAge: 600, secure: isHttps(req) });
    const q = new URLSearchParams({
      client_id: CONFIG.googleClientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    });
    redirect(req, res, `${CONFIG.googleAuthUrl}?${q}`);
    return state;
  }

  // Checks the state, exchanges the code, verifies the ID token's claims. Returns { email, name, state }.
  async function finish(req, url, redirectUri) {
    if (!CONFIG.googleClientId) throw httpError(404, 'Google sign-in is not configured');
    const code = url.searchParams.get('code'),
      state = url.searchParams.get('state');
    if (!code || !state || state !== parseCookies(req).oauth_state)
      throw httpError(400, 'Sign-in did not complete (state mismatch). Try again.');
    const r = await fetch(CONFIG.googleTokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CONFIG.googleClientId,
        client_secret: CONFIG.googleClientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const tok = await r.json().catch(() => ({}));
    if (!r.ok || !tok.id_token) throw httpError(502, 'Google did not accept the sign-in');
    // The ID token arrived straight from Google's token endpoint over TLS, which OpenID Connect Core 3.1.3.7 accepts
    // in place of checking its signature. The claims are still checked.
    let claims;
    try {
      claims = JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64url'));
    } catch {
      throw httpError(502, 'Google returned an unreadable ID token');
    }
    const email = String(claims.email || '').toLowerCase();
    if (
      claims.aud !== CONFIG.googleClientId ||
      !/^(https:\/\/)?accounts\.google\.com$/.test(claims.iss) ||
      !claims.email_verified ||
      !email
    )
      throw httpError(403, 'Sign-in could not be verified');
    return { email, name: String(claims.name || '').slice(0, 80), state };
  }

  return { start, finish };
};
