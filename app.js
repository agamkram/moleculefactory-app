import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ELEMENTS, ELEMENT_LIST, RECIPES, RECIPE_CATEGORIES } from "./data.js";
import {
  createGraph,
  clearGraph,
  graphFromRecipe,
  addFirstAtom,
  placePendingAtSite,
  removeLastAtom,
  computeOpenSites,
  canSelectElement,
  totalOpen,
  graphFormula,
  graphRecipeMatch,
  graphSymbols,
} from "./build.js";
import { nameMolecule } from "./names.js";
import { loreFor } from "./lore.js";

const SCALE = 1.35;
const ATOM_SCALE = 0.55;

const stage = document.getElementById("stage");
const hudFormula = document.getElementById("hud-formula");
const hudName = document.getElementById("hud-name");
const hudHint = document.getElementById("hud-hint");
const trayEl = document.getElementById("tray");
const recipeList = document.getElementById("recipe-list");
const recipeSearch = document.getElementById("recipe-search");
const recipeSearchClear = document.getElementById("recipe-search-clear");
const recipeCatsEl = document.getElementById("recipe-cats");
const elementRail = document.getElementById("element-rail");
const elementRailInner = document.getElementById("element-rail-inner");
const sheetRecipes = document.getElementById("sheet-recipes");
const sheetAbout = document.getElementById("sheet-about");
const btnRecipes = document.getElementById("btn-recipes");
const btnAbout = document.getElementById("btn-about");
const btnClear = document.getElementById("btn-clear");
const btnRotate = document.getElementById("btn-rotate");

/** @type {string | null} */
let pendingEl = null;
/** Library category chip: null = All. */
let libraryCategory = null;

const RECIPE_CAT_SHORT = {
  gases: "Gases",
  inorganic: "Inorganics",
  acids_bases: "Acids",
  salts: "Salts",
  hydrocarbons: "Hydrocarbons",
  organics: "Organics",
  body_medicine: "Body",
  everyday: "Everyday",
};
const graph = createGraph();

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: false,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5));
renderer.setClearColor(0x07090f, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// No fog — zooming out must not fade the molecule.

// Far plane must stay beyond Orbit maxDistance or big zooms clip the molecule away.
const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 500);
camera.position.set(5.5, 3.4, 10.5);

// Orbit for zoom/pan only. Spin is applied to the molecule group so there is
// no spherical “north pole” stop — drag forever in any direction.
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enableRotate = false;
controls.minDistance = 1.5;
controls.maxDistance = 160; // room to frame DNA / C60 / cholesterol
controls.target.set(0, 0.15, 0);
// Leave one-finger / left-drag to our free molecule spin (Orbit would no-op-rotate).
controls.mouseButtons.LEFT = null;
controls.touches.ONE = null;

scene.add(new THREE.AmbientLight(0xb8c7e0, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 1.15);
key.position.set(4, 7, 5);
scene.add(key);
const fill = new THREE.DirectionalLight(0x7aa7ff, 0.35);
fill.position.set(-5, -2, -3);
scene.add(fill);
const rim = new THREE.PointLight(0x5ec8ff, 0.55, 20);
rim.position.set(-2, 3, 4);
scene.add(rim);

/** Rotated by drag; holds atoms + bond sites together. */
const spinGroup = new THREE.Group();
scene.add(spinGroup);
const molGroup = new THREE.Group();
spinGroup.add(molGroup);
const sitesGroup = new THREE.Group();
spinGroup.add(sitesGroup);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const _spinQ = new THREE.Quaternion();
const _spinAxis = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _camUp = new THREE.Vector3();
const SPIN_SPEED = 0.0055;
/** Showcase auto-spin (rad/s) — yaw + slight pitch for a living tumble. */
const AUTO_SPIN_YAW = 0.55;
const AUTO_SPIN_PITCH = 0.18;
let autoSpin = false;
let buildToken = 0;
/** When true, assemble must not reframe — camera already locked to final size. */
let cameraFrameLocked = false;
let activeRecipe = null;
/** Recipe showcase: chips for teaching, no undo. Free-build unlocks the tray. */
let trayLocked = false;
let _layoutW = 0;
let _layoutH = 0;
let pickMoved = false;
let pickX = 0;
let pickY = 0;
let spinPointerId = null;
let _lastFrameT = performance.now();
const _autoAxisY = new THREE.Vector3(0, 1, 0);
const _autoAxisX = new THREE.Vector3(1, 0, 0);
const _fitSize = new THREE.Vector3();
const _fitCenter = new THREE.Vector3();
const _fitDir = new THREE.Vector3();

function pwaFillHeightPx() {
  const iw = window.innerWidth || 0;
  const ih = window.innerHeight || 0;
  const sw = window.screen?.width || 0;
  const sh = window.screen?.height || 0;
  const screenMax = Math.max(sw, sh);
  const screenMin = Math.min(sw, sh);
  return ih >= iw ? Math.max(ih, screenMax) : Math.max(ih, screenMin);
}

function pwaExtraBottomPx() {
  const iw = window.innerWidth || 0;
  const ih = window.innerHeight || 0;
  const sw = window.screen?.width || 0;
  const sh = window.screen?.height || 0;
  const screenMax = Math.max(sw, sh);
  if (Math.min(iw, ih) >= 600 && screenMax < ih - 10) {
    return 20;
  }
  return 0;
}

function syncViewportVars() {
  const r = document.documentElement;
  const standalone =
    navigator.standalone === true ||
    matchMedia("(display-mode: standalone)").matches ||
    matchMedia("(display-mode: fullscreen)").matches ||
    matchMedia("(display-mode: minimal-ui)").matches;
  const vv = window.visualViewport;
  const iw = window.innerWidth || 0;
  const ih = window.innerHeight || 0;
  if (standalone) {
    // Bug B / HyperMiler: never pin PWA to short visualViewport — use screen fillH.
    const fillH = pwaFillHeightPx();
    const extra = pwaExtraBottomPx();
    r.classList.add("pwa-standalone");
    r.style.setProperty("--pwa-fill-h", `${fillH}px`);
    r.style.setProperty("--pwa-extra-b", `${extra}px`);
    r.style.setProperty("--vv-top", "0px");
    r.style.setProperty("--vv-left", "0px");
    r.style.setProperty("--vv-w", `${iw}px`);
    r.style.setProperty("--vv-h", `${fillH + extra}px`);
  } else if (vv && vv.height > 40 && vv.width > 40) {
    r.classList.remove("pwa-standalone");
    r.style.removeProperty("--pwa-fill-h");
    r.style.removeProperty("--pwa-extra-b");
    r.style.setProperty("--vv-top", Math.max(0, Math.round(vv.offsetTop) || 0) + "px");
    r.style.setProperty("--vv-left", Math.max(0, Math.round(vv.offsetLeft) || 0) + "px");
    r.style.setProperty("--vv-w", Math.round(vv.width) + "px");
    r.style.setProperty("--vv-h", Math.round(vv.height) + "px");
  } else {
    r.classList.remove("pwa-standalone");
    r.style.setProperty("--vv-top", "0px");
    r.style.setProperty("--vv-left", "0px");
    r.style.setProperty("--vv-w", iw + "px");
    r.style.setProperty("--vv-h", ih + "px");
  }
}

function fit() {
  syncViewportVars();
  const w = stage.clientWidth || window.innerWidth;
  const h = stage.clientHeight || window.innerHeight;
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}

/** Free tumble: rotate molecule around camera-relative axes (no pole clamp). */
function spinByDrag(dx, dy) {
  if (dx === 0 && dy === 0) return;
  camera.updateMatrixWorld();
  camera.matrixWorld.extractBasis(_camRight, _camUp, _spinAxis);
  // Horizontal drag → around camera up; vertical → around camera right.
  _spinQ.setFromAxisAngle(_camUp, dx * SPIN_SPEED);
  spinGroup.quaternion.premultiply(_spinQ);
  _spinQ.setFromAxisAngle(_camRight, dy * SPIN_SPEED);
  spinGroup.quaternion.premultiply(_spinQ);
  spinGroup.quaternion.normalize();
}

function setAutoSpin(on) {
  autoSpin = !!on;
  btnRotate?.setAttribute("aria-pressed", autoSpin ? "true" : "false");
}

/**
 * Shift atom coords so the centroid sits at the origin — spinGroup rotates
 * around the molecule’s true center, not a random corner of the model.
 */
function centerGraphOnOrigin(g) {
  if (!g?.atoms?.length) return;
  let cx = 0,
    cy = 0,
    cz = 0;
  for (const a of g.atoms) {
    cx += a.x;
    cy += a.y;
    cz += a.z;
  }
  const n = g.atoms.length;
  cx /= n;
  cy /= n;
  cz /= n;
  for (const a of g.atoms) {
    a.x -= cx;
    a.y -= cy;
    a.z -= cz;
  }
}

/**
 * Clear stage band (px) inside the WebGL canvas — below header, above rail/tray.
 * Framing uses this, not the full canvas, so molecules aren’t low or clipped.
 */
function getStageInsets() {
  const el = renderer.domElement;
  const w = el.clientWidth || window.innerWidth || 1;
  const h = el.clientHeight || window.innerHeight || 1;
  const stageRect = el.getBoundingClientRect();
  const topUi = document.querySelector(".top");
  const rail = elementRail;
  const tray = trayEl;
  const hud = document.getElementById("hud");

  let top = 12;
  let bottom = 12;

  if (topUi) {
    const r = topUi.getBoundingClientRect();
    top = Math.max(top, r.bottom - stageRect.top + 10);
  }
  if (rail?.classList.contains("is-open")) {
    const r = rail.getBoundingClientRect();
    bottom = Math.max(bottom, stageRect.bottom - r.top + 10);
  }
  if (tray && tray.childElementCount > 0) {
    const r = tray.getBoundingClientRect();
    bottom = Math.max(bottom, stageRect.bottom - r.top + 10);
  }
  // HUD sits over the stage — keep the molecule in the band above it.
  if (hud) {
    const r = hud.getBoundingClientRect();
    const hudTop = r.top - stageRect.top;
    if (hudTop > h * 0.3) {
      bottom = Math.max(bottom, stageRect.bottom - r.top + 12);
    }
  }
  const openSheet =
    (sheetRecipes && !sheetRecipes.hidden && sheetRecipes) ||
    (sheetAbout && !sheetAbout.hidden && sheetAbout) ||
    null;
  if (openSheet) {
    const r = openSheet.getBoundingClientRect();
    // Full-width sheet: frame into whatever stage remains around it.
    if (r.width > w * 0.55) {
      top = Math.max(top, r.top - stageRect.top + 8);
      bottom = Math.max(bottom, stageRect.bottom - r.bottom + 8);
    }
  }

  top = Math.min(top, h * 0.36);
  bottom = Math.min(bottom, h * 0.48);
  const availH = Math.max(80, h - top - bottom);
  const availW = Math.max(80, w);
  return { w, h, top, bottom, availH, availW };
}

/** Default camera for free-build (after Clear). */
function resetBuildCamera() {
  _fitCenter.set(0, 0, 0);
  applyFrameFromSize(1.05);
}

/**
 * Fit the molecule AABB into the clear stage band — one rule for every shape.
 * Uses extents projected onto the view (not a sphere from the long axis), so
 * flat outliers like cholesterol fill the frame instead of looking tiny.
 */
function applyFrameFromSize(radius) {
  const inset = getStageInsets();
  const vFov = (camera.fov * Math.PI) / 180;
  const aspect = camera.aspect || inset.w / inset.h;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);

  // Pleasant viewing direction (same for all recipes).
  _fitDir.set(0.42, 0.22, 1).normalize();
  const center = _fitCenter.clone();

  // Camera basis for projection (look along _fitDir, world up).
  const forward = _fitDir.clone();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(worldUp, forward).normalize();
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  const up = new THREE.Vector3().crossVectors(forward, right).normalize();

  // Project AABB corners onto view right/up → half-width / half-height on screen.
  const hx = Math.max(_fitSize.x * 0.5, 0.35);
  const hy = Math.max(_fitSize.y * 0.5, 0.35);
  const hz = Math.max(_fitSize.z * 0.5, 0.35);
  let halfW = 0;
  let halfH = 0;
  for (const sx of [-hx, hx]) {
    for (const sy of [-hy, hy]) {
      for (const sz of [-hz, hz]) {
        const ox = right.x * sx + right.y * sy + right.z * sz;
        const oy = up.x * sx + up.y * sy + up.z * sz;
        halfW = Math.max(halfW, Math.abs(ox));
        halfH = Math.max(halfH, Math.abs(oy));
      }
    }
  }
  // Fallback for empty/odd bounds.
  const rFallback = Math.max(radius, 0.7);
  if (halfW < 1e-3) halfW = rFallback;
  if (halfH < 1e-3) halfH = rFallback;

  const pad = 1.22;
  const distH = (halfH * pad) / Math.tan(vFov / 2) / (inset.availH / inset.h);
  const distW = (halfW * pad) / Math.tan(hFov / 2) / (inset.availW / inset.w);
  let dist = Math.max(distH, distW);
  dist = Math.min(controls.maxDistance * 0.98, Math.max(controls.minDistance + 0.6, dist));

  // Shift look-at so the molecule sits on the clear-band center (above rail).
  const clearMidY = inset.top + inset.availH / 2;
  const canvasMidY = inset.h / 2;
  const ndcShift = ((canvasMidY - clearMidY) / (inset.h / 2)) * Math.tan(vFov / 2);
  const worldLift = ndcShift * dist;
  const target = center.clone();
  target.y -= worldLift;

  controls.target.copy(target);
  camera.position.copy(target).addScaledVector(_fitDir, dist);
  camera.up.set(0, 1, 0);
  camera.lookAt(target);
  controls.update();
}

/**
 * Frame from graph atom positions (local space), never from spun world meshes.
 * Auto-spin inflates a world AABB and used to jump the camera mid/late assemble.
 */
function frameMoleculeFromGraph(g, { includeSites = false } = {}) {
  if (!g?.atoms?.length) return;
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (const atom of g.atoms) {
    const x = atom.x * SCALE;
    const y = atom.y * SCALE;
    const z = atom.z * SCALE;
    const pad = (ELEMENTS[atom.el]?.radius || 0.7) * ATOM_SCALE;
    minX = Math.min(minX, x - pad);
    minY = Math.min(minY, y - pad);
    minZ = Math.min(minZ, z - pad);
    maxX = Math.max(maxX, x + pad);
    maxY = Math.max(maxY, y + pad);
    maxZ = Math.max(maxZ, z + pad);
  }
  if (includeSites && pendingEl) {
    const sitePad = 0.26 * SCALE;
    for (const site of computeOpenSites(g, pendingEl)) {
      const x = site.x * SCALE;
      const y = site.y * SCALE;
      const z = site.z * SCALE;
      minX = Math.min(minX, x - sitePad);
      minY = Math.min(minY, y - sitePad);
      minZ = Math.min(minZ, z - sitePad);
      maxX = Math.max(maxX, x + sitePad);
      maxY = Math.max(maxY, y + sitePad);
      maxZ = Math.max(maxZ, z + sitePad);
    }
  }
  _fitCenter.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
  _fitSize.set(maxX - minX, maxY - minY, maxZ - minZ);
  // Use half the longest AABB axis — not half-diagonal (diagonal over-zooms
  // spheres/cubes like C60 so they look smaller than elongated DNA).
  const fitR = 0.5 * Math.max(_fitSize.x, _fitSize.y, _fitSize.z, 1.4);
  applyFrameFromSize(fitR);
}

/** Reframe from the live graph (+ ghosts). Safe while the molecule is spinning. */
function frameMolecule() {
  frameMoleculeFromGraph(graph, { includeSites: true });
}

function clearMolecule() {
  while (molGroup.children.length) {
    const obj = molGroup.children.pop();
    obj.traverse((n) => {
      if (n.geometry) n.geometry.dispose();
      if (n.material) {
        if (Array.isArray(n.material)) n.material.forEach((m) => m.dispose());
        else n.material.dispose();
      }
    });
  }
}

function atomMesh(atom) {
  const info = ELEMENTS[atom.el];
  const r = (info?.radius || 0.7) * ATOM_SCALE;
  const geo = new THREE.SphereGeometry(r, 48, 32);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(info?.color || "#cccccc"),
    roughness: 0.28,
    metalness: atom.el === "H" ? 0.05 : 0.22,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(atom.x * SCALE, atom.y * SCALE, atom.z * SCALE);
  mesh.userData.el = atom.el;
  mesh.userData.atomId = atom.id;
  mesh.userData.kind = "atom";
  return mesh;
}

function bondMesh(a, b, order) {
  const group = new THREE.Group();
  const start = new THREE.Vector3(a.x, a.y, a.z).multiplyScalar(SCALE);
  const end = new THREE.Vector3(b.x, b.y, b.z).multiplyScalar(SCALE);
  const dir = end.clone().sub(start);
  const len = dir.length();
  const mid = start.clone().add(end).multiplyScalar(0.5);
  const quat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    dir.clone().normalize()
  );
  const offsets =
    order === 1 ? [0] : order === 2 ? [-0.08, 0.08] : [-0.11, 0, 0.11];
  const side = new THREE.Vector3(1, 0, 0);
  if (Math.abs(dir.clone().normalize().dot(side)) > 0.9) side.set(0, 0, 1);
  const binormal = dir.clone().normalize().cross(side).normalize();

  for (const off of offsets) {
    const geo = new THREE.CylinderGeometry(0.045, 0.045, len, 16);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xd6dde8,
      roughness: 0.45,
      metalness: 0.15,
    });
    const cyl = new THREE.Mesh(geo, mat);
    cyl.quaternion.copy(quat);
    cyl.position.copy(mid).add(binormal.clone().multiplyScalar(off * SCALE));
    group.add(cyl);
  }
  return group;
}

function clearSites() {
  while (sitesGroup.children.length) {
    const obj = sitesGroup.children.pop();
    obj.traverse((n) => {
      if (n.geometry) n.geometry.dispose();
      if (n.material) n.material.dispose();
    });
  }
}

function renderGraph({ animate = false } = {}) {
  clearMolecule();
  clearSites();
  const token = ++buildToken;
  const atoms = graph.atoms;
  const byId = new Map(atoms.map((a) => [a.id, a]));

  const place = (i, growMs) => {
    if (token !== buildToken) return;
    const mesh = atomMesh(atoms[i]);
    if (animate) {
      mesh.scale.setScalar(0.01);
      molGroup.add(mesh);
      const t0 = performance.now();
      const dur = Math.max(40, growMs || 180);
      const grow = () => {
        if (token !== buildToken) return;
        const u = Math.min(1, (performance.now() - t0) / dur);
        mesh.scale.setScalar(1 - Math.pow(1 - u, 3));
        if (u < 1) requestAnimationFrame(grow);
      };
      grow();
    } else {
      molGroup.add(mesh);
    }
  };

  const link = (bi) => {
    if (token !== buildToken) return;
    const b = graph.bonds[bi];
    const a = byId.get(b.a);
    const c = byId.get(b.b);
    if (a && c) molGroup.add(bondMesh(a, c, b.order || 1));
  };

  if (!animate) {
    atoms.forEach((_, i) => place(i));
    graph.bonds.forEach((_, i) => link(i));
    rebuildSites();
    // Free-build / instant draw: frame from graph (not spun meshes).
    if (!cameraFrameLocked) frameMolecule();
    return;
  }

  // One rule: keep total assemble time in a few seconds as size grows.
  // Small molecules stay readable; DNA/C60 don't crawl for 15s+.
  const nA = Math.max(atoms.length, 1);
  const nB = Math.max(graph.bonds.length, 1);
  const targetMs =
    nA <= 12 ? 2000 : nA <= 30 ? 2600 : nA <= 80 ? 3200 : 3800;
  const stepMs = Math.max(3, targetMs / (nA + nB));
  const batch = nA >= 120 ? 4 : nA >= 60 ? 3 : nA >= 30 ? 2 : 1;
  const growMs = nA >= 60 ? 70 : nA >= 30 ? 110 : 180;

  let phase = 0; // atom index, then atoms.length + bond index
  const tick = () => {
    if (token !== buildToken) return;
    if (phase < atoms.length) {
      const end = Math.min(atoms.length, phase + batch);
      for (let i = phase; i < end; i++) place(i, growMs);
      phase = end;
      setTimeout(tick, stepMs * Math.max(1, batch * 0.65));
      return;
    }
    const bi = phase - atoms.length;
    if (bi < graph.bonds.length) {
      const end = Math.min(graph.bonds.length, bi + batch);
      for (let i = bi; i < end; i++) link(i);
      phase = atoms.length + end;
      setTimeout(tick, stepMs * Math.max(1, batch * 0.5));
      return;
    }
    rebuildSites();
    // Recipe assemble already pre-framed — do not reframe (spin would look like a resize).
    cameraFrameLocked = false;
  };
  tick();
}

function rebuildSites() {
  clearSites();
  if (!pendingEl || !graph.atoms.length) return;
  const sites = computeOpenSites(graph, pendingEl);
  for (const site of sites) {
    const group = new THREE.Group();
    group.position.set(site.x * SCALE, site.y * SCALE, site.z * SCALE);
    group.userData.kind = "site";
    group.userData.site = site;

    // Visible glow
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.26 * SCALE, 24, 16),
      new THREE.MeshStandardMaterial({
        color: 0x5ec8ff,
        emissive: 0x5ec8ff,
        emissiveIntensity: 0.75,
        transparent: true,
        opacity: 0.6,
        roughness: 0.35,
        metalness: 0.1,
        depthWrite: false,
      })
    );
    glow.renderOrder = 10;
    glow.userData.kind = "site";
    glow.userData.site = site;

    // Larger invisible hit target for fat-finger taps
    const hit = new THREE.Mesh(
      new THREE.SphereGeometry(0.45 * SCALE, 16, 12),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
    );
    hit.userData.kind = "site";
    hit.userData.site = site;

    group.add(hit);
    group.add(glow);
    sitesGroup.add(group);
  }
}

function setHud(formula, name, hint) {
  hudFormula.textContent = formula || "—";
  hudName.textContent = name || "";
  hudHint.textContent = hint || "Drag to spin · pinch to zoom";
}

/** Recipe subtitle: teaching hook (or shape hint) — no status suffixes. */
function recipeSubHint(recipe) {
  const lore = loreFor(recipe);
  if (lore?.hook) return lore.hook;
  return (recipe.hint || "").trim();
}

function undoLastAtom() {
  if (trayLocked || !graph.atoms.length) return;
  const removed = removeLastAtom(graph);
  if (!removed) return;
  activeRecipe = null;
  // Undo only reverses the place — no re-arming / ghosts.
  pendingEl = null;
  paintPending();
  setAutoSpin(false);
  syncBuildUi({ animate: false });
}

function refreshTray() {
  trayEl.innerHTML = "";
  trayEl.classList.toggle("is-locked", trayLocked);
  if (trayLocked) {
    trayEl.setAttribute("aria-label", "Ingredients");
  } else {
    trayEl.removeAttribute("aria-label");
  }
  const syms = graphSymbols(graph);
  syms.forEach((el, i) => {
    const canUndo = !trayLocked && i === syms.length - 1;
    const chip = document.createElement(canUndo ? "button" : "span");
    if (canUndo) chip.type = "button";
    chip.className = canUndo ? "chip chip-undo" : "chip";
    chip.textContent = el;
    chip.style.background = ELEMENTS[el]?.color || "#ccc";
    chip.style.color = inkFor(ELEMENTS[el]?.color || "#ccc");
    if (canUndo) {
      chip.title = `Undo last atom (${el})`;
      chip.setAttribute("aria-label", `Undo last atom, ${el}`);
      chip.addEventListener("click", (e) => {
        e.preventDefault();
        undoLastAtom();
      });
    }
    trayEl.appendChild(chip);
  });
}

function syncBuildUi({ animate = false } = {}) {
  refreshTray();
  refreshRailAvailability();
  renderGraph({ animate });

  const open = totalOpen(graph);
  const hit = graphRecipeMatch(graph);
  const formula = graph.atoms.length ? graphFormula(graph) : "—";

  if (!graph.atoms.length) {
    setHud(
      "—",
      pendingEl ? `Place ${pendingEl}` : "Pick an element",
      pendingEl
        ? "First atom goes at the center"
        : "Tap an element to start"
    );
    return;
  }

  const liveName = nameMolecule(graph);
  if (hit) {
    // Prefer the actively loaded recipe when present (same stoichiometry aliases).
    const rec = activeRecipe && activeRecipe.id === hit.id ? activeRecipe : hit;
    setHud(rec.formula, rec.name, recipeSubHint(rec));
  } else {
    let hint = "Drag to spin · pinch to zoom";
    if (pendingEl && open > 0) hint = `Tap ${pendingEl} again to add another`;
    else if (open > 0) hint = "Tap an element to add it";
    else if (graph.atoms.length) hint = "Clear to build again";
    setHud(formula, liveName || formula, hint);
  }
}

function paintPending() {
  elementRailInner?.querySelectorAll(".el-cell.is-pending").forEach((c) => {
    c.classList.remove("is-pending");
  });
  if (!pendingEl) return;
  elementRailInner
    ?.querySelectorAll(`.el-cell[data-sym="${pendingEl}"]`)
    .forEach((c) => c.classList.add("is-pending"));
}

function finishPlace(el) {
  activeRecipe = null;
  trayLocked = false;
  if (
    el &&
    canSelectElement(el, graph) &&
    computeOpenSites(graph, el).length > 0
  ) {
    pendingEl = el;
  } else {
    pendingEl = null;
  }
  paintPending();
  syncBuildUi({ animate: false });
}

/**
 * Rail tap: start or add. Second tap builds (auto-place on an open site) —
 * ghosts are optional shortcuts, not required.
 */
function selectElement(sym) {
  if (!sym) {
    pendingEl = null;
    paintPending();
    syncBuildUi({ animate: false });
    return;
  }

  if (!canSelectElement(sym, graph)) {
    // Showcase / saturated recipe: start a fresh free build with this element.
    if (!activeRecipe) return;
    activeRecipe = null;
    trayLocked = false;
    clearGraph(graph);
    resetSpin();
    setAutoSpin(false);
    buildToken += 1;
    cameraFrameLocked = false;
    if (!canSelectElement(sym, graph)) return;
  }

  setAutoSpin(false);
  cameraFrameLocked = false;

  // Empty stage → first atom at origin.
  if (!graph.atoms.length) {
    try {
      addFirstAtom(graph, sym);
    } catch (_) {
      pendingEl = null;
      paintPending();
      syncBuildUi();
      return;
    }
    activeRecipe = null;
    trayLocked = false;
    pendingEl = null;
    paintPending();
    resetBuildCamera();
    syncBuildUi({ animate: true });
    return;
  }

  // Already building: rail tap places on the next open site.
  const sites = computeOpenSites(graph, sym);
  if (sites.length > 0) {
    placePendingAtSite(graph, sym, sites[0]);
    finishPlace(sym);
    return;
  }

  // Can't place this element — just clear/arm selection.
  pendingEl = pendingEl === sym ? null : sym;
  paintPending();
  syncBuildUi({ animate: false });
}

function resetSpin() {
  spinGroup.quaternion.identity();
}

function playRecipe(recipe) {
  activeRecipe = recipe;
  pendingEl = null;
  trayLocked = true;
  clearGraph(graph);
  resetSpin();
  setAutoSpin(true);
  const loaded = graphFromRecipe(recipe);
  graph.atoms = loaded.atoms;
  graph.bonds = loaded.bonds;
  centerGraphOnOrigin(graph);
  closeSheets();
  // Lock camera to the final size up front — no resize steps during assemble.
  fit();
  frameMoleculeFromGraph(graph);
  cameraFrameLocked = true;
  setHud(recipe.formula, recipe.name, recipeSubHint(recipe));
  syncBuildUi({ animate: true });
}

function refreshRailAvailability() {
  const cells = elementRailInner?.querySelectorAll(".el-cell");
  if (!cells) return;
  // Finished recipe showcase (e.g. boot caffeine): keep tiles vivid/inviting.
  // Taps still work — they clear the showcase and start a free build.
  let anySelectable = false;
  for (const cell of cells) {
    if (canSelectElement(cell.dataset.sym, graph)) {
      anySelectable = true;
      break;
    }
  }
  const vividShowcase = !!(activeRecipe && !pendingEl && !anySelectable);
  elementRail?.classList.toggle("is-showcase", vividShowcase);
  cells.forEach((cell) => {
    const sym = cell.dataset.sym;
    const ok = canSelectElement(sym, graph);
    if (vividShowcase) {
      cell.classList.remove("is-blocked");
      cell.disabled = false;
      cell.setAttribute("aria-disabled", "false");
      return;
    }
    cell.classList.toggle("is-blocked", !ok);
    cell.disabled = !ok;
    cell.setAttribute("aria-disabled", ok ? "false" : "true");
    if (!ok) cell.classList.remove("is-pending");
  });
}

function onStagePointerDown(e) {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  pickMoved = false;
  pickX = e.clientX;
  pickY = e.clientY;
  spinPointerId = e.pointerId;
  try {
    renderer.domElement.setPointerCapture(e.pointerId);
  } catch (_) {}
}

function onStagePointerMove(e) {
  if (spinPointerId !== e.pointerId) return;
  const dx = e.clientX - pickX;
  const dy = e.clientY - pickY;
  if (!pickMoved && Math.hypot(dx, dy) > 8) pickMoved = true;
  if (pickMoved) {
    spinByDrag(dx, dy);
    pickX = e.clientX;
    pickY = e.clientY;
  }
}

function onStagePointerUp(e) {
  if (spinPointerId === e.pointerId) {
    spinPointerId = null;
    try {
      renderer.domElement.releasePointerCapture(e.pointerId);
    } catch (_) {}
  }
  if (pickMoved || !pendingEl) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(sitesGroup.children, true);
  if (!hits.length) return;
  const site = hits[0].object.userData.site;
  if (!site) return;
  const kept = pendingEl;
  placePendingAtSite(graph, pendingEl, site);
  finishPlace(kept);
}

function inkFor(bgHex) {
  const h = (bgHex || "#888").replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  if (!Number.isFinite(n)) return "#0b0d12";
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  // Perceived luminance — light tiles need dark type
  const y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return y > 0.62 ? "#0b0d12" : "#f4f7fb";
}

function applyRailVisibility() {
  // Element rail stays on — no toggle control.
  elementRail.classList.add("is-open");
  document.body.classList.add("rail-open");
  fit();
}

function closeRecipes() {
  if (sheetRecipes) sheetRecipes.hidden = true;
  btnRecipes?.setAttribute("aria-pressed", "false");
}

function closeAbout() {
  if (sheetAbout) sheetAbout.hidden = true;
  btnAbout?.setAttribute("aria-pressed", "false");
}

function closeSheets() {
  closeRecipes();
  closeAbout();
}

let railStep = 0;
let railSetW = 0;
let railPadL = 0;
let railEndTimer = 0;
let railDragging = false;

function makeElementCell(sym) {
  const info = ELEMENTS[sym];
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "el-cell";
  btn.dataset.sym = sym;
  const state = info.state || "solid";
  const stateLabel = state === "unknown" ? "?" : state;
  btn.title = `${info.name} (${sym}) · Z ${info.z} · ${state}`;
  btn.setAttribute(
    "aria-label",
    `${info.name}, ${sym}, atomic number ${info.z}, ${state}`
  );
  const ink = inkFor(info.color);
  btn.style.backgroundColor = info.color;
  btn.style.color = ink;
  btn.innerHTML =
    `<span class="el-top">` +
    `<span class="el-z">${info.z}</span>` +
    `<span class="el-state">${stateLabel}</span>` +
    `</span>` +
    `<span class="el-sym">${sym}</span>` +
    `<span class="el-name">${info.name}</span>`;
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    if (btn.disabled || btn.classList.contains("is-blocked")) return;
    // Rail tap starts or adds — no ghost tap required.
    selectElement(sym);
  });
  return btn;
}

/** Layout metrics only — never use getBoundingClientRect (that includes scale). */
function measureRailLayout() {
  const probe = elementRailInner.querySelector(".el-cell");
  if (!probe) return;
  const style = getComputedStyle(elementRailInner);
  const gap = parseFloat(style.columnGap || style.gap) || 0;
  railPadL = parseFloat(style.paddingLeft) || 0;
  railStep = probe.offsetWidth + gap;
  railSetW = elementRailInner.scrollWidth / 3;
}

/**
 * Infinite-rail recenter: jump by one full copy width when scroll leaves the
 * middle band. Do not touch cell styles here — clearing transform/zIndex on
 * every tile each frame caused scroll flicker.
 */
function normalizeRailCopies() {
  if (railDragging || !railSetW) return;
  let s = elementRailInner.scrollLeft;
  if (s >= railSetW && s < railSetW * 2) return;
  while (s < railSetW) s += railSetW;
  while (s >= railSetW * 2) s -= railSetW;
  if (Math.abs(s - elementRailInner.scrollLeft) > 0.5) {
    elementRailInner.scrollLeft = s;
  }
}

function onRailScroll() {
  // Only normalize after scroll settles — never mid-drag.
  clearTimeout(railEndTimer);
  railEndTimer = setTimeout(() => {
    if (!railDragging) normalizeRailCopies();
  }, 140);
}

function centerRailOnMiddleCopy() {
  measureRailLayout();
  if (railSetW > 0 && railStep > 0) {
    // Second slot of middle copy; one cell from prior copy on the left.
    elementRailInner.scrollLeft = railSetW - railStep;
  }
}

function buildElementRail() {
  elementRailInner.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (let copy = 0; copy < 3; copy++) {
    for (const sym of ELEMENT_LIST) {
      frag.appendChild(makeElementCell(sym));
    }
  }
  elementRailInner.appendChild(frag);
  refreshRailAvailability();

  elementRailInner.removeEventListener("scroll", onRailScroll);
  elementRailInner.addEventListener("scroll", onRailScroll, { passive: true });

  const dragOn = () => {
    railDragging = true;
  };
  const dragOff = () => {
    railDragging = false;
    normalizeRailCopies();
  };
  elementRailInner.addEventListener("pointerdown", dragOn, { passive: true });
  elementRailInner.addEventListener("pointerup", dragOff, { passive: true });
  elementRailInner.addEventListener("pointercancel", dragOff, { passive: true });
  elementRailInner.addEventListener("touchstart", dragOn, { passive: true });
  elementRailInner.addEventListener("touchend", dragOff, { passive: true });

  requestAnimationFrame(() => {
    requestAnimationFrame(centerRailOnMiddleCopy);
  });
}

function normalizeChemText(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, (d) => "0123456789"["₀₁₂₃₄₅₆₇₈₉".indexOf(d)]);
}

/**
 * Relevance score for library search. Short queries only hit name/formula/hint/id
 * (lore prose matches almost everything for "a"). Longer queries can use lore.
 */
function recipeSearchScore(r, q) {
  if (!q) return 1;
  const name = (r.name || "").toLowerCase();
  const formula = normalizeChemText(r.formula);
  const hint = (r.hint || "").toLowerCase();
  const id = (r.id || "").toLowerCase();
  let score = 0;
  if (name.startsWith(q)) score = Math.max(score, 100);
  else if (name.split(/[\s\-_/]+/).some((w) => w.startsWith(q))) score = Math.max(score, 90);
  else if (name.includes(q)) score = Math.max(score, 50);
  if (formula.startsWith(q)) score = Math.max(score, 80);
  else if (formula.includes(q)) score = Math.max(score, 40);
  if (id.startsWith(q)) score = Math.max(score, 70);
  else if (id.includes(q)) score = Math.max(score, 35);
  if (hint.includes(q)) score = Math.max(score, 25);
  // Lore only for 3+ chars — otherwise "a" matches every "England" / "acid" hook.
  if (q.length >= 3) {
    const lore = loreFor(r);
    const loreHay = normalizeChemText(
      `${lore?.discovered || ""} ${lore?.place || ""} ${lore?.hook || ""}`
    );
    if (loreHay.includes(q)) score = Math.max(score, 10);
  }
  // Single letter: name (or id) must start with it — not “Ag…” formulas or “… acid”.
  if (q.length === 1) {
    if (name.startsWith(q) || id.startsWith(q)) return Math.max(score, 70);
    return 0;
  }
  return score;
}

function appendRecipeRow(r) {
  const li = document.createElement("li");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "recipe";
  const lore = loreFor(r);
  const meta =
    lore?.discovered || lore?.place
      ? `<span class="recipe-meta">${[lore.discovered, lore.place].filter(Boolean).join(" · ")}</span>`
      : "";
  const hook = lore?.hook ? `<span class="recipe-hook">${lore.hook}</span>` : "";
  btn.innerHTML =
    `<strong>${r.name}</strong>` +
    `<span class="recipe-line">${r.formula} · ${r.hint}</span>` +
    meta +
    hook;
  btn.addEventListener("click", () => playRecipe(r));
  li.appendChild(btn);
  recipeList.appendChild(li);
}

function recipesInLibraryScope() {
  if (!libraryCategory) return RECIPES;
  return RECIPES.filter((r) => r.category === libraryCategory);
}

function syncRecipeCatChips() {
  if (!recipeCatsEl) return;
  recipeCatsEl.querySelectorAll(".recipe-cat-chip").forEach((btn) => {
    const id = btn.dataset.cat || "";
    const on = id === "" ? libraryCategory == null : libraryCategory === id;
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function makeRecipeCatChip(id, label) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "recipe-cat-chip";
  btn.dataset.cat = id;
  btn.textContent = label;
  btn.setAttribute("aria-pressed", "false");
  btn.addEventListener("click", () => {
    libraryCategory = id || null;
    syncRecipeCatChips();
    buildRecipes(recipeSearch?.value || "");
    // New category list — don't keep the previous scroll offset.
    if (sheetRecipes) sheetRecipes.scrollTop = 0;
  });
  return btn;
}

/** Pack category chips into two rows — content-sized labels, no ellipses. */
function buildRecipeCatChips() {
  if (!recipeCatsEl) return;
  const defs = [
    { id: "", label: "All" },
    ...RECIPE_CATEGORIES.map((cat) => ({
      id: cat.id,
      label: RECIPE_CAT_SHORT[cat.id] || cat.label,
    })),
  ];
  const chips = defs.map((d) => makeRecipeCatChip(d.id, d.label));

  // Measure natural (label) widths — don't let flex grow skew the packer.
  recipeCatsEl.replaceChildren(...chips);
  recipeCatsEl.style.flexDirection = "row";
  recipeCatsEl.style.flexWrap = "nowrap";
  for (const c of chips) c.style.flex = "0 0 auto";
  const gapPx = (() => {
    const g =
      getComputedStyle(recipeCatsEl).gap ||
      getComputedStyle(recipeCatsEl).columnGap;
    const n = parseFloat(g);
    return Number.isFinite(n) ? n : 6;
  })();
  const widths = chips.map((c) => c.getBoundingClientRect().width);
  const avail = recipeCatsEl.clientWidth || 0;
  for (const c of chips) c.style.flex = "";

  let split = Math.ceil(chips.length / 2);
  if (widths.length >= 2) {
    let bestScore = Infinity;
    const prefix = [0];
    for (const w of widths) prefix.push(prefix[prefix.length - 1] + w);
    for (let i = 1; i < chips.length; i++) {
      const w1 = prefix[i] + (i - 1) * gapPx;
      const w2 =
        prefix[chips.length] - prefix[i] + (chips.length - i - 1) * gapPx;
      const overflow =
        avail > 0 ? Math.max(0, w1 - avail) + Math.max(0, w2 - avail) : 0;
      // Prefer balanced rows that fit; keep category order.
      const score = overflow * 1000 + Math.abs(w1 - w2);
      if (score < bestScore) {
        bestScore = score;
        split = i;
      }
    }
  }

  const row1 = document.createElement("div");
  row1.className = "recipe-cats-row";
  const row2 = document.createElement("div");
  row2.className = "recipe-cats-row";
  for (let i = 0; i < split; i++) row1.appendChild(chips[i]);
  for (let i = split; i < chips.length; i++) row2.appendChild(chips[i]);
  recipeCatsEl.style.flexDirection = "";
  recipeCatsEl.style.flexWrap = "";
  recipeCatsEl.replaceChildren(row1, row2);
  syncRecipeCatChips();
}

function buildRecipes(filterText = "") {
  const q = (filterText || "").trim().toLowerCase();
  recipeList.innerHTML = "";
  let shown = 0;
  const scope = recipesInLibraryScope();

  if (q) {
    // Live search within the active category chip (All = whole library).
    const ranked = scope
      .map((r) => ({ r, score: recipeSearchScore(r, q) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.r.name.localeCompare(b.r.name));
    for (const { r } of ranked) {
      appendRecipeRow(r);
      shown += 1;
    }
  } else if (libraryCategory) {
    const cat = RECIPE_CATEGORIES.find((c) => c.id === libraryCategory);
    const items = scope;
    if (cat && items.length) {
      const head = document.createElement("li");
      head.className = "recipe-cat";
      head.textContent = cat.label;
      recipeList.appendChild(head);
    }
    for (const r of items) {
      appendRecipeRow(r);
      shown += 1;
    }
  } else {
    for (const cat of RECIPE_CATEGORIES) {
      const items = RECIPES.filter((r) => r.category === cat.id);
      if (!items.length) continue;
      const head = document.createElement("li");
      head.className = "recipe-cat";
      head.textContent = cat.label;
      recipeList.appendChild(head);
      for (const r of items) {
        appendRecipeRow(r);
        shown += 1;
      }
    }
  }

  if (!shown) {
    const empty = document.createElement("li");
    empty.className = "recipe-empty";
    const catLabel = libraryCategory
      ? RECIPE_CATEGORIES.find((c) => c.id === libraryCategory)?.label
      : null;
    empty.textContent = q
      ? catLabel
        ? `No molecules match “${filterText.trim()}” in ${catLabel}`
        : `No molecules match “${filterText.trim()}”`
      : "No molecules";
    recipeList.appendChild(empty);
  }
}

btnRecipes.addEventListener("click", () => {
  if (sheetRecipes.hidden) {
    closeAbout();
    sheetRecipes.hidden = false;
    btnRecipes.setAttribute("aria-pressed", "true");
    if (recipeSearch) {
      recipeSearch.value = recipeSearch.value || "";
      buildRecipes(recipeSearch.value);
      syncRecipeSearchClear();
      requestAnimationFrame(() => {
        // Sheet was display:none at boot — pack chips now that width is real.
        buildRecipeCatChips();
        recipeSearch.focus();
      });
    } else {
      requestAnimationFrame(() => buildRecipeCatChips());
    }
  } else {
    closeRecipes();
  }
});
document.getElementById("close-recipes").addEventListener("click", closeRecipes);

btnAbout?.addEventListener("click", () => {
  if (!sheetAbout) return;
  if (sheetAbout.hidden) {
    closeRecipes();
    sheetAbout.hidden = false;
    btnAbout.setAttribute("aria-pressed", "true");
  } else {
    closeAbout();
  }
});
document.getElementById("close-about")?.addEventListener("click", closeAbout);
function syncRecipeSearchClear() {
  if (!recipeSearchClear || !recipeSearch) return;
  recipeSearchClear.hidden = !recipeSearch.value;
}

recipeSearch?.addEventListener("input", () => {
  buildRecipes(recipeSearch.value);
  syncRecipeSearchClear();
});

recipeSearchClear?.addEventListener("click", () => {
  if (!recipeSearch) return;
  recipeSearch.value = "";
  buildRecipes("");
  syncRecipeSearchClear();
  recipeSearch.focus();
});
btnClear.addEventListener("click", () => {
  activeRecipe = null;
  pendingEl = null;
  trayLocked = false;
  clearGraph(graph);
  resetSpin();
  setAutoSpin(false);
  buildToken += 1;
  cameraFrameLocked = false;
  resetBuildCamera();
  syncBuildUi();
  // Jump rail back to H / start so available starters are visible, not grayed mid-table.
  requestAnimationFrame(() => {
    centerRailOnMiddleCopy();
  });
});

btnRotate?.addEventListener("click", () => {
  setAutoSpin(!autoSpin);
});

renderer.domElement.addEventListener("pointerdown", onStagePointerDown);
renderer.domElement.addEventListener("pointermove", onStagePointerMove);
renderer.domElement.addEventListener("pointerup", onStagePointerUp);

/** Stage size / aspect change — reframe with the same graph math (spin-safe). */
function onStageLayout({ reframe = true, rail = false } = {}) {
  fit();
  const w = stage.clientWidth || window.innerWidth;
  const h = stage.clientHeight || window.innerHeight;
  const sizeChanged = w !== _layoutW || h !== _layoutH;
  _layoutW = w;
  _layoutH = h;
  if (reframe && sizeChanged && graph.atoms.length) {
    // Keep locked framing math identical to pre-frame (no site inflation on showcase).
    if (cameraFrameLocked || activeRecipe) frameMoleculeFromGraph(graph);
    else frameMolecule();
  }
  if (rail) centerRailOnMiddleCopy();
}

window.addEventListener("resize", () => {
  onStageLayout({ reframe: true, rail: true });
  if (sheetRecipes && !sheetRecipes.hidden) buildRecipeCatChips();
});
if (window.visualViewport) {
  // vv resize changes usable stage on phones — must reframe or boot caffeine “pops”.
  visualViewport.addEventListener("resize", () => {
    onStageLayout({ reframe: true, rail: false });
  });
  visualViewport.addEventListener("scroll", fit);
}
buildElementRail();
fit();
_layoutW = stage.clientWidth || window.innerWidth;
_layoutH = stage.clientHeight || window.innerHeight;
buildRecipeCatChips();
buildRecipes();
syncRecipeSearchClear();

applyRailVisibility();
{
  const boot = RECIPES.find((r) => r.id === "caffeine");
  if (boot) {
    // Showcase tray: chips for teaching, no undo (Clear / free-build unlocks).
    playRecipe(boot);
  } else {
    syncBuildUi();
  }
}
requestAnimationFrame(() => {
  // Catch late Safari/PWA layout without waiting until assemble ends.
  onStageLayout({ reframe: true, rail: false });
  requestAnimationFrame(centerRailOnMiddleCopy);
});

function frame(now) {
  const t = typeof now === "number" ? now : performance.now();
  const dt = Math.min(0.05, Math.max(0, (t - _lastFrameT) / 1000));
  _lastFrameT = t;
  if (autoSpin && spinPointerId == null && dt > 0) {
    _spinQ.setFromAxisAngle(_autoAxisY, AUTO_SPIN_YAW * dt);
    spinGroup.quaternion.premultiply(_spinQ);
    _spinQ.setFromAxisAngle(_autoAxisX, AUTO_SPIN_PITCH * dt);
    spinGroup.quaternion.premultiply(_spinQ);
    spinGroup.quaternion.normalize();
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
