// Ink-splat spark burst on a 2D canvas. Used by the stamp moment and the landing stamps.
import { reducedMotion } from '../lib/webgl.js';

export function burst(canvas, x, y, color = '#FF5B1F', { count = 48, power = 1 } = {}) {
  if (reducedMotion || !canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = (2 + Math.random() * 9) * power;
    parts.push({
      x, y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.5,
      r: Math.random() < 0.25 ? 3 + Math.random() * 5 : 1 + Math.random() * 2.2, // a few fat ink drops
      life: 1,
      decay: 0.016 + Math.random() * 0.025,
      color: Math.random() < 0.7 ? color : '#FF5B1F',
    });
  }

  function tick() {
    ctx.clearRect(0, 0, rect.width, rect.height);
    let alive = 0;
    for (const p of parts) {
      if (p.life <= 0) continue;
      alive++;
      p.vx *= 0.94;
      p.vy = p.vy * 0.94 + 0.35;
      p.x += p.vx;
      p.y += p.vy;
      p.life -= p.decay;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      // stretch along velocity so drops look like flicked ink
      const ang = Math.atan2(p.vy, p.vx);
      ctx.ellipse(p.x, p.y, p.r * (1 + Math.hypot(p.vx, p.vy) * 0.08), p.r, ang, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (alive) requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, rect.width, rect.height);
  }
  requestAnimationFrame(tick);
}
