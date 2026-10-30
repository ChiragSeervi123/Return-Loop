// Custom cursor: an orange dot with a lagging ring that grows over anything clickable.
// Over a [data-touch] area (the agent's phone screen) it becomes a fingertip that
// presses and leaves a ripple on tap. Fine pointers only, and never with reduced motion.
import { reducedMotion } from './lib/webgl.js';

const INTERACTIVE = 'a, button, label, select, summary, [data-cursor], canvas, input[type="checkbox"], input[type="radio"], input[type="file"]';
const TEXTY = 'input:not([type="checkbox"]):not([type="radio"]):not([type="file"]), textarea';

export function initCursor() {
  if (reducedMotion || !matchMedia('(pointer: fine)').matches) return;
  const dot = document.createElement('div');
  const ring = document.createElement('div');
  dot.className = 'cursor-dot is-hidden';
  ring.className = 'cursor-ring is-hidden';
  document.body.append(dot, ring);
  document.body.classList.add('has-cursor');

  let x = -100, y = -100, rx = -100, ry = -100;
  window.addEventListener('pointermove', (e) => {
    x = e.clientX;
    y = e.clientY;
    dot.style.transform = `translate(${x}px, ${y}px)`;
    const over = e.target.closest ? e.target : null;
    const texty = over && over.closest(TEXTY);
    dot.classList.toggle('is-hidden', !!texty);
    ring.classList.toggle('is-hidden', !!texty);
    ring.classList.toggle('is-hover', !!(over && over.closest(INTERACTIVE)));
    const touch = !!(over && over.closest('[data-touch]'));
    ring.classList.toggle('is-touch', touch);
    dot.classList.toggle('is-touch', touch);
  }, { passive: true });
  window.addEventListener('pointerdown', (e) => {
    if (!ring.classList.contains('is-touch')) return;
    ring.classList.add('is-press');
    const ripple = document.createElement('span');
    ripple.className = 'touch-ripple';
    ripple.style.left = `${e.clientX}px`;
    ripple.style.top = `${e.clientY}px`;
    document.body.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  }, { passive: true });
  window.addEventListener('pointerup', () => ring.classList.remove('is-press'), { passive: true });
  document.addEventListener('pointerleave', () => { dot.classList.add('is-hidden'); ring.classList.add('is-hidden'); });

  (function loop() {
    rx += (x - rx) * 0.18;
    ry += (y - ry) * 0.18;
    ring.style.transform = `translate(${rx}px, ${ry}px)`;
    requestAnimationFrame(loop);
  })();
}
