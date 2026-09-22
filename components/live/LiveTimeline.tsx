'use client';

import type { LiveSearchHitUi } from './LiveHitCard';

/** Session-relative timeline of live hits (by window start order). */
export function LiveTimeline({
  hits,
  activeId,
  onSelect,
}: {
  hits: LiveSearchHitUi[];
  activeId: string | null;
  onSelect: (hit: LiveSearchHitUi) => void;
}) {
  if (hits.length === 0) return null;
  const starts = hits.map((h) => Date.parse(h.window_start_at));
  const ends = hits.map((h) => Date.parse(h.window_end_at));
  const min = Math.min(...starts.filter(Number.isFinite));
  const max = Math.max(...ends.filter(Number.isFinite));
  const span = Math.max(max - min, 1);

  return (
    <div
      role="list"
      aria-label="Live match timeline"
      style={{
        position: 'relative',
        height: 28,
        background: '#e8e8e8',
        borderRadius: 4,
        overflow: 'hidden',
      }}
    >
      {hits.map((h) => {
        const a = Date.parse(h.window_start_at);
        const b = Date.parse(h.window_end_at);
        if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
        const left = ((a - min) / span) * 100;
        const width = Math.max(((b - a) / span) * 100, 0.8);
        const active = h.chunk_id === activeId;
        return (
          <button
            key={h.chunk_id}
            type="button"
            role="listitem"
            title={`${h.window_start_at}–${h.window_end_at}`}
            aria-label={`Sequence ${h.sequence_no}`}
            onClick={() => onSelect(h)}
            style={{
              position: 'absolute',
              left: `${left}%`,
              width: `${width}%`,
              top: 4,
              height: 20,
              border: 'none',
              borderRadius: 3,
              cursor: 'pointer',
              background: active ? '#0077CC' : '#54B399',
              opacity: active ? 1 : 0.75,
            }}
          />
        );
      })}
    </div>
  );
}
