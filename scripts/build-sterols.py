#!/usr/bin/env python3
"""Fetch PubChem 3D sterols and emit sterols.js recipes."""

import json
import urllib.parse
import urllib.request
from pathlib import Path

MOLECULES = [
    ("cholesterol", "cholesterol", "the parent sterol · membranes", "C27H46O"),
    ("cholesteryl oleate", "cholesteryl_oleate", "the ester packed inside LDL", "C45H78O2"),
    ("squalene", "squalene", "the chain that folds into the first sterol", "C30H50"),
    ("lanosterol", "lanosterol", "first sterol · three extra methyls", "C30H50O"),
    ("7-dehydrocholesterol", "dehydrocholesterol_7", "last step before cholesterol · vitamin D3 start", "C27H44O"),
    ("lathosterol", "lathosterol", "synthesis marker · Kandutsch–Russell path", "C27H46O"),
    ("zymosterol", "zymosterol", "on the way to desmosterol", "C27H44O"),
    ("desmosterol", "desmosterol", "synthesis marker · Bloch path", "C27H44O"),
    ("campesterol", "campesterol", "plant sterol · absorption marker", "C28H48O"),
    ("beta-sitosterol", "sitosterol", "main plant sterol · absorption marker", "C29H50O"),
    ("stigmasterol", "stigmasterol", "plant sterol · double bond in the tail", "C29H48O"),
    ("5alpha-cholestan-3beta-ol", "cholestanol", "stanol · absorption marker", "C27H48O"),
    ("campestanol", "campestanol", "saturated campesterol · barely absorbed", "C28H50O"),
    ("stigmastanol", "sitostanol", "saturated sitosterol · the Benecol stanol", "C29H52O"),
    ("27-hydroxycholesterol", "hydroxycholesterol_27", "the 27-hydroxy · acidic bile-acid door", "C27H46O2"),
    ("24S-hydroxycholesterol", "hydroxycholesterol_24s", "made in the brain so cholesterol can leave", "C27H46O2"),
    ("25-hydroxycholesterol", "hydroxycholesterol_25", "immune and cholesterol-sensing signal", "C27H46O2"),
    ("7alpha-hydroxycholesterol", "hydroxycholesterol_7a", "first step of classic bile-acid synthesis", "C27H46O2"),
    ("7beta-hydroxycholesterol", "hydroxycholesterol_7b", "oxidized cholesterol · non-enzymatic", "C27H46O2"),
    ("7-ketocholesterol", "ketocholesterol_7", "oxidized cholesterol on sterol panels", "C27H44O2"),
    ("4beta-hydroxycholesterol", "hydroxycholesterol_4b", "marker of CYP3A drug metabolism", "C27H46O2"),
    ("(22R)-22-hydroxycholesterol", "hydroxycholesterol_22r", "first step toward the steroid hormones", "C27H46O2"),
    ("cholic acid", "cholic_acid", "primary bile acid · three hydroxyls", "C24H40O5"),
    ("chenodeoxycholic acid", "chenodeoxycholic_acid", "the other primary bile acid", "C24H40O4"),
    ("deoxycholic acid", "deoxycholic_acid", "gut bacteria make this from cholic acid", "C24H40O4"),
    ("lithocholic acid", "lithocholic_acid", "gut bacteria make this from chenodeoxycholic acid", "C24H40O3"),
    ("ursodeoxycholic acid", "ursodeoxycholic_acid", "7β cousin · the gallstone drug", "C24H40O4"),
]

DISPLAY = {
    "cholesterol": "Cholesterol",
    "cholesteryl_oleate": "Cholesteryl oleate",
    "squalene": "Squalene",
    "lanosterol": "Lanosterol",
    "dehydrocholesterol_7": "7-Dehydrocholesterol",
    "lathosterol": "Lathosterol",
    "zymosterol": "Zymosterol",
    "desmosterol": "Desmosterol",
    "campesterol": "Campesterol",
    "sitosterol": "β-Sitosterol",
    "stigmasterol": "Stigmasterol",
    "cholestanol": "Cholestanol",
    "campestanol": "Campestanol",
    "sitostanol": "Sitostanol",
    "hydroxycholesterol_27": "27-Hydroxycholesterol",
    "hydroxycholesterol_24s": "24S-Hydroxycholesterol",
    "hydroxycholesterol_25": "25-Hydroxycholesterol",
    "hydroxycholesterol_7a": "7α-Hydroxycholesterol",
    "hydroxycholesterol_7b": "7β-Hydroxycholesterol",
    "ketocholesterol_7": "7-Ketocholesterol",
    "hydroxycholesterol_4b": "4β-Hydroxycholesterol",
    "hydroxycholesterol_22r": "22R-Hydroxycholesterol",
    "cholic_acid": "Cholic acid",
    "chenodeoxycholic_acid": "Chenodeoxycholic acid",
    "deoxycholic_acid": "Deoxycholic acid",
    "lithocholic_acid": "Lithocholic acid",
    "ursodeoxycholic_acid": "Ursodeoxycholic acid",
}

SUB = str.maketrans("0123456789", "₀₁₂₃₄₅₆₇₈₉")


def pretty_formula(hill):
    out = []
    i = 0
    while i < len(hill):
        if hill[i].isdigit():
            j = i
            while j < len(hill) and hill[j].isdigit():
                j += 1
            out.append(hill[i:j].translate(SUB))
            i = j
        else:
            out.append(hill[i])
            i += 1
    return "".join(out)


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "molecule-app/sterols"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def pubchem_props(name):
    q = urllib.parse.quote(name)
    raw = fetch(
        "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/%s/property/MolecularFormula,SMILES,IUPACName/JSON" % q
    )
    return json.loads(raw)["PropertyTable"]["Properties"][0]


def emit(mols):
    chunks = []
    for mol in mols:
        atoms = ",\n".join(
            '    { el: "%s", x: %.4f, y: %.4f, z: %.4f }' % (el, x, y, z)
            for el, x, y, z in mol["atoms"]
        )
        bonds = ", ".join("[%d,%d,%d]" % (a, b, o) for a, b, o in mol["bonds"])
        chunks.append(
            "  {\n"
            '    id: "%s",\n'
            '    formula: "%s",\n'
            '    name: "%s",\n'
            '    hint: "%s",\n'
            '    category: "sterols",\n'
            '    kind: "covalent",\n'
            "    atoms: [\n%s\n    ],\n"
            "    bonds: [%s],\n"
            "  }" % (mol["id"], mol["formula"], mol["name"], mol["hint"], atoms, bonds)
        )
    body = ",\n".join(chunks)
    return (
        "/**\n"
        " * Sterols — cholesterol and the cousins on a sterol panel.\n"
        " * Coordinates from PubChem 3D, centered. Generated by scripts/build-sterols.py.\n"
        " */\n\n"
        "export const STEROL_RECIPES = [\n%s\n];\n" % body
    )


def embed(smiles):
    from rdkit import Chem
    from rdkit.Chem import AllChem

    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        raise SystemExit("bad smiles: %s" % smiles)
    mol = Chem.AddHs(mol)
    params = AllChem.ETKDGv3()
    params.randomSeed = 0xC01E
    if AllChem.EmbedMolecule(mol, params) != 0:
        raise SystemExit("embed failed")
    if AllChem.MMFFOptimizeMolecule(mol) != 0:
        AllChem.UFFOptimizeMolecule(mol)
    return mol


def align_to(ref, mol):
    from rdkit import Chem
    from rdkit.Chem import AllChem

    # Shared steroid nucleus. Squalene has no rings and is left as embedded.
    smarts = "[#6]1-[#6]-[#6]-[#6]2-[#6]-1-[#6]-[#6]-[#6]3-[#6]-2-[#6]-[#6]-[#6]4-[#6]-3-[#6]-[#6]-[#6]-4"
    patt = Chem.MolFromSmarts(smarts)
    ref_match = ref.GetSubstructMatch(patt)
    mol_match = mol.GetSubstructMatch(patt)
    if len(ref_match) < 8 or len(mol_match) < 8:
        return
    AllChem.AlignMol(mol, ref, atomMap=list(zip(mol_match, ref_match)))


def coords_and_bonds(mol):
    conf = mol.GetConformer()
    atoms = []
    for atom in mol.GetAtoms():
        p = conf.GetAtomPosition(atom.GetIdx())
        atoms.append((atom.GetSymbol(), p.x, p.y, p.z))
    n = len(atoms)
    cx = sum(a[1] for a in atoms) / n
    cy = sum(a[2] for a in atoms) / n
    cz = sum(a[3] for a in atoms) / n
    atoms = [(el, x - cx, y - cy, z - cz) for el, x, y, z in atoms]
    bonds = []
    for bond in mol.GetBonds():
        order = int(bond.GetBondTypeAsDouble())
        if order < 1:
            order = 1
        bonds.append((bond.GetBeginAtomIdx(), bond.GetEndAtomIdx(), order))
    return atoms, bonds


def main():
    built = []
    ref = None
    out = []
    for query, mid, hint, expected in MOLECULES:
        print("start %s" % query, flush=True)
        props = pubchem_props(query)
        formula = props["MolecularFormula"]
        smiles = props["SMILES"]
        if formula != expected:
            raise SystemExit("%s: got %s, expected %s (%s)" % (query, formula, expected, props.get("IUPACName", "")))
        mol = embed(smiles)
        if ref is None:
            ref = mol
        else:
            align_to(ref, mol)
        atoms, bonds = coords_and_bonds(mol)
        print("ok %-28s atoms=%3d %s" % (mid, len(atoms), formula), flush=True)
        out.append({
            "id": mid,
            "formula": pretty_formula(formula),
            "name": DISPLAY[mid],
            "hint": hint,
            "atoms": atoms,
            "bonds": bonds,
        })
        built.append(mol)
    dest = Path(__file__).resolve().parents[1] / "sterols.js"
    dest.write_text(emit(out))
    print("wrote %s (%d molecules)" % (dest, len(out)))


if __name__ == "__main__":
    main()
