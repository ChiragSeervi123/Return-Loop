// Warehouse inventory: three stacks of boxes (Restocked, Refurbished, Scrapped).
// Stack height = unit count (capped for display). Boxes drop in on load,
// the group idles round slowly, and hovering a stack shows its exact number.
import {
  createStage, ease, isMobile, makeParcel, parcelSideTexture, parcelTopTexture, reducedMotion,
} from '../lib/webgl.js';

const STACKS = [
  { key: 'Restocked', color: 0x2F7D4F, tone: ['#D8C29C', '#CDB58A'] },
  { key: 'Refurbished', color: 0xD99A1E, tone: ['#E2D0AE', '#D6C29E'] },
  { key: 'Scrapped', color: 0xB3392B, tone: ['#BFA272', '#B0925F'] },
];
const MAX_SHOWN = 10;
const BOX_H = 0.62;

export async function initCrates(host, { counts = {}, tip, labels = [] } = {}) {
  const stage = await createStage(host, { camera: { fov: 36 } });
  if (!stage) return null;
  const { THREE, scene, camera, renderer } = stage;

  scene.add(new THREE.HemisphereLight(0xfff0dd, 0x14110f, 0.75));
  const key = new THREE.DirectionalLight(0xfff1dd, 1.5);
  key.position.set(4, 10, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xff5b1f, 1.6);
  rim.position.set(-6, 3, -6);
  scene.add(rim);

  const group = new THREE.Group();
  scene.add(group);

  // floor: a dark pallet grid
  const floor = new THREE.GridHelper(14, 14, 0x3a332d, 0x2a2420);
  floor.position.y = -0.01;
  group.add(floor);

  const boxes = [];   // every box, for the drop-in animation
  const hitMeshes = []; // one invisible column per stack, for hover
  const anchors = [];   // front-bottom point of each pallet, where its label goes
  STACKS.forEach((cfg, si) => {
    const x = (si - 1) * 3.1;
    const count = counts[cfg.key] || 0;
    const shown = Math.min(count, MAX_SHOWN);
    const tex = { top: parcelTopTexture(THREE, cfg.tone[0]), side: parcelSideTexture(THREE, cfg.tone[1]) };

    // coloured pallet under each stack, so the colour reads even with 0 boxes
    const pallet = new THREE.Mesh(
      new THREE.BoxGeometry(1.9, 0.14, 1.6),
      new THREE.MeshStandardMaterial({ color: cfg.color, roughness: 0.6, emissive: cfg.color, emissiveIntensity: 0.15 }),
    );
    pallet.position.set(x, 0.07, 0);
    group.add(pallet);
    const anchor = new THREE.Object3D();
    anchor.position.set(x, 0, 1.1);
    group.add(anchor);
    anchors.push(anchor);

    for (let i = 0; i < shown; i++) {
      const b = makeParcel(THREE, tex, [1.5, BOX_H, 1.25]);
      const y = 0.14 + BOX_H / 2 + i * BOX_H;
      b.userData = { x: x + (Math.random() - 0.5) * 0.14, y, z: (Math.random() - 0.5) * 0.12, delay: si * 0.15 + i * 0.09, rot: (Math.random() - 0.5) * 0.18 };
      b.position.set(b.userData.x, reducedMotion ? y : y + 9, b.userData.z);
      b.rotation.y = b.userData.rot;
      group.add(b);
      boxes.push(b);
    }
    // a band of grade colour on top of the stack
    const capY = 0.14 + shown * BOX_H;
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(1.56, 0.05, 1.31),
      new THREE.MeshStandardMaterial({ color: cfg.color, emissive: cfg.color, emissiveIntensity: 0.5 }),
    );
    cap.position.set(x, capY + 0.03, 0);
    cap.userData = { y: cap.position.y, delay: si * 0.15 + shown * 0.09, isCap: true, x, z: 0, rot: 0 };
    if (!reducedMotion) cap.position.y += 9;
    group.add(cap);
    boxes.push(cap);

    const hit = new THREE.Mesh(
      new THREE.BoxGeometry(1.9, Math.max(1, capY + 0.4), 1.6),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    hit.position.set(x, Math.max(1, capY + 0.4) / 2, 0);
    hit.userData = { key: cfg.key, count };
    group.add(hit);
    hitMeshes.push(hit);
  });

  stage.onResize = (w, h) => {
    const aspect = w / h;
    const dist = aspect < 0.9 ? 15 : aspect < 1.4 ? 12.5 : 10;
    camera.position.set(0, dist * 0.5, dist);
    camera.lookAt(0, aspect < 0.9 ? 2.6 : 1.6, 0);
  };
  stage.onResize(stage.width, stage.height);

  // ---------- hover tooltip ----------
  const ray = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let hovering = false;
  renderer.domElement.addEventListener('pointermove', (e) => {
    const r = renderer.domElement.getBoundingClientRect();
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    const hit = ray.intersectObjects(hitMeshes)[0];
    hovering = !!hit;
    if (!tip) return;
    if (hit) {
      const { key, count } = hit.object.userData;
      tip.textContent = `${key}: ${count} unit${count === 1 ? '' : 's'}`;
      tip.style.left = `${e.clientX - r.left}px`;
      tip.style.top = `${e.clientY - r.top}px`;
      tip.hidden = false;
    } else {
      tip.hidden = true;
    }
  });
  renderer.domElement.addEventListener('pointerleave', () => { hovering = false; if (tip) tip.hidden = true; });

  let t0 = null;
  stage.update = (dt, time) => {
    if (t0 === null) t0 = time;
    const since = time - t0;
    boxes.forEach((b) => {
      const d = b.userData;
      const p = Math.min(1, Math.max(0, (since - d.delay) / 0.7));
      b.position.y = d.y + (1 - ease.outBack(p)) * 9 * (p < 1 ? 1 : 0);
    });
    // slow idle sway, paused while the user hovers a stack
    if (!hovering) group.rotation.y += (Math.sin(time * 0.25) * 0.35 - group.rotation.y) * Math.min(1, dt);

    // keep each count label under its pallet
    labels.forEach((el, i) => {
      anchors[i].getWorldPosition(v).project(camera);
      el.style.transform = `translate(${(v.x * 0.5 + 0.5) * stage.width}px, ${(-v.y * 0.5 + 0.5) * stage.height}px) translate(-50%, 8px)`;
    });
  };
  const v = new THREE.Vector3();

  if (reducedMotion) stage.renderOnce();
  else stage.start();
  return stage;
}
