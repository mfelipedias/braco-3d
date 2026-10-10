// Simulador: cena three.js, cinemática do braço, colisões, teclado e gestos.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshBVH } from 'three-mesh-bvh';
import {
  JOINTS, jointName, POSE_REF, SAFE, MODELS, KEY_STORE, DEFAULT_KEYS, HOLD_DELAY, HOLD_INTERVAL,
  GESTURE_STORE, GESTURE_STABLE, GESTURE_INTERVAL, PREDICT_EVERY, GESTURE_SMOOTH, TM_SCRIPTS,
  CART, DEFAULT_GESTURES, hintFor,
} from './config.js';
import { say, setupTabs, setupPanels, setupHelp, loadProgress, loadDone, loadFailed } from './ui.js';

const { degToRad, radToDeg, clamp } = THREE.MathUtils;
const $ = (id) => document.getElementById(id);

setupTabs();
setupPanels();
const showHelpFirstTime = setupHelp();

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });  // fundo vem do CSS
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 50);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.minDistance = 0.3;
controls.maxDistance = 6;
controls.maxPolarAngle = Math.PI * 0.495;  // não deixa a câmera passar para baixo do chão

// Bancada: braço e vidrarias ficam neste grupo, apoiado na superfície da mesa (y = altura do tampo)
const bench = new THREE.Group();
scene.add(bench);
const home = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
function frameBench(h) {
  bench.position.y = h;
  home.pos.set(-0.1, h + 0.65, 1.35);
  home.target.set(0.12, h + 0.15, 0);
  camera.position.copy(home.pos);
  controls.target.copy(home.target);
  controls.update();
}
frameBench(0.75);

const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(-1.4, 3.75, 2);
sun.target.position.set(0.1, 0.75, 0);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0005;
Object.assign(sun.shadow.camera, { left: -1.1, right: 1.1, top: 1.1, bottom: -1.1 });
scene.add(sun, sun.target);

const floor = new THREE.Mesh(new THREE.CircleGeometry(3, 64), new THREE.ShadowMaterial({ opacity: 0.18 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// Geometria do braço (m), lida dos nós do GLB para acompanhar a ESCALA usada em gerar_braco.py
let SHOULDER_Y, L1, L2, PIVOT_X, FINGER_Y, PAD, GRIP_FROM_J4, PAD_R, PAD_A, TIP_REACH;
function readArmGeometry(arm) {
  const y = (n) => arm.getObjectByName(n).position.y;
  SHOULDER_Y = y('J1_Base') + y('J2_Ombro');
  L1 = y('J3_Cotovelo');
  L2 = y('J4_Punho');
  const k = L1 / 0.36;                                            // escala em relação às medidas 1:1 do script
  const dedo = arm.getObjectByName('J6_Dedo_D').position;
  PIVOT_X = dedo.x;
  FINGER_Y = dedo.y;
  PAD = { x: -0.0061 * k, z: 0.108 * k };                         // ponto de contato da almofada no dedo
  TIP_REACH = 0.065 * k;                                          // quanto a ponta do dedo passa do ponto de pega
  GRIP_FROM_J4 = y('J5_Rotacao') + FINGER_Y + PAD.z;              // punho → centro da pega
  PAD_R = Math.hypot(PAD.x, PAD.z);
  PAD_A = Math.atan2(-PAD.x, PAD.z);
}

const SPEED = +(new URLSearchParams(location.search).get('vel') ?? 1) || 1;  // ?vel=2 acelera as animações

const q = POSE_REF.slice();
let nodes, inputs, readouts, j5, held = null, busy = false;
const items = [];
const anims = [];

function applyQ() {
  JOINTS.forEach((j, i) => {
    if (i === 5 && held?.fingers) setFingers(held.fingers.d, held.fingers.e);  // cada dedo parado no seu contato
    else j.apply(nodes[i], degToRad(q[i]));
    inputs[i].value = q[i];
    const v = Math.round(q[i]);
    readouts[i].textContent = `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}°`;
    readouts[i].parentElement.parentElement.classList.toggle('limit', q[i] <= j.min + 0.5 || q[i] >= j.max - 0.5);
  });
}

// Abertura da garra (graus) para que as almofadas fiquem a `gap` metros uma da outra
function fingerForGap(gap) {
  const s = clamp((gap / 2 - PIVOT_X) / PAD_R, -1, 1);
  return clamp(radToDeg(Math.asin(s) + PAD_A), -5, 40);
}

// IK planar: ponto de pega a `r` m do eixo e `h` m de altura, garra apontando a3 graus a partir da vertical
function ik(r, h, onlyA3) {
  const list = onlyA3 !== undefined ? [onlyA3] : Array.from({ length: 25 }, (_, i) => 90 + i * 2.5);
  for (const a3 of list) {
    const a = degToRad(a3);
    const wr = r - GRIP_FROM_J4 * Math.sin(a), wz = h - GRIP_FROM_J4 * Math.cos(a) - SHOULDER_Y;
    const c = (wr * wr + wz * wz - L1 * L1 - L2 * L2) / (2 * L1 * L2);
    if (Math.abs(c) > 1) continue;
    const t3 = Math.acos(c);  // cotovelo para cima
    const a1 = Math.atan2(wr, wz) - Math.atan2(L2 * Math.sin(t3), L1 + L2 * Math.cos(t3));
    const sol = [a1, t3, a - a1 - t3].map(radToDeg);
    if (sol.every((v, i) => v > JOINTS[i + 1].min + 1 && v < JOINTS[i + 1].max - 1)) return { sol, a3 };
  }
  return null;
}

function tween(to, ms) {
  const from = q.slice();
  const delta = Math.max(...to.map((v, i) => Math.abs(v - from[i])));
  const dur = (ms ?? Math.max(350, delta * 14)) / SPEED;
  return new Promise((res) => {
    const t0 = performance.now();
    anims.push((now) => {
      const t = clamp((now - t0) / dur, 0, 1);
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      to.forEach((v, i) => q[i] = from[i] + (v - from[i]) * e);
      applyQ();
      if (t >= 1) { res(); return true; }
    });
  });
}

function plan(pos, item) {
  const r = Math.hypot(pos.x, pos.z), psi = radToDeg(Math.atan2(-pos.z, pos.x));
  const h = pos.y + item.userData.grip_height, d = item.userData.grip_diameter;
  const grip = ik(r, h);
  if (!grip) return null;
  const back = d / 2 + TIP_REACH + 0.015;  // recuo para as pontas dos dedos não tocarem o vidro na aproximação
  const app = ik(r - back, h), above = ik(r - back - 0.02, h + 0.06);
  const lift = ik(r - 0.02, h + 0.10, grip.a3) ?? ik(r - 0.02, h + 0.10);
  if (!app || !above || !lift) return null;
  return { psi, grip: grip.sol, app: app.sol, above: above.sol, lift: lift.sol,
           open: fingerForGap(d + 0.03), close: fingerForGap(d - 0.001) };
}

const pose = (psi, arm, finger) => [psi, ...arm, 90, finger];

function refreshButtons() {
  for (const li of document.querySelectorAll('#items li')) {
    li.querySelector('button').disabled = busy || !!held;
    li.classList.toggle('held', held?.item === li.item);
  }
  $('devolver').disabled = busy || !held;
  for (const id of ['ref', 'zero']) $(id).disabled = busy;
}

async function run(fn) {
  busy = true; refreshButtons();
  try { await fn(); } finally { busy = false; refreshButtons(); }
}

function pick(item) {
  if (busy || held) return;
  const from = item.position.clone();
  const p = plan(from, item);
  if (!p) return say(`${item.userData.nome} está fora do alcance do braço`, 'warn');
  run(async () => {
    say(`Pegando ${item.userData.nome}…`);
    await tween(pose(q[0], SAFE, p.open));
    await tween(pose(p.psi, SAFE, p.open));
    await tween(pose(p.psi, p.above, p.open));
    await tween(pose(p.psi, p.app, p.open));
    await tween(pose(p.psi, p.grip, p.open));
    await tween(pose(p.psi, p.grip, p.close), 500);
    held = { item, from, quat: item.quaternion.clone(), angle: p.close };
    j5.attach(item);
    await tween(pose(p.psi, p.lift, p.close));
    say(`${item.userData.nome} na garra`, 'ok');
  });
}

function devolver() {
  if (busy || !held) return;
  const { item, from } = held;
  const p = plan(from, item);
  run(async () => {
    say(`Devolvendo ${item.userData.nome}…`);
    await tween(pose(p.psi, p.lift, q[5]));
    await tween(pose(p.psi, p.grip, q[5]));
    bench.attach(item);
    item.position.copy(from);
    item.quaternion.copy(held.quat);
    held = null;
    await tween(pose(p.psi, p.grip, p.open), 500);
    await tween(pose(p.psi, p.app, p.open));
    await tween(pose(p.psi, p.above, p.open));
    await tween(pose(p.psi, SAFE, 10));
    say(`${item.userData.nome} devolvida`, 'ok');
  });
}

// ---------------------------------------------------------------- colisões
// Testes com as malhas reais (BVH). Cenário fixo: tampo da mesa, vidrarias paradas e o chão.
// Partes móveis: tudo que está abaixo de J1_Base (+ a vidraria presa na garra).
let collisionsOn = true;
let armMeshes = [], tableTop = null, tableBounds = null;
const fingerMeshes = { d: [], e: [] };
const _m = new THREE.Matrix4(), _boxA = new THREE.Box3(), _boxB = new THREE.Box3();

function prepare(mesh) {
  const g = mesh.geometry;
  g.boundsTree ??= new MeshBVH(g);
  if (!g.boundingBox) g.computeBoundingBox();
}

function setupCollisions(arm, mesa) {
  const meshesUnder = (name) => {
    const out = [];
    arm.getObjectByName(name).traverse((o) => o.isMesh && out.push(o));
    return out;
  };
  armMeshes = meshesUnder('J1_Base');
  fingerMeshes.d = meshesUnder('J6_Dedo_D');
  fingerMeshes.e = meshesUnder('J6_Dedo_E');
  tableTop = mesa.getObjectByName('Mesa_Tampo');
  for (const it of items) {
    it.userData.colliders = [];
    it.traverse((o) => o.isMesh && o.userData.collider && it.userData.colliders.push(o));
  }
  [...armMeshes, tableTop, ...items.flatMap((it) => it.userData.colliders)].forEach(prepare);
  scene.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(tableTop);  // limites do tampo no referencial da bancada (x, z)
  tableBounds = { x0: b.min.x - bench.position.x, x1: b.max.x - bench.position.x,
                  z0: b.min.z - bench.position.z, z1: b.max.z - bench.position.z };
}

const ownerItem = (o) => { while (o && !items.includes(o)) o = o.parent; return o; };
const staticColliders = () => [tableTop, ...items.filter((it) => it !== held?.item).flatMap((it) => it.userData.colliders)];
const movingMeshes = () => held ? [...armMeshes, ...held.item.userData.colliders] : armMeshes;
const worldBox = (mesh, box) => box.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);

function findCollision(moving, statics = staticColliders()) {
  bench.updateMatrixWorld(true);
  for (const m of moving) {
    worldBox(m, _boxA);
    if (_boxA.min.y < 0.002) return { what: 'o chão', moving: m };
    for (const s of statics) {
      if (!_boxA.intersectsBox(worldBox(s, _boxB))) continue;
      _m.copy(s.matrixWorld).invert().multiply(m.matrixWorld);
      if (s.geometry.boundsTree.intersectsGeometry(m.geometry, _m)) return { static: s, moving: m };
    }
  }
  return null;
}

function describe(hit) {
  if (hit.what) return hit.what;
  if (hit.static === tableTop) return 'a mesa';
  return ownerItem(hit.static)?.userData.nome ?? hit.static.name;
}

// Move as juntas até `target` (vetor de 6 ângulos) em passos pequenos, para não atravessar paredes finas
// de vidro; na primeira colisão faz busca binária e para encostado.
function moveTo(target) {
  const prev = q.slice();
  const set = (t) => { for (let i = 0; i < q.length; i++) q[i] = prev[i] + (target[i] - prev[i]) * t; applyQ(); };
  const delta = Math.max(...target.map((v, i) => Math.abs(v - prev[i])));
  if (!collisionsOn || delta === 0 || findCollision(movingMeshes())) return set(1);
  const n = Math.max(1, Math.ceil(delta / 1.5));
  let free = 0;
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    set(t);
    const hit = findCollision(movingMeshes());
    if (!hit) { free = t; continue; }
    let lo = free, hi = t;
    for (let it = 0; it < 8; it++) {
      const mid = (lo + hi) / 2;
      set(mid);
      if (findCollision(movingMeshes())) hi = mid; else lo = mid;
    }
    set(lo);
    say(`Colisão com ${describe(hit)}`, 'warn');
    return false;
  }
  return true;
}

function moveJoint(i, value) {
  const target = q.slice();
  target[i] = value;
  return moveTo(target);
}

// Ponto de pega atual no plano do braço: distância ao eixo da base (r), altura (h) e direção da garra (a3)
function gripperPlanar() {
  const a1 = degToRad(q[1]), a2 = a1 + degToRad(q[2]), a3 = a2 + degToRad(q[3]);
  return {
    r: L1 * Math.sin(a1) + L2 * Math.sin(a2) + GRIP_FROM_J4 * Math.sin(a3),
    h: SHOULDER_Y + L1 * Math.cos(a1) + L2 * Math.cos(a2) + GRIP_FROM_J4 * Math.cos(a3),
    a3: radToDeg(a3),
  };
}

// Move a garra em linha reta (subir/descer, avançar/recuar) mantendo a inclinação dela
function moveCartesian(dr, dh) {
  const g = gripperPlanar();
  const sol = ik(g.r + dr, g.h + dh, g.a3);
  if (!sol || sol.sol.some((v, k) => Math.abs(v - q[k + 1]) > 20)) {
    say('A garra não alcança além daqui nessa direção', 'warn');
    return false;
  }
  return moveTo([q[0], ...sol.sol, q[4], q[5]]);
}

function setFingers(dDeg, eDeg) {
  nodes[5].d.rotation.z = -degToRad(dDeg);
  nodes[5].e.rotation.z = degToRad(eDeg);
}

// Fecha um dedo de `from` até `to` e devolve onde ele encosta: ângulo, objeto e ponto de contato
function fingerContact(side, from, to) {
  const node = nodes[5][side], sign = side === 'd' ? -1 : 1, meshes = fingerMeshes[side];
  const set = (a) => { node.rotation.z = sign * degToRad(a); };
  const n = Math.max(1, Math.ceil((from - to) / 1.5));
  let free = from, hit = null, a = from;
  for (let k = 1; k <= n && !hit; k++) {
    a = from + (to - from) * k / n;
    set(a);
    hit = findCollision(meshes);
    if (!hit) free = a;
  }
  if (!hit) return null;
  let lo = a, hi = free;
  for (let it = 0; it < 10; it++) {
    const mid = (lo + hi) / 2;
    set(mid);
    const h = findCollision(meshes);
    if (h) { lo = mid; hit = h; } else hi = mid;
  }
  set(hi);
  const item = hit.static ? ownerItem(hit.static) : null;
  return { angle: hi, hit, item, point: item ? contactPoint(hit.static, meshes) : null };
}

// Ponto do objeto mais próximo do dedo, no referencial da vidraria (eixo da vidraria = Y local)
function contactPoint(s, meshes) {
  bench.updateMatrixWorld(true);
  let best = null;
  for (const m of meshes) {
    _m.copy(s.matrixWorld).invert().multiply(m.matrixWorld);
    const t1 = {}, t2 = {};
    if (s.geometry.boundsTree.closestPointToGeometry(m.geometry, _m, t1, t2) && (!best || t1.distance < best.distance)) best = t1;
  }
  return best ? best.point.clone().applyMatrix4(s.matrix) : null;
}

// Pega que faz sentido: os dois dedos tocam a mesma vidraria em lados opostos do eixo dela
function opposite(a, b) {
  if (!a.point || !b.point) return false;
  const la = Math.hypot(a.point.x, a.point.z), lb = Math.hypot(b.point.x, b.point.z);
  if (la < 0.004 || lb < 0.004) return false;
  return (a.point.x * b.point.x + a.point.z * b.point.z) / (la * lb) < -0.2;  // mais de ~100° entre os contatos
}

function moveGripper(target) {
  const cur = q[5];
  if (held) {
    if (target <= held.angle + 1.5) return say(`${held.item.userData.nome} presa na garra`);  // já está apertando
    if (!release()) return;
    return moveJoint(5, target);
  }
  if (target >= cur) return moveJoint(5, target);         // abrir
  const cD = fingerContact('d', cur, -5), cE = fingerContact('e', cur, -5);
  applyQ();
  const first = Math.max(cD?.angle ?? -Infinity, cE?.angle ?? -Infinity);
  if (target > first) { q[5] = target; applyQ(); return; }
  if (cD?.item && cD.item === cE?.item && Math.abs(cD.angle - cE.angle) <= 10 && opposite(cD, cE)) {
    return grasp(cD.item, cD.angle, cE.angle);
  }
  q[5] = first;
  applyQ();
  const touch = cD && cD.angle === first ? cD : cE;
  if (cD?.item && cD.item === cE?.item) say(`Os dedos não envolvem ${cD.item.userData.nome} por lados opostos — centralize a garra`, 'warn');
  else say(`A garra encostou em ${describe(touch.hit)}`, 'warn');
}

function grasp(item, aD, aE) {
  held = { item, from: item.position.clone(), quat: item.quaternion.clone(),
           angle: Math.max(aD, aE), fingers: { d: aD, e: aE } };
  j5.attach(item);
  q[5] = held.angle;
  applyQ();
  refreshButtons();
  say(`${item.userData.nome} presa na garra`, 'ok');
}

// Solta a vidraria: ela fica em pé e cai até o tampo, se estiver sobre a mesa e houver espaço
function release() {
  const { item } = held;
  const localPos = item.position.clone(), localQuat = item.quaternion.clone();
  bench.attach(item);
  const yaw = new THREE.Euler().setFromQuaternion(item.quaternion, 'YXZ').y;
  const fromY = Math.max(item.position.y, 0);
  item.rotation.set(0, yaw, 0);
  item.position.y = 0;
  const p = item.position, m = 0.02, tb = tableBounds;
  const onTable = p.x > tb.x0 + m && p.x < tb.x1 - m && p.z > tb.z0 + m && p.z < tb.z1 - m;
  const hit = onTable && findCollision(item.userData.colliders, staticColliders().filter((s) => s !== tableTop));
  if (!onTable || hit) {
    j5.add(item);
    item.position.copy(localPos);
    item.quaternion.copy(localQuat);
    say(onTable ? `Não há espaço: ${describe(hit)} está no caminho` : 'Leve a vidraria até cima da mesa antes de soltar', 'warn');
    return false;
  }
  held = null;
  item.position.y = fromY;
  const t0 = performance.now(), dur = Math.max(1, Math.sqrt(2 * fromY / 9.81) * 1000);
  anims.push((now) => {
    const t = Math.min((now - t0) / dur, 1);
    item.position.y = fromY * (1 - t * t);
    return t >= 1;
  });
  refreshButtons();
  say(`${item.userData.nome} solta`, 'ok');
  return true;
}

// ---------------------------------------------------------------- teclado
// Cada junta tem uma tecla para diminuir e outra para aumentar o ângulo, e o passo (graus por toque).
// Segurar a tecla repete o passo continuamente. A configuração fica salva neste navegador.
let keymap = loadKeys();
let capturing = null;          // { i, dir } enquanto espera a nova tecla
const pressed = new Map();     // code → { i, dir, last }

function loadKeys() {
  try {
    const k = JSON.parse(localStorage.getItem(KEY_STORE));
    if (Array.isArray(k) && k.length === DEFAULT_KEYS.length) return k;
  } catch {}
  return structuredClone(DEFAULT_KEYS);
}

function saveKeys() {
  try { localStorage.setItem(KEY_STORE, JSON.stringify(keymap)); } catch {}
}

// Nome da tecla: o caractere que ela digitava quando foi configurada (respeita o layout, ex. ABNT2)
function keyLabel(code, typed) {
  if (!code) return '—';
  if (typed) return typed;
  const names = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Espaço',
                  Enter: 'Enter', Tab: 'Tab', ShiftLeft: 'Shift E', ShiftRight: 'Shift D',
                  PageUp: 'PgUp', PageDown: 'PgDn', Home: 'Home', End: 'End', Insert: 'Ins' };
  if (names[code]) return names[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6).replace('Add', '+').replace('Subtract', '-');
  return code;
}

function findBinding(code) {
  for (let i = 0; i < keymap.length; i++) {
    if (keymap[i].dec === code) return { i, dir: -1 };
    if (keymap[i].inc === code) return { i, dir: 1 };
  }
  return null;
}

function nudge(i, dir) {
  if (!nodes || busy) return;
  const j = JOINTS[i];
  const target = clamp(q[i] + dir * keymap[i].step, j.min, j.max);
  if (target === q[i]) return;
  if (i === 5) moveGripper(target);
  else moveJoint(i, target);
}

function renderKeys() {
  const body = document.querySelector('#keys tbody');
  body.innerHTML = '';
  JOINTS.forEach((j, i) => {
    const tr = document.createElement('tr');
    const name = document.createElement('td');
    name.append(i === 5 ? 'Garra' : j.label);
    if (i === 5 || j.sub) name.append(Object.assign(document.createElement('small'), { textContent: i === 5 ? 'fecha / abre' : j.sub }));
    tr.append(name);
    for (const dir of ['dec', 'inc']) {
      const td = document.createElement('td');
      const b = document.createElement('button');
      const waiting = capturing && capturing.i === i && capturing.dir === dir;
      b.className = 'key' + (waiting ? ' waiting' : keymap[i][dir] ? '' : ' empty');
      b.textContent = waiting ? '…' : keyLabel(keymap[i][dir], keymap[i][dir + 'Txt']);
      b.title = `${dir === 'dec' ? 'Diminuir' : 'Aumentar'} ${jointName(j)}: clique e pressione a nova tecla`;
      b.onclick = () => { capturing = { i, dir }; renderKeys(); };
      td.append(b);
      tr.append(td);
      if (waiting) queueMicrotask(() => b.focus());
    }
    const td = document.createElement('td');
    const step = Object.assign(document.createElement('input'),
      { type: 'number', min: 0.1, max: 45, step: 0.5, value: keymap[i].step, title: 'Graus por toque' });
    step.setAttribute('aria-label', `Passo em graus de ${jointName(j)}`);
    step.onchange = () => {
      keymap[i].step = clamp(+step.value || DEFAULT_KEYS[i].step, 0.1, 45);
      step.value = keymap[i].step;
      saveKeys();
    };
    td.append(step);
    tr.append(td);
    body.append(tr);
    // teclas ao lado do nome de cada slider
    const kb = document.querySelector(`.joint[data-i="${i}"] .kb`);
    if (kb) {
      kb.replaceChildren(...['dec', 'inc'].filter((d) => keymap[i][d]).map((d) =>
        Object.assign(document.createElement('kbd'), { textContent: keyLabel(keymap[i][d], keymap[i][d + 'Txt']) })));
    }
  });
}

addEventListener('keydown', (e) => {
  if (capturing) {
    e.preventDefault();
    const { i, dir } = capturing;
    capturing = null;
    if (e.code === 'Backspace' || e.code === 'Delete') {
      keymap[i][dir] = keymap[i][dir + 'Txt'] = null;
    } else if (e.code !== 'Escape') {
      keymap.forEach((b, k) => ['dec', 'inc'].forEach((d) => {
        if (b[d] === e.code && !(k === i && d === dir)) {
          say(`A tecla ${keyLabel(b[d], b[d + 'Txt'])} saiu de “${jointName(JOINTS[k])}”`);
          b[d] = b[d + 'Txt'] = null;
        }
      }));
      keymap[i][dir] = e.code;
      keymap[i][dir + 'Txt'] = e.key.length === 1 && e.key !== ' ' ? e.key.toUpperCase() : null;
    }
    saveKeys();
    renderKeys();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (document.querySelector('dialog[open]')) return;
  const t = e.target;
  if ((t.tagName === 'INPUT' && t.type === 'number') || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
  const bind = findBinding(e.code);
  if (!bind) return;
  e.preventDefault();
  if (pressed.has(e.code)) return;
  pressed.set(e.code, { ...bind, last: performance.now() + HOLD_DELAY - HOLD_INTERVAL });
  nudge(bind.i, bind.dir);
});
addEventListener('keyup', (e) => pressed.delete(e.code));
addEventListener('blur', () => pressed.clear());

// Repete o passo das teclas seguradas no ritmo de HOLD_INTERVAL, independente do FPS
function holdKeys(now) {
  for (const p of pressed.values()) {
    for (let n = 0; now - p.last >= HOLD_INTERVAL && n < 6; n++) {
      p.last += HOLD_INTERVAL;
      nudge(p.i, p.dir);
    }
    if (now - p.last >= HOLD_INTERVAL) p.last = now;  // FPS muito baixo: não acumula atraso
  }
}

// ---------------------------------------------------------------- gestos (Teachable Machine + webcam)
// Modelo de imagem do Teachable Machine em modelo-gestos/ (model.json, weights.bin, metadata.json).
// Cada classe reconhecida dispara uma ação; o gesto precisa ficar estável por GESTURE_STABLE ms
// acima da confiança mínima, e a ação se repete a cada GESTURE_INTERVAL ms enquanto o gesto continuar.

// ação de uma classe: a escolhida pelo usuário ou, para classes novas, o padrão
const actionFor = (label) => gest.cfg.map[label] ?? DEFAULT_GESTURES[label] ?? '';

const gest = { model: null, webcam: null, labels: [], on: false, predicting: false, lastPred: 0,
               cand: null, active: null, lastAct: 0, cfg: loadGestureCfg() };

function loadGestureCfg() {
  try {
    const c = JSON.parse(localStorage.getItem(GESTURE_STORE));
    if (c && c.map) return c;
  } catch {}
  return { map: { ...DEFAULT_GESTURES }, thr: 0.85, cartMm: 5, control: true };
}
function saveGestureCfg() {
  try { localStorage.setItem(GESTURE_STORE, JSON.stringify(gest.cfg)); } catch {}
}

function actionLabel(id) {
  if (!id) return 'Nenhuma ação';
  if (CART[id]) return CART[id];
  const i = +id[1], j = JOINTS[i];
  if (i === 5) return id.endsWith('+') ? 'Garra: abrir' : 'Garra: fechar';
  return `${jointName(j)} ${id.endsWith('+') ? '+' : '−'}`;
}
const ACTIONS = ['', ...JOINTS.flatMap((_, i) => [`j${i}-`, `j${i}+`]), ...Object.keys(CART)];

function doAction(id) {
  if (!id || !nodes || busy) return;
  if (CART[id]) {
    const s = gest.cfg.cartMm / 1000;
    const [dr, dh] = { up: [0, s], down: [0, -s], fwd: [s, 0], back: [-s, 0] }[id];
    return moveCartesian(dr, dh);
  }
  nudge(+id[1], id.endsWith('+') ? 1 : -1);
}

function loadScript(src) {
  return new Promise((ok, err) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = ok;
    s.onerror = () => err(new Error(`não foi possível carregar ${src}`));
    document.head.append(s);
  });
}

function gestureStatus(t, error = false) {
  const el = $('gStatus');
  el.textContent = t;
  el.classList.toggle('err', error);
}

async function ensureTM() {
  if (window.tmImage) return;
  gestureStatus('Carregando TensorFlow.js…');
  for (const src of TM_SCRIPTS) await loadScript(src);
}

// Troca o modelo em uso (o padrão do servidor ou um carregado pelo usuário)
function setModel(model, name, custom) {
  const old = gest.model;
  gest.model = model;
  gest.labels = model.getClassLabels();
  gest.active = gest.cand = gest.smooth = null;
  $('gModelName').textContent = name;
  $('gModelName').title = name;
  $('gModelTag').hidden = !custom;
  $('gDefault').disabled = !custom;
  renderGestures();
  if (old && old !== gest.defaultModel) setTimeout(() => old.dispose?.(), 500);  // libera a memória do modelo anterior
}

async function startCamera() {
  const btn = $('gCam');
  if (!navigator.mediaDevices?.getUserMedia) {
    return gestureStatus('A câmera só funciona em HTTPS ou em http://localhost. Abra o simulador por um desses endereços.', true);
  }
  btn.disabled = true;
  try {
    await ensureTM();
    if (!gest.model) {
      gestureStatus('Carregando o modelo de gestos…');
      gest.defaultModel = await tmImage.load('modelo-gestos/model.json', 'modelo-gestos/metadata.json');
      setModel(gest.defaultModel, 'padrão', false);
    }
    gestureStatus('Permita o acesso à câmera no navegador…');
    gest.webcam = new tmImage.Webcam(224, 224, true);  // espelhada, como no Teachable Machine
    await gest.webcam.setup();
    await gest.webcam.play();
    const badge = Object.assign(document.createElement('div'), { id: 'gNow', className: 'gicon' });
    $('gVideo').replaceChildren(gest.webcam.canvas, badge);
    gest.on = true;
    btn.textContent = 'Desligar câmera';
    btn.classList.remove('primary');
    gestureStatus('Faça um gesto para a câmera');
  } catch (e) {
    const denied = e?.name === 'NotAllowedError';
    gestureStatus(denied ? 'Acesso à câmera negado. Libere a câmera nas permissões do site e tente de novo.'
                         : `Não foi possível ligar a câmera: ${e.message || e}`, true);
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------- modelo do usuário
// Aceita o .zip exportado pelo Teachable Machine (TensorFlow.js) ou os três arquivos soltos.
// Tudo é lido aqui no navegador: nada é enviado ao servidor e o modelo some ao recarregar a página.
const FFLATE = 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js';

async function modelFiles(list) {
  let files = [...list];
  if (files.some((f) => /\.tm$/i.test(f.name))) {
    throw new Error('o arquivo .tm é o projeto com as fotos de treino. Abra-o no Teachable Machine, ' +
                    'exporte o modelo (TensorFlow.js → Baixar meu modelo) e carregue o .zip gerado.');
  }
  const zip = files.find((f) => /\.zip$/i.test(f.name));
  if (zip) {
    const { unzipSync } = await import(FFLATE);
    const entries = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    files = Object.entries(entries).map(([path, data]) => new File([data], path.split('/').pop()));
  }
  const find = (re) => files.find((f) => re.test(f.name));
  const json = find(/^model\.json$/i) ?? find(/^(?!metadata).*\.json$/i);
  const meta = find(/metadata\.json$/i);
  const weights = find(/\.bin$/i);
  const missing = [!json && 'model.json', !meta && 'metadata.json', !weights && 'weights.bin'].filter(Boolean);
  if (missing.length) throw new Error(`faltou ${missing.join(', ')}. Use o .zip de “Exportar modelo → TensorFlow.js”.`);
  return { json, meta, weights, name: zip?.name ?? json.name };
}

async function loadUserModel(list) {
  if (!list?.length) return;
  const btn = $('gUpload');
  btn.disabled = true;
  try {
    gestureStatus('Lendo o modelo…');
    const f = await modelFiles(list);
    await ensureTM();
    gestureStatus('Carregando o modelo…');
    const model = await tmImage.loadFromFiles(f.json, f.weights, f.meta);
    setModel(model, f.name.replace(/\.zip$/i, ''), true);
    const unknown = gest.labels.filter((l) => !(l in DEFAULT_GESTURES) && !(l in gest.cfg.map));
    gestureStatus(gest.on ? 'Faça um gesto para a câmera' : 'Modelo pronto. Ligue a câmera para testar.');
    say(`Modelo carregado com ${gest.labels.length} gestos` +
        (unknown.length ? ` — escolha a ação de ${unknown.join(', ')}` : ''), unknown.length ? 'warn' : 'ok');
  } catch (e) {
    console.error(e);
    gestureStatus(`Não foi possível carregar o modelo: ${e.message || e}`, true);
  } finally {
    btn.disabled = false;
    $('gFile').value = '';
  }
}

function setupModelUpload() {
  const input = $('gFile'), panel = $('gPanel');
  $('gUpload').onclick = () => input.click();
  input.onchange = () => loadUserModel(input.files);
  $('gDefault').onclick = async () => {
    if (!gest.defaultModel) {
      await ensureTM();
      gest.defaultModel = await tmImage.load('modelo-gestos/model.json', 'modelo-gestos/metadata.json');
    }
    setModel(gest.defaultModel, 'padrão', false);
    say('Voltou para o modelo padrão', 'ok');
  };
  // arrastar o .zip até o painel de gestos também carrega
  let depth = 0;
  panel.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; panel.classList.add('drop'); });
  panel.addEventListener('dragover', (e) => e.preventDefault());
  panel.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; panel.classList.remove('drop'); } });
  panel.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    panel.classList.remove('drop');
    loadUserModel(e.dataTransfer.files);
  });
}

function stopCamera() {
  gest.on = false;
  gest.active = gest.cand = gest.smooth = null;
  gest.webcam?.stop();
  $('gVideo').replaceChildren();
  const btn = $('gCam');
  btn.textContent = 'Ligar câmera';
  btn.classList.add('primary');
  gestureStatus('');
  renderBars(null);
}

function renderGestures() {
  const box = $('gestos');
  box.innerHTML = '';
  for (const label of gest.labels) {
    const hint = hintFor(label);
    const row = document.createElement('div');
    row.className = 'g';
    row.dataset.label = label;
    const icon = document.createElement('span');
    icon.className = 'ic gicon';
    icon.innerHTML = hint.icon;
    const name = document.createElement('div');
    name.className = 'nm';
    name.append(Object.assign(document.createElement('b'), { textContent: label }),
                Object.assign(document.createElement('small'), { textContent: hint.how }));
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.innerHTML = '<i></i><b>0%</b>';
    const sel = document.createElement('select');
    sel.title = `Ação do gesto ${label}`;
    sel.setAttribute('aria-label', `Ação do gesto ${label}`);
    for (const id of ACTIONS) sel.append(new Option(actionLabel(id), id));
    sel.value = actionFor(label);
    sel.onchange = () => { gest.cfg.map[label] = sel.value; saveGestureCfg(); };
    row.append(icon, name, bar, sel);
    box.append(row);
  }
}

function renderBars(preds) {
  for (const row of document.querySelectorAll('#gestos .g')) {
    const p = preds?.find((x) => x.className === row.dataset.label)?.probability ?? 0;
    row.querySelector('.bar i').style.width = `${Math.round(p * 100)}%`;
    row.querySelector('.bar b').textContent = `${Math.round(p * 100)}%`;
    row.classList.toggle('active', !!preds && gest.active?.label === row.dataset.label);
  }
  // desenho do gesto reconhecido no canto do vídeo
  const now = $('gNow');
  if (now) now.innerHTML = preds && gest.active ? hintFor(gest.active.label).icon : '';
}

function onPrediction(raw, now) {
  if (!gest.on) return;
  // média móvel exponencial: um quadro isolado mal classificado não interrompe o gesto
  gest.smooth ??= {};
  const preds = raw.map(({ className, probability }) => {
    const prev = gest.smooth[className] ?? probability;
    return { className, probability: (gest.smooth[className] = prev + GESTURE_SMOOTH * (probability - prev)) };
  });
  const top = preds.reduce((a, b) => (b.probability > a.probability ? b : a));
  if (top.probability < gest.cfg.thr) {
    gest.cand = gest.active = null;
  } else if (gest.cand?.label !== top.className) {
    gest.cand = { label: top.className, since: now };
    gest.active = null;
  } else if (!gest.active && now - gest.cand.since >= GESTURE_STABLE) {
    gest.active = { label: top.className, action: actionFor(top.className) };
    gest.lastAct = 0;
  }
  renderBars(preds);
  const a = gest.active;
  gestureStatus(a ? `${a.label} → ${actionLabel(a.action)}` : 'Faça um gesto para a câmera');
}

function gestureTick(now) {
  if (!gest.on) return;
  gest.webcam.update();
  if (!gest.predicting && now - gest.lastPred >= PREDICT_EVERY) {
    gest.predicting = true;
    gest.lastPred = now;
    gest.model.predict(gest.webcam.canvas)
      .then((p) => onPrediction(p, performance.now()))
      .finally(() => { gest.predicting = false; });
  }
  const a = gest.active;
  if (a?.action && gest.cfg.control && now - gest.lastAct >= GESTURE_INTERVAL) {
    gest.lastAct = now;
    doAction(a.action);
  }
}

function setupGestureUI() {
  $('gCam').onclick = () => (gest.on ? stopCamera() : startCamera());
  const thr = $('gThr'), thrOut = $('gThrOut');
  thr.value = Math.round(gest.cfg.thr * 100);
  thrOut.textContent = `${thr.value}%`;
  thr.oninput = () => { gest.cfg.thr = thr.value / 100; thrOut.textContent = `${thr.value}%`; saveGestureCfg(); };
  const mm = $('gMm');
  mm.value = gest.cfg.cartMm;
  mm.onchange = () => { gest.cfg.cartMm = clamp(+mm.value || 5, 1, 50); mm.value = gest.cfg.cartMm; saveGestureCfg(); };
  const ctl = $('gCtl');
  ctl.checked = gest.cfg.control;
  ctl.onchange = () => { gest.cfg.control = ctl.checked; saveGestureCfg(); };
  $('gReset').onclick = () => {
    gest.cfg.map = { ...DEFAULT_GESTURES };
    saveGestureCfg();
    renderGestures();
    say('Ações dos gestos restauradas para o padrão', 'ok');
  };
  gest.labels = Object.keys(gest.cfg.map);  // mostra a tabela antes de carregar o modelo
  renderGestures();
  setupModelUpload();
}

// ---------------------------------------------------------------- materiais e montagem da cena
function styleGlassware(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const name = o.material.name;
    o.userData.collider = /^(Vidro|Liquido|Plastico)/.test(name);
    if (name.startsWith('Vidro')) {
      const amber = name.includes('Ambar');
      o.material = new THREE.MeshPhysicalMaterial({
        color: amber ? 0x9a5212 : 0xeef6ff, roughness: 0.04, metalness: 0,
        transparent: true, opacity: amber ? 0.78 : 0.2, depthWrite: false,
        clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.6,
      });
      o.renderOrder = 2;
    } else if (name.startsWith('Liquido')) {
      o.material = new THREE.MeshPhysicalMaterial({
        color: o.material.color, roughness: 0.15, transparent: true, opacity: 0.85, clearcoat: 0.5,
      });
      o.renderOrder = 1;
      o.castShadow = true;
    } else {
      o.castShadow = true;
    }
    o.material.name = name;  // mantém o nome original (usado para achar a cor do líquido)
  });
}

// cor do líquido da vidraria, para a amostra na lista
function liquidColor(item) {
  let c = null;
  let amber = false;
  item.traverse((o) => {
    if (!o.isMesh) return;
    if (!c && o.material.name?.startsWith('Liquido')) c = o.material.color;
    if (o.material.name?.includes('Ambar')) amber = true;
  });
  return c ? `#${c.getHexString(THREE.SRGBColorSpace)}` : amber ? '#9a5212' : '#dfe6ee';
}

function buildSliders(arm) {
  const box = $('sliders');
  nodes = [];
  readouts = [];
  inputs = JOINTS.map((j, i) => {
    nodes.push(j.node === 'Garra'
      ? { d: arm.getObjectByName('J6_Dedo_D'), e: arm.getObjectByName('J6_Dedo_E') }
      : arm.getObjectByName(j.node));
    const row = document.createElement('div');
    row.className = 'joint';
    row.dataset.i = i;
    const id = `j${i}`;
    row.innerHTML = `<div class="top"><label class="nm" for="${id}"></label><span class="kb"></span><output class="lcd" for="${id}"></output></div>`;
    const lab = row.querySelector('label');
    lab.append(j.label);
    if (j.sub) lab.append(Object.assign(document.createElement('small'), { textContent: j.sub }));
    readouts.push(row.querySelector('output'));
    const inp = Object.assign(document.createElement('input'), { type: 'range', id, min: j.min, max: j.max, step: 'any', value: 0 });
    inp.style.setProperty('--zero', `${(-j.min / (j.max - j.min)) * 100}%`);
    inp.oninput = () => {
      if (busy) return applyQ();
      if (i === 5) moveGripper(+inp.value);
      else moveJoint(i, +inp.value);
    };
    row.append(inp);
    box.append(row);
    return inp;
  });
}

function buildItems() {
  const list = $('items');
  for (const it of items) {
    const li = document.createElement('li');
    li.item = it;
    const sw = Object.assign(document.createElement('i'), { className: 'sw' });
    sw.style.background = liquidColor(it);
    const b = Object.assign(document.createElement('button'), { textContent: 'Pegar' });
    b.setAttribute('aria-label', `Pegar ${it.userData.nome}`);
    b.onclick = () => pick(it);
    li.append(sw, Object.assign(document.createElement('span'), { textContent: it.userData.nome }), b);
    list.append(li);
  }
}

// volta a câmera para a vista inicial com uma transição curta
function resetView() {
  const p0 = camera.position.clone(), t0 = controls.target.clone(), start = performance.now();
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  anims.push((now) => {
    const t = reduce ? 1 : clamp((now - start) / 600, 0, 1), e = 1 - (1 - t) ** 3;
    camera.position.lerpVectors(p0, home.pos, e);
    controls.target.lerpVectors(t0, home.target, e);
    return t >= 1;
  });
}

const manager = new THREE.LoadingManager();
manager.onProgress = (_url, done, total) => loadProgress(done / total);
const loader = new GLTFLoader(manager);
const progress = MODELS.map(() => 0);
Promise.all(MODELS.map((f, k) => loader.loadAsync(f, (e) => {
  if (e.total) { progress[k] = e.loaded / e.total; loadProgress(progress.reduce((a, b) => a + b) / MODELS.length * 0.9); }
}))).then(([armGltf, glassGltf, mesaGltf]) => {
  loadProgress(0.95, 'Preparando colisões…');
  const mesa = mesaGltf.scene;
  mesa.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  scene.add(mesa);
  frameBench(mesa.getObjectByName('Mesa').userData.top_height);

  const arm = armGltf.scene;
  arm.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  bench.add(arm);
  readArmGeometry(arm);
  j5 = arm.getObjectByName('J5_Rotacao');

  buildSliders(arm);
  const goto = (p) => { if (!busy) run(() => tween(p)); };
  $('ref').onclick = () => goto(POSE_REF);
  $('zero').onclick = () => goto(POSE_REF.map(() => 0));
  applyQ();
  renderKeys();
  setupGestureUI();
  $('keysReset').onclick = () => {
    keymap = structuredClone(DEFAULT_KEYS);
    saveKeys();
    renderKeys();
    say('Teclas restauradas para o padrão', 'ok');
  };

  const glass = glassGltf.scene;
  styleGlassware(glass);
  for (const it of [...glass.children]) {
    if (!it.userData.graspable) continue;
    bench.add(it);  // posições relativas à bancada, no mesmo referencial da base do braço
    items.push(it);
  }
  buildItems();
  $('devolver').onclick = devolver;
  $('colisoes').onchange = (e) => {
    collisionsOn = e.target.checked;
    say(collisionsOn ? 'Colisões bloqueadas' : 'Colisões liberadas: o braço atravessa os objetos');
  };
  $('viewBtn').onclick = resetView;
  setupCollisions(arm, mesa);
  refreshButtons();
  loadProgress(1);
  loadDone();
  showHelpFirstTime();

  const demo = new URLSearchParams(location.search).get('pegar');
  if (demo) pick(items.find((it) => it.name.toLowerCase().includes(demo.toLowerCase())));
}).catch((err) => {
  console.error(err);
  loadFailed(err);
});

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
renderer.setAnimationLoop((now) => {
  for (let i = anims.length - 1; i >= 0; i--) if (anims[i](now)) anims.splice(i, 1);
  holdKeys(now);
  gestureTick(now);
  controls.update();
  renderer.render(scene, camera);
});
