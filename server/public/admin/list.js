'use strict';
// The Prototypes list (with the "try it" empty state) and the Server page.
/* exported renderList, renderServer */
/* global $, esc, fmt, rel, count, toast, api, shell, wireShell, render */

function shareRow(s) {
  const kind = s.mode === 'moderated' ? 'Moderated test · ' : s.mode === 'view' ? 'View only · ' : '';
  const extras = (s.hasPasscode ? ' · passcode' : '') + (s.files ? '' : ' · <b>no files</b>');
  return `
    <div class="item" data-id="${s.id}">
      <div>
        <div class="n">${esc(s.name)}</div>
        <div class="m">${kind}Created ${fmt(s.createdAt)} · expires ${rel(s.expiresAt)}${extras}</div>
      </div>
      ${count(s.viewerCount, 'people', 'viewer')}
      ${count(s.totalOpens, 'eye', 'open')}
      <span class="pillcell"><span class="pill ${s.status}">${s.status}</span></span>
    </div>`;
}

async function renderList(app) {
  app.innerHTML = shell(
    `<div class="pagehead"><h1>Prototypes</h1><span class="spacer"></span>
       <button class="btn primary" id="new">+ New share</button></div>
     <div class="card shares" id="list"><p class="muted" style="margin:0">Loading…</p></div>`,
    'list'
  );
  wireShell();
  $('#new').onclick = () => {
    view = { page: 'new' };
    render();
  };
  const { shares } = await api('/shares');
  const l = $('#list');
  if (!shares.length) {
    l.innerHTML = `
      <div class="stack" style="gap:var(--s4)">
        <p class="muted" style="margin:0">Nothing shared yet. The quickest way to see how it works is to share the
          sample prototype with yourself and open your own link: you get the consent screen, the tasks, the feedback
          button and the watermark exactly as a tester would.</p>
        <div class="row">
          <input type="email" id="sampleEmail" placeholder="Your email (for your personal link)" style="flex:1;width:auto;max-width:360px">
          <button class="btn primary" id="sample">Try it with the sample prototype</button>
        </div>
        <p class="muted" style="margin:0">Or click <b>New share</b> and drop your own prototype folder, or ask Claude to share one.</p>
      </div>`;
    $('#sample').onclick = async () => {
      const viewer = $('#sampleEmail').value.trim();
      if (!viewer) return $('#sampleEmail').focus();
      const b = $('#sample');
      b.disabled = true;
      try {
        const { share } = await api('/shares/sample', { method: 'POST', body: JSON.stringify({ viewer }) });
        toast('Shared with you. Open your personal link below to see what a tester sees.', 6000);
        view = {
          page: 'share',
          id: share.id,
          tab: 'links',
          links: Object.fromEntries(share.viewers.map((v) => [v.id, v.link])),
        };
        render();
      } catch (e) {
        b.disabled = false;
        alert(e.message);
      }
    };
    $('#sampleEmail').onkeydown = (e) => {
      if (e.key === 'Enter') $('#sample').click();
    };
    return;
  }
  l.innerHTML =
    `<div class="head"><span>Prototype</span><span class="r" title="People invited to open it">Viewers</span>
       <span class="r" title="Times a link was opened">Opens</span><span class="r">Status</span></div>` +
    shares.map(shareRow).join('');
  l.querySelectorAll('.item').forEach((el) => {
    el.onclick = () => {
      view = { page: 'share', id: el.dataset.id, tab: 'links' };
      render();
    };
  });
}

async function renderServer(app) {
  const m = await api('/me');
  const s = m.server;
  const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
  const encryption = s.encryptionAtRest
    ? 'On'
    : '<span style="color:var(--warn)">Off. Set VAULT_ENCRYPTION_KEY.</span>';
  const secrets = s.quickstart
    ? row(
        'Secrets',
        'Made by the server on first start and kept in the data directory. Fine for trying it out; for a real deployment set <span class="mono">ADMIN_TOKEN</span> and <span class="mono">VAULT_ENCRYPTION_KEY</span> yourself.'
      )
    : '';
  const origins = s.allowedExternalOrigins.length
    ? esc(s.allowedExternalOrigins.join(', '))
    : 'None allowed. Prototypes must be self-contained.';
  app.innerHTML = shell(
    `<div class="pagehead"><h1>Server</h1></div>
     <div class="stack" style="gap:var(--s6)">
       <div class="card"><div class="section"><h3>Status</h3><dl class="kv">
         ${row('Version', esc(s.version))}
         ${row('Console address', esc(s.publicUrl))}
         ${row('Prototypes served from', `${esc(s.contentOrigin)} <span class="hint">(a separate origin, so a prototype's scripts cannot reach this console)</span>`)}
         ${row('Encryption at rest', encryption)}
         ${row('Viewer sign-in', s.sso ? 'SSO header + personal links' : 'Personal links')}
         ${row('Signed in as', `${esc(m.identity.who)} · ${esc(m.identity.label)}`)}
         ${secrets}
       </dl></div></div>
       <div class="card"><div class="section"><h3>Policy</h3><dl class="kv">
         ${row('Default expiry', `${s.defaultExpiryDays} days`)}
         ${row('Maximum expiry', `${s.maxExpiryDays} days (MAX_EXPIRY_DAYS)`)}
         ${row('Retention after expiry', `${s.retentionDays} days, then the share is deleted`)}
         ${row('Viewer session', `${s.sessionHours} hours`)}
         ${row('Prototype upload limit', `${s.maxUploadMb} MB`)}
         ${row('Media limit (intro + voice)', `${s.maxMediaMb} MB per share`)}
         ${row('External origins', origins)}
       </dl>
       <div class="hint">Change these with environment variables and restart. See <a href="/docs/deployment" target="_blank">Deployment</a>.</div>
       </div></div>
     </div>`,
    'server'
  );
  wireShell();
}
