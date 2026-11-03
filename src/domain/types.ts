export interface Item {
  id: string;
  name: string;
  nameKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface Event {
  id: string;
  itemId: string;
  occurredOn: string;
  createdAt: string;
  updatedAt: string;
}

export type ThemePreference = 'LIGHT' | 'DARK' | 'SYSTEM';
export type LanguagePreference = 'FOLLOW_SYSTEM' | 'zh-CN' | 'en';

export interface Settings {
  id: 'app';
  theme: ThemePreference;
  language: LanguagePreference;
}

export interface Snapshot {
  items: Item[];
  events: Event[];
  settings: Settings;
}

export type AppErrorCode =
  | 'EMPTY_NAME'
  | 'DUPLICATE_NAME'
  | 'NOT_FOUND'
  | 'DUPLICATE_DATE'
  | 'FUTURE_DATE'
  | 'INVALID_DATE'
  | 'STORAGE_FAILED'
  | 'INVALID_BACKUP'
  | 'TOO_LARGE'
  | 'NAME_TOO_LONG'
  | 'INVALID_SETTINGS';

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly reason: string;

  constructor(code: AppErrorCode, reason: string) {
    super(reason);
    this.name = 'AppError';
    this.code = code;
    this.reason = reason;
  }
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'app',
  theme: 'SYSTEM',
  language: 'FOLLOW_SYSTEM',
};