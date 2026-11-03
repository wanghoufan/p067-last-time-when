import './styles.css';
import { AppError } from './domain/types';
import { messageForError, setLanguage, t } from './i18n';
import { registerServiceWorker } from './pwa/register';
import { getSnapshot } from './storage/repository';
import { createApp } from './ui/app';
import { el } from './ui/dom';
import { applyTheme } from './ui/theme';

const splash = document.querySelector<HTMLElement>('#splash');
const appRoot = document.querySelector<HTMLElement>('#app');
const enterButton = document.querySelector<HTMLButtonElement>('#enter');

function removeSplash(): void {
  splash?.remove();
}

enterButton?.addEventListener('click', removeSplash);

function bootErrorPanel(reason: string): HTMLElement {
  const retry = el('button', {
    className: 'btn btn-primary',
    attrs: { type: 'button' },
    text: t('retry'),
  });
  retry.addEventListener('click', () => {
    if (!appRoot) return;
    appRoot.replaceChildren(el('p', { className: 'empty-hint', text: t('loading') }));
    void boot();
  });

  return el('section', { className: 'empty-state boot-error' }, [
    el('h1', { className: 'empty-title', text: t('bootErrorTitle') }),
    el('p', { className: 'empty-desc', text: reason }),
    retry,
  ]);
}

async function boot(): Promise<void> {
  if (!appRoot) {
    removeSplash();
    return;
  }

  try {
    const snapshot = await getSnapshot();
    setLanguage(snapshot.settings.language);
    applyTheme(snapshot.settings.theme);

    const app = createApp(appRoot, snapshot);
    app.start();
    removeSplash();
    registerServiceWorker();
  } catch (error) {
    removeSplash();
    const reason =
      error instanceof AppError
        ? messageForError(error)
        : error instanceof Error
          ? error.message
          : String(error);
    appRoot.replaceChildren(bootErrorPanel(reason || t('error')));
  }
}

void boot();