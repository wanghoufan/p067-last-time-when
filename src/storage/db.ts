import { AppError, DEFAULT_SETTINGS } from '../domain/types';

export const DB_NAME = 'whenlast';
export const DB_VERSION = 1;

export const STORE_NAMES = ['items', 'events', 'settings'] as const;
export type StoreName = (typeof STORE_NAMES)[number];

const connections = new Map<string, Promise<IDBDatabase>>();

function upgradeDb(db: IDBDatabase, oldVersion: number): void {
  if (oldVersion < 1) {
    const items = db.createObjectStore('items', { keyPath: 'id' });
    items.createIndex('nameKey', 'nameKey', { unique: true });

    const events = db.createObjectStore('events', { keyPath: 'id' });
    events.createIndex('itemId', 'itemId');
    events.createIndex('occurredOn', 'occurredOn');
    events.createIndex('itemDate', ['itemId', 'occurredOn'], { unique: true });

    const settings = db.createObjectStore('settings', { keyPath: 'id' });
    settings.put(DEFAULT_SETTINGS);
  }

  // 后续 schema 迁移入口：if (oldVersion < 2) { ... }
}

export function openDb(name: string = DB_NAME): Promise<IDBDatabase> {
  const cached = connections.get(name);
  if (cached) return cached;

  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new AppError('STORAGE_FAILED', '当前环境不支持 IndexedDB'));
  }

  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, DB_VERSION);

    request.onupgradeneeded = (event) => {
      try {
        upgradeDb(request.result, event.oldVersion);
      } catch (error) {
        request.transaction?.abort();
        reject(
          error instanceof AppError
            ? error
            : new AppError('STORAGE_FAILED', '初始化本地数据库失败'),
        );
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };

    request.onerror = () => {
      reject(new AppError('STORAGE_FAILED', request.error?.message ?? '无法打开本地数据库'));
    };
  });

  connections.set(name, opening);
  void opening.catch(() => {
    connections.delete(name);
  });
  return opening;
}

export async function closeDb(name: string = DB_NAME): Promise<void> {
  const cached = connections.get(name);
  connections.delete(name);
  if (!cached) return;
  try {
    const db = await cached;
    db.close();
  } catch {
    // 打开失败的连接无需关闭
  }
}

export async function deleteDb(name: string = DB_NAME): Promise<void> {
  await closeDb(name);
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () =>
      reject(new AppError('STORAGE_FAILED', request.error?.message ?? '无法删除本地数据库'));
    request.onblocked = () =>
      reject(new AppError('STORAGE_FAILED', '数据库被其他连接占用，无法删除'));
  });
}

export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败'));
  });
}

export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB 事务失败'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB 事务已中止'));
  });
}

export async function withTransaction<T>(
  db: IDBDatabase,
  storeNames: StoreName | StoreName[],
  mode: IDBTransactionMode,
  run: (tx: IDBTransaction) => Promise<T>,
): Promise<T> {
  const tx = db.transaction(storeNames, mode);
  const done = transactionDone(tx);
  void done.catch(() => undefined);

  try {
    const result = await run(tx);
    await done;
    return result;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      // 事务可能已经结束
    }
    await done.catch(() => undefined);
    throw error;
  }
}