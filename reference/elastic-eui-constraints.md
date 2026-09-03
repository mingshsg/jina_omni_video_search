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
  - https://nextjs.org/docs/app/guides/upgrading/version-15
  - https://nextjs.org/docs/app/guides/upgrading/version-16
verified: 2026-08-25
---

# EUI adoption constraints

Verified directly against the EUI repository, the npm registry, Next.js upgrade
guides, and the EUI issue tracker. These are the facts; the resulting decision
lives in `plan/00-implementation-plan.md`.

## Versions observed

- Latest published `@elastic/eui`: **119.1.0** (released 2026-08-24).
- Latest stable `next@14`: **14.2.35**, peers `react: ^18.2.0` only.
- `next@15.0.0` peers list `^18.2.0 || 19.0.0-rc-…`, but the **upgrade guide**
  states React 19 is the minimum.
- Latest `next@16` peers still list `^18.2.0 || ^19.0.0`, but the App Router
  upgrade guide states it uses React 19.2 Canary.

**Lesson (Round 4):** peer installability ≠ official App Router support.

## Constraint 1: EUI does not declare React 19 support

`packages/eui/package.json` at 119.1.0:

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

- Issue [#8720 `[Epic] React 19 support`](https://github.com/elastic/eui/issues/8720)
  closed without widening the peer range.
- Issue #9587 (React 19 console error) remains open.

## Constraint 2: Next.js App Router React matrix

| Next.js | Official upgrade-guide React stance | Peer `react` (npm) |
| --- | --- | --- |
| **14.2.35** | React 18 | `^18.2.0` only |
| **15** | "The minimum versions of `react` and `react-dom` is now **19**." | lists 18 \|\| 19 |
| **16** | App Router uses React **Canary** with **19.2** features | lists 18 \|\| 19 |

**Consequence:** the only combination where **both** Next and EUI sit inside
their declared support ranges is **Next.js 14.2.35 + React 18.3.x + EUI
119.1.0**. Next 16 + React 18 was rejected after Round 4.

## Constraint 3: EUI has no SSR support; Next.js is "a challenge"

`elastic/next-eui-starter` is **archived**. README:

> The lack of SSR support also currently makes Next.js a challenge with EUI.

Issue [#7630](https://github.com/elastic/eui/issues/7630) still open.

**Consequence:** render EUI client-side only. Acceptable for this internal demo.

## Constraint 4: yarn as project pin (not a hard consumer mandate)

EUI consuming docs say use `yarn` (`npm` is not supported) for installing into
an existing project. The EUI monorepo itself uses yarn. Round 4 notes that this
does not prove application consumers **must** use yarn when dependencies are
present.

**Consequence for this repo:** pin **yarn** for reproducibility. Label it a
project choice, not a universal framework law.

```bash
yarn add @elastic/eui @elastic/eui-theme-borealis @elastic/datemath @emotion/react @emotion/css moment
```

## Constraint 5: EUI owns the styling layer

Emotion 11.x + Borealis tokens conflict with Tailwind preflight. **No Tailwind.**

## Net decision

**Next.js 14.2.35 + React 18.3.1 + EUI 119.1.0**, yarn, client-side EUI only, no
Tailwind. Phase 1 begins with an exact-version compatibility spike recorded in
`docs/operations.md`. Fallback: `dynamic(..., { ssr: false })` for EUI-heavy
pages.
