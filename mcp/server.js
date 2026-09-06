#!/usr/bin/env node
'use strict';
/* Prototype Vault MCP server (stdio). Zero dependencies.
 * Lets Claude Code / Claude Desktop / Cursor publish prototypes to your self-hosted vault and read back results.
 * Config: VAULT_URL and VAULT_ADMIN_TOKEN, or nothing at all when a vault started on this machine (it reads server/data/local-secrets.json). */
const path = require('path');
const L = require(path.join(__dirname, '..', 'cli', 'lib.js'));

const TOOLS = [
  {
    name: 'vault_publish_prototype',
    description:
      'Publish a coded prototype (folder or single HTML file) to the self-hosted Prototype Vault and get one private link per viewer. External scripts/styles/fonts are bundled locally first so the prototype is self-contained. Confirm viewers and expiry with the user before calling.',
    inputSchema: {
      type: 'object',
      required: ['path', 'name', 'viewers'],
      properties: {
        path: {
          type: 'string',
          description:
            'Absolute path to the prototype folder or .html file. Must be inside the current project folder unless allowAnyPath is true.',
        },
        allowAnyPath: {
          type: 'boolean',
          description: "Allow a path outside the current project folder. Only with the user's explicit say-so.",
        },
        name: { type: 'string', description: 'Human-readable share name, e.g. "Checkout v3 — round 2"' },
        viewers: {
          type: 'array',
          items: { type: 'string' },
          description: 'People allowed to open it: "Name <email>" or plain emails',
        },
        expiresInDays: { type: 'number', description: 'Days until links stop working (server default if omitted)' },
        passcode: { type: 'string', description: 'Optional second factor to share by a separate channel' },
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              kind: { type: 'string', enum: ['task', 'question'] },
              when: {
                type: 'object',
                properties: { type: { type: 'string', enum: ['start', 'after', 'screen', 'minutes'] }, value: {} },
              },
            },
            required: ['text'],
          },
          description:
            'Tasks (Completed/Couldn\'t buttons) or questions (text answer). "when" schedules it: start; after (value = index of the task that must be done first); screen (value = path or #hash fragment the tester reaches); minutes (value = minutes into the session).',
        },
        recordText: {
          type: 'boolean',
          description:
            'Also record what testers type into the prototype. Off by default; never records password fields.',
        },
        showTasks: {
          type: 'boolean',
          description: 'Show tasks to testers. Default true, or false for moderated sessions.',
        },
        entry: { type: 'string', description: 'HTML file to open first (default index.html)' },
        inlineExternalAssets: { type: 'boolean', description: 'Vendor CDN assets locally (default true)' },
        recordSessions: { type: 'boolean' },
        requireConsent: { type: 'boolean' },
        watermark: { type: 'boolean' },
        voice: { type: 'boolean', description: 'Offer think-aloud voice recording to testers. Off by default.' },
        screen: {
          type: 'boolean',
          description: 'Offer screen recording of the prototype tab (desktop browsers). Off by default.',
        },
        requireSignIn: {
          type: 'boolean',
          description:
            'Testers must sign in with Google as the invited address, so a forwarded link opens nothing. Needs Google sign-in on the server. Off by default.',
        },
        mode: {
          type: 'string',
          enum: ['view', 'unmoderated', 'moderated'],
          description:
            'view = just for looking (stakeholder review, handoff): no tasks, no recording, no consent screen, no feedback button; opens are still logged. moderated = designer is on a call with the tester; results refresh live and moderator notes are enabled. Default: view, or unmoderated when tasks are given.',
        },
        introText: {
          type: 'string',
          description:
            'Custom "Before you start" text shown to testers (blank line = paragraph, "- " = bullet, **bold**)',
        },
        introMediaPath: {
          type: 'string',
          description: 'Absolute path to a voice or video intro (mp4, webm, mp3, m4a, wav)',
        },
        notes: { type: 'string' },
      },
    },
  },
  {
    name: 'vault_add_subtitles',
    description:
      'Add captions or a translation to the "Before you start" video as a WebVTT file. Claude can transcribe and translate the video into any language and write the .vtt first.',
    inputSchema: {
      type: 'object',
      required: ['shareId', 'lang', 'vttPath'],
      properties: {
        shareId: { type: 'string' },
        lang: { type: 'string', description: 'BCP-47 code, e.g. es, de, ja' },
        vttPath: { type: 'string', description: 'Absolute path to the .vtt file' },
        label: { type: 'string', description: 'Label shown to testers, e.g. Español' },
      },
    },
  },
  {
    name: 'vault_add_note',
    description: 'Add a moderator note to a share during or after a session, optionally about one viewer.',
    inputSchema: {
      type: 'object',
      required: ['shareId', 'text'],
      properties: { shareId: { type: 'string' }, text: { type: 'string' }, viewerId: { type: 'string' } },
    },
  },
  {
    name: 'vault_set_intro',
    description: 'Set the "Before you start" screen: custom text and/or a voice or video file.',
    inputSchema: {
      type: 'object',
      required: ['shareId'],
      properties: { shareId: { type: 'string' }, text: { type: 'string' }, mediaPath: { type: 'string' } },
    },
  },
  {
    name: 'vault_list_shares',
    description: 'List prototypes shared through the vault with status, viewer count and expiry.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'vault_get_share',
    description:
      'Get one share with its viewers. Personal links are shown once, when issued (publish, add viewers, rotate), and are not stored.',
    inputSchema: { type: 'object', required: ['shareId'], properties: { shareId: { type: 'string' } } },
  },
  {
    name: 'vault_add_viewers',
    description: 'Invite more people to an existing share. Returns their personal links.',
    inputSchema: {
      type: 'object',
      required: ['shareId', 'viewers'],
      properties: { shareId: { type: 'string' }, viewers: { type: 'array', items: { type: 'string' } } },
    },
  },
  {
    name: 'vault_revoke',
    description: 'Revoke a whole share, or a single viewer. Links stop working immediately.',
    inputSchema: {
      type: 'object',
      required: ['shareId'],
      properties: {
        shareId: { type: 'string' },
        viewerId: { type: 'string', description: 'Omit to revoke the whole share' },
      },
    },
  },
  {
    name: 'vault_extend',
    description: 'Extend a share expiry by N days.',
    inputSchema: {
      type: 'object',
      required: ['shareId', 'days'],
      properties: { shareId: { type: 'string' }, days: { type: 'number' } },
    },
  },
  {
    name: 'vault_get_results',
    description:
      'Usability results for a share: task outcomes, per-tester interaction summary, written feedback and moderator notes. format "markdown" returns a shareable report; "json" returns structured data (default).',
    inputSchema: {
      type: 'object',
      required: ['shareId'],
      properties: { shareId: { type: 'string' }, format: { type: 'string', enum: ['json', 'markdown'] } },
    },
  },
  {
    name: 'vault_get_activity',
    description: 'Access log for a share: who opened it, when, from where, and rejected attempts.',
    inputSchema: { type: 'object', required: ['shareId'], properties: { shareId: { type: 'string' } } },
  },
  {
    name: 'vault_get_events',
    description:
      'Raw recorded interaction events (clicks, navigation, focus, scroll, errors) for a share. Can be large.',
    inputSchema: {
      type: 'object',
      required: ['shareId'],
      properties: {
        shareId: { type: 'string' },
        limit: { type: 'number', description: 'Max events to return, newest last (default 500)' },
      },
    },
  },
];

function fmtShare(s) {
  let out = `${s.name} [${s.id}] — ${s.status}, expires ${s.expiresAt}${s.hasPasscode ? ', passcode' : ''}${s.files ? '' : ', NO FILES'}\nViewer page: ${s.url}\n`;
  if (s.viewers)
    for (const v of s.viewers)
      out += `  ${v.revoked ? '(revoked) ' : ''}${v.name} <${v.email}> opens:${v.opens}${v.link ? '\n    ' + v.link : ''}\n`;
  return out;
}
async function call(name, a) {
  const cfg = L.config();
  switch (name) {
    case 'vault_publish_prototype': {
      const abs = path.resolve(String(a.path || ''));
      if (!a.allowAnyPath && !abs.startsWith(process.cwd() + path.sep) && abs !== process.cwd())
        throw new Error(
          `${abs} is outside the current project folder (${process.cwd()}). Ask the user, then pass allowAnyPath: true.`
        );
      const logs = [];
      const { share, inlineReport } = await L.publish(
        cfg,
        {
          path: a.path,
          name: a.name,
          viewers: a.viewers,
          expiresInDays: a.expiresInDays,
          passcode: a.passcode,
          tasks: a.tasks,
          entry: a.entry,
          inline: a.inlineExternalAssets !== false,
          recordSessions: a.recordSessions,
          requireConsent: a.requireConsent,
          watermark: a.watermark,
          notes: a.notes,
          mode: a.mode,
          introText: a.introText,
          introMedia: a.introMediaPath,
          recordText: a.recordText,
          showTasks: a.showTasks,
          voice: a.voice,
          screen: a.screen,
          requireSignIn: a.requireSignIn,
        },
        (m) => logs.push(m)
      );
      let out = `Published.\n${fmtShare(share)}\nAdmin: ${cfg.url}/admin\n`;
      if (inlineReport) out += `\nInlined ${inlineReport.rewritten} external references.`;
      if (inlineReport && inlineReport.remaining.length)
        out += `\nWARNING — still referenced externally and will be blocked when served:\n  ${inlineReport.remaining.join('\n  ')}`;
      return out + (logs.length ? `\n\nLog:\n${logs.join('\n')}` : '');
    }
    case 'vault_list_shares': {
      const { shares } = await L.api(cfg, 'GET', '/shares');
      return shares.length ? shares.map(fmtShare).join('\n') : 'No shares yet.';
    }
    case 'vault_get_share': {
      const { share } = await L.api(cfg, 'GET', `/shares/${a.shareId}`);
      return fmtShare(share);
    }
    case 'vault_add_viewers': {
      const { viewers } = await L.api(cfg, 'POST', `/shares/${a.shareId}/viewers`, { viewers: a.viewers });
      return viewers.map((v) => `${v.name} <${v.email}>\n  ${v.link}`).join('\n');
    }
    case 'vault_revoke': {
      if (a.viewerId) {
        await L.api(cfg, 'DELETE', `/shares/${a.shareId}/viewers/${a.viewerId}`);
        return 'Viewer revoked.';
      }
      await L.api(cfg, 'PATCH', `/shares/${a.shareId}`, { revoked: true });
      return 'Share revoked; all links stop working now.';
    }
    case 'vault_extend': {
      const { share } = await L.api(cfg, 'PATCH', `/shares/${a.shareId}`, { extendDays: a.days });
      return `Now expires ${share.expiresAt}`;
    }
    case 'vault_add_subtitles': {
      await L.uploadSubtitles(cfg, a.shareId, a.lang, a.vttPath, a.label);
      return `Captions (${a.lang}) uploaded.`;
    }
    case 'vault_add_note': {
      const { note } = await L.api(cfg, 'POST', `/shares/${a.shareId}/notes`, { text: a.text, viewerId: a.viewerId });
      return `Noted at ${note.ts}`;
    }
    case 'vault_set_intro': {
      if (a.text != null) await L.api(cfg, 'PATCH', `/shares/${a.shareId}`, { intro: { kind: 'text', text: a.text } });
      if (a.mediaPath) await L.uploadIntroMedia(cfg, a.shareId, a.mediaPath);
      return 'Intro updated.';
    }
    case 'vault_get_results': {
      if (a.format === 'markdown') return await L.fetchText(cfg, `/shares/${a.shareId}/report`);
      const [{ feedback }, sum] = await Promise.all([
        L.api(cfg, 'GET', `/shares/${a.shareId}/feedback`),
        L.api(cfg, 'GET', `/shares/${a.shareId}/summary`),
      ]);
      return JSON.stringify({ summary: sum, feedback }, null, 1);
    }
    case 'vault_get_activity': {
      const { audit } = await L.api(cfg, 'GET', `/shares/${a.shareId}/audit`);
      return (
        audit
          .map(
            (x) => `${x.ts} ${x.type} ${x.email || x.by || ''} ${x.reason ? '(' + x.reason + ')' : ''} ${x.ip || ''}`
          )
          .join('\n') || 'No activity.'
      );
    }
    case 'vault_get_events': {
      const { events } = await L.api(cfg, 'GET', `/shares/${a.shareId}/events`);
      return JSON.stringify(events.slice(-(a.limit || 500)));
    }
    default:
      throw new Error('Unknown tool ' + name);
  }
}

// ---- minimal JSON-RPC over stdio (newline-delimited) ----
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line) handle(line);
  }
});
function reply(id, result, error) {
  if (id === undefined) return;
  process.stdout.write(JSON.stringify(error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result }) + '\n');
}
async function handle(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = msg;
  try {
    if (method === 'initialize')
      return reply(id, {
        protocolVersion: (params && params.protocolVersion) || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'prototype-vault', version: '0.3.0' },
      });
    if (method === 'notifications/initialized' || method === 'notifications/cancelled') return;
    if (method === 'ping') return reply(id, {});
    if (method === 'tools/list') return reply(id, { tools: TOOLS });
    if (method === 'tools/call') {
      try {
        const text = await call(params.name, params.arguments || {});
        return reply(id, { content: [{ type: 'text', text }] });
      } catch (e) {
        return reply(id, { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true });
      }
    }
    if (id !== undefined) reply(id, null, { code: -32601, message: 'Method not found: ' + method });
  } catch (e) {
    reply(id, null, { code: -32603, message: e.message });
  }
}
