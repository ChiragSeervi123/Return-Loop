// Count-up numbers. Any element with data-count="1234" (optional data-prefix)
// counts from 0 when it scrolls into view. The server already rendered the
// final number, so without JS (or with reduced motion) nothing changes.
import { reducedMotion } from '../lib/webgl.js';

const fmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

function run(el) {
  const target = parseFloat(el.dataset.count) || 0;
  const prefix = el.dataset.prefix || '';
  const start = performance.now();
  const dur = 1400;
  function frame(now) {
    const p = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(2, -10 * p); // ease-out expo
    const val = p < 1 ? target * eased : target;
    el.textContent = prefix + fmt.format(Number.isInteger(target) ? Math.round(val) : Math.round(val * 100) / 100);
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

export function initCounters(root = document) {
  const els = root.querySelectorAll('[data-count]');
  if (reducedMotion || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      run(e.target);
    });
  }, { threshold: 0.4 });
  els.forEach((el) => io.observe(el));
}
