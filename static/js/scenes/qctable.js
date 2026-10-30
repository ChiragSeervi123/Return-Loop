// QC inspect page: the returned parcel on an inspection table under a lamp.
// Every side is printed (label, arrows, fragile, barcode, the customer's note, recycling
// mark). Drag it, or press a side button, to turn it; the readout names the side facing
// you. The checklist changes the box: broken packaging tears the tape, visible damage
// dents the front, the swing tag hangs only while tags are attached, and an item that
// doesn't match gets a red stamp on its label.
import {
  barcode, createStage, dotTexture, kraftBase, reducedMotion,
} from '../lib/webgl.js';

const SIZE = [2.0, 1.3, 1.6];          // width (x), height (y), depth (z)
const PX = 300;                        // canvas pixels per unit, so faces don't stretch
const ORANGE = '#FF5B1F', INK = '#14110F', RED = '#B3392B';

// Where to turn the parcel so a side faces the camera (which looks down ~25°).
const SIDES = {
  front: { x: -0.3, y: 0 },
  right: { x: -0.3, y: -Math.PI / 2 },
  back: { x: -0.3, y: Math.PI },
  left: { x: -0.3, y: Math.PI / 2 },
  top: { x: 0.95, y: 0 },
  bottom: { x: -2.0, y: 0 },
};
// BoxGeometry face order: +x, -x, +y, -y, +z, -z
const FACE_NAMES = ['right', 'left', 'top', 'bottom', 'front', 'back'];
const NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// ---------------------------------------------------------------- drawing helpers

function wrap(ctx, text, x, y, maxW, lineH, maxLines = 4) {
  const words = String(text).split(/\s+/);
  let line = '', n = 0;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y + n * lineH);
      line = w;
      if (++n >= maxLines - 1) { line = `${line}…`; break; }
    } else line = test;
  }
  ctx.fillText(line, x, y + n * lineH);
}

function edges(ctx, w, h) {
  ctx.strokeStyle = 'rgba(20,17,15,.28)';
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
}

function upArrow(ctx, x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + s * 0.5, y + s * 0.55);
  ctx.lineTo(x + s * 0.2, y + s * 0.55);
  ctx.lineTo(x + s * 0.2, y + s);
  ctx.lineTo(x - s * 0.2, y + s);
  ctx.lineTo(x - s * 0.2, y + s * 0.55);
  ctx.lineTo(x - s * 0.5, y + s * 0.55);
  ctx.closePath();
  ctx.fill();
}

function stamp(ctx, text, x, y, color, angle = -0.18, size = 46) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.font = `800 ${size}px "Bricolage Grotesque", "Arial Black", sans-serif`;
  const w = ctx.measureText(text).width + size * 0.7;
  ctx.globalAlpha = 0.88;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = size * 0.11;
  ctx.strokeRect(-w / 2, -size * 0.72, w, size * 1.3);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

// ---------------------------------------------------------------- the six sides

function drawFront(ctx, w, h, d, st) {
  kraftBase(ctx, w, h, '#CDB58A');
  ctx.fillStyle = 'rgba(233, 214, 170, .85)';
  ctx.fillRect(w / 2 - 36, 0, 72, h * 0.32);          // tape running down from the top
  ctx.fillStyle = 'rgba(20,17,15,.78)';
  upArrow(ctx, 60, 34, 58);
  upArrow(ctx, 112, 34, 58);
  ctx.font = '500 17px "DM Mono", monospace';
  ctx.fillText('THIS WAY UP', 40, 120);
  // printed logo, a little faded like ink on cardboard
  ctx.globalAlpha = 0.72;
  ctx.font = '800 64px "Bricolage Grotesque", "Arial Black", sans-serif';
  ctx.fillStyle = INK;
  ctx.font = '800 56px "Bricolage Grotesque", "Arial Black", sans-serif';
  ctx.fillText('Return', 40, h * 0.68);
  ctx.fillStyle = ORANGE;
  ctx.fillText('Loop', 40 + ctx.measureText('Return').width, h * 0.68);
  ctx.globalAlpha = 1;
  ctx.fillStyle = INK;
  ctx.font = '500 18px "DM Mono", monospace';
  ctx.fillText(`RETURN · ${d.reason.toUpperCase()}`, 42, h * 0.68 + 36);
  if (st.damage) {
    // crushed corner: shading, creases and a split
    const g = ctx.createRadialGradient(w * 0.78, h * 0.3, 10, w * 0.78, h * 0.3, 150);
    g.addColorStop(0, 'rgba(70,45,15,.55)');
    g.addColorStop(1, 'rgba(70,45,15,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(40,25,10,.8)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(w * 0.62, h * 0.08);
    ctx.lineTo(w * 0.7, h * 0.22);
    ctx.lineTo(w * 0.66, h * 0.31);
    ctx.lineTo(w * 0.79, h * 0.42);
    ctx.lineTo(w * 0.76, h * 0.52);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,245,225,.5)';
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(w * (0.7 + i * 0.04), h * 0.12);
      ctx.lineTo(w * (0.84 + i * 0.03), h * (0.34 + i * 0.03));
      ctx.stroke();
    }
    stamp(ctx, 'DAMAGED', w * 0.62, h * 0.86, RED, -0.12, 30);
  }
  edges(ctx, w, h);
}

function drawTop(ctx, w, h, d, st) {
  kraftBase(ctx, w, h, '#D8C29C');
  // the two flaps meet across the middle; tape seals the seam
  ctx.fillStyle = 'rgba(20,17,15,.18)';
  ctx.fillRect(0, h / 2 - 2, w, 4);
  if (st.intact) {
    ctx.fillStyle = 'rgba(233, 214, 170, .92)';
    ctx.fillRect(0, h / 2 - 34, w, 68);
    ctx.fillStyle = 'rgba(255,255,255,.28)';
    ctx.fillRect(0, h / 2 - 30, w, 6);
  } else {
    // tape torn: a ragged gap and a lifted flap
    ctx.fillStyle = 'rgba(233, 214, 170, .92)';
    for (const [x0, x1] of [[0, w * 0.34], [w * 0.62, w]]) {
      ctx.beginPath();
      ctx.moveTo(x0, h / 2 - 34);
      ctx.lineTo(x1, h / 2 - 34);
      for (let y = h / 2 - 34; y <= h / 2 + 34; y += 8) ctx.lineTo(x1 + (x0 === 0 ? 1 : -1) * (Math.random() * 14), y);
      ctx.lineTo(x0, h / 2 + 34);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(20,17,15,.55)';
    ctx.fillRect(w * 0.34, h / 2 - 5, w * 0.28, 10);
    stamp(ctx, 'OPENED', w * 0.48, h * 0.86, RED, 0.06, 30);
  }
  // shipping label
  const lx = 40, ly = 22, lw = w * 0.68, lh = h * 0.5 - 52;
  ctx.save();
  ctx.translate(lx, ly);
  ctx.rotate(-0.025);
  ctx.fillStyle = '#FBF8F1';
  ctx.fillRect(0, 0, lw, lh);
  ctx.fillStyle = ORANGE;
  ctx.fillRect(0, 0, lw, 30);
  ctx.fillStyle = INK;
  ctx.font = '500 15px "DM Mono", monospace';
  ctx.fillText('RETURNLOOP · RETURN', 12, 21);
  ctx.textAlign = 'right';
  ctx.fillText(d.code, lw - 12, 21);
  ctx.textAlign = 'left';
  ctx.font = '800 38px "Bricolage Grotesque", "Arial Black", sans-serif';
  wrap(ctx, d.item, 12, 72, lw - 24, 38, 2);
  ctx.font = '500 15px "DM Mono", monospace';
  ctx.fillStyle = '#57554F';
  ctx.fillText(`FROM ${d.customer.toUpperCase()} · ${d.city.toUpperCase()}`, 12, lh - 52);
  barcode(ctx, 12, lh - 40, lw * 0.6, 28);
  ctx.restore();
  if (!st.matches) stamp(ctx, 'MISMATCH', lx + lw * 0.55, ly + lh * 0.55, RED, -0.2, 40);
  edges(ctx, w, h);
}

function drawRight(ctx, w, h, d) {
  kraftBase(ctx, w, h, '#C9AE80');
  const fragile = d.reason === 'Damaged';
  ctx.fillStyle = fragile ? RED : 'rgba(20,17,15,.78)';
  // a wine glass
  ctx.beginPath();
  ctx.moveTo(70, 40);
  ctx.lineTo(130, 40);
  ctx.quadraticCurveTo(130, 110, 104, 116);
  ctx.lineTo(104, 160);
  ctx.lineTo(126, 168);
  ctx.lineTo(74, 168);
  ctx.lineTo(96, 160);
  ctx.lineTo(96, 116);
  ctx.quadraticCurveTo(70, 110, 70, 40);
  ctx.fill();
  ctx.font = '800 54px "Bricolage Grotesque", "Arial Black", sans-serif';
  ctx.fillText(fragile ? 'FRAGILE' : 'HANDLE', 160, 104);
  ctx.font = '500 20px "DM Mono", monospace';
  ctx.fillText(fragile ? 'HANDLE WITH CARE' : 'WITH CARE', 164, 140);
  ctx.fillStyle = 'rgba(20,17,15,.7)';
  ctx.font = '500 18px "DM Mono", monospace';
  ctx.fillText(`CATEGORY · ${d.category.toUpperCase()}`, 40, h - 70);
  ctx.fillText('KEEP DRY · DO NOT STACK > 4', 40, h - 42);
  edges(ctx, w, h);
}

function drawBack(ctx, w, h, d) {
  kraftBase(ctx, w, h, '#CDB58A');
  const sw = w * 0.7, sh = h * 0.56, sx = (w - sw) / 2, sy = (h - sh) / 2;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(0.02);
  ctx.fillStyle = '#FBF8F1';
  ctx.fillRect(0, 0, sw, sh);
  barcode(ctx, 22, 20, sw - 44, sh * 0.5);
  ctx.fillStyle = INK;
  ctx.font = '500 30px "DM Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(d.code, sw / 2, sh * 0.5 + 58);
  ctx.font = '500 15px "DM Mono", monospace';
  ctx.fillStyle = '#57554F';
  ctx.fillText('SCAN AT EVERY DESK', sw / 2, sh - 16);
  ctx.restore();
  edges(ctx, w, h);
}

function drawLeft(ctx, w, h, d) {
  kraftBase(ctx, w, h, '#C9AE80');
  // the customer's note on a sticky square
  ctx.save();
  ctx.translate(w * 0.16, h * 0.14);
  ctx.rotate(-0.05);
  ctx.fillStyle = '#F7E27A';
  ctx.fillRect(0, 0, w * 0.68, h * 0.72);
  ctx.fillStyle = 'rgba(0,0,0,.06)';
  ctx.fillRect(0, 0, w * 0.68, 22);
  ctx.fillStyle = INK;
  ctx.font = '500 16px "DM Mono", monospace';
  ctx.fillText('CUSTOMER SAYS', 18, 50);
  ctx.font = 'italic 600 24px "Instrument Sans", "Segoe Print", sans-serif';
  wrap(ctx, d.comment ? `“${d.comment}”` : 'No note left.', 18, 88, w * 0.68 - 36, 30, 4);
  ctx.font = '500 15px "DM Mono", monospace';
  ctx.fillText(`— ${d.customer}`, 18, h * 0.72 - 20);
  ctx.restore();
  edges(ctx, w, h);
}

function drawBottom(ctx, w, h, d) {
  kraftBase(ctx, w, h, '#BFA272');
  ctx.strokeStyle = 'rgba(20,17,15,.7)';
  ctx.fillStyle = 'rgba(20,17,15,.7)';
  ctx.lineWidth = 9;
  // recycling loop: three arrows round a triangle
  const cx = w / 2, cy = h * 0.42, r = 70;
  for (let i = 0; i < 3; i++) {
    const a0 = (i / 3) * Math.PI * 2 - Math.PI / 2 + 0.35;
    const a1 = a0 + (Math.PI * 2) / 3 - 0.7;
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, a1);
    ctx.stroke();
    const ax = cx + Math.cos(a1) * r, ay = cy + Math.sin(a1) * r;
    ctx.beginPath();
    ctx.moveTo(ax + Math.cos(a1 + Math.PI / 2) * 18, ay + Math.sin(a1 + Math.PI / 2) * 18);
    ctx.lineTo(ax + Math.cos(a1) * 16, ay + Math.sin(a1) * 16);
    ctx.lineTo(ax - Math.cos(a1) * 16, ay - Math.sin(a1) * 16);
    ctx.fill();
  }
  ctx.textAlign = 'center';
  ctx.font = '500 20px "DM Mono", monospace';
  ctx.fillText('100% RECYCLED CARDBOARD', cx, h * 0.78);
  ctx.font = '500 16px "DM Mono", monospace';
  ctx.fillText(`PACKED FOR ${d.code}`, cx, h * 0.78 + 30);
  edges(ctx, w, h);
}

function drawTag(ctx, w, h, d) {
  kraftBase(ctx, w, h, '#EADCC0');
  ctx.fillStyle = '#FBF8F1';
  ctx.beginPath();
  ctx.arc(w / 2, 34, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,17,15,.4)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.font = '500 15px "DM Mono", monospace';
  ctx.fillText('ORIGINAL TAG', w / 2, 82);
  ctx.font = '800 22px "Bricolage Grotesque", "Arial Black", sans-serif';
  ctx.textAlign = 'left';
  wrap(ctx, d.item, 14, 116, w - 28, 24, 3);
  barcode(ctx, 14, h - 46, w - 28, 26);
}

function drawMat(ctx, w, h) {
  // a green self-healing cutting mat with a ruled grid and rulers along two edges
  ctx.fillStyle = '#23372F';
  ctx.fillRect(0, 0, w, h);
  const step = 32;
  for (let x = 0; x <= w; x += step) {
    ctx.fillStyle = (x / step) % 5 === 0 ? 'rgba(220,235,225,.35)' : 'rgba(220,235,225,.13)';
    ctx.fillRect(x, 0, (x / step) % 5 === 0 ? 2 : 1, h);
  }
  for (let y = 0; y <= h; y += step) {
    ctx.fillStyle = (y / step) % 5 === 0 ? 'rgba(220,235,225,.35)' : 'rgba(220,235,225,.13)';
    ctx.fillRect(0, y, w, (y / step) % 5 === 0 ? 2 : 1);
  }
  ctx.strokeStyle = 'rgba(220,235,225,.14)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(h, 0);
  ctx.moveTo(w - h, h);
  ctx.lineTo(w, 0);
  ctx.stroke();
  ctx.fillStyle = 'rgba(220,235,225,.55)';
  ctx.font = '500 14px "DM Mono", monospace';
  for (let x = step * 5, n = 5; x < w; x += step * 5, n += 5) ctx.fillText(String(n), x + 4, 16);
  for (let y = step * 5, n = 5; y < h; y += step * 5, n += 5) ctx.fillText(String(n), 4, y - 4);
  ctx.fillStyle = 'rgba(255,91,31,.75)';
  ctx.font = '500 16px "DM Mono", monospace';
  ctx.fillText('RETURNLOOP · QC BENCH 01', w - 270, h - 14);
}

// ---------------------------------------------------------------- scene

export async function initQcTable(host, data, { onSide } = {}) {
  const stage = await createStage(host, { camera: { fov: 32 } });
  if (!stage) return null;
  const { THREE, scene, camera, renderer } = stage;

  try {   // the labels use the display and mono fonts; wait for them briefly
    await Promise.race([
      Promise.all([document.fonts.load('800 30px "Bricolage Grotesque"'), document.fonts.load('500 15px "DM Mono"')]),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
  } catch (e) { /* system fonts are fine */ }

  const canvasTex = (w, h) => {
    const c = document.createElement('canvas');
    c.width = Math.round(w);
    c.height = Math.round(h);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return { c, ctx: c.getContext('2d'), tex };
  };

  // ---------- lights: a warm lamp over the bench ----------
  scene.add(new THREE.HemisphereLight(0xfff0dd, 0x14110f, 0.55));
  const lamp = new THREE.SpotLight(0xfff1dd, 30, 20, 0.6, 0.7, 1.4);
  lamp.position.set(1.2, 7, 3);
  scene.add(lamp, lamp.target);
  const fill = new THREE.DirectionalLight(0xfff1dd, 0.7);
  fill.position.set(-4, 3, 6);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xff5b1f, 1.6);
  rim.position.set(-5, 2, -6);
  scene.add(rim);

  // ---------- the bench and its cutting mat ----------
  const bench = new THREE.Mesh(new THREE.BoxGeometry(14, 0.4, 8),
    new THREE.MeshStandardMaterial({ color: 0x2B241E, roughness: 0.8 }));
  bench.position.y = -0.2;
  scene.add(bench);
  const matTex = canvasTex(1280, 768);
  drawMat(matTex.ctx, matTex.c.width, matTex.c.height);
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(9, 5.4),
    new THREE.MeshStandardMaterial({ map: matTex.tex, roughness: 0.9 }));
  mat.rotation.x = -Math.PI / 2;
  mat.position.y = 0.005;
  scene.add(mat);
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(6, 4.4), new THREE.MeshBasicMaterial({
    map: dotTexture(THREE), color: 0xffd9a8, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(0.3, 0.012, 0.2);
  scene.add(pool);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.8), new THREE.MeshBasicMaterial({
    map: dotTexture(THREE), color: 0x000000, transparent: true, opacity: 0.6, depthWrite: false,
  }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.015;
  scene.add(shadow);

  // ---------- the parcel: six printed sides ----------
  const [W, H, D] = SIZE;
  const faceSize = [[D, H], [D, H], [W, D], [W, D], [W, H], [W, H]];
  const faces = faceSize.map(([fw, fh]) => canvasTex(fw * PX, fh * PX));
  const draws = [drawRight, drawLeft, drawTop, drawBottom, drawFront, drawBack];
  const state = { intact: true, tags: true, damage: false, matches: true };
  function paint(only) {
    draws.forEach((draw, i) => {
      if (only && !only.includes(i)) return;
      const { c, ctx, tex } = faces[i];
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      draw(ctx, c.width, c.height, data, state);
      tex.needsUpdate = true;
    });
  }
  paint();
  const parcel = new THREE.Mesh(new THREE.BoxGeometry(W, H, D),
    faces.map((f) => new THREE.MeshStandardMaterial({ map: f.tex, roughness: 0.86 })));
  const pivot = new THREE.Group();     // turns; the parcel sits at its centre
  pivot.add(parcel);
  scene.add(pivot);
  lamp.target = pivot;

  // the swing tag, hanging from the front-right corner on a string
  const tagTex = canvasTex(150, 240);
  drawTag(tagTex.ctx, tagTex.c.width, tagTex.c.height, data);
  tagTex.tex.needsUpdate = true;
  const tag = new THREE.Group();
  const card = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.67),
    new THREE.MeshStandardMaterial({ map: tagTex.tex, roughness: 0.8, side: THREE.DoubleSide }));
  card.position.y = -0.5;
  const string = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.2, 6),
    new THREE.MeshBasicMaterial({ color: 0xF6F1E7 }));
  string.position.y = -0.08;
  tag.add(card, string);
  tag.position.set(W / 2 - 0.28, H / 2, D / 2 + 0.03);
  parcel.add(tag);

  // ---------- framing ----------
  function frame() {
    const vfov = THREE.MathUtils.degToRad(camera.fov);
    const needW = 3.5, needH = 2.75;
    const dist = Math.max(needH / (2 * Math.tan(vfov / 2)), needW / (2 * Math.tan(vfov / 2) * camera.aspect));
    const tilt = 0.44;   // ~25° above the bench
    camera.position.set(0, 0.9 + Math.sin(tilt) * dist, Math.cos(tilt) * dist);
    camera.lookAt(0, 0.85, 0);
  }
  stage.onResize = frame;
  frame();

  // ---------- turning: drag, inertia, snap to a side ----------
  const rot = { x: SIDES.front.x, y: -0.55, vx: 0, vy: 0, dragging: false, touched: false, snap: null };
  const el = renderer.domElement;
  el.style.touchAction = 'none';
  let lastX = 0, lastY = 0;
  el.addEventListener('pointerdown', (e) => {
    rot.dragging = true;
    rot.touched = true;
    rot.snap = null;
    lastX = e.clientX;
    lastY = e.clientY;
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!rot.dragging) return;
    rot.vy = (e.clientX - lastX) * 0.011;
    rot.vx = (e.clientY - lastY) * 0.009;
    rot.y += rot.vy;
    rot.x = Math.max(-2.2, Math.min(1.5, rot.x + rot.vx));
    lastX = e.clientX;
    lastY = e.clientY;
    if (reducedMotion) { place(1); stage.renderOnce(); }
  });
  const release = () => { rot.dragging = false; };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);

  const q = new THREE.Quaternion();
  const n = new THREE.Vector3();
  const toCam = new THREE.Vector3();
  const corner = new THREE.Vector3();
  let liftNow = H / 2, shownSide = '';

  // put the parcel where it should be this frame (k: how far to ease, 0..1)
  function place(k) {
    pivot.rotation.set(rot.x, rot.y, 0, 'XYZ');
    // rest on the mat whatever the turn: lift by the lowest rotated corner
    q.setFromEuler(pivot.rotation);
    let low = 0;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      corner.set((sx * W) / 2, (sy * H) / 2, (sz * D) / 2).applyQuaternion(q);
      low = Math.min(low, corner.y);
    }
    const target = -low + (rot.dragging ? 0.3 : 0.01);
    liftNow += (target - liftNow) * k;
    pivot.position.y = liftNow;
    const s = 1 - Math.min(0.5, (liftNow + low) * 0.8);
    shadow.scale.set(s, s, 1);
    shadow.material.opacity = 0.6 * s;
    // which side is facing the camera?
    toCam.copy(camera.position).sub(pivot.position).normalize();
    let best = 0, bestDot = -2;
    NORMALS.forEach((v, i) => {
      const dot = n.set(...v).applyQuaternion(q).dot(toCam);
      if (dot > bestDot) { bestDot = dot; best = i; }
    });
    if (FACE_NAMES[best] !== shownSide) {
      shownSide = FACE_NAMES[best];
      onSide && onSide(shownSide);
    }
  }

  stage.update = (dt, time) => {
    const k = reducedMotion ? 1 : 1 - Math.exp(-dt * 8);
    if (rot.snap) {
      rot.x += (rot.snap.x - rot.x) * (1 - Math.exp(-dt * 6));
      rot.y += (rot.snap.y - rot.y) * (1 - Math.exp(-dt * 6));
      if (Math.abs(rot.snap.x - rot.x) + Math.abs(rot.snap.y - rot.y) < 0.002) rot.snap = null;
    } else if (!rot.dragging) {
      // let go: keep spinning a little, then settle
      rot.y += rot.vy;
      rot.x = Math.max(-2.2, Math.min(1.5, rot.x + rot.vx));
      rot.vy *= Math.exp(-dt * 4);
      rot.vx *= Math.exp(-dt * 5);
      if (!rot.touched && !reducedMotion) rot.y += dt * 0.22;   // slow showroom turn until touched
    }
    place(k);
    tag.rotation.z = reducedMotion ? 0 : Math.sin(time * 1.6) * 0.08;   // the tag swings
  };

  if (reducedMotion) { place(1); stage.renderOnce(); } else stage.start();

  return {
    // Turn to a named side (front, right, back, left, top, bottom).
    show(side) {
      const t = SIDES[side];
      if (!t) return;
      rot.touched = true;
      rot.vx = rot.vy = 0;
      // the nearest equivalent yaw, so it never spins the long way round
      const y = t.y + Math.round((rot.y - t.y) / (Math.PI * 2)) * Math.PI * 2;
      rot.snap = { x: t.x, y };
      if (reducedMotion) { rot.x = t.x; rot.y = y; rot.snap = null; place(1); stage.renderOnce(); }
    },
    // Reflect the checklist on the box.
    setChecks({ intact, tags, damage, matches }) {
      const before = { ...state };
      Object.assign(state, { intact, tags, damage, matches });
      const redo = [];
      if (before.intact !== intact || before.matches !== matches) redo.push(2);
      if (before.damage !== damage) redo.push(4);
      if (redo.length) paint(redo);
      tag.visible = tags;
      if (reducedMotion) stage.renderOnce();
    },
  };
}
