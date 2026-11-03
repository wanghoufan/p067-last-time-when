import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { AppError, type Snapshot } from '../src/domain/types';
import { backupFileName, buildBackup, parseBackup } from '../src/storage/importExport';
import { getSnapshot, replaceAll } from '../src/storage/repository';

const TODAY = '2026-11-02';
const TIMESTAMP = '2026-10-01T00:00:00.000Z';
let sequence = 0;

function freshDb(): string {
  sequence += 1;
  return `whenlast-import-test-${Date.now()}-${sequence}`;
}

function makeSnapshot(): Snapshot {
  return {
    items: [
      {
        id: 'item-a',
        name: '理发',
        nameKey: '理发',
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      },
      {
        id: 'item-b',
        name: '买麦片',
        nameKey: '买麦片',
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      },
    ],
    events: [
      {
        id: 'event-a1',
        itemId: 'item-a',
        occurredOn: '2026-10-01',
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      },
      {
        id: 'event-a2',
        itemId: 'item-a',
        occurredOn: '2026-10-20',
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      },
      {
        id: 'event-b1',
        itemId: 'item-b',
        occurredOn: '2026-10-25',
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      },
    ],
    settings: { id: 'app', theme: 'DARK', language: 'en' },
  };
}

function baseBackup(): Record<string, unknown> {
  return JSON.parse(buildBackup(makeSnapshot())) as Record<string, unknown>;
}

function parseError(text: string, maxBytes?: number): AppError {
  try {
    parseBackup(text, TODAY, maxBytes);
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error('parseBackup 未按预期拒绝');
}

function expectInvalid(text: string, maxBytes?: number): void {
  expect(parseError(text, maxBytes).code).toBe('INVALID_BACKUP');
}

function sortById<T extends { id: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => a.id.localeCompare(b.id));
}

describe('buildBackup', () => {
  it('输出稳定的 pretty JSON 与版本标识', () => {
    const snapshot = makeSnapshot();
    const text = buildBackup(snapshot);

    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed.app).toBe('whenlast');
    expect(parsed.schemaVersion).toBe(1);
    expect(typeof parsed.exportedAt).toBe('string');
    expect(Number.isNaN(Date.parse(parsed.exportedAt as string))).toBe(false);
    expect(Object.keys(parsed)).toEqual([
      'app',
      'schemaVersion',
      'exportedAt',
      'items',
      'events',
      'settings',
    ]);
    expect(parsed.items).toEqual(snapshot.items);
    expect(parsed.events).toEqual(snapshot.events);
    expect(parsed.settings).toEqual(snapshot.settings);
    expect(text.includes('\n  "items"')).toBe(true);
    expect(text.endsWith('\n}')).toBe(true);

    const second = JSON.parse(buildBackup(snapshot)) as Record<string, unknown>;
    expect(Object.keys(second)).toEqual(Object.keys(parsed));
    expect(second.items).toEqual(parsed.items);
    expect(second.events).toEqual(parsed.events);
  });
});

describe('backupFileName', () => {
  it('使用本地时间并补零到秒级', () => {
    expect(backupFileName(new Date(2026, 0, 2, 3, 4, 5))).toBe(
      'whenlast-backup-20260102-030405.json',
    );
    expect(backupFileName(new Date(2026, 10, 3, 0, 0, 0))).toBe(
      'whenlast-backup-20261103-000000.json',
    );
  });
});

describe('导出 → 解析 → 恢复', () => {
  it('数据等价', async () => {
    const snapshot = makeSnapshot();
    const parsed = parseBackup(buildBackup(snapshot), TODAY);

    expect(parsed.backup.app).toBe('whenlast');
    expect(parsed.backup.schemaVersion).toBe(1);
    expect(parsed.stats).toEqual({ items: 2, events: 3 });

    const dbName = freshDb();
    await replaceAll(parsed.backup, dbName);
    const stored = await getSnapshot(dbName);

    expect(sortById(stored.items)).toEqual(sortById(snapshot.items));
    expect(sortById(stored.events)).toEqual(sortById(snapshot.events));
    expect(stored.settings).toEqual(snapshot.settings);
  });

  it('缺少 settings 时回退默认设置', () => {
    const raw = baseBackup();
    delete raw.settings;
    const parsed = parseBackup(JSON.stringify(raw), TODAY);
    expect(parsed.backup.settings).toEqual({
      id: 'app',
      theme: 'SYSTEM',
      language: 'FOLLOW_SYSTEM',
    });
  });

  it('重复导入同一备份两次结果一致', async () => {
    const snapshot = makeSnapshot();
    const first = parseBackup(buildBackup(snapshot), TODAY);
    const dbName = freshDb();

    await replaceAll(first.backup, dbName);
    const afterFirst = await getSnapshot(dbName);

    const second = parseBackup(buildBackup(afterFirst), TODAY);
    await replaceAll(second.backup, dbName);
    const afterSecond = await getSnapshot(dbName);

    expect(second.stats).toEqual(first.stats);
    expect(second.stats).toEqual({ items: 2, events: 3 });
    expect(sortById(afterSecond.items)).toEqual(sortById(afterFirst.items));
    expect(sortById(afterSecond.events)).toEqual(sortById(afterFirst.events));
    expect(afterSecond.settings).toEqual(afterFirst.settings);
  });

  it('空备份可解析且统计为 0', () => {
    const snapshot: Snapshot = {
      items: [],
      events: [],
      settings: { id: 'app', theme: 'LIGHT', language: 'zh-CN' },
    };
    const parsed = parseBackup(buildBackup(snapshot), TODAY);

    expect(parsed.backup.items).toEqual([]);
    expect(parsed.backup.events).toEqual([]);
    expect(parsed.stats).toEqual({ items: 0, events: 0 });
  });
});

describe('parseBackup 严格校验', () => {
  it('拒绝坏 JSON', () => {
    expectInvalid('{');
  });

  it('拒绝 app 标识不符', () => {
    const raw = baseBackup();
    raw.app = 'other';
    expectInvalid(JSON.stringify(raw));
  });

  it('拒绝 schemaVersion 不符', () => {
    const raw = baseBackup();
    raw.schemaVersion = 2;
    expectInvalid(JSON.stringify(raw));
  });

  it('拒绝缺少 items 或 events 数组', () => {
    const noItems = baseBackup();
    delete noItems.items;
    expectInvalid(JSON.stringify(noItems));

    const noEvents = baseBackup();
    delete noEvents.events;
    expectInvalid(JSON.stringify(noEvents));
  });

  it('拒绝重复的事项 id', () => {
    const raw = baseBackup();
    const items = raw.items as Array<Record<string, unknown>>;
    items[1].id = items[0].id;
    expectInvalid(JSON.stringify(raw));
  });

  it('拒绝重复的 nameKey', () => {
    const raw = baseBackup();
    const items = raw.items as Array<Record<string, unknown>>;
    items[1].name = items[0].name;
    items[1].nameKey = items[0].nameKey;
    expectInvalid(JSON.stringify(raw));
  });

  it('拒绝孤儿事件', () => {
    const raw = baseBackup();
    const events = raw.events as Array<Record<string, unknown>>;
    events[0].itemId = 'missing-item';
    expectInvalid(JSON.stringify(raw));
  });

  it('拒绝未来日期与非法日期', () => {
    const future = baseBackup();
    (future.events as Array<Record<string, unknown>>)[0].occurredOn = '2026-11-03';
    expectInvalid(JSON.stringify(future));

    const invalidDate = baseBackup();
    (invalidDate.events as Array<Record<string, unknown>>)[0].occurredOn = '2026-02-30';
    expectInvalid(JSON.stringify(invalidDate));
  });

  it('拒绝同事项同日重复记录', () => {
    const raw = baseBackup();
    const events = raw.events as Array<Record<string, unknown>>;
    events[1].occurredOn = events[0].occurredOn;
    expectInvalid(JSON.stringify(raw));
  });

  it('拒绝重复的事件 id', () => {
    const raw = baseBackup();
    const events = raw.events as Array<Record<string, unknown>>;
    events[1].id = events[0].id;
    expectInvalid(JSON.stringify(raw));
  });

  it('拒绝空名称与错误字段类型', () => {
    const emptyName = baseBackup();
    const items = emptyName.items as Array<Record<string, unknown>>;
    items[0].name = '   ';
    expectInvalid(JSON.stringify(emptyName));

    const badType = baseBackup();
    const badItems = badType.items as Array<Record<string, unknown>>;
    badItems[0].createdAt = 123;
    expectInvalid(JSON.stringify(badType));
  });

  it('拒绝超过大小限制的文本', () => {
    expectInvalid(buildBackup(makeSnapshot()), 10);
  });

  it('错误带有可读 reason', () => {
    const error = parseError('{');
    expect(error.reason.length).toBeGreaterThan(0);
    expect(error.message).toBe(error.reason);
  });
});