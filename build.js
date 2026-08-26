import { ELEMENTS } from "./elements.js";
import {
  valenceOf,
  matchRecipeByCounts,
  countsFromSymbols,
  formulaFromCounts,
  recipeFingerprint,
  fingerprintFromAtomsBonds,
  RECIPES,
} from "./data.js";

let _id = 1;
function nextId() {
  return _id++;
}

/** Main-group covalent builders (real small-molecule free build). */
export const COVALENT_ELEMENTS = new Set([
  "H",
  "B",
  "C",
  "N",
  "O",
  "F",
  "Si",
  "P",
  "S",
  "Cl",
  "Br",
  "I",
  "Uo", // mythical — free-build jest
]);

/** Simple salt cations allowed in free build (binary only). */
export const IONIC_CATIONS = new Set(["Li", "Na", "K", "Mg", "Ca"]);

/** Partners for those salts. */
export const IONIC_ANIONS = new Set(["F", "Cl", "Br", "I", "O"]);

export const MAX_COVALENT_ATOMS = 12;
export const MAX_IONIC_ATOMS = 2;

export function isNoble(sym) {
  return valenceOf(sym) <= 0;
}

export function isCovalentElement(sym) {
  return COVALENT_ELEMENTS.has(sym);
}

export function isIonicCation(sym) {
  return IONIC_CATIONS.has(sym);
}

export function isIonicAnion(sym) {
  return IONIC_ANIONS.has(sym);
}

/** True metals / other elements we don't free-build as covalent Lego. */
export function isBlockedMetal(sym) {
  if (isNoble(sym)) return false;
  if (isCovalentElement(sym)) return false;
  if (isIonicCation(sym)) return false;
  return true; // Ga, Zn, Fe, …
}

export function createGraph() {
  return { atoms: [], bonds: [] };
}

export function graphFromRecipe(recipe) {
  const g = createGraph();
  const ids = [];
  for (const a of recipe.atoms) {
    const id = nextId();
    ids.push(id);
    g.atoms.push({ id, el: a.el, x: a.x, y: a.y, z: a.z });
  }
  for (const [i, j, order] of recipe.bonds) {
    g.bonds.push({ a: ids[i], b: ids[j], order: order || 1 });
  }
  return g;
}

export function usedValence(graph, atomId) {
  let u = 0;
  for (const b of graph.bonds) {
    if (b.a === atomId || b.b === atomId) u += b.order || 1;
  }
  return u;
}

export function openCount(graph, atom) {
  return Math.max(0, valenceOf(atom.el) - usedValence(graph, atom.id));
}

export function totalOpen(graph) {
  let n = 0;
  for (const a of graph.atoms) n += openCount(graph, a);
  return n;
}

function graphHasAny(graph, pred) {
  return graph.atoms.some((a) => pred(a.el));
}

function graphIsIonic(graph) {
  return (
    graphHasAny(graph, isIonicCation) ||
    (graph.atoms.length > 0 &&
      graphHasAny(graph, isIonicAnion) &&
      graphHasAny(graph, isIonicCation))
  );
}

function graphIsCovalent(graph) {
  return graph.atoms.length > 0 && graph.atoms.every((a) => isCovalentElement(a.el));
}

/**
 * Whether parentEl can form a free-build bond to childEl under v1 “real” rules.
 */
export function canBondElements(parentEl, childEl, graph) {
  if (isNoble(parentEl) || isNoble(childEl)) return false;
  if (isBlockedMetal(parentEl) || isBlockedMetal(childEl)) return false;

  // Covalent–covalent (H₂O, CH₄, …)
  if (isCovalentElement(parentEl) && isCovalentElement(childEl)) {
    if (graph.atoms.length >= MAX_COVALENT_ATOMS) return false;
    // Don't mix into an ionic salt build
    if (graphHasAny(graph, isIonicCation)) return false;
    return true;
  }

  // Binary ionic only: Na–Cl, Mg–O, …
  const metal = isIonicCation(parentEl)
    ? parentEl
    : isIonicCation(childEl)
      ? childEl
      : null;
  const anion = isIonicAnion(parentEl)
    ? parentEl
    : isIonicAnion(childEl)
      ? childEl
      : null;
  if (metal && anion && metal !== anion) {
    if (graph.atoms.length >= MAX_IONIC_ATOMS) return false;
    // Pure salt path only
    if (graph.atoms.some((a) => !isIonicCation(a.el) && !isIonicAnion(a.el))) {
      return false;
    }
    // Once one cation/anion type is chosen, stick to it
    for (const a of graph.atoms) {
      if (isIonicCation(a.el) && a.el !== metal) return false;
      if (isIonicAnion(a.el) && a.el !== anion) return false;
    }
    return true;
  }

  return false;
}

/** Can this element be the first atom of a new free build? */
export function canStartWith(sym) {
  if (isNoble(sym)) return false;
  if (isBlockedMetal(sym)) return false;
  return isCovalentElement(sym) || isIonicCation(sym);
}

/** Rail: can this element be selected for placement right now? */
export function canSelectElement(sym, graph) {
  if (isNoble(sym) || valenceOf(sym) <= 0) return false;
  if (isBlockedMetal(sym)) return false;

  if (!graph.atoms.length) return canStartWith(sym);

  if (totalOpen(graph) < 1) return false;

  // Must be able to attach to at least one open parent
  for (const atom of graph.atoms) {
    if (openCount(graph, atom) <= 0) continue;
    if (canBondElements(atom.el, sym, graph)) return true;
  }
  return false;
}

export function graphSymbols(graph) {
  return graph.atoms.map((a) => a.el);
}

export function graphFormula(graph) {
  return formulaFromCounts(countsFromSymbols(graphSymbols(graph)));
}

/** Structural fingerprint for a live free-build / loaded graph. */
export function graphFingerprint(graph) {
  const indexOf = new Map(graph.atoms.map((a, i) => [a.id, i]));
  const atoms = graph.atoms.map((a) => ({ el: a.el }));
  const bonds = [];
  for (const b of graph.bonds) {
    const i = indexOf.get(b.a);
    const j = indexOf.get(b.b);
    if (i == null || j == null) continue;
    bonds.push([i, j, b.order || 1]);
  }
  return fingerprintFromAtomsBonds(atoms, bonds);
}

/**
 * Name a free-build only when the structure is trustworthy:
 * prefer exact connectivity match; else unique stoichiometry; never guess isomers.
 */
export function graphRecipeMatch(graph) {
  if (!graph.atoms.length) return null;
  const fp = graphFingerprint(graph);
  const structHits = RECIPES.filter((r) => recipeFingerprint(r) === fp);
  if (structHits.length === 1) return structHits[0];
  if (structHits.length > 1) return structHits[0];
  return matchRecipeByCounts(countsFromSymbols(graphSymbols(graph)));
}

function norm(v) {
  const m = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}

function occupiedDirections(graph, atom) {
  const out = [];
  for (const b of graph.bonds) {
    let other = null;
    if (b.a === atom.id) other = graph.atoms.find((x) => x.id === b.b);
    else if (b.b === atom.id) other = graph.atoms.find((x) => x.id === b.a);
    if (!other) continue;
    out.push(
      norm({
        x: other.x - atom.x,
        y: other.y - atom.y,
        z: other.z - atom.z,
      })
    );
  }
  return out;
}

const TETRA = [
  norm({ x: 1, y: 1, z: 1 }),
  norm({ x: 1, y: -1, z: -1 }),
  norm({ x: -1, y: 1, z: -1 }),
  norm({ x: -1, y: -1, z: 1 }),
];

const TRIGONAL = [
  { x: 1, y: 0, z: 0 },
  { x: -0.5, y: Math.sqrt(3) / 2, z: 0 },
  { x: -0.5, y: -Math.sqrt(3) / 2, z: 0 },
].map(norm);

/** Bent AX₂ centers and their textbook angles (degrees). */
const BENT_ANGLE = { O: 104.5, S: 92 };

/** Trigonal planar centers (120°). */
const TRIGONAL_CENTERS = new Set(["B"]);

/** Tetrahedral / trigonal-pyramidal centers (~109.5°). */
const TETRA_CENTERS = new Set(["C", "N", "Si", "P"]);

function bentAngleFor(el) {
  return BENT_ANGLE[el] ?? null;
}

function bentPairDirs(angleDeg) {
  const half = ((angleDeg / 2) * Math.PI) / 180;
  return [
    { x: Math.sin(half), y: Math.cos(half), z: 0 },
    { x: -Math.sin(half), y: Math.cos(half), z: 0 },
  ];
}

/** Ideal empty-shell directions for `need` open sites on element `el`. */
function emptyShellDirections(need, el) {
  if (need <= 0) return [];
  if (need === 1) return [{ x: 1, y: 0, z: 0 }];
  if (need === 2) {
    const ang = bentAngleFor(el) ?? 104.5;
    return bentPairDirs(ang);
  }
  if (need === 3) {
    if (TRIGONAL_CENTERS.has(el)) return TRIGONAL.slice();
    // N / P pyramidal: three tetrahedron corners (4th = lone pair)
    return TETRA.slice(0, 3);
  }
  return TETRA.slice(0, Math.min(need, 4));
}

/**
 * Map existing bonds onto a fixed shell template; return unused corners.
 * Keeps free-build geometry aligned with recipe VSEPR shapes.
 */
function remainingTemplateDirs(template, occupied, need) {
  const used = new Set();
  for (const o of occupied) {
    let bestI = -1;
    let bestDot = -2;
    for (let i = 0; i < template.length; i++) {
      if (used.has(i)) continue;
      const d =
        o.x * template[i].x + o.y * template[i].y + o.z * template[i].z;
      if (d > bestDot) {
        bestDot = d;
        bestI = i;
      }
    }
    if (bestI >= 0) used.add(bestI);
  }
  const out = [];
  for (let i = 0; i < template.length && out.length < need; i++) {
    if (!used.has(i)) out.push(template[i]);
  }
  return out;
}

function remainingTetraDirs(occupied, need) {
  return remainingTemplateDirs(TETRA, occupied, need);
}

function remainingTrigonalDirs(occupied, need) {
  return remainingTemplateDirs(TRIGONAL, occupied, need);
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot3(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function rodrigues(v, axis, ang) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const d = dot3(axis, v);
  const axv = cross(axis, v);
  return norm({
    x: v.x * c + axv.x * s + axis.x * d * (1 - c),
    y: v.y * c + axv.y * s + axis.y * d * (1 - c),
    z: v.z * c + axv.z * s + axis.z * d * (1 - c),
  });
}

/**
 * Second arm of a bent pair at `angleDeg` from the first bond.
 * Prefers the partner whose bisector points “up” (matches recipe H₂O).
 */
function bentPartner(occupiedDir, angleDeg = 104.5) {
  const o = norm(occupiedDir);
  let axis = cross(o, { x: 0, y: 1, z: 0 });
  if (Math.hypot(axis.x, axis.y, axis.z) < 1e-4) {
    axis = cross(o, { x: 1, y: 0, z: 0 });
  }
  axis = norm(axis);
  const ang = (angleDeg * Math.PI) / 180;
  const a = rodrigues(o, axis, ang);
  const b = rodrigues(o, axis, -ang);
  const bisA = norm({ x: o.x + a.x, y: o.y + a.y, z: o.z + a.z });
  const bisB = norm({ x: o.x + b.x, y: o.y + b.y, z: o.z + b.z });
  return bisA.y >= bisB.y ? a : b;
}

function fibonacciSphere(n) {
  const pts = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = n === 1 ? 0 : 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    pts.push({ x: Math.cos(theta) * r, y, z: Math.sin(theta) * r });
  }
  return pts;
}

/**
 * Pick `need` unit directions around `atom` using VSEPR shells for every
 * free-build center. Fibonacci push-away is only a last-resort fallback.
 */
export function freeDirections(graph, atom, need) {
  const occupied = occupiedDirections(graph, atom);
  if (occupied.length === 0) return emptyShellDirections(need, atom.el);

  const steric = occupied.length + need;
  const bentAng = bentAngleFor(atom.el);

  // Bent AX₂ (O ~104.5°, S ~92°)
  if (bentAng != null && steric <= 2 && occupied.length === 1) {
    return [bentPartner(occupied[0], bentAng)].slice(0, need);
  }

  // Trigonal planar (B)
  if (TRIGONAL_CENTERS.has(atom.el) && steric <= 3) {
    const tri = remainingTrigonalDirs(occupied, need);
    if (tri.length >= need) return tri.slice(0, need);
  }

  // Tetrahedral / pyramidal (C, N, Si, P)
  if (TETRA_CENTERS.has(atom.el) && steric <= 4) {
    const tetra = remainingTetraDirs(occupied, need);
    if (tetra.length >= need) return tetra.slice(0, need);
  }

  // Fallback for odd mixed cases only
  const chosen = [];
  const candidates = fibonacciSphere(64);
  for (let k = 0; k < need; k++) {
    let best = null;
    let bestScore = -Infinity;
    for (const c of candidates) {
      let maxDot = -1;
      for (const o of occupied.concat(chosen)) {
        const d = c.x * o.x + c.y * o.y + c.z * o.z;
        if (d > maxDot) maxDot = d;
      }
      const score = -maxDot;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (best) chosen.push(best);
  }
  return chosen;
}

/**
 * Ghost open sites for placing `pendingEl` (Å coords, same space as recipes).
 */
export function computeOpenSites(graph, pendingEl) {
  if (!pendingEl || !canSelectElement(pendingEl, graph)) return [];
  if (!graph.atoms.length) return [];

  const sites = [];
  const pendingR = ELEMENTS[pendingEl]?.radius || 0.7;

  for (const atom of graph.atoms) {
    const open = openCount(graph, atom);
    if (open <= 0) continue;
    if (!canBondElements(atom.el, pendingEl, graph)) continue;
    // One ghost per atom you can still attach — not per valence slot.
    // O (2 open) + pending O uses order 2 → 1 ghost (O=O), not 2.
    const order = bondOrderForPlacement(graph, atom, pendingEl);
    const nAttach = Math.max(1, Math.floor(open / order));
    const dirs = freeDirections(graph, atom, nAttach);
    const parentR = ELEMENTS[atom.el]?.radius || 0.7;
    // ~recipe C–H length (~1.09 Å) instead of undersized radius sum
    const len = Math.max((parentR + pendingR) * 1.02, 1.05);
    dirs.forEach((dir, i) => {
      sites.push({
        key: `${atom.id}-${i}`,
        parentId: atom.id,
        x: atom.x + dir.x * len,
        y: atom.y + dir.y * len,
        z: atom.z + dir.z * len,
      });
    });
  }
  return sites;
}

export function addFirstAtom(graph, el) {
  if (!canStartWith(el)) {
    throw new Error(`Cannot start a molecule with ${el}`);
  }
  const atom = { id: nextId(), el, x: 0, y: 0, z: 0 };
  graph.atoms.push(atom);
  return atom;
}

/**
 * Bond order when attaching `childEl` to `parent`: use as many bonds as both
 * can share (cap 3) so O₂ / N₂ saturate instead of leaving ghost sites.
 * H always single; C–C caps at 3 (no quadruple).
 */
export function bondOrderForPlacement(graph, parent, childEl) {
  const parentOpen = openCount(graph, parent);
  const childVal = valenceOf(childEl);
  if (parentOpen <= 0 || childVal <= 0) return 1;
  return Math.max(1, Math.min(3, parentOpen, childVal));
}

export function placePendingAtSite(graph, pendingEl, site) {
  const parent = graph.atoms.find((a) => a.id === site.parentId);
  if (!parent) throw new Error("Missing parent atom for site");
  if (!canBondElements(parent.el, pendingEl, graph)) {
    throw new Error(`Cannot bond ${pendingEl} to ${parent.el}`);
  }
  if (openCount(graph, parent) <= 0) {
    throw new Error("Parent has no open sites");
  }
  const order = bondOrderForPlacement(graph, parent, pendingEl);
  const atom = {
    id: nextId(),
    el: pendingEl,
    x: site.x,
    y: site.y,
    z: site.z,
  };
  graph.atoms.push(atom);
  graph.bonds.push({ a: site.parentId, b: atom.id, order });
  return atom;
}

/**
 * Undo the most recently added atom (end of `atoms` / free-build order).
 * Removes that atom and every bond touching it. Returns the removed element
 * symbol, or null if the graph was empty.
 */
export function removeLastAtom(graph) {
  if (!graph.atoms.length) return null;
  const atom = graph.atoms.pop();
  for (let i = graph.bonds.length - 1; i >= 0; i--) {
    const b = graph.bonds[i];
    if (b.a === atom.id || b.b === atom.id) graph.bonds.splice(i, 1);
  }
  return atom.el;
}

export function clearGraph(graph) {
  graph.atoms.length = 0;
  graph.bonds.length = 0;
}
