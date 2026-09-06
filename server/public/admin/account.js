'use strict';
// Account page: who you are, connected tools (personal access tokens), leave, recent activity.
/* exported renderAccount */
/* global $, esc, fmt, toast, api, copy, ask, signOut, shell, wireShell, render */

async function renderAccount(app) {
  app.innerHTML = shell(
    '<div class="pagehead"><h1>Account</h1></div><div id="acct"><p class="muted">Loading…</p></div>',
    'account'
  );
  wireShell();
  const [{ tokens }, { activity }] = await Promise.all([api('/tokens'), api('/activity')]);
  const id = me.identity;
  const s = me.server;
  const active = tokens.filter((t) => !t.revokedAt);
  const isServerToken = id.kind === 'server-token' || id.who === 'admin-token';

  const how =
    id.kind === 'google'
      ? 'Google sign-in'
      : id.kind === 'sso'
        ? `Company sign-in (${esc(s.sso ? 'identity header from your proxy' : 'SSO')})`
        : id.kind === 'server-token'
          ? 'Server admin token'
          : `Personal access token${id.tokenId ? ' · ' + esc((tokens.find((t) => t.id === id.tokenId) || {}).name || '') : ''}`;
  const browser =
    id.kind === 'sso'
      ? 'Stays signed in while your company session lasts.'
      : id.kind === 'google'
        ? 'Signed in for 30 days, or until you sign out.'
        : 'Signed in until you close this tab or sign out.';
  const lim = me.mine.limits || {};
  const limits = [
    lim.shares ? `${me.mine.shares} of ${lim.shares} shares` : '',
    lim.storageMb ? `${lim.storageMb} MB of prototype files` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const signOutRow =
    (id.kind !== 'sso' ? '<button class="btn" id="out">Sign out</button>' : '') +
    (s.ssoLogoutUrl
      ? `<a class="btn" href="${esc(s.ssoLogoutUrl)}">Sign out of company sign-in</a>`
      : id.kind === 'sso'
        ? '<span class="hint">To sign out, sign out of your company identity provider. Ask whoever runs the vault to set SSO_LOGOUT_URL for a button here.</span>'
        : '');

  const toolRow = (t) => `
    <tr>
      <td><b>${esc(t.name)}</b>${t.current ? ' <span class="pill active">this session</span>' : ''}<br><span class="muted mono">${esc(t.prefix)}…</span></td>
      <td>${fmt(t.createdAt)}</td><td>${t.lastUsedAt ? fmt(t.lastUsedAt) : 'Never'}</td><td class="muted">${esc(t.owner)}</td>
      <td class="actions"><button class="btn small danger" data-disc="${t.id}" data-name="${esc(t.name)}">Disconnect</button></td>
    </tr>`;
  const oldRow = (t) => `
    <tr class="muted"><td>${esc(t.name)}</td><td style="width:170px">connected ${fmt(t.createdAt)}</td>
      <td style="width:170px">disconnected ${fmt(t.revokedAt)}</td><td>${esc(t.owner)}</td></tr>`;
  const tools = active.length
    ? `<table><thead><tr><th>Tool</th><th style="width:170px">Connected</th><th style="width:170px">Last used</th><th>Owner</th><th class="actions"></th></tr></thead>
       <tbody>${active.map(toolRow).join('')}</tbody></table>`
    : '<p class="muted" style="margin:0">No tools connected yet.</p>';
  const disconnected =
    tokens.length > active.length
      ? `<details><summary class="hint" style="cursor:pointer">Disconnected (${tokens.length - active.length})</summary>
         <table style="margin-top:var(--s2)"><tbody>${tokens
           .filter((t) => t.revokedAt)
           .map(oldRow)
           .join('')}</tbody></table></details>`
      : '';
  const n = me.mine.shares;
  const k = me.mine.tokens;
  const leaveBlock = isServerToken
    ? '<div class="hint">You are using the shared server admin token, which is not a personal account. To stop using this, delete your shares from the Prototypes page and ask whoever runs the server to rotate the token.</div>'
    : `<div class="hint">If you no longer want to use this, you can delete everything you made here in one go: the ${n} prototype${n === 1 ? '' : 's'} you shared (files, viewer links, recordings, feedback and results) and the ${k} connected tool${k === 1 ? '' : 's'}. It cannot be undone.</div>
       <div class="row"><button class="btn danger" id="leave">Delete everything I made and leave</button></div>`;
  const activityRow = (a) => `
    <li><span class="ts">${esc(a.ts.replace('T', ' ').slice(0, 19))}</span><b>${esc(a.type)}</b> ${a.name ? esc(a.name) : ''}
      ${a.path ? '<span class="mono">' + esc(a.path) + '</span>' : ''} <span class="muted">${esc(a.ip || '')}${a.by ? ' by ' + esc(a.by) : ''}</span></li>`;

  $('#acct').innerHTML = `
    <div class="stack" style="gap:var(--s6)">
      <div class="card"><div class="section"><h3>You</h3>
        <dl class="kv"><dt>Signed in as</dt><dd>${esc(id.who)}</dd><dt>How</dt><dd>${how}</dd><dt>This browser</dt><dd>${browser}</dd>
          ${limits ? `<dt>Limits</dt><dd>${limits}</dd>` : ''}</dl>
        <div class="row">${signOutRow}</div>
      </div></div>
      <div class="card"><div class="section"><h3>Connected tools</h3>
        <div class="hint">Claude Code, the CLI and the MCP server publish with a personal access token. Each tool gets its
          own, so you can disconnect one without touching the others. Disconnecting is immediate; nothing already shared changes.</div>
        ${tools}
        <div class="row"><input type="text" id="tname" placeholder="Name the tool, e.g. Claude Code on my laptop" style="flex:1;width:auto" maxlength="60">
          <button class="btn primary" id="tadd">Connect a tool</button></div>
        <div id="tnew"></div>
        ${disconnected}
      </div></div>
      <div class="card"><div class="section"><h3>Leave Prototype Vault</h3>${leaveBlock}</div></div>
      <div class="card"><div class="section"><h3>Recent account activity</h3>
        ${activity.length ? `<ul class="timeline">${activity.slice(0, 30).map(activityRow).join('')}</ul>` : '<p class="muted" style="margin:0">Nothing yet.</p>'}
        <div class="hint">Sign-ins, failed attempts, tools connected or disconnected, shares created, revoked or deleted. The full log is in the data directory.</div>
      </div></div>
    </div>`;

  if ($('#out')) $('#out').onclick = signOut;
  if ($('#leave'))
    $('#leave').onclick = async () => {
      const extra =
        id.kind === 'sso'
          ? ' Your company sign-in is managed by your company; ask IT to remove you from the admin list as well.'
          : '';
      const ok = await ask(
        'Leave Prototype Vault?',
        `This deletes the ${n} prototype${n === 1 ? '' : 's'} you shared, with their files, viewer links, recordings, feedback and results, disconnects your ${k} tool${k === 1 ? '' : 's'}, and signs you out. It cannot be undone.${extra}`,
        'Delete everything and leave',
        true
      );
      if (!ok) return;
      try {
        left = await api('/me/leave', { method: 'POST' });
        sessionStorage.removeItem('vault_token');
        token = '';
        me = null;
        render();
      } catch (e) {
        alert(e.message);
      }
    };
  if (view.newToken) {
    showNewToken(view.newToken);
    view.newToken = null;
  }
  $('#tadd').onclick = async () => {
    const name = $('#tname').value.trim();
    if (!name) return $('#tname').focus();
    try {
      view.newToken = await api('/tokens', { method: 'POST', body: JSON.stringify({ name }) });
      render();
    } catch (e) {
      alert(e.message);
    }
  };
  $('#tname').onkeydown = (e) => {
    if (e.key === 'Enter') $('#tadd').click();
  };
  $('#acct')
    .querySelectorAll('[data-disc]')
    .forEach((b) => {
      b.onclick = async () => {
        const ok = await ask(
          `Disconnect ${esc(b.dataset.name)}?`,
          'It stops working right away. To use that tool again you would connect it with a new token. Prototypes it already shared are not affected.',
          'Disconnect',
          true
        );
        if (!ok) return;
        await api('/tokens/' + b.dataset.disc, { method: 'DELETE' });
        toast('Disconnected');
        if (b.dataset.disc === me.identity.tokenId) return signOut();
        render();
      };
    });
}

// The token is shown once, with the two setup lines a person copies into their tools.
function showNewToken(r) {
  const url = me.server.publicUrl;
  const mcp = me.server.mcpPath || '/path/to/prototype-vault/mcp/server.js';
  $('#tnew').innerHTML = `
    <div class="card" style="background:var(--bg);margin-top:var(--s3)"><div class="stack" style="gap:var(--s3)">
      <div><b>${esc(r.item.name)}</b> is connected. Copy the token now; it is shown only once.</div>
      <div class="tokenbox" id="tokval">${esc(r.token)}</div>
      <div class="row"><button class="btn primary" id="tcopy">Copy token</button><button class="btn" id="tcli">Copy CLI setup</button><button class="btn" id="tmcp">Copy Claude Code setup</button></div>
      <div class="hint">CLI and MCP read <span class="mono">VAULT_URL</span> and <span class="mono">VAULT_ADMIN_TOKEN</span>.
        In Claude Code: <span class="mono">claude mcp add prototype-vault -e VAULT_URL=${esc(url)} -e VAULT_ADMIN_TOKEN=… -- node "${esc(mcp)}"</span>
        (the path to mcp/server.js in your copy of the repository).</div>
    </div></div>`;
  $('#tcopy').onclick = () => copy(r.token);
  $('#tcli').onclick = () => copy(`export VAULT_URL=${url} VAULT_ADMIN_TOKEN=${r.token}`);
  $('#tmcp').onclick = () =>
    copy(`claude mcp add prototype-vault -e VAULT_URL=${url} -e VAULT_ADMIN_TOKEN=${r.token} -- node "${mcp}"`);
}
