# Why I built this, and where it took me

## The shift

Product designers now make working prototypes in code. Claude, v0, Lovable and their kind turn a description into HTML and JavaScript that behaves like the real thing: forms validate, states change, flows branch. That is new. Two years ago a designer showed a clickable Figma; today they can hand a tester something that works.

The tools for showing that work have not caught up. A coded prototype wants to be hosted somewhere, and in most companies the usual places are closed: Vercel and Netlify are blocked by policy, a chat artifact only shares inside the account, a raw HTML file cannot be taken back once sent, and a Figma import flattens the interactions that were the point. So designers screen-share, or email files, or give up and show a video.

## The post that started this

A product designer wrote this on LinkedIn in early September 2026. I have kept their words and left out their name.

> To all product designers using Claude for prototyping - has anyone figured out how to share prototypes outside of an Enterprise Claude account while keeping it private (confidential) yet shareable with specific users?
>
> I've hit a wall, and even Claude itself can't seem to solve this:
>
> - Sharing HTML isn't an option (no control over what happens next).
> - Sharing my screen (local env) doesn't work well for user testing.
> - Vercel isn't an option either.
> - Chat artifacts only allow internal sharing.
> - I tried Figma plugins, but the best one I found only imports HTML page by page, without interactions.

I recognised every line. I wanted to know what it would take to answer it properly, not with a workaround but with something a designer could run, and something a security team could read.

## What the post asks for

Read carefully, it asks for six things at once, and each one rules out a usual option.

| Need                                                 | Why the usual options fail                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| The prototype stays inside the company boundary      | Public hosting and third-party SaaS are blocked by policy                      |
| Only named people can open it                        | A file or a public link cannot be restricted or revoked                        |
| It is a real, interactive coded prototype            | Figma imports flatten it into static pages                                     |
| Testers can use it on their own device, unsupervised | Screen-sharing a local server breaks usability testing                         |
| The designer keeps control after sharing             | Links must expire, be revocable, and leave a record                            |
| Security teams can approve it                        | They need to see what it does, where data lives, and what it phones home to    |

## Where it took me

The first version was a single Node file: upload a folder, hand out links, serve the pages. That took an afternoon and answered the post on the surface.

Then I asked what a security reviewer would say, and the answer reshaped the whole thing. A prototype is untrusted code; if it runs on the same origin as the console, it can read the console. So prototypes moved to their own origin, inside a locked-down frame, with a content policy that stops them reaching anywhere else. Personal links became secrets that travel in the URL fragment, are stored only as hashes, and are shown once. Files and metadata became encrypted on disk with a key the operator holds. The server makes no outbound calls at all.

Then I asked what the designer actually wants after sharing, which is to learn something. So a share can become a usability test: tasks that appear on a schedule, a consent screen before anything is recorded, interaction recording, written feedback, optional voice and screen recording, and a results page with an exportable report. Claude can publish to it and read the results back, because that is where these prototypes are made.

Then I read every line again, twice, with the question "how does someone break this", and fixed thirty defects, several of them serious. That review is written up in [docs/AUDIT.md](docs/AUDIT.md) and [docs/TESTING.md](docs/TESTING.md), and it is the part of the project I would point at first: the build is the easy half.

## Who this helps

- A designer, or a small team, who can run one Node process, or whose IT can. There is nothing to install and nothing to configure for the first try.
- People whose testers are named and few: a handful of customers, colleagues or partners, each with their own link that can be withdrawn.
- Anyone running a short unmoderated or moderated usability test on a coded prototype and wanting the record afterwards: who opened it, what they did, what they said.
- Anyone whose company forbids third-party hosting. Nothing leaves the server, and the code is short enough to read before trusting it.

## Who it does not help, and why

- **Anyone who needs an audited product.** This was built in a few days with Claude Code and reviewed only by me. No outside security firm has seen it. A company with a procurement process will, rightly, want that first. [docs/SECURITY.md](docs/SECURITY.md) is written for that reviewer.
- **Anyone who needs to stop a screenshot or a forwarded link.** Nothing can. A watermark names the viewer, a passcode or a Google sign-in check makes a forwarded link useless, and the desktop viewer hides its window from screen capture, but a phone pointed at a screen defeats all of it. [docs/WHAT-IT-CANNOT-DO.md](docs/WHAT-IT-CANNOT-DO.md) says this plainly, for designers rather than engineers.
- **Prototypes that depend on the outside world.** A prototype that calls an API, loads a font from a CDN or embeds a map is blocked unless the operator allows that origin, because the whole point is that nothing leaks. The command-line tool can bundle CDN assets locally; live APIs are out.
- **Teams that want Figma-style commenting, versions or a recruiting panel.** None of that is here. It shares, gates, records and reports.
- **Designers without a server and without IT.** There is no public hosted copy yet. The code supports a hosted deployment with Google sign-in, and the deployment guide has the recipe, but someone has to run it.

## The limits of this build

- One process, one JSON file for metadata, files on local disk. Right for a team; wrong for a thousand testers.
- The console and tester pages have no automated browser tests. The server has twenty end-to-end tests; the pages were checked by hand.
- On a hosted copy, two prototypes opened in one browser share an origin unless the operator sets up wildcard DNS. The code supports it; the infrastructure is the operator's.
- Whoever runs the server can see everything on it. That is true of every self-hosted tool and worth saying out loud.

The answer in this folder is **Vantage**. What it is and how to try it in three steps is in [README.md](README.md).
