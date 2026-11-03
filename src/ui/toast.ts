import { el } from './dom';

let region: HTMLElement | null = null;
let timer: number | undefined;

function getRegion(): HTMLElement {
  if (region?.isConnected) return region;

  const existing = document.querySelector<HTMLElement>('#toast-region');
  if (existing) {
    region = existing;
    return existing;
  }

  region = el('div', {
    className: 'toast-region',
    attrs: { id: 'toast-region', 'aria-live': 'polite', 'aria-atomic': 'true' },
  });
  document.body.append(region);
  return region;
}

export function showToast(message: string, duration = 2200): void {
  const host = getRegion();
  if (timer !== undefined) window.clearTimeout(timer);

  host.replaceChildren(
    el('div', { className: 'toast', attrs: { role: 'status' }, text: message }),
  );

  timer = window.setTimeout(() => {
    host.replaceChildren();
    timer = undefined;
  }, duration);
}