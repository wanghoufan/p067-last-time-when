import { el } from './dom';

export interface SheetOptions {
  title: string;
  content: Node;
  closeLabel: string;
  onClose?: () => void;
}

export interface SheetHandle {
  close(): void;
}

let activeHandle: SheetHandle | null = null;
let sheetSeq = 0;

export function openSheet(options: SheetOptions): SheetHandle {
  activeHandle?.close();

  const previousFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const previousOverflow = document.body.style.overflow;
  const titleId = `sheet-title-${++sheetSeq}`;
  let closed = false;

  const closeButton = el('button', {
    className: 'sheet-close',
    attrs: { type: 'button', 'aria-label': options.closeLabel },
    text: '×',
  });

  const panel = el(
    'div',
    {
      className: 'sheet',
      attrs: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': titleId,
        tabindex: '-1',
      },
    },
    [
      el('div', { className: 'sheet-head' }, [
        el('h2', {
          className: 'sheet-title',
          attrs: { id: titleId },
          text: options.title,
        }),
        closeButton,
      ]),
      options.content,
    ],
  );

  const overlay = el('div', { className: 'overlay sheet-overlay' }, [panel]);

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  const close = (): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeydown, true);
    overlay.remove();
    document.body.style.overflow = previousOverflow;
    if (activeHandle === handle) activeHandle = null;
    if (previousFocus?.isConnected) previousFocus.focus();
    options.onClose?.();
  };

  const handle: SheetHandle = { close };

  closeButton.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  document.body.style.overflow = 'hidden';
  document.body.append(overlay);
  document.addEventListener('keydown', onKeydown, true);
  activeHandle = handle;

  requestAnimationFrame(() => {
    const target = panel.querySelector<HTMLElement>('input, select, textarea, button');
    (target ?? panel).focus();
  });

  return handle;
}