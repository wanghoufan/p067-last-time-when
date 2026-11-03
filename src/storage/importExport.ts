import { comparePlainDate, isValidPlainDate } from '../domain/date';
import {
  AppError,
  DEFAULT_SETTINGS,
  type Event,
  type Item,
  type LanguagePreference,
  type Settings,
  type Snapshot,
  type ThemePreference,
} from '../domain/types';

export const BACKUP_APP = 'whenlast';
export const BACKUP_SCHEMA_VERSION = 1;
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;

const MAX_NAME_LENGTH = 100;
const THEMES = new Set<ThemePreference>(['LIGHT', 'DARK', 'SYSTEM']);
const LANGUAGES = new Set<LanguagePreference>(['FOLLOW_SYSTEM', 'zh-CN', 'en']);

export interface BackupFile {
  app: 'whenlast';
  schemaVersion: 1;
  exportedAt: string;
  items: Item[];
  events: Event[];
  settings?: Settings;
}

export interface BackupStats {
  items: number;
  events: number;
}

export interface ParsedBackup {
  backup: BackupFile;
  stats: BackupStats;
}

function invalid(reason: string): AppError {
  return new AppError('INVALID_BACKUP', reason);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function requireName(item: Record<string, unknown>, label: string): string {
  if (!isNonEmptyString(item.name) || !item.name.trim()) {
    throw invalid(`${label}的 name 不能为空`);
  }
  if (item.name.trim().length > MAX_NAME_LENGTH) {
    throw invalid(`${label}的 name 超过 ${MAX_NAME_LENGTH} 个字符`);
  }
  return item.name;
}

function parseItems(value: unknown): Item[] {
  if (!Array.isArray(value)) throw invalid('items 必须是数组');

  const items: Item[] = [];
  const ids = new Set<string>();
  const nameKeys = new Set<string>();

  for (let index = 0; index < value.length; index += 1) {
    const raw = value[index];
    const label = `第 ${index + 1} 个事项`;
    if (!isPlainObject(raw)) throw invalid(`${label}必须是对象`);
    if (!isNonEmptyString(raw.id)) throw invalid(`${label}缺少有效 id`);
    if (ids.has(raw.id)) throw invalid(`${label}的 id 重复：${raw.id}`);

    const name = requireName(raw, label);
    const expectedNameKey = name.trim().toLowerCase();
    if (!isNonEmptyString(raw.nameKey) || raw.nameKey !== expectedNameKey) {
      throw invalid(`${label}的 nameKey 与名称不一致`);
    }
    if (nameKeys.has(raw.nameKey)) {
      throw invalid(`${label}的 nameKey 重复：${raw.nameKey}`);
    }
    if (!isTimestamp(raw.createdAt)) throw invalid(`${label}的 createdAt 无效`);
    if (!isTimestamp(raw.updatedAt)) throw invalid(`${label}的 updatedAt 无效`);

    ids.add(raw.id);
    nameKeys.add(raw.nameKey);
    items.push({
      id: raw.id,
      name,
      nameKey: raw.nameKey,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
  }

  return items;
}

function parseEvents(value: unknown, items: Item[], today: string): Event[] {
  if (!Array.isArray(value)) throw invalid('events 必须是数组');

  const itemIds = new Set(items.map((item) => item.id));
  const eventIds = new Set<string>();
  const itemDates = new Set<string>();
  const events: Event[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const raw = value[index];
    const label = `第 ${index + 1} 条记录`;
    if (!isPlainObject(raw)) throw invalid(`${label}必须是对象`);
    if (!isNonEmptyString(raw.id)) throw invalid(`${label}缺少有效 id`);
    if (eventIds.has(raw.id)) throw invalid(`${label}的 id 重复：${raw.id}`);
    if (!isNonEmptyString(raw.itemId) || !itemIds.has(raw.itemId)) {
      throw invalid(`${label}引用了不存在的事项：${String(raw.itemId)}`);
    }
    if (!isValidPlainDate(raw.occurredOn)) {
      throw invalid(`${label}的 occurredOn 不是合法日期：${String(raw.occurredOn)}`);
    }
    if (comparePlainDate(raw.occurredOn, today) > 0) {
      throw invalid(`${label}的 occurredOn 晚于今天：${raw.occurredOn}`);
    }
    if (!isTimestamp(raw.createdAt)) throw invalid(`${label}的 createdAt 无效`);
    if (!isTimestamp(raw.updatedAt)) throw invalid(`${label}的 updatedAt 无效`);

    const itemDate = `${raw.itemId}|${raw.occurredOn}`;
    if (itemDates.has(itemDate)) {
      throw invalid(`${label}与同事项的另一条记录日期重复：${raw.occurredOn}`);
    }

    eventIds.add(raw.id);
    itemDates.add(itemDate);
    events.push({
      id: raw.id,
      itemId: raw.itemId,
      occurredOn: raw.occurredOn,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
  }

  return events;
}

function parseSettings(value: unknown): Settings {
  if (!isPlainObject(value)) throw invalid('settings 必须是对象');
  if (value.id !== 'app') throw invalid('settings.id 必须是 app');
  if (!THEMES.has(value.theme as ThemePreference)) {
    throw invalid(`settings.theme 无效：${String(value.theme)}`);
  }
  if (!LANGUAGES.has(value.language as LanguagePreference)) {
    throw invalid(`settings.language 无效：${String(value.language)}`);
  }
  return {
    id: 'app',
    theme: value.theme as ThemePreference,
    language: value.language as LanguagePreference,
  };
}

export function buildBackup(snapshot: Snapshot): string {
  const backup: BackupFile = {
    app: BACKUP_APP,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    items: snapshot.items.map((item) => ({
      id: item.id,
      name: item.name,
      nameKey: item.nameKey,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
    events: snapshot.events.map((event) => ({
      id: event.id,
      itemId: event.itemId,
      occurredOn: event.occurredOn,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    })),
    settings: {
      id: 'app',
      theme: snapshot.settings.theme,
      language: snapshot.settings.language,
    },
  };

  return JSON.stringify(backup, null, 2);
}

export function parseBackup(
  text: string,
  today: string,
  maxBytes: number = MAX_BACKUP_BYTES,
): ParsedBackup {
  if (typeof text !== 'string') throw invalid('备份内容不是文本');
  if (!isValidPlainDate(today)) throw invalid(`今天的日期无效：${String(today)}`);

  const bytes = new TextEncoder().encode(text).length;
  if (bytes > maxBytes) {
    throw invalid(`备份文件超过大小限制：${bytes} > ${maxBytes} 字节`);
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw invalid(`JSON 解析失败：${reason}`);
  }

  if (!isPlainObject(data)) throw invalid('备份根节点必须是对象');
  if (data.app !== BACKUP_APP) {
    throw invalid(`app 标识不匹配：${String(data.app)}`);
  }
  if (data.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw invalid(`schemaVersion 不受支持：${String(data.schemaVersion)}`);
  }
  if (!isTimestamp(data.exportedAt)) throw invalid('exportedAt 无效');
  if (!Array.isArray(data.items)) throw invalid('items 必须是数组');
  if (!Array.isArray(data.events)) throw invalid('events 必须是数组');

  const items = parseItems(data.items);
  const events = parseEvents(data.events, items, today);
  const settings =
    data.settings === undefined ? { ...DEFAULT_SETTINGS } : parseSettings(data.settings);

  return {
    backup: {
      app: BACKUP_APP,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: data.exportedAt,
      items,
      events,
      settings,
    },
    stats: { items: items.length, events: events.length },
  };
}