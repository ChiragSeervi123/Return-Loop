// Team page scene: thousands of particles morph between shapes as you scroll:
//   0 a knotted loop, 1..n each member's first name, n+1 one interlocked ring per member.
// Every target shape is stored as a vertex attribute, and the morph,
// the mid-flight burst, the idle shimmer and the cursor push all run in the
// vertex shader, so the CPU only updates a handful of uniforms per frame.
import {
  createStage, isMobile, makeParcel, parcelSideTexture, parcelTopTexture, reducedMotion,
} from '../lib/webgl.js';

// brighter grade colours for glowing on ink, plus the brand orange for a fourth member
const ACCENTS = { a: 0x3FA866, b: 0xF0B03A, c: 0xE0533F, d: 0xFF7A3D };
const ORANGE = 0xFF5B1F;

// ---------- target shapes (each returns a Float32Array of n * 3) ----------

function knot(n) {
  // (2,3) torus knot with a little thickness
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = Math.random() * Math.PI * 2;
    const r = 2.6 + Math.cos(3 * t) * 1.1;
    const tube = 0.32 * Math.sqrt(Math.random());
    const a = Math.random() * Math.PI * 2;
    out[i * 3] = r * Math.cos(2 * t) + Math.cos(a) * tube;
    out[i * 3 + 1] = r * Math.sin(2 * t) + Math.sin(a) * tube;
    out[i * 3 + 2] = Math.sin(3 * t) * 1.3 + (Math.random() - 0.5) * tube;
  }
  return out;
}

function rings(n, count = 3) {
  // interlocked rings, one per member, tilted like a gyroscope: the first lies flat,
  // the others stand up and fan out around the vertical axis
  const out = new Float32Array(n * 3);
  const tilts = Array.from({ length: count }, (_, k) => (k === 0 ? [0, 0]
    : [Math.PI / 2, count > 2 ? (Math.PI * (k - 1)) / (count - 1) : 0]));
  for (let i = 0; i < n; i++) {
    const k = i % count;
    const t = Math.random() * Math.PI * 2;
    const R = 2.6, w = 0.2 * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
    let x = (R + Math.cos(a) * w) * Math.cos(t);
    let y = (R + Math.cos(a) * w) * Math.sin(t);
    let z = Math.sin(a) * w;
    const [rx, ry] = tilts[k];
    // rotate around x, then y
    let y2 = y * Math.cos(rx) - z * Math.sin(rx);
    let z2 = y * Math.sin(rx) + z * Math.cos(rx);
    let x3 = x * Math.cos(ry) + z2 * Math.sin(ry);
    let z3 = -x * Math.sin(ry) + z2 * Math.cos(ry);
    out[i * 3] = x3 + (k - (count - 1) / 2) * 0.75;
    out[i * 3 + 1] = y2;
    out[i * 3 + 2] = z3;
  }
  return out;
}

function word(text, n, width) {
  // Draw the word on a 2D canvas in the display font, then sample filled pixels.
  const c = document.createElement('canvas');
  c.width = 1000;   // small canvas: fast to read back, still plenty of detail
  c.height = 250;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = 220;
  do {
    ctx.font = `800 ${size}px "Bricolage Grotesque", "Arial Black", sans-serif`;
    size -= 10;
  } while (ctx.measureText(text).width > c.width * 0.94 && size > 40);
  ctx.fillText(text, c.width / 2, c.height / 2 + 8);
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  const filled = [];
  for (let y = 0; y < c.height; y += 2) {
    for (let x = 0; x < c.width; x += 2) {
      if (data[(y * c.width + x) * 4 + 3] > 128) filled.push(x, y);
    }
  }
  const out = new Float32Array(n * 3);
  const scale = width / c.width;
  for (let i = 0; i < n; i++) {
    const j = Math.floor(Math.random() * (filled.length / 2)) * 2;
    out[i * 3] = (filled[j] - c.width / 2 + Math.random() * 2) * scale;
    out[i * 3 + 1] = -(filled[j + 1] - c.height / 2 + Math.random() * 2) * scale;
    out[i * 3 + 2] = (Math.random() - 0.5) * 0.7; // a little depth so the letters feel extruded
  }
  return out;
}

// ---------- shaders ----------

// The vertex shader is built for the number of shapes: one aP<i> attribute each.
const makeVert = (count) => /* glsl */`
  ${Array.from({ length: count }, (_, i) => `attribute vec3 aP${i};`).join(' ')}
  attribute float aRand;
  uniform float uMorph; uniform float uTime; uniform float uScatter; uniform float uSize;
  uniform float uPixelRatio; uniform vec3 uMouse; uniform float uMouseOn;
  uniform float uRadius; uniform float uPush;   // cursor reach and strength, in the shape's own units
  varying float vBurst; varying float vRand; varying float vDepth;

  vec3 pick(float i) {
    ${Array.from({ length: count - 1 }, (_, i) => `if (i < ${i}.5) return aP${i};`).join('\n    ')}
    return aP${count - 1};
  }

  void main() {
    float m = clamp(uMorph, 0.0, ${count - 1}.0);
    float i0 = floor(min(m, ${count - 1}.0 - 0.001));
    float f = m - i0;
    float d = aRand * 0.4;                         // each particle leaves a little later
    float t = smoothstep(d, d + 0.6, f);
    vec3 p = mix(pick(i0), pick(i0 + 1.0), t);

    float burst = sin(t * 3.14159);                // strongest halfway through a morph
    vec3 swirl = vec3(
      sin(aRand * 91.0 + uTime * 0.9 + p.y * 0.7),
      cos(aRand * 57.0 + uTime * 0.8 + p.x * 0.6),
      sin(aRand * 33.0 + uTime * 0.7 + p.z));
    p += swirl * (burst * 2.6 + 0.04 + uScatter * 2.8);

    // the cursor parts the particles: pushed outwards, swirled round it, lifted towards the camera
    vec2 away = p.xy - uMouse.xy;
    float dist = length(away);
    float reach = uMouseOn * smoothstep(uRadius, 0.0, dist);
    vec2 dir = away / max(dist, 1e-4);
    p.xy += (dir * 1.0 + vec2(-dir.y, dir.x) * 0.55) * reach * uPush;
    p.z += reach * uPush * 1.2;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uPixelRatio * (0.55 + aRand * 0.9) / -mv.z;
    vBurst = burst + uScatter + reach * 0.9;     // particles near the cursor glow hot
    vRand = aRand;
    vDepth = p.z;
  }
`;

const FRAG = /* glsl */`
  uniform vec3 uAccent; uniform vec3 uHot; uniform vec3 uCool;
  varying float vBurst; varying float vRand; varying float vDepth;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    if (r > 0.5) discard;
    float a = smoothstep(0.5, 0.0, r);
    vec3 col = mix(uCool, uAccent, smoothstep(0.15, 0.85, vRand));
    col = mix(col, uHot, clamp(vBurst, 0.0, 1.0) * 0.7);   // glow orange while flying
    col *= 0.85 + vDepth * 0.12;
    gl_FragColor = vec4(col, a * 0.95);
  }
`;

export async function initTeam(host, { words = [], accents = [] } = {}) {
  // Particle budget: fewer on phones and on machines with few CPU cores (usually weaker GPUs too).
  const cores = navigator.hardwareConcurrency || 4;
  const N = isMobile ? 3600 : cores <= 4 ? 6500 : 9000;
  const stage = await createStage(host, {
    camera: { fov: 42 },
    onLowFps: () => {
      points.userData.count = Math.max(1500, Math.floor(points.userData.count / 2));
      points.geometry.setDrawRange(0, points.userData.count);
    },
  });
  if (!stage) return null;
  const { THREE, scene, camera, renderer } = stage;

  // The particle words use the display font, so wait for it (but never forever).
  try {
    await Promise.race([
      document.fonts.load('800 200px "Bricolage Grotesque"'),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
  } catch (e) { /* fall back to the system font */ }

  // ---------- particles ----------
  const wordWidth = 14;
  const names = words.length ? words : ['CREW'];
  const shapes = [knot(N), ...names.map((w) => word(w, N, wordWidth)), rings(N, names.length)];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(shapes[0].slice(), 3));
  shapes.forEach((arr, i) => geo.setAttribute(`aP${i}`, new THREE.BufferAttribute(arr, 3)));
  const rand = new Float32Array(N);
  for (let i = 0; i < N; i++) rand[i] = Math.random();
  geo.setAttribute('aRand', new THREE.BufferAttribute(rand, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 30); // shapes move in the shader

  const uniforms = {
    uMorph: { value: 0 }, uTime: { value: 0 }, uScatter: { value: 0 },
    uSize: { value: isMobile ? 44 : 50 }, uPixelRatio: { value: renderer.getPixelRatio() },
    uMouse: { value: new THREE.Vector3(99, 99, 0) }, uMouseOn: { value: 0 },
    uRadius: { value: 2.2 }, uPush: { value: 1.4 },
    uAccent: { value: new THREE.Color(ORANGE) },
    uHot: { value: new THREE.Color(ORANGE) },
    uCool: { value: new THREE.Color(0xF6F1E7) },
  };
  const points = new THREE.Points(geo, new THREE.ShaderMaterial({
    vertexShader: makeVert(shapes.length), fragmentShader: FRAG, uniforms,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  points.userData.count = N;
  scene.add(points);

  // ---------- drifting parcels for depth ----------
  scene.add(new THREE.HemisphereLight(0xffe8cc, 0x14110f, 0.8));
  const key = new THREE.DirectionalLight(0xfff1dd, 1.4);
  key.position.set(4, 8, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(ORANGE, 2.2);
  rim.position.set(-6, 2, -6);
  scene.add(rim);
  const tex = { top: parcelTopTexture(THREE), side: parcelSideTexture(THREE) };
  const parcels = [];
  for (let i = 0; i < (isMobile ? 5 : 9); i++) {
    const s = 0.5 + Math.random() * 0.7;
    const box = makeParcel(THREE, tex, [s * 1.2, s * 0.85, s]);
    box.userData = {
      x: (Math.random() - 0.5) * 26, y: (Math.random() - 0.5) * 14, z: -6 - Math.random() * 12,
      spin: (Math.random() - 0.5) * 0.4, phase: Math.random() * 6,
    };
    box.rotation.set(Math.random() * 6, Math.random() * 6, 0);
    scene.add(box);
    parcels.push(box);
  }

  // ---------- framing ----------
  const state = { morph: 0, targetMorph: 0, scatter: 0, lift: 0, shift: 0, liftNow: 0, shiftNow: 0 };
  function frame() {
    // keep the 14-unit-wide word inside the screen on narrow phones
    const dist = 13;
    const vfov = THREE.MathUtils.degToRad(camera.fov);
    const visibleW = 2 * Math.tan(vfov / 2) * dist * camera.aspect;
    points.scale.setScalar(Math.min(1, (visibleW * 0.92) / wordWidth));
    camera.position.set(0, 0, dist);
  }
  stage.onResize = frame;
  frame();

  // ---------- pointer ----------
  const mouseNDC = new THREE.Vector2(9, 9);
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const ray = new THREE.Raycaster();
  const hit = new THREE.Vector3();
  const localRay = new THREE.Ray();
  const inverse = new THREE.Matrix4();
  let mouseActive = false;
  if (!reducedMotion) {
    const track = (e) => {
      mouseNDC.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
      mouseActive = true;
    };
    window.addEventListener('pointermove', track, { passive: true });
    window.addEventListener('pointerdown', track, { passive: true });
    // touch: the finger lifts, so let the particles settle back
    window.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') mouseActive = false; });
    document.documentElement.addEventListener('mouseleave', () => { mouseActive = false; });
  }
  const camOffset = new THREE.Vector2();
  const ZERO = new THREE.Vector2();

  // ---------- frame update ----------
  const accentTarget = new THREE.Color(ORANGE);
  stage.update = (dt, time) => {
    const k = reducedMotion ? 1 : 1 - Math.exp(-dt * 3.2);
    state.morph += (state.targetMorph - state.morph) * k;
    state.scatter = Math.max(0, state.scatter - dt * 1.4);
    uniforms.uMorph.value = state.morph;
    uniforms.uTime.value = reducedMotion ? 0 : time;
    uniforms.uScatter.value = Math.pow(state.scatter, 1.5);

    // accent colour follows whichever member is on screen
    const nearest = Math.round(state.morph);
    const acc = nearest >= 1 && nearest <= names.length ? ACCENTS[accents[nearest - 1]] || ORANGE : ORANGE;
    accentTarget.setHex(acc);
    uniforms.uAccent.value.lerp(accentTarget, reducedMotion ? 1 : Math.min(1, dt * 3));

    // Cursor -> the particles' own coordinates. The shape is moved, scaled and
    // tilted on screen, so the ray is taken into its local space before hitting z = 0.
    points.updateMatrixWorld();
    ray.setFromCamera(mouseNDC, camera);
    localRay.copy(ray.ray).applyMatrix4(inverse.copy(points.matrixWorld).invert());
    if (localRay.intersectPlane(plane, hit)) uniforms.uMouse.value.lerp(hit, reducedMotion ? 1 : 0.35);
    // keep the effect the same size on screen whatever the shape's scale
    uniforms.uRadius.value = 1.6 / points.scale.x;
    uniforms.uPush.value = 1.05 / points.scale.x;
    uniforms.uMouseOn.value += ((mouseActive ? 1 : 0) - uniforms.uMouseOn.value) * Math.min(1, dt * 4);

    // the whole field turns slowly; names face the camera, the loop and rings tumble
    // (names sit at morph 1..n; strongest in the middle of that run)
    const mid = (1 + names.length) / 2, half = names.length / 2;
    const wordness = Math.max(0, 1 - Math.min(Math.abs(state.morph - mid), half) / half)
      * (state.morph > 0.5 && state.morph < names.length + 0.5 ? 1 : 0);
    const spin = reducedMotion ? 0 : time * 0.25;
    points.rotation.y = (1 - wordness) * Math.sin(spin) * 0.6;
    points.rotation.x = (1 - wordness) * Math.cos(spin * 0.8) * 0.25;
    state.liftNow += (state.lift - state.liftNow) * k;
    state.shiftNow += (state.shift - state.shiftNow) * k;
    points.position.set(state.shiftNow, state.liftNow, 0);

    // gentle camera parallax
    camOffset.lerp(mouseActive ? mouseNDC : ZERO, 0.04);
    camera.position.x = camOffset.x * 0.8;
    camera.position.y = camOffset.y * 0.5;
    camera.lookAt(0, 0, 0);

    parcels.forEach((b) => {
      const d = b.userData;
      b.position.set(d.x + Math.sin(time * 0.2 + d.phase) * 0.8, d.y + Math.sin(time * 0.35 + d.phase) * 0.6, d.z);
      if (!reducedMotion) {
        b.rotation.x += dt * d.spin;
        b.rotation.y += dt * d.spin * 0.7;
      }
    });
  };

  if (reducedMotion) stage.renderOnce();
  else stage.start();

  return {
    // m: 0..n+1 which shape; lift / shift: move the shape up or sideways (world units)
    setMorph(m, lift = 0, shift = 0) {
      state.targetMorph = m;
      state.lift = lift;
      state.shift = shift;
      if (reducedMotion) stage.renderOnce();
    },
    scatter() {
      if (reducedMotion) return;
      state.scatter = 1;
    },
  };
}
