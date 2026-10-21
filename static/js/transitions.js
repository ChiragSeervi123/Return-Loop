// Page transitions: a kraft-paper flap wipes down over the page (~350ms) on
// link navigation, and wipes away on the next page's load.
// The "wipe away" half is started by an inline script in base.html's <head>
// (it reads the sessionStorage flag set here) so it runs before first paint.
import { reducedMotion } from './lib/webgl.js';

const KEY = 'rl-flap';

export function initTransitions() {
  const flap = document.querySelector('.flap');
  if (!flap || reducedMotion) return;

  // Coming back via the back/forward cache: make sure the flap is open.
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) flap.classList.remove('is-closing');
  });

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (a.target && a.target !== '_self') return;
    if (a.hasAttribute('download')) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return; // in-page anchor
    if (a.getAttribute('href').startsWith('javascript:')) return;

    e.preventDefault();
    try { sessionStorage.setItem(KEY, '1'); } catch (err) { /* private mode */ }
    flap.classList.add('is-closing');
    setTimeout(() => { location.href = url.href; }, 340);
  });

  try { sessionStorage.removeItem(KEY); } catch (err) { /* ignore */ }
}
