import { comparePlainDate, isValidPlainDate } from '../domain/date';
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

  const dateInput = el('input', {
    className: 'text-input',
    attrs: {
      id: 'add-date',
      type: 'date',
      max: options.today,
      'aria-describedby': 'add-name-error',
    },
  });

  const dateField = el('label', { className: 'field', attrs: { for: 'add-date' } }, [
    el('span', { className: 'field-label', text: t('backfillDate') }),
    dateInput,
  ]);
  dateField.style.display = 'none';

  const submitButton = el('button', {
    className: 'btn btn-primary',
    attrs: { type: 'submit' },
    text: t('saveAndLogToday'),
  });

  const dateButton = el('button', {
    className: 'btn btn-secondary',
    attrs: { type: 'button' },
    text: t('chooseDate'),
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
    dateField,
    errorNode,
    el('div', { className: 'form-actions form-actions--wrap' }, [
      cancelButton,
      dateButton,
      submitButton,
    ]),
  ]);

  const sheet = openSheet({
    title: t('addItem'),
    content: form,
    closeLabel: t('close'),
  });

  cancelButton.addEventListener('click', () => sheet.close());

  const showError = (message: string, target: HTMLInputElement = input): void => {
    errorNode.textContent = message;
    target.setAttribute('aria-invalid', 'true');
    target.focus();
    if (target === input) target.select();
  };

  let choosingDate = false;

  const setChoosingDate = (next: boolean): void => {
    choosingDate = next;
    dateField.style.display = next ? 'block' : 'none';
    dateButton.textContent = next ? t('cancelDateSelection') : t('chooseDate');
    submitButton.textContent = next ? t('saveWithChosenDate') : t('saveAndLogToday');
    if (next) {
      dateInput.value = '';
      // 在点击手势内同步聚焦，安卓 WebView 才会直接弹出系统日期选择器。
      dateInput.focus();
    } else {
      dateInput.removeAttribute('aria-invalid');
      input.focus();
    }
  };

  dateButton.addEventListener('click', () => setChoosingDate(!choosingDate));

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      errorNode.textContent = '';
      input.removeAttribute('aria-invalid');
      dateInput.removeAttribute('aria-invalid');

      const name = input.value.trim();
      if (!name) {
        showError(t('error.EMPTY_NAME'));
        return;
      }

      let occurredOn = options.today;
      if (choosingDate) {
        const value = dateInput.value.trim();
        if (!value || !isValidPlainDate(value)) {
          showError(t('error.INVALID_DATE'), dateInput);
          return;
        }
        if (comparePlainDate(value, options.today) > 0) {
          showError(t('error.FUTURE_DATE'), dateInput);
          return;
        }
        occurredOn = value;
      }

      submitButton.disabled = true;
      submitButton.textContent = t('loading');

      try {
        await addItem(name, occurredOn);
      } catch (error) {
        const message =
          error instanceof AppError && error.code === 'DUPLICATE_DATE'
            ? t('error.DUPLICATE_DATE')
            : messageForError(error);
        showError(message);
        submitButton.disabled = false;
        submitButton.textContent = choosingDate ? t('saveWithChosenDate') : t('saveAndLogToday');
        return;
      }

      sheet.close();
      showToast(choosingDate ? t('toastAddedOnDate', { date: occurredOn }) : t('toastAdded'));

      try {
        await options.onSaved();
      } catch (error) {
        showToast(messageForError(error));
      }
    })();
  });

  requestAnimationFrame(() => input.focus());
}
