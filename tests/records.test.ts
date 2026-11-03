import { describe, expect, it } from 'vitest';
import { sortEventsDesc, sortEventsGlobal, summarizeItem } from '../src/domain/records';
import type { Event, Item } from '../src/domain/types';

const item: Item = {
  id: 'item-1',
  name: '理发',
  nameKey: '理发',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function event(id: string, occurredOn: string, createdAt = '2026-10-01T00:00:00.000Z'): Event {
  return {
    id,
    itemId: 'item-1',
    occurredOn,
    createdAt,
    updatedAt: createdAt,
  };
}

describe('summarizeItem', () => {
  it('无事件时全部为空', () => {
    expect(summarizeItem(item, [], '2026-11-02')).toEqual({
      lastDate: null,
      previousDate: null,
      elapsedDays: null,
      lastGapDays: null,
      hasToday: false,
    });
  });

  it('只有一条事件时 lastGap 为 null', () => {
    const events = [event('e1', '2026-10-20')];
    expect(summarizeItem(item, events, '2026-11-02')).toEqual({
      lastDate: '2026-10-20',
      previousDate: null,
      elapsedDays: 13,
      lastGapDays: null,
      hasToday: false,
    });
  });

  it('两条事件时计算最近两次间隔', () => {
    const events = [event('e1', '2026-10-01'), event('e2', '2026-10-20')];
    expect(summarizeItem(item, events, '2026-11-02')).toEqual({
      lastDate: '2026-10-20',
      previousDate: '2026-10-01',
      elapsedDays: 13,
      lastGapDays: 19,
      hasToday: false,
    });
  });

  it('今天已记录时 elapsedDays 为 0', () => {
    const events = [event('e1', '2026-10-20'), event('e2', '2026-11-02')];
    expect(summarizeItem(item, events, '2026-11-02')).toEqual({
      lastDate: '2026-11-02',
      previousDate: '2026-10-20',
      elapsedDays: 0,
      lastGapDays: 13,
      hasToday: true,
    });
  });

  it('忽略其他事项的事件且 elapsed 不输出负数', () => {
    const events = [
      event('e1', '2026-10-20'),
      { ...event('e2', '2026-10-01'), itemId: 'other-item' },
      event('e3', '2026-11-05'),
    ];
    const summary = summarizeItem(item, events, '2026-11-02');
    expect(summary.lastDate).toBe('2026-11-05');
    expect(summary.elapsedDays).toBe(0);
    expect(summary.lastGapDays).toBe(16);
  });
});

describe('sortEventsDesc', () => {
  it('按 occurredOn、createdAt、id 依次降序', () => {
    const events = [
      event('a', '2026-10-20', '2026-10-20T10:00:00.000Z'),
      event('c', '2026-10-20', '2026-10-20T11:00:00.000Z'),
      event('b', '2026-10-20', '2026-10-20T10:00:00.000Z'),
      event('old', '2026-10-01', '2026-10-30T00:00:00.000Z'),
    ];
    expect(sortEventsDesc(events).map((entry) => entry.id)).toEqual(['c', 'b', 'a', 'old']);
  });

  it('同日同 createdAt 时按 id 降序，结果稳定', () => {
    const events = [event('b', '2026-10-20'), event('a', '2026-10-20')];
    expect(sortEventsDesc(events).map((entry) => entry.id)).toEqual(['b', 'a']);
    expect(sortEventsDesc(events).map((entry) => entry.id)).toEqual(['b', 'a']);
  });

  it('不修改原数组', () => {
    const events = [event('a', '2026-10-01'), event('b', '2026-10-20')];
    const sorted = sortEventsDesc(events);
    expect(sorted).not.toBe(events);
    expect(events.map((entry) => entry.id)).toEqual(['a', 'b']);
  });
});

describe('sortEventsGlobal', () => {
  it('与 sortEventsDesc 排序结果一致', () => {
    const events = [
      event('a', '2026-10-01'),
      event('b', '2026-10-20'),
      event('c', '2026-10-20', '2026-10-21T00:00:00.000Z'),
    ];
    expect(sortEventsGlobal(events).map((entry) => entry.id)).toEqual(
      sortEventsDesc(events).map((entry) => entry.id),
    );
    expect(sortEventsGlobal(events).map((entry) => entry.id)).toEqual(['c', 'b', 'a']);
  });
});