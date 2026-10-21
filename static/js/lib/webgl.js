// Shared WebGL plumbing. Every 3D scene goes through createStage(), which:
//  - checks WebGL exists (otherwise the page keeps its static CSS version),
//  - caps the device pixel ratio,
//  - pauses when the canvas is off-screen or the tab is hidden,
//  - watches the frame rate and asks the scene to lighten up if it drops,
//  - disposes everything on teardown.

export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const isMobile = matchMedia('(max-width: 760px), (pointer: coarse)').matches;

export function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) {
    return false;
  }
}

// Only one renderer per page.
let activeStage = null;

export async function createStage(host, { camera: camOpts = {}, onLowFps } = {}) {
  if (!hasWebGL() || activeStage) return null;
  let THREE;
  try {
    THREE = await import('three');
  } catch (e) {
    return null; // CDN unreachable: keep the static version
  }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: !isMobile, alpha: true, powerPreference: 'high-performance' });
  } catch (e) {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.25 : 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(camOpts.fov || 40, 1, 0.1, 200);

  const stage = {
    THREE, renderer, scene, camera, host,
    width: 1, height: 1,
    running: false, visible: true,
    update: null,           // set by the scene: update(dt, elapsed)
    onResize: null,
  };

  function resize() {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    stage.width = w;
    stage.height = h;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    stage.onResize && stage.onResize(w, h);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  // ---- frame loop with pause + fps guard ----
  const clock = new THREE.Clock();
  let elapsed = 0;
  let slowFor = 0;
  let fpsAvg = 60;
  let raf = 0;

  function frame() {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    elapsed += dt;
    if (dt > 0) fpsAvg += (1 / dt - fpsAvg) * 0.1;
    if (fpsAvg < 40) {
      slowFor += dt;
      if (slowFor > 2 && onLowFps) {
        onLowFps();
        slowFor = 0;
        fpsAvg = 60;
      }
    } else {
      slowFor = 0;
    }
    stage.update && stage.update(dt, elapsed);
    renderer.render(scene, camera);
  }

  function shouldRun() {
    return stage.visible && !document.hidden && !reducedMotion;
  }
  function sync() {
    if (shouldRun() && !stage.running) {
      stage.running = true;
      clock.getDelta();
      raf = requestAnimationFrame(frame);
    } else if (!shouldRun() && stage.running) {
      stage.running = false;
      cancelAnimationFrame(raf);
    }
  }
  stage.start = sync;

  // With reduced motion we draw single frames on demand instead of looping.
  stage.renderOnce = () => {
    stage.update && stage.update(0, elapsed);
    renderer.render(scene, camera);
  };

  const io = new IntersectionObserver(([entry]) => {
    stage.visible = entry.isIntersecting;
    sync();
  });
  io.observe(host);
  document.addEventListener('visibilitychange', sync);

  stage.dispose = () => {
    cancelAnimationFrame(raf);
    io.disconnect();
    ro.disconnect();
    document.removeEventListener('visibilitychange', sync);
    scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
      mats.forEach((m) => {
        Object.values(m).forEach((v) => v && v.isTexture && v.dispose());
        m.dispose();
      });
    });
    renderer.dispose();
    renderer.domElement.remove();
    activeStage = null;
  };
  window.addEventListener('pagehide', stage.dispose, { once: true });

  activeStage = stage;
  return stage;
}

// ---------- procedural textures (no image files) ----------

function canvas2d(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function kraftBase(ctx, w, h, tone) {
  ctx.fillStyle = tone;
  ctx.fillRect(0, 0, w, h);
  // paper fibres
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '90,64,30' : '255,250,235'},${Math.random() * 0.08})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, Math.random() * 6 + 1, 1);
  }
}

function barcode(ctx, x, y, w, h) {
  let cx = x;
  ctx.fillStyle = '#14110F';
  while (cx < x + w) {
    const bar = Math.random() < 0.3 ? 3 : 1.4;
    ctx.fillRect(cx, y, bar, h);
    cx += bar + (Math.random() < 0.5 ? 1.6 : 3.2);
  }
}

// Top face: tape strip across, shipping label with a tiny barcode.
export function parcelTopTexture(THREE, tone = '#D8C29C') {
  const [c, ctx] = canvas2d(256, 256);
  kraftBase(ctx, 256, 256, tone);
  ctx.fillStyle = 'rgba(233, 214, 170, .85)';
  ctx.fillRect(104, 0, 48, 256);
  ctx.fillStyle = 'rgba(255,255,255,.25)';
  ctx.fillRect(108, 0, 4, 256);
  // label
  ctx.save();
  ctx.translate(40, 150);
  ctx.rotate(-0.06);
  ctx.fillStyle = '#FBF8F1';
  ctx.fillRect(0, 0, 120, 78);
  ctx.fillStyle = '#FF5B1F';
  ctx.fillRect(0, 0, 120, 12);
  ctx.fillStyle = '#14110F';
  for (let i = 0; i < 3; i++) ctx.fillRect(8, 20 + i * 9, 60 + Math.random() * 40, 3);
  barcode(ctx, 8, 52, 100, 18);
  ctx.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Side faces: plain kraft with the tape running down.
export function parcelSideTexture(THREE, tone = '#CDB58A') {
  const [c, ctx] = canvas2d(256, 256);
  kraftBase(ctx, 256, 256, tone);
  ctx.fillStyle = 'rgba(233, 214, 170, .85)';
  ctx.fillRect(104, 0, 48, 90);
  ctx.strokeStyle = 'rgba(20,17,15,.25)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, 254, 254);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Soft round sprite for particles.
export function dotTexture(THREE) {
  const [c, ctx] = canvas2d(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// Build one kraft parcel mesh. Materials are per-parcel so each can flash on its own.
export function makeParcel(THREE, textures, size = [1, 0.7, 0.8]) {
  const geo = new THREE.BoxGeometry(...size);
  const side = new THREE.MeshStandardMaterial({ map: textures.side, roughness: 0.88, metalness: 0 });
  const top = new THREE.MeshStandardMaterial({ map: textures.top, roughness: 0.82, metalness: 0 });
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z
  const mats = [side, side.clone(), top, side.clone(), side.clone(), side.clone()];
  return new THREE.Mesh(geo, mats);
}

export const GRADE_COLORS = { A: 0x2F7D4F, B: 0xD99A1E, C: 0xB3392B };
export const ease = {
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2),
};
