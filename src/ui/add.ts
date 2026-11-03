import { AppError } from '../domain/types';
import { messageForError, t } from '../i18n';
import { addItem } from '../storage/repository';
import { el } from './dom';
import { openSheet } from './sheet';
import { showToast } from './toast';

export interface AddSheetOptions {
  today: string;
  onSaved: () => Promise<void>;
}

export function openAddSheet(options: AddSheetOptions): void {
  const errorNode = el('p', {
    className: 'form-error',
    attrs: { id: 'add-name-error', role: 'alert', 'aria-live': 'assertive' },
  });

  const input = el('input', {
    className: 'text-input',
    attrs: {
      id: 'add-name',
      type: 'text',
      placeholder: t('namePlaceholder'),
      autocomplete: 'off',
      'aria-describedby': 'add-name-error',
      maxlength: '100',
    },
  });

  const submitButton = el('button', {
    className: 'btn btn-primary',
    attrs: { type: 'submit' },
    text: t('saveAndLogToday'),
  });

  const cancelButton = el('button', {
    className: 'btn btn-secondary',
    attrs: { type: 'button' },
    text: t('cancel'),
  });

  const form = el('form', { className: 'form' }, [
    el('label', { className: 'field', attrs: { for: 'add-name' } }, [
      el('span', { className: 'field-label', text: t('itemName') }),
      input,
    ]),
    errorNode,
    el('div', { className: 'form-actions' }, [cancelButton, submitButton]),
  ]);

  const sheet = openSheet({
    title: t('addItem'),
    content: form,
    closeLabel: t('close'),
  });

  cancelButton.addEventListener('click', () => sheet.close());

  const showError = (message: string): void => {
    errorNode.textContent = message;
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    input.select();
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      errorNode.textContent = '';
      input.removeAttribute('aria-invalid');

      const name = input.value.trim();
      if (!name) {
        showError(t('error.EMPTY_NAME'));
        return;
      }

      submitButton.disabled = true;
      submitButton.textContent = t('loading');

      try {
        await addItem(name, options.today);
      } catch (error) {
        const message =
          error instanceof AppError && error.code === 'DUPLICATE_DATE'
            ? t('error.DUPLICATE_DATE')
            : messageForError(error);
        showError(message);
        submitButton.disabled = false;
        submitButton.textContent = t('saveAndLogToday');
        return;
      }

      sheet.close();
      showToast(t('toastAdded'));

      try {
        await options.onSaved();
      } catch (error) {
        showToast(messageForError(error));
      }
    })();
  });

  requestAnimationFrame(() => input.focus());
}