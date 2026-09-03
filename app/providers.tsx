'use client';

import { useState } from 'react';
import { useServerInsertedHTML } from 'next/navigation';
import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import { EuiProvider } from '@elastic/eui';
import { EuiThemeBorealis } from '@elastic/eui-theme-borealis';
import { LocaleProvider } from '@/lib/i18n/locale-context';

type ProvidersProps = {
  children: React.ReactNode;
};

type EmotionCacheWithFlush = ReturnType<typeof createCache> & {
  __flush?: () => string[];
};

/**
 * Client-only EUI shell: Emotion cache + Borealis + useServerInsertedHTML
 * so styles can be injected during the App Router SSR pass (reduces FOUC).
 * EUI itself has no official SSR support; residual FOUC is an accepted risk.
 */
export function Providers({ children }: ProvidersProps) {
  const [cache] = useState(() => {
    const emotionCache = createCache({ key: 'eui', prepend: true }) as EmotionCacheWithFlush;
    emotionCache.compat = true;

    const prevInsert = emotionCache.insert.bind(emotionCache);
    let inserted: string[] = [];

    emotionCache.insert = (
      ...args: Parameters<typeof prevInsert>
    ): ReturnType<typeof prevInsert> => {
      const serialized = args[1];
      if (emotionCache.inserted[serialized.name] === undefined) {
        inserted.push(serialized.name);
      }
      return prevInsert(...args);
    };

    emotionCache.__flush = () => {
      const names = inserted;
      inserted = [];
      return names;
    };

    return emotionCache;
  });

  useServerInsertedHTML(() => {
    const names = cache.__flush?.() ?? [];
    if (names.length === 0) {
      return null;
    }
    let styles = '';
    for (const name of names) {
      const value = cache.inserted[name];
      if (typeof value === 'string') {
        styles += value;
      }
    }
    return (
      <style
        data-emotion={`${cache.key} ${names.join(' ')}`}
        dangerouslySetInnerHTML={{ __html: styles }}
      />
    );
  });

  return (
    <CacheProvider value={cache}>
      <EuiProvider colorMode="light" theme={EuiThemeBorealis}>
        <LocaleProvider>{children}</LocaleProvider>
      </EuiProvider>
    </CacheProvider>
  );
}
