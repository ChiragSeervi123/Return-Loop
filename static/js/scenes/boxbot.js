// Maker page: a little character built from cardboard parcels. It breathes, waves
// hello now and then, follows the cursor with its head, blinks, and hops (with a
// spin) when clicked. Every part is a box; the faces are drawn on canvases, so
// there are no image files.
import {
  barcode, createStage, dotTexture, kraftBase, parcelSideTexture, parcelTopTexture, reducedMotion,
} from '../lib/webgl.js';

const ORANGE = 0xFF5B1F;
const TURN = 0.42;   // resting turn toward the card, in radians

function canvasTexture(THREE, draw, w = 256, h = 256) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Head front: kraft with rosy cheeks and a smile. The eyes are separate boxes so they can blink.
function faceTexture(THREE) {
  return canvasTexture(THREE, (ctx, w, h) => {
    kraftBase(ctx, w, h, '#D8C29C');
    ctx.fillStyle = 'rgba(255, 91, 31, .35)';
    [[62, 168], [194, 168]].forEach(([x, y]) => { ctx.beginPath(); ctx.ellipse(x, y, 24, 14, 0, 0, Math.PI * 2); ctx.fill(); });
    ctx.strokeStyle = '#14110F';
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(128, 150, 34, 0.18 * Math.PI, 0.82 * Math.PI);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(20,17,15,.25)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
  });
}

// Chest: a shipping label with the maker's initials, crew number and a barcode.
function chestTexture(THREE, initials, code) {
  return canvasTexture(THREE, (ctx, w, h) => {
    kraftBase(ctx, w, h, '#CDB58A');
    ctx.fillStyle = 'rgba(233, 214, 170, .85)';
    ctx.fillRect(104, 0, 48, 40);
    ctx.save();
    ctx.translate(34, 52);
    ctx.rotate(-0.04);
    ctx.fillStyle = '#FBF8F1';
    ctx.fillRect(0, 0, 188, 150);
    ctx.fillStyle = '#FF5B1F';
    ctx.fillRect(0, 0, 188, 22);
    ctx.fillStyle = '#14110F';
    ctx.font = '500 12px "DM Mono", monospace';
    ctx.fillText('SHIPPED BY', 10, 15);
    ctx.font = '800 64px "Bricolage Grotesque", "Arial Black", sans-serif';
    ctx.fillText(initials, 10, 86);
    ctx.font = '500 12px "DM Mono", monospace';
    ctx.fillText(code, 10, 108);
    barcode(ctx, 10, 118, 168, 22);
    ctx.restore();
    ctx.strokeStyle = 'rgba(20,17,15,.25)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
  });
}

// A box mesh; faces in BoxGeometry order: +x, -x, +y, -y, +z (front), -z.
function box(THREE, size, { side, top, front }) {
  const mat = (map) => new THREE.MeshStandardMaterial({ map, roughness: 0.86, metalness: 0 });
  const s = mat(side);
  return new THREE.Mesh(new THREE.BoxGeometry(...size),
    [s, s, top ? mat(top) : s, s, front ? mat(front) : s, s]);
}

// An empty group at `pos`, so a limb can turn around a joint instead of its middle.
function joint(THREE, parent, pos) {
  const g = new THREE.Group();
  g.position.set(...pos);
  parent.add(g);
  return g;
}

export async function initBoxbot(host, { initials = 'CS', code = 'RL-CREW-0001' } = {}) {
  const stage = await createStage(host, { camera: { fov: 30 } });
  if (!stage) return null;
  const { THREE, scene, camera } = stage;

  // The chest label uses the display font; wait for it briefly.
  try {
    await Promise.race([
      Promise.all([document.fonts.load('800 64px "Bricolage Grotesque"'), document.fonts.load('500 12px "DM Mono"')]),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
  } catch (e) { /* system font is fine */ }

  // ---------- light: same warm key + orange rim as the other scenes ----------
  scene.add(new THREE.HemisphereLight(0xffe8cc, 0x14110f, 0.9));
  const key = new THREE.DirectionalLight(0xfff1dd, 1.5);
  key.position.set(3, 6, 7);
  scene.add(key);
  const rim = new THREE.DirectionalLight(ORANGE, 2.4);
  rim.position.set(-5, 3, -5);
  scene.add(rim);

  // ---------- the character ----------
  const kraft = parcelSideTexture(THREE, '#CDB58A');
  const dark = parcelSideTexture(THREE, '#B39467');
  const tape = parcelTopTexture(THREE, '#D8C29C');

  const bot = new THREE.Group();          // moves for the hop and the turn
  scene.add(bot);

  const hips = joint(THREE, bot, [0, 1.0, 0]);
  const legs = [-0.27, 0.27].map((x) => {
    const leg = joint(THREE, hips, [x, 0, 0]);
    const shin = box(THREE, [0.4, 0.84, 0.44], { side: kraft });
    shin.position.y = -0.43;
    const foot = box(THREE, [0.48, 0.2, 0.66], { side: dark });
    foot.position.set(0, -0.9, 0.08);
    leg.add(shin, foot);
    return leg;
  });

  const torso = box(THREE, [1.3, 1.3, 0.9], { side: kraft, top: tape, front: chestTexture(THREE, initials, code) });
  torso.position.y = 0.66;
  hips.add(torso);

  const shoulders = [-0.82, 0.82].map((x) => {
    const arm = joint(THREE, hips, [x, 1.16, 0]);
    const upper = box(THREE, [0.32, 0.9, 0.36], { side: kraft });
    upper.position.y = -0.42;
    const hand = box(THREE, [0.38, 0.3, 0.4], { side: dark });
    hand.position.y = -0.96;
    arm.add(upper, hand);
    return arm;
  });
  const [waveArm, restArm] = shoulders;   // waves with the arm on the screen-left side

  const neck = joint(THREE, hips, [0, 1.36, 0]);
  const head = box(THREE, [1.05, 0.86, 0.9], { side: kraft, top: tape, front: faceTexture(THREE) });
  head.position.y = 0.47;
  neck.add(head);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x14110F, roughness: 0.4 });
  const eyes = [-0.2, 0.2].map((x) => {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.17, 0.03), eyeMat);
    eye.position.set(x, 0.56, 0.46);
    neck.add(eye);
    return eye;
  });
  // the open box flaps on top of the head
  const flaps = [-1, 1].map((dir) => {
    const hinge = joint(THREE, neck, [dir * 0.525, 0.9, 0]);
    const flap = box(THREE, [0.5, 0.03, 0.86], { side: kraft });
    flap.position.x = dir * 0.25;
    hinge.add(flap);
    return { hinge, dir };
  });

  // ---------- ground: soft shadow and an orange loop ----------
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.3),
    new THREE.MeshBasicMaterial({ map: dotTexture(THREE), color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.005;
  scene.add(shadow);
  const loop = new THREE.Mesh(new THREE.RingGeometry(1.08, 1.14, 64),
    new THREE.MeshBasicMaterial({ color: ORANGE, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
  loop.rotation.x = -Math.PI / 2;
  loop.position.y = 0.01;
  scene.add(loop);

  // ---------- framing ----------
  function frame() {
    const tall = 3.9;
    const vfov = THREE.MathUtils.degToRad(camera.fov);
    // far enough to fit its height, and its width (arms up) on narrow canvases
    const byH = (tall * 1.32) / (2 * Math.tan(vfov / 2));   // with headroom for the hop
    const byW = (3.0 * 1.15) / (2 * Math.tan(vfov / 2) * camera.aspect);
    const dist = Math.max(byH, byW);
    camera.position.set(0, 2.0, dist);
    camera.lookAt(0, 2.05, 0);
  }
  stage.onResize = frame;
  frame();

  // ---------- input: look at the cursor, hop on click ----------
  const look = { x: 0, y: 0, tx: 0, ty: 0 };
  if (!reducedMotion) {
    window.addEventListener('pointermove', (e) => {
      const r = host.getBoundingClientRect();
      look.tx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (innerWidth / 2)));
      look.ty = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height * 0.3)) / (innerHeight / 2)));
    }, { passive: true });
  }
  let hopT = -1;
  const hop = () => { if (!reducedMotion && hopT < 0) hopT = 0; };
  host.addEventListener('pointerdown', hop);

  // ---------- animation ----------
  let nextBlink = 2, blinkT = -1;
  const waveAt = (t) => {
    // a greeting on arrival, then a wave every 7 s
    const w = t < 2.6 ? t : (t - 2.6) % 7;
    const len = t < 2.6 ? 2.6 : 1.9;
    if (w > len) return 0;
    return Math.sin((w / len) * Math.PI) ** 0.6;
  };

  stage.update = (dt, t) => {
    const k = 1 - Math.exp(-dt * 6);
    look.x += (look.tx - look.x) * k;
    look.y += (look.ty - look.y) * k;

    // breathing and idle sway
    const breath = Math.sin(t * 2.2);
    torso.scale.set(1 + breath * 0.008, 1 + breath * 0.016, 1);
    hips.rotation.z = Math.sin(t * 1.1) * 0.025;
    // turned three-quarters toward its ID card ("that's me"), so the head flaps read as flaps
    bot.rotation.y = TURN + look.x * 0.28;

    // head follows the cursor, with a small nod
    neck.rotation.y = look.x * 0.55;
    neck.rotation.x = look.y * 0.3 + Math.sin(t * 1.6) * 0.03;

    // the wave
    const w = reducedMotion ? 0 : waveAt(t);
    waveArm.rotation.z = -0.12 + w * (-2.45 + Math.sin(t * 10) * 0.32);
    waveArm.rotation.x = w * -0.15;
    restArm.rotation.z = 0.12 + Math.sin(t * 1.3) * 0.04;

    // blink
    nextBlink -= dt;
    if (nextBlink <= 0 && blinkT < 0) { blinkT = 0; nextBlink = 2.5 + Math.random() * 3; }
    let lid = 1;
    if (blinkT >= 0) {
      blinkT += dt;
      lid = Math.abs(1 - blinkT / 0.08);
      if (blinkT > 0.16) { blinkT = -1; lid = 1; }
    }
    eyes.forEach((e) => { e.scale.y = Math.max(0.1, lid); });

    // the hop: crouch, jump with a full spin, land with a squash
    let lift = 0, spin = 0, squash = 0;
    if (hopT >= 0) {
      hopT += dt;
      const p = hopT / 0.85;
      if (p < 0.15) squash = Math.sin((p / 0.15) * Math.PI) * 0.12;
      else if (p < 0.85) {
        const q = (p - 0.15) / 0.7;
        lift = Math.sin(q * Math.PI) * 0.6;
        spin = (1 - Math.cos(q * Math.PI)) * Math.PI;   // 0 -> 2π, eased
      } else if (p < 1) squash = Math.sin(((p - 0.85) / 0.15) * Math.PI) * 0.1;
      else hopT = -1;
    }
    bot.position.y = lift;
    bot.rotation.y += spin;
    hips.scale.set(1 + squash * 0.6, 1 - squash, 1 + squash * 0.6);
    legs.forEach((leg, i) => { leg.rotation.x = lift > 0 ? (i ? 0.35 : -0.35) * Math.min(1, lift) : 0; });

    // flaps flutter, more while in the air
    flaps.forEach(({ hinge, dir }) => {
      hinge.rotation.z = dir * (1.05 + Math.sin(t * 3 + dir) * 0.06 + Math.min(1, lift) * 0.5);
    });

    // the shadow shrinks as it leaves the ground; the loop pulses
    const s = 1 - Math.min(1, lift) * 0.4;
    shadow.scale.set(s, s, 1);
    shadow.material.opacity = 0.55 * s;
    loop.scale.setScalar(1 + Math.sin(t * 2) * 0.03);
  };

  if (reducedMotion) stage.renderOnce();
  else stage.start();
  return { hop };
}
