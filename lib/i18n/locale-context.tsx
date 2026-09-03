'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Locale } from './en';
import { getUiMessages, type UiMessages } from './ui';

const STORAGE_KEY = 'jina-omni-locale';
/** Client default matches server DEFAULT_LOCALE=en (NFR-3). */
export const CLIENT_DEFAULT_LOCALE: Locale = 'en';

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: UiMessages;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  // Always start with Chinese to match SSR / first paint (avoid hydration mismatch).
  const [locale, setLocaleState] = useState<Locale>(CLIENT_DEFAULT_LOCALE);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === 'zh' || stored === 'en') {
        setLocaleState(stored);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    if (typeof document !== 'undefined') {
      document.documentElement.lang = next === 'zh' ? 'zh' : 'en';
    }
  }, []);

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      t: getUiMessages(locale),
    }),
    [locale, setLocale],
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error('useLocale must be used within LocaleProvider');
  }
  return ctx;
}
