'use strict';
// Form pieces shared by New share and a share's Settings tab: the task editor, the purpose toggle, the option
// switches, and the "Before you start" intro editor.
/* exported taskEditor, wireTaskEditor, taskValue, modeSeg, wireModeSeg, modeValue, optionChecks, wireOptions,
   optionValues, introEditor, wireIntroEditor, introValue, uploadIntro */
/* global $, esc, ic, toast, api, uploadXhr, render */

// ---- tasks and questions, each with a "when" rule ----
const WHEN = { start: 'At the start', after: 'After task…', screen: 'On screen…', minutes: 'After … minutes' };
const WHEN_PLACEHOLDER = { after: 'task #', screen: '#checkout', minutes: '5', start: '' };

function taskRow(t) {
  t = t || { text: '', kind: 'task', when: { type: 'start', value: '' } };
  const options = Object.entries(WHEN)
    .map(([k, v]) => `<option value="${k}" ${t.when.type === k ? 'selected' : ''}>${v}</option>`)
    .join('');
  const placeholder =
    t.kind === 'question' ? 'What did you expect to happen here?' : 'Find the price of the annual plan';
  return `
    <div class="taskrow">
      <select class="tk">
        <option value="task" ${t.kind === 'task' ? 'selected' : ''}>Task</option>
        <option value="question" ${t.kind === 'question' ? 'selected' : ''}>Question</option>
      </select>
      <input type="text" class="tt" value="${esc(t.text)}" placeholder="${placeholder}">
      <select class="tw">${options}</select>
      <input type="text" class="tv" value="${esc(t.when.value ?? '')}" placeholder="${WHEN_PLACEHOLDER[t.when.type]}"
        ${t.when.type === 'start' ? 'disabled' : ''}>
      <button type="button" class="rm" title="Remove">${ic('x')}</button>
    </div>`;
}
function taskEditor(tasks) {
  return `
    <div class="field">
      <label>Tasks and questions for testers</label>
      <div class="stack" id="tasks" style="gap:var(--s2)">${tasks.map(taskRow).join('')}</div>
      <div class="row">
        <button type="button" class="btn small" id="taskAdd">${ic('plus')}Add</button>
        <span class="hint">A task gets Completed / Couldn't buttons. A question gets a text answer. "When" controls when
          it appears: at the start, after another task is done, when the tester reaches a screen (match on the page
          path or #hash), or after a number of minutes.</span>
      </div>
    </div>`;
}
function wireTaskEditor() {
  const box = $('#tasks');
  const wire = (r) => {
    r.querySelector('.rm').onclick = () => r.remove();
    r.querySelector('.tw').onchange = (e) => {
      const v = r.querySelector('.tv');
      v.disabled = e.target.value === 'start';
      v.placeholder = WHEN_PLACEHOLDER[e.target.value];
      if (e.target.value === 'start') v.value = '';
    };
  };
  box.querySelectorAll('.taskrow').forEach(wire);
  $('#taskAdd').onclick = () => {
    box.insertAdjacentHTML('beforeend', taskRow());
    wire(box.lastElementChild);
    box.lastElementChild.querySelector('.tt').focus();
  };
}
function taskValue() {
  return [...$('#tasks').querySelectorAll('.taskrow')]
    .map((r) => {
      const type = r.querySelector('.tw').value;
      let value = r.querySelector('.tv').value.trim();
      if (type === 'after') value = Math.max(0, (+value || 1) - 1); // people count from 1; the server from 0
      return { text: r.querySelector('.tt').value, kind: r.querySelector('.tk').value, when: { type, value } };
    })
    .filter((t) => t.text.trim());
}

// ---- purpose: view only / unmoderated / moderated ----
const MODE_LABEL = { view: 'View only', unmoderated: 'Unmoderated', moderated: 'Moderated' };
const MODE_HINT = {
  view: 'Just for looking: a stakeholder review or a handoff. No tasks, no recording, no consent screen, no feedback button. Who opened it, and when, is still logged.',
  unmoderated:
    'A usability test testers do alone, whenever suits them. Tasks, consent and recording carry the session.',
  moderated:
    'A usability test where you are on a call with the tester. Results refresh live, you can add moderator notes, and tasks are hidden from the tester by default so you ask them yourself.',
};
function modeSeg(mode) {
  mode = MODE_LABEL[mode] ? mode : 'unmoderated';
  const buttons = Object.entries(MODE_LABEL)
    .map(([k, v]) => `<button type="button" data-m="${k}" class="${mode === k ? 'on' : ''}">${v}</button>`)
    .join('');
  return `
    <div class="field">
      <label>What is this share for?</label>
      <div class="seg" id="modeSeg">${buttons}</div>
      <div class="hint" id="modeHint"></div>
    </div>`;
}
function wireModeSeg(onChange) {
  const set = () => {
    const m = $('#modeSeg .on').dataset.m;
    $('#modeHint').textContent = MODE_HINT[m];
    if ($('#testSetup')) $('#testSetup').hidden = m === 'view';
  };
  $('#modeSeg')
    .querySelectorAll('button')
    .forEach((b) => {
      b.onclick = () => {
        $('#modeSeg')
          .querySelectorAll('button')
          .forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        set();
        if (onChange) onChange(b.dataset.m);
      };
    });
  set();
}
const modeValue = () => $('#modeSeg .on').dataset.m;

// ---- option switches ----
const OPTIONS = [
  [
    'showTasks',
    'Show tasks and questions to testers. Turn off for moderated sessions where you ask them yourself.',
    (s) => s.showTasks !== false,
  ],
  ['record', 'Record interactions: clicks, navigation, focus, scroll.', (s) => s.recordSessions !== false],
  [
    'recordText',
    'Also record what testers type into the prototype. Off by default so real personal data is never captured; turn on when the prototype uses sample data and the typed input matters.',
    (s) => !!s.recordText,
  ],
  [
    'voice',
    'Offer think-aloud voice recording. Testers choose on the consent screen, see a red Recording indicator while it runs, and can stop it at any time. Off by default.',
    (s) => !!s.voice,
  ],
  [
    'screen',
    'Offer screen recording: a video of the prototype tab, with the voice track when both are on, that you can watch back on the results tab. Desktop browsers only; the tester picks the tab and can stop at any time. About 5 MB a minute, counted against the media limit. Off by default.',
    (s) => !!s.screen,
  ],
  ['consent', 'Ask testers for consent before recording anything.', (s) => s.requireConsent !== false],
  [
    'signin',
    'Testers must sign in with Google as the invited address before the link opens, so a forwarded link opens nothing. Needs Google sign-in on this server. Off by default because it excludes people without a Google account.',
    (s) => !!s.requireSignIn,
  ],
  ['wm', "Show a watermark with the viewer's email over the prototype.", (s) => s.watermark !== false],
];
const sw = (id, label, on, cls = '') =>
  `<label class="opt ${cls}"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span class="sw"></span><span>${label}</span></label>`;
function optionChecks(s) {
  const all = sw(
    'optAll',
    'Select all',
    OPTIONS.every((o) => o[2](s)),
    'all'
  );
  return `<div class="stack" id="opts" style="gap:var(--s3)">${all}${OPTIONS.map((o) => sw(o[0], o[1], o[2](s))).join('')}</div>`;
}
function wireOptions() {
  const all = $('#optAll');
  const items = OPTIONS.map((o) => $('#' + o[0]));
  all.onchange = () => items.forEach((i) => (i.checked = all.checked));
  items.forEach((i) => (i.onchange = () => (all.checked = items.every((x) => x.checked))));
}
function optionValues() {
  return {
    showTasks: $('#showTasks').checked,
    recordSessions: $('#record').checked,
    recordText: $('#recordText').checked,
    voice: $('#voice').checked,
    screen: $('#screen').checked,
    requireConsent: $('#consent').checked,
    requireSignIn: $('#signin').checked,
    watermark: $('#wm').checked,
  };
}

// ---- "Before you start": text, or a voice/video intro with captions ----
function introEditor(intro, share) {
  const kind = intro.kind || 'default';
  const hasMedia = !!intro.media;
  const subs = intro.subtitles || [];
  const kinds = ['default', 'text', 'audio', 'video'];
  const labels = { default: 'Standard', text: 'Your text', audio: 'Voice recording', video: 'Video' };
  const kindButtons = kinds
    .map((k) => `<button type="button" data-k="${k}" class="${kind === k ? 'on' : ''}">${labels[k]}</button>`)
    .join('');
  const media = hasMedia
    ? `<div class="row">${ic('play')}<span>${esc(intro.media.name)} · ${(intro.media.size / 1048576).toFixed(1)} MB · ${esc(intro.media.mime)}</span>
         ${share ? '<button type="button" class="btn small danger" id="introMediaRemove">Remove</button>' : ''}</div>`
    : '';
  const subRows = subs
    .map(
      (x) => `<div class="row"><span class="pill">${esc(x.lang)}</span><span>${esc(x.label)}</span>
                <button type="button" class="btn small danger" data-sub-rm="${esc(x.lang)}">Remove</button></div>`
    )
    .join('');
  const subtitles = !share
    ? ''
    : `
    <div class="field" id="subsField" ${kind === 'video' ? '' : 'hidden'}>
      <label>Captions and translations (WebVTT files, one per language)</label>
      ${subs.length ? `<div class="stack" style="gap:var(--s1)">${subRows}</div>` : ''}
      <div class="row">
        <input type="text" id="subLang" placeholder="Language code, e.g. es" style="width:180px">
        <input type="text" id="subLabel" placeholder="Label shown to testers, e.g. Español" style="flex:1;width:auto">
        <label class="btn small" for="subFile">Upload .vtt<input type="file" id="subFile" accept=".vtt,text/vtt" style="display:none"></label>
      </div>
      <div class="hint">Ask Claude to transcribe your video and translate the captions into any language; it writes .vtt
        files you upload here. The tester picks the language in the player; their browser language is chosen
        automatically when it matches.</div>
    </div>`;
  return `
    <div class="section">
      <h3>Before you start</h3>
      <div class="hint">What testers see first. The consent text about recording is always shown below whatever you add here.</div>
      <div class="seg" id="introKind">${kindButtons}</div>
      <div class="field" id="introTextField" ${kind === 'default' ? 'hidden' : ''}>
        <label>Intro text (blank line = new paragraph, lines starting with "- " = bullets, **bold**)</label>
        <textarea id="introText" placeholder="Thanks for helping us test the new checkout. There are no right or wrong answers…">${esc(intro.text || '')}</textarea>
      </div>
      <div class="field" id="introMediaField" ${kind === 'audio' || kind === 'video' ? '' : 'hidden'}>
        <label>Recording</label>
        ${media}
        <div class="drop" id="introDrop">${hasMedia ? 'Drop a new file to replace it' : 'Drop an audio or video file here, or click to choose'}
          <input type="file" id="introFile" accept="${me.server.mediaTypes.join(',')}"></div>
        <div class="hint">MP4 (H.264) or WebM video, MP3, M4A or WAV audio. Up to ${me.server.maxMediaMb} MB. Streams to
          testers in pieces, so large files play without a full download. The player has captions, language choice and
          full screen.</div>
        <div class="progress" id="introProg" hidden><i></i></div>
      </div>
      ${subtitles}
    </div>`;
}
function wireIntroEditor(shareId, pendingRef) {
  $('#introKind')
    .querySelectorAll('button')
    .forEach((b) => {
      b.onclick = () => {
        $('#introKind')
          .querySelectorAll('button')
          .forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        const k = b.dataset.k;
        $('#introTextField').hidden = k === 'default';
        $('#introMediaField').hidden = !(k === 'audio' || k === 'video');
        if ($('#subsField')) $('#subsField').hidden = k !== 'video';
      };
    });
  const d = $('#introDrop');
  d.onclick = (e) => {
    if (e.target.tagName !== 'INPUT') $('#introFile').click();
  };
  d.ondragover = (e) => {
    e.preventDefault();
    d.style.borderColor = 'var(--accent)';
  };
  d.ondragleave = () => (d.style.borderColor = '');
  const take = async (file) => {
    if (!file) return;
    if (!me.server.mediaTypes.includes(file.type))
      return alert('Unsupported file type: ' + (file.type || 'unknown') + '. Use MP4, WebM, MP3, M4A or WAV.');
    if (file.size > me.server.maxMediaMb * 1048576)
      return alert('File is larger than the server limit of ' + me.server.maxMediaMb + ' MB');
    if (shareId) {
      await uploadIntro(shareId, file);
      render();
    } else {
      pendingRef.media = file;
      d.textContent = `${file.name} (${(file.size / 1048576).toFixed(1)} MB), uploads after you create the share`;
      d.classList.add('has');
    }
  };
  d.ondrop = (e) => {
    e.preventDefault();
    d.style.borderColor = '';
    take(e.dataTransfer.files[0]);
  };
  $('#introFile').onchange = (e) => take(e.target.files[0]);
  if ($('#introMediaRemove'))
    $('#introMediaRemove').onclick = async () => {
      if (!confirm('Remove the recording?')) return;
      await api('/shares/' + shareId + '/intro', { method: 'DELETE' });
      render();
    };
  if ($('#subFile'))
    $('#subFile').onchange = async (e) => {
      const f = e.target.files[0];
      const lang = $('#subLang').value.trim().toLowerCase();
      if (!f || !lang) return alert('Enter a language code first (for example en, es, de, ja).');
      try {
        await uploadXhr('PUT', `/shares/${shareId}/subtitles/${encodeURIComponent(lang)}`, f, {
          'Content-Type': 'text/vtt',
          'X-Label': encodeURIComponent($('#subLabel').value.trim() || lang),
        });
        toast('Captions uploaded');
        render();
      } catch (err) {
        alert(err.message);
      }
    };
  document.querySelectorAll('[data-sub-rm]').forEach((b) => {
    b.onclick = async () => {
      await api(`/shares/${shareId}/subtitles/${encodeURIComponent(b.dataset.subRm)}`, { method: 'DELETE' });
      render();
    };
  });
}
function introValue() {
  return { kind: $('#introKind .on').dataset.k, text: $('#introText').value };
}
async function uploadIntro(shareId, file) {
  const p = $('#introProg');
  p.hidden = false;
  try {
    await uploadXhr(
      'PUT',
      '/shares/' + shareId + '/intro',
      file,
      { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) },
      (f) => (p.firstElementChild.style.width = Math.round(f * 100) + '%')
    );
    toast('Recording uploaded');
  } catch (e) {
    alert(e.message);
  } finally {
    p.hidden = true;
  }
}
