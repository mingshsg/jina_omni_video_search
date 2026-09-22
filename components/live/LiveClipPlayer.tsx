'use client';

import { useEffect, useRef, useState } from 'react';
import { EuiCallOut, EuiSpacer, EuiText } from '@elastic/eui';
import { useLocale } from '@/lib/i18n/locale-context';

export function LiveClipPlayer({
  clipUrl,
  label,
}: {
  clipUrl: string | null;
  label?: string;
}) {
  const { t } = useLocale();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    setExpired(false);
    const el = videoRef.current;
    if (!el || !clipUrl) return;
    el.src = clipUrl;
    el.load();
    void el.play().catch(() => undefined);
  }, [clipUrl]);

  if (!clipUrl) {
    return (
      <EuiText size="s" color="subdued">
        <p>{t.searchEmptyHint}</p>
      </EuiText>
    );
  }

  return (
    <div>
      {expired && (
        <>
          <EuiCallOut
            title={t.liveMediaExpired}
            color="warning"
            size="s"
            aria-live="polite"
          />
          <EuiSpacer size="s" />
        </>
      )}
      <video
        ref={videoRef}
        controls
        style={{ width: '100%', maxHeight: 360, background: '#111' }}
        preload="metadata"
        aria-label={t.liveClipPlayer}
        onError={() => setExpired(true)}
      />
      {label && (
        <>
          <EuiSpacer size="s" />
          <EuiText size="s">
            <p>{label}</p>
          </EuiText>
        </>
      )}
    </div>
  );
}
