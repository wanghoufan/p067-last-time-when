import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { AppError, type AppErrorCode, type Snapshot } from '../src/domain/types';
import {
  addEvent,
  addItem,
  deleteEvent,
  deleteItem,
  getSnapshot,
  logToday,
  renameItem,
  replaceAll,
  updateEventDate,
} from '../src/storage/repository';

const TODAY = '2026-11-02';
let sequence = 0;

function freshDb(): string {
  sequence += 1;
  return `whenlast-test-${Date.now()}-${sequence}`;
}

async function failure(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
  } catch (error) {
    return error;
  }
  throw new Error('预期操作失败，但实际成功');
}

function expectCode(error: unknown, code: AppErrorCode): void {
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

describe('addItem', () => {
  it('同时写入事项与今天的记录', async () => {
    const dbName = freshDb();
    const item = await addItem(' 理发 ', TODAY, dbName);

    expect(item.name).toBe('理发');
    expect(item.nameKey).toBe('理发');

    const snapshot = await getSnapshot(dbName);
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.events[0].itemId).toBe(item.id);
    expect(snapshot.events[0].occurredOn).toBe(TODAY);
  });

  it('大小写或前后空格不同的同名事项被阻止', async () => {
    const dbName = freshDb();
    await addItem('Coffee', TODAY, dbName);

    expectCode(await failure(addItem(' coffee ', TODAY, dbName)), 'DUPLICATE_NAME');
    expectCode(await failure(addItem('COFFEE', TODAY, dbName)), 'DUPLICATE_NAME');

    const snapshot = await getSnapshot(dbName);
    expect(snapshot.items).toHaveLength(1);
  });

  it('拒绝空名称与超长名称', async () => {
    const dbName = freshDb();
    expectCode(await failure(addItem('   ', TODAY, dbName)), 'EMPTY_NAME');
    expectCode(await failure(addItem('a'.repeat(101), TODAY, dbName)), 'NAME_TOO_LONG');
  });
});

describe('logToday', () => {
  it('同日重复记录抛出 DUPLICATE_DATE', async () => {
    const dbName = freshDb();
    const item = await addItem('理发', '2026-11-01', dbName);

    expectCode(await failure(logToday(item.id, '2026-11-01', dbName)), 'DUPLICATE_DATE');

    const snapshot = await getSnapshot(dbName);
    expect(snapshot.events).toHaveLength(1);
  });

  it('并发两次 logToday 只成功一次', async () => {
    const dbName = freshDb();
    const item = await addItem('理发', '2026-11-01', dbName);

    const results = await Promise.allSettled([
      logToday(item.id, '2026-11-02', dbName),
      logToday(item.id, '2026-11-02', dbName),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status).toBe('rejected');
    if (rejected?.status === 'rejected') {
      expectCode(rejected.reason, 'DUPLICATE_DATE');
    }

    const snapshot = await getSnapshot(dbName);
    expect(snapshot.events.filter((event) => event.occurredOn === '2026-11-02')).toHaveLength(1);
  });

  it('事项不存在时抛出 NOT_FOUND', async () => {
    const dbName = freshDb();
    expectCode(await failure(logToday('missing-item', TODAY, dbName)), 'NOT_FOUND');
  });
});

describe('addEvent 与 updateEventDate', () => {
  it('addEvent 拒绝未来日期', async () => {
    const dbName = freshDb();
    const item = await addItem('理发', TODAY, dbName);

    expectCode(
      await failure(addEvent(item.id, '2026-11-03', TODAY, dbName)),
      'FUTURE_DATE',
    );
  });

  it('updateEventDate 拒绝同事项同日冲突', async () => {
    const dbName = freshDb();
    const item = await addItem('理发', TODAY, dbName);
    const past = await addEvent(item.id, '2026-10-20', TODAY, dbName);

    expectCode(
      await failure(updateEventDate(past.id, TODAY, TODAY, dbName)),
      'DUPLICATE_DATE',
    );

    const snapshot = await getSnapshot(dbName);
    expect(snapshot.events.find((event) => event.id === past.id)?.occurredOn).toBe('2026-10-20');
  });

  it('updateEventDate 成功修改日期', async () => {
    const dbName = freshDb();
    const item = await addItem('理发', TODAY, dbName);
    const past = await addEvent(item.id, '2026-10-20', TODAY, dbName);

    const updated = await updateEventDate(past.id, '2026-10-21', TODAY, dbName);
    expect(updated.occurredOn).toBe('2026-10-21');
    expect(updated.updatedAt >= past.updatedAt).toBe(true);
  });
});

describe('删除', () => {
  it('删除最后一条事件后事项仍然存在', async () => {
    const dbName = freshDb();
    await addItem('理发', TODAY, dbName);
    const eventId = (await getSnapshot(dbName)).events[0].id;

    await deleteEvent(eventId, dbName);

    const snapshot = await getSnapshot(dbName);
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.events).toHaveLength(0);
  });

  it('deleteItem 级联删除事件', async () => {
    const dbName = freshDb();
    const item = await addItem('理发', '2026-11-01', dbName);
    await addEvent(item.id, '2026-10-01', '2026-11-01', dbName);
    await addEvent(item.id, '2026-10-20', '2026-11-01', dbName);

    await deleteItem(item.id, dbName);

    const snapshot = await getSnapshot(dbName);
    expect(snapshot.items).toHaveLength(0);
    expect(snapshot.events).toHaveLength(0);
    expect(snapshot.settings.id).toBe('app');
  });
});

describe('renameItem', () => {
  it('阻止仅大小写或空格不同的重名', async () => {
    const dbName = freshDb();
    await addItem('Coffee', TODAY, dbName);
    const tea = await addItem('Tea', TODAY, dbName);

    expectCode(await failure(renameItem(tea.id, ' coffee ', dbName)), 'DUPLICATE_NAME');
    const renamed = await renameItem(tea.id, '绿茶', dbName);
    expect(renamed.name).toBe('绿茶');
  });
});

describe('replaceAll', () => {
  it('成功后数据与备份等价', async () => {
    const dbName = freshDb();
    const source: Snapshot = {
      items: [
        {
          id: 'item-a',
          name: '理发',
          nameKey: '理发',
          createdAt: '2026-10-01T00:00:00.000Z',
          updatedAt: '2026-10-01T00:00:00.000Z',
        },
      ],
      events: [
        {
          id: 'event-a1',
          itemId: 'item-a',
          occurredOn: '2026-10-20',
          createdAt: '2026-10-20T00:00:00.000Z',
          updatedAt: '2026-10-20T00:00:00.000Z',
        },
      ],
      settings: { id: 'app', theme: 'DARK', language: 'en' },
    };

    await addItem('临时事项', TODAY, dbName);
    await replaceAll(source, dbName);

    expect(await getSnapshot(dbName)).toEqual(source);
  });

  it('坏数据失败时保留旧数据', async () => {
    const dbName = freshDb();
    await addItem('保留事项', TODAY, dbName);
    const before = await getSnapshot(dbName);

    const timestamp = '2026-10-01T00:00:00.000Z';
    const bad = {
      items: [
        { id: 'bad-1', name: '甲', nameKey: '甲', createdAt: timestamp, updatedAt: timestamp },
        { id: 'bad-2', name: '甲', nameKey: '甲', createdAt: timestamp, updatedAt: timestamp },
      ],
      events: [],
    };

    const error = await failure(replaceAll(bad, dbName));
    expect(error).toBeInstanceOf(AppError);
    expect(await getSnapshot(dbName)).toEqual(before);
  });
});