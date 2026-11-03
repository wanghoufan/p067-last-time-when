import { el } from './dom';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmText: string;
  cancelText: string;
  danger?: boolean;
}

let current: (() => void) | null = null;

export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  current?.();

  return new Promise<boolean>((resolve) => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    let settled = false;

    const cancelButton = el('button', {
      className: 'btn btn-secondary',
      attrs: { type: 'button' },
      text: options.cancelText,
    });
    const confirmButton = el('button', {
      className: `btn ${options.danger ? 'btn-danger' : 'btn-primary'}`,
      attrs: { type: 'button' },
      text: options.confirmText,
    });

    const panel = el(
      'div',
      {
        className: 'dialog',
        attrs: {
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': 'confirm-title',
          'aria-describedby': options.message ? 'confirm-message' : null,
        },
      },
      [
        el('h2', {
          className: 'dialog-title',
          attrs: { id: 'confirm-title' },
          text: options.title,
        }),
        options.message
          ? el('p', {
              className: 'dialog-message',
              attrs: { id: 'confirm-message' },
              text: options.message,
            })
          : null,
        el('div', { className: 'dialog-actions' }, [cancelButton, confirmButton]),
      ],
    );

    const overlay = el('div', { className: 'overlay confirm-overlay' }, [panel]);

    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKeydown, true);
      overlay.remove();
      document.body.style.overflow = previousOverflow;
      if (current === closeFromOutside) current = null;
      if (previousFocus?.isConnected) previousFocus.focus();
      resolve(value);
    };

    const closeFromOutside = (): void => finish(false);

    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
        return;
      }
      if (event.key !== 'Tab') return;

      const focusables = [cancelButton, confirmButton];
      const index = focusables.indexOf(document.activeElement as HTMLButtonElement);
      if (event.shiftKey) {
        if (index <= 0) {
          event.preventDefault();
          confirmButton.focus();
        }
      } else if (index === focusables.length - 1 || index === -1) {
        event.preventDefault();
        cancelButton.focus();
      }
    };

    cancelButton.addEventListener('click', () => finish(false));
    confirmButton.addEventListener('click', () => finish(true));
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) finish(false);
    });

    document.body.style.overflow = 'hidden';
    document.body.append(overlay);
    document.addEventListener('keydown', onKeydown, true);
    current = closeFromOutside;

    requestAnimationFrame(() => cancelButton.focus());
  });
}