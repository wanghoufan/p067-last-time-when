import { comparePlainDate, isValidPlainDate } from '../domain/date';
import { AppError, type Event, type Item, type Snapshot } from '../domain/types';
import { messageForError, t } from '../i18n';
import { deleteEvent, updateEventDate } from '../storage/repository';
import { confirmAction } from './confirm';
import { el } from './dom';
import { openSheet } from './sheet';
import { showToast } from './toast';

export interface EventEditOptions {
  event: Event;
  item: Item;
  snapshot: Snapshot;
  today: string;
  onChanged(): Promise<Snapshot>;
  onClosed?(snapshot: Snapshot | undefined): void;
}

let formSeq = 0;

function eventErrorMessage(error: unknown): string {
  if (error instanceof AppError) {
    if (error.code === 'DUPLICATE_DATE') return t('duplicateDateForItem');
    if (error.code === 'FUTURE_DATE') return t('error.FUTURE_DATE');
  }
  return messageForError(error);
}

export function openEventEditSheet(options: EventEditOptions): void {
  const eventId = options.event.id;
  const inputId = `event-date-${++formSeq}`;
  const errorId = `${inputId}-error`;
  let finalized = false;

  const input = el('input', {
    className: 'text-input',
    attrs: {
      id: inputId,
      type: 'date',
      max: options.today,
      required: 'required',
      'aria-describedby': errorId,
    },
  });
  input.value = options.event.occurredOn;

  const errorNode = el('p', {
    className: 'form-error',
    attrs: { id: errorId, role: 'alert', 'aria-live': 'assertive' },
  });

  const cancelButton = el('button', {
    className: 'btn btn-secondary',
    attrs: { type: 'button' },
    text: t('cancel'),
  });

  const saveButton = el('button', {
    className: 'btn btn-primary',
    attrs: { type: 'submit' },
    text: t('saveDate'),
  });

  const deleteButton = el('button', {
    className: 'btn btn-danger',
    attrs: { type: 'button' },
    text: t('deleteEvent'),
  });

  const form = el('form', { className: 'form' }, [
    el('p', {
      className: 'event-summary',
      text: `${options.item.name} · ${options.event.occurredOn}`,
    }),
    el('label', { className: 'field', attrs: { for: inputId } }, [
      el('span', { className: 'field-label', text: t('eventDate') }),
      input,
    ]),
    errorNode,
    el('div', { className: 'form-actions' }, [cancelButton, saveButton]),
  ]);

  const content = el('div', { className: 'detail' }, [
    form,
    el('div', { className: 'detail-danger' }, [deleteButton]),
  ]);

  const sheet = openSheet({
    title: t('editEventTitle'),
    content,
    closeLabel: t('close'),
    onClose: () => {
      if (finalized) return;
      finalized = true;
      void (async () => {
        let next: Snapshot | undefined;
        try {
          next = await options.onChanged();
        } catch (error) {
          showToast(messageForError(error));
        }
        options.onClosed?.(next);
      })();
    },
  });

  const showError = (message: string): void => {
    errorNode.textContent = message;
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  };

  cancelButton.addEventListener('click', () => sheet.close());

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      errorNode.textContent = '';
      input.removeAttribute('aria-invalid');

      const value = input.value.trim();
      if (!value || !isValidPlainDate(value)) {
        showError(t('error.INVALID_DATE'));
        return;
      }
      if (comparePlainDate(value, options.today) > 0) {
        showError(t('error.FUTURE_DATE'));
        return;
      }
      const conflict = options.snapshot.events.some(
        (candidate) =>
          candidate.itemId === options.event.itemId &&
          candidate.occurredOn === value &&
          candidate.id !== eventId,
      );
      if (conflict) {
        showError(t('duplicateDateForItem'));
        return;
      }

      saveButton.disabled = true;
      saveButton.textContent = t('loading');

      try {
        await updateEventDate(eventId, value, options.today);
      } catch (error) {
        showError(eventErrorMessage(error));
        saveButton.disabled = false;
        saveButton.textContent = t('saveDate');
        return;
      }

      sheet.close();
      showToast(t('toastDateUpdated'));
    })();
  });

  deleteButton.addEventListener('click', () => {
    void (async () => {
      const confirmed = await confirmAction({
        title: t('deleteEventTitle'),
        message: t('deleteEventMessage'),
        confirmText: t('delete'),
        cancelText: t('cancel'),
        danger: true,
      });
      if (!confirmed) return;

      deleteButton.disabled = true;
      try {
        await deleteEvent(eventId);
      } catch (error) {
        deleteButton.disabled = false;
        showError(eventErrorMessage(error));
        return;
      }

      sheet.close();
      showToast(t('toastEventDeleted'));
    })();
  });

  requestAnimationFrame(() => input.focus());
}