// ═══════════════════════════════════════════════════════════════════════════
//  GHOST — 3D car system (Three.js)
//  • Player car: real glTF model rendered inside the map's 3D space via a
//    MapLibre custom layer. Sits at the GPS point, rotates to heading, lit.
//  • Garage: a standalone "showroom" canvas that auto-spins the selected car
//    so you can view all sides.
//  Assets: Kenney Car Kit (CC0 / public domain).
// ═══════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const MODEL_DIR = '/cars3d/';

// Tunable orientation/scale (adjust live via window.Car3D._tune if needed)
const TUNE = {
  scaleMeters: 4.5,   // apparent car length in metres on the map (smaller = tidier)
  baseDeg: 180,       // model faces +Z; align "forward" with north-up
  sign: 1,            // heading rotation direction
};

// Normalized footprint (map units) for models that need auto-scaling.
const CANON = 2.6;

// Per-model config: tint (recolour body), face (character face sprite),
// normalize (auto scale/centre off-scale models), sizeMul (relative size),
// lift (hover altitude, metres), yaw (orientation offset, degrees).
const MODEL_CFG = {
  // Character karts — tinted body + real character face
  'kart-oodi.glb': { tint: '#ef4444', face: 'mario' },
  'kart-oobi.glb': { tint: '#22c55e', face: 'luigi' },
  'kart-oopi.glb': { tint: '#f9a8d4', face: 'peach' },
  'kart-oozi.glb': { tint: '#22a04a', face: 'bowser' },
  'kart-ooli.glb': { tint: '#facc15', face: 'pikachu' },
  // Planes — normalize (varied source scales); they hover
  'plane-prop.glb':  { normalize: true, sizeMul: 1.9, lift: 32, yaw: 0 },
  'plane-liner.glb': { normalize: true, sizeMul: 2.3, lift: 40, yaw: 0 },
  'plane-paper.glb': { normalize: true, sizeMul: 1.3, lift: 22, yaw: 180 },
  // Novelty + realistic
  'food/eggplant.glb':    { normalize: true, sizeMul: 1.0, yaw: 0 },
  'ferrari.glb':     { normalize: true, sizeMul: 1.3, yaw: 0 },
};
const cfgOf = (f) => MODEL_CFG[f] || {};

// ── Shared GLTF loader + model cache ────────────────────────────────────────
const loader = new GLTFLoader();
// Draco support for compressed (often higher-detail/realistic) models
const _draco = new DRACOLoader();
_draco.setDecoderPath('https://unpkg.com/three@0.160.0/examples/jsm/libs/draco/');
loader.setDRACOLoader(_draco);
const modelCache = new Map(); // file -> Promise<THREE.Group>

// ── Character faces — drawn as SVG → texture → sprite on the kart's head ─────
function faceSVG(kind) {
  const marioLike = (cap, capDark, letter) => `
    <ellipse cx="30" cy="68" rx="8" ry="10" fill="#ffcc99"/><ellipse cx="90" cy="68" rx="8" ry="10" fill="#ffcc99"/>
    <ellipse cx="60" cy="66" rx="30" ry="32" fill="#ffcc99"/>
    <path d="M32 62 Q30 86 42 94 L46 74 Z" fill="#3a2412"/><path d="M88 62 Q90 86 78 94 L74 74 Z" fill="#3a2412"/>
    <path d="M24 54 Q60 8 96 54 Q60 34 24 54 Z" fill="${cap}"/>
    <path d="M22 54 Q60 42 98 54 Q100 63 88 64 Q60 52 32 64 Q20 63 22 54Z" fill="${capDark}"/>
    <circle cx="60" cy="34" r="11" fill="#fff"/>
    <text x="60" y="40" font-size="14" font-weight="900" text-anchor="middle" fill="${cap}" font-family="Arial">${letter}</text>
    <ellipse cx="50" cy="62" rx="5" ry="8" fill="#fff"/><ellipse cx="70" cy="62" rx="5" ry="8" fill="#fff"/>
    <circle cx="51" cy="64" r="3" fill="#2a3a6a"/><circle cx="69" cy="64" r="3" fill="#2a3a6a"/>
    <circle cx="60" cy="75" r="8" fill="#ffb88a"/>
    <path d="M40 81 Q50 91 60 85 Q70 91 80 81 Q74 93 60 91 Q46 93 40 81Z" fill="#3a2412"/>`;
  const inner = {
    mario: marioLike('#e11d1d', '#b81212', 'M'),
    luigi: marioLike('#25a025', '#1c7c1c', 'L'),
    peach: `
      <path d="M28 50 Q28 100 46 104 Q40 70 60 66 Q80 70 74 104 Q92 100 92 50 Q60 20 28 50Z" fill="#f4d03f"/>
      <ellipse cx="60" cy="66" rx="26" ry="30" fill="#ffe0c0"/>
      <path d="M34 52 Q40 64 46 54 Q52 66 60 54 Q68 66 74 54 Q80 64 86 52 Q60 38 34 52Z" fill="#f6d64a"/>
      <path d="M44 30 L48 40 L60 34 L72 40 L76 30 L72 22 L66 28 L60 20 L54 28 L48 22Z" fill="#ffd24a" stroke="#e0a500" stroke-width="1"/>
      <circle cx="60" cy="30" r="2.6" fill="#e74c9b"/><circle cx="50" cy="30" r="2" fill="#4aa3e7"/><circle cx="70" cy="30" r="2" fill="#4aa3e7"/>
      <ellipse cx="51" cy="64" rx="4.5" ry="7" fill="#fff"/><ellipse cx="69" cy="64" rx="4.5" ry="7" fill="#fff"/>
      <circle cx="51" cy="66" r="3" fill="#2a6ad0"/><circle cx="69" cy="66" r="3" fill="#2a6ad0"/>
      <circle cx="44" cy="74" r="4" fill="#ffb0c0" opacity=".7"/><circle cx="76" cy="74" r="4" fill="#ffb0c0" opacity=".7"/>
      <path d="M54 82 Q60 87 66 82 Q60 84 54 82Z" fill="#e0507a"/>`,
    bowser: `
      <path d="M60 24 Q26 30 24 66 Q20 96 44 100 Q30 70 60 66 Q90 70 76 100 Q100 96 96 66 Q94 30 60 24Z" fill="#e2622a"/>
      <ellipse cx="60" cy="66" rx="30" ry="30" fill="#8bd24a"/>
      <path d="M36 44 L28 28 L46 40Z" fill="#f2ead2"/><path d="M84 44 L92 28 L74 40Z" fill="#f2ead2"/>
      <path d="M42 54 L56 60" stroke="#2a6a1a" stroke-width="4" stroke-linecap="round"/><path d="M78 54 L64 60" stroke="#2a6a1a" stroke-width="4" stroke-linecap="round"/>
      <ellipse cx="50" cy="62" rx="4" ry="5" fill="#fff"/><ellipse cx="70" cy="62" rx="4" ry="5" fill="#fff"/>
      <circle cx="51" cy="63" r="2.4" fill="#c0202a"/><circle cx="69" cy="63" r="2.4" fill="#c0202a"/>
      <ellipse cx="60" cy="79" rx="16" ry="11" fill="#c8e88a"/>
      <circle cx="54" cy="77" r="1.6" fill="#3a5a2a"/><circle cx="66" cy="77" r="1.6" fill="#3a5a2a"/>
      <path d="M48 85 Q60 93 72 85" stroke="#2a4a1a" stroke-width="2" fill="none"/>
      <path d="M52 85 L50 91 L56 85Z" fill="#fff"/><path d="M68 85 L70 91 L64 85Z" fill="#fff"/>`,
    pikachu: `
      <path d="M40 44 L26 12 Q22 8 30 12 L48 40Z" fill="#f6c915"/><path d="M22 20 L26 12 L34 18Z" fill="#2a2a2a"/>
      <path d="M80 44 L94 12 Q98 8 90 12 L72 40Z" fill="#f6c915"/><path d="M98 20 L94 12 L86 18Z" fill="#2a2a2a"/>
      <ellipse cx="60" cy="70" rx="32" ry="28" fill="#f6c915"/>
      <circle cx="40" cy="76" r="8" fill="#e2402a"/><circle cx="80" cy="76" r="8" fill="#e2402a"/>
      <circle cx="50" cy="66" r="6" fill="#2a2a2a"/><circle cx="70" cy="66" r="6" fill="#2a2a2a"/>
      <circle cx="52" cy="64" r="2" fill="#fff"/><circle cx="72" cy="64" r="2" fill="#fff"/>
      <circle cx="60" cy="72" r="1.8" fill="#2a2a2a"/>
      <path d="M54 78 Q60 84 66 78" stroke="#2a2a2a" stroke-width="2" fill="none"/>`,
  }[kind] || '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">${inner}</svg>`;
}

const _faceCache = new Map();
function faceTexture(kind) {
  if (_faceCache.has(kind)) return _faceCache.get(kind);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const img = new Image();
  img.onload = () => {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 256);
    ctx.drawImage(img, 0, 0, 256, 256);
    tex.needsUpdate = true;
    if (player.map) player.map.triggerRepaint();
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(faceSVG(kind));
  _faceCache.set(kind, tex);
  return tex;
}
function addFaceSprite(group, kind) {
  const mat = new THREE.SpriteMaterial({ map: faceTexture(kind), transparent: true, depthTest: false, depthWrite: false });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(0.75, 0.75, 1);
  sp.position.set(0, 0.52, -0.05); // over the kart driver's head
  sp.renderOrder = 999;
  group.add(sp);
}

function loadModel(file) {
  if (!modelCache.has(file)) {
    modelCache.set(file, new Promise((resolve, reject) => {
      loader.load(MODEL_DIR + file, (gltf) => {
        const cfg = cfgOf(file);
        let out = gltf.scene;

        // Auto-normalize off-scale models (planes come in from ~2 to ~1600 units):
        // scale the longest horizontal dimension to a canonical footprint, centre
        // it on x/z and sit it on the ground.
        if (cfg.normalize) {
          const box = new THREE.Box3().setFromObject(out);
          const size = box.getSize(new THREE.Vector3());
          const ctr = box.getCenter(new THREE.Vector3());
          const horiz = Math.max(size.x, size.z) || 1;
          const s = (CANON * (cfg.sizeMul || 1)) / horiz;
          out.position.set(-ctr.x, -box.min.y, -ctr.z);
          const g = new THREE.Group();
          g.add(out);
          g.scale.setScalar(s);
          out = g;
        }
        // Per-model orientation offset
        if (cfg.yaw) {
          const g = new THREE.Group();
          g.add(out);
          g.rotation.y = cfg.yaw * Math.PI / 180;
          out = g;
        }

        out.traverse((o) => {
          if (!o.isMesh || !o.material) return;
          o.castShadow = false; o.receiveShadow = false;
          const m = o.material;
          // Glossier, reflective paint (env map supplies the reflections)
          if ('metalness' in m) m.metalness = Math.max(m.metalness ?? 0, 0.35);
          if ('roughness' in m) m.roughness = Math.min(m.roughness ?? 1, 0.45);
          m.envMapIntensity = 1.25;
          // Tint the body (not wheels) for character karts
          if (cfg.tint && !/wheel/i.test(o.name || '')) {
            o.material = m.clone();
            o.material.color = new THREE.Color(cfg.tint);
          }
        });
        if (cfg.face) addFaceSprite(out, cfg.face);
        resolve(out);
      }, undefined, reject);
    }));
  }
  // Return a fresh clone each time so map + showroom don't share a node
  return modelCache.get(file).then((root) => root.clone(true));
}

// PMREM environment → soft reflections that make the paint read as real.
let _envTex = null;
function ensureEnv(renderer, scene) {
  if (!_envTex) {
    try { _envTex = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture; }
    catch (e) { return; }
  }
  scene.environment = _envTex;
}

function addLights(scene) {
  const hemi = new THREE.HemisphereLight(0xffffff, 0x2a3550, 1.1);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 1.7);
  key.position.set(0.6, 1.2, 0.8);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x88bbff, 0.6);
  rim.position.set(-0.7, 0.5, -0.9);
  scene.add(rim);
}

// ═══════════════════════════════════════════════════════════════════════════
//  MAP LAYER — player car in the map's 3D world
// ═══════════════════════════════════════════════════════════════════════════
const MERC = () => window.maplibregl.MercatorCoordinate;

const player = {
  lng: 151.2093, lat: -33.8688, headingDeg: 0, lift: 0,
  visible: false, modelFile: 'sedan-sports.glb',
  pivot: null, scene: null, camera: null, renderer: null, map: null,
  loadingToken: 0,
};

function makeCustomLayer(map) {
  return {
    id: 'player-car-3d',
    type: 'custom',
    renderingMode: '3d',
    onAdd(_map, gl) {
      player.map = _map;
      player.camera = new THREE.Camera();
      player.scene = new THREE.Scene();
      addLights(player.scene);
      player.pivot = new THREE.Group();
      player.scene.add(player.pivot);
      player.renderer = new THREE.WebGLRenderer({
        canvas: _map.getCanvas(),
        context: gl,
        antialias: true,
      });
      player.renderer.autoClear = false;
      ensureEnv(player.renderer, player.scene);
      swapModel(player.modelFile);
    },
    render(_gl, matrix) {
      if (!player.visible || !player.pivot) { return; }
      const Merc = MERC();
      const merc = Merc.fromLngLat([player.lng, player.lat], player.lift || 0);
      const s = merc.meterInMercatorCoordinateUnits() * TUNE.scaleMeters;
      const headingRad = (TUNE.sign * player.headingDeg + TUNE.baseDeg) * Math.PI / 180;
      const l = new THREE.Matrix4()
        .makeTranslation(merc.x, merc.y, merc.z)
        .multiply(new THREE.Matrix4().makeScale(s, -s, s))
        .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
        .multiply(new THREE.Matrix4().makeRotationY(headingRad));
      player.camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix).multiply(l);
      player.renderer.resetState();
      player.renderer.render(player.scene, player.camera);
      // keep animating while visible (heading/pos interpolation happens in app.js)
    },
  };
}

function swapModel(file) {
  player.lift = cfgOf(file).lift || 0;
  if (!player.pivot) { player.modelFile = file; return; }
  const token = ++player.loadingToken;
  loadModel(file).then((model) => {
    if (token !== player.loadingToken || !player.pivot) { return; }
    // clear old
    for (let i = player.pivot.children.length - 1; i >= 0; i--) {
      player.pivot.remove(player.pivot.children[i]);
    }
    player.pivot.add(model);
    player.modelFile = file;
    if (player.map) { player.map.triggerRepaint(); }
  }).catch((e) => console.warn('[Car3D] model load failed', file, e));
}

// ═══════════════════════════════════════════════════════════════════════════
//  SHOWROOM — standalone spinning preview (garage)
// ═══════════════════════════════════════════════════════════════════════════
function mountShowroom(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  addLights(scene);
  ensureEnv(renderer, scene);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
  camera.position.set(3.4, 2.4, 4.2);
  camera.lookAt(0, 0.4, 0);

  const pivot = new THREE.Group();
  scene.add(pivot);

  let raf = null, dragging = false, lastX = 0, spin = true, yaw = 0, token = 0;
  let _lastW = 0, _lastH = 0;

  function resize() {
    const w = canvas.clientWidth || 300, h = canvas.clientHeight || 200;
    _lastW = w; _lastH = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function setModel(file) {
    const t = ++token;
    for (let i = pivot.children.length - 1; i >= 0; i--) pivot.remove(pivot.children[i]);
    loadModel(file).then((m) => {
      if (t !== token) return;
      pivot.add(m);
      // Auto-frame: fit the camera to whatever model this is (cars vs big planes).
      const box = new THREE.Box3().setFromObject(m);
      const size = box.getSize(new THREE.Vector3());
      const ctr = box.getCenter(new THREE.Vector3());
      m.position.x -= ctr.x; m.position.z -= ctr.z; // centre horizontally
      const r = Math.max(size.x, size.y, size.z) || 2.5;
      const d = r * 1.9;
      camera.position.set(d * 0.62, d * 0.42, d * 0.85);
      camera.lookAt(0, size.y * 0.35, 0);
      camera.updateProjectionMatrix();
    });
  }

  function frame() {
    // Auto-resize when the (initially hidden) garage panel becomes visible
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w && h && (w !== _lastW || h !== _lastH)) resize();
    if (spin && !dragging) yaw += 0.012;
    pivot.rotation.y = yaw;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }

  // drag to rotate
  const onDown = (e) => { dragging = true; spin = false; lastX = (e.touches ? e.touches[0].clientX : e.clientX); };
  const onMove = (e) => {
    if (!dragging) return;
    const x = (e.touches ? e.touches[0].clientX : e.clientX);
    yaw += (x - lastX) * 0.01; lastX = x;
  };
  const onUp = () => { dragging = false; };
  canvas.addEventListener('mousedown', onDown);
  canvas.addEventListener('touchstart', onDown, { passive: true });
  window.addEventListener('mousemove', onMove);
  canvas.addEventListener('touchmove', onMove, { passive: true });
  window.addEventListener('mouseup', onUp);
  canvas.addEventListener('touchend', onUp);

  resize();
  window.addEventListener('resize', resize);
  frame();

  return {
    setModel,
    resize,
    dispose() {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('resize', resize);
      renderer.dispose();
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════
let _initDone = false;

function init(map) {
  if (_initDone) return;
  _initDone = true;
  const add = () => { if (!map.getLayer('player-car-3d')) map.addLayer(makeCustomLayer(map)); };
  if (map.isStyleLoaded()) add(); else map.once('load', add);
  // re-add layer after any style swap (basemap change removes custom layers)
  map.on('styledata', () => { try { add(); } catch (_) {} });
}

window.Car3D = {
  init,
  setModel(file) { swapModel(file); },
  setPos(lng, lat, headingDeg) {
    player.lng = lng; player.lat = lat;
    if (headingDeg != null) player.headingDeg = headingDeg;
    if (player.visible && player.map) player.map.triggerRepaint();
  },
  show() { player.visible = true; if (player.map) player.map.triggerRepaint(); },
  hide() { player.visible = false; if (player.map) player.map.triggerRepaint(); },
  isVisible() { return player.visible; },
  mountShowroom,
  _tune: TUNE,
};

// Auto-init against the map created by app.js
if (window.ghostMap) init(window.ghostMap);
else window.addEventListener('ghostmap-ready', () => init(window.ghostMap), { once: true });
