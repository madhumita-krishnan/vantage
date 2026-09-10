'use strict';
// One share: header with revoke/extend, then the tabs Viewers & links, Access log, Feedback & results, Settings & files.
/* exported renderShare */
/* global $, esc, fmt, rel, ic, toast, api, copy, download, blobUrl, b64, filesFromDrop, shell, wireShell,
   render, stopLive, modeSeg, wireModeSeg, modeValue, taskEditor, wireTaskEditor, taskValue, optionChecks,
   wireOptions, optionValues, introEditor, wireIntroEditor, introValue */

async function renderShare(app) {
  app.innerHTML = shell('<div id="detail"><p class="muted">Loading…</p></div>', 'list');
  wireShell();
  let share;
  try {
    ({ share } = await api('/shares/' + view.id));
  } catch (e) {
    $('#detail').innerHTML = '<p>' + esc(e.message) + '</p>';
    return;
  }
  const tabs = {
    links: 'Viewers & links',
    activity: 'Access log',
    results: 'Feedback & results',
    settings: 'Settings & files',
  };
  if (share.mode === 'view') delete tabs.results;
  if (!tabs[view.tab]) view.tab = 'links';
  const modePill =
    share.mode === 'moderated'
      ? '<span class="pill">moderated</span>'
      : share.mode === 'view'
        ? '<span class="pill">view only</span>'
        : '';
  const files = share.files
    ? `${share.files.count} files, ${Math.round(share.files.bytes / 1024)} KB`
    : '<b>no files uploaded</b>';
  const access =
    share.status === 'active'
      ? '<button class="btn danger" id="revoke">Revoke access</button>'
      : share.revoked
        ? '<button class="btn" id="unrevoke">Restore access</button>'
        : '';
  $('#detail').innerHTML = `
    <div class="pagehead"><a href="#" data-nav="list" class="btn small">← All prototypes</a></div>
    <div class="card">
      <div class="head-row">
        <div>
          <h2>${esc(share.name)} <span class="pill ${share.status}">${share.status}</span>${modePill}</h2>
          <div class="hint">Created ${fmt(share.createdAt)} · expires ${fmt(share.expiresAt)} (${rel(share.expiresAt)})${share.hasPasscode ? ' · passcode required' : ''} · ${files}</div>
        </div>
        <div class="row">${access}<button class="btn" id="extendBtn">Extend…</button></div>
      </div>
      <div class="row" id="extendRow" hidden style="margin-top:var(--s3)">
        <span class="hint">Extend by</span>
        <input type="number" id="extDays" value="30" min="1" max="${me.server.maxExpiryDays}" style="width:96px">
        <span class="hint">days</span><button class="btn small primary" id="extGo">Extend</button>
        <span class="hint">or set a date</span><input type="date" id="extDate"><button class="btn small" id="extSet">Set</button>
        <span class="hint">Server maximum ${me.server.maxExpiryDays} days from today.</span>
      </div>
      ${share.files ? '' : '<div class="warn" style="margin-top:var(--s4)">No prototype files yet. Upload a folder under Settings & files, or run <span class="mono">vantage publish</span>.</div>'}
      <div class="tabs">${Object.entries(tabs)
        .map(([k, v]) => `<button data-t="${k}" class="${view.tab === k ? 'on' : ''}">${v}</button>`)
        .join('')}</div>
      <div id="tab"></div>
    </div>`;
  $('#detail')
    .querySelectorAll('[data-nav]')
    .forEach((a) => {
      a.onclick = (e) => {
        e.preventDefault();
        view = { page: 'list' };
        render();
      };
    });
  $('#detail')
    .querySelectorAll('.tabs button')
    .forEach((b) => {
      b.onclick = () => {
        view.tab = b.dataset.t;
        render();
      };
    });
  const patch = (body) => api('/shares/' + share.id, { method: 'PATCH', body: JSON.stringify(body) });
  if ($('#revoke'))
    $('#revoke').onclick = async () => {
      if (!confirm('Revoke access for everyone? Links stop working immediately.')) return;
      await patch({ revoked: true });
      toast('Revoked');
      render();
    };
  if ($('#unrevoke'))
    $('#unrevoke').onclick = async () => {
      await patch({ revoked: false });
      render();
    };
  $('#extendBtn').onclick = () => ($('#extendRow').hidden = !$('#extendRow').hidden);
  $('#extGo').onclick = async () => {
    try {
      await patch({ extendDays: +$('#extDays').value || 0 });
      toast('Extended');
      render();
    } catch (e) {
      alert(e.message);
    }
  };
  $('#extSet').onclick = async () => {
    const v = $('#extDate').value;
    if (!v) return;
    try {
      await patch({ expiresAt: new Date(v + 'T23:59:59').toISOString() });
      toast('Expiry set');
      render();
    } catch (e) {
      alert(e.message);
    }
  };
  const t = $('#tab');
  const tab = { links: tabLinks, activity: tabActivity, results: tabResults, settings: tabSettings }[view.tab];
  return tab(t, share);
}

// ---- Viewers & links. A link is shown once, when issued; the console keeps it in view.links until you leave the page.
function tabLinks(t, share) {
  const links = view.links || (view.links = {});
  const link = (v) => (v.revoked ? '' : links[v.id] || '');
  const row = (v) => {
    const l = link(v);
    const linkCell = l
      ? `<div class="link">${esc(l)}</div>`
      : v.revoked
        ? '—'
        : '<span class="muted">Issued earlier. Rotate for a new link.</span>';
    const copyButtons = l
      ? `<button class="btn small" data-copy="${esc(l)}">Copy</button>
         <button class="btn small" data-copy="vantage://open?u=${encodeURIComponent(l)}"
           title="Same link, for the Vantage viewer app: it blacks out screenshots and screen sharing on macOS and Windows">App link</button>`
      : '';
    const manage = v.revoked
      ? ''
      : `<button class="btn small" data-rotate="${v.id}" title="Issue a new link; the old one stops working">Rotate</button>
         <button class="btn small danger" data-revoke="${v.id}">Revoke</button>`;
    return `
      <tr class="${v.revoked ? 'muted' : ''}">
        <td><b>${esc(v.name)}</b><br><span class="muted">${esc(v.email)}</span>${v.source === 'sso' ? ' <span class="pill">sso</span>' : ''}${v.revoked ? ' <span class="pill revoked">revoked</span>' : ''}</td>
        <td class="num">${v.opens}${v.maxOpens ? ' / ' + v.maxOpens : ''}</td>
        <td>${fmt(v.lastSeenAt)}</td>
        <td>${linkCell}</td>
        <td class="actions"><span class="row" style="flex-wrap:nowrap">${copyButtons}${manage}</span></td>
      </tr>`;
  };
  t.innerHTML = `
    <div class="stack">
      <div class="hint">Send each person their own link through your normal channel. A link is shown once, when it is
        issued, and is not stored: copy it now, or <b>Rotate</b> to issue a new one (the old one stops working).
        <b>App link</b> opens the same prototype in the Vantage viewer app (see the README), whose window is
        excluded from screenshots and screen sharing on macOS and Windows.</div>
      <table>
        <thead><tr><th>Viewer</th><th class="num">Opens</th><th style="width:160px">Last seen</th><th>Personal link</th><th class="actions"></th></tr></thead>
        <tbody>${share.viewers.map(row).join('')}</tbody>
      </table>
      <div class="row">
        <input type="text" id="nv" placeholder="Add viewer: Name <email@company.example>" style="flex:1;width:auto">
        <button class="btn" id="add">Add viewer</button>
        ${share.viewers.filter(link).length > 1 ? '<button class="btn" id="copyAll">Copy all links</button>' : ''}
      </div>
    </div>`;
  t.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = () => copy(b.dataset.copy)));
  t.querySelectorAll('[data-rotate]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('Issue a new link? The current one stops working.')) return;
      const r = await api(`/shares/${share.id}/viewers/${b.dataset.rotate}/rotate`, { method: 'POST' });
      links[r.viewer.id] = r.viewer.link;
      render();
    };
  });
  t.querySelectorAll('[data-revoke]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('Revoke this viewer?')) return;
      await api(`/shares/${share.id}/viewers/${b.dataset.revoke}`, { method: 'DELETE' });
      render();
    };
  });
  $('#add').onclick = async () => {
    const s = $('#nv').value.trim();
    if (!s) return;
    try {
      const r = await api(`/shares/${share.id}/viewers`, { method: 'POST', body: JSON.stringify({ viewers: [s] }) });
      for (const v of r.viewers) if (v.link) links[v.id] = v.link;
      render();
    } catch (e) {
      alert(e.message);
    }
  };
  $('#nv').onkeydown = (e) => {
    if (e.key === 'Enter') $('#add').click();
  };
  if ($('#copyAll'))
    $('#copyAll').onclick = () =>
      copy(
        share.viewers
          .filter(link)
          .map((v) => `${v.name} <${v.email}>: ${link(v)}`)
          .join('\n')
      );
}

// ---- Access log
async function tabActivity(t, share) {
  const { audit } = await api('/shares/' + share.id + '/audit');
  const row = (a) => `
    <li><span class="ts">${esc(a.ts.replace('T', ' ').slice(0, 19))}</span><b>${esc(a.type)}</b>
      ${a.email ? esc(a.email) : ''} ${a.reason ? '(' + esc(a.reason) + ')' : ''}
      <span class="muted">${esc(a.ip || '')}${a.by ? ' by ' + esc(a.by) : ''}</span></li>`;
  t.innerHTML = audit.length
    ? `<ul class="timeline">${audit.slice().reverse().map(row).join('')}</ul>`
    : '<p class="muted">No activity yet.</p>';
}

// ---- Feedback & results
const whenLabel = (w) =>
  w.type === 'start'
    ? 'At start'
    : w.type === 'after'
      ? 'After task ' + (w.value + 1)
      : w.type === 'screen'
        ? 'On ' + esc(w.value)
        : 'After ' + w.value + ' min';
function feedbackRow(f) {
  const who = esc(f.kind === 'note' ? 'Moderator' : f.viewer);
  let what = '';
  if (f.kind === 'task')
    what =
      f.result === 'answer'
        ? `<span class="pill">answer</span> question ${f.taskIndex + 1}`
        : `<span class="pill ${f.result === 'done' ? 'active' : 'revoked'}">${f.result === 'done' ? 'completed' : 'stuck'}</span> task ${f.taskIndex + 1}`;
  const about = f.kind === 'note' && f.viewer ? ` about ${esc(f.viewer)}` : '';
  const where = f.location
    ? ` <span class="loc" title="Where they were in the prototype">${ic('screen')}on <span class="mono">${esc(f.location)}</span></span>`
    : '';
  const text = f.text ? `<div style="margin-top:var(--s1);white-space:pre-wrap">${esc(f.text)}</div>` : '';
  return `<li><span class="ts">${esc(f.ts.replace('T', ' ').slice(0, 16))}</span><b>${who}</b> ${what}${about}${where}${text}</li>`;
}
async function tabResults(t, share) {
  const draw = async () => {
    const [{ feedback }, sum, fresh] = await Promise.all([
      api('/shares/' + share.id + '/feedback'),
      api('/shares/' + share.id + '/summary'),
      api('/shares/' + share.id),
    ]);
    const live = !!liveTimer;
    const recs = fresh.share.recordings || [];
    const stat = (n, label) => `<div class="stat"><b>${n}</b><span>${label}</span></div>`;
    const taskRows = sum.tasks
      .map(
        (x) => `
        <tr><td>${x.kind === 'question' ? 'Question' : 'Task'}</td><td>${x.index + 1}. ${esc(x.task)}</td>
          <td class="muted">${whenLabel(x.when)}</td>
          <td class="num" style="color:var(--ok)">${x.kind === 'task' ? x.done : '—'}</td>
          <td class="num" style="color:var(--danger)">${x.kind === 'task' ? x.stuck : '—'}</td>
          <td class="num">${x.kind === 'question' ? x.answers : '—'}</td></tr>`
      )
      .join('');
    const testerRows = sum.viewers
      .map((v) => {
        const top = Object.entries(v.paths)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map((p) => `${p[0]} (${p[1]})`)
          .join(', ');
        return `
        <tr><td>${esc(v.viewer)}<br><span class="muted">${esc(v.email)}</span></td>
          <td class="num">${v.sessions}</td><td class="num">${v.clicks}</td><td class="num">${v.pageviews}</td><td class="num">${v.errors}</td>
          <td>${fmt(v.first)}</td><td>${fmt(v.last)}</td><td class="mono">${esc(top)}</td></tr>`;
      })
      .join('');
    const recRows = recs
      .map(
        (r) => `
        <tr><td>${esc(r.viewer || '')}<br><span class="muted">${esc(r.email || '')}</span></td>
          <td>${fmt(r.startedAt)}</td><td class="num">${(r.size / 1048576).toFixed(1)} MB</td>
          <td><${r.mime.startsWith('video/') ? 'video' : 'audio'} controls preload="none" data-rec="${r.session}" data-mime="${esc(r.mime)}" style="width:100%;max-width:360px"></${r.mime.startsWith('video/') ? 'video' : 'audio'}></td>
          <td class="actions"><span class="row" style="flex-wrap:nowrap">
            <button class="btn small" data-recdl="${r.session}">${ic('download')}</button>
            <button class="btn small danger" data-recrm="${r.session}">Delete</button></span></td></tr>`
      )
      .join('');
    // A refresh must not throw away a note being typed, stop a recording being played, or paint another share's page.
    if (view.id !== share.id || view.tab !== 'results') return;
    if (($('#noteText') && $('#noteText').value) || [...t.querySelectorAll('audio,video')].some((m) => !m.paused))
      return;
    const noteWho = ['<option value="">General</option>']
      .concat(share.viewers.map((v) => `<option value="${v.id}">${esc(v.name)}</option>`))
      .join('');
    t.innerHTML = `
      <div class="stack" style="gap:var(--s6)">
        <div class="head-row">
          <div class="stats">
            ${stat(sum.viewers.length, 'testers with sessions')}${stat(sum.eventCount, 'interactions')}
            ${stat(sum.feedbackCount, 'feedback notes')}${stat(recs.length, 'recordings')}${stat(sum.noteCount, 'moderator notes')}
          </div>
          <div class="row">
            <button class="btn small ${live ? 'primary' : ''}" id="live" title="Refresh every 5 seconds while a session runs">${live ? 'Live · on' : 'Live'}</button>
            <button class="btn small" id="expMd">${ic('download')}Report (.md)</button>
            <button class="btn small" id="expCsv">${ic('download')}Events (.csv)</button>
            <button class="btn small" id="expJson">${ic('download')}Everything (.json)</button>
          </div>
        </div>
        ${sum.tasks.length ? `<div class="section"><h3>Tasks and questions</h3><table><thead><tr><th style="width:90px">Type</th><th>Text</th><th style="width:170px">When</th><th class="num">Completed</th><th class="num">Stuck</th><th class="num">Answers</th></tr></thead><tbody>${taskRows}</tbody></table></div>` : ''}
        ${sum.viewers.length ? `<div class="section"><h3>Per tester</h3><table><thead><tr><th>Tester</th><th class="num">Sessions</th><th class="num">Clicks</th><th class="num">Screens</th><th class="num">Errors</th><th style="width:150px">First</th><th style="width:150px">Last</th><th>Most visited</th></tr></thead><tbody>${testerRows}</tbody></table></div>` : ''}
        ${recs.length ? `<div class="section"><h3>Recordings (voice and screen)</h3><table><thead><tr><th>Tester</th><th style="width:170px">Started</th><th class="num">Size</th><th>Play</th><th class="actions"></th></tr></thead><tbody>${recRows}</tbody></table></div>` : ''}
        <div class="section"><h3>Moderator note</h3>
          <div class="row"><select id="noteWho" style="width:220px">${noteWho}</select>
            <input type="text" id="noteText" placeholder="What you observed…" style="flex:1;width:auto">
            <button class="btn" id="noteAdd">Add note</button></div></div>
        <div class="section"><h3>Feedback, answers, task notes and moderator notes</h3>
          ${feedback.length ? `<ul class="timeline">${feedback.slice().reverse().map(feedbackRow).join('')}</ul>` : '<p class="muted" style="margin:0">Nothing yet.</p>'}
        </div>
      </div>`;
    $('#expMd').onclick = () => download(`/shares/${share.id}/report`, `report-${share.id}.md`);
    $('#expCsv').onclick = () => download(`/shares/${share.id}/events?format=csv`, `events-${share.id}.csv`);
    $('#expJson').onclick = () => download(`/shares/${share.id}/report?format=json`, `share-${share.id}.json`);
    $('#live').onclick = () => {
      if (liveTimer) stopLive();
      else liveTimer = setInterval(draw, 5000);
      draw();
    };
    t.querySelectorAll('[data-rec]').forEach((a) => {
      a.onplay = async () => {
        if (!a.src) {
          a.src = await blobUrl(`/shares/${share.id}/recordings/${a.dataset.rec}`);
          a.play();
        }
      };
    });
    t.querySelectorAll('[data-recdl]').forEach((b) => {
      b.onclick = () => {
        const mime = t.querySelector(`[data-rec="${b.dataset.recdl}"]`).dataset.mime;
        download(
          `/shares/${share.id}/recordings/${b.dataset.recdl}`,
          `${mime.startsWith('video/') ? 'screen' : 'voice'}-${b.dataset.recdl}.${mime.split('/')[1]}`
        );
      };
    });
    t.querySelectorAll('[data-recrm]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm('Delete this recording?')) return;
        await api(`/shares/${share.id}/recordings/${b.dataset.recrm}`, { method: 'DELETE' });
        draw();
      };
    });
    $('#noteAdd').onclick = async () => {
      const text = $('#noteText').value.trim();
      if (!text) return;
      await api(`/shares/${share.id}/notes`, {
        method: 'POST',
        body: JSON.stringify({ text, viewerId: $('#noteWho').value || undefined }),
      });
      toast('Note added');
      draw();
    };
    $('#noteText').onkeydown = (e) => {
      if (e.key === 'Enter') $('#noteAdd').click();
    };
  };
  await draw();
  if (share.mode === 'moderated' && !liveTimer) {
    liveTimer = setInterval(draw, 5000);
    draw();
  }
}

// ---- Settings & files
function tabSettings(t, share) {
  const domains = me.server.sso
    ? `<div class="field"><label>SSO: also allow these email domains (comma separated)</label>
         <input type="text" id="sDomains" value="${esc(share.ssoAllow.domains.join(', '))}"></div>`
    : '';
  t.innerHTML = `
    <div class="detail-cols">
      <div class="stack" style="gap:var(--s6)">
        <div class="section"><h3>Share</h3>
          <div class="field"><label>Name</label><input type="text" id="sName" value="${esc(share.name)}"></div>
          ${modeSeg(share.mode)}
          <div class="stack" id="testSetup">${taskEditor(share.tasks)}${optionChecks(share)}</div>
          <div class="field"><label>Passcode (blank keeps the current one, "none" removes it)</label><input type="text" id="sPass" autocomplete="off"></div>
          ${domains}
        </div>
        ${introEditor(share.intro, share)}
        <div class="field"><label>Notes</label><textarea id="sNotes" style="min-height:64px">${esc(share.notes)}</textarea></div>
        <div class="row"><button class="btn primary" id="save">Save</button></div>
      </div>
      <div class="stack" style="gap:var(--s6)">
        <div class="section"><h3>Files</h3>
          <div class="field"><label>Replace prototype files</label>
            <div class="drop" id="drop2">Drop a folder here, or click to choose<input type="file" id="fileR" multiple webkitdirectory></div>
            <div class="hint" id="rstat"></div></div>
          <div class="field"><label>Files in this share (${share.filePaths.length}) · opens <span class="mono">${esc(share.entry || '')}</span></label>
            <div class="filelist">${share.filePaths.map(esc).join('<br>') || '—'}</div></div>
        </div>
        <div class="section sep" style="padding-top:var(--s5)"><h3>Danger zone</h3>
          <div class="row"><button class="btn danger" id="del">Delete share and all data</button></div>
          <div class="hint">Removes the files, recordings, viewers, access log, feedback and recorded events. Cannot be undone.</div>
        </div>
      </div>
    </div>`;
  wireModeSeg();
  wireTaskEditor();
  wireOptions();
  wireIntroEditor(share.id, null);
  $('#save').onclick = async () => {
    const body = {
      name: $('#sName').value,
      mode: modeValue(),
      tasks: taskValue(),
      notes: $('#sNotes').value,
      intro: introValue(),
      ...optionValues(),
    };
    const p = $('#sPass').value.trim();
    if (p === 'none') body.passcode = '';
    else if (p) body.passcode = p;
    if ($('#sDomains'))
      body.ssoAllow = {
        emails: share.ssoAllow.emails,
        domains: $('#sDomains')
          .value.split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      };
    try {
      await api('/shares/' + share.id, { method: 'PATCH', body: JSON.stringify(body) });
      toast('Saved');
      render();
    } catch (e) {
      alert(e.message);
    }
  };
  const d2 = $('#drop2');
  d2.onclick = (e) => {
    if (e.target.tagName !== 'INPUT') $('#fileR').click();
  };
  d2.ondragover = (e) => e.preventDefault();
  const replace = async (list) => {
    $('#rstat').textContent = 'Uploading…';
    try {
      const files = [];
      for (const { path, file } of list) {
        if (/(^|\/)(node_modules|\.git|__MACOSX)\//.test(path) || /\.DS_Store$/.test(path)) continue;
        files.push({ path, contentBase64: b64(new Uint8Array(await file.arrayBuffer())) });
      }
      await api('/shares/' + share.id + '/bundle', { method: 'PUT', body: JSON.stringify({ files }) });
      toast('Files replaced');
      render();
    } catch (e) {
      $('#rstat').textContent = e.message;
    }
  };
  d2.ondrop = async (e) => {
    e.preventDefault();
    replace(await filesFromDrop(e));
  };
  $('#fileR').onchange = (e) =>
    replace([...e.target.files].map((f) => ({ path: f.webkitRelativePath || f.name, file: f })));
  $('#del').onclick = async () => {
    if (!confirm('Delete this share and every record attached to it?')) return;
    await api('/shares/' + share.id, { method: 'DELETE' });
    toast('Deleted');
    view = { page: 'list' };
    render();
  };
}
