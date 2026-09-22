'use client';

import { EuiButtonEmpty, EuiCallOut, EuiSpacer, EuiText } from '@elastic/eui';
import { useLocale } from '@/lib/i18n/locale-context';

export function LiveGatewayPlayer({
  hlsUrl,
  webrtcUrl,
}: {
  hlsUrl: string | null;
  webrtcUrl: string | null;
}) {
  const { t } = useLocale();
  const url = hlsUrl || webrtcUrl;

  if (!url) {
    return (
      <EuiCallOut
        title={t.liveGatewayUnavailable}
        color="primary"
        size="s"
      />
    );
  }

  return (
    <div>
      {hlsUrl ? (
        <video
          controls
          src={hlsUrl}
          style={{ width: '100%', maxHeight: 280, background: '#111' }}
          aria-label={t.liveGatewayPlayer}
        />
      ) : (
        <EuiText size="s" color="subdued">
          <p>{t.liveGatewayOpen}</p>
        </EuiText>
      )}
      <EuiSpacer size="s" />
      <EuiButtonEmpty
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        iconType="popout"
        aria-label={t.liveGatewayOpen}
      >
        {t.liveGatewayOpen}
      </EuiButtonEmpty>
    </div>
  );
}
