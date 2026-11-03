import { sortEventsGlobal } from '../domain/records';
import type { Event, Item, Snapshot } from '../domain/types';
import { t } from '../i18n';
import { el } from './dom';

export interface HistoryState {
  snapshot: Snapshot;
}

export interface HistoryActions {
  openEvent(event: Event, item: Item): void;
}

export function renderHistory(state: HistoryState, actions: HistoryActions): HTMLElement {
  const itemsById = new Map(state.snapshot.items.map((item) => [item.id, item]));
  const rows: HTMLElement[] = [];

  for (const event of sortEventsGlobal(state.snapshot.events)) {
    const item = itemsById.get(event.itemId);
    if (!item) continue;

    const row = el(
      'button',
      {
        className: 'history-row',
        attrs: { type: 'button', 'aria-label': `${event.occurredOn} ${item.name}` },
        dataset: { eventId: event.id },
      },
      [
        el('time', {
          className: 'history-date',
          attrs: { datetime: event.occurredOn },
          text: event.occurredOn,
        }),
        el('span', { className: 'history-name', text: item.name }),
      ],
    );

    row.addEventListener('click', () => actions.openEvent(event, item));
    rows.push(row);
  }

  if (rows.length === 0) {
    return el('section', { className: 'history-page' }, [
      el('div', { className: 'empty-state' }, [
        el('h2', { className: 'empty-title', text: t('emptyHistory') }),
        el('p', { className: 'empty-desc', text: t('historyEmptyDesc') }),
      ]),
    ]);
  }

  return el('section', { className: 'history-page' }, [
    el('div', { className: 'history-list' }, rows),
  ]);
}