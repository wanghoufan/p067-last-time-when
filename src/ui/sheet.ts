import { el } from './dom';

export interface SheetOptions {
  title: string;
  content: Node;
  closeLabel: string;
  onClose?: () => void;
}

export interface SheetHandle {
  close(): void;
  setChrome(title: string, closeLabel: string): void;
}

let activeHandle: SheetHandle | null = null;
let sheetSeq = 0;

const TEXT_ENTRY_SELECTOR = 'input, textarea, [contenteditable="true"]';

// 触屏设备（可以弹出软键盘）上，含输入框的弹层改为贴视口顶部。
// 原因见 openSheet 内的注释：Android 独立窗口下拿不到键盘高度，只能靠位置规避。
function prefersTopAnchoredSheet(panel: HTMLElement): boolean {
  if (!window.matchMedia('(pointer: coarse)').matches) return false;
  return panel.querySelector<HTMLElement>(TEXT_ENTRY_SELECTOR) !== null;
}

export function closeActiveSheet(): boolean {
  if (!activeHandle) return false;
  activeHandle.close();
  return true;
}

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

  let titleNode: HTMLHeadingElement | null = null;

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
        (titleNode = el('h2', {
          className: 'sheet-title',
          attrs: { id: titleId },
          text: options.title,
        })),
        closeButton,
      ]),
      options.content,
    ],
  );

  const overlay = el('div', { className: 'overlay sheet-overlay' }, [panel]);

  // 红米 + 小米浏览器 PWA 独立窗口实测：微信输入法弹起时 WebView 内部高度已经缩短，
  // 但页面拿不到任何信号（innerHeight、visualViewport.height、resize 全都不变），
  // 所以 fixed 贴底的弹层会被键盘整块盖住。这里在触屏设备上让含输入框的弹层直接
  // 贴视口顶部（键盘约占底部 40%），保证输入框始终在键盘上方。
  if (prefersTopAnchoredSheet(panel)) {
    overlay.classList.add('sheet-overlay--keyboard');
  }

  // 能拿到 visualViewport 收缩的环境（其他浏览器 / iOS）仍按视觉视口对齐，二者叠加生效。
  let viewportFrame = 0;
  const syncViewport = (): void => {
    if (viewportFrame) cancelAnimationFrame(viewportFrame);
    viewportFrame = requestAnimationFrame(() => {
      viewportFrame = 0;
      if (closed) return;
      const viewport = window.visualViewport;
      if (!viewport) return;
      overlay.style.top = `${viewport.offsetTop}px`;
      overlay.style.left = `${viewport.offsetLeft}px`;
      overlay.style.width = `${viewport.width}px`;
      overlay.style.height = `${viewport.height}px`;
      overlay.style.right = 'auto';
      overlay.style.bottom = 'auto';
    });
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  const onFocusIn = (event: FocusEvent): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !panel.contains(target)) return;
    // 等软键盘动画结束后再校正一次，避免弹层与输入框停在键盘后面。
    window.setTimeout(() => {
      if (closed) return;
      syncViewport();
      const rect = target.getBoundingClientRect();
      const viewport = window.visualViewport;
      const top = viewport?.offsetTop ?? 0;
      const height = viewport?.height ?? window.innerHeight;
      if (rect.top < top || rect.bottom > top + height) {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }, 320);
  };

  const close = (): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeydown, true);
    panel.removeEventListener('focusin', onFocusIn);
    window.visualViewport?.removeEventListener('resize', syncViewport);
    window.visualViewport?.removeEventListener('scroll', syncViewport);
    window.removeEventListener('resize', syncViewport);
    if (viewportFrame) cancelAnimationFrame(viewportFrame);
    overlay.remove();
    document.body.style.overflow = previousOverflow;
    if (activeHandle === handle) activeHandle = null;
    if (previousFocus?.isConnected) previousFocus.focus();
    options.onClose?.();
  };

  const handle: SheetHandle = {
    close,
    setChrome(nextTitle: string, nextCloseLabel: string): void {
      if (closed) return;
      if (titleNode) titleNode.textContent = nextTitle;
      closeButton.setAttribute('aria-label', nextCloseLabel);
    },
  };

  closeButton.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  document.body.style.overflow = 'hidden';
  document.body.append(overlay);
  document.addEventListener('keydown', onKeydown, true);
  panel.addEventListener('focusin', onFocusIn);
  window.visualViewport?.addEventListener('resize', syncViewport);
  window.visualViewport?.addEventListener('scroll', syncViewport);
  window.addEventListener('resize', syncViewport);
  syncViewport();
  activeHandle = handle;

  requestAnimationFrame(() => {
    const target = panel.querySelector<HTMLElement>('input, select, textarea, button');
    (target ?? panel).focus();
  });

  return handle;
}