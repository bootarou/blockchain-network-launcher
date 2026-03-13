import React, { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';
import { ja } from './ja';
import { en } from './en';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Locale = 'ja' | 'en';

export type TranslationDict = Record<string, string>;

export interface I18nContextValue {
  /** Current locale */
  lang: Locale;
  /** Switch locale */
  setLang: (lang: Locale) => void;
  /**
   * Translate a key.
   *  - Supports `{param}` interpolation: `t('key', { param: 'value' })`
   *  - Returns fallback (2nd arg string) or key itself when not found.
   */
  t: (key: string, params?: Record<string, string | number> | string) => string;
}

// ---------------------------------------------------------------------------
// Dictionaries
// ---------------------------------------------------------------------------

const DICTIONARIES: Record<Locale, TranslationDict> = { ja, en };

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const I18nContext = createContext<I18nContextValue | null>(null);

const STORAGE_KEY = 'symbol-ui-lang';

function getInitialLang(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'ja' || stored === 'en') return stored;
  } catch { /* ignore */ }
  // Auto-detect from browser
  const browserLang = navigator.language.toLowerCase();
  return browserLang.startsWith('ja') ? 'ja' : 'en';
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Locale>(getInitialLang);

  const setLang = useCallback((l: Locale) => {
    setLangState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch { /* ignore */ }
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number> | string): string => {
      const dict = DICTIONARIES[lang] ?? DICTIONARIES.ja;
      let value = dict[key];

      // Fallback: if string passed as 2nd arg, treat as default
      if (value === undefined) {
        if (typeof params === 'string') return params;
        return key;
      }

      // Interpolation: replace {name} tokens
      if (params && typeof params === 'object') {
        for (const [k, v] of Object.entries(params)) {
          value = value.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
        }
      }

      return value;
    },
    [lang],
  );

  const ctx = useMemo<I18nContextValue>(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <I18nContext.Provider value={ctx}>{children}</I18nContext.Provider>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTranslation(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useTranslation must be used within I18nProvider');
  return ctx;
}
