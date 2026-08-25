---
title: "EUI adoption constraints (React 19, SSR/Next.js, yarn)"
sources:
  - https://github.com/elastic/eui
  - https://raw.githubusercontent.com/elastic/eui/main/wiki/consuming-eui/README.md
  - https://raw.githubusercontent.com/elastic/eui/main/packages/eui/package.json
  - https://registry.npmjs.org/@elastic/eui
  - https://github.com/elastic/eui/issues/7630
  - https://github.com/elastic/eui/issues/8720
  - https://github.com/elastic/next-eui-starter
verified: 2026-08-25
---

# EUI adoption constraints

Verified directly against the EUI repository, the npm registry, and the EUI
issue tracker on 2026-08-25, because the UI decision for this project depends
on them. These are the facts, not opinions; the resulting decision lives in
`plan/00-implementation-plan.md`.

## Versions observed

- Latest published `@elastic/eui`: **119.1.0** (released 2026-08-24). The `main`
  branch carries the same version.
- Published dist-tags include theme-pinned lines: `borealis`, `classic`,
  `amsterdam`, alongside `latest`.
- Latest `next`: **16.3.2**. Both Next.js 15 and 16 declare
  `peerDependencies.react` as `^18.2.0 || ^19.0.0`, so Next.js does **not**
  force React 19.

## Constraint 1: EUI does not declare React 19 support

`packages/eui/package.json` on `main` at 119.1.0:

```json
"peerDependencies": {
  "react": "^17.0 || ^18.0",
  "react-dom": "^17.0 || ^18.0",
  "@types/react": "^17.0 || ^18.0",
  "@types/react-dom": "^17.0 || ^18.0",
  "@emotion/react": "11.x",
  "@emotion/css": "11.x",
  "@elastic/eui-theme-borealis": "8.0.0",
  "@elastic/datemath": "^5.0.2",
  "moment": "^2.13.0",
  "typescript": "~4.5.3 || ^5"
}
```

React 19 is absent. Supporting evidence on intent:

- Issue [#8720 `[Epic] React 19 support`](https://github.com/elastic/eui/issues/8720)
  was **closed** on 2026-05-24, but the peer range was never widened, and the
  epic body still reads "This work isn't yet prioritized." Its definition of
  done included updating documentation to reflect added support, which did not
  happen. Treat the epic as deprioritised rather than delivered.
- Issue #9587 (`[React 19][EuiFieldSearch]` console error in React 19 dev mode)
  remains **open**.

**Consequence:** pin React 18. Next.js 16 accepts `^18.2.0`, so this costs
nothing in framework currency.

## Constraint 2: EUI has no SSR support, and Next.js is officially "a challenge"

`elastic/next-eui-starter` is **archived** (`archived: true`, last push
2024-08-08). Its README states:

> This starter is not constantly maintained and is out of sync with the latest
> EUI release. The lack of SSR support also currently makes Next.js a challenge
> with EUI. We plan to enhance our support for Next.js and re-evaluate this
> project at that time.

The linked tracking issue
[#7630 `[Meta] Expanded Platform support`](https://github.com/elastic/eui/issues/7630)
is still **open** (last updated 2026-02-03) and lists as unaddressed:

> **SSR support / Next.js** - This is a challenge for anyone prototyping in
> Next.js, which many folks in the company do. In fact, we even provide a
> Next.js starter project, which has fallen woefully behind on support and
> updates.

**Consequence:** do not rely on server-rendering EUI. Render EUI on the client
only. This is acceptable here because the application is an internal demo with
no SEO or first-paint SSR requirement, and it lets the Next.js server continue
to host the parts that genuinely need a server (ffmpeg, Elasticsearch, SSE,
Range streaming, uploads), none of which import EUI.

## Constraint 3: npm is not supported, yarn is required

From `wiki/consuming-eui/README.md`:

> To install the Elastic UI Framework into an existing project, use the `yarn`
> CLI (`npm` is not supported).

Full peer install line given by the same document:

```bash
yarn add @elastic/eui @elastic/eui-theme-borealis @elastic/datemath @emotion/react @emotion/css moment
```

EUI also expects an ES2015 polyfill to be present.

**Consequence:** the project uses yarn, and the README plus `.env.example`
instructions must say so. Any earlier note in this project's plan that assumed
`npm install` is superseded.

## Constraint 4: EUI owns the styling layer

EUI styles with Emotion (`@emotion/react`, `@emotion/css` at `11.x`) and ships
design tokens through `@elastic/eui-theme-borealis` 8.0.0. Layering Tailwind's
preflight on top of this competes with EUI's own resets.

**Consequence:** Tailwind is removed from the stack. Layout and theming come
from EUI components and Borealis tokens.

## Net decision recorded here for traceability

Next.js 16 App Router + React 18 + EUI 119.1.0, installed with yarn, EUI
rendered client-side only, no Tailwind. Fallback if the client-only Emotion
setup proves unstable: wrap EUI-heavy pages in
`dynamic(() => import(...), { ssr: false })`.
