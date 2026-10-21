// Track Return scene: a parcel on a path with six waypoints.
// Its position maps to the return's step; changes animate with easing.
// Dragging rotates the parcel (limited), and it eases back when let go.
import {
  createStage, dotTexture, ease, isMobile, makeParcel,
  parcelSideTexture, parcelTopTexture, reducedMotion,
} from '../lib/webgl.js';

const WAYPOINTS = 6;

export async function initTrack(host, { step = 0, terminal = false, labels = [] } = {}) {
  const stage = await createStage(host, { camera: { fov: 34 } });
  if (!stage) return null;
  const { THREE, scene, camera, renderer } = stage;

  scene.fog = new THREE.Fog(0x14110F, 14, 30);
  scene.add(new THREE.HemisphereLight(0xfff0dd, 0x14110f, 0.7));
  const key = new THREE.DirectionalLight(0xfff1dd, 1.6);
  key.position.set(3, 8, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xff5b1f, 1.8);
  rim.position.set(-5, 2, -6);
  scene.add(rim);

  // ---------- path ----------
  const pts = [
    [-5, 0, 0.9], [-3, 0, -0.7], [-1, 0, 0.8], [1, 0, -0.8], [3, 0, 0.7], [5, 0, -0.5],
  ].map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
  const SEG = 240, RAD = 8;
  const tubeGeo = new THREE.TubeGeometry(curve, SEG, 0.045, RAD, false);
  scene.add(new THREE.Mesh(tubeGeo, new THREE.MeshStandardMaterial({ color: 0x4a433d, roughness: 0.7 })));
  const progressGeo = new THREE.TubeGeometry(curve, SEG, 0.07, RAD, false);
  const progressTube = new THREE.Mesh(progressGeo, new THREE.MeshStandardMaterial({
    color: 0xff6a2e, emissive: 0xff5b1f, emissiveIntensity: 1.2, roughness: 0.4,
  }));
  scene.add(progressTube);

  // ---------- waypoint markers + their HTML labels ----------
  const discGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.08, 36);
  const markers = pts.map((p) => {
    const m = new THREE.Mesh(discGeo, new THREE.MeshStandardMaterial({ color: 0x3a332d, emissive: 0x000000, roughness: 0.6 }));
    m.position.copy(p);
    scene.add(m);
    return m;
  });
  const pulse = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.5, 40),
    new THREE.MeshBasicMaterial({ color: 0xff5b1f, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
  );
  pulse.rotation.x = -Math.PI / 2;
  scene.add(pulse);

  const labelEls = labels.map((text) => {
    const el = document.createElement('span');
    el.className = 'waypoint';
    // "01 REQUESTED" -> number always shown, word hidden on narrow screens unless current
    const [num, ...rest] = text.split(' ');
    el.innerHTML = '<span class="waypoint__n"></span> <span class="waypoint__t"></span>';
    el.firstChild.textContent = num;
    el.lastChild.textContent = rest.join(' ');
    host.appendChild(el);
    return el;
  });

  // ---------- parcel ----------
  const parcel = makeParcel(THREE, {
    top: parcelTopTexture(THREE, '#D8C29C'), side: parcelSideTexture(THREE, '#CDB58A'),
  }, [1.0, 0.72, 0.82]);
  const holder = new THREE.Group(); // holder follows the path, parcel rotates inside it
  holder.add(parcel);
  scene.add(holder);
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.75, 32),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  scene.add(shadow);

  // a little ambient dust
  if (!reducedMotion) {
    const n = isMobile ? 90 : 180;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 18;
      arr[i * 3 + 1] = Math.random() * 5 - 0.5;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 10;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const dust = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.07, map: dotTexture(THREE), color: 0xffc9a5, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    dust.name = 'dust';
    scene.add(dust);
  }

  // ---------- camera framing: fit the whole path in view ----------
  stage.onResize = (w, h) => {
    const aspect = w / h;
    const vfov = THREE.MathUtils.degToRad(camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const dist = Math.max(8, 6.4 / Math.tan(hfov / 2));
    // portrait screens look down more steeply so the path's curves use the height
    if (aspect < 1) camera.position.set(0, dist * 0.92, dist * 0.42);
    else camera.position.set(0, dist * 0.55, dist * 0.84);
    camera.lookAt(0, 0.35, 0.3);
  };
  stage.onResize(stage.width, stage.height);

  // ---------- state ----------
  const s = {
    u: step / (WAYPOINTS - 1), from: 0, to: step / (WAYPOINTS - 1), anim: 1,
    step, terminal,
    rotX: 0, rotY: 0, dragX: 0, dragY: 0, dragging: false,
  };
  s.from = s.u;

  function paintMarkers() {
    markers.forEach((m, i) => {
      const done = i < s.step || (i === s.step && s.step === WAYPOINTS - 1 && !s.terminal);
      const now = i === s.step;
      m.material.color.setHex(now && s.terminal ? 0xb3392b : done || now ? 0xff5b1f : 0x3a332d);
      m.material.emissive.setHex(now && s.terminal ? 0x5a1a12 : done || now ? 0x7a2a0c : 0x000000);
      labelEls[i] && labelEls[i].classList.toggle('is-done', i < s.step);
      labelEls[i] && labelEls[i].classList.toggle('is-now', now);
    });
    parcel.material.forEach((mat) => {
      mat.emissive.setHex(s.terminal ? 0xb3392b : 0x000000);
      mat.emissiveIntensity = s.terminal ? 0.35 : 0;
    });
  }
  paintMarkers();

  const v = new THREE.Vector3();
  stage.update = (dt, time) => {
    // move along the path
    if (s.anim < 1) {
      s.anim = Math.min(1, s.anim + dt / 1.6);
      s.u = s.from + (s.to - s.from) * ease.inOutCubic(s.anim);
    }
    const u = Math.min(1, Math.max(0, s.u));
    const p = curve.getPoint(u);
    const tan = curve.getTangent(u);
    const hop = s.anim < 1 ? Math.sin(s.anim * Math.PI) * 0.6 : 0;
    const bob = reducedMotion ? 0 : Math.sin(time * 2.4) * 0.06;
    holder.position.set(p.x, 0.62 + hop + bob, p.z);
    holder.lookAt(v.set(p.x + tan.x, holder.position.y, p.z + tan.z));
    shadow.position.set(p.x, 0.05, p.z);
    shadow.scale.setScalar(1 - hop * 0.4);

    // drag rotation with limits, easing back when released
    if (!s.dragging) {
      s.dragX += (0 - s.dragX) * Math.min(1, dt * 4);
      s.dragY += (0 - s.dragY) * Math.min(1, dt * 4);
    }
    parcel.rotation.set(s.dragY, s.dragX + (reducedMotion ? 0 : Math.sin(time * 0.8) * 0.08), 0);

    // orange progress tube up to the parcel
    const segs = Math.round(u * SEG);
    progressGeo.setDrawRange(0, segs * RAD * 6);

    // pulse on the current marker
    const cur = pts[s.step];
    pulse.position.set(cur.x, 0.06, cur.z);
    const k = reducedMotion ? 0.5 : (time * 0.8) % 1;
    pulse.scale.setScalar(1 + k * 0.9);
    pulse.material.opacity = 0.8 * (1 - k);
    pulse.material.color.setHex(s.terminal ? 0xb3392b : 0xff5b1f);

    const dust = scene.getObjectByName('dust');
    if (dust) dust.rotation.y = time * 0.02;

    // place the HTML labels under each marker
    for (let i = 0; i < labelEls.length; i++) {
      v.copy(pts[i]).project(camera);
      const x = (v.x * 0.5 + 0.5) * stage.width;
      const y = (-v.y * 0.5 + 0.5) * stage.height;
      labelEls[i].style.transform = `translate(${x}px, ${y}px) translate(-50%, 18px)`;
    }
  };

  // ---------- pointer drag ----------
  const el = renderer.domElement;
  let lastX = 0, lastY = 0;
  el.addEventListener('pointerdown', (e) => {
    s.dragging = true;
    lastX = e.clientX; lastY = e.clientY;
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!s.dragging) return;
    s.dragX = Math.max(-1.2, Math.min(1.2, s.dragX + (e.clientX - lastX) * 0.012));
    s.dragY = Math.max(-0.6, Math.min(0.6, s.dragY + (e.clientY - lastY) * 0.01));
    lastX = e.clientX; lastY = e.clientY;
    if (reducedMotion) stage.renderOnce();
  });
  const release = () => { s.dragging = false; if (reducedMotion) { s.dragX = s.dragY = 0; stage.renderOnce(); } };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);

  if (reducedMotion) stage.renderOnce();
  else stage.start();

  return {
    setStep(newStep, isTerminal) {
      s.terminal = isTerminal;
      if (newStep !== s.step) {
        s.from = s.u;
        s.to = newStep / (WAYPOINTS - 1);
        s.anim = reducedMotion ? 1 : 0;
        if (reducedMotion) s.u = s.to;
        s.step = newStep;
      }
      paintMarkers();
      if (reducedMotion) stage.renderOnce();
    },
    dispose: stage.dispose,
  };
}
