# What Prototype Vault cannot do

Written for designers, not engineers. Every tool that shares work with other people has limits, and the honest ones say what they are. Here are Prototype Vault's, and what to do about each.

## Nobody can stop a screenshot

If a person can see your prototype on their screen, they can photograph it, screenshot it, or record it. No website can prevent that. What the vault does instead:

- **Their name is on every screen.** The prototype is shown with the viewer's email printed faintly across it. If a picture of your work turns up somewhere, you know whose link it came from. Think of it as a signature on a loan copy, not a lock.
- **Only the framed page shows the prototype.** Pasting the prototype's address into a new tab, to get a clean copy without the name on it, is refused by the server in current browsers. Safari older than 16.4 does not send the signal the server relies on, so it cannot refuse there.
- **The desktop app goes further.** On a Mac or Windows PC, the optional viewer app opens the prototype in a window the operating system excludes from screenshots and screen sharing. Captures come out black. It does nothing against a phone pointed at the screen.

What to do: keep viewer lists short, set expiry tight, and say in your intro text that the work is confidential.

## A link works for whoever holds it

A personal link opens the prototype for anyone who has it, until it expires or you revoke it. It is tied to a person's name so you know who it was sent to, and it can be turned off in one click, but it does not check identity by itself.

What to do: send each link to one person. For anything sensitive, add a passcode and send that by a different route (a call, a message), so a forwarded email is not enough. The access log shows every opening, with time and location, so a forwarded link is noticed.

## Testers can read the prototype's code

Your prototype is HTML and JavaScript running in the tester's browser. Anyone who knows how can open the browser's developer tools and read it. The vault stops the prototype from calling out to the internet and keeps it off search engines, but it cannot hide code from the person running it.

What to do: keep secrets out of prototypes. No real API keys, no real customer data. Use invented names and numbers.

## Two prototypes in one browser can see each other (hosted copies only, for now)

On a hosted copy where many designers share one address, every prototype is served from the same second address. A prototype written to misbehave could, in a browser that has two of them open at once, read the other one. This needs a designer who is deliberately hostile and a tester who has both open in the same afternoon. The fix is a separate address per prototype, which needs a wildcard domain; it is on the roadmap and marked in the audit. On a copy you run for your own team, this does not apply.

## Whoever runs the server can see everything

Files are encrypted on disk, but the server holds the key so it can show the prototype to testers. The person who operates the server can read what is on it. That is true of every service that shows you your own content.

What to do: if the work is confidential to your company, run the vault inside your company. That is what the self-hosted path is for.

## The one-command start is for a laptop

When you start the vault with no settings, it makes its own secret key and keeps it next to the data. That is fine for trying things on your own machine and not fine for a server other people use. The deployment guide shows how to keep the key somewhere else.

## Recording is limited on purpose

For a usability test the vault can record where testers click, which screens they visit, and, if you turn each on, what they type, what they say and a video of the prototype tab. A share that is "view only" records nothing but the fact that it was opened. Testers see a note before anything is recorded and can say no to each part.

Screen recording works in desktop browsers only, records the one tab the tester picks, and takes about 5 MB a minute, so a long session is a big file. It stops on its own when the share's media limit is reached. Nothing the vault records goes anywhere but the vault.

## Data is kept, then deleted

A share expires on the date you set. Thirty days after that (or whatever the retention setting says), the whole share is deleted: files, viewer list, recordings, feedback and its access log. Until then it stays. If you need it gone sooner, delete it yourself.

## No outside firm has reviewed it

The code is small, tested, and has been read line by line by its author with a code-level audit published in the repository. It has not been reviewed by an independent security company. If your organisation requires that, have your own security people read it; the security document was written for them.

## Things that are simply not there

- No comments on the prototype, no version history, no Figma import.
- No editing: the vault shows what you upload.
- Prototypes that call a live server will not work, because the vault blocks calls to the internet. Put sample data inside the prototype instead.
- Prototypes from a framework (React, Vite, Next) must be built into plain files first.
