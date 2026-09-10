# Vantage design system

One set of rules for every screen: the designer console, the tester view, and the canvas mockups. The values here are the values in `server/public/vantage.css`. Change them there and everything follows.

Since 2026-09-07 the colours, type, radii and the navigation bar come from a Figma kit, "Dashboard - Free UI Kit". What was taken and what each value maps to is in `design/kit/KIT.md`. The spacing scale, gutter, bottom and scrolling rules are Vantage's own and did not change.

## 1. Spacing scale

Everything (padding, gaps, margins) uses one of these. Nothing else.

| Token | px | Use |
|---|---|---|
| `--s1` | 4 | icon-to-label gap, pill padding |
| `--s2` | 8 | gap between buttons in a row, input padding (vertical) |
| `--s3` | 12 | input padding (horizontal), gap between related controls, table cell padding |
| `--s4` | 16 | gap between form fields, gap between grid columns |
| `--s5` | 20 | gap between a sheet's header and its first item, section title to content |
| `--s6` | 24 | gap between a group of related controls and the next group |
| `--s7` | 32 | gap between sections inside a card, gap between cards, page top padding |
| `--s8` | 48 | space below the footer text (the very bottom of every page) |
| `--s9` | 64 | **minimum** space between the last piece of content and the footer line; grows when the page is shorter than the screen |
| `--gutter` | 20 desktop / **16 phone** | **gutter**: card padding, page side padding, panel, sheet, modal and toast inset. Phone = viewport 700px or narrower |
| `--gutter-b` | 32 | **bottom gutter** inside any scrolling sheet or panel: space after the last item so nothing sits flush against the bottom edge (plus the device safe area on phones) |

**Gutter rule.** Inside any bounding box (card, panel, sheet, modal, toast) content starts `--gutter` from every edge, left and right the same: 20px on desktop, 16px on phones (700px and narrower). One token, set once in `vantage.css`; never a literal 20 or 16 in a component. Fields are `width: 100%` of that content area with `box-sizing: border-box`, so the right edge of every field lands on the same line as the left edge does.

**Grid rule.** Side-by-side fields use `display: grid; grid-template-columns: repeat(N, minmax(0, 1fr)); gap: var(--s4)`. Never floats, never percentage widths with margins. `minmax(0, 1fr)` is what stops a long value from stretching one column.

**Bottom rule.** Every page ends the same way: content, then at least `--s9` (64px) of empty space, then the footer line, `--s5` (20px), the footer text, then `--s8` (48px) below it. The footer always feels like the bottom of the screen: the page is a flex column at least as tall as the viewport, the content area grows (`.content{flex:1}`) and the footer is pushed to the bottom (`margin-top:auto`). On a short page the gap above the footer line grows past 64; that is expected. On a long page the footer follows the content and the page scrolls with the platform scrollbar (thin, `--line` colored where the platform lets us style it). Nothing is fixed to the bottom, and the footer never floats mid-screen with empty space under it.

**Scrolling boxes.** A bottom sheet, side panel or modal body that can hold more than fits scrolls inside itself (`.scroll`), never the page behind it. Its content starts `--gutter` below the header row and ends with `--gutter-b` (32px, plus the phone safe area) of empty space. While more content is below the fold a 32px fade (`.scrollwrap.more`) shows at the bottom edge; it disappears at the end of the scroll, so the last line is always readable in full and never sits under the fade. The scrollbar is real and proportional (thin, `--line` colored where the platform lets us style it), never a painted stand-in. In the canvas mockups the sheets and the console pages really scroll, and the fade is driven by the scroll position.

**Stack rule.** A form is a vertical stack with `gap: var(--s4)` between field groups and `gap: var(--s7)` between sections. Do not add per-element margins on top of the gap.

**Component spacing, in one table.** Read it as "how far apart are two things", from closest to farthest. Things that belong together sit closer than things that do not (law of proximity), and the same relationship always gets the same distance.

| Between | Gap |
|---|---|
| An icon and its label inside a button | `--icon-gap` (6px): a touch more than a word space, so the icon reads as its own thing but part of the button |
| Buttons in a row, a switch and the next switch | `--s2` (8) |
| A label and its control, a control and its hint | `--s1` (4) |
| A field and the next field | `--s4` (16) |
| A section title and its first field | `--s4` (16) |
| One group of switches and the next group | `--s5` (20) |
| A section and the next section inside a card | `--s7` (32) |
| A card and the next card | `--s7` (32) |
| The last content and the footer | at least `--s9` (64) |

## 2. Sizes

| Token | Value | Use |
|---|---|---|
| `--control-h` | 36px | every input, select, button, and tab hit-target on desktop |
| `--control-h-sm` | 28px | secondary buttons inside tables and headers |
| `--touch` | 44px | minimum hit target on phone (buttons and rows in the tester view) |
| `--r-control` | 6px | inputs, buttons, checkboxes (the kit's card and button radius) |
| `--r-card` | 8px | cards, panels, modals (the kit's input and thumbnail radius) |
| `--r-sheet` | 12px | the bottom sheet on phones (the kit's modal radius) |
| `--r-pill` | 99px | status pills, count badges |
| `--icon-gap` | 6px | icon to label inside a button |
| `--form-w` | 640px | max width of any single-column form |
| `--page-w` | 1100px | max width of the console |
| `--panel-w` | 340px | tester side panel on desktop |

## 3. Type

**Plus Jakarta Sans** (free, chosen by eye against four other Gilroy stand-ins; the kit's main dashboard is set in Gilroy, which is paid), falling back to the system stack. One family, four sizes, two weights. Sizes are the kit's: 12, 14, 16, 20.

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
| `--bg` | #f7f7f8 | #131516 | page (kit: Background 2) |
| `--bg-2` | #eff0f1 | #1e2124 | hover fills, segmented track (kit: Background 1) |
| `--panel` | #ffffff | #191c1e | cards, header, sheets (kit: White) |
| `--ink` | #181a1b | #eceeef | text (kit: Black) |
| `--muted` | #697077 | #a0a6ac | secondary text, icons at rest (kit: Sub Black) |
| `--muted-2` | #838a91 | #868d93 | timestamps, tertiary text (kit: sub black 2) |
| `--placeholder` | #9ea3a9 | #6f767c | placeholder text in fields (kit: Placeholder) |
| `--disabled` | #b9bdc1 | #4d5358 | disabled text and icons (kit: Disable) |
| `--line` | #e9ebec | #2a2e31 | dividers, card borders (kit: Stroke) |
| `--line-strong` | #d4d6d9 | #383d41 | input and button borders (kit's field border) |
| `--accent` | #2d68a2 | #7fb0e0 | primary action, active tab, focus ring (kit: Primary) |
| `--accent-soft` | #eff5fb | #1a2a3a | selected nav item, selected row (kit's selected board) |
| `--ok` | #4db24d | #7bcf7b | completed, active (kit: Feedback/Green) |
| `--warn` | #eb763c | #f2a06e | expiring, caution (kit: Red Orange) |
| `--danger` | #e95050 | #f28585 | revoke, stuck, errors (kit: Feedback/Red) |
| `--shadow-card` | 0 1px 40px rgba(0,0,0,.05) | same at .35 | cards (kit: Card Shadow) |

The kit has no dark theme. The dark column keeps the kit's hue relationships (neutral greys with a faint blue lean, the same blue accent lightened for contrast).

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

- **Button**: height `--control-h`, padding `0 var(--s4)` (16px each side of the label), radius `--r-control`, 14px/500. Variants: primary (accent fill), default (panel fill, `--line-strong` border), danger (danger text). Small variant: `--control-h-sm`, padding `0 var(--s3)`, 12px; only inside tables and header rows. **With an icon:** the icon is 16px, sits before the label, and the gap between them is `--icon-gap` (6px): more than the space between two words, so the icon is its own thing, but inside the same padding, so it is still part of the button. Labels are Title Case when the button names a thing to make ("New Share", "Create share" stays as is because it is an action on the form). **Reveal variant** (`.btn.reveal`, the New Share button): at rest on a desktop it shows only the icon; on hover or keyboard focus the label slides out over 0.35s while the icon turns twice (720°) over 0.6s. On touch screens, on phones and with reduced motion the label is always visible and nothing turns, because there is no hover and a hidden label is a hidden button. On phones a standard button is `--touch` (44px) tall with the standard 14px label and 16px padding; a small button is never stretched to 44. Buttons in a row: `display:flex; gap: var(--s2)`.
- **Input / select / textarea**: height `--control-h` (textarea min 96px), padding `0 var(--s3)`, radius `--r-control`, `--line-strong` border, `--placeholder` placeholder text, accent focus ring (2px outline offset 1px). Always `width:100%`.
- **Field**: label (12/16, 500, muted) + control + optional hint (12/16 muted), stacked with `gap: var(--s1)`.
- **Card**: panel fill, line border, radius `--r-card`, padding `--gutter`, and the kit's soft `--shadow-card`.
- **Section** inside a card: title (16/24 600) then content; sections separated by `--s6`.
- **Table**: 13px, header 12px 500 muted, cell padding `var(--s2) var(--s3)`, row divider `--line`. Count columns are fixed width (72px) and right-aligned. Action columns are fixed width and never wrap.
- **List row** (shares list): grid `minmax(0,1fr) 72px 72px 96px`, gap `--s4`, row padding `var(--s3) var(--s2)`. The count cells are icon + number, right-aligned, tabular figures.
- **Pill**: 11px 600 uppercase, padding `2px var(--s2)`, radius `--r-pill`.
- **Tabs**: 36px tall, 14px, active = ink text + 2px accent underline.
- **Switch** (every on/off option): a 36×20 pill track with a 16px round thumb. Off = line fill, thumb left; on = accent fill, thumb right. To the right, a **title** (13/20, 500) and under it **one line of what it does** (12/16 muted): the pattern every settings screen people already know uses, a name and a sentence. Options stack with `--s3` gaps. Checkboxes are not used anywhere in the console.
- **Settings organisation** (Hick's law, Miller's law): at most **three** switches are in view, the ones that change what a tester experiences (show tasks, voice, screen). Everything else lives under a **More settings** disclosure (a native `<details>`, so the form keeps its state), grouped under small uppercase headings by what the setting is about: Recording, Consent and privacy, Access. Groups are `--s5` apart. Nothing is duplicated between the visible three and the groups.
- **Segmented toggle** (Unmoderated / Moderated, intro type): a pill. Outer track 28px tall, `--r-pill` radius, 2px padding, `--bg` fill, line border. Options are 24px pills, 13px/500; the selected one has `--panel` fill and a 1px shadow. It hugs its content (`align-self: flex-start`), never stretches.
- **Navigation bar**: 48px tall (the kit's top bar), panel fill, line border below. Brand (lock + name) on the left, then text links 32px tall as pills (`--r-pill`); the current page gets `--accent-soft` fill and ink text, the kit's selected-item tint. On the right: status text, then the **account chip** (24px initials circle in accent, the signed-in email, 13px muted, same 32px pill shape; ink text and `--accent-soft` fill when the Account page is open). Sign out lives on the Account page, not in the bar. The tester view keeps its own 44px header because the prototype needs the space.
- **Footer**: line border above, `--s5` padding top, `--s8` (48px) padding bottom, which is the gap at the bottom of every page, pushed to the bottom of the screen by the bottom rule. Same on every page of the console and in every desktop mockup. 12px muted text. Product name and version on the left, documentation links on the right.
- **Task card** (the form-builder pattern, as in Google Forms): one card per task or question, line border, `--r-card`, `--s4` padding, `--s3` between its rows. Top row: the title (16px, 40px tall) with the kind selector (Task / Question, 130px) on its right. Under it: a description textarea (13px, min 56px), optional. Foot row: the word "Show it", the when selector (160px), its value (110px), a spacer, and a remove icon at the far right. Cards are `--s4` apart. On phones every row stacks to one column.
- **Recording indicator**: 28px pill, `--danger-bg` fill, danger text 12px/600, pulsing 8px dot, Stop button inside. Shown in the header for the whole time the microphone is on; never hidden while recording. On phones the label is hidden and the dot plus Stop remain. The toast that appears when recording starts is a courtesy; the pill is the permanent signal.
- **Media player**: 16:9 video with native controls plus a controls row below it: captions select (28px) and Full screen button. Audio uses the native player at full width.
- **Location label** (results, feedback): a small screen icon, the word "on", then the path in mono, muted, with a tooltip "Where they were in the prototype". Never a bare symbol.
- **Level meter**: five 3px bars inside the Recording pill, 3 to 14px tall, driven by the microphone. Removed with the pill.
- **Modal** (tester): three parts, never one long box. Title row: on desktop 18/24 600 with `--gutter` padding; on phones it is the **sheet header row** (16/24 600, `--s3 --gutter` padding, line below), the same row the Tasks and Feedback sheets use, so every sheet on the phone starts the same way. A body that scrolls (`.scrollwrap > .mbody.scroll`, `--gutter` sides, `--s4` between blocks, section titles 14/20 600). An action row pinned at the bottom (line border above, `--gutter` padding plus safe area, buttons right-aligned with `gap: var(--s2)`, 44px tall). Max width 560 and max height the viewport minus a gutter on desktop; on phones it is a bottom sheet (top corners `--r-sheet`, at most 88% of the viewport). The tester never has to see everything at once: they read, scroll, and the buttons stay put.
- **Bottom sheet** (phone): 55% height (88% for Before you start), radius `--r-sheet` top corners, header row `--s3 --gutter` with a line below, body starts `--gutter` below the header, `--gutter` sides, ends with `--gutter-b` (scrolling box rules above).
- **Confirm dialog** (console): for anything that cannot be undone (disconnect a tool, revoke, delete). Title (18/24 600), one muted paragraph that says what happens and what does not, then Cancel and the action button (danger for destructive) right-aligned. Max width 480. Never a browser `confirm()`.
- **Account page**: four cards. *You* (who, how signed in, this browser, limits if any, sign-out actions). *Connected tools* (table: tool, connected, last used, owner, Disconnect; a row to name and connect a new tool; a token box shown once after connecting with copy buttons for the token, the CLI setup and the Claude Code setup). *Leave Vantage* (one danger button that deletes everything the person made and signs them out, through the confirm dialog, then a gate-style "You have left" screen). *Recent account activity* (timeline). Wording: a *tool* is something the person connected and named themselves (Claude Code, Cursor, a script), so "Disconnect" acts on one tool; "Leave" acts on the whole account.
- **Purpose toggle** (New share, Settings): a segmented toggle with three options, View only / Unmoderated / Moderated, above the Test setup section. View only hides Test setup entirely.
- **Toast** (every notification in the product): one at a time, bottom center, inset `--gutter` from the bottom (plus safe area) and never wider than the viewport minus two gutters or 480px. Ink fill, 13/20 text that wraps (never `nowrap`, never clipped), `--r-card` radius, a dismiss `×` on the right. It announces itself to screen readers (`role=status`, `aria-live=polite`). It always disappears on its own: 3s minimum, then about 50ms per character up to 8s; hovering pauses the timer, tapping `×` closes it. Toasts confirm or inform; they never ask a question and never hold the only route to an action (the Stop control for recording lives in the header pill, the toast only points to it). Copy is one or two short sentences.
- **Stat cell**: number 20/28 600 above label 12/16 muted; cells in a row with `gap: var(--s6)`.

## 7. Tester view specifics

- Header 44px, padding `0 var(--s3)`, gap `--s3`.
- Everything a tester taps is at least `--touch` tall on phones.
- Watermark: viewer email + date, rotated -24°, 9% opacity, tiled, never interactive.
- The "Before you start" screen is the tester's onboarding, and the only one: personal link, passcode if set, then this one modal, then the prototype. Its body is, in order: the designer's intro (text, audio or video), then a "What gets recorded" section with the voice switch and the consent buttons. Media sits above the consent text, never replaces it, because consent is the legal part. The modal follows the scrolling rules above, so a long intro is read by scrolling while the buttons stay in view. After it closes, the product explains itself in two toasts at most (recording on, tasks waiting) and the Tasks badge; there is no tour.

## 8. Laws we follow, and where

Twenty rules of thumb, each tied to something concrete in Vantage so it can be checked, not just admired.

| Law | What it says | Where it shows up here |
|---|---|---|
| Hick's | More choices, slower choice | Three switches in view, the rest under More settings |
| Fitts's | Big, close targets are faster | 36px controls on desktop, 44px on phones, primary action at the end of the form |
| Jakob's | People expect what other sites do | Task cards look like Google Forms; settings look like every settings screen |
| Proximity | Close things read as related | The spacing table: 4 / 8 / 16 / 32 by relationship |
| Similarity | Same-looking things read as the same kind | One button shape, one switch shape, one card shape |
| Uniform connectedness | Things inside a boundary belong together | A task's title, description and rule share one card |
| Prägnanz | The eye prefers the simplest shape | Cards, rows and columns; no decoration that is not information |
| Miller's | About seven things at once | Settings grouped into three named groups |
| Doherty threshold | Answer within 400ms | Add viewer wakes up as you type; copy and save confirm with a toast at once |
| Von Restorff | The one different thing is remembered | One primary button per page; danger is red and nothing else is |
| Serial position | First and last are remembered | Purpose first, Create last; Name first on the viewers table |
| Peak-end | The end colours the memory | The Thank-you page for testers; the link shown once, clearly, for designers |
| Zeigarnik | Unfinished things nag | The Tasks badge counts what is left |
| Tesler's | Complexity has to live somewhere | The server holds it (origins, encryption, limits); the Server page just states it |
| Postel's | Accept generously, send strictly | People fields take "Name <email>" or a bare email; the server stores one clean form |
| Parkinson's | Work fills the time given | Expiry defaults to seven days, not forever |
| Occam's razor | Prefer the simpler design | Select all removed; open sign-up removed; one file per demo |
| Pareto | A few things carry most of the value | The three visible switches; the four tabs on a share |
| Minimise target distance | Put the next control near the last | Add viewer sits under the viewers table; Add task under the tasks |
| Goal-gradient | Effort rises near the finish | Tasks number themselves; the last step is one button |

## 8. Changelog

- **2026-09-10, pass 10.** Button icon gap made a token (6px) and written down. New Share in Title Case, with the reveal variant (icon at rest, label on hover, two turns). Add viewer is two fields, name and email, with the button asleep until both are filled. "Rotate" is now "New link". Tasks became cards with a title, an optional description (also shown to testers), and the when rule at the foot. Test setup shows three switches; the rest sit under More settings, grouped, each with a title and one line. Sections inside a card are 32 apart (were 24), and a section's title is 16 from its first field (was 12). Select all removed. A component-spacing table and a table of the laws we follow.

- **2026-09-07, pass 9.** Re-themed on the "Dashboard - Free UI Kit" Figma kit, decoded from its `.fig` file (see `design/kit/KIT.md`). Colours are the kit's named styles: blue Primary #2d68a2 as the accent, Black #181a1b ink, Sub Black muted, Stroke lines, Background 2 page, plus new tokens for placeholder, disabled, strong borders, the soft selected tint and the card shadow. Type is Plus Jakarta Sans (picked over Manrope on 2026-09-07 for its clearer letters at 12 and 14px). Radii 6 / 8 / 12. Nav bar 48 tall with 32px pill links. Cards carry the kit's shadow. Spacing, gutter, bottom and scrolling rules unchanged.

- **2026-09-05, pass 8.** Sign-in screen gains a *Sign in with Google* primary button when the server offers it, above company sign-in and the token form, each separated by the *or* divider. Links tab: a personal link is shown once, when issued; rows for earlier links read "Issued earlier. Rotate for a new link." Account page drops the admin list and shows the person's limits. Server page shows the content origin. No token changes.

- **2026-09-05, pass 5.** Bottom rule made structural: the page is a flex column, content grows, the footer is pushed to the bottom of the screen and the gap above it grows on short pages (it was drifting between pages). Desktop mockups are 1280×900 screens that scroll with a real scrollbar instead of one long frame. Button padding 16 (was 12); small 12 (was 8); phone task buttons are standard 44-tall buttons, not stretched small ones. Sheet header row standardized across Before you start, Tasks and Feedback (16/24, 12/16 padding, line below); sheet body starts 16 below it and ends with 32; the fade disappears at the end of the scroll and mockup sheets really scroll. Account chip in the nav, Account page, confirm dialog, purpose toggle with View only. Sign-in screen: company sign-in first, admin token as fallback, no sign-up.

- **2026-09-04, pass 4.** Gutter split by device: 20 desktop, 16 phone, one token. Bottom gutter (32) inside every scrolling sheet and panel, with a fade while more is below. Toast rules: wraps, obeys the gutter, dismiss control, auto-dismiss by length, one at a time. "Before you start" is title, scrolling body, pinned action row; phone version is a bottom sheet. Footer bottom gap standardized at 48 everywhere (the spec said 32 in one place).

- **2026-09-05, pass 3.** Switches replace checkboxes, with Select all above groups of more than two. No-orphan-words rule. Bottom rule: minimum 64px before the footer, 48px after it, and canvas frames sized with slack so nothing clips. Location label replaces the "@" symbol. Think-aloud recording is always offered (tester decides); typed-text recording is an explicit option, off by default.

- **2026-09-05, pass 2.** Segmented toggle shrunk to a 28px pill (was 36px square). Added navigation bar and footer with bottom gap; pages scroll, nothing is clipped. Added task editor row, recording indicator, media player controls, dictation button. Expiry can be any length up to the server maximum (365 days default), set by days or by date.
- **2026-09-04, pass 1.** First system: spacing scale, 20px gutter, 36px controls, grid rule for side-by-side fields, icon + count cells with tooltips, tabular numbers.

## 9. Applying it in the canvas

The canvas artboards are generated from these same tokens (`design/screens/` via the generator), so a change to a token in `vantage.css` and in the generator keeps code and mockups identical. When you restyle something on the canvas, tell Claude which token you changed and it will update both.
