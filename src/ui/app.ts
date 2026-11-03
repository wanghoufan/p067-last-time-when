import { todayLocal } from '../domain/date';
import type { Event, Item, Snapshot } from '../domain/types';
import { messageForError, t } from '../i18n';
import { getSnapshot, logToday } from '../storage/repository';
import { openAddSheet } from './add';
import { openDetailSheet } from './detail';
import { el } from './dom';
import { openEventEditSheet } from './event-edit';
import { renderHistory, type HistoryActions } from './history';
import { renderHome, type HomeActions } from './home';
import { openSettingsSheet } from './settings';
import { showToast } from './toast';

export type Page = 'home' | 'history';

export interface AppController {
  start(): void;
  destroy(): void;
}

interface AppState {
  snapshot: Snapshot;
  today: string;
  page: Page;
}

interface RenderOptions {
  focusTab?: boolean;
  restoreFocus?: FocusKey | null;
  fallbackFocus?: boolean;
}

type FocusKey = { kind: 'event'; id: string } | { kind: 'itemDetails'; id: string };

const SVG_NS = 'http://www.w3.org/2000/svg';

const HOME_ICON = [
  'M4 11.2 12 4l8 7.2V20a1 1 0 0 1-1 1h-4.6v-5.5H9.6V21H5a1 1 0 0 1-1-1Z',
];

const HISTORY_ICON = ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M12 7.5V12l3 1.8'];

const SETTINGS_ICON = [
  'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z',
  'M12 3v2M12 19v2M3 12h2M19 12h2M5.9 5.9l1.4 1.4M16.7 16.7l1.4 1.4M18.1 5.9l-1.4 1.4M7.3 16.7l-1.4 1.4',
];

function icon(paths: string[], className = 'icon'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.8');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
  }

  return svg;
}

function focusKeyOf(node: HTMLElement): FocusKey | null {
  const eventId = node.dataset.eventId;
  if (eventId) return { kind: 'event', id: eventId };
  const itemDetails = node.dataset.itemDetails;
  if (itemDetails) return { kind: 'itemDetails', id: itemDetails };
  return null;
}

export function createApp(root: HTMLElement, initial: Snapshot): AppController {
  const state: AppState = {
    snapshot: initial,
    today: todayLocal(),
    page: 'home',
  };
  const scrollPositions: Record<Page, number> = { home: 0, history: 0 };
  let settingsTrigger: HTMLButtonElement | null = null;
  let timer: number | undefined;

  const homeActions: HomeActions = {
    log: logOnce,
    details: (item) => openDetail(item.id, state.snapshot),
    add: openAdd,
  };

  const historyActions: HistoryActions = {
    openEvent: (event, item) => openEventEditor(event, item),
  };

  async function refresh(): Promise<Snapshot> {
    const previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const restoreFocus = previous ? focusKeyOf(previous) : null;
    const trackFocus =
      previous === null || previous === document.body || root.contains(previous);

    state.snapshot = await getSnapshot();
    state.today = todayLocal();

    const activeNow = document.activeElement;
    const canRestore =
      trackFocus &&
      (activeNow === document.body ||
        (activeNow instanceof HTMLElement && root.contains(activeNow)));

    render(undefined, {
      restoreFocus: canRestore ? restoreFocus : null,
      fallbackFocus: true,
    });

    return state.snapshot;
  }

  async function logOnce(itemId: string): Promise<void> {
    try {
      await logToday(itemId, state.today);
      await refresh();
      showToast(t('toastLogged'));
    } catch (error) {
      showToast(messageForError(error));
      try {
        await refresh();
      } catch {
        // 保持当前视图
      }
    }
  }

  function openAdd(): void {
    openAddSheet({
      today: state.today,
      onSaved: async () => {
        try {
          await refresh();
        } catch (error) {
          showToast(messageForError(error));
        }
      },
    });
  }

  function openDetail(itemId: string, snapshot: Snapshot): void {
    const item = snapshot.items.find((candidate) => candidate.id === itemId);
    if (!item) return;

    openDetailSheet({
      item,
      snapshot,
      today: state.today,
      onChanged: refresh,
      openEvent: (event, currentItem) => {
        openEventEditor(event, currentItem, (next) => {
          if (next) openDetail(itemId, next);
        });
      },
    });
  }

  function openEventEditor(
    event: Event,
    item: Item,
    onClosed?: (snapshot: Snapshot | undefined) => void,
  ): void {
    openEventEditSheet({
      event,
      item,
      snapshot: state.snapshot,
      today: state.today,
      onChanged: refresh,
      onClosed,
    });
  }

  function openSettings(): void {
    openSettingsSheet({
      snapshot: state.snapshot,
      today: state.today,
      onChanged: refresh,
      onViewChanged: () => render(),
    });
  }

  function settingsButton(): HTMLButtonElement {
    if (!settingsTrigger) {
      settingsTrigger = el('button', {
        className: 'icon-button',
        attrs: { type: 'button' },
        dataset: { settingsTrigger: 'true' },
      }, [icon(SETTINGS_ICON)]);
      settingsTrigger.addEventListener('click', openSettings);
    }

    settingsTrigger.setAttribute('aria-label', t('settings'));
    return settingsTrigger;
  }

  function navigate(page: Page): void {
    if (state.page === page) return;
    scrollPositions[state.page] = window.scrollY;
    state.page = page;
    render(scrollPositions[page], { focusTab: true });
  }

  function focusActiveTab(): void {
    root.querySelector<HTMLElement>('.tab.is-active')?.focus({ preventScroll: true });
  }

  function findFocusTarget(key: FocusKey): HTMLElement | null {
    const nodes = root.querySelectorAll<HTMLElement>('[data-event-id], [data-item-details]');
    for (const node of nodes) {
      if (key.kind === 'event' && node.dataset.eventId === key.id) return node;
      if (key.kind === 'itemDetails' && node.dataset.itemDetails === key.id) return node;
    }
    return null;
  }

  function renderHistoryPage(): HTMLElement {
    return renderHistory({ snapshot: state.snapshot }, historyActions);
  }

  function renderTabs(): HTMLElement {
    const makeTab = (page: Page, label: string, paths: string[]): HTMLButtonElement => {
      const active = state.page === page;
      const button = el(
        'button',
        {
          className: `tab${active ? ' is-active' : ''}`,
          attrs: {
            type: 'button',
            role: 'tab',
            'aria-selected': active ? 'true' : 'false',
          },
        },
        [icon(paths, 'tab-icon'), el('span', { className: 'tab-label', text: label })],
      );
      button.addEventListener('click', () => navigate(page));
      return button;
    };

    return el(
      'nav',
      { className: 'tabbar', attrs: { role: 'tablist', 'aria-label': t('navigation') } },
      [makeTab('home', t('home'), HOME_ICON), makeTab('history', t('history'), HISTORY_ICON)],
    );
  }

  function render(scrollTarget?: number, options: RenderOptions = {}): void {
    const keepScroll = scrollTarget ?? window.scrollY;

    const header = el('header', { className: 'app-header' }, [
      el('div', { className: 'app-heading' }, [
        el('h1', {
          className: 'app-title',
          text: state.page === 'home' ? t('appName') : t('historyTitle'),
        }),
        state.page === 'home'
          ? el('p', { className: 'tagline', text: t('tagline') })
          : null,
      ]),
      settingsButton(),
    ]);

    const body =
      state.page === 'home'
        ? renderHome({ snapshot: state.snapshot, today: state.today }, homeActions)
        : renderHistoryPage();

    root.replaceChildren(header, body, renderTabs());

    requestAnimationFrame(() => {
      window.scrollTo(0, keepScroll);

      if (options.focusTab) {
        focusActiveTab();
        return;
      }

      if (options.restoreFocus) {
        const target = findFocusTarget(options.restoreFocus);
        if (target) {
          target.focus({ preventScroll: true });
          return;
        }
      }

      if (options.fallbackFocus && document.activeElement === document.body) {
        focusActiveTab();
      }
    });
  }

  function checkToday(): void {
    const next = todayLocal();
    if (next === state.today) return;
    state.today = next;
    render();
  }

  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') checkToday();
  };

  return {
    start(): void {
      render();
      timer = window.setInterval(checkToday, 60_000);
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('focus', checkToday);
    },
    destroy(): void {
      if (timer !== undefined) window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', checkToday);
    },
  };
}