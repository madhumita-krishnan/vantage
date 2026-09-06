# The problem

> Source: a post from a product designer, saved 2026-09-04.

To all product designers using Claude for prototyping - has anyone figured out how to share prototypes outside of an Enterprise Claude account while keeping it private (confidential) yet shareable with specific users?

I've hit a wall, and even Claude itself can't seem to solve this:

- Sharing HTML isn't an option (no control over what happens next).
- Sharing my screen (local env) doesn't work well for user testing.
- Vercel isn't an option either.
- Chat artifacts only allow internal sharing.
- I tried Figma plugins, but the best one I found only imports HTML page by page, without interactions.

## What this asks for

An enterprise designer needs all of the following at once:

| Need                                                 | Why the usual options fail                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| The prototype stays inside the company boundary      | Vercel, Netlify, public hosting and third-party SaaS are blocked by policy     |
| Only named people can open it                        | A raw HTML file or a public link cannot be restricted or revoked               |
| It is a real, interactive coded prototype            | Figma imports flatten it into static pages                                     |
| Testers can use it on their own device, unsupervised | Screen-sharing a local server breaks usability testing                         |
| The designer keeps control after sharing             | Links must expire, be revocable, and leave an audit trail                      |
| Security teams can approve it                        | They need to review what it does, where data lives, and what it phones home to |

The answer in this folder is **Vantage**: a small server that a designer or their IT team runs inside the company network, plus tools that let Claude publish to it directly. See [README.md](README.md).
