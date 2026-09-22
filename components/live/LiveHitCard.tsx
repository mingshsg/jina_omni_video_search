'use client';

import type React from 'react';
import { EuiBadge, EuiFlexGroup, EuiFlexItem, EuiPanel, EuiSpacer, EuiText } from '@elastic/eui';
import type { UiMessages } from '@/lib/i18n/ui';

export type LiveSearchHitUi = {
  chunk_id: string;
  source_id: string;
  session_id: string;
  stream_epoch: number;
  sequence_no: number;
  variant_id: string;
  window_start_at: string;
  window_end_at: string;
  event_ingested: string;
  start_ms: number;
  end_ms: number;
  score: number;
  score_visual: number | null;
  score_audio: number | null;
  modality_badge: 'visual' | 'audio' | 'both';
  thumb_url: string;
  clip_url: string;
};

function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toFixed(3);
}

function badgeLabel(
  badge: LiveSearchHitUi['modality_badge'],
  t: UiMessages,
): string {
  switch (badge) {
    case 'visual':
      return t.modalityVisual;
    case 'audio':
      return t.modalityAudio;
    case 'both':
      return t.modalityBoth;
    default: {
      const _exhaustive: never = badge;
      return _exhaustive;
    }
  }
}

function badgeColor(
  badge: LiveSearchHitUi['modality_badge'],
): 'primary' | 'accent' | 'success' {
  switch (badge) {
    case 'visual':
      return 'primary';
    case 'audio':
      return 'accent';
    case 'both':
      return 'success';
    default: {
      const _exhaustive: never = badge;
      return _exhaustive;
    }
  }
}

export function LiveHitCard({
  hit,
  active,
  modality,
  t,
  onSelect,
}: {
  hit: LiveSearchHitUi;
  active: boolean;
  modality: 'visual' | 'audio' | 'both';
  t: UiMessages;
  onSelect: (hit: LiveSearchHitUi) => void;
}) {
  const rrf =
    modality === 'both' && hit.score !== 0 ? hit.score.toFixed(3) : '—';
  return (
    <EuiPanel
      hasBorder
      paddingSize="s"
      style={{
        cursor: 'pointer',
        outline: active ? '2px solid #0077CC' : undefined,
      }}
      onClick={() => onSelect(hit)}
      onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(hit);
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`${hit.chunk_id} ${hit.window_start_at}`}
    >
      <EuiFlexGroup gutterSize="m" alignItems="center">
        <EuiFlexItem grow={false}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={hit.thumb_url}
            alt=""
            width={120}
            height={68}
            style={{
              objectFit: 'cover',
              borderRadius: 4,
              background: '#eee',
            }}
          />
        </EuiFlexItem>
        <EuiFlexItem>
          <EuiText size="s">
            <strong>
              #{hit.sequence_no} · epoch {hit.stream_epoch}
            </strong>
          </EuiText>
          <EuiText size="s" color="subdued">
            {hit.window_start_at} – {hit.window_end_at}
          </EuiText>
          <EuiSpacer size="xs" />
          <EuiFlexGroup gutterSize="s" alignItems="center" wrap>
            <EuiFlexItem grow={false}>
              <EuiText size="xs">
                {t.scoreRrfLabel} {rrf}
              </EuiText>
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiText size="xs">
                {t.scoreVisualLabel} {formatScore(hit.score_visual)}
              </EuiText>
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiText size="xs">
                {t.scoreAudioLabel} {formatScore(hit.score_audio)}
              </EuiText>
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiBadge color={badgeColor(hit.modality_badge)}>
                {badgeLabel(hit.modality_badge, t)}
              </EuiBadge>
            </EuiFlexItem>
          </EuiFlexGroup>
        </EuiFlexItem>
      </EuiFlexGroup>
    </EuiPanel>
  );
}
