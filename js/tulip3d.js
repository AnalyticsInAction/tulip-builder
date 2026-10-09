// Animated 3D build of the red tulip, one brick at a time.
//
// The model bundle (models/red-tulip.bin, encrypted) holds a build script and
// the geometry of each distinct brick. Everything on screen is a pure function
// of the timeline position, so it can be played forwards, backwards or
// scrubbed.

import * as THREE from 'three';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { LDrawLoader } from '../vendor/three/LDrawLoader.js';
import { LDrawConditionalLineMaterial } from '../vendor/three/LDrawConditionalLineMaterial.js';
import { RoomEnvironment } from '../vendor/three/RoomEnvironment.js';
import { loadFamilyKey, decryptJson } from './vault.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const PART_TIME = 1.15;   // seconds for one brick to fly in and seat
const PART_GAP = 0.2;
const ATTACH_TIME = 1.7;  // a finished sub-assembly swinging into place
const STEP_PAUSE = 0.9;
const BLOOM_TIME = 7;     // the finale: petals open and close once

// ---- load -----------------------------------------------------------------

async function loadBundle() {
  if (params.has('dev')) return (await fetch('models/red-tulip.bundle.json')).json();
  const key = await loadFamilyKey();
  if (!key) throw new Error('This is a private family page. Open it with the family link to unlock it.');
  const res = await fetch('models/red-tulip.bin');
  if (!res.ok) throw new Error('The 3D model could not be loaded.');
  return decryptJson(key, await res.arrayBuffer());
}

function parseLDraw(text) {
  const loader = new LDrawLoader();
  loader.setConditionalLineMaterial(LDrawConditionalLineMaterial);
  loader.smoothNormals = true;
  return new Promise((resolve, reject) => loader.parse(text, resolve, reject));
}

// ---- maths ----------------------------------------------------------------

const mat = (rows) => new THREE.Matrix4().set(...rows); // the model stores row-major 4x4
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
// travel that slightly overshoots and settles, like a brick being pressed home
const seat = (x) => { const c = 1.35; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };

const tmp = { p1: new THREE.Vector3(), p2: new THREE.Vector3(), q1: new THREE.Quaternion(), q2: new THREE.Quaternion(), s1: new THREE.Vector3(), s2: new THREE.Vector3() };
function blend(a, b, k, out) {
  a.decompose(tmp.p1, tmp.q1, tmp.s1);
  b.decompose(tmp.p2, tmp.q2, tmp.s2);
  return out.compose(tmp.p1.lerp(tmp.p2, k), tmp.q1.slerp(tmp.q2, k), tmp.s1.lerp(tmp.s2, k));
}

// ---- scene ----------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ canvas: $('stage'), antialias: true, alpha: true, preserveDrawingBuffer: params.has('dev') });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
scene.add(new THREE.HemisphereLight(0xffffff, 0x59666d, 0.9));
const sun = new THREE.DirectionalLight(0xfff4e6, 2.4);
sun.position.set(110, 760, 240);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -420, right: 420, top: 520, bottom: -520, near: 50, far: 2200 });
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 1.2;
sun.shadow.radius = 9;
sun.shadow.blurSamples = 16;
scene.add(sun, sun.target);

const camera = new THREE.PerspectiveCamera(32, 1, 5, 9000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.minPolarAngle = 0.15;
controls.maxPolarAngle = Math.PI * 0.6;
controls.autoRotateSpeed = 0.7;
controls.zoomSpeed = 0.8;
camera.position.set(170, 110, 420);

const world = new THREE.Group(); // inside here everything is in LDraw units, where -Y is up
world.rotation.x = Math.PI;
scene.add(world);

// ---- model ----------------------------------------------------------------

let model, parts = [], groups = {}, events = [], stepStart = [], total = 0, buildEnd = 0;
let time = 0, direction = 0, speed = 1, bloomManual = null, started = false;
let zoomFactor = 1, focusH = 150, focusW = 120, lastSeated = -1;
const focus = new THREE.Vector3();

function build(bundle, palette) {
  model = bundle.model;
  const templates = {};
  model.palette.forEach((key, i) => { templates[key] = palette.children[i]; });

  for (const g of model.groups) {
    const node = new THREE.Group();
    node.matrixAutoUpdate = false;
    groups[g.id] = { ...g, node, final: mat(g.final), stage: g.stage && mat(g.stage), event: null,
      hinge: g.hinge && { point: new THREE.Vector3(...g.hinge.point), axis: new THREE.Vector3(...g.hinge.axis), open: THREE.MathUtils.degToRad(g.hinge.open) } };
  }
  for (const g of Object.values(groups)) (g.parent ? groups[g.parent].node : world).add(g.node);

  parts = model.parts.map((p, index) => {
    const node = templates[`${p.part}|${p.colour}`].clone();
    node.matrixAutoUpdate = false;
    const materials = [];
    node.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
      for (const m of [].concat(o.material)) {
        m.roughness = 0.28;
        m.envMapIntensity = 1;
        materials.push(m);
      }
    });
    groups[p.group].node.add(node);
    const from = new THREE.Vector3(...p.from);
    const template = templates[`${p.part}|${p.colour}`];
    template.userData.sphere = template.userData.sphere || new THREE.Box3().setFromObject(template).getBoundingSphere(new THREE.Sphere());
    return { ...p, index, node, materials, rest: mat(p.matrix), from, sphere: template.userData.sphere, axis: from.lengthSq() ? from.clone().normalize() : new THREE.Vector3(0, -1, 0) };
  });

  const ground = new THREE.Mesh(new THREE.CircleGeometry(900, 64), new THREE.ShadowMaterial({ opacity: 0.2 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -model.ground;
  ground.receiveShadow = true;
  scene.add(ground);
  sun.target.position.set(0, -model.ground + 250, 0);

  buildTimeline();
}

// Bricks go in one at a time. A sub-assembly is put together beside the model
// and then swings into place; repeats of the same sub-assembly go a bit faster.
function buildTimeline() {
  let t = 0.4;
  const seen = {};
  model.steps.forEach((title, s) => {
    stepStart[s] = t;
    for (const g of Object.values(groups)) {
      if (g.attach_step === s) {
        g.event = { kind: 'group', group: g, t0: t, dur: ATTACH_TIME * 1.5, step: s };
        events.push(g.event);
        t += g.event.dur + 0.3;
      }
    }
    const inStep = parts.filter((p) => p.step === s);
    const order = [...new Set(inStep.map((p) => p.group))];
    for (const gid of order) {
      const g = groups[gid];
      const staged = g.stage && g.attach_step === undefined;
      const pace = staged && seen[g.title] ? 0.62 : 1;
      for (const p of inStep.filter((q) => q.group === gid)) {
        p.event = { kind: 'part', part: p, t0: t, dur: PART_TIME * pace, step: s };
        events.push(p.event);
        t += (PART_TIME + PART_GAP) * pace;
      }
      if (staged) {
        g.event = { kind: 'group', group: g, t0: t + 0.15, dur: ATTACH_TIME * pace, step: s };
        events.push(g.event);
        t += 0.15 + ATTACH_TIME * pace + 0.25;
        seen[g.title] = true;
      }
    }
    t += STEP_PAUSE;
  });
  buildEnd = t;
  total = buildEnd + BLOOM_TIME;
}

// ---- one frame of the build, as a function of time ------------------------

const m1 = new THREE.Matrix4(), m2 = new THREE.Matrix4(), v1 = new THREE.Vector3(), q1 = new THREE.Quaternion();

function bloomAt(t) {
  if (bloomManual !== null) return bloomManual;
  if (t <= buildEnd) return 0;
  const x = clamp01((t - buildEnd - 0.8) / (BLOOM_TIME - 1.6));
  return Math.sin(Math.PI * easeInOut(x)) ** 2;
}

function pose(t) {
  const bloom = bloomAt(t);
  for (const g of Object.values(groups)) {
    const k = g.stage ? clamp01((t - g.event.t0) / g.event.dur) : 1;
    if (k >= 1) g.node.matrix.copy(g.final);
    else if (k <= 0) g.node.matrix.copy(g.stage);
    else blend(g.stage, g.final, easeInOut(k), g.node.matrix);
    if (g.hinge && bloom > 0 && k >= 1) {
      // swing the petal out about the bar its clip grips
      m1.makeTranslation(g.hinge.point).multiply(m2.makeRotationAxis(g.hinge.axis, g.hinge.open * bloom))
        .multiply(m2.makeTranslation(v1.copy(g.hinge.point).negate()));
      g.node.matrix.premultiply(m1);
    }
  }
  for (const p of parts) {
    const k = (t - p.event.t0) / p.event.dur;
    p.node.visible = k > 0;
    if (k <= 0) continue;
    if (k >= 1) {
      p.node.matrix.copy(p.rest);
    } else {
      const away = 1 - seat(clamp01(k / 0.82));
      const grow = easeOut(clamp01(k / 0.18));
      v1.setFromMatrixPosition(p.rest);
      // spin about the direction it arrives from, shrink in from nothing, then slide home
      m1.makeTranslation(v1).multiply(m2.makeRotationAxis(p.axis, away * 1.1)).multiply(m2.makeScale(grow, grow, grow))
        .multiply(m2.makeTranslation(-v1.x, -v1.y, -v1.z));
      p.node.matrix.makeTranslation(p.from.x * away, p.from.y * away, p.from.z * away).multiply(m1).multiply(p.rest);
    }
    const glow = k < 1 ? 0.42 : Math.max(0, 0.42 * (1 - (k - 1) * p.event.dur / 0.5));
    for (const m of p.materials) m.emissive.copy(m.color).multiplyScalar(glow);
  }
  world.updateMatrixWorld(true);
}

// What the camera should be looking at: every brick on screen, or just the
// flower head once the build is finished.
const box = new THREE.Box3(), ballBox = new THREE.Box3(), ball = new THREE.Sphere();
function frameTarget(t) {
  box.makeEmpty();
  const finale = t > buildEnd;
  for (const p of parts) {
    if (!p.node.visible || (finale && p.group === 'stem')) continue;
    // the brick's own size counts, so long parts like the petals and the stem stay in view
    ball.copy(p.sphere).applyMatrix4(p.node.matrixWorld);
    box.union(ball.getBoundingBox(ballBox));
  }
  if (box.isEmpty()) box.expandByPoint(v1.set(0, -model.ground + 150, 0));
  box.getCenter(v1);
  box.getSize(tmp.s1);
  // half the height, and half the widest it can look from any side
  return { centre: v1, halfH: Math.max(70, tmp.s1.y / 2), halfW: Math.max(60, Math.hypot(tmp.s1.x, tmp.s1.z) / 2) };
}

function currentEvent(t) {
  let found = events[0];
  for (const e of events) if (e.t0 <= t) found = e;
  return found;
}

// ---- interface ------------------------------------------------------------

function stepAt(t) {
  let s = 0;
  stepStart.forEach((start, i) => { if (t >= start - 0.01) s = i; });
  return s;
}

function updateInterface() {
  const s = stepAt(time);
  const finished = time >= buildEnd;
  $('step-title').textContent = finished ? 'Red tulip, built!' : `Step ${s + 1}: ${model.steps[s]}`;
  $('step-count').textContent = `Step ${s + 1} of ${model.steps.length}`;
  const placed = parts.filter((p) => time >= p.event.t0).length;
  const e = currentEvent(time);
  $('part-name').textContent = finished ? 'Watch it open 🌷'
    : e.kind === 'part' ? e.part.name : e.group.attach_step !== undefined ? 'Tipping the flower onto its stem' : `Fitting the ${e.group.title.toLowerCase()}`;
  $('part-count').textContent = `${placed} of ${parts.length} bricks`;
  [...$('steps').children].forEach((b, i) => {
    b.classList.toggle('done', i < s || finished);
    b.classList.toggle('now', i === s && !finished);
  });
  if (document.activeElement !== $('scrub')) $('scrub').value = Math.round((time / total) * 1000);
  $('play').textContent = direction === 1 ? '⏸' : '▶';
  $('reverse').textContent = direction === -1 ? '⏸' : '◀';
  $('bloom-row').hidden = time < groups.petal3.event.t0 + groups.petal3.event.dur;
  if (bloomManual === null) $('bloom').value = Math.round(bloomAt(time) * 100);
}

function seek(t) {
  time = Math.min(total, Math.max(0, t));
  lastSeated = events.filter((e) => e.kind === 'part' && e.t0 + e.dur * 0.82 <= time).length;
}

function play(dir) {
  direction = direction === dir ? 0 : dir;
  if (direction === 1 && time >= total) seek(0);
  if (direction !== 0) bloomManual = null;
}

function setupInterface() {
  model.steps.forEach((title, i) => {
    const b = document.createElement('button');
    b.textContent = i + 1;
    b.title = title;
    b.setAttribute('aria-label', `Go to step ${i + 1}: ${title}`);
    b.addEventListener('click', () => { direction = 0; bloomManual = null; seek(stepStart[i]); });
    $('steps').append(b);
  });
  $('play').addEventListener('click', () => play(1));
  $('reverse').addEventListener('click', () => play(-1));
  $('prev').addEventListener('click', () => { const s = stepAt(time); direction = 0; bloomManual = null; seek(stepStart[time - stepStart[s] > 0.6 ? s : Math.max(0, s - 1)]); });
  $('next').addEventListener('click', () => { const s = stepAt(time); direction = 0; bloomManual = null; seek(s + 1 < stepStart.length ? stepStart[s + 1] : buildEnd); });
  $('speed').addEventListener('change', (e) => { speed = parseFloat(e.target.value); });
  $('scrub').addEventListener('input', (e) => { direction = 0; bloomManual = null; seek((e.target.value / 1000) * total); });
  $('bloom').addEventListener('input', (e) => { bloomManual = e.target.value / 100; });
  $('sound').addEventListener('click', () => { muted = !muted; $('sound').textContent = muted ? '🔇' : '🔊'; });
  $('start-button').addEventListener('click', () => { $('start').hidden = true; started = true; unlockSound(); play(1); });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('select')) return;
    if (e.key === ' ') { e.preventDefault(); play(1); }
    if (e.key === 'ArrowRight') $('next').click();
    if (e.key === 'ArrowLeft') $('prev').click();
  });
}

// ---- sound: a small click as each brick seats -----------------------------

let audio = null, muted = false;
function unlockSound() {
  try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch { audio = null; }
}
function click() {
  if (!audio || muted) return;
  const now = audio.currentTime;
  const osc = audio.createOscillator(), gain = audio.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(1500 + Math.random() * 500, now);
  osc.frequency.exponentialRampToValueAtTime(280, now + 0.05);
  gain.gain.setValueAtTime(0.16, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
  osc.connect(gain).connect(audio.destination);
  osc.start(now);
  osc.stop(now + 0.08);
}

// ---- loop -----------------------------------------------------------------

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (direction !== 0) {
    seek(time + direction * dt * speed);
    if (time >= total || time <= 0) direction = 0;
  }
  const seated = events.filter((e) => e.kind === 'part' && e.t0 + e.dur * 0.82 <= time).length;
  if (direction === 1 && seated > lastSeated) click();
  lastSeated = seated;

  pose(time);

  // follow the build: ease the look-at point and distance, keep the user's angle and zoom
  const want = frameTarget(time);
  const ease = started ? 1 - Math.exp(-dt * 2.6) : 1;
  focus.lerp(want.centre, ease);
  focusH += (want.halfH - focusH) * ease;
  focusW += (want.halfW - focusW) * ease;
  const before = camera.position.distanceTo(controls.target);
  controls.autoRotate = direction !== 0 || time >= buildEnd;
  controls.update();
  const after = camera.position.distanceTo(controls.target);
  zoomFactor = THREE.MathUtils.clamp(zoomFactor * (after / before), 0.35, 2.5);
  // fit the build into the part of the screen above the control panel
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const clear = window.innerHeight > window.innerWidth ? 0.66 : 0.72; // share of the height that is free
  const fit = 1.12 * Math.max(focusH / (tan * clear), focusW / (tan * camera.aspect)) + focusW;
  const lift = fit * tan * (1 - clear) * 0.8;
  v1.copy(camera.position).sub(controls.target).setLength(fit * zoomFactor);
  controls.target.copy(focus).y -= lift;
  camera.position.copy(controls.target).add(v1);
  camera.lookAt(controls.target);

  renderer.render(scene, camera);
  updateInterface();
  window.done = true;
  requestAnimationFrame(frame);
}

async function main() {
  try {
    const bundle = await loadBundle();
    const palette = await parseLDraw(bundle.ldraw);
    if (palette.children.length !== bundle.model.palette.length) throw new Error('The 3D model did not load completely.');
    build(bundle, palette);
  } catch (err) {
    console.error(err);
    $('message').textContent = err.message || 'The 3D model could not be loaded.';
    window.done = true;
    return;
  }
  $('message').hidden = true;
  $('panel').hidden = false;
  setupInterface();
  resize();
  window.addEventListener('resize', resize);

  // test hooks: ?t=<seconds>&az=<deg>&el=<deg> shows one moment without the start screen
  window.tulip = { seek, get total() { return total; }, get buildEnd() { return buildEnd; }, stepStart, setBloom: (b) => { bloomManual = b; } };
  if (params.has('t')) {
    started = false;
    seek(parseFloat(params.get('t')));
    const az = THREE.MathUtils.degToRad(parseFloat(params.get('az') || '25')), el = THREE.MathUtils.degToRad(parseFloat(params.get('el') || '14'));
    camera.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(400);
  } else {
    $('start').hidden = false;
  }
  focus.copy(frameTarget(time).centre);
  requestAnimationFrame(frame);
}

main();
