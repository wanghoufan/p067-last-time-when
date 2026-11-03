import { comparePlainDate, isValidPlainDate } from '../domain/date';
import { sortEventsDesc } from '../domain/records';
import { AppError, type Event, type Item, type Snapshot } from '../domain/types';
import { messageForError, t } from '../i18n';
import { addEvent, deleteItem, renameItem } from '../storage/repository';
import { confirmAction } from './confirm';
import { el } from './dom';
import { openSheet } from './sheet';
import { showToast } from './toast';

export interface DetailOptions {
  item: Item;
  snapshot: Snapshot;
  today: string;
  onChanged(): Promise<Snapshot>;
  openEvent(event: Event, item: Item): void;
  onClosed?(): void;
}

let formSeq = 0;

function storageMessage(error: unknown): string {
  if (error instanceof AppError) {
    if (error.code === 'DUPLICATE_DATE') return t('duplicateDateForItem');
    if (error.code === 'FUTURE_DATE') return t('error.FUTURE_DATE');
    if (error.code === 'INVALID_DATE') return t('error.INVALID_DATE');
  }
  return messageForError(error);
}

function setFieldError(
  input: HTMLInputElement,
  errorNode: HTMLElement,
  message: string,
): void {
  errorNode.textContent = message;
  input.setAttribute('aria-invalid', 'true');
  input.focus();
}

function updateSheetTitle(content: HTMLElement, title: string): void {
  const titleNode = content.parentElement?.querySelector('.sheet-title');
  if (titleNode) titleNode.textContent = title;
}

export function openDetailSheet(options: DetailOptions): void {
  let item = options.item;
  let snapshot = options.snapshot;
  let deleteError = '';

  const content = el('div', { className: 'detail' });

  const sheet = openSheet({
    title: item.name,
    content,
    closeLabel: t('close'),
    onClose: () => {
      options.onClosed?.();
    },
  });

  const rebuild = (): void => {
    const events = sortEventsDesc(
      snapshot.events.filter((event) => event.itemId === item.id),
    );

    const list = el('div', { className: 'history-list' });
    if (events.length === 0) {
      list.append(el('p', { className: 'detail-empty', text: t('noEntries') }));
    } else {
      for (const event of events) {
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
        row.addEventListener('click', () => options.openEvent(event, item));
        list.append(row);
      }
    }

    const backfillId = `detail-backfill-${++formSeq}`;
    const backfillErrorId = `${backfillId}-error`;
    const backfillInput = el('input', {
      className: 'text-input',
      attrs: {
        id: backfillId,
        type: 'date',
        max: options.today,
        required: 'required',
        'aria-describedby': backfillErrorId,
      },
    });
    const backfillError = el('p', {
      className: 'form-error',
      attrs: { id: backfillErrorId, role: 'alert', 'aria-live': 'assertive' },
    });
    const backfillButton = el('button', {
      className: 'btn btn-primary',
      attrs: { type: 'submit' },
      text: t('backfillAction'),
    });
    const backfillForm = el('form', { className: 'form' }, [
      el('label', { className: 'field', attrs: { for: backfillId } }, [
        el('span', { className: 'field-label', text: t('backfillDate') }),
        backfillInput,
      ]),
      backfillError,
      el('div', { className: 'form-actions' }, [backfillButton]),
    ]);

    backfillForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void (async () => {
        backfillError.textContent = '';
        backfillInput.removeAttribute('aria-invalid');

        const value = backfillInput.value.trim();
        if (!value || !isValidPlainDate(value)) {
          setFieldError(backfillInput, backfillError, t('error.INVALID_DATE'));
          return;
        }
        if (comparePlainDate(value, options.today) > 0) {
          setFieldError(backfillInput, backfillError, t('error.FUTURE_DATE'));
          return;
        }
        if (
          snapshot.events.some(
            (candidate) => candidate.itemId === item.id && candidate.occurredOn === value,
          )
        ) {
          setFieldError(backfillInput, backfillError, t('duplicateDateForItem'));
          return;
        }

        backfillButton.disabled = true;
        backfillButton.textContent = t('loading');

        try {
          await addEvent(item.id, value, options.today);
          snapshot = await options.onChanged();
          rebuild();
          showToast(t('toastBackfilled'));
        } catch (error) {
          setFieldError(backfillInput, backfillError, storageMessage(error));
          backfillButton.disabled = false;
          backfillButton.textContent = t('backfillAction');
        }
      })();
    });

    const renameId = `detail-rename-${++formSeq}`;
    const renameErrorId = `${renameId}-error`;
    const renameInput = el('input', {
      className: 'text-input',
      attrs: {
        id: renameId,
        type: 'text',
        maxlength: '100',
        autocomplete: 'off',
        spellcheck: 'false',
        'aria-describedby': renameErrorId,
      },
    });
    renameInput.value = item.name;

    const renameError = el('p', {
      className: 'form-error',
      attrs: { id: renameErrorId, role: 'alert', 'aria-live': 'assertive' },
    });
    const renameButton = el('button', {
      className: 'btn btn-primary',
      attrs: { type: 'submit' },
      text: t('renameAction'),
    });
    const renameForm = el('form', { className: 'form' }, [
      el('label', { className: 'field', attrs: { for: renameId } }, [
        el('span', { className: 'field-label', text: t('renameName') }),
        renameInput,
      ]),
      renameError,
      el('div', { className: 'form-actions' }, [renameButton]),
    ]);

    renameForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void (async () => {
        renameError.textContent = '';
        renameInput.removeAttribute('aria-invalid');

        const name = renameInput.value.trim();
        if (!name) {
          setFieldError(renameInput, renameError, t('error.EMPTY_NAME'));
          return;
        }
        if (name.length > 100) {
          setFieldError(renameInput, renameError, t('error.NAME_TOO_LONG'));
          return;
        }
        if (
          snapshot.items.some(
            (candidate) =>
              candidate.id !== item.id && candidate.nameKey === name.toLowerCase(),
          )
        ) {
          setFieldError(renameInput, renameError, t('error.DUPLICATE_NAME'));
          return;
        }

        renameButton.disabled = true;
        renameButton.textContent = t('loading');

        try {
          await renameItem(item.id, name);
          snapshot = await options.onChanged();
        } catch (error) {
          setFieldError(renameInput, renameError, storageMessage(error));
          renameButton.disabled = false;
          renameButton.textContent = t('renameAction');
          return;
        }

        const fresh = snapshot.items.find((candidate) => candidate.id === item.id);
        if (!fresh) {
          sheet.close();
          showToast(t('toastRenamed'));
          return;
        }

        item = fresh;
        updateSheetTitle(content, item.name);
        rebuild();
        showToast(t('toastRenamed'));
      })();
    });

    const deleteButton = el('button', {
      className: 'btn btn-danger',
      attrs: { type: 'button' },
      text: t('detailDeleteItem'),
    });
    deleteButton.addEventListener('click', () => {
      void (async () => {
        const confirmed = await confirmAction({
          title: t('deleteItemTitle'),
          message: t('deleteItemMessage'),
          confirmText: t('delete'),
          cancelText: t('cancel'),
          danger: true,
        });
        if (!confirmed) return;

        deleteError = '';
        deleteButton.disabled = true;
        try {
          await deleteItem(item.id);
        } catch (error) {
          deleteError = storageMessage(error);
          rebuild();
          return;
        }

        sheet.close();

        try {
          await options.onChanged();
        } catch (error) {
          showToast(messageForError(error));
        }

        showToast(t('toastItemDeleted'));
      })();
    });

    content.replaceChildren(
      el('p', {
        className: 'detail-count',
        text: t('detailCount', { n: events.length }),
      }),
      el('section', { className: 'detail-section' }, [
        el('h3', { className: 'section-title', text: t('detailHistoryTitle') }),
        list,
      ]),
      el('section', { className: 'detail-section' }, [
        el('h3', { className: 'section-title', text: t('detailBackfillTitle') }),
        backfillForm,
      ]),
      el('section', { className: 'detail-section' }, [
        el('h3', { className: 'section-title', text: t('detailRenameTitle') }),
        renameForm,
      ]),
      el('div', { className: 'detail-danger' }, [
        deleteError
          ? el('p', {
              className: 'form-error',
              attrs: { role: 'alert', 'aria-live': 'assertive' },
              text: deleteError,
            })
          : null,
        deleteButton,
      ]),
    );
  };

  rebuild();
}