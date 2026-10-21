// Tilt-on-hover with a soft glare for [data-tilt] cards. No library.
import { reducedMotion } from './lib/webgl.js';

const MAX = 7; // degrees

export function initTilt(root = document) {
  if (reducedMotion || !matchMedia('(pointer: fine)').matches) return;
  root.querySelectorAll('[data-tilt]').forEach((card) => {
    const glare = document.createElement('span');
    glare.className = 'glare';
    card.appendChild(glare);

    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;   // 0..1
      const py = (e.clientY - r.top) / r.height;
      card.style.setProperty('--ry', `${(px - 0.5) * 2 * MAX}deg`);
      card.style.setProperty('--rx', `${(0.5 - py) * 2 * MAX}deg`);
      card.style.setProperty('--gx', `${px * 100}%`);
      card.style.setProperty('--gy', `${py * 100}%`);
      card.style.transition = 'transform .08s linear';
      card.classList.add('is-tilting');
    });
    card.addEventListener('pointerleave', () => {
      card.style.setProperty('--rx', '0deg');
      card.style.setProperty('--ry', '0deg');
      card.style.transition = '';
      card.classList.remove('is-tilting');
    });
  });
}

// Magnetic buttons: the button leans towards the pointer a few pixels.
export function initMagnetic(root = document) {
  if (reducedMotion || !matchMedia('(pointer: fine)').matches) return;
  root.querySelectorAll('[data-magnetic]').forEach((btn) => {
    btn.addEventListener('pointermove', (e) => {
      const r = btn.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      btn.style.translate = `${dx * 0.18}px ${dy * 0.3}px`;
    });
    btn.addEventListener('pointerleave', () => { btn.style.translate = ''; });
  });
}
