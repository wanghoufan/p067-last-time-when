import type { ThemePreference } from '../domain/types';
import { saveSettings } from '../storage/repository';

export type ResolvedTheme = 'light' | 'dark';

const THEME_COLORS: Record<ResolvedTheme, string> = {
  light: '#f6f7fa',
  dark: '#11131b',
};

let preference: ThemePreference = 'SYSTEM';
let mediaQuery: MediaQueryList | null = null;
let mediaHandler: (() => void) | null = null;

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolve(): ResolvedTheme {
  if (preference === 'LIGHT') return 'light';
  if (preference === 'DARK') return 'dark';
  return systemPrefersDark() ? 'dark' : 'light';
}

function syncDom(): void {
  const theme = resolve();
  document.documentElement.dataset.theme = theme;

  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.append(meta);
  }
  meta.content = THEME_COLORS[theme];
}

export function applyTheme(next: ThemePreference): ResolvedTheme {
  preference = next;

  if (mediaQuery && mediaHandler) {
    mediaQuery.removeEventListener('change', mediaHandler);
  }
  mediaQuery = null;
  mediaHandler = null;

  if (next === 'SYSTEM' && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaHandler = () => syncDom();
    mediaQuery.addEventListener('change', mediaHandler);
  }

  syncDom();
  return resolve();
}

export function getThemePreference(): ThemePreference {
  return preference;
}

export function getResolvedTheme(): ResolvedTheme {
  return resolve();
}

export async function setThemePreference(next: ThemePreference): Promise<void> {
  applyTheme(next);
  await saveSettings({ theme: next });
}