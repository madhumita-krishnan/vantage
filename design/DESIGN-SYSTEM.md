# Prototype Vault design system

One set of rules for every screen: the designer console, the tester view, and the canvas mockups. The values here are the values in `server/public/vault.css`. Change them there and everything follows.

## 1. Spacing scale

Everything (padding, gaps, margins) uses one of these. Nothing else.

| Token | px | Use |
|---|---|---|
| `--s1` | 4 | icon-to-label gap, pill padding |
| `--s2` | 8 | gap between buttons in a row, input padding (vertical) |
| `--s3` | 12 | input padding (horizontal), gap between related controls, table cell padding |
| `--s4` | 16 | gap between form fields, gap between grid columns |
| `--s5` | 20 | gap between a sheet's header and its first item, section title to content |
| `--s6` | 24 | gap between sections inside a card |
| `--s7` | 32 | gap between cards, page top padding |
| `--s8` | 48 | space below the footer text (the very bottom of every page) |
| `--s9` | 64 | **minimum** space between the last piece of content and the footer line; grows when the page is shorter than the screen |
| `--gutter` | 20 desktop / **16 phone** | **gutter**: card padding, page side padding, panel, sheet, modal and toast inset. Phone = viewport 700px or narrower |
| `--gutter-b` | 32 | **bottom gutter** inside any scrolling sheet or panel: space after the last item so nothing sits flush against the bottom edge (plus the device safe area on phones) |

**Gutter rule.** Inside any bounding box (card, panel, sheet, modal, toast) content starts `--gutter` from every edge, left and right the same: 20px on desktop, 16px on phones (700px and narrower). One token, set once in `vault.css`; never a literal 20 or 16 in a component. Fields are `width: 100%` of that content area with `box-sizing: border-box`, so the right edge of every field lands on the same line as the left edge does.

**Grid rule.** Side-by-side fields use `display: grid; grid-template-columns: repeat(N, minmax(0, 1fr)); gap: var(--s4)`. Never floats, never percentage widths with margins. `minmax(0, 1fr)` is what stops a long value from stretching one column.

**Bottom rule.** Every page ends the same way: content, then at least `--s9` (64px) of empty space, then the footer line, `--s5` (20px), the footer text, then `--s8` (48px) below it. The footer always feels like the bottom of the screen: the page is a flex column at least as tall as the viewport, the content area grows (`.content{flex:1}`) and the footer is pushed to the bottom (`margin-top:auto`). On a short page the gap above the footer line grows past 64; that is expected. On a long page the footer follows the content and the page scrolls with the platform scrollbar (thin, `--line` colored where the platform lets us style it). Nothing is fixed to the bottom, and the footer never floats mid-screen with empty space under it.

**Scrolling boxes.** A bottom sheet, side panel or modal body that can hold more than fits scrolls inside itself (`.scroll`), never the page behind it. Its content starts `--gutter` below the header row and ends with `--gutter-b` (32px, plus the phone safe area) of empty space. While more content is below the fold a 32px fade (`.scrollwrap.more`) shows at the bottom edge; it disappears at the end of the scroll, so the last line is always readable in full and never sits under the fade. The scrollbar is real and proportional (thin, `--line` colored where the platform lets us style it), never a painted stand-in. In the canvas mockups the sheets and the console pages really scroll, and the fade is driven by the scroll position.

**Stack rule.** A form is a vertical stack with `gap: var(--s4)` between field groups and `gap: var(--s6)` between sections. Do not add per-element margins on top of the gap.

## 2. Sizes

| Token | Value | Use |
|---|---|---|
| `--control-h` | 36px | every input, select, button, and tab hit-target on desktop |
| `--control-h-sm` | 28px | secondary buttons inside tables and headers |
| `--touch` | 44px | minimum hit target on phone (buttons and rows in the tester view) |
| `--r-control` | 6px | inputs, buttons, checkboxes |
| `--r-card` | 10px | cards, panels, modals |
| `--r-sheet` | 14px | the bottom sheet on phones |
| `--r-pill` | 99px | status pills, count badges |
| `--form-w` | 640px | max width of any single-column form |
| `--page-w` | 1100px | max width of the console |
| `--panel-w` | 340px | tester side panel on desktop |

## 3. Type

System font stack. One family, four sizes, two weights.

| Role | Size / line | Weight | Color |
|---|---|---|---|
| Page title | 20 / 28 | 600 | ink |
| Section title | 16 / 24 | 600 | ink |
| Body, inputs, buttons | 14 / 20 | 400 | ink |
| Table text | 13 / 20 | 400 | ink |
| Label, meta, hint | 12 / 16 | 400 (labels 500) | muted |
| Caption, pill | 11 / 16 | 600 pills, 400 captions | muted |

Numbers in tables and stat cells use `font-variant-numeric: tabular-nums` and are right-aligned, so columns of counts line up.

**No orphan words.** A paragraph, hint, label or table cell never ends with a single word on its own line, and headings never break with one word on the last line. Implemented once, globally: `text-wrap: pretty` on running text and `text-wrap: balance` on headings. When writing copy, keep hints short enough that this holds at the narrowest width the box can take.

## 4. Color

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | #f6f7f9 | #0f1115 | page |
| `--panel` | #ffffff | #171a21 | cards, header, sheets |
| `--ink` | #16181d | #e8eaf0 | text |
| `--muted` | #5f6673 | #9aa3b2 | secondary text, icons at rest |
| `--line` | #e3e6eb | #2a2f3a | borders, dividers |
| `--accent` | #2d5bff | #6b8cff | primary action, active tab, focus ring |
| `--ok` | #2b8a3e | #8ce99a | completed, active |
| `--warn` | #b7791f | #ffe066 | expiring, caution |
| `--danger` | #c92a2a | #ff8787 | revoke, stuck, errors |

Status pills use a tint of the status color as background (`active`, `expired`, `revoked`).

## 5. Icons

Inline SVG, 16px in tables and buttons, 20px in headers, stroke 1.75, round caps, `currentColor`. No emoji. The set used today:

| Name | Meaning |
|---|---|
| `lock` | confidential / the product mark |
| `people` | viewers (the people invited to open a prototype) |
| `eye` | opens (how many times links were opened) |
| `clock` | expiry |
| `key` | passcode |
| `check` | completed |
| `x` | could not complete / revoke |
| `download` | export |
| `play` | audio/video intro |

An icon with a number next to it always carries a `title` tooltip that spells it out ("4 viewers", "7 opens").

## 6. Components

- **Button**: height `--control-h`, padding `0 var(--s4)` (16px each side of the label), radius `--r-control`, 14px/500. Variants: primary (accent fill), default (panel fill, line border), danger (danger text). Small variant: `--control-h-sm`, padding `0 var(--s3)`, 12px; only inside tables and header rows. On phones a standard button is `--touch` (44px) tall with the standard 14px label and 16px padding; a small button is never stretched to 44. Buttons in a row: `display:flex; gap: var(--s2)`.
- **Input / select / textarea**: height `--control-h` (textarea min 96px), padding `0 var(--s3)`, radius `--r-control`, line border, accent focus ring (2px outline offset 1px). Always `width:100%`.
- **Field**: label (12/16, 500, muted) + control + optional hint (12/16 muted), stacked with `gap: var(--s1)`.
- **Card**: panel fill, line border, radius `--r-card`, padding `--s5`.
- **Section** inside a card: title (16/24 600) then content; sections separated by `--s6`.
- **Table**: 13px, header 12px 500 muted, cell padding `var(--s2) var(--s3)`, row divider `--line`. Count columns are fixed width (72px) and right-aligned. Action columns are fixed width and never wrap.
- **List row** (shares list): grid `minmax(0,1fr) 72px 72px 96px`, gap `--s4`, row padding `var(--s3) var(--s2)`. The count cells are icon + number, right-aligned, tabular figures.
- **Pill**: 11px 600 uppercase, padding `2px var(--s2)`, radius `--r-pill`.
- **Tabs**: 36px tall, 14px, active = ink text + 2px accent underline.
- **Switch** (every on/off option): a 36×20 pill track with a 16px round thumb. Off = line fill, thumb left; on = accent fill, thumb right. Label to the right, 13/20, aligned to the top of the track. Options stack with `--s3` gaps. A group with more than two switches starts with a **Select all** switch in muted text, separated by a line. Checkboxes are not used anywhere in the console.
- **Segmented toggle** (Unmoderated / Moderated, intro type): a pill. Outer track 28px tall, `--r-pill` radius, 2px padding, `--bg` fill, line border. Options are 24px pills, 13px/500; the selected one has `--panel` fill and a 1px shadow. It hugs its content (`align-self: flex-start`), never stretches.
- **Navigation bar**: 56px tall, panel fill, line border below. Brand (lock + name) on the left, then text links 36px tall with `--r-control` radius; the current page gets `--bg` fill and ink text. On the right: status text, then the **account chip** (24px initials circle in accent, the signed-in email, 13px muted, same 36px link shape; ink text and `--bg` fill when the Account page is open). Sign out lives on the Account page, not in the bar. The tester view keeps its own 44px header because the prototype needs the space.
- **Footer**: line border above, `--s5` padding top, `--s8` (48px) padding bottom, which is the gap at the bottom of every page, pushed to the bottom of the screen by the bottom rule. Same on every page of the console and in every desktop mockup. 12px muted text. Product name and version on the left, documentation links on the right.
- **Task editor row**: grid `110px minmax(0,1fr) 150px 110px 32px` with `--s2` gap: kind, text, when, value, remove. All controls 36px tall.
- **Recording indicator**: 28px pill, `--danger-bg` fill, danger text 12px/600, pulsing 8px dot, Stop button inside. Shown in the header for the whole time the microphone is on; never hidden while recording. On phones the label is hidden and the dot plus Stop remain. The toast that appears when recording starts is a courtesy; the pill is the permanent signal.
- **Media player**: 16:9 video with native controls plus a controls row below it: captions select (28px) and Full screen button. Audio uses the native player at full width.
- **Location label** (results, feedback): a small screen icon, the word "on", then the path in mono, muted, with a tooltip "Where they were in the prototype". Never a bare symbol.
- **Dictation button**: 32px circle at the bottom-right inside any answer box; muted at rest, danger fill while listening.
- **Modal** (tester): three parts, never one long box. Title row: on desktop 18/24 600 with `--gutter` padding; on phones it is the **sheet header row** (16/24 600, `--s3 --gutter` padding, line below), the same row the Tasks and Feedback sheets use, so every sheet on the phone starts the same way. A body that scrolls (`.scrollwrap > .mbody.scroll`, `--gutter` sides, `--s4` between blocks, section titles 14/20 600). An action row pinned at the bottom (line border above, `--gutter` padding plus safe area, buttons right-aligned with `gap: var(--s2)`, 44px tall). Max width 560 and max height the viewport minus a gutter on desktop; on phones it is a bottom sheet (top corners `--r-sheet`, at most 88% of the viewport). The tester never has to see everything at once: they read, scroll, and the buttons stay put.
- **Bottom sheet** (phone): 55% height (88% for Before you start), radius `--r-sheet` top corners, header row `--s3 --gutter` with a line below, body starts `--gutter` below the header, `--gutter` sides, ends with `--gutter-b` (scrolling box rules above).
- **Confirm dialog** (console): for anything that cannot be undone (disconnect a tool, revoke, delete). Title (18/24 600), one muted paragraph that says what happens and what does not, then Cancel and the action button (danger for destructive) right-aligned. Max width 480. Never a browser `confirm()`.
- **Account page**: four cards. *You* (who, how signed in, this browser, admins on the server, sign-out actions). *Connected tools* (table: tool, connected, last used, owner, Disconnect; a row to name and connect a new tool; a token box shown once after connecting with copy buttons for the token, the CLI setup and the Claude Code setup). *Leave Prototype Vault* (one danger button that deletes everything the person made and signs them out, through the confirm dialog, then a gate-style "You have left" screen). *Recent account activity* (timeline). Wording: a *tool* is something the person connected and named themselves (Claude Code, Cursor, a script), so "Disconnect" acts on one tool; "Leave" acts on the whole account.
- **Purpose toggle** (New share, Settings): a segmented toggle with three options, View only / Unmoderated / Moderated, above the Test setup section. View only hides Test setup entirely.
- **Toast** (every notification in the product): one at a time, bottom center, inset `--gutter` from the bottom (plus safe area) and never wider than the viewport minus two gutters or 480px. Ink fill, 13/20 text that wraps (never `nowrap`, never clipped), `--r-card` radius, a dismiss `×` on the right. It announces itself to screen readers (`role=status`, `aria-live=polite`). It always disappears on its own: 3s minimum, then about 50ms per character up to 8s; hovering pauses the timer, tapping `×` closes it. Toasts confirm or inform; they never ask a question and never hold the only route to an action (the Stop control for recording lives in the header pill, the toast only points to it). Copy is one or two short sentences.
- **Stat cell**: number 20/28 600 above label 12/16 muted; cells in a row with `gap: var(--s6)`.

## 7. Tester view specifics

- Header 44px, padding `0 var(--s3)`, gap `--s3`.
- Everything a tester taps is at least `--touch` tall on phones.
- Watermark: viewer email + date, rotated -24°, 9% opacity, tiled, never interactive.
- The "Before you start" screen is the tester's onboarding, and the only one: personal link, passcode if set, then this one modal, then the prototype. Its body is, in order: the designer's intro (text, audio or video), then a "What gets recorded" section with the voice switch and the consent buttons. Media sits above the consent text, never replaces it, because consent is the legal part. The modal follows the scrolling rules above, so a long intro is read by scrolling while the buttons stay in view. After it closes, the product explains itself in two toasts at most (recording on, tasks waiting) and the Tasks badge; there is no tour.

## 8. Changelog

- **2026-09-05, pass 5.** Bottom rule made structural: the page is a flex column, content grows, the footer is pushed to the bottom of the screen and the gap above it grows on short pages (it was drifting between pages). Desktop mockups are 1280×900 screens that scroll with a real scrollbar instead of one long frame. Button padding 16 (was 12); small 12 (was 8); phone task buttons are standard 44-tall buttons, not stretched small ones. Sheet header row standardized across Before you start, Tasks and Feedback (16/24, 12/16 padding, line below); sheet body starts 16 below it and ends with 32; the fade disappears at the end of the scroll and mockup sheets really scroll. Account chip in the nav, Account page, confirm dialog, purpose toggle with View only. Sign-in screen: company sign-in first, admin token as fallback, no sign-up.

- **2026-09-04, pass 4.** Gutter split by device: 20 desktop, 16 phone, one token. Bottom gutter (32) inside every scrolling sheet and panel, with a fade while more is below. Toast rules: wraps, obeys the gutter, dismiss control, auto-dismiss by length, one at a time. "Before you start" is title, scrolling body, pinned action row; phone version is a bottom sheet. Footer bottom gap standardized at 48 everywhere (the spec said 32 in one place).

- **2026-09-05, pass 3.** Switches replace checkboxes, with Select all above groups of more than two. No-orphan-words rule. Bottom rule: minimum 64px before the footer, 48px after it, and canvas frames sized with slack so nothing clips. Location label replaces the "@" symbol. Think-aloud recording is always offered (tester decides); typed-text recording is an explicit option, off by default.

- **2026-09-05, pass 2.** Segmented toggle shrunk to a 28px pill (was 36px square). Added navigation bar and footer with bottom gap; pages scroll, nothing is clipped. Added task editor row, recording indicator, media player controls, dictation button. Expiry can be any length up to the server maximum (365 days default), set by days or by date.
- **2026-09-04, pass 1.** First system: spacing scale, 20px gutter, 36px controls, grid rule for side-by-side fields, icon + count cells with tooltips, tabular numbers.

## 9. Applying it in the canvas

The canvas artboards are generated from these same tokens (`design/screens/` via the generator), so a change to a token in `vault.css` and in the generator keeps code and mockups identical. When you restyle something on the canvas, tell Claude which token you changed and it will update both.
