// The QC "stamp moment": a giant rubber stamp slams onto the screen,
// the screen shakes for 200ms, ink sparks fly, then the form is submitted.
import { reducedMotion } from '../lib/webgl.js';
import { burst } from './burst.js';

const INK = { A: '#2F7D4F', B: '#D99A1E', C: '#B3392B', REJECTED: '#B3392B' };

export function playStamp(overlay, grade, { sub = 'GRADE' } = {}) {
  return new Promise((resolve) => {
    if (!overlay || reducedMotion) return resolve();
    // live directly under <body> so shaking <main> can't move it
    if (overlay.parentElement !== document.body) document.body.appendChild(overlay);

    const stamp = overlay.querySelector('.stamp');
    const letter = overlay.querySelector('[data-stamp-letter]');
    const subEl = overlay.querySelector('[data-stamp-sub]');
    const canvas = overlay.querySelector('canvas');
    const color = INK[grade] || '#FF5B1F';

    letter.textContent = grade;
    subEl.textContent = sub;
    stamp.classList.toggle('is-word', grade.length > 1);
    stamp.style.color = color;
    overlay.classList.add('is-on');

    const anim = stamp.animate([
      { transform: 'scale(2.2) rotate(-16deg)', opacity: 0 },
      { transform: 'scale(2.2) rotate(-16deg)', opacity: 1, offset: 0.05 },
      { transform: 'scale(1) rotate(-8deg)', opacity: 1 },
    ], { duration: 280, easing: 'cubic-bezier(.55, 0, 1, .45)', fill: 'forwards' });

    anim.onfinish = () => {
      // shake the page and the overlay (not <body>, which would break position: fixed)
      const shaken = [document.getElementById('main'), overlay].filter(Boolean);
      shaken.forEach((el) => el.classList.add('is-shaking'));
      setTimeout(() => shaken.forEach((el) => el.classList.remove('is-shaking')), 200);
      const r = stamp.getBoundingClientRect();
      burst(canvas, r.left + r.width / 2, r.top + r.height / 2, color, { count: 70, power: 1.4 });
      if (navigator.vibrate) navigator.vibrate(30);
      setTimeout(resolve, 650);
    };
  });
}
