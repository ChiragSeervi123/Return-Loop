// Entry point for every page. Shared behaviour first, then per-page setup
// picked by <body data-page="...">. All effects are optional extras: forms,
// links and buttons work the same if this file never loads.
import { initCursor } from './cursor.js';
import { initCounters } from './fx/counters.js';
import { burst } from './fx/burst.js';
import { playStamp } from './fx/stamp.js';
import { reducedMotion } from './lib/webgl.js';
import { initMagnetic, initTilt } from './tilt.js';
import { initTransitions } from './transitions.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ---------------------------------------------------------------- shared

function initStagger() {
  $$('.slips, .jobs, .ledger, .kpis, .desks').forEach((list) => {
    Array.from(list.children).forEach((el, i) => el.style.setProperty('--i', Math.min(i, 12)));
  });
}

function initToasts() {
  $$('.toast').forEach((toast, i) => {
    const close = () => {
      toast.classList.add('is-leaving');
      setTimeout(() => toast.remove(), reducedMotion ? 0 : 350);
    };
    $('.toast__x', toast)?.addEventListener('click', close);
    setTimeout(close, 6500 + i * 600);
  });
}

export function toast(message, kind = 'info') {
  const box = $('.toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = `toast toast--${kind}`;
  el.innerHTML = `<span class="toast__tag">${{ success: 'DONE', error: 'HOLD' }[kind] || 'NOTE'}</span><p></p>
    <button type="button" class="toast__x" aria-label="Dismiss">&times;</button>`;
  $('p', el).textContent = message;
  box.appendChild(el);
  const close = () => { el.classList.add('is-leaving'); setTimeout(() => el.remove(), 350); };
  $('.toast__x', el).addEventListener('click', close);
  setTimeout(close, 6000);
}

// Role switcher: flip the chip, then submit.
// Light / dark toggle. The <head> script already applied the saved choice before
// the page was drawn; this button flips it and remembers it.
function initThemeToggle() {
  const root = document.documentElement;
  const btn = $('[data-theme-toggle]');
  const dark = matchMedia('(prefers-color-scheme: dark)');
  const current = () => root.getAttribute('data-theme') || (dark.matches ? 'dark' : 'light');
  const label = () => {
    const now = current();
    root.setAttribute('data-theme-now', now);
    if (btn) {
      btn.setAttribute('aria-label', now === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
      btn.setAttribute('aria-pressed', String(now === 'dark'));
    }
  };
  label();
  // following the system: react if it changes while the page is open
  dark.addEventListener('change', () => {
    if (!root.hasAttribute('data-theme')) { label(); document.dispatchEvent(new Event('rl:theme')); }
  });
  if (!btn) return;
  btn.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    if (!reducedMotion) {
      root.classList.add('theme-fading');
      setTimeout(() => root.classList.remove('theme-fading'), 400);
    }
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('rl-theme', next); } catch (e) { /* private mode: works until reload */ }
    label();
    document.dispatchEvent(new Event('rl:theme'));
  });
}

function initSwitcher() {
  const form = $('[data-switcher]');
  if (!form) return;
  const chip = $('[data-role-chip]', form);
  const select = $('select', form);
  try {
    if (sessionStorage.getItem('rl-role-flip')) {
      chip.classList.add('is-new');
      sessionStorage.removeItem('rl-role-flip');
    }
  } catch (e) { /* ignore */ }

  select.addEventListener('change', () => {
    if (!select.value) return;
    try { sessionStorage.setItem('rl-role-flip', '1'); } catch (e) { /* ignore */ }
    if (reducedMotion) return form.submit();
    chip.classList.add('is-flipping');
    setTimeout(() => {
      $('.role-chip__face', chip).textContent = select.value.split(':')[0].toUpperCase();
      chip.classList.remove('is-flipping');
    }, 280);
    setTimeout(() => form.submit(), 360);
  });
}

// Handoff card: close it, or continue as the next desk (the role chip flips on arrival).
// [data-clock] shows the local time: hours:minutes, or with seconds when data-clock="seconds".
function initClocks() {
  $$('[data-clock]').forEach((el) => {
    const secs = el.dataset.clock === 'seconds';
    const tick = () => {
      el.textContent = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', ...(secs && { second: '2-digit' }) });
    };
    tick();
    setInterval(tick, secs ? 1000 : 15000);
  });
}

// Any button with data-print opens the browser's print dialog (the docs page prints to A4).
function initPrint() {
  $$('[data-print]').forEach((b) => b.addEventListener('click', () => window.print()));
}

function initHandoff() {
  // Delegated: the track page re-renders its panels while polling.
  document.addEventListener('submit', (e) => {
    if (!e.target.matches('form[data-handoff-go]')) return;
    try { sessionStorage.setItem('rl-role-flip', '1'); } catch (err) { /* ignore */ }
  });

  const card = $('[data-handoff]');
  if (card) {
    const close = () => {
      card.classList.add('is-leaving');
      setTimeout(() => card.remove(), reducedMotion ? 0 : 300);
    };
    $$('[data-handoff-close]', card).forEach((b) => b.addEventListener('click', close));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && card.isConnected && !$('dialog[open]')) close();
    });
    // Enter continues the relay; the card itself is the next thing to do.
    setTimeout(() => $('.handoff-go button', card)?.focus({ preventScroll: true }), reducedMotion ? 0 : 500);
  }

  $('.job--focus')?.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
}

// Shared confirmation modal for buttons with data-confirm.
function confirmDialog(title, text) {
  const dlg = $('#confirm-modal');
  if (!dlg || typeof dlg.showModal !== 'function') {
    return Promise.resolve(window.confirm(`${title}\n\n${text || ''}`));
  }
  $('[data-confirm-title]', dlg).textContent = title;
  $('[data-confirm-text]', dlg).textContent = text || '';
  dlg.returnValue = '';
  dlg.showModal();
  $('[data-confirm-ok]', dlg).focus();
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
  });
}

function initConfirm() {
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-confirm]');
    if (!btn || btn.dataset.confirmed) return;
    e.preventDefault();
    const ok = await confirmDialog(btn.dataset.confirm, btn.dataset.confirmText);
    if (!ok) return;
    btn.dataset.confirmed = '1';
    btn.form.requestSubmit(btn);
    delete btn.dataset.confirmed;
  });
}

// Double-click guard: a form with data-once submits only once.
function initOnce() {
  $$('form[data-once]:not([data-stamp-form])').forEach((form) => {
    form.addEventListener('submit', (e) => {
      if (form.dataset.sent) return e.preventDefault();
      form.dataset.sent = '1';
      const buttons = $$('button[type="submit"], button:not([type])', form);
      buttons.forEach((b) => b.classList.add('is-sending'));
      // disable after the browser has captured the submitter's value
      setTimeout(() => buttons.forEach((b) => { b.disabled = true; }), 0);
    });
  });
  // back/forward cache: re-enable
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    $$('form[data-sent]').forEach((f) => {
      delete f.dataset.sent;
      $$('button', f).forEach((b) => { b.disabled = false; b.classList.remove('is-sending'); });
    });
  });
}

function initCommentCounter() {
  $$('[data-counter]').forEach((ta) => {
    const now = ta.parentElement.querySelector('[data-count-now]');
    const counter = now?.closest('.counter');
    const max = parseInt(ta.getAttribute('maxlength'), 10) || 300;
    const update = () => {
      now.textContent = ta.value.length;
      counter.classList.toggle('is-near', ta.value.length > max * 0.9);
    };
    ta.addEventListener('input', update);
    update();
  });
}

const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const PHOTO_MAX = 3 * 1024 * 1024;

function initDropzone() {
  $$('[data-drop]').forEach((zone) => {
    const input = $('input[type="file"]', zone);
    const img = $('.drop__preview', zone);
    const err = $('.drop__error', zone);
    ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, () => zone.classList.add('is-over')));
    ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, () => zone.classList.remove('is-over')));

    input.addEventListener('change', () => {
      const file = input.files[0];
      err.hidden = true;
      img.hidden = true;
      zone.classList.remove('has-file');
      if (!file) return;
      // Same rules as the server, checked early so people don't wait for an upload to fail.
      let problem = '';
      if (!PHOTO_TYPES.includes(file.type)) problem = 'Photos must be PNG, JPG or WEBP.';
      else if (file.size > PHOTO_MAX) problem = `That photo is ${(file.size / 1048576).toFixed(1)} MB. The limit is 3 MB.`;
      if (problem) {
        err.textContent = problem;
        err.hidden = false;
        input.value = '';
        return;
      }
      img.src = URL.createObjectURL(file);
      img.hidden = false;
      zone.classList.add('has-file');
    });
  });
}

// ---------------------------------------------------------------- landing

function splitWords(el) {
  const words = [];
  const walk = (node) => {
    Array.from(node.childNodes).forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const frag = document.createDocumentFragment();
        child.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) return frag.appendChild(document.createTextNode(' '));
          const w = document.createElement('span');
          w.className = 'word';
          const inner = document.createElement('span');
          inner.className = 'word__in';
          inner.textContent = part;
          w.appendChild(inner);
          frag.appendChild(w);
          words.push(inner);
        });
        child.replaceWith(frag);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        walk(child);
      }
    });
  };
  walk(el);
  return words;
}

// Map flow-section scroll progress (0..1) to a step (0..4).
const flowStep = (p) => Math.min(4, Math.floor(p * 5));

async function initLanding() {
  const gsap = window.gsap;
  const ST = window.ScrollTrigger;
  const nav = $('.nav');
  const onScroll = () => nav.classList.toggle('is-scrolled', window.scrollY > 40);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // 1. headline: per-word masked reveal
  const title = $('[data-split]');
  const words = splitWords(title);
  if (gsap && !reducedMotion) {
    const tl = gsap.timeline({ delay: 0.15 });
    tl.from(words, { yPercent: 115, rotate: 4, duration: 1.05, ease: 'power4.out', stagger: 0.07 })
      .from('.hero__tag', { autoAlpha: 0, y: 12, duration: 0.6 }, 0.1)
      .from('.hero__foot > *', { autoAlpha: 0, y: 24, duration: 0.8, ease: 'power3.out', stagger: 0.1 }, 0.55)
      .from('.hero__meta, .scroll-cue', { autoAlpha: 0, duration: 0.8 }, 0.9)
      // the maker's stamp slams down; clearProps hands its transform back to CSS for the hover
      .from('.maker__stamp', { autoAlpha: 0, scale: 1.9, rotate: -40, duration: 0.55, ease: 'back.out(2.2)', clearProps: 'all' }, 1.0)
      .from('.maker__sig', { autoAlpha: 0, x: -16, duration: 0.6, ease: 'power3.out', clearProps: 'all' }, 1.3);
  }
  document.documentElement.classList.remove('hero-wait');

  // 2. the 3D loop (one renderer shared by hero + flow sections)
  const stageEl = $('[data-loop-stage]');
  const host = $('[data-canvas-host]', stageEl);
  let scene = null;
  try {
    const { initHero } = await import('./scenes/hero.js');
    scene = await initHero(host);
  } catch (e) {
    console.error('3D loop unavailable, showing the static version.', e);
    scene = null;
  }
  if (!scene) stageEl.classList.add('no-webgl');

  // step text for the flow section
  const steps = $$('[data-flow-step]');
  const dots = $$('[data-flow-dot]');
  let current = 0;
  function showStep(i) {
    if (i === current) return;
    const prev = steps[current];
    const next = steps[i];
    const dir = i > current ? 1 : -1;
    current = i;
    dots.forEach((d, k) => {
      d.classList.toggle('is-active', k === i);
      d.classList.toggle('is-past', k < i);
    });
    if (gsap && !reducedMotion) {
      gsap.killTweensOf([prev, next]);
      gsap.to(prev, { autoAlpha: 0, y: -28 * dir, duration: 0.3, ease: 'power2.in', onComplete: () => prev.classList.remove('is-active') });
      next.classList.add('is-active');
      gsap.fromTo(next, { autoAlpha: 0, y: 36 * dir }, { autoAlpha: 1, y: 0, duration: 0.55, ease: 'power3.out', delay: 0.12 });
      gsap.fromTo($('.flow-step__num', next), { xPercent: -12 }, { xPercent: 0, duration: 0.8, ease: 'power3.out' });
    } else {
      prev.classList.remove('is-active');
      next.classList.add('is-active');
    }
  }

  const hero = $('.hero');
  const flows = $('[data-flows]');
  if (gsap && ST) {
    gsap.registerPlugin(ST);
    ST.create({
      trigger: hero, start: 'top top', end: 'bottom top', scrub: true,
      onUpdate: (self) => scene && scene.setHeroProgress(self.progress),
    });
    ST.create({
      trigger: flows, start: 'top top', end: 'bottom bottom', scrub: true,
      onUpdate: (self) => {
        scene && scene.setFlowProgress(self.progress);
        showStep(flowStep(self.progress));
      },
    });
  } else {
    // No GSAP: work the same progress values out by hand.
    document.documentElement.classList.add('no-gsap');
    const update = () => {
      const h = hero.getBoundingClientRect();
      const f = flows.getBoundingClientRect();
      const heroP = Math.min(1, Math.max(0, -h.top / h.height));
      const flowP = Math.min(1, Math.max(0, -f.top / (f.height - innerHeight)));
      scene && scene.setHeroProgress(heroP);
      scene && scene.setFlowProgress(flowP);
      showStep(flowStep(flowP));
    };
    window.addEventListener('scroll', update, { passive: true });
    update();
  }

  // 3. stamps slam in with a shake and a spark burst
  const fates = $('[data-fates]');
  const burstCanvas = $('.fates__burst', fates);
  const inks = { a: '#2F7D4F', b: '#D99A1E', c: '#B3392B' };
  if (!reducedMotion && 'IntersectionObserver' in window) {
    const stamps = $$('[data-fate-stamp]', fates);
    stamps.forEach((s) => s.classList.add('is-waiting'));
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        io.unobserve(entry.target);
        const stamp = entry.target;
        const kind = stamp.closest('[data-fate]').dataset.fate;
        stamp.classList.remove('is-waiting');
        const final = getComputedStyle(stamp).transform;
        const anim = stamp.animate([
          { transform: 'scale(2.2) rotate(-18deg)', opacity: 0 },
          { transform: 'scale(2.2) rotate(-18deg)', opacity: 1, offset: 0.1 },
          { transform: final, opacity: 1 },
        ], { duration: 340, easing: 'cubic-bezier(.55, 0, 1, .45)' });
        anim.onfinish = () => {
          fates.classList.add('is-shaking');
          setTimeout(() => fates.classList.remove('is-shaking'), 200);
          const r = stamp.getBoundingClientRect();
          const c = burstCanvas.getBoundingClientRect();
          burst(burstCanvas, r.left - c.left + r.width / 2, r.top - c.top + r.height / 2, inks[kind], { count: 40 });
        };
      });
    }, { threshold: 0.6 });
    stamps.forEach((s) => io.observe(s));
  }
}

// ---------------------------------------------------------------- track page

const TONE = {
  Requested: 'ink', 'Pickup Scheduled': 'ink', 'Picked Up': 'ink', Received: 'ink',
  Inspected: 'b', Refurbishing: 'b', 'Re-inspection': 'b',
  Restocked: 'a', Refunded: 'a', Closed: 'a', Scrapped: 'c', Rejected: 'c', Cancelled: 'c',
};

async function initTrackPage() {
  const stageEl = $('[data-track]');
  if (!stageEl) return;
  let step = parseInt(stageEl.dataset.step, 10) || 0;
  let status = stageEl.dataset.status;
  let terminal = stageEl.dataset.terminal === 'true';
  stageEl.style.setProperty('--step', step);

  const labels = $$('.stepper__step .mono', stageEl).map((el) => el.textContent.trim());
  let scene = null;
  try {
    const { initTrack } = await import('./scenes/track.js');
    scene = await initTrack($('[data-canvas-host]', stageEl), { step, terminal, labels });
  } catch (e) {
    console.error('3D track unavailable, showing the static version.', e);
    scene = null;
  }
  if (scene) stageEl.classList.add('has-webgl');

  function paintStepper() {
    stageEl.style.setProperty('--step', step);
    stageEl.dataset.terminal = terminal;
    $$('.stepper__step', stageEl).forEach((li, i) => {
      li.classList.toggle('is-done', i < step);
      li.classList.toggle('is-now', i === step);
    });
  }

  async function refreshPanels() {
    const ids = ['#refund', '#timeline'];
    ids.forEach((id) => $(id)?.classList.add('is-loading'));
    try {
      const html = await (await fetch(location.href, { headers: { 'X-Requested-With': 'fetch' } })).text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      ids.forEach((id) => {
        const fresh = $(id, doc);
        if (fresh && $(id)) $(id).innerHTML = fresh.innerHTML;
        $(id)?.classList.remove('is-loading');
      });
      const nextNew = $('.track-grid > .panel', doc);
      const nextOld = $('.track-grid > .panel');
      if (nextNew && nextOld) nextOld.innerHTML = nextNew.innerHTML;
      initCounters($('#refund'));
    } catch (e) {
      ids.forEach((id) => $(id)?.classList.remove('is-loading'));
    }
  }

  async function poll() {
    try {
      const res = await fetch(stageEl.dataset.api, { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      const data = await res.json();
      if (data.status !== status) {
        status = data.status;
        step = data.step;
        terminal = data.terminal;
        scene && scene.setStep(step, terminal);
        paintStepper();
        const badge = $('.track-head [data-status-badge]');
        if (badge) {
          badge.textContent = status;
          badge.className = `badge badge--${TONE[status] || 'ink'}`;
        }
        const upd = $('[data-updated]');
        if (upd) upd.textContent = 'Updated just now';
        toast(`Status changed: ${status}`, 'info');
        refreshPanels();
      }
      if (terminal) clearInterval(timer);
    } catch (e) { /* offline for a moment: try again next tick */ }
  }
  const timer = setInterval(poll, 5000);
}

// ---------------------------------------------------------------- inventory

async function initInventory() {
  const section = $('[data-crates]');
  if (!section) return;
  let counts = {};
  try { counts = JSON.parse(section.dataset.counts); } catch (e) { /* ignore */ }
  try {
    const { initCrates } = await import('./scenes/crates.js');
    const stage = await initCrates($('[data-canvas-host]', section), {
      counts, tip: $('[data-crate-tip]', section), labels: $$('.crates__bar', section),
    });
    if (stage) section.classList.add('has-webgl');
  } catch (e) {
    console.error('3D crates unavailable, showing the static bars.', e);
  }
}

// ---------------------------------------------------------------- admin charts

function initCharts() {
  const Chart = window.Chart;
  const canvases = $$('canvas[data-chart]');
  if (!Chart) {
    canvases.forEach((c) => {
      c.parentElement.querySelector('[data-skeleton]')?.remove();
      const labels = JSON.parse(c.dataset.labels);
      const values = JSON.parse(c.dataset.values);
      const list = document.createElement('ul');
      list.className = 'legend mono';
      labels.forEach((l, i) => { const li = document.createElement('li'); li.textContent = `${l}: ${values[i]}`; list.appendChild(li); });
      c.replaceWith(list);
    });
    return;
  }
  Chart.defaults.font.family = '"DM Mono", ui-monospace, monospace';
  Chart.defaults.font.size = 12;

  // Chart colours come from the theme tokens, so they work in light and dark.
  const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const charts = [];
  function paint(chart) {
    const ink = token('--ink');
    Chart.defaults.color = token('--muted');
    if (chart.config.type === 'bar') {
      const ds = chart.data.datasets[0];
      ds.backgroundColor = ['#FF5B1F', ink, token('--kraft-dk'), token('--steel')];
      ds.borderColor = ink;
      chart.options.scales.x.border.color = ink;
      chart.options.scales.y.grid.color = token('--line');
      chart.options.scales.x.ticks.color = chart.options.scales.y.ticks.color = token('--muted');
    } else {
      chart.data.datasets[0].borderColor = token('--paper-hi');
    }
  }
  document.addEventListener('rl:theme', () => charts.forEach((ch) => { paint(ch); ch.update('none'); }));

  const build = (c) => {
    const labels = JSON.parse(c.dataset.labels);
    const values = JSON.parse(c.dataset.values);
    const anim = reducedMotion ? false : { duration: 1100, easing: 'easeOutQuart' };
    let chart;
    if (c.dataset.chart === 'bar') {
      chart = new Chart(c, {
        type: 'bar',
        data: { labels, datasets: [{ data: values, borderWidth: 1.5, borderSkipped: false, maxBarThickness: 64 }] },
        options: {
          maintainAspectRatio: false, animation: anim, indexAxis: 'x',
          plugins: { legend: { display: false }, tooltip: { backgroundColor: '#14110F', titleFont: { family: 'Instrument Sans' } } },
          scales: {
            x: { grid: { display: false }, border: { width: 1.5 }, ticks: {} },
            y: { beginAtZero: true, ticks: { precision: 0 }, grid: {}, border: { display: false } },
          },
        },
      });
    } else {
      chart = new Chart(c, {
        type: 'doughnut',
        data: { labels: labels.map((l) => `Grade ${l}`), datasets: [{ data: values, backgroundColor: ['#2F7D4F', '#D99A1E', '#B3392B'], borderWidth: 3 }] },
        options: {
          maintainAspectRatio: false, cutout: '62%', animation: reducedMotion ? false : { animateRotate: true, duration: 1200 },
          plugins: { legend: { display: false }, tooltip: { backgroundColor: '#14110F' } },
        },
      });
    }
    paint(chart);
    chart.update();
    charts.push(chart);
    const sk = c.parentElement.querySelector('[data-skeleton]');
    if (sk) { sk.classList.add('is-gone'); setTimeout(() => sk.remove(), 400); }
  };

  // animate on view
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      build(e.target);
    });
  }, { threshold: 0.3 });
  canvases.forEach((c) => io.observe(c));
}

// ---------------------------------------------------------------- QC inspect

function suggestGrade(packaging, tags, damage) {
  // mirrors services/returns.py suggest_grade()
  if (damage && !packaging) return 'C';
  if (damage || !packaging || !tags) return 'B';
  return 'A';
}

function initInspect() {
  const form = $('[data-stamp-form]');
  if (!form) return;
  const recheck = form.dataset.recheck === 'true';
  const wrongItemClaim = form.dataset.wrongItem === 'true';
  const box = (k) => $(`[data-check="${k}"]`, form);
  const fraudNote = $('[data-fraud-note]', form);
  const suggestedEl = $('[data-suggested]', form);
  let picked = false;

  $$('input[name="grade"]', form).forEach((r) => r.addEventListener('change', (e) => { if (e.isTrusted) picked = true; }));

  const isFraud = () => !recheck && !wrongItemClaim && !box('item_matches_order').checked;

  function update() {
    fraudNote.hidden = !isFraud();
    if (recheck) return;
    const g = suggestGrade(box('packaging_intact').checked, box('tags_attached').checked, box('visible_damage').checked);
    suggestedEl.textContent = g;
    if (!picked) {
      const radio = $(`input[name="grade"][value="${g}"]`, form);
      if (radio) radio.checked = true;
    }
  }
  $$('[data-check]', form).forEach((c) => c.addEventListener('change', update));
  update();

  let sending = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (sending) return;
    const grade = $('input[name="grade"]:checked', form)?.value;
    if (!grade && !isFraud()) return;
    if (isFraud()) {
      const ok = await confirmDialog('Reject as suspected fraud?', 'The item does not match the order. The return will be rejected, no refund is issued, and it is flagged for the admin.');
      if (!ok) return;
    }
    sending = true;
    $$('button', form).forEach((b) => b.classList.add('is-sending'));
    await playStamp($('[data-stamp-overlay]'), isFraud() ? 'REJECTED' : grade, {
      sub: isFraud() ? 'SUSPECTED FRAUD' : recheck ? (grade === 'B' ? 'REPAIR PASSED' : 'REPAIR FAILED') : 'GRADE',
    });
    form.submit();
  });
}

// ---------------------------------------------------------------- team page

// Departure-board effect: letters flicker through random glyphs, then lock in left to right.
function scramble(el) {
  const final = el.dataset.text || el.textContent;
  el.dataset.text = final;
  if (reducedMotion) return;
  const glyphs = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#/+';
  const start = performance.now();
  const dur = 700 + final.length * 60;
  (function tick(now) {
    const p = Math.min(1, (now - start) / dur);
    const locked = Math.floor(p * final.length);
    el.textContent = final.split('').map((ch, i) => (i < locked || ch === ' ' ? ch
      : glyphs[Math.floor(Math.random() * glyphs.length)])).join('');
    if (p < 1) requestAnimationFrame(tick);
    else el.textContent = final;
  })(start);
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

async function initTeamPage() {
  const flow = $('[data-team]');
  if (!flow) return;
  const nav = $('.nav');
  const onNav = () => nav.classList.toggle('is-scrolled', window.scrollY > 40);
  window.addEventListener('scroll', onNav, { passive: true });
  onNav();

  // headline words rise in one after another
  $$('[data-split]', flow).forEach((el) => splitWords(el).forEach((w, i) => w.style.setProperty('--w', i)));

  const words = JSON.parse(flow.dataset.words || '[]');
  const accents = JSON.parse(flow.dataset.accents || '[]');
  let scene = null;
  try {
    const { initTeam } = await import('./scenes/team.js');
    scene = await initTeam($('.team-stage [data-canvas-host]'), { words, accents });
  } catch (e) {
    console.error('3D crew scene unavailable, showing the static version.', e);
  }
  if (!scene) flow.classList.add('no-webgl');

  // Scroll -> which shape the particles form. Each section holds its shape,
  // then morphs into the next one during the last part of its scroll.
  const sections = $$('[data-team-sec]', flow);
  const mobile = matchMedia('(max-width: 760px)').matches;
  // where each shape sits: [sideways, up]. The intro knot moves right of the headline on desktop.
  const last = sections.length - 1;
  const spots = sections.map((s, i) => (i === 0 ? (mobile ? [0, 1.9] : [3.6, 0.6])
    : i === last ? [0, mobile ? 1.8 : 2.1] : [0, mobile ? 1.8 : 2.3]));
  let queued = false;
  function update() {
    queued = false;
    if (!scene) return;
    let i = 0;
    sections.forEach((sec, k) => { if (sec.getBoundingClientRect().top <= 1) i = k; });
    const r = sections[i].getBoundingClientRect();
    const p = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height - innerHeight)));
    const t = i < sections.length - 1 ? smooth(0.62, 1, p) : 0;
    const next = Math.min(i + 1, sections.length - 1);
    const mix = (k) => spots[i][k] + (spots[next][k] - spots[i][k]) * t;
    scene.setMorph(i + t, mix(1), mix(0));
  }
  window.addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
  window.addEventListener('resize', update);
  update();

  // manifest cards fly in, and the names scramble into place
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      e.target.classList.add('is-in');
      $$('[data-scramble]', e.target).forEach((el, k) => setTimeout(() => scramble(el), 200 + k * 180));
    });
  }, { threshold: 0.3 });
  $$('[data-reveal]', flow).forEach((el) => io.observe(el));

  // stamps: ink burst, particles explode, phone buzzes
  const burstCanvas = $('.team-burst');
  const inks = { a: '#3FA866', b: '#F0B03A', c: '#E0533F', d: '#FF7A3D' };
  $$('[data-stamp-burst]', flow).forEach((btn) => {
    btn.addEventListener('click', () => {
      const r = btn.getBoundingClientRect();
      const kind = (btn.className.match(/stamp--([a-d])/) || [])[1];
      burst(burstCanvas, r.left + r.width / 2, r.top + r.height / 2, inks[kind] || '#FF5B1F', { count: 80, power: 1.5 });
      scene && scene.scatter();
      if (navigator.vibrate) navigator.vibrate(30);
      const card = btn.closest('.manifest');
      card.classList.add('is-shaking');
      setTimeout(() => card.classList.remove('is-shaking'), 200);
    });
  });

  // click anywhere that isn't a control: shake the particles loose
  flow.addEventListener('click', (e) => {
    if (e.target.closest('a, button, .manifest')) return;
    scene && scene.scatter();
    burst(burstCanvas, e.clientX, e.clientY, '#FF5B1F', { count: 36 });
  });
}

// ---------------------------------------------------------------- presentation (/ppt)

const pad2 = (n) => String(n).padStart(2, '0');

async function initDeck() {
  const deck = $('[data-deck]');
  if (!deck) return;
  const stage = $('[data-deck-stage]', deck);
  const canvas = $('[data-deck-canvas]', deck);
  const slides = $$('[data-slide]', deck);
  const count = $('[data-deck-count]', deck);
  const bar = $('[data-deck-progress]', deck);
  slides.forEach((s, i) => {
    const n = $('[data-slide-no]', s);
    if (n) n.textContent = `${pad2(i + 1)} / ${pad2(slides.length)}`;
  });

  // Slides are designed at 1280x720 and scaled to whatever space there is.
  function fit() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    const scale = Math.min(w / 1280, h / 720);
    canvas.style.setProperty('--s', scale);
    stage.style.setProperty('--ox', `${(w - 1280 * scale) / 2}px`);
    stage.style.setProperty('--oy', `${(h - 720 * scale) / 2}px`);
  }
  new ResizeObserver(fit).observe(stage);
  fit();

  let current = 0;
  function go(i) {
    current = Math.max(0, Math.min(slides.length - 1, i));
    slides.forEach((s, k) => {
      s.classList.toggle('is-active', k === current);
      s.classList.toggle('is-before', k < current);
      s.setAttribute('aria-hidden', k === current ? 'false' : 'true');
    });
    count.textContent = `${pad2(current + 1)} / ${pad2(slides.length)}`;
    bar.style.width = `${((current + 1) / slides.length) * 100}%`;
    try { history.replaceState(null, '', `#${current + 1}`); } catch (e) { /* ignore */ }
  }
  go((parseInt(location.hash.slice(1), 10) || 1) - 1);

  $('[data-deck-next]', deck).addEventListener('click', () => go(current + 1));
  $('[data-deck-prev]', deck).addEventListener('click', () => go(current - 1));
  $$('[data-goto]', deck).forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    go(parseInt(a.dataset.goto, 10) - 1);
  }));

  const present = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (stage.requestFullscreen) stage.requestFullscreen().catch(() => {});
  };
  $('[data-deck-present]').addEventListener('click', present);
  $('[data-deck-print]').addEventListener('click', () => window.print());
  document.addEventListener('fullscreenchange', fit);

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select') || e.altKey || e.ctrlKey || e.metaKey) return;
    if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); go(current + 1); }
    else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); go(current - 1); }
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(slides.length - 1);
    else if (e.key === 'f' || e.key === 'F') present();
  });

  // click the slide to advance; swipe on touch screens
  let downX = null;
  stage.addEventListener('pointerdown', (e) => { downX = e.clientX; });
  stage.addEventListener('pointerup', (e) => {
    if (downX === null || e.target.closest('a, button')) return;
    const dx = e.clientX - downX;
    downX = null;
    if (Math.abs(dx) > 50) go(current + (dx < 0 ? 1 : -1));
    else if (e.pointerType === 'mouse') go(current + 1);
  });

  // Diagrams are written as Mermaid text in the page and drawn here, in the app's colours.
  try {
    const { default: mermaid } = await import('https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.esm.min.mjs');
    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      securityLevel: 'strict',
      fontFamily: '"Instrument Sans", system-ui, sans-serif',
      themeVariables: {
        fontFamily: '"Instrument Sans", system-ui, sans-serif',
        fontSize: '15px',
        primaryColor: '#FFFCF5', primaryTextColor: '#14110F', primaryBorderColor: '#14110F',
        secondaryColor: '#E9DFCB', tertiaryColor: '#F6F1E7', lineColor: '#14110F',
        edgeLabelBackground: '#F6F1E7', clusterBkg: '#F6F1E7',
        actorBkg: '#14110F', actorTextColor: '#F6F1E7', actorBorder: '#14110F', actorLineColor: '#6B6A66',
        signalColor: '#14110F', signalTextColor: '#14110F', labelBoxBkgColor: '#FF5B1F',
        noteBkgColor: '#FFE6DA', noteBorderColor: '#C2410C', activationBkgColor: '#E9DFCB',
        sequenceNumberColor: '#F6F1E7',
      },
      flowchart: { curve: 'basis', padding: 10, nodeSpacing: 34, rankSpacing: 46 },
      sequence: { mirrorActors: false, actorMargin: 34, messageMargin: 26, boxMargin: 6 },
    });
    // Measure text at full size: the slides are scaled down, which would make every box too small.
    canvas.style.setProperty('--s', 1);
    try {
      await mermaid.run({ querySelector: '.deck pre.mermaid' });
      // Mermaid gives every sequence diagram the same marker ids ("sequencenumber",
      // "arrowhead"...). A later diagram's url(#id) then finds the first one, which sits on
      // a hidden slide and doesn't draw. Give each diagram's markers ids of its own.
      $$('.deck pre.mermaid svg').forEach((svg, i) => {
        $$('marker[id]', svg).forEach((marker) => {
          const old = marker.id;
          marker.id = `${old}-d${i}`;
          $$('[marker-start], [marker-end], [marker-mid]', svg).forEach((el) => {
            ['marker-start', 'marker-end', 'marker-mid'].forEach((attr) => {
              const v = el.getAttribute(attr);
              if (v && v.includes(`#${old})`)) el.setAttribute(attr, v.replace(`#${old})`, `#${marker.id})`));
            });
          });
        });
      });
    } finally {
      fit();
    }
  } catch (e) {
    console.error('Diagrams could not be drawn; showing their text instead.', e);
  }
}

// ---------------------------------------------------------------- maker page

async function initMakerPage() {
  const host = $('[data-maker-bot]');
  if (!host) return;
  let bot = null;
  try {
    const { initBoxbot } = await import('./scenes/boxbot.js');
    bot = await initBoxbot(host, { initials: host.dataset.initials });
  } catch (e) {
    console.error('3D parcel character unavailable.', e);
  }
  if (!bot) host.closest('.maker-bot').classList.add('no-webgl');
}

// ---------------------------------------------------------------- boot

initTransitions();
initStagger();
initToasts();
initThemeToggle();
initSwitcher();
initHandoff();
initPrint();
initClocks();
initConfirm();
initOnce();
initCommentCounter();
initDropzone();
initCursor();
initTilt();
initMagnetic();
initCounters();

const page = document.body.dataset.page;
if (page === 'landing') initLanding();
if (page === 'track') initTrackPage();
if (page === 'inventory') initInventory();
if (page === 'admin') initCharts();
if (page === 'inspect') initInspect();
if (page === 'team') initTeamPage();
if (page === 'deck') initDeck();
if (page === 'maker') initMakerPage();
