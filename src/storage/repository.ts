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
import { DB_NAME, openDb, requestToPromise, withTransaction } from './db';

const MAX_NAME_LENGTH = 100;
const THEMES = new Set<ThemePreference>(['LIGHT', 'DARK', 'SYSTEM']);
const LANGUAGES = new Set<LanguagePreference>(['FOLLOW_SYSTEM', 'zh-CN', 'en']);

export interface ReplacePayload {
  items: Item[];
  events: Event[];
  settings?: Settings;
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeName(raw: unknown): { name: string; nameKey: string } {
  if (typeof raw !== 'string') throw new AppError('EMPTY_NAME', '事项名称不能为空');
  const name = raw.trim();
  if (!name) throw new AppError('EMPTY_NAME', '事项名称不能为空');
  if (name.length > MAX_NAME_LENGTH) {
    throw new AppError('NAME_TOO_LONG', `事项名称不能超过 ${MAX_NAME_LENGTH} 个字符`);
  }
  return { name, nameKey: name.toLowerCase() };
}

function assertToday(today: string): void {
  if (!isValidPlainDate(today)) {
    throw new AppError('INVALID_DATE', `今天的日期无效：${String(today)}`);
  }
}

function assertOccurredOn(occurredOn: string, today: string): void {
  if (!isValidPlainDate(occurredOn)) {
    throw new AppError('INVALID_DATE', `发生日期无效：${String(occurredOn)}`);
  }
  if (comparePlainDate(occurredOn, today) > 0) {
    throw new AppError('FUTURE_DATE', '发生日期不能晚于今天');
  }
}

function isConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'ConstraintError'
  );
}

function asAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const reason = error instanceof Error ? error.message : String(error);
  return new AppError('STORAGE_FAILED', reason || '本地存储操作失败');
}

export async function getSnapshot(dbName: string = DB_NAME): Promise<Snapshot> {
  try {
    const db = await openDb(dbName);
    return await withTransaction(db, ['items', 'events', 'settings'], 'readonly', async (tx) => {
      const items = (await requestToPromise(tx.objectStore('items').getAll())) as Item[];
      const events = (await requestToPromise(tx.objectStore('events').getAll())) as Event[];
      const stored = (await requestToPromise(
        tx.objectStore('settings').get('app'),
      )) as Settings | undefined;
      return {
        items,
        events,
        settings: stored ?? { ...DEFAULT_SETTINGS },
      };
    });
  } catch (error) {
    throw asAppError(error);
  }
}

export async function addItem(
  rawName: string,
  today: string,
  dbName: string = DB_NAME,
): Promise<Item> {
  const { name, nameKey } = normalizeName(rawName);
  assertToday(today);

  try {
    const db = await openDb(dbName);
    return await withTransaction(db, ['items', 'events'], 'readwrite', async (tx) => {
      const itemsStore = tx.objectStore('items');
      const eventsStore = tx.objectStore('events');

      const existing = await requestToPromise(itemsStore.index('nameKey').get(nameKey));
      if (existing) throw new AppError('DUPLICATE_NAME', '已存在同名事项');

      const timestamp = nowIso();
      const item: Item = {
        id: newId(),
        name,
        nameKey,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const event: Event = {
        id: newId(),
        itemId: item.id,
        occurredOn: today,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      try {
        await requestToPromise(itemsStore.add(item));
      } catch (error) {
        if (isConstraintError(error)) {
          throw new AppError('DUPLICATE_NAME', '已存在同名事项');
        }
        throw error;
      }

      try {
        await requestToPromise(eventsStore.add(event));
      } catch (error) {
        if (isConstraintError(error)) {
          throw new AppError('DUPLICATE_DATE', '同一事项同一天只能记录一次');
        }
        throw error;
      }

      return item;
    });
  } catch (error) {
    throw asAppError(error);
  }
}

export async function logToday(
  itemId: string,
  today: string,
  dbName: string = DB_NAME,
): Promise<Event> {
  assertToday(today);

  try {
    const db = await openDb(dbName);
    return await withTransaction(db, ['items', 'events'], 'readwrite', async (tx) => {
      const itemsStore = tx.objectStore('items');
      const eventsStore = tx.objectStore('events');

      const item = await requestToPromise(itemsStore.get(itemId));
      if (!item) throw new AppError('NOT_FOUND', '事项不存在');

      const existing = await requestToPromise(
        eventsStore.index('itemDate').get([itemId, today]),
      );
      if (existing) throw new AppError('DUPLICATE_DATE', '今天已经记录过了');

      const timestamp = nowIso();
      const event: Event = {
        id: newId(),
        itemId,
        occurredOn: today,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      try {
        await requestToPromise(eventsStore.add(event));
      } catch (error) {
        if (isConstraintError(error)) {
          throw new AppError('DUPLICATE_DATE', '今天已经记录过了');
        }
        throw error;
      }

      return event;
    });
  } catch (error) {
    throw asAppError(error);
  }
}

export async function addEvent(
  itemId: string,
  occurredOn: string,
  today: string,
  dbName: string = DB_NAME,
): Promise<Event> {
  assertToday(today);
  assertOccurredOn(occurredOn, today);

  try {
    const db = await openDb(dbName);
    return await withTransaction(db, ['items', 'events'], 'readwrite', async (tx) => {
      const itemsStore = tx.objectStore('items');
      const eventsStore = tx.objectStore('events');

      const item = await requestToPromise(itemsStore.get(itemId));
      if (!item) throw new AppError('NOT_FOUND', '事项不存在');

      const existing = await requestToPromise(
        eventsStore.index('itemDate').get([itemId, occurredOn]),
      );
      if (existing) throw new AppError('DUPLICATE_DATE', '该事项在这一天已有记录');

      const timestamp = nowIso();
      const event: Event = {
        id: newId(),
        itemId,
        occurredOn,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      try {
        await requestToPromise(eventsStore.add(event));
      } catch (error) {
        if (isConstraintError(error)) {
          throw new AppError('DUPLICATE_DATE', '该事项在这一天已有记录');
        }
        throw error;
      }

      return event;
    });
  } catch (error) {
    throw asAppError(error);
  }
}

export async function updateEventDate(
  eventId: string,
  occurredOn: string,
  today: string,
  dbName: string = DB_NAME,
): Promise<Event> {
  assertToday(today);
  assertOccurredOn(occurredOn, today);

  try {
    const db = await openDb(dbName);
    return await withTransaction(db, ['events'], 'readwrite', async (tx) => {
      const eventsStore = tx.objectStore('events');

      const event = (await requestToPromise(eventsStore.get(eventId))) as Event | undefined;
      if (!event) throw new AppError('NOT_FOUND', '记录不存在');
      if (event.occurredOn === occurredOn) return event;

      const conflict = (await requestToPromise(
        eventsStore.index('itemDate').get([event.itemId, occurredOn]),
      )) as Event | undefined;
      if (conflict && conflict.id !== eventId) {
        throw new AppError('DUPLICATE_DATE', '该事项在这一天已有记录');
      }

      const updated: Event = { ...event, occurredOn, updatedAt: nowIso() };
      try {
        await requestToPromise(eventsStore.put(updated));
      } catch (error) {
        if (isConstraintError(error)) {
          throw new AppError('DUPLICATE_DATE', '该事项在这一天已有记录');
        }
        throw error;
      }
      return updated;
    });
  } catch (error) {
    throw asAppError(error);
  }
}

export async function deleteEvent(
  eventId: string,
  dbName: string = DB_NAME,
): Promise<void> {
  try {
    const db = await openDb(dbName);
    await withTransaction(db, ['events'], 'readwrite', async (tx) => {
      const eventsStore = tx.objectStore('events');
      const event = await requestToPromise(eventsStore.get(eventId));
      if (!event) throw new AppError('NOT_FOUND', '记录不存在');
      await requestToPromise(eventsStore.delete(eventId));
    });
  } catch (error) {
    throw asAppError(error);
  }
}

export async function renameItem(
  itemId: string,
  rawName: string,
  dbName: string = DB_NAME,
): Promise<Item> {
  const { name, nameKey } = normalizeName(rawName);

  try {
    const db = await openDb(dbName);
    return await withTransaction(db, ['items'], 'readwrite', async (tx) => {
      const itemsStore = tx.objectStore('items');

      const item = (await requestToPromise(itemsStore.get(itemId))) as Item | undefined;
      if (!item) throw new AppError('NOT_FOUND', '事项不存在');

      const conflict = (await requestToPromise(
        itemsStore.index('nameKey').get(nameKey),
      )) as Item | undefined;
      if (conflict && conflict.id !== itemId) {
        throw new AppError('DUPLICATE_NAME', '已存在同名事项');
      }

      const updated: Item = { ...item, name, nameKey, updatedAt: nowIso() };
      try {
        await requestToPromise(itemsStore.put(updated));
      } catch (error) {
        if (isConstraintError(error)) {
          throw new AppError('DUPLICATE_NAME', '已存在同名事项');
        }
        throw error;
      }
      return updated;
    });
  } catch (error) {
    throw asAppError(error);
  }
}

export async function deleteItem(
  itemId: string,
  dbName: string = DB_NAME,
): Promise<void> {
  try {
    const db = await openDb(dbName);
    await withTransaction(db, ['items', 'events'], 'readwrite', async (tx) => {
      const itemsStore = tx.objectStore('items');
      const eventsStore = tx.objectStore('events');

      const item = await requestToPromise(itemsStore.get(itemId));
      if (!item) throw new AppError('NOT_FOUND', '事项不存在');

      const eventKeys = await requestToPromise(
        eventsStore.index('itemId').getAllKeys(itemId),
      );
      for (const key of eventKeys) {
        await requestToPromise(eventsStore.delete(key));
      }
      await requestToPromise(itemsStore.delete(itemId));
    });
  } catch (error) {
    throw asAppError(error);
  }
}

export async function saveSettings(
  patch: Partial<Pick<Settings, 'theme' | 'language'>>,
  dbName: string = DB_NAME,
): Promise<Settings> {
  if (patch.theme !== undefined && !THEMES.has(patch.theme)) {
    throw new AppError('INVALID_SETTINGS', '主题设置无效');
  }
  if (patch.language !== undefined && !LANGUAGES.has(patch.language)) {
    throw new AppError('INVALID_SETTINGS', '语言设置无效');
  }

  try {
    const db = await openDb(dbName);
    return await withTransaction(db, ['settings'], 'readwrite', async (tx) => {
      const settingsStore = tx.objectStore('settings');
      const current = (await requestToPromise(settingsStore.get('app'))) as
        | Settings
        | undefined;

      const next: Settings = {
        id: 'app',
        theme: patch.theme ?? current?.theme ?? DEFAULT_SETTINGS.theme,
        language: patch.language ?? current?.language ?? DEFAULT_SETTINGS.language,
      };
      await requestToPromise(settingsStore.put(next));
      return next;
    });
  } catch (error) {
    throw asAppError(error);
  }
}

export async function replaceAll(
  payload: ReplacePayload,
  dbName: string = DB_NAME,
): Promise<void> {
  if (!Array.isArray(payload.items) || !Array.isArray(payload.events)) {
    throw new AppError('INVALID_BACKUP', '备份数据结构无效');
  }

  try {
    const db = await openDb(dbName);
    await withTransaction(db, ['items', 'events', 'settings'], 'readwrite', async (tx) => {
      const itemsStore = tx.objectStore('items');
      const eventsStore = tx.objectStore('events');
      const settingsStore = tx.objectStore('settings');

      await Promise.all([
        requestToPromise(itemsStore.clear()),
        requestToPromise(eventsStore.clear()),
        requestToPromise(settingsStore.clear()),
      ]);

      for (const item of payload.items) {
        await requestToPromise(itemsStore.put(item));
      }
      for (const event of payload.events) {
        await requestToPromise(eventsStore.put(event));
      }

      const settings: Settings = {
        ...DEFAULT_SETTINGS,
        ...payload.settings,
        id: 'app',
      };
      await requestToPromise(settingsStore.put(settings));
    });
  } catch (error) {
    throw asAppError(error);
  }
}