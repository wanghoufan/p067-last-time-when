export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  const register = (): void => {
    navigator.serviceWorker.register('./sw.js').catch((error: unknown) => {
      console.warn('[pwa] Service Worker registration failed', error);
    });
  };

  if (document.readyState === 'complete') {
    register();
  } else {
    window.addEventListener('load', register, { once: true });
  }
}