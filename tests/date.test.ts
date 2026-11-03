import { describe, expect, it } from 'vitest';
import {
  comparePlainDate,
  dayNumber,
  daysBetween,
  isValidPlainDate,
  todayLocal,
} from '../src/domain/date';
import { AppError } from '../src/domain/types';

function dayNumberError(value: string): unknown {
  try {
    dayNumber(value);
  } catch (error) {
    return error;
  }
  throw new Error(`预期日期被拒绝：${value}`);
}

describe('todayLocal', () => {
  it('使用本地年月日而不是 UTC', () => {
    expect(todayLocal(new Date(2026, 0, 2, 23, 59, 59))).toBe('2026-01-02');
    expect(todayLocal(new Date(2026, 11, 31, 0, 0, 0))).toBe('2026-12-31');
  });
});

describe('isValidPlainDate', () => {
  it('接受合法日历日', () => {
    expect(isValidPlainDate('2026-10-01')).toBe(true);
    expect(isValidPlainDate('2024-02-29')).toBe(true);
  });

  it('拒绝格式错误或不存在的日期', () => {
    expect(isValidPlainDate('2024-02-30')).toBe(false);
    expect(isValidPlainDate('2023-02-29')).toBe(false);
    expect(isValidPlainDate('2024-13-01')).toBe(false);
    expect(isValidPlainDate('2024-00-10')).toBe(false);
    expect(isValidPlainDate('2024-1-01')).toBe(false);
    expect(isValidPlainDate('not-a-date')).toBe(false);
    expect(isValidPlainDate('')).toBe(false);
    expect(isValidPlainDate(20261001)).toBe(false);
  });
});

describe('dayNumber 与 daysBetween', () => {
  it('计算同一年内的日历日差', () => {
    expect(daysBetween('2026-10-01', '2026-10-20')).toBe(19);
    expect(daysBetween('2026-10-20', '2026-11-02')).toBe(13);
  });

  it('跨年计算正确', () => {
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2025-12-30', '2026-01-02')).toBe(3);
  });

  it('闰年 2 月 29 日参与计算', () => {
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
    expect(daysBetween('2023-02-28', '2023-03-01')).toBe(1);
    expect(daysBetween('2024-02-29', '2024-03-01')).toBe(1);
  });

  it('DST 切换不改变日历日差', () => {
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
    expect(dayNumber('2026-11-02') - dayNumber('2026-11-01')).toBe(1);
  });

  it('非法日期抛出 INVALID_DATE', () => {
    const error = dayNumberError('2024-02-30');
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('INVALID_DATE');
  });
});

describe('comparePlainDate', () => {
  it('按日历日比较', () => {
    expect(comparePlainDate('2026-10-01', '2026-10-20')).toBe(-1);
    expect(comparePlainDate('2026-10-20', '2026-10-01')).toBe(1);
    expect(comparePlainDate('2026-10-20', '2026-10-20')).toBe(0);
    expect(comparePlainDate('2026-12-31', '2027-01-01')).toBe(-1);
  });
});