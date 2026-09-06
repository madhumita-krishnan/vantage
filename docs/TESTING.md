# How this code was checked

For anyone who wants to know what "tested" means here. Four kinds of checking, in plain words, and then what has not been checked.

## 1. Automatic tests, run on every change

Sixteen tests start a real copy of the server on random ports, with a throwaway data folder, and drive it the way a browser, the console, and the command-line tools would. They run with one command (`cd server && npm test`) and again on GitHub every time code is pushed, on Node 20 and Node 22. If any of them fails, the change does not go in.

What each one proves:

| Test | What it proves |
|---|---|
| Quick start | Starting with no settings makes a secret key once, keeps it in a private file, reuses it next time, and listens on your machine only. |
| Explicit admin token | Setting your own token skips the secrets file, listens on all interfaces, and refuses a token shorter than 24 characters. |
| Admin API and identity | Every console call without a valid credential is refused. The sign-in screen reveals no secrets. The identity endpoint gives away no file paths. |
| Share defaults | A share is view-only unless a test is set up. Voice and dictation are off unless switched on. Files with unsafe paths (`../`) are rejected. Bad emails are rejected. |
| Tester flow | The whole journey: the personal link's secret is stored only as a hash and shown once; the gate page carries the script that redeems it; the prototype is refused on the console's address and served only on the content address, inside a frame, behind a one-time ticket that works once; nothing is recorded before consent; clicks and feedback are counted correctly afterwards; cross-site posts are refused on both addresses; revoking a viewer kills both sessions and is logged. |
| Tracker placement | The recording script is inserted after the page's doctype even when the page has no `<head>`. |
| View-only | A view-only share records no events and has no feedback endpoint. |
| Passcode, rotation, expiry | A passcode under six characters is refused. A wrong passcode is refused, a right one lets the tester in. Rotating a link kills the old one. An expired share answers "gone". Deleting a share removes its files. Older links in the `?k=` form still work. |
| Personal access tokens | Tokens are created, work, are stored only as hashes, and stop working the moment they are disconnected. |
| Sample share | The "Try it" button publishes the bundled example with three tasks and a working link. |
| SSO header | A company sign-in header admits allowed domains only when the proxy is trusted, and is ignored otherwise. |
| Google sign-in | The sign-in round trip works against a stand-in for Google; a bad state is refused; the session is stored hashed; a cookie-signed request from another site is refused; each person sees only their own shares; the share limit applies; sign-out ends the session; a person not on the list is refused. |
| Storage limit | A person over their storage limit cannot upload more, and their testers cannot record voice into their shares either. |
| Housekeeping | Past the retention window a whole share is deleted. The admin log is trimmed. A backup of the metadata store is kept. The rate limiter survives sixty thousand junk keys. |
| Hardening | A client cannot spoof its address through the proxy header. Prototype pages open only inside a frame. Spreadsheet formulas in exported data are defused. Oversized event data is kept, truncated, instead of failing the batch. |
| Wildcard content address | With a wildcard content address, each share gets its own host and lookalike hosts are rejected. |

## 2. Checks by hand in a browser

After each round of changes the author opened the console in a real browser and walked the tester path: signed in, shared the sample prototype, opened the personal link, accepted the consent screen, watched the prototype load from the second address with the watermark and the task panel over it, clicked through to a screen that triggers a scheduled question, and confirmed on the results tab that the events arrived. One defect was found this way that the automatic tests had missed (the shell's own security policy refused to frame the second address); it was fixed and a test was added so it cannot come back. After the console was split into one file per page, every page (sign-in, list, share detail with all four tabs, new share, server, account, sign-out) was opened again and checked.

## 3. Tools that check the code itself

- **ESLint** reads every JavaScript file for mistakes such as unused variables, unhandled errors, and unsafe patterns. Zero warnings is the rule.
- **Prettier** formats every file the same way, so a reviewer reads code, not style.
- Both run on GitHub with the tests. A change that fails either is flagged before it can be merged.

## 4. A line-by-line audit

The author read every file of the server, the browser code and the tools with the question "how would someone break this or abuse this", and wrote up nineteen findings with severity and fix ([AUDIT.md](AUDIT.md)). Seventeen of the nineteen were fixed in the following release; two (one origin per share, and open sign-up on a hosted copy) are done on the code side and wait on infrastructure or a decision, marked in the audit.

## What has not been checked

- **No outside security firm has reviewed it.** Everything above was done by the author. An independent review would look at the same code with fresh eyes and different assumptions.
- **The console and tester pages have no automatic browser tests.** They are checked by hand (section 2). A change to those pages could break something the server tests cannot see.
- **Load.** Nobody has pointed a thousand testers at it. It is designed for a small team on one server.
- **The desktop viewer app** has had a smoke test, not more.
- **The command-line tool's asset inliner** has been tried against a few real CDNs, not systematically.
