# UI mockup — layout intent

Documents the **built** Phase 9 interface (not a speculative wireframe).
Implementation: `components/AppShell.tsx`, `app/page.tsx`, `app/ingest/page.tsx`,
`app/library/page.tsx`, `app/live/page.tsx`, `app/live/[sessionId]/page.tsx`.
Design system: **EUI 119 + Borealis**, client-only
(`'use client'` + Emotion cache via `app/providers.tsx`). Chinese default locale;
header ZH/EN switch (NFR-3). **No Tailwind.**

---

## Global chrome

```
┌──────────────────────────────────────────────────────────────┐
│ [▶ App title]  Search │ Image │ Import │ Library │ Live  [中文|EN] │  ← EuiHeader fixed
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

Nearby hits from the **same video** whose start times span at most
`2 × chunk_window_ms` are **grouped into one result card**. Top-k counts
**groups** (default **5**), not raw windows; the client oversamples the search
API then truncates to N groups. Group cards show the fused time range and, when
collapsed, small time chips for each member window.

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

Primary job: inventory assets/variants; re-run ingest; remove from ES
(single or batch).

```
┌─ Toolbar ───────────────────────────────────────────────────┐
│  [Remove selected] [Remove all]   N selected                │
├─ Table (checkbox selection) ────────────────────────────────┤
│  ☐ Title │ Duration │ Status │ Variants │ Actions           │
│  …       │ 02:37    │ ready  │ standard×3, fine×20          │
│                              │ [Re-index] [Remove]          │
└─────────────────────────────────────────────────────────────┘
```

- Row checkboxes enable **Remove selected**; **Remove all** clears the listed
  inventory. Both confirm via `EuiConfirmModal`.
- Remove (single or batch) deletes ES docs only (disk files kept, NFR-5).
- Re-index calls job retry for the asset’s current job / variant config.
- Link affordance back to Search when useful.

---

## Live (`/live`, `/live/[sessionId]`)

Primary job: register RTSP source by `connection_ref` → start session → follow
search → play retained clip (optional gateway live view).

```
┌─ Register source ───────────────────────────────────────────┐
│  name · connection_ref (LIVE_SOURCE_*_URL) · rtsp/tcp       │
│  [ Create source ]                                          │
├─ Sources list ──────────────────────────────────────────────┤
│  name · validation badge · observed badge · [Start][Open]   │
└─────────────────────────────────────────────────────────────┘

┌─ Session `/live/{sessionId}` ───────────────────────────────┐
│  observed · worker · lag · queue · spool · window counters  │
│  Callout when windows.searchable === 0 (not searchable yet) │
├─ Search (text|image) + Follow ──────┬─ Clip player ─────────┤
│  hits: thumb · scores · badge       │  timeline strip       │
│  follow badge / cache hit|miss      │  optional HLS gateway │
│                                     │  recent SSE event log │
└─────────────────────────────────────┴───────────────────────┘
```

| Element | Behavior |
| --- | --- |
| connection_ref | Worker-only secret name; UI validates `LIVE_SOURCE_*_(URL\|CONNECTION)` |
| Observed badges | `created` / `connecting` / `live` / `degraded` / `stopping` / `stopped` / `failed` |
| Searchable claim | UI never claims searchable until health counter or `searchable` event |
| Follow | Opens SSE on `query_id`; replaces top-K on `results`; `410` → expired badge |
| Clip player | `clip_url` from hit; 410 → media-expired callout |
| Gateway | Optional `LIVE_PLAYBACK_HLS_URL_TEMPLATE` / WebRTC template |

Implementation: `app/live/page.tsx`, `app/live/[sessionId]/page.tsx`,
`components/live/*`, helpers in `lib/live/ui-state.ts`.

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
