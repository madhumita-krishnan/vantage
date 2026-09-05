'use strict';
// Usability results: per-tester interaction summary, task outcomes, CSV export and the Markdown report.
const { normalizeTasks, shareStatus } = require('./shares');

function perTester(rows) {
  const per = {};
  for (const r of rows) {
    const p =
      per[r.email] ||
      (per[r.email] = {
        viewer: r.viewer,
        email: r.email,
        sessions: new Set(),
        events: 0,
        clicks: 0,
        pageviews: 0,
        errors: 0,
        first: r.ts,
        last: r.ts,
        paths: {},
      });
    p.sessions.add(r.session);
    p.events++;
    if (r.type === 'click') p.clicks++;
    if (r.type === 'pageview' || r.type === 'navigate') p.pageviews++;
    if (r.type === 'error') p.errors++;
    if (r.ts < p.first) p.first = r.ts;
    if (r.ts > p.last) p.last = r.ts;
    if (r.path) p.paths[r.path] = (p.paths[r.path] || 0) + 1;
  }
  return Object.values(per).map((p) => ({ ...p, sessions: p.sessions.size }));
}
function taskStats(share, fb) {
  const count = (i, result) => fb.filter((f) => f.kind === 'task' && f.taskIndex === i && f.result === result).length;
  return normalizeTasks(share.tasks).map((t, index) => ({
    index,
    task: t.text,
    kind: t.kind,
    when: t.when,
    done: count(index, 'done'),
    stuck: count(index, 'stuck'),
    answers: count(index, 'answer'),
  }));
}
function summary(share, fb, rows) {
  return {
    viewers: perTester(rows),
    tasks: taskStats(share, fb),
    feedbackCount: fb.filter((f) => f.kind === 'feedback').length,
    noteCount: fb.filter((f) => f.kind === 'note').length,
    eventCount: rows.length,
    mode: share.mode || 'unmoderated',
    recordingCount: Object.keys(share.recordings || {}).length,
  };
}
function eventsCsv(rows) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['ts', 'viewer', 'email', 'session', 't', 'type', 'path', 'target', 'x', 'y', 'detail'];
  return [head.join(',')]
    .concat(
      rows.map((r) =>
        [
          r.ts,
          r.viewer,
          r.email,
          r.session,
          r.t,
          r.type,
          r.path,
          r.data && r.data.target,
          r.data && r.data.x,
          r.data && r.data.y,
          JSON.stringify(r.data || {}),
        ]
          .map(q)
          .join(',')
      )
    )
    .join('\n');
}
const topPaths = (paths) =>
  Object.entries(paths)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map((x) => `\`${x[0]}\` (${x[1]})`)
    .join(', ');
function report(share, fb, rows, au) {
  const d = (t) =>
    String(t || '')
      .replace('T', ' ')
      .slice(0, 16);
  const one = (n) => n.text.replace(/\n/g, ' ');
  const L = [
    `# ${share.name}`,
    '',
    `${share.mode === 'view' ? 'View-only share (nothing recorded)' : 'Usability ' + (share.mode === 'moderated' ? 'moderated' : 'unmoderated') + ' test report'}. Generated ${d(new Date().toISOString())}. Share ${share.id}, created ${d(new Date(share.createdAt).toISOString())}, expires ${d(new Date(share.expiresAt).toISOString())}, status ${shareStatus(share)}.`,
    '',
  ];
  L.push('## Participants', '', '| Name | Email | Opens | Last seen |', '|---|---|---|---|');
  for (const v of Object.values(share.viewers || {}))
    L.push(
      `| ${v.name} | ${v.email} | ${v.opens || 0} | ${v.lastSeenAt ? d(new Date(v.lastSeenAt).toISOString()) : '—'} |`
    );
  L.push('');
  const tasks = taskStats(share, fb);
  if (tasks.length) {
    L.push('## Tasks', '', '| # | Task | Completed | Could not complete |', '|---|---|---|---|');
    for (const t of tasks)
      L.push(`| ${t.index + 1} | ${t.kind === 'question' ? 'Q: ' : ''}${t.task} | ${t.done} | ${t.stuck} |`);
    L.push('');
    const notes = fb.filter((f) => f.kind === 'task' && f.text);
    if (notes.length) {
      L.push('### Task notes and answers', '');
      for (const n of notes)
        L.push(
          `- **${n.viewer}**, ${n.result === 'answer' ? 'question' : 'task'} ${n.taskIndex + 1} (${n.result === 'done' ? 'completed' : n.result === 'answer' ? 'answered' : 'stuck'})${n.location ? ` at \`${n.location}\`` : ''}: ${one(n)}`
        );
      L.push('');
    }
  }
  const per = perTester(rows);
  if (per.length) {
    L.push(
      '## Interaction summary',
      '',
      '| Participant | Sessions | Clicks | Screens | Errors | Most visited |',
      '|---|---|---|---|---|---|'
    );
    for (const p of per)
      L.push(
        `| ${p.viewer} (${p.email}) | ${p.sessions} | ${p.clicks} | ${p.pageviews} | ${p.errors} | ${topPaths(p.paths)} |`
      );
    L.push('');
  }
  const section = (title, items, fmt) => {
    if (items.length) {
      L.push(`## ${title}`, '');
      for (const f of items) L.push(fmt(f));
      L.push('');
    }
  };
  section(
    'Participant feedback',
    fb.filter((f) => f.kind === 'feedback'),
    (f) => `- **${f.viewer}** (${d(f.ts)})${f.location ? ` at \`${f.location}\`` : ''}: ${one(f)}`
  );
  section(
    'Moderator notes',
    fb.filter((f) => f.kind === 'note'),
    (n) => `- ${d(n.ts)}${n.viewer ? ` (${n.viewer})` : ''}: ${one(n)}`
  );
  const opens = au.filter((a) => a.type === 'link.redeemed' || a.type === 'sso.authorized').length;
  const rejected = au.filter((a) => /^(link\.rejected|sso\.denied|passcode\.fail)$/.test(a.type)).length;
  L.push(
    '## Access',
    '',
    `${opens} successful opens, ${rejected} rejected attempts. Full log available in the console.`,
    ''
  );
  return L.join('\n');
}
module.exports = { summary, eventsCsv, report };
