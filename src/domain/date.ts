import { AppError } from './types';

const PLAIN_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MILLISECONDS_PER_DAY = 86_400_000;

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

function parsePlainDate(value: unknown): [number, number, number] | null {
  if (typeof value !== 'string') return null;
  const match = PLAIN_DATE_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }

  return [year, month, day];
}

export function todayLocal(now: Date = new Date()): string {
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function isValidPlainDate(value: unknown): value is string {
  return parsePlainDate(value) !== null;
}

export function dayNumber(value: string): number {
  const parts = parsePlainDate(value);
  if (!parts) throw new AppError('INVALID_DATE', `日期无效：${String(value)}`);
  return Date.UTC(parts[0], parts[1] - 1, parts[2]) / MILLISECONDS_PER_DAY;
}

export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

export function comparePlainDate(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}