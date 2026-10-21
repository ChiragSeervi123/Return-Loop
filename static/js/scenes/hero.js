// "The Loop": the landing page's 3D scene.
// Kraft parcels ride a glowing orange loop and pass a QC gate that scans and
// grades them. The same scene drives the "How a return flows" section: one
// highlighted parcel is moved through five steps by scroll and the camera follows it.
import {
  createStage, dotTexture, ease, GRADE_COLORS, isMobile, makeParcel,
  parcelSideTexture, parcelTopTexture, reducedMotion,
} from '../lib/webgl.js';

const STEP_T = [0.06, 0.24, 0.42, 0.60, 0.80]; // Request, Pickup, Check-in, Grade, Refund
const GATE_T = STEP_T[3];
const SPEED = 0.016; // loops per second

export async function initHero(host, { onStep } = {}) {
  const state = { heroP: 0, flowP: 0, flowW: 0, pointer: { x: 0, y: 0 }, lowFps: false };
  let dust = null;

  const stage = await createStage(host, {
    camera: { fov: isMobile ? 50 : 38 },
    onLowFps: () => {
      // Halve the particle count when the frame rate stays under ~40.
      if (!dust) return;
      dust.userData.count = Math.max(80, Math.floor(dust.userData.count / 2));
      dust.geometry.setDrawRange(0, dust.userData.count);
    },
  });
  if (!stage) return null;

  const { THREE, scene, camera } = stage;
  scene.fog = new THREE.Fog(0x14110F, 11, 30);

  // ---------- lights ----------
  scene.add(new THREE.HemisphereLight(0xffe8cc, 0x14110f, 0.55));
  const key = new THREE.DirectionalLight(0xfff1dd, 1.5);
  key.position.set(4, 9, 7);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xff5b1f, 2.4);
  rim.position.set(-6, 3, -9);
  scene.add(rim);

  const world = new THREE.Group();
  scene.add(world);

  // ---------- the loop track ----------
  const pts = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * 6.2, Math.sin(a * 2) * 0.55, Math.sin(a) * 3.5));
  }
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  const UP = new THREE.Vector3(0, 1, 0);

  function frameAt(t) {
    const p = curve.getPointAt(((t % 1) + 1) % 1);
    const tan = curve.getTangentAt(((t % 1) + 1) % 1);
    const side = new THREE.Vector3().crossVectors(tan, UP).normalize();
    const up = new THREE.Vector3().crossVectors(side, tan).normalize();
    // a gentle twist along the loop
    const twist = Math.sin(t * Math.PI * 4) * 0.22;
    side.applyAxisAngle(tan, twist);
    up.applyAxisAngle(tan, twist);
    return { p, tan, side, up };
  }

  function ribbon(width, lift = 0, segments = 480) {
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const { p, side, up } = frameAt(t);
      p.addScaledVector(up, lift);
      const a = p.clone().addScaledVector(side, width / 2);
      const b = p.clone().addScaledVector(side, -width / 2);
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      uv.push(t, 0, t, 1);
      if (i < segments) {
        const k = i * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  const core = new THREE.Mesh(ribbon(0.09, 0.015), new THREE.MeshStandardMaterial({
    color: 0xff6a2e, emissive: 0xff5b1f, emissiveIntensity: 1.3, roughness: 0.4, side: THREE.DoubleSide,
  }));
  world.add(core);

  // soft glow: a wider ribbon with a gradient across it, added on top
  const gc = document.createElement('canvas');
  gc.width = 4; gc.height = 64;
  const gctx = gc.getContext('2d');
  const grad = gctx.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, 'rgba(255,91,31,0)');
  grad.addColorStop(0.5, 'rgba(255,120,60,1)');
  grad.addColorStop(1, 'rgba(255,91,31,0)');
  gctx.fillStyle = grad;
  gctx.fillRect(0, 0, 4, 64);
  const glowTex = new THREE.CanvasTexture(gc);
  const glow = new THREE.Mesh(ribbon(0.9), new THREE.MeshBasicMaterial({
    map: glowTex, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide,
  }));
  world.add(glow);

  // ---------- step markers ----------
  const markers = STEP_T.map((t) => {
    const { p, up, tan } = frameAt(t);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.68, 48),
      new THREE.MeshBasicMaterial({ color: 0xff5b1f, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.position.copy(p).addScaledVector(up, 0.02);
    ring.lookAt(ring.position.clone().add(up));
    ring.userData.tan = tan;
    world.add(ring);
    return ring;
  });

  // ---------- QC gate ----------
  const gate = new THREE.Group();
  {
    const { p, tan, up } = frameAt(GATE_T);
    gate.position.copy(p);
    gate.up.copy(up);
    gate.lookAt(p.clone().add(tan));
    const archMat = new THREE.MeshStandardMaterial({ color: 0xff5b1f, emissive: 0xff5b1f, emissiveIntensity: 0.9, roughness: 0.35 });
    const arch = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.06, 12, 64, Math.PI), archMat);
    gate.add(arch);
    const foot = new THREE.BoxGeometry(0.16, 0.06, 0.4);
    [-1.5, 1.5].forEach((x) => {
      const f = new THREE.Mesh(foot, archMat);
      f.position.set(x, 0, 0);
      gate.add(f);
    });
  }
  const beam = new THREE.Mesh(
    new THREE.PlaneGeometry(2.9, 0.045),
    new THREE.MeshBasicMaterial({ color: 0xffa070, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  gate.add(beam);
  const curtain = new THREE.Mesh(
    new THREE.PlaneGeometry(2.9, 1.5),
    new THREE.MeshBasicMaterial({ color: 0xff5b1f, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  curtain.position.y = 0.75;
  gate.add(curtain);
  const gateLight = new THREE.PointLight(0xff5b1f, 1.2, 6, 1.6);
  gateLight.position.set(0, 1.5, 0);
  gate.add(gateLight);
  world.add(gate);

  // ---------- parcels ----------
  const textures = [
    { top: parcelTopTexture(THREE, '#D8C29C'), side: parcelSideTexture(THREE, '#CDB58A') },
    { top: parcelTopTexture(THREE, '#C9AE80'), side: parcelSideTexture(THREE, '#BFA272') },
    { top: parcelTopTexture(THREE, '#E2D0AE'), side: parcelSideTexture(THREE, '#D6C29E') },
  ];
  const COUNT = isMobile ? 12 : 15;
  const parcels = [];
  for (let i = 0; i < COUNT; i++) {
    const s = 0.42 + Math.random() * 0.16;
    const mesh = makeParcel(THREE, textures[i % 3], [s * 1.2, s * 0.85, s]);
    mesh.userData = {
      t: i / COUNT + (Math.random() - 0.5) * 0.02,
      lift: s * 0.42 + 0.06,
      tilt: (Math.random() - 0.5) * 0.25,
      bob: Math.random() * Math.PI * 2,
      flash: 0,
    };
    world.add(mesh);
    parcels.push(mesh);
  }
  // Parcel 0 is the "hero" parcel used by the flow section. It parks at step 1 until scrolled.
  const heroParcel = parcels[0];
  heroParcel.userData.t = STEP_T[0];
  heroParcel.userData.tilt = 0;
  heroParcel.scale.setScalar(1.25);
  heroParcel.userData.lift += 0.55; // floats above the stream so the others pass underneath
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.62, 40),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
  );
  world.add(halo);

  function setFlash(mesh, colorHex, amount) {
    mesh.material.forEach((m) => {
      m.emissive.setHex(colorHex);
      m.emissiveIntensity = amount;
    });
  }

  // ---------- particles ----------
  const dotTex = dotTexture(THREE);
  if (!reducedMotion) {
    const n = isMobile ? 350 : 1200;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 34;
      arr[i * 3 + 1] = (Math.random() - 0.35) * 14;
      arr[i * 3 + 2] = (Math.random() - 0.6) * 26;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    dust = new THREE.Points(g, new THREE.PointsMaterial({
      size: isMobile ? 0.09 : 0.065, map: dotTex, color: 0xffd2b0, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    dust.userData.count = n;
    scene.add(dust);
  }

  const SPARKS = 260;
  const sparkPos = new Float32Array(SPARKS * 3).fill(-999);
  const sparkCol = new Float32Array(SPARKS * 3);
  const sparkVel = new Float32Array(SPARKS * 3);
  const sparkLife = new Float32Array(SPARKS);
  const sparkMax = new Float32Array(SPARKS).fill(1);
  const sparkBase = new Float32Array(SPARKS * 3);
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  sparkGeo.setAttribute('color', new THREE.BufferAttribute(sparkCol, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
    size: 0.13, map: dotTex, vertexColors: true, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  world.add(sparks);
  let sparkCursor = 0;
  const tmpColor = new THREE.Color();

  function burst(at, colorHex) {
    if (reducedMotion) return;
    for (let k = 0; k < 28; k++) {
      const i = sparkCursor;
      sparkCursor = (sparkCursor + 1) % SPARKS;
      sparkPos[i * 3] = at.x; sparkPos[i * 3 + 1] = at.y; sparkPos[i * 3 + 2] = at.z;
      const a = Math.random() * Math.PI * 2;
      const sp = 1.2 + Math.random() * 2.4;
      sparkVel[i * 3] = Math.cos(a) * sp * 0.7;
      sparkVel[i * 3 + 1] = 1.5 + Math.random() * 2.6;
      sparkVel[i * 3 + 2] = Math.sin(a) * sp * 0.7;
      sparkLife[i] = sparkMax[i] = 0.5 + Math.random() * 0.6;
      tmpColor.setHex(Math.random() < 0.55 ? 0xff7a3d : colorHex);
      sparkBase[i * 3] = tmpColor.r; sparkBase[i * 3 + 1] = tmpColor.g; sparkBase[i * 3 + 2] = tmpColor.b;
    }
  }

  function pickGrade() {
    const r = Math.random();
    return r < 0.55 ? 'A' : r < 0.85 ? 'B' : 'C';
  }

  // ---------- layout: shift the subject away from the headline ----------
  const view = { x: 0, y: 0 };
  function applyViewOffset() {
    const w = stage.width, h = stage.height;
    if (!w || !h) return;
    camera.setViewOffset(w, h, -w * view.x, -h * view.y, w, h);
  }

  // ---------- camera ----------
  const camPos = new THREE.Vector3(0, 3, 13);
  const camLook = new THREE.Vector3();
  const desiredPos = new THREE.Vector3();
  const desiredLook = new THREE.Vector3();
  const heroPos = new THREE.Vector3();
  const heroLook = new THREE.Vector3();
  const pointerNow = { x: 0, y: 0 };
  let lastStep = -1;
  let heroT = STEP_T[0];

  stage.update = (dt, time) => {
    // parallax only on fine pointers, and only in the hero part
    const k = 1 - Math.exp(-dt * 3);
    pointerNow.x += (state.pointer.x - pointerNow.x) * (reducedMotion ? 1 : k);
    pointerNow.y += (state.pointer.y - pointerNow.y) * (reducedMotion ? 1 : k);

    // hero camera: dolly in and orbit a little as the hero scrolls away
    const hp = state.heroP;
    const orbit = -0.25 + hp * 0.45 + pointerNow.x * 0.12;
    const radius = (isMobile ? 19 : 16.5) - hp * 3;
    heroPos.set(Math.sin(orbit) * radius, (isMobile ? 9 : 6.2) - hp * 2 + pointerNow.y * 0.5, Math.cos(orbit) * radius);
    heroLook.set(0, -0.3, 0);

    // follow camera for the flow section
    const w = ease.inOutCubic(state.flowW);
    // Each of the five steps owns a fifth of the scroll: the parcel travels to
    // the step's station in the first part of it, then waits there.
    const sk = Math.min(4, Math.floor(state.flowP * 5));
    const local = state.flowP * 5 - sk;
    const targetT = sk === 0 ? STEP_T[0]
      : STEP_T[sk - 1] + (STEP_T[sk] - STEP_T[sk - 1]) * ease.inOutCubic(Math.min(1, local / 0.45));
    heroT += (targetT - heroT) * (reducedMotion ? 1 : 1 - Math.exp(-dt * 5));
    const f = frameAt(heroT);
    const follow = f.p.clone().addScaledVector(f.side, isMobile ? 7.5 : 6.2).addScaledVector(UP, isMobile ? 5 : 3.6).addScaledVector(f.tan, -2.6);
    const followLook = f.p.clone().addScaledVector(f.tan, 0.6);

    desiredPos.lerpVectors(heroPos, follow, w);
    desiredLook.lerpVectors(heroLook, followLook, w);
    const ck = reducedMotion ? 1 : 1 - Math.exp(-dt * 4);
    camPos.lerp(desiredPos, ck);
    camLook.lerp(desiredLook, ck);
    camera.position.copy(camPos);
    camera.lookAt(camLook);

    // subject placement: right of the headline on desktop, above the text on mobile
    // (positive x moves the subject right, negative y moves it up)
    view.x = isMobile ? 0 : 0.17 * (1 - w) + 0.2 * w;
    view.y = isMobile ? -0.13 * (1 - w) - 0.2 * w : -0.06 * (1 - w);
    applyViewOffset();

    // parcels
    for (let i = 0; i < parcels.length; i++) {
      const m = parcels[i];
      const d = m.userData;
      const prev = d.t;
      if (m === heroParcel) d.t = heroT;
      else d.t = (d.t + dt * SPEED) % 1;
      const fr = frameAt(d.t);
      const bob = reducedMotion ? 0 : Math.sin(time * 2.2 + d.bob) * 0.05;
      m.position.copy(fr.p).addScaledVector(fr.up, d.lift + bob);
      m.up.copy(fr.up);
      m.lookAt(m.position.clone().add(fr.tan));
      m.rotateZ(d.tilt);

      // passing the gate: scan, grade, flash, sparks
      const crossed = m !== heroParcel && prev < GATE_T && d.t >= GATE_T;
      const heroCrossed = m === heroParcel && prev < GATE_T - 0.004 && d.t >= GATE_T - 0.004;
      if (crossed || heroCrossed) {
        d.grade = m === heroParcel ? 'B' : pickGrade();
        d.flash = 1.4;
        burst(gate.position.clone().add(new THREE.Vector3(0, 1.1, 0)), GRADE_COLORS[d.grade]);
        gateLight.intensity = 4;
      }
      if (d.flash > 0) {
        d.flash = Math.max(0, d.flash - dt * 1.3);
        setFlash(m, GRADE_COLORS[d.grade], d.flash);
      }
    }

    // halo under the hero parcel during the flow section
    halo.position.copy(frameAt(heroT).p).addScaledVector(UP, 0.03);
    halo.lookAt(halo.position.clone().add(UP));
    halo.material.opacity = 0.75 * w;

    // step markers light up as the hero parcel reaches them
    const step = state.flowW > 0.01
      ? STEP_T.reduce((acc, t, i) => (heroT >= t - 0.03 ? i : acc), 0)
      : -1;
    markers.forEach((r, i) => {
      const on = i === step ? 1 : i < step ? 0.6 : 0.22;
      r.material.opacity += (on - r.material.opacity) * (reducedMotion ? 1 : 0.15);
    });
    if (step !== lastStep && step >= 0) {
      lastStep = step;
      onStep && onStep(step);
    }

    // scanner beam sweeps up and down
    beam.position.y = 0.15 + (Math.sin(time * 5) * 0.5 + 0.5) * 1.3;
    gateLight.intensity += (1.2 - gateLight.intensity) * Math.min(1, dt * 3);

    // sparks
    for (let i = 0; i < SPARKS; i++) {
      if (sparkLife[i] <= 0) continue;
      sparkLife[i] -= dt;
      sparkVel[i * 3 + 1] -= 5.5 * dt;
      sparkPos[i * 3] += sparkVel[i * 3] * dt;
      sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt;
      sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
      const fade = Math.max(0, sparkLife[i] / sparkMax[i]);
      sparkCol[i * 3] = sparkBase[i * 3] * fade;
      sparkCol[i * 3 + 1] = sparkBase[i * 3 + 1] * fade;
      sparkCol[i * 3 + 2] = sparkBase[i * 3 + 2] * fade;
      if (sparkLife[i] <= 0) sparkPos[i * 3 + 1] = -999;
    }
    sparkGeo.attributes.position.needsUpdate = true;
    sparkGeo.attributes.color.needsUpdate = true;

    if (dust) {
      dust.rotation.y = time * 0.012;
      dust.position.y = Math.sin(time * 0.25) * 0.25;
    }
  };

  stage.onResize = applyViewOffset;

  // pointer parallax
  if (!reducedMotion && matchMedia('(pointer: fine)').matches) {
    window.addEventListener('pointermove', (e) => {
      state.pointer.x = (e.clientX / innerWidth) * 2 - 1;
      state.pointer.y = (e.clientY / innerHeight) * 2 - 1;
    }, { passive: true });
  }

  if (reducedMotion) stage.renderOnce();
  else stage.start();

  host.closest('[data-loop-stage]')?.classList.add('has-webgl');

  return {
    // called by the scroll choreography
    setHeroProgress(p) { state.heroP = p; if (reducedMotion) stage.renderOnce(); },
    setFlowProgress(p) {
      state.flowP = Math.min(1, Math.max(0, p));
      state.flowW = Math.min(1, Math.max(0, p * 7));
      if (reducedMotion) stage.renderOnce();
    },
    dispose: stage.dispose,
  };
}
