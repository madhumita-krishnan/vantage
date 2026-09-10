#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./lib');

const HELP = `Vantage CLI

Usage:
  vantage publish <folder|file.html> --name "Checkout v3" --viewers "Priya <priya@x.example>,tom@y.example" [options]
  vantage inline  <folder|file.html> [--in-place]          Bundle external scripts/styles/fonts into ./vendor so the prototype is self-contained
  vantage list                                              List shares
  vantage show <shareId>                                    Show a share and its viewers (links are shown once, when issued)
  vantage add-viewer <shareId> "Name <email>" [...]         Invite more people (prints their links)
  vantage revoke <shareId> [--viewer <viewerId>]            Revoke the whole share, or one viewer
  vantage rotate <shareId> --viewer <viewerId>              Issue a new link for one viewer
  vantage extend <shareId> --days 7                         Extend expiry
  vantage results <shareId> [--format text|md|json]         Feedback, task outcomes and per-tester summary (md = shareable report)
  vantage report <shareId> [--out report.md]                Markdown report
  vantage note <shareId> "text" [--viewer <viewerId>]       Add a moderator note during a moderated session
  vantage intro <shareId> <file.mp4|.mp3> | --text "..."     Set the "Before you start" media or text
  vantage subtitles <shareId> <lang> <file.vtt> [--label "Español"]   Add captions/translation to the intro video
  vantage extend <shareId> --days 180                       Extend up to the server maximum (default 365 days)
  vantage activity <shareId>                                Access log
  vantage events <shareId> [--csv] [--out file]             Raw interaction events
  vantage delete <shareId>                                  Delete share and all its data
  vantage whoami                                            Who this token belongs to and how it is connected
  vantage disconnect                                        Revoke the token this CLI is using (the Account page can do the same)

Publish options:
  --name <text>            Required
  --viewers <list>         Comma-separated "Name <email>" or emails
  --expires <days>         Default: server default (usually 7)
  --passcode <text>        Optional second factor
  --tasks "a|b|c"          Tasks separated by |. Prefix "?" for a question. Schedule with "@after:2", "@screen:#team", "@min:5"
                           e.g. --tasks "Pick a plan|?What did you expect @after:1|Add a member @screen:#team"
  --record-text            Also record what testers type into the prototype (off by default)
  --no-show-tasks          Hide tasks from testers (moderated sessions)
  --entry <file.html>      Which file to open first
  --no-inline              Skip vendoring of external assets
  --no-watermark --no-record --no-consent
  --voice                  Offer think-aloud voice recording to testers (off by default)
  --screen                 Offer screen recording of the prototype tab, desktop browsers only (off by default)
  --require-sign-in        Testers must sign in with Google as the invited address (needs Google sign-in on the server)
  --max-opens <n>          Per-viewer open limit
  --mode view|unmoderated|moderated
                           view = just for looking (no tasks, recording, consent or feedback); moderated = live results and moderator notes.
                           Default: view, or unmoderated when --tasks is given
  --intro-text "..."       Custom "Before you start" text (blank line = paragraph, "- " = bullet, **bold**)
  --intro-media <file>     Voice or video intro (mp4, webm, mp3, m4a, wav)
  --notes <text>

Connection: a Vantage started on this machine is found automatically. For a remote Vantage set VANTAGE_URL and
VANTAGE_ADMIN_TOKEN (or --url, --token); get a token from the console: Account → Connect a tool. Revoke it there, or with: vantage disconnect
`;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--no-')) args[a.slice(5)] = false;
    else if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v == null || v.startsWith('--')) args[k] = true;
      else {
        args[k] = v;
        i++;
      }
    } else args._.push(a);
  }
  return args;
}
const splitList = (s) =>
  String(s || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
function parseTasks(spec) {
  return String(spec || '')
    .split('|')
    .map((raw) => {
      let text = raw.trim();
      if (!text) return null;
      const kind = text.startsWith('?') ? 'question' : 'task';
      if (kind === 'question') text = text.slice(1).trim();
      let when = { type: 'start', value: null };
      text = text.replace(/\s*@(after|screen|min|minutes):(\S+)\s*$/, (m, k, v) => {
        when =
          k === 'after'
            ? { type: 'after', value: Math.max(0, +v - 1) }
            : k === 'screen'
              ? { type: 'screen', value: v }
              : { type: 'minutes', value: +v };
        return '';
      });
      return { text, kind, when };
    })
    .filter(Boolean);
}
const log = (m) => console.error(m);

function printLinks(share) {
  console.log(`\n${share.name}  [${share.id}]  status: ${share.status}  expires: ${share.expiresAt}`);
  if (!share.viewers.length) console.log('  (no viewers yet — add some with: vantage add-viewer)');
  for (const v of share.viewers)
    console.log(
      `  ${v.revoked ? '✗' : '•'} ${v.name} <${v.email}>${v.revoked ? '  (revoked)' : v.link ? '\n      ' + v.link : '  (link shown once when issued; vantage rotate ' + share.id + ' --viewer ' + v.id + ' makes a new one)'}`
    );
  console.log('');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (!cmd || cmd === 'help' || args.help) {
    console.log(HELP);
    return;
  }

  if (cmd === 'inline') {
    const target = args._[1];
    if (!target) throw new Error('inline needs a folder or file');
    const root = args['in-place']
      ? fs.statSync(target).isFile()
        ? path.dirname(path.resolve(target))
        : path.resolve(target)
      : L.copyToTemp(target);
    const rep = await L.inlineExternal(root, log);
    console.log(`Rewrote ${rep.rewritten} references.${args['in-place'] ? '' : ` Self-contained copy at: ${root}`}`);
    if (rep.remaining.length) {
      console.log('\nStill referenced externally (will be blocked when served):');
      rep.remaining.forEach((u) => console.log('  ' + u));
    }
    return;
  }

  const cfg = L.config({ url: args.url, token: args.token });
  if (cmd === 'publish') {
    const target = args._[1];
    if (!target || !args.name) throw new Error('publish needs <folder|file> and --name');
    const { share, inlineReport } = await L.publish(
      cfg,
      {
        path: target,
        name: args.name,
        viewers: splitList(args.viewers),
        expiresInDays: args.expires ? +args.expires : undefined,
        passcode: args.passcode,
        tasks: parseTasks(args.tasks),
        entry: args.entry,
        recordText: !!args['record-text'],
        showTasks: args['show-tasks'] !== false,
        inline: args.inline !== false,
        watermark: args.watermark !== false,
        recordSessions: args.record !== false,
        requireConsent: args.consent !== false,
        maxOpensPerViewer: +args['max-opens'] || 0,
        notes: args.notes,
        externalOrigins: splitList(args['external-origins']),
        mode: ['view', 'unmoderated', 'moderated'].includes(args.mode) ? args.mode : undefined,
        voice: !!args.voice,
        screen: !!args.screen,
        requireSignIn: !!args['require-sign-in'],
        introText: args['intro-text'],
        introMedia: args['intro-media'],
      },
      log
    );
    if (inlineReport && inlineReport.remaining.length) {
      log('\nWarning: these external references remain and will be blocked by the Vantage:');
      inlineReport.remaining.forEach((u) => log('  ' + u));
    }
    console.log(`\nPublished. Admin page: ${cfg.url}/admin`);
    printLinks(share);
    return;
  }
  if (cmd === 'list') {
    const { shares } = await L.api(cfg, 'GET', '/shares');
    if (!shares.length) return console.log('No shares.');
    for (const s of shares)
      console.log(
        `${s.id}  ${s.status.padEnd(8)}  ${s.viewerCount} viewers  ${String(s.totalOpens).padStart(3)} opens  exp ${s.expiresAt.slice(0, 10)}  ${s.name}`
      );
    return;
  }
  const id = args._[1];
  if (
    [
      'show',
      'add-viewer',
      'revoke',
      'rotate',
      'extend',
      'results',
      'activity',
      'events',
      'delete',
      'report',
      'note',
      'intro',
      'subtitles',
    ].includes(cmd) &&
    !id
  )
    throw new Error(`${cmd} needs a shareId`);
  if (cmd === 'show') {
    const { share } = await L.api(cfg, 'GET', `/shares/${id}`);
    printLinks(share);
    return;
  }
  if (cmd === 'add-viewer') {
    const { viewers } = await L.api(cfg, 'POST', `/shares/${id}/viewers`, { viewers: args._.slice(2) });
    for (const v of viewers) console.log(`• ${v.name} <${v.email}>\n    ${v.link}`);
    return;
  }
  if (cmd === 'revoke') {
    if (args.viewer) {
      await L.api(cfg, 'DELETE', `/shares/${id}/viewers/${args.viewer}`);
      console.log('Viewer revoked.');
    } else {
      await L.api(cfg, 'PATCH', `/shares/${id}`, { revoked: true });
      console.log('Share revoked. All links stop working now.');
    }
    return;
  }
  if (cmd === 'rotate') {
    const { viewer } = await L.api(cfg, 'POST', `/shares/${id}/viewers/${args.viewer}/rotate`);
    console.log(`New link for ${viewer.email}:\n  ${viewer.link}`);
    return;
  }
  if (cmd === 'extend') {
    const { share } = await L.api(cfg, 'PATCH', `/shares/${id}`, { extendDays: +(args.days || 7) });
    console.log(`Now expires ${share.expiresAt}`);
    return;
  }
  if (cmd === 'activity') {
    const { audit } = await L.api(cfg, 'GET', `/shares/${id}/audit`);
    for (const a of audit)
      console.log(
        `${a.ts}  ${a.type.padEnd(20)} ${a.email || a.by || ''} ${a.reason ? '(' + a.reason + ')' : ''} ${a.ip || ''}`
      );
    return;
  }
  if (cmd === 'report') {
    const md = await L.fetchText(cfg, `/shares/${id}/report`);
    if (args.out) {
      fs.writeFileSync(args.out, md);
      console.log(`Wrote ${args.out}`);
    } else process.stdout.write(md);
    return;
  }
  if (cmd === 'note') {
    const { note } = await L.api(cfg, 'POST', `/shares/${id}/notes`, { text: args._[2], viewerId: args.viewer });
    console.log(`Noted at ${note.ts}`);
    return;
  }
  if (cmd === 'intro') {
    if (args.text) {
      await L.api(cfg, 'PATCH', `/shares/${id}`, { intro: { kind: 'text', text: args.text } });
      console.log('Intro text set.');
      return;
    }
    if (args._[2]) {
      await L.uploadIntroMedia(cfg, id, args._[2]);
      console.log('Intro media uploaded.');
      return;
    }
    throw new Error('intro needs a media file or --text');
  }
  if (cmd === 'subtitles') {
    const [, , lang, file] = args._;
    if (!lang || !file) throw new Error('subtitles needs <lang> <file.vtt>');
    await L.uploadSubtitles(cfg, id, lang, file, args.label);
    console.log(`Captions (${lang}) uploaded.`);
    return;
  }
  if (cmd === 'results' && args.format === 'md') {
    process.stdout.write(await L.fetchText(cfg, `/shares/${id}/report`));
    return;
  }
  if (cmd === 'results' && args.format === 'json') {
    process.stdout.write(await L.fetchText(cfg, `/shares/${id}/report?format=json`));
    return;
  }
  if (cmd === 'results') {
    const [{ feedback }, sum] = await Promise.all([
      L.api(cfg, 'GET', `/shares/${id}/feedback`),
      L.api(cfg, 'GET', `/shares/${id}/summary`),
    ]);
    console.log(
      `Testers: ${sum.viewers.length}   Interactions: ${sum.eventCount}   Feedback notes: ${sum.feedbackCount}`
    );
    if (sum.tasks.length) {
      console.log('\nTasks:');
      for (const t of sum.tasks) console.log(`  ${t.index + 1}. ${t.task}   completed ${t.done} / stuck ${t.stuck}`);
    }
    if (sum.viewers.length) {
      console.log('\nPer tester:');
      for (const v of sum.viewers)
        console.log(
          `  ${v.viewer} <${v.email}>  sessions ${v.sessions}  clicks ${v.clicks}  screens ${v.pageviews}  errors ${v.errors}  ${v.first.slice(0, 16)} → ${v.last.slice(0, 16)}`
        );
    }
    if (feedback.length) {
      console.log('\nFeedback:');
      for (const f of feedback)
        console.log(
          `  ${f.ts.slice(0, 16)}  ${f.viewer}${f.kind === 'task' ? `  [task ${f.taskIndex + 1}: ${f.result}]` : ''}${f.location ? `  @${f.location}` : ''}${f.text ? `\n      ${f.text.replace(/\n/g, '\n      ')}` : ''}`
        );
    }
    return;
  }
  if (cmd === 'events') {
    if (args.csv) {
      const r = await fetch(`${cfg.url}/api/shares/${id}/events?format=csv`, {
        headers: { Authorization: 'Bearer ' + cfg.token },
      });
      const t = await r.text();
      if (args.out) {
        fs.writeFileSync(args.out, t);
        console.log(`Wrote ${args.out}`);
      } else process.stdout.write(t);
    } else {
      const { events } = await L.api(cfg, 'GET', `/shares/${id}/events`);
      const t = JSON.stringify(events, null, 1);
      if (args.out) {
        fs.writeFileSync(args.out, t);
        console.log(`Wrote ${args.out}`);
      } else process.stdout.write(t);
    }
    return;
  }
  if (cmd === 'delete') {
    await L.api(cfg, 'DELETE', `/shares/${id}`);
    console.log('Deleted.');
    return;
  }
  if (cmd === 'whoami') {
    const m = await L.api(cfg, 'GET', '/me');
    console.log(`${m.identity.who}  (${m.identity.label})  server ${cfg.url}`);
    if (m.identity.tokenId) console.log(`token id ${m.identity.tokenId}; revoke it with: vantage disconnect`);
    return;
  }
  if (cmd === 'disconnect') {
    const m = await L.api(cfg, 'GET', '/me');
    if (!m.identity.tokenId)
      throw new Error(
        'This CLI uses the server admin token, which cannot be revoked from here. Change ADMIN_TOKEN on the server instead.'
      );
    await L.api(cfg, 'DELETE', '/tokens/current');
    console.log('Disconnected. This token no longer works; remove it from VANTAGE_ADMIN_TOKEN.');
    return;
  }
  throw new Error(`Unknown command: ${cmd}\n${HELP}`);
}
main().catch((e) => {
  console.error('Error: ' + e.message);
  process.exit(1);
});
