# UI mockup — layout intent

Documents the **built** Phase 9 interface (not a speculative wireframe).
Implementation: `components/AppShell.tsx`, `app/page.tsx`, `app/ingest/page.tsx`,
`app/library/page.tsx`. Design system: **EUI 119 + Borealis**, client-only
(`'use client'` + Emotion cache via `app/providers.tsx`). Chinese default locale;
header ZH/EN switch (NFR-3). **No Tailwind.**

---

## Global chrome

```
┌──────────────────────────────────────────────────────────────┐
│ [▶ App title]     Search │ Import │ Library      [中文|EN]   │  ← EuiHeader fixed
├──────────────────────────────────────────────────────────────┤
│  Page title                                                  │
│  Optional short description                                  │
│                                                              │
│  … page body (restrictWidth ≈ 1200px) …                      │
└──────────────────────────────────────────────────────────────┘
```

- Product name is the header brand link to `/`.
- Active nav uses `EuiHeaderLink.isActive` from pathname.
- Pages wrap content in `EuiPageTemplate` via `AppShell`.

**Residual UX:** first paint may briefly lack Emotion styles (FOUC) because EUI
is client-only. Accepted risk; fallback would be `dynamic(..., { ssr: false })`.
See [operations.md](./operations.md) Phase 1 notes.

---

## Search (`/`)

Primary job: type a query → ranked windows → click → seek playback.

```
┌─ Query row ─────────────────────────────────────────────────┐
│  [ search field …………………………………… ]  [ Search ]             │
├─ Filters ───────────────────────────────────────────────────┤
│  Modality [visual|audio|both]  Variant ▾  Video ▾  Top-k □  Sort ▾ │
├─ Results (left ~3) ────────────┬─ Player (right ~2) ────────┤
│  ┌ thumb ┐ title               │  <video controls>          │
│  │       │ start–end  badge    │                            │
│  └───────┘ score               │  Timeline strip            │
│  … more hit cards …            │  [====|====|====] windows  │
└────────────────────────────────┴────────────────────────────┘
```

| Element | Behavior |
| --- | --- |
| Variant select | Required; options from ready variants via `GET /api/library` |
| Video filter | Optional single-video scope |
| Hit card | Thumbnail + title + time labels + `modality_badge` + RRF / visual / audio scores; click seeks |
| Sort | `sort_by`: RRF (fused) / Visual / Audio knn similarity |
| Player | `src=/api/media/{videoId}`; seek to `start_ms` |
| Timeline | Chunks for active video+variant; click seeks that window |

Empty states: no variants yet → hint to Import; no hits → empty prompt.

---

## Import (`/ingest`)

Primary job: choose source mode, optionally review workload, watch SSE progress.

```
┌─ Mode ──────────────────────────────────────────────────────┐
│  ( ) URL   ( ) Local path   ( ) Upload                      │
├─ Form ──────────────────────────────────────────────────────┤
│  Source / file picker                                       │
│  Title (optional)                                           │
│  [✓] Auto-start after estimate                              │
│  [ Start import ]                                           │
├─ Progress (after submit) ───────────────────────────────────┤
│  Status / stage / %                                         │
│  Windows done / failed                                      │
│  Workload: N windows, M inference calls                     │
│  [ Confirm ] when awaiting_confirm                          │
│  Throughput on complete                                     │
└─────────────────────────────────────────────────────────────┘
```

- Client validation before POST; API errors use bilingual safe messages.
- Progress via `EventSource` → `/api/jobs/{id}/stream`.
- Local mode needs `LOCAL_IMPORT_ROOT` on the server; otherwise API returns
  `INGEST_LOCAL_NOT_CONFIGURED`.
- On `status=ready`: show a brief success callout (~2–3 s), then **auto-clear**
  progress + form fields so the next URL/upload/local file can be submitted
  immediately. A dismissible “last import succeeded” banner keeps the title
  without blocking the next job. ES docs and media files are **not** deleted.
- On `status=failed`: progress stays until the user dismisses; form unlocks for
  a new import after dismiss.

---

## Library (`/library`)

Primary job: inventory assets/variants; re-run ingest; remove from ES.

```
┌─ Table ─────────────────────────────────────────────────────┐
│  Title │ Duration │ Status │ Variants │ Actions             │
│  …     │ 02:37    │ ready  │ standard×3, fine×20            │
│                            │ [Re-index] [Remove]            │
└─────────────────────────────────────────────────────────────┘
```

- Remove confirms via `EuiConfirmModal`; deletes ES docs only (disk files kept).
- Re-index calls job retry for the asset’s current job / variant config.
- Link affordance back to Search when useful.

---

## Interaction cards vs chrome

Result rows and library rows use bordered `EuiPanel` / `EuiBasicTable` as
**interaction containers** (click-to-seek, row actions). The header and filter
rows are not card grids. This matches the demo’s EUI patterns rather than a
marketing landing layout.

---

## Accessibility / i18n notes

- Locale strings in `lib/i18n/zh.ts` and `lib/i18n/en.ts`.
- Form controls use EUI labels / legends; modality and language use
  `EuiButtonGroup`.
- Media errors surface as `EuiCallOut`, not silent failures.
