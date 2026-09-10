'use strict';
// The New share page: files, people, expiry, purpose, test setup, intro, notes.
/* exported renderNew */
/* global $, esc, b64, filesFromDrop, toast, api, shell, wireShell, render, modeSeg, wireModeSeg, modeValue,
   taskEditor, wireTaskEditor, taskValue, optionChecks, wireOptions, optionValues, introEditor, wireIntroEditor,
   introValue, uploadIntro */

let pending = { files: [], entry: '', media: null };

function renderNew(app) {
  pending = { files: [], entry: '', media: null };
  app.innerHTML = shell(
    `<div class="pagehead"><h1>New Share</h1></div>
     <div class="card" style="max-width:var(--form-w)">
       <form class="stack" id="newForm" style="gap:var(--s7)">
         <div class="section">
           <h3>Prototype</h3>
           <div class="hint">Upload the files, say who may open it, and set when it stops working.</div>
           <div class="field"><label>Name</label>
             <input type="text" id="name" placeholder="e.g. Checkout redesign v3, usability round 2"></div>
           <div class="field"><label>Prototype files</label>
             <div class="drop" id="drop"><span>Drop a folder or an .html file here, or click to choose</span>
               <input type="file" id="fileIn" multiple webkitdirectory>
               <input type="file" id="fileIn2" multiple accept=".html,.htm,.css,.js,.png,.jpg,.svg,.json,.woff,.woff2"></div>
             <div class="hint">Everything in the folder is uploaded. Files must be self-contained: scripts, styles and
               fonts loaded from the internet are blocked. Run <span class="mono">vantage inline</span> first if needed.
               Shift-click the box to pick single files.</div></div>
           <div class="field" id="entryRow" hidden><label>Open this file first</label><select id="entry"></select></div>
         </div>
         <div class="section">
           <h3>Who can open it</h3>
           <div class="field">
             <label>People (one per line: <span class="mono">Name &lt;email&gt;</span> or just an email)</label>
             <textarea id="viewers" placeholder="Priya Shah <priya@customer.example>&#10;tom@partner.example"></textarea>
             <div class="hint">Each person gets their own private link, shown once after you create the share. Send links
               through your usual channel.</div></div>
           <div class="cols2">
             <div class="field"><label>Expires in (days)</label>
               <input type="number" id="days" value="${me.server.defaultExpiryDays}" min="1" max="${me.server.maxExpiryDays}">
               <div class="hint">Up to ${me.server.maxExpiryDays} days. You can extend any time.</div></div>
             <div class="field"><label>Passcode (optional second factor, 6+ characters)</label>
               <input type="text" id="passcode" placeholder="Share it by phone or a separate message" autocomplete="off"></div>
           </div>
         </div>
         <div class="section"><h3>Purpose</h3>${modeSeg('view')}</div>
         <div class="section" id="testSetup"><h3>Test setup</h3>${taskEditor([])}${optionChecks({})}</div>
         ${introEditor({ kind: 'default', text: '', media: null }, null)}
         <div class="field"><label>Notes (internal, shown only here)</label><textarea id="notes" style="min-height:64px"></textarea></div>
         <div class="row end">
           <span class="hint" id="status"></span>
           <button class="btn" type="button" id="cancel">Cancel</button>
           <button class="btn primary" type="submit" id="create">Create share</button>
         </div>
       </form>
     </div>`,
    'new'
  );
  wireShell();
  $('#cancel').onclick = () => {
    view = { page: 'list' };
    render();
  };
  wireModeSeg();
  wireTaskEditor();
  wireOptions();
  wireIntroEditor(null, pending);
  const drop = $('#drop');
  drop.onclick = (e) => {
    if (e.target.tagName === 'INPUT') return;
    (e.shiftKey ? $('#fileIn2') : $('#fileIn')).click();
  };
  drop.ondragover = (e) => {
    e.preventDefault();
    drop.style.borderColor = 'var(--accent)';
  };
  drop.ondragleave = () => (drop.style.borderColor = '');
  drop.ondrop = async (e) => {
    e.preventDefault();
    drop.style.borderColor = '';
    await loadFiles(await filesFromDrop(e));
  };
  $('#fileIn').onchange = (e) =>
    loadFiles([...e.target.files].map((f) => ({ path: f.webkitRelativePath || f.name, file: f })));
  $('#fileIn2').onchange = (e) => loadFiles([...e.target.files].map((f) => ({ path: f.name, file: f })));
  $('#newForm').onsubmit = (e) => {
    e.preventDefault();
    create();
  };
}

const JUNK = /(^|\/)(node_modules|\.git|__MACOSX)\//;
async function loadFiles(list) {
  pending.files = [];
  let bytes = 0;
  for (const { path, file } of list) {
    if (JUNK.test(path) || /\.DS_Store$/.test(path)) continue;
    const buf = new Uint8Array(await file.arrayBuffer());
    bytes += buf.length;
    pending.files.push({ path, contentBase64: b64(buf) });
  }
  $('#drop span').textContent = `${pending.files.length} files (${Math.round(bytes / 1024)} KB)`;
  $('#drop').classList.add('has');
  const htmls = pending.files.filter((f) => /\.html?$/i.test(f.path)).map((f) => f.path);
  const sel = $('#entry');
  sel.innerHTML = htmls.map((h) => `<option>${esc(h)}</option>`).join('');
  const idx = htmls.find((h) => /(^|\/)index\.html$/.test(h));
  if (idx) sel.value = idx;
  $('#entryRow').hidden = htmls.length < 2;
}

async function create() {
  const b = $('#create');
  b.disabled = true;
  $('#status').textContent = 'Uploading…';
  try {
    const body = {
      name: $('#name').value,
      expiresInDays: +$('#days').value,
      passcode: $('#passcode').value || undefined,
      viewers: $('#viewers')
        .value.split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      tasks: taskValue(),
      notes: $('#notes').value,
      mode: modeValue(),
      intro: introValue(),
      ...optionValues(),
    };
    if (pending.files.length) {
      body.files = pending.files;
      body.entry = $('#entryRow').hidden ? undefined : $('#entry').value;
    }
    const { share } = await api('/shares', { method: 'POST', body: JSON.stringify(body) });
    if (pending.media) {
      $('#status').textContent = 'Uploading recording…';
      await uploadIntro(share.id, pending.media);
    }
    toast('Share created');
    view = {
      page: 'share',
      id: share.id,
      tab: 'links',
      links: Object.fromEntries(share.viewers.map((v) => [v.id, v.link])),
    };
    render();
  } catch (e) {
    $('#status').textContent = '';
    b.disabled = false;
    alert(e.message);
  }
}
