import { comparePlainDate, daysBetween } from './date';
import type { Event, Item } from './types';

function compareDesc(a: string, b: string): number {
  return a < b ? 1 : a > b ? -1 : 0;
}

export function sortEventsDesc(events: Event[]): Event[] {
  return [...events].sort(
    (a, b) =>
      comparePlainDate(b.occurredOn, a.occurredOn) ||
      compareDesc(a.createdAt, b.createdAt) ||
      compareDesc(a.id, b.id),
  );
}

export function sortEventsGlobal(events: Event[]): Event[] {
  return sortEventsDesc(events);
}

export interface ItemSummary {
  lastDate: string | null;
  previousDate: string | null;
  elapsedDays: number | null;
  lastGapDays: number | null;
  hasToday: boolean;
}

export function summarizeItem(item: Item, events: Event[], today: string): ItemSummary {
  const own = sortEventsDesc(events.filter((event) => event.itemId === item.id));
  const lastDate = own.length > 0 ? own[0].occurredOn : null;
  const previousDate = own.length > 1 ? own[1].occurredOn : null;

  return {
    lastDate,
    previousDate,
    elapsedDays: lastDate === null ? null : Math.max(0, daysBetween(lastDate, today)),
    lastGapDays:
      lastDate === null || previousDate === null
        ? null
        : Math.max(0, daysBetween(previousDate, lastDate)),
    hasToday: own.some((event) => event.occurredOn === today),
  };
}