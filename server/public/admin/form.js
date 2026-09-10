'use strict';
// Form pieces shared by New share and a share's Settings tab: the task editor, the purpose toggle, the option
// switches, and the "Before you start" intro editor.
/* exported taskEditor, wireTaskEditor, taskValue, modeSeg, wireModeSeg, modeValue, optionChecks, wireOptions,
   optionValues, introEditor, wireIntroEditor, introValue, uploadIntro */
/* global $, esc, ic, toast, api, uploadXhr, render */

// ---- tasks and questions: a title, an optional description and a "when" rule, laid out like a form builder ----
const WHEN = { start: 'At the start', after: 'After task…', screen: 'On screen…', minutes: 'After … minutes' };
const WHEN_PLACEHOLDER = { after: 'task #', screen: '#checkout', minutes: '5', start: '' };

function taskRow(t) {
  t = t || { text: '', description: '', kind: 'task', when: { type: 'start', value: '' } };
  const options = Object.entries(WHEN)
    .map(([k, v]) => `<option value="${k}" ${t.when.type === k ? 'selected' : ''}>${v}</option>`)
    .join('');
  const title =
    t.kind === 'question'
      ? 'Question, e.g. What did you expect to happen here?'
      : 'Task, e.g. Find the price of the annual plan';
  return `
    <div class="taskcard">
      <div class="head">
        <input type="text" class="tt" value="${esc(t.text)}" placeholder="${title}" aria-label="Title">
        <select class="tk" aria-label="Kind">
          <option value="task" ${t.kind === 'task' ? 'selected' : ''}>Task</option>
          <option value="question" ${t.kind === 'question' ? 'selected' : ''}>Question</option>
        </select>
      </div>
      <textarea class="td" aria-label="Description" placeholder="Description (optional): where to start, what counts as done, anything the tester should know">${esc(t.description || '')}</textarea>
      <div class="foot">
        <span class="hint">Show it</span>
        <select class="tw" aria-label="When it appears">${options}</select>
        <input type="text" class="tv" value="${esc(t.when.type === 'after' ? t.when.value + 1 : (t.when.value ?? ''))}" placeholder="${WHEN_PLACEHOLDER[t.when.type]}"
          ${t.when.type === 'start' ? 'disabled' : ''} aria-label="When: value">
        <span></span>
        <button type="button" class="rm" title="Remove">${ic('x')}</button>
      </div>
    </div>`;
}
function taskEditor(tasks) {
  return `
    <div class="field">
      <label>Tasks and questions for testers</label>
      <div class="stack" id="tasks" style="gap:var(--s4)">${tasks.map(taskRow).join('')}</div>
      <div class="row">
        <button type="button" class="btn small" id="taskAdd">${ic('plus')}Add</button>
        <span class="hint">A task gets Completed / Couldn't buttons; a question gets a text answer. "Show it" says when
          it appears: at the start, after another task, when the tester reaches a screen (the page path or #hash), or
          after a number of minutes.</span>
      </div>
    </div>`;
}
function wireTaskEditor() {
  const box = $('#tasks');
  const wire = (r) => {
    r.querySelector('.rm').onclick = () => r.remove();
    r.querySelector('.tk').onchange = (e) => {
      r.querySelector('.tt').placeholder =
        e.target.value === 'question'
          ? 'Question, e.g. What did you expect to happen here?'
          : 'Task, e.g. Find the price of the annual plan';
    };
    r.querySelector('.tw').onchange = (e) => {
      const v = r.querySelector('.tv');
      v.disabled = e.target.value === 'start';
      v.placeholder = WHEN_PLACEHOLDER[e.target.value];
      if (e.target.value === 'start') v.value = '';
    };
  };
  box.querySelectorAll('.taskcard').forEach(wire);
  $('#taskAdd').onclick = () => {
    box.insertAdjacentHTML('beforeend', taskRow());
    wire(box.lastElementChild);
    box.lastElementChild.querySelector('.tt').focus();
  };
}
function taskValue() {
  return [...$('#tasks').querySelectorAll('.taskcard')]
    .map((r) => {
      const type = r.querySelector('.tw').value;
      let value = r.querySelector('.tv').value.trim();
      if (type === 'after') value = Math.max(0, (+value || 1) - 1); // people count from 1; the server from 0
      return {
        text: r.querySelector('.tt').value,
        description: r.querySelector('.td').value,
        kind: r.querySelector('.tk').value,
        when: { type, value },
      };
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
function wireModeSeg() {
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
        // Tasks are shown in an unmoderated test and hidden in a moderated one (the moderator asks them); the switch
        // below can still be changed afterwards.
        if ($('#showTasks')) {
          $('#showTasks').checked = b.dataset.m === 'unmoderated';
          $('#showTasks').dispatchEvent(new Event('change'));
        }
      };
    });
  set();
}
const modeValue = () => $('#modeSeg .on').dataset.m;

// ---- option switches: three that change what a tester experiences stay in view; the rest sit under "More
// settings", grouped, each with a short title and one line of what it does ----
const OPTIONS = [
  {
    id: 'showTasks',
    main: true,
    title: 'Show tasks to testers',
    desc: 'Off for moderated sessions, where you ask them yourself.',
    on: (s) => s.showTasks !== false,
  },
  {
    id: 'voice',
    main: true,
    title: 'Offer voice recording',
    desc: 'Think-aloud audio. Testers choose on the consent screen and can stop at any time.',
    on: (s) => !!s.voice,
  },
  {
    id: 'screen',
    main: true,
    title: 'Offer screen recording',
    desc: 'A video of the prototype tab, desktop browsers only. About 5 MB a minute.',
    on: (s) => !!s.screen,
  },
  {
    id: 'record',
    group: 'Recording',
    title: 'Record interactions',
    desc: 'Clicks, navigation, focus and scroll.',
    on: (s) => s.recordSessions !== false,
  },
  {
    id: 'recordText',
    group: 'Recording',
    title: 'Record what testers type',
    desc: 'Off by default so real personal data is never captured. Turn on when the prototype uses sample data.',
    on: (s) => !!s.recordText,
  },
  {
    id: 'consent',
    group: 'Consent and privacy',
    title: 'Ask for consent before recording',
    desc: 'Always on when voice or screen recording is offered; that is where testers choose.',
    on: (s) => s.requireConsent !== false,
  },
  {
    id: 'wm',
    group: 'Consent and privacy',
    title: "Watermark with the viewer's email",
    desc: 'Over every screen, so a screenshot names who took it.',
    on: (s) => s.watermark !== false,
  },
  {
    id: 'signin',
    group: 'Access',
    title: 'Require Google sign-in',
    desc: 'The link opens only for the invited address, so a forwarded link opens nothing. Needs Google sign-in on this server; excludes people without a Google account.',
    on: (s) => !!s.requireSignIn,
  },
];
const sw = (o, on) =>
  `<label class="opt"><input type="checkbox" id="${o.id}" ${on ? 'checked' : ''}><span class="sw"></span><span><b>${o.title}</b><span class="hint">${o.desc}</span></span></label>`;
function optionChecks(s) {
  const main = OPTIONS.filter((o) => o.main)
    .map((o) => sw(o, o.on(s)))
    .join('');
  const groups = [...new Set(OPTIONS.filter((o) => o.group).map((o) => o.group))];
  const more = groups
    .map(
      (g) =>
        `<div class="optgroup"><h4>${g}</h4>${OPTIONS.filter((o) => o.group === g)
          .map((o) => sw(o, o.on(s)))
          .join('')}</div>`
    )
    .join('');
  return `<div class="stack" id="opts" style="gap:var(--s3)">${main}</div>
    <details class="more"><summary>More settings</summary><div class="stack" style="gap:var(--s5)">${more}</div></details>`;
}
function wireOptions() {} // nothing to wire; kept so the pages that call it do not change
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
        <div class="drop" id="introDrop"><span>${hasMedia ? 'Drop a new file to replace it' : 'Drop an audio or video file here, or click to choose'}</span>
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
      d.firstElementChild.textContent = `${file.name} (${(file.size / 1048576).toFixed(1)} MB), uploads after you create the share`;
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
