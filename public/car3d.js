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
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const MODEL_DIR = '/cars3d/';

// Tunable orientation/scale (adjust live via window.Car3D._tune if needed)
const TUNE = {
  scaleMeters: 6.0,   // apparent car length in metres on the map (chunky = readable)
  baseDeg: 180,       // model faces +Z; align "forward" with north-up
  sign: 1,            // heading rotation direction
};

// Normalized footprint (map units) for models that need auto-scaling.
const CANON = 2.6;

// Per-model config: tint (recolour body), normalize (auto scale/centre off-scale
// models like planes), sizeMul (relative size), lift (hover altitude, metres),
// yaw (orientation offset, degrees).
const MODEL_CFG = {
  // Character karts — same Kenney units as cars, just tinted bodies
  'kart-oodi.glb': { tint: '#ef4444' }, // Mario  — red
  'kart-oobi.glb': { tint: '#22c55e' }, // Luigi  — green
  'kart-oopi.glb': { tint: '#ec4899' }, // Peach  — pink
  'kart-oozi.glb': { tint: '#f97316' }, // Bowser — orange
  'kart-ooli.glb': { tint: '#facc15' }, // Pikachu— yellow
  // Planes — wildly different source scales, so normalize; they hover
  'plane-prop.glb':  { normalize: true, sizeMul: 2.6, lift: 45, yaw: 0 },
  'plane-liner.glb': { normalize: true, sizeMul: 3.0, lift: 55, yaw: 0 },
  'plane-paper.glb': { normalize: true, sizeMul: 1.7, lift: 30, yaw: 180 },
};
const cfgOf = (f) => MODEL_CFG[f] || {};

// ── Shared GLTF loader + model cache ────────────────────────────────────────
const loader = new GLTFLoader();
const modelCache = new Map(); // file -> Promise<THREE.Group>

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
