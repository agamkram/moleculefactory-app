/**
 * Automated checks for site-based building (no browser required).
 * Run: node test-build.mjs
 */
import {
  createGraph,
  addFirstAtom,
  placePendingAtSite,
  removeLastAtom,
  computeOpenSites,
  totalOpen,
  canSelectElement,
  graphRecipeMatch,
  graphFromRecipe,
  graphFormula,
  clearGraph,
} from "./build.js";
import {
  RECIPES,
  ELEMENTS,
  ELEMENT_LIST,
  formulaFromCounts,
  recipeFingerprint,
  matchRecipeByCounts,
} from "./data.js";

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error("FAIL:", msg);
  } else {
    console.log("ok:", msg);
  }
}

// --- water via sites ---
{
  const g = createGraph();
  addFirstAtom(g, "O");
  assert(totalOpen(g) === 2, "O has 2 open sites");
  let sites = computeOpenSites(g, "H");
  assert(sites.length === 2, "2 glowing H sites on bare O");
  // bent-ish: both have positive y in emptyShellDirections
  assert(
    sites.every((s) => s.y > 0),
    "water-like sites bend upward"
  );
  placePendingAtSite(g, "H", sites[0]);
  assert(totalOpen(g) === 1, "1 open after first H");
  sites = computeOpenSites(g, "H");
  assert(sites.length === 1, "1 H site remains");
  placePendingAtSite(g, "H", sites[0]);
  assert(totalOpen(g) === 0, "water saturated");
  assert(graphRecipeMatch(g)?.id === "h2o", "matches Water recipe");
  assert(graphFormula(g) === "H₂O" || graphFormula(g).includes("H"), "formula has H");
  {
    const o = g.atoms[0];
    const h1 = g.atoms[1];
    const h2 = g.atoms[2];
    const u = { x: h1.x - o.x, y: h1.y - o.y, z: h1.z - o.z };
    const v = { x: h2.x - o.x, y: h2.y - o.y, z: h2.z - o.z };
    const du = Math.hypot(u.x, u.y, u.z);
    const dv = Math.hypot(v.x, v.y, v.z);
    const ang =
      (Math.acos(
        Math.min(1, Math.max(-1, (u.x * v.x + u.y * v.y + u.z * v.z) / (du * dv)))
      ) *
        180) /
      Math.PI;
    assert(ang > 95 && ang < 115, `free-build water angle ~104.5° (got ${ang.toFixed(1)})`);
  }
  assert(!canSelectElement("N", g), "rail blocks when saturated");
  assert(!canSelectElement("He", createGraph()), "He blocked empty");
  assert(!canSelectElement("Ga", createGraph()), "Ga blocked as starter");
  assert(!canSelectElement("Zn", createGraph()), "Zn blocked as starter");
}

// --- no metal clusters (Ga39Zn) ---
{
  const g = createGraph();
  assert(!canSelectElement("Ga", g), "cannot start with Ga");
  addFirstAtom(g, "O");
  assert(!canSelectElement("Ga", g), "cannot add Ga onto O");
  assert(!canSelectElement("Zn", g), "cannot add Zn onto O");
  assert(computeOpenSites(g, "Ga").length === 0, "no Ga sites on O");
}

// --- NaCl free build ok ---
{
  const g = createGraph();
  assert(canSelectElement("Na", g), "can start with Na");
  addFirstAtom(g, "Na");
  assert(canSelectElement("Cl", g), "Cl onto Na");
  assert(!canSelectElement("C", g), "no carbon on salt");
  const sites = computeOpenSites(g, "Cl");
  assert(sites.length >= 1, "Cl site on Na");
  placePendingAtSite(g, "Cl", sites[0]);
  assert(graphRecipeMatch(g)?.id === "nacl", "matches NaCl");
  assert(!canSelectElement("Cl", g), "salt complete — no more Cl");
}

// --- methane ---
{
  const g = createGraph();
  addFirstAtom(g, "C");
  assert(computeOpenSites(g, "H").length === 4, "C offers 4 H sites");
  for (let i = 0; i < 4; i++) {
    const sites = computeOpenSites(g, "H");
    assert(sites.length === 4 - i, `CH4 sites left ${4 - i}`);
    placePendingAtSite(g, "H", sites[0]);
  }
  assert(graphRecipeMatch(g)?.id === "ch4", "matches Methane");
}

// --- ammonia ---
{
  const g = createGraph();
  addFirstAtom(g, "N");
  assert(computeOpenSites(g, "H").length === 3, "N offers 3 H sites");
  for (let i = 0; i < 3; i++) {
    placePendingAtSite(g, "H", computeOpenSites(g, "H")[0]);
  }
  assert(graphRecipeMatch(g)?.id === "nh3", "matches Ammonia");
}

function bondAngle(g, centerIdx, aIdx, bIdx) {
  const c = g.atoms[centerIdx];
  const a = g.atoms[aIdx];
  const b = g.atoms[bIdx];
  const u = { x: a.x - c.x, y: a.y - c.y, z: a.z - c.z };
  const v = { x: b.x - c.x, y: b.y - c.y, z: b.z - c.z };
  const du = Math.hypot(u.x, u.y, u.z);
  const dv = Math.hypot(v.x, v.y, v.z);
  return (
    (Math.acos(
      Math.min(1, Math.max(-1, (u.x * v.x + u.y * v.y + u.z * v.z) / (du * dv)))
    ) *
      180) /
    Math.PI
  );
}

function buildCenter(center, ligands) {
  const g = createGraph();
  addFirstAtom(g, center);
  for (const L of ligands) {
    const sites = computeOpenSites(g, L);
    assert(sites.length > 0, `${center}+${L}: has site`);
    placePendingAtSite(g, L, sites[0]);
  }
  return g;
}

// --- VSEPR geometry for every multi-valent free-build center ---
{
  const water = buildCenter("O", ["H", "H"]);
  const wAng = bondAngle(water, 0, 1, 2);
  assert(Math.abs(wAng - 104.5) < 1, `H2O angle 104.5 (got ${wAng.toFixed(1)})`);

  const h2s = buildCenter("S", ["H", "H"]);
  const sAng = bondAngle(h2s, 0, 1, 2);
  assert(Math.abs(sAng - 92) < 1, `H2S angle 92 (got ${sAng.toFixed(1)})`);

  const bh3 = buildCenter("B", ["H", "H", "H"]);
  for (const [i, j] of [
    [1, 2],
    [1, 3],
    [2, 3],
  ]) {
    const a = bondAngle(bh3, 0, i, j);
    assert(Math.abs(a - 120) < 1, `BH3 angle 120 (got ${a.toFixed(1)})`);
  }

  const ph3 = buildCenter("P", ["H", "H", "H"]);
  for (const [i, j] of [
    [1, 2],
    [1, 3],
    [2, 3],
  ]) {
    const a = bondAngle(ph3, 0, i, j);
    assert(Math.abs(a - 109.5) < 1, `PH3 tetra angle ~109.5 (got ${a.toFixed(1)})`);
  }

  const ch4 = buildCenter("C", ["H", "H", "H", "H"]);
  for (let i = 1; i <= 4; i++) {
    for (let j = i + 1; j <= 4; j++) {
      const a = bondAngle(ch4, 0, i, j);
      assert(Math.abs(a - 109.5) < 1, `CH4 angle 109.5 (got ${a.toFixed(1)})`);
    }
  }

  const nh3 = buildCenter("N", ["H", "H", "H"]);
  for (const [i, j] of [
    [1, 2],
    [1, 3],
    [2, 3],
  ]) {
    const a = bondAngle(nh3, 0, i, j);
    assert(Math.abs(a - 109.5) < 1, `NH3 tetra angle ~109.5 (got ${a.toFixed(1)})`);
  }

  const sih4 = buildCenter("Si", ["H", "H", "H", "H"]);
  for (let i = 1; i <= 4; i++) {
    for (let j = i + 1; j <= 4; j++) {
      const a = bondAngle(sih4, 0, i, j);
      assert(Math.abs(a - 109.5) < 1, `SiH4 angle 109.5 (got ${a.toFixed(1)})`);
    }
  }
}

// --- O₂ / N₂ saturate via multiple bonds (no leftover ghosts) ---
{
  const g = createGraph();
  addFirstAtom(g, "O");
  assert(computeOpenSites(g, "O").length === 1, "bare O offers 1 O site (double bond)");
  assert(computeOpenSites(g, "H").length === 2, "bare O still offers 2 H sites");
  placePendingAtSite(g, "O", computeOpenSites(g, "O")[0]);
  assert(g.bonds[0].order === 2, "O=O double bond");
  assert(totalOpen(g) === 0, "O2 saturated");
  assert(graphRecipeMatch(g)?.id === "o2", "matches Oxygen recipe");
  assert(computeOpenSites(g, "O").length === 0, "no O ghosts on O2");
}
{
  const g = createGraph();
  addFirstAtom(g, "N");
  placePendingAtSite(g, "N", computeOpenSites(g, "N")[0]);
  assert(g.bonds[0].order === 3, "N≡N triple bond");
  assert(totalOpen(g) === 0, "N2 saturated");
  assert(graphRecipeMatch(g)?.id === "n2", "matches Nitrogen recipe");
}
{
  const g = createGraph();
  addFirstAtom(g, "O");
  placePendingAtSite(g, "H", computeOpenSites(g, "H")[0]);
  assert(g.bonds[0].order === 1, "O–H stays single");
  assert(totalOpen(g) === 1, "OH still has 1 open");
}

// --- tray undo (remove last atom) ---
{
  const g = createGraph();
  addFirstAtom(g, "O");
  placePendingAtSite(g, "H", computeOpenSites(g, "H")[0]);
  placePendingAtSite(g, "H", computeOpenSites(g, "H")[0]);
  assert(g.atoms.length === 3 && g.bonds.length === 2, "water before undo");
  assert(removeLastAtom(g) === "H", "undo returns H");
  assert(g.atoms.length === 2 && g.bonds.length === 1, "one H left after undo");
  assert(totalOpen(g) === 1, "open site restored after undo");
  assert(removeLastAtom(g) === "H", "undo second H");
  assert(removeLastAtom(g) === "O", "undo center O");
  assert(g.atoms.length === 0 && g.bonds.length === 0, "empty after full undo");
  assert(removeLastAtom(g) === null, "undo on empty is null");
}

// --- cannot place without open parent ---
{
  const g = createGraph();
  addFirstAtom(g, "H");
  assert(totalOpen(g) === 1, "H has 1 open");
  placePendingAtSite(g, "H", computeOpenSites(g, "H")[0]);
  assert(totalOpen(g) === 0, "H2 saturated");
  assert(computeOpenSites(g, "O").length === 0, "no sites on saturated H2");
}

// --- recipe import ---
{
  const g = graphFromRecipe(RECIPES.find((r) => r.id === "co2"));
  assert(g.atoms.length === 3 && g.bonds.length === 2, "CO2 recipe graph");
  clearGraph(g);
  assert(g.atoms.length === 0, "clearGraph works");
}

// --- formula order: salts metal-first, organics Hill ---
{
  assert(formulaFromCounts({ O: 1, Mg: 1 }) === "MgO", "MgO not OMg");
  assert(formulaFromCounts({ Cl: 1, Na: 1 }) === "NaCl", "NaCl");
  assert(formulaFromCounts({ Cl: 2, Ca: 1 }) === "CaCl₂", "CaCl₂");
  assert(formulaFromCounts({ H: 2, O: 1 }) === "H₂O", "H₂O Hill");
  assert(formulaFromCounts({ C: 1, H: 4 }) === "CH₄", "CH₄ Hill");
}

// --- live compositional naming keeps up as BN grows ---
{
  const { nameMolecule, binaryCompositionName } = await import("./names.js");
  assert(
    binaryCompositionName({ B: 1, N: 1 })?.toLowerCase().includes("boron") &&
      binaryCompositionName({ B: 1, N: 1 })?.toLowerCase().includes("nitrid"),
    "BN → boron nitride"
  );
  assert(
    binaryCompositionName({ B: 2, N: 2 })?.toLowerCase().includes("diboron"),
    "B2N2 → diboron…"
  );
  assert(
    binaryCompositionName({ B: 3, N: 3 })?.toLowerCase().includes("triboron"),
    "B3N3 → triboron…"
  );
  const g = createGraph();
  addFirstAtom(g, "B");
  assert(nameMolecule(g) === "Boron", "lone B named Boron");
  placePendingAtSite(g, "N", computeOpenSites(g, "N")[0]);
  const bn = nameMolecule(g);
  assert(/boron nitride/i.test(bn), `BN named boron nitride (got ${bn})`);
  const g2 = createGraph();
  addFirstAtom(g2, "Mg");
  placePendingAtSite(g2, "O", computeOpenSites(g2, "O")[0]);
  assert(/magnesium oxide/i.test(nameMolecule(g2)), "MgO → magnesium oxide");
}

// --- isomer naming: don't confuse ethanol with dimethyl ether ---
{
  const eth = RECIPES.find((r) => r.id === "ethanol");
  const dme = RECIPES.find((r) => r.id === "dme");
  assert(eth && dme, "ethanol and dme recipes exist");
  assert(
    recipeFingerprint(eth) !== recipeFingerprint(dme),
    "ethanol fingerprint ≠ dimethyl ether"
  );
  const g = graphFromRecipe(eth);
  assert(graphRecipeMatch(g)?.id === "ethanol", "loaded ethanol matches ethanol");
  // Ambiguous stoich alone must not pick a single isomer
  assert(matchRecipeByCounts({ C: 2, H: 6, O: 1 }) === null, "C2H6O stoich is ambiguous");
}

// --- elements data integrity ---
{
  assert(ELEMENT_LIST.length === 119, "118 real + Unobtainium");
  assert(ELEMENTS.Uo?.z === 119 && ELEMENTS.Uo?.name === "Unobtainium", "Uo mythical");
  for (const s of ELEMENT_LIST) {
    assert(ELEMENTS[s] && typeof ELEMENTS[s].valence === "number", `${s} valence`);
  }
}

// --- recipe book accuracy: covalent recipes must be valence-complete ---
{
  let covalent = 0;
  for (const r of RECIPES) {
    assert(r.kind, `${r.id} has kind`);
    const g = graphFromRecipe(r);
    if (r.kind === "covalent") {
      covalent += 1;
      assert(
        totalOpen(g) === 0,
        `covalent ${r.id} valence-complete (open=${totalOpen(g)})`
      );
    }
  }
  assert(covalent > 100, `many covalent recipes (${covalent})`);
}

// --- DNA 11 bp: each base pair populated (phosphate+sugar+base, R↔Y, H-bond) ---
{
  const dna = RECIPES.find((r) => r.id === "dna_11bp");
  assert(!!dna, "dna_11bp recipe exists");
  if (dna) {
    const atoms = dna.atoms;
    const bonds = dna.bonds;
    const bondSet = new Set(bonds.map(([a, b]) => (a < b ? `${a}-${b}` : `${b}-${a}`)));
    const hasBond = (a, b) => bondSet.has(a < b ? `${a}-${b}` : `${b}-${a}`);
    const pIdx = [];
    for (let i = 0; i < atoms.length; i++) if (atoms[i].el === "P") pIdx.push(i);
    assert(pIdx.length === 22, `dna_11bp has 22 phosphates (got ${pIdx.length})`);
    assert(pIdx.length % 2 === 0, "dna phosphates even (paired strands)");

    const gaps = [];
    for (let i = 0; i < pIdx.length - 1; i++) gaps.push(pIdx[i + 1] - pIdx[i]);
    gaps.push(atoms.length - pIdx[pIdx.length - 1]);

    const nBp = pIdx.length / 2;
    assert(nBp === 11, `dna_11bp has 11 base pairs (got ${nBp})`);

    let allOk = true;
    for (let p = 0; p < nBp; p++) {
      const iA = 2 * p;
      const iB = 2 * p + 1;
      const nA = gaps[iA];
      const nB = gaps[iB];
      const startA = pIdx[iA];
      const startB = pIdx[iB];
      const elsA = atoms.slice(startA, startA + nA).map((a) => a.el).join("");
      const elsB = atoms.slice(startB, startB + nB).map((a) => a.el).join("");
      const baseA = elsA.slice(9);
      const baseB = elsB.slice(9);
      const typeA = baseA === "NCNCN" ? "R" : baseA === "NCCN" ? "Y" : "?";
      const typeB = baseB === "NCNCN" ? "R" : baseB === "NCCN" ? "Y" : "?";
      const tipA = startA + nA - 1;
      const tipB = startB + nB - 1;
      const expectA = p % 2 === 0 ? "R" : "Y";
      const sugarOk =
        elsA.startsWith("POOOCCCCO") &&
        elsB.startsWith("POOOCCCCO") &&
        elsA[9] === "N" &&
        elsB[9] === "N";
      const pairOk = new Set([typeA, typeB]).size === 2 && typeA !== "?" && typeB !== "?";
      const seqOk = typeA === expectA;
      const hOk =
        atoms[tipA].el === "N" && atoms[tipB].el === "N" && hasBond(tipA, tipB);
      const Pa = atoms[startA];
      const Pb = atoms[startB];
      const opposite = Pa.x * Pb.x + Pa.y * Pb.y < 0;
      const sameZ = Math.abs(Pa.z - Pb.z) < 0.02;
      const ok = sugarOk && pairOk && seqOk && hOk && opposite && sameZ;
      if (!ok) allOk = false;
      assert(
        ok,
        `dna bp${String(p).padStart(2, "0")} populated ` +
          `A:${typeA}(${baseA})↔B:${typeB}(${baseB}) ` +
          `sugar=${sugarOk} pair=${pairOk} seq=${seqOk} H=${hOk} opp=${opposite} z=${sameZ}`
      );
    }
    // Backbone continuity along each strand
    let backboneOk = true;
    for (let p = 0; p < nBp - 1; p++) {
      if (!hasBond(pIdx[2 * p], pIdx[2 * (p + 1)])) backboneOk = false;
      if (!hasBond(pIdx[2 * p + 1], pIdx[2 * (p + 1) + 1])) backboneOk = false;
    }
    assert(backboneOk, "dna_11bp backbone continuous on both strands");
    assert(allOk, "dna_11bp every base pair correctly populated");
  }
}

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log("\nAll build tests passed.");
