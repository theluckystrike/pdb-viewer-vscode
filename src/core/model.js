'use strict';
// Builds the side tree, the sequence strip and the facts panel from a parsed structure (src/core/parse.js).
// Pure functions, no vscode import.
const { AMINO, NUCLEIC, WATER, RESIDUE_KIND } = require('./parse');

const METALS = new Set(['Li', 'Na', 'K', 'Rb', 'Cs', 'Be', 'Mg', 'Ca', 'Sr', 'Ba', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Cd', 'Hg', 'Al', 'Ga', 'Pt', 'Au', 'Ag', 'Pb', 'Cr', 'V', 'Mo', 'W', 'Ir', 'Os', 'Ru', 'Rh', 'Pd', 'Tl', 'Yb', 'Gd', 'Sm', 'Eu', 'Tb', 'La', 'Ce', 'Cl', 'Br', 'I', 'F']);
const SMALL_FORMATS = new Set(['sdf', 'mol2', 'xyz', 'cif-small']);

const resKey = (a) => `${a.chain}:${a.resi}${a.icode || ''}`;
/** "A:42" -> { chain: 'A', resi: 42, icode: '' } */
function parseKey(key) {
  const m = /^(.*):(-?\d+)([A-Za-z]?)$/.exec(String(key));
  return m ? { chain: m[1], resi: Number(m[2]), icode: m[3] } : null;
}

function residueKind(resn, atoms, het) {
  const r = String(resn).toUpperCase();
  if (WATER.has(r)) return 'water';
  const k = RESIDUE_KIND[r];
  // a HETATM group named UNK (tools write it for any molecule) is a polymer residue only with a backbone C-alpha
  if (k === 'protein' && (het || r === 'UNK') && !atoms.some((a) => a.name === 'CA')) return atoms.length === 1 && METALS.has(atoms[0].elem) ? 'ion' : 'ligand';
  if (k && (!het || AMINO[r] || NUCLEIC[r])) return k;
  if (atoms.length === 1 && METALS.has(atoms[0].elem)) return 'ion';
  return 'ligand';
}

/** Groups the atoms of one model into chains and residues. Returns residues in file order with atom indices. */
function residuesOf(atoms) {
  const byKey = new Map();
  const list = [];
  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i];
    const k = `${resKey(a)}|${a.resn}`;
    let r = byKey.get(k);
    if (!r) { r = { key: resKey(a), chain: a.chain, resi: a.resi, icode: a.icode || '', resn: a.resn, idx: [], het: a.het }; byKey.set(k, r); list.push(r); }
    r.idx.push(i);
    if (!a.het) r.het = false;
  }
  for (const r of list) r.kind = residueKind(r.resn, r.idx.map((i) => atoms[i]), r.het);
  return list;
}

function formula(counts) {
  const keys = Object.keys(counts);
  const order = [];
  if (counts.C) { order.push('C'); if (counts.H) order.push('H'); }
  for (const k of keys.sort()) if (!order.includes(k)) order.push(k);
  return order.map((k) => `${k}${counts[k] > 1 ? counts[k] : ''}`).join('');
}

/** Summary of model mi: { format, title, id, models, atoms, kind, chains, ligands, waters, elements, formula, bRange, ss } */
function summarize(struct, mi = 0) {
  const model = struct.models[mi] || struct.models[0] || { atoms: [] };
  const atoms = model.atoms;
  const res = residuesOf(atoms);
  const elements = {};
  let bMin = Infinity, bMax = -Infinity;
  for (const a of atoms) {
    const e = a.elem || '?';
    elements[e] = (elements[e] || 0) + 1;
    if (a.b < bMin) bMin = a.b;
    if (a.b > bMax) bMax = a.b;
  }
  const polymerRes = res.filter((r) => r.kind === 'protein' || r.kind === 'nucleic');
  const small = SMALL_FORMATS.has(struct.format) && polymerRes.length < 2;
  const ssOf = ssLookup(struct);
  const chainsMap = new Map();
  const ligands = [];
  let waters = 0;
  for (const r of res) {
    if (r.kind === 'water') { waters++; continue; }
    if (r.kind === 'ligand' || r.kind === 'ion') {
      ligands.push({ key: r.key, resn: r.resn, chain: r.chain, resi: r.resi, icode: r.icode, atoms: r.idx.length, kind: r.kind });
      continue;
    }
    if (!chainsMap.has(r.chain)) chainsMap.set(r.chain, { id: r.chain, residues: [], polymer: '' });
    const code = (r.kind === 'protein' ? AMINO[r.resn.toUpperCase()] : NUCLEIC[r.resn.toUpperCase()]) || 'X';
    chainsMap.get(r.chain).residues.push({ key: r.key, resn: r.resn, resi: r.resi, icode: r.icode, kind: r.kind, atoms: r.idx.length, code, ss: ssOf(r.chain, r.resi) });
  }
  const chains = [...chainsMap.values()];
  for (const c of chains) {
    const p = c.residues.filter((r) => r.kind === 'protein').length;
    const n = c.residues.filter((r) => r.kind === 'nucleic').length;
    c.polymer = p >= n ? (p ? 'protein' : '') : 'nucleic';
    c.seq = c.residues.map((r) => r.code).join('');
    c.ligands = ligands.filter((l) => l.chain === c.id).length;
  }
  return {
    format: struct.format, title: struct.title || '', id: struct.id || '', header: struct.header || '', models: struct.models.length, model: mi,
    atoms: atoms.length, kind: small ? 'small' : 'macro', chains, ligands, waters, elements, formula: formula(elements),
    bRange: atoms.length ? [round(bMin, 2), round(bMax, 2)] : [0, 0], bClip: percentiles(bValues(atoms, polymerRes), 0.05, 0.95), hasB: atoms.some((a) => a.b !== 0), hasH: !!elements.H,
    residues: polymerRes.length, warnings: struct.warnings || [], name: model.name || '', bonds: (model.bonds || []).length,
  };
}

/** B-factors the color range is taken from: the polymer atoms (what the cartoon shows), else every atom. */
function bValues(atoms, polymerRes) {
  const v = [];
  for (const r of polymerRes) for (const i of r.idx) v.push(atoms[i].b);
  return v.length ? v : atoms.map((a) => a.b);
}

/** [low, high] percentiles of the values (the B-factor color range, so a few outliers do not wash out the colors). */
function percentiles(values, lo, hi) {
  if (!values.length) return [0, 0];
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return [0, 0];
  const at = (q) => v[Math.min(v.length - 1, Math.max(0, Math.round(q * (v.length - 1))))];
  const a = at(lo), b = at(hi);
  return a < b ? [round(a, 2), round(b, 2)] : [round(v[0], 2), round(v[v.length - 1], 2)];
}

function ssLookup(struct) {
  const h = struct.helices || [], s = struct.sheets || [];
  if (!h.length && !s.length) return () => '';
  return (chain, resi) => {
    for (const x of h) if (x.chain === chain && resi >= x.start && resi <= x.end) return 'H';
    for (const x of s) if (x.chain === chain && resi >= x.start && resi <= x.end) return 'E';
    return '';
  };
}

/** Atoms of one residue for the tree: [{ i, name, elem, serial, alt, b, occ, x, y, z }] */
function residueAtoms(atoms, key) {
  const out = [];
  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i];
    if (resKey(a) === key) out.push({ i, name: a.name, elem: a.elem, serial: a.serial, alt: a.alt, b: a.b, occ: a.occ, x: a.x, y: a.y, z: a.z, resn: a.resn });
  }
  return out;
}

/** Index of the atom of model atoms at the given coordinates (from the 3D view), or -1. */
function atomAt(atoms, p, tol = 0.02) {
  let best = -1, bd = tol * tol;
  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i];
    const dx = a.x - p.x, dy = a.y - p.y, dz = a.z - p.z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d <= bd) { bd = d; best = i; }
  }
  return best;
}

/** Short label of an atom: "A:HIS 64 NE2" or "C1" for small molecules. */
function atomLabel(a, small) {
  if (small || (!a.chain && a.resn === 'MOL')) return a.name;
  return `${a.chain ? a.chain + ':' : ''}${a.resn} ${a.resi}${a.icode || ''} ${a.name}${a.alt ? ` (${a.alt})` : ''}`;
}

const round = (v, d) => { const f = 10 ** d; return Math.round(v * f) / f; };

module.exports = { summarize, residuesOf, residueAtoms, residueKind, atomAt, atomLabel, resKey, parseKey, formula, METALS, round };
