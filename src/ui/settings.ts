import {
  DEFAULT_SETTINGS,
  type LanguagePreference,
  type Settings,
  type Snapshot,
  type ThemePreference,
} from '../domain/types';
import { getResolvedLanguage, messageForError, setLanguage, t } from '../i18n';
import {
  MAX_BACKUP_BYTES,
  backupFileName,
  buildBackup,
  parseBackup,
  type BackupStats,
  type ParsedBackup,
} from '../storage/importExport';
import { getSnapshot, replaceAll, saveSettings } from '../storage/repository';
import { confirmAction } from './confirm';
import { el } from './dom';
import { openSheet } from './sheet';
import { applyTheme } from './theme';
import { showToast } from './toast';

export const APP_VERSION = '0.1.0';

export interface SettingsSheetOptions {
  snapshot: Snapshot;
  today: string;
  onChanged(): Promise<Snapshot>;
  onViewChanged(): void;
}

let formSeq = 0;

function downloadBackup(text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = backupFileName(new Date());
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function canShareBackupFile(fileName: string): boolean {
  if (typeof File !== 'function') return false;
  if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') return false;
  try {
    const probe = new File([''], fileName, { type: 'application/json' });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

export function openSettingsSheet(options: SettingsSheetOptions): void {
  let settings: Settings = { ...options.snapshot.settings };
  let pending: ParsedBackup | null = null;
  let currentCounts: BackupStats | null = null;
  let importError = '';
  let exportBusy = false;
  let importBusy = false;

  const content = el('div', { className: 'settings' });

  const syncChoices = (name: string, value: string): void => {
    content.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach((input) => {
      input.checked = input.value === value;
    });
  };

  const focusChoice = (name: string, value: string): void => {
    requestAnimationFrame(() => {
      content
        .querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`)
        ?.focus();
    });
  };

  const chooseTheme = async (next: ThemePreference): Promise<void> => {
    if (next === settings.theme) return;
    const previous = settings.theme;
    settings = { ...settings, theme: next };
    applyTheme(next);

    try {
      await saveSettings({ theme: next });
    } catch (error) {
      settings = { ...settings, theme: previous };
      applyTheme(previous);
      syncChoices('theme', previous);
      showToast(messageForError(error));
    }
  };

  const chooseLanguage = async (next: LanguagePreference): Promise<void> => {
    if (next === settings.language) return;
    const previous = settings.language;
    settings = { ...settings, language: next };
    setLanguage(next);
    options.onViewChanged();
    rebuild();
    focusChoice('language', next);

    try {
      await saveSettings({ language: next });
    } catch (error) {
      settings = { ...settings, language: previous };
      setLanguage(previous);
      options.onViewChanged();
      rebuild();
      focusChoice('language', previous);
      showToast(messageForError(error));
    }
  };

  const makeChoice = (
    name: string,
    value: string,
    label: string,
    checked: boolean,
    onSelect: () => void,
  ): HTMLLabelElement => {
    const input = el('input', {
      attrs: { type: 'radio', name, value },
    });
    input.checked = checked;
    input.addEventListener('change', () => {
      if (input.checked) onSelect();
    });

    return el('label', { className: 'choice' }, [
      input,
      el('span', { className: 'choice-label', text: label }),
    ]);
  };

  const exportCurrent = async (button: HTMLButtonElement): Promise<void> => {
    if (exportBusy) return;
    exportBusy = true;
    button.disabled = true;

    try {
      const snapshot = await getSnapshot();
      const text = buildBackup(snapshot);
      downloadBackup(text);
      showToast(t('toastExported'));
    } catch (error) {
      showToast(messageForError(error));
    } finally {
      exportBusy = false;
      button.disabled = false;
    }
  };

  const shareBackup = async (button: HTMLButtonElement): Promise<void> => {
    if (exportBusy) return;
    if (typeof navigator.share !== 'function') {
      showToast(t('exportShareFailed'));
      return;
    }

    exportBusy = true;
    button.disabled = true;

    try {
      const snapshot = await getSnapshot();
      const text = buildBackup(snapshot);
      const file = new File([text], backupFileName(new Date()), { type: 'application/json' });
      await navigator.share({ files: [file], title: t('appName') });
    } catch (error) {
      if (!isAbortError(error)) showToast(t('exportShareFailed'));
    } finally {
      exportBusy = false;
      button.disabled = false;
    }
  };

  const importInputId = `settings-import-${++formSeq}`;
  const fileInput = el('input', {
    className: 'file-input',
    attrs: {
      id: importInputId,
      type: 'file',
      accept: 'application/json,.json',
      'aria-label': t('importJson'),
    },
  });

  const readImport = async (input: HTMLInputElement): Promise<void> => {
    const file = input.files && input.files.length > 0 ? input.files[0] : null;
    if (!file) return;

    input.value = '';
    importError = '';
    pending = null;
    currentCounts = null;

    if (file.size > MAX_BACKUP_BYTES) {
      importError = t('importTooLarge');
      rebuild();
      return;
    }

    let text: string;
    try {
      text = await file.text();
    } catch {
      importError = t('importUnreadable');
      rebuild();
      return;
    }

    try {
      pending = parseBackup(text, options.today);
    } catch {
      pending = null;
      importError = t('importInvalid');
    }

    if (pending) {
      try {
        const snapshot = await getSnapshot();
        currentCounts = { items: snapshot.items.length, events: snapshot.events.length };
      } catch {
        currentCounts = { items: 0, events: 0 };
      }
    }

    rebuild();
  };

  fileInput.addEventListener('change', () => {
    void readImport(fileInput);
  });

  const applyImport = async (button: HTMLButtonElement): Promise<void> => {
    if (!pending || importBusy) return;
    const backup = pending.backup;
    const incoming = pending.stats;
    const current = currentCounts ?? { items: 0, events: 0 };

    const confirmed = await confirmAction({
      title: t('importReplaceTitle'),
      message: t('importReplaceMessage', {
        items: incoming.items,
        events: incoming.events,
        currentItems: current.items,
        currentEvents: current.events,
      }),
      confirmText: t('importReplace'),
      cancelText: t('cancel'),
      danger: true,
    });
    if (!confirmed) return;

    importBusy = true;
    button.disabled = true;

    try {
      await replaceAll({
        items: backup.items,
        events: backup.events,
        settings: backup.settings,
      });
    } catch (error) {
      importBusy = false;
      importError = t('importFailed');
      rebuild();
      showToast(messageForError(error));
      return;
    }

    settings = backup.settings ? { ...backup.settings } : { ...DEFAULT_SETTINGS };
    applyTheme(settings.theme);
    setLanguage(settings.language);
    pending = null;
    currentCounts = null;
    importError = '';
    importBusy = false;

    try {
      await options.onChanged();
    } catch (error) {
      showToast(messageForError(error));
    }

    rebuild();
    showToast(t('toastImported'));
  };

  const clearAll = (): void => {
    void (async () => {
      const confirmed = await confirmAction({
        title: t('clearAllTitle'),
        message: t('clearAllMessage'),
        confirmText: t('clearAllConfirm'),
        cancelText: t('cancel'),
        danger: true,
      });
      if (!confirmed) return;

      try {
        await replaceAll({ items: [], events: [], settings });
      } catch (error) {
        showToast(messageForError(error));
        return;
      }

      pending = null;
      currentCounts = null;
      importError = '';

      try {
        await options.onChanged();
      } catch (error) {
        showToast(messageForError(error));
      }

      rebuild();
      showToast(t('toastCleared'));
    })();
  };

  const rebuild = (): void => {
    const themeGroup = el('fieldset', { className: 'choice-group' }, [
      el('legend', { className: 'section-title', text: t('theme') }),
      makeChoice('theme', 'LIGHT', t('themeLight'), settings.theme === 'LIGHT', () => {
        void chooseTheme('LIGHT');
      }),
      makeChoice('theme', 'DARK', t('themeDark'), settings.theme === 'DARK', () => {
        void chooseTheme('DARK');
      }),
      makeChoice('theme', 'SYSTEM', t('themeSystem'), settings.theme === 'SYSTEM', () => {
        void chooseTheme('SYSTEM');
      }),
    ]);

    const languageGroup = el('fieldset', { className: 'choice-group' }, [
      el('legend', { className: 'section-title', text: t('language') }),
      makeChoice('language', 'zh-CN', t('langZh'), settings.language === 'zh-CN', () => {
        void chooseLanguage('zh-CN');
      }),
      makeChoice('language', 'en', t('langEn'), settings.language === 'en', () => {
        void chooseLanguage('en');
      }),
      makeChoice(
        'language',
        'FOLLOW_SYSTEM',
        t('langFollow'),
        settings.language === 'FOLLOW_SYSTEM',
        () => {
          void chooseLanguage('FOLLOW_SYSTEM');
        },
      ),
    ]);

    const exportButton = el('button', {
      className: 'btn btn-primary',
      attrs: { type: 'button' },
      text: t('exportJson'),
    });
    exportButton.addEventListener('click', () => {
      void exportCurrent(exportButton);
    });

    const shareButton = canShareBackupFile(backupFileName(new Date()))
      ? (() => {
          const button = el('button', {
            className: 'btn btn-secondary',
            attrs: { type: 'button' },
            text: t('exportShare'),
          });
          button.addEventListener('click', () => {
            void shareBackup(button);
          });
          return button;
        })()
      : null;

    const previewNode = pending
      ? (() => {
          const stats = pending.stats;
          const current = currentCounts ?? { items: 0, events: 0 };
          const exported = new Date(pending.backup.exportedAt);
          const timeText = Number.isNaN(exported.getTime())
            ? pending.backup.exportedAt
            : exported.toLocaleString(getResolvedLanguage());

          const cancelButton = el('button', {
            className: 'btn btn-secondary',
            attrs: { type: 'button' },
            text: t('cancel'),
          });
          cancelButton.addEventListener('click', () => {
            pending = null;
            currentCounts = null;
            importError = '';
            rebuild();
          });

          const exportFirstButton =
            current.items + current.events > 0
              ? (() => {
                  const button = el('button', {
                    className: 'btn btn-secondary import-export-first',
                    attrs: { type: 'button' },
                    text: t('importExportFirst'),
                  });
                  button.addEventListener('click', () => {
                    void exportCurrent(button);
                  });
                  return button;
                })()
              : null;

          const replaceButton = el('button', {
            className: 'btn btn-danger',
            attrs: { type: 'button' },
            text: t('importReplace'),
          });
          replaceButton.addEventListener('click', () => {
            void applyImport(replaceButton);
          });

          return el('div', { className: 'import-preview' }, [
            el('h4', { className: 'import-preview-title', text: t('importPreviewTitle') }),
            el('p', {
              className: 'import-meta',
              text: t('importPreviewItems', { n: stats.items }),
            }),
            el('p', {
              className: 'import-meta',
              text: t('importPreviewEvents', { n: stats.events }),
            }),
            el('p', {
              className: 'import-meta',
              text: t('importPreviewExportedAt', { time: timeText }),
            }),
            el('p', {
              className: 'import-meta',
              text: t('importPreviewCurrentItems', { n: current.items }),
            }),
            el('p', {
              className: 'import-meta',
              text: t('importPreviewCurrentEvents', { n: current.events }),
            }),
            stats.items + stats.events === 0
              ? el('p', { className: 'import-note', text: t('importEmptyWarning') })
              : null,
            current.items + current.events > 0
              ? el('p', { className: 'import-note', text: t('importRecommendedBackup') })
              : null,
            el('p', { className: 'import-note', text: t('importReplaceHint') }),
            el('div', { className: 'import-actions' }, [
              cancelButton,
              exportFirstButton,
              replaceButton,
            ]),
          ]);
        })()
      : null;

    const clearButton = el('button', {
      className: 'btn btn-danger',
      attrs: { type: 'button' },
      text: t('clearAll'),
    });
    clearButton.addEventListener('click', clearAll);

    content.replaceChildren(
      el('section', { className: 'settings-section' }, [themeGroup]),
      el('section', { className: 'settings-section' }, [languageGroup]),
      el('section', { className: 'settings-section' }, [
        el('h3', { className: 'section-title', text: t('settingsDataTitle') }),
        el('div', { className: 'settings-actions' }, [exportButton, shareButton]),
        el('p', { className: 'settings-text export-download-hint', text: t('exportDownloadHint') }),
        el('label', { className: 'field file-field', attrs: { for: importInputId } }, [
          el('span', { className: 'field-label', text: t('importJson') }),
          fileInput,
        ]),
        importError
          ? el('p', {
              className: 'form-error',
              attrs: { role: 'alert', 'aria-live': 'assertive' },
              text: importError,
            })
          : null,
        previewNode,
      ]),
      el('section', { className: 'settings-section' }, [
        el('h3', { className: 'section-title', text: t('migrationTitle') }),
        el('ol', { className: 'settings-text migration-steps' }, [
          el('li', { text: t('migrationStep1') }),
          el('li', { text: t('migrationStep2') }),
          el('li', { text: t('migrationStep3') }),
        ]),
        el('p', { className: 'settings-text', text: t('migrationLossNote') }),
      ]),
      el('section', { className: 'settings-section privacy-section' }, [
        el('h3', { className: 'section-title', text: t('privacyTitle') }),
        el('p', { className: 'settings-text privacy-text', text: t('privacyText') }),
      ]),
      el('section', { className: 'settings-section' }, [
        el('div', { className: 'settings-actions' }, [clearButton]),
      ]),
      el('p', {
        className: 'app-version',
        text: t('versionLabel', { version: APP_VERSION }),
      }),
    );
  };

  openSheet({
    title: t('settingsTitle'),
    content,
    closeLabel: t('close'),
  });

  rebuild();
}
