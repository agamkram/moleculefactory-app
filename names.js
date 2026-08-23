import { ELEMENTS } from "./elements.js";
import { formulaFromCounts, countsFromSymbols } from "./data.js";
import { graphSymbols, graphFormula, graphRecipeMatch } from "./build.js";

const PREFIX = [
  "",
  "mono",
  "di",
  "tri",
  "tetra",
  "penta",
  "hexa",
  "hepta",
  "octa",
  "nona",
  "deca",
  "undeca",
  "dodeca",
];

/** Stem used in binary …ide names (chloride, oxide, nitride…). */
const IDE_STEM = {
  H: "hydrid",
  B: "borid",
  C: "carbid",
  N: "nitrid",
  O: "oxid",
  F: "fluorid",
  Si: "silicid",
  P: "phosphid",
  S: "sulfid",
  Cl: "chlorid",
  Br: "bromid",
  I: "iodid",
  Se: "selenid",
  Te: "tellurid",
  As: "arsenid",
};

const METALS = new Set([
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
  "Ga",
]);

function prefix(n, { skipMono = false } = {}) {
  if (n <= 0) return "";
  if (n === 1 && skipMono) return "";
  return PREFIX[n] || `${n}-`;
}

function elementWord(sym) {
  return (ELEMENTS[sym]?.name || sym).toLowerCase();
}

function ideName(sym) {
  const stem = IDE_STEM[sym];
  if (stem) return `${stem}e`;
  return `${elementWord(sym)}ide`;
}

/**
 * Binary compositional name that scales with counts:
 * BN → boron nitride, B₂N₂ → diboron dinitride, MgO → magnesium oxide.
 */
export function binaryCompositionName(counts) {
  const keys = Object.keys(counts);
  if (keys.length !== 2) return null;
  const [a, b] = keys;
  const na = counts[a];
  const nb = counts[b];
  if (na > 12 || nb > 12) return null;

  const aMetal = METALS.has(a);
  const bMetal = METALS.has(b);

  // Metal + nonmetal → salt-style (no prefixes unless needed for clarity)
  if (aMetal !== bMetal) {
    const metal = aMetal ? a : b;
    const non = aMetal ? b : a;
    const nMetal = counts[metal];
    const nNon = counts[non];
    // magnesium chloride, calcium chloride (CaCl₂ — still "calcium chloride")
    if (nMetal === 1) {
      return `${elementWord(metal)} ${ideName(non)}`;
    }
    // e.g. dieisen trioxide style if we ever get there
    return `${prefix(nMetal)}${elementWord(metal)} ${prefix(nNon)}${ideName(non)}`
      .replace(/\s+/g, " ")
      .trim();
  }

  // Two nonmetals (or two metals): Greek prefixes on both; drop mono- on the first.
  // 1:1 → "boron nitride" (not mononitride); keep "carbon monoxide".
  const first = a.localeCompare(b) <= 0 ? a : b;
  const second = first === a ? b : a;
  const n1 = counts[first];
  const n2 = counts[second];
  const left = `${prefix(n1, { skipMono: true })}${elementWord(first)}`;
  const skipMonoRight = n1 === 1 && n2 === 1 && second !== "O";
  const right = `${prefix(n2, { skipMono: skipMonoRight })}${ideName(second)}`;
  return `${left} ${right}`.replace(/\s+/g, " ").trim();
}

/** Single-element name: boron, dioxygen, tetrasulfur, … */
export function elementalName(counts) {
  const keys = Object.keys(counts);
  if (keys.length !== 1) return null;
  const el = keys[0];
  const n = counts[el];
  if (n === 1) return ELEMENTS[el]?.name || el;
  const p = prefix(n);
  const base = elementWord(el);
  // dioxygen, not dioxygen gas — capitalize like a title name
  const raw = `${p}${base}`;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/**
 * Best teaching name for the current graph:
 * 1) library structural/unique match
 * 2) compositional binary / elemental name that keeps up as you add atoms
 * 3) formula fallback
 */
export function nameMolecule(graph) {
  if (!graph?.atoms?.length) return null;
  const hit = graphRecipeMatch(graph);
  if (hit?.name) return hit.name;

  const counts = countsFromSymbols(graphSymbols(graph));
  const elemental = elementalName(counts);
  if (elemental) return elemental;

  const binary = binaryCompositionName(counts);
  if (binary) {
    return binary.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  return graphFormula(graph);
}
