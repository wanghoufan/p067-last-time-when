import { AppError, type LanguagePreference } from '../domain/types';
import { en } from './en';
import { zhCN, type MessageKey } from './zh-CN';

export type { MessageKey } from './zh-CN';

export type Lang = 'zh-CN' | 'en';

export type MessageParams = Record<string, string | number>;

const TABLES: Record<Lang, Record<MessageKey, string>> = {
  'zh-CN': zhCN,
  en,
};

let preference: LanguagePreference = 'FOLLOW_SYSTEM';
let resolved: Lang = 'zh-CN';

function detectLanguage(): Lang {
  if (typeof navigator === 'undefined') return 'zh-CN';
  const candidates =
    navigator.languages && navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language];

  for (const raw of candidates) {
    if (typeof raw !== 'string') continue;
    const code = raw.toLowerCase();
    if (code.startsWith('zh')) return 'zh-CN';
    if (code.startsWith('en')) return 'en';
  }

  return 'zh-CN';
}

function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

export function setLanguage(next: LanguagePreference): Lang {
  preference = next;
  resolved = next === 'FOLLOW_SYSTEM' ? detectLanguage() : next;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = resolved;
  }
  return resolved;
}

export function getLanguagePreference(): LanguagePreference {
  return preference;
}

export function getResolvedLanguage(): Lang {
  return resolved;
}

export function t(key: MessageKey, params?: MessageParams): string {
  const value = TABLES[resolved][key];
  return interpolate(value ?? key, params);
}

export function messageForError(error: unknown): string {
  if (error instanceof AppError) {
    return t(`error.${error.code}` as MessageKey);
  }
  return t('error');
}