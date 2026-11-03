import { summarizeItem } from '../domain/records';
import type { Item, Snapshot } from '../domain/types';
import { t } from '../i18n';
import { el } from './dom';

export interface HomeState {
  snapshot: Snapshot;
  today: string;
}

export interface HomeActions {
  log(itemId: string): Promise<void>;
  details(item: Item): void;
  add(): void;
}

let query = '';

export function renderHome(state: HomeState, actions: HomeActions): HTMLElement {
  const items = [...state.snapshot.items].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name),
  );

  if (items.length === 0) {
    return el('section', { className: 'home' }, [renderEmpty(actions.add)]);
  }

  const list = el('div', { className: 'item-list' });
  const search = el('input', {
    className: 'search-input',
    attrs: {
      type: 'search',
      placeholder: t('searchPlaceholder'),
      'aria-label': t('searchPlaceholder'),
      autocomplete: 'off',
      spellcheck: 'false',
    },
  });
  search.value = query;

  const paint = (): void => {
    const needle = query.trim().toLowerCase();
    const visible = needle
      ? items.filter((item) => item.name.toLowerCase().includes(needle))
      : items;

    if (visible.length === 0) {
      list.replaceChildren(el('p', { className: 'empty-hint', text: t('searchEmpty') }));
      return;
    }

    list.replaceChildren(...visible.map((item) => renderItem(item, state, actions)));
  };

  search.addEventListener('input', () => {
    query = search.value;
    paint();
  });

  paint();

  const addButton = el('button', {
    className: 'btn btn-primary add-button',
    attrs: { type: 'button' },
    text: `＋ ${t('addItem')}`,
  });
  addButton.addEventListener('click', actions.add);

  return el('section', { className: 'home' }, [search, list, addButton]);
}

function renderEmpty(onAdd: () => void): HTMLElement {
  const button = el('button', {
    className: 'btn btn-primary',
    attrs: { type: 'button' },
    text: `＋ ${t('addItem')}`,
  });
  button.addEventListener('click', onAdd);

  return el('div', { className: 'empty-state' }, [
    el('h2', { className: 'empty-title', text: t('emptyHomeTitle') }),
    el('p', { className: 'empty-desc', text: t('emptyHomeDesc') }),
    button,
  ]);
}

function renderItem(item: Item, state: HomeState, actions: HomeActions): HTMLElement {
  const summary = summarizeItem(item, state.snapshot.events, state.today);
  const elapsedText =
    summary.elapsedDays === null
      ? '—'
      : summary.elapsedDays === 0
        ? t('todayShort')
        : t('daysAgo', { n: summary.elapsedDays });
  const lastText = summary.lastDate
    ? t('lastOn', { date: summary.lastDate })
    : t('noEntries');
  const gapText =
    summary.lastGapDays === null
      ? t('noGap')
      : t('lastGap', { n: summary.lastGapDays });

  const logButton = el('button', {
    className: 'btn btn-primary item-log',
    attrs: { type: 'button', 'aria-label': `${t('logOnce')}: ${item.name}` },
    text: summary.hasToday ? t('doneToday') : t('logOnce'),
  });
  logButton.disabled = summary.hasToday;

  if (!summary.hasToday) {
    logButton.addEventListener('click', () => {
      void (async () => {
        logButton.disabled = true;
        try {
          await actions.log(item.id);
        } finally {
          if (logButton.isConnected) logButton.disabled = false;
        }
      })();
    });
  }

  const detailsButton = el('button', {
    className: 'btn btn-secondary item-details',
    attrs: { type: 'button', 'aria-label': `${t('details')}: ${item.name}` },
    dataset: { itemDetails: item.id },
    text: t('details'),
  });
  detailsButton.addEventListener('click', () => actions.details(item));

  return el(
    'article',
    {
      className: 'item',
      attrs: { 'aria-label': `${item.name}: ${elapsedText} · ${gapText}` },
    },
    [
      el('div', { className: 'item-row' }, [
        el('div', { className: 'item-main' }, [
          el('strong', { className: 'item-name', text: item.name }),
          el('p', { className: 'item-sub', text: lastText }),
        ]),
        el('span', { className: 'item-elapsed', text: elapsedText }),
      ]),
      el('p', { className: 'item-gap', text: gapText }),
      el('div', { className: 'item-actions' }, [logButton, detailsButton]),
    ],
  );
}