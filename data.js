export { ELEMENTS, ELEMENT_LIST, PT_ROWS, PT_COLS } from "./elements.js";
import { ELEMENTS } from "./elements.js";
export { RECIPES, RECIPE_CATEGORIES } from "./recipes.js";
import { RECIPES } from "./recipes.js";

export function countsFromSymbols(symbols) {
  const counts = {};
  for (const s of symbols) counts[s] = (counts[s] || 0) + 1;
  return counts;
}

export function countsKey(counts) {
  return Object.keys(counts)
    .sort()
    .map((s) => s + counts[s])
    .join("");
}

/** Stoichiometry-only match — ambiguous when isomers share a formula. */
export function matchRecipeByCounts(symbolCounts) {
  const key = countsKey(symbolCounts);
  const hits = [];
  for (const r of RECIPES) {
    const counts = {};
    for (const a of r.atoms) counts[a.el] = (counts[a.el] || 0) + 1;
    if (countsKey(counts) === key) hits.push(r);
  }
  if (hits.length === 1) return hits[0];
  return null;
}

/** @deprecated use matchRecipeByCounts or graphRecipeMatch */
export function matchRecipe(symbolCounts) {
  return matchRecipeByCounts(symbolCounts);
}

/**
 * Connectivity fingerprint: each atom’s element + sorted neighborEl:order list.
 * Distinguishes ethanol vs dimethyl ether, butane vs isobutane, etc.
 */
export function fingerprintFromAtomsBonds(atoms, bonds) {
  const n = atoms.length;
  const neigh = Array.from({ length: n }, () => []);
  for (const b of bonds) {
    const i = b[0];
    const j = b[1];
    const order = b[2] || 1;
    if (i < 0 || j < 0 || i >= n || j >= n) continue;
    neigh[i].push(`${atoms[j].el}:${order}`);
    neigh[j].push(`${atoms[i].el}:${order}`);
  }
  return atoms
    .map((a, i) => {
      const ns = neigh[i].slice().sort();
      return `${a.el}[${ns.join(",")}]`;
    })
    .sort()
    .join("|");
}

export function recipeFingerprint(recipe) {
  return fingerprintFromAtomsBonds(recipe.atoms, recipe.bonds);
}

/** Common bonding capacity for the builder (from elements.js valence). */
export function valenceOf(sym) {
  return ELEMENTS[sym]?.valence ?? 0;
}

/**
 * Open bonding sites left if atoms were joined in order as a connected tree.
 * First atom opens `valence` sites; each add spends 1 on each side
 * (remaining := remaining + valence(new) - 2).
 */
export function remainingValence(symbols) {
  if (!symbols.length) return 0;
  let rem = valenceOf(symbols[0]);
  for (let i = 1; i < symbols.length; i++) {
    rem = rem + valenceOf(symbols[i]) - 2;
  }
  return rem;
}

/** Legacy tray helper — prefer canSelectElement(graph) from build.js. */
export function canAddElement(sym, symbols) {
  const v = valenceOf(sym);
  if (v <= 0) return false;
  if (!symbols.length) return true;
  return remainingValence(symbols) >= 1;
}

/** Metals / cations that lead salt formulas (MgO, NaCl, CaCl₂…). */
const FORMULA_METALS = new Set([
  "Li",
  "Na",
  "K",
  "Rb",
  "Cs",
  "Fr",
  "Be",
  "Mg",
  "Ca",
  "Sr",
  "Ba",
  "Ra",
  "Al",
  "Zn",
  "Cu",
  "Fe",
  "Ag",
  "Pb",
  "Sn",
  "Ti",
  "Mn",
  "Ni",
  "Co",
]);

const ANION_ORDER = ["O", "S", "F", "Cl", "Br", "I", "N", "C", "H", "P", "B", "Si"];

export function formulaFromCounts(counts) {
  const keys = Object.keys(counts);
  const metalFirst = keys.some((k) => FORMULA_METALS.has(k));
  keys.sort((a, b) => {
    if (metalFirst) {
      const am = FORMULA_METALS.has(a);
      const bm = FORMULA_METALS.has(b);
      if (am !== bm) return am ? -1 : 1;
      if (am && bm) return a.localeCompare(b);
      const ia = ANION_ORDER.indexOf(a);
      const ib = ANION_ORDER.indexOf(b);
      if (ia !== -1 || ib !== -1) {
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        if (ia !== ib) return ia - ib;
      }
      return a.localeCompare(b);
    }
    // Hill system: C, then H, then alphabetical
    if (a === "C" && b !== "C") return -1;
    if (b === "C" && a !== "C") return 1;
    if (a === "H" && b !== "H") return -1;
    if (b === "H" && a !== "H") return 1;
    return a.localeCompare(b);
  });
  const sub = "₀₁₂₃₄₅₆₇₈₉";
  return keys
    .map((el) => {
      const n = counts[el];
      if (n <= 1) return el;
      return (
        el +
        String(n)
          .split("")
          .map((d) => sub[Number(d)])
          .join("")
      );
    })
    .join("");
}
