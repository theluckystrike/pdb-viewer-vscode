'use strict';
// Geometry for the Pro tools: distances, angles and dihedrals; hydrogen bond candidates and contacts; superposition
// on matched C-alpha atoms (sequence alignment + quaternion fit) with RMSD per chain and per residue; binding site
// residues around a ligand; a PDB writer and CSV text. Pure functions, no vscode import.
const { residuesOf, atomLabel, resKey } = require('./model');
const { AMINO, NUCLEIC } = require('./parse');

const sub = (a, b) => [a.x - b.x, a.y - b.y, a.z - b.z];
const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const norm = (u) => Math.sqrt(dot(u, u));

function distance(a, b) { return norm(sub(a, b)); }
/** Angle a-b-c in degrees (b is the vertex). */
function angle(a, b, c) {
  const u = sub(a, b), v = sub(c, b);
  const cos = dot(u, v) / (norm(u) * norm(v));
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}
/** Dihedral a-b-c-d in degrees, -180..180 (IUPAC sign). */
function dihedral(a, b, c, d) {
  const b0 = sub(a, b), b1 = sub(c, b), b2 = sub(d, c);
  const n1 = norm(b1);
  const b1n = [b1[0] / n1, b1[1] / n1, b1[2] / n1];
  const v = [b0[0] - dot(b0, b1n) * b1n[0], b0[1] - dot(b0, b1n) * b1n[1], b0[2] - dot(b0, b1n) * b1n[2]];
  const w = [b2[0] - dot(b2, b1n) * b1n[0], b2[1] - dot(b2, b1n) * b1n[1], b2[2] - dot(b2, b1n) * b1n[2]];
  const x = dot(v, w);
  const y = dot(cross(b1n, v), w);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/** One measurement from 2, 3 or 4 atoms. */
function measure(atoms, idx, small) {
  const p = idx.map((i) => atoms[i]);
  const labels = p.map((a) => atomLabel(a, small));
  if (p.length === 2) return { kind: 'distance', value: distance(p[0], p[1]), unit: 'Å', atoms: idx, labels };
  if (p.length === 3) return { kind: 'angle', value: angle(p[0], p[1], p[2]), unit: '°', atoms: idx, labels };
  if (p.length === 4) return { kind: 'dihedral', value: dihedral(p[0], p[1], p[2], p[3]), unit: '°', atoms: idx, labels };
  throw new Error('A measurement takes 2, 3 or 4 atoms.');
}

// ---------------------------------------------------------------- neighbor search
function grid(atoms, cell, filter) {
  const g = new Map();
  for (let i = 0; i < atoms.length; i++) {
    if (filter && !filter(i)) continue;
    const a = atoms[i];
    const k = `${Math.floor(a.x / cell)},${Math.floor(a.y / cell)},${Math.floor(a.z / cell)}`;
    let v = g.get(k);
    if (!v) { v = []; g.set(k, v); }
    v.push(i);
  }
  return {
    near(p, r, fn) {
      const x0 = Math.floor((p.x - r) / cell), x1 = Math.floor((p.x + r) / cell);
      const y0 = Math.floor((p.y - r) / cell), y1 = Math.floor((p.y + r) / cell);
      const z0 = Math.floor((p.z - r) / cell), z1 = Math.floor((p.z + r) / cell);
      const r2 = r * r;
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
        const v = g.get(`${x},${y},${z}`);
        if (!v) continue;
        for (const j of v) { const b = atoms[j]; const dx = b.x - p.x, dy = b.y - p.y, dz = b.z - p.z; const d2 = dx * dx + dy * dy + dz * dz; if (d2 <= r2) fn(j, Math.sqrt(d2)); }
      }
    },
  };
}

const BACKBONE_N = new Set(['N']);
const BACKBONE_O = new Set(['O', 'OXT', 'OT1', 'OT2']);
const isPolar = (a) => a.elem === 'N' || a.elem === 'O';
const isWater = (a) => /^(HOH|WAT|H2O|DOD|SOL|TIP3?|SPC)$/i.test(a.resn);

/**
 * Hydrogen bond candidates: N and O atoms of different residues 2.5 to `cutoff` Å apart (geometry only, no hydrogens
 * needed). Pairs of two backbone N atoms or two backbone O atoms are left out (neither can give and take). Waters are
 * left out unless o.water. o.within: a Set of atom indices; then only pairs with at least one atom in it.
 */
function hbonds(atoms, o = {}) {
  const cutoff = o.cutoff || 3.5, min = o.min === undefined ? 2.5 : o.min;
  const ok = (i) => isPolar(atoms[i]) && (o.water || !isWater(atoms[i]));
  const g = grid(atoms, cutoff, ok);
  const out = [];
  for (let i = 0; i < atoms.length; i++) {
    if (!ok(i)) continue;
    const a = atoms[i];
    g.near(a, cutoff, (j, d) => {
      if (j <= i || d < min) return;
      const b = atoms[j];
      if (o.within && !o.within.has(i) && !o.within.has(j)) return;
      if (resKey(a) === resKey(b) && a.resn === b.resn) return;
      if (!a.het && !b.het && ((BACKBONE_N.has(a.name) && BACKBONE_N.has(b.name)) || (BACKBONE_O.has(a.name) && BACKBONE_O.has(b.name)))) return;
      out.push({ a: i, b: j, d });
    });
  }
  return out.sort((x, y) => x.a - y.a || x.b - y.b);
}

/** Atoms not in `sel` (a Set of indices) within `cutoff` Å of any atom in sel; one row per (sel atom, other atom). */
function contacts(atoms, sel, cutoff = 4, o = {}) {
  const ok = (j) => !sel.has(j) && (o.water || !isWater(atoms[j])) && (o.hydrogens || atoms[j].elem !== 'H');
  const g = grid(atoms, cutoff, ok);
  const out = [];
  for (const i of sel) {
    if (!o.hydrogens && atoms[i].elem === 'H') continue;
    g.near(atoms[i], cutoff, (j, d) => out.push({ a: i, b: j, d }));
  }
  return out.sort((x, y) => x.d - y.d);
}

// ---------------------------------------------------------------- binding site
/**
 * Residues with any heavy atom within `radius` Å of the ligand residue `key` (chain:resi[icode], plus resn when given).
 * Rows: { key, chain, resn, resi, icode, kind, min, closest: [residue atom, ligand atom], contacts, hbonds, hydrophobic }
 */
function bindingSite(atoms, lig, radius = 5, o = {}) {
  const res = residuesOf(atoms);
  const L = res.find((r) => r.key === lig.key && (!lig.resn || r.resn === lig.resn));
  if (!L) throw new Error(`No residue ${lig.resn || ''} ${lig.key} in this model.`);
  const ligSet = new Set(L.idx);
  const heavy = (i) => atoms[i].elem !== 'H';
  const resOf = new Map();
  for (const r of res) for (const i of r.idx) resOf.set(i, r);
  const g = grid(atoms, Math.max(radius, 4), (j) => !ligSet.has(j) && heavy(j));
  const rows = new Map();
  let waters = 0;
  const waterSet = new Set();
  for (const i of L.idx) {
    if (!heavy(i)) continue;
    const a = atoms[i];
    g.near(a, radius, (j, d) => {
      const r = resOf.get(j);
      if (r.kind === 'water') { if (!waterSet.has(r.key)) { waterSet.add(r.key); waters++; } if (!o.water) return; }
      let row = rows.get(r);
      if (!row) { row = { key: r.key, chain: r.chain, resn: r.resn, resi: r.resi, icode: r.icode, kind: r.kind, min: Infinity, closest: null, contacts: 0, hbonds: 0, hydrophobic: 0 }; rows.set(r, row); }
      row.contacts++;
      if (d < row.min) { row.min = d; row.closest = [atoms[j].name, a.name]; }
      const b = atoms[j];
      if (isPolar(a) && isPolar(b) && d <= 3.5 && d >= 2.4) row.hbonds++;
      if (a.elem === 'C' && b.elem === 'C' && d <= 4.0) row.hydrophobic++;
    });
  }
  const list = [...rows.values()].sort((x, y) => (x.chain < y.chain ? -1 : x.chain > y.chain ? 1 : x.resi - y.resi || (x.icode < y.icode ? -1 : 1)));
  return { ligand: { key: L.key, resn: L.resn, chain: L.chain, resi: L.resi, atoms: L.idx.length }, radius, residues: list, waters };
}

// ---------------------------------------------------------------- superposition
/** Representative atom per polymer residue: CA for amino acids, C4' (else P) for nucleotides. First alt loc only. */
function traceOf(atoms) {
  const res = residuesOf(atoms).filter((r) => r.kind === 'protein' || r.kind === 'nucleic');
  const chains = new Map();
  for (const r of res) {
    const want = r.kind === 'protein' ? ['CA'] : ["C4'", 'C4*', 'P'];
    let at = -1;
    for (const w of want) { at = r.idx.find((i) => atoms[i].name === w && (!atoms[i].alt || atoms[i].alt === 'A' || atoms[i].alt === '1')); if (at !== undefined && at >= 0) break; at = -1; }
    if (at < 0) continue;
    const code = (r.kind === 'protein' ? AMINO[r.resn.toUpperCase()] : NUCLEIC[r.resn.toUpperCase()]) || 'X';
    if (!chains.has(r.chain)) chains.set(r.chain, []);
    chains.get(r.chain).push({ i: at, code, resn: r.resn, resi: r.resi, icode: r.icode, chain: r.chain });
  }
  return chains;
}

/** Global alignment (Needleman-Wunsch, match 2, mismatch -1, gap -2). Returns pairs [i, j] of aligned positions. */
function align(a, b) {
  const n = a.length, m = b.length;
  if (n * m > 25e6) throw new Error(`These chains are too long to align here (${n} x ${m} residues).`);
  const W = m + 1;
  const S = new Int32Array((n + 1) * W);
  const T = new Uint8Array((n + 1) * W); // 1 diag, 2 up, 3 left
  for (let i = 1; i <= n; i++) { S[i * W] = -2 * i; T[i * W] = 2; }
  for (let j = 1; j <= m; j++) { S[j] = -2 * j; T[j] = 3; }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const d = S[(i - 1) * W + j - 1] + (a[i - 1] === b[j - 1] && a[i - 1] !== 'X' ? 2 : -1);
      const u = S[(i - 1) * W + j] - 2, l = S[i * W + j - 1] - 2;
      if (d >= u && d >= l) { S[i * W + j] = d; T[i * W + j] = 1; } else if (u >= l) { S[i * W + j] = u; T[i * W + j] = 2; } else { S[i * W + j] = l; T[i * W + j] = 3; }
    }
  }
  const pairs = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const t = T[i * W + j];
    if (t === 1) { pairs.push([i - 1, j - 1]); i--; j--; } else if (t === 2) i--; else j--;
  }
  return pairs.reverse();
}

/** Symmetric 4x4 eigen problem by Jacobi rotations; returns the eigenvector of the largest eigenvalue. */
function topEigen4(A) {
  const a = A.map((r) => r.slice());
  const v = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) off += a[p][q] * a[p][q];
    if (off < 1e-22) break;
    for (let p = 0; p < 4; p++) {
      for (let q = p + 1; q < 4; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < 4; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
        for (let k = 0; k < 4; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
        for (let k = 0; k < 4; k++) { const vkp = v[k][p], vkq = v[k][q]; v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq; }
      }
    }
  }
  let best = 0;
  for (let k = 1; k < 4; k++) if (a[k][k] > a[best][best]) best = k;
  return [v[0][best], v[1][best], v[2][best], v[3][best]];
}

/**
 * Best rigid fit of the `mobile` points onto `target` points (equal length, >= 3), Horn's quaternion method.
 * Returns { R (3x3, row major), t, rmsd } with target ≈ R * mobile + t.
 */
function fit(mobile, target) {
  const n = mobile.length;
  if (n < 3) throw new Error('At least 3 matched atoms are needed to superpose.');
  const cm = [0, 0, 0], ct = [0, 0, 0];
  for (let i = 0; i < n; i++) { cm[0] += mobile[i].x; cm[1] += mobile[i].y; cm[2] += mobile[i].z; ct[0] += target[i].x; ct[1] += target[i].y; ct[2] += target[i].z; }
  for (let k = 0; k < 3; k++) { cm[k] /= n; ct[k] /= n; }
  let Sxx = 0, Sxy = 0, Sxz = 0, Syx = 0, Syy = 0, Syz = 0, Szx = 0, Szy = 0, Szz = 0;
  for (let i = 0; i < n; i++) {
    const x = mobile[i].x - cm[0], y = mobile[i].y - cm[1], z = mobile[i].z - cm[2];
    const X = target[i].x - ct[0], Y = target[i].y - ct[1], Z = target[i].z - ct[2];
    Sxx += x * X; Sxy += x * Y; Sxz += x * Z; Syx += y * X; Syy += y * Y; Syz += y * Z; Szx += z * X; Szy += z * Y; Szz += z * Z;
  }
  const N = [
    [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
    [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
    [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz],
  ];
  const [q0, q1, q2, q3] = topEigen4(N);
  const R = [
    [q0 * q0 + q1 * q1 - q2 * q2 - q3 * q3, 2 * (q1 * q2 - q0 * q3), 2 * (q1 * q3 + q0 * q2)],
    [2 * (q1 * q2 + q0 * q3), q0 * q0 - q1 * q1 + q2 * q2 - q3 * q3, 2 * (q2 * q3 - q0 * q1)],
    [2 * (q1 * q3 - q0 * q2), 2 * (q2 * q3 + q0 * q1), q0 * q0 - q1 * q1 - q2 * q2 + q3 * q3],
  ];
  const t = [ct[0] - (R[0][0] * cm[0] + R[0][1] * cm[1] + R[0][2] * cm[2]), ct[1] - (R[1][0] * cm[0] + R[1][1] * cm[1] + R[1][2] * cm[2]), ct[2] - (R[2][0] * cm[0] + R[2][1] * cm[1] + R[2][2] * cm[2])];
  let ss = 0;
  for (let i = 0; i < n; i++) { const p = apply({ R, t }, mobile[i]); const dx = p.x - target[i].x, dy = p.y - target[i].y, dz = p.z - target[i].z; ss += dx * dx + dy * dy + dz * dz; }
  return { R, t, rmsd: Math.sqrt(ss / n) };
}
function apply({ R, t }, p) {
  return { x: R[0][0] * p.x + R[0][1] * p.y + R[0][2] * p.z + t[0], y: R[1][0] * p.x + R[1][1] * p.y + R[1][2] * p.z + t[1], z: R[2][0] * p.x + R[2][1] * p.y + R[2][2] * p.z + t[2] };
}

/**
 * Superposes structure B (atoms) onto structure A (atoms) on matched trace atoms. Chains are paired by the best
 * sequence identity (each chain of B used once). o.chainA / o.chainB limit the fit to one chain each.
 * Returns { rmsd, n, R, t, perChain: [...], perResidue: [...], identity }
 */
function superpose(atomsA, atomsB, o = {}) {
  const ta = traceOf(atomsA), tb = traceOf(atomsB);
  let chainsA = [...ta.keys()], chainsB = [...tb.keys()];
  if (o.chainA !== undefined && o.chainA !== null) chainsA = chainsA.filter((c) => c === o.chainA);
  if (o.chainB !== undefined && o.chainB !== null) chainsB = chainsB.filter((c) => c === o.chainB);
  if (!chainsA.length || !chainsB.length) throw new Error('Both structures need a protein or nucleic acid chain with C-alpha (or C4\') atoms.');
  const seq = (list) => list.map((r) => r.code).join('');
  // score every chain pair, then pair greedily by identity
  const cand = [];
  for (const ca of chainsA) for (const cb of chainsB) {
    const A = ta.get(ca), B = tb.get(cb);
    const pairs = align(seq(A), seq(B));
    const same = pairs.filter(([i, j]) => A[i].code === B[j].code).length;
    cand.push({ ca, cb, pairs, same, identity: same / Math.max(1, Math.min(A.length, B.length)) });
  }
  cand.sort((x, y) => y.same - x.same || (x.ca === x.cb ? -1 : 0) - (y.ca === y.cb ? -1 : 0));
  const usedA = new Set(), usedB = new Set(), chosen = [];
  for (const c of cand) {
    if (usedA.has(c.ca) || usedB.has(c.cb) || c.same < 3) continue;
    usedA.add(c.ca); usedB.add(c.cb); chosen.push(c);
  }
  if (!chosen.length) throw new Error('No chain pair has 3 or more matching residues to superpose on.');
  const matched = [];
  for (const c of chosen) {
    const A = ta.get(c.ca), B = tb.get(c.cb);
    for (const [i, j] of c.pairs) if (A[i].code === B[j].code || o.anyResidue) matched.push({ a: A[i], b: B[j], chainPair: c });
  }
  if (matched.length < 3) throw new Error('Fewer than 3 matched residues: nothing to superpose on.');
  const tr = fit(matched.map((m) => atomsB[m.b.i]), matched.map((m) => atomsA[m.a.i]));
  const perResidue = matched.map((m) => {
    const p = apply(tr, atomsB[m.b.i]);
    const q = atomsA[m.a.i];
    return { chainA: m.a.chain, resnA: m.a.resn, resiA: m.a.resi, icodeA: m.a.icode, chainB: m.b.chain, resnB: m.b.resn, resiB: m.b.resi, icodeB: m.b.icode, dev: Math.sqrt((p.x - q.x) ** 2 + (p.y - q.y) ** 2 + (p.z - q.z) ** 2) };
  });
  const perChain = chosen.map((c) => {
    const rows = perResidue.filter((r) => r.chainA === c.ca && r.chainB === c.cb);
    return { chainA: c.ca, chainB: c.cb, n: rows.length, rmsd: Math.sqrt(rows.reduce((s, r) => s + r.dev * r.dev, 0) / Math.max(1, rows.length)), identity: c.identity, lengthA: ta.get(c.ca).length, lengthB: tb.get(c.cb).length };
  });
  return { rmsd: tr.rmsd, n: matched.length, R: tr.R, t: tr.t, perChain, perResidue };
}

/** Applies a fit to every atom (new objects). */
function transformAtoms(atoms, tr) { return atoms.map((a) => ({ ...a, ...apply(tr, a) })); }

// ---------------------------------------------------------------- writers
const pad = (s, n) => String(s).padStart(n).slice(-n);
const padR = (s, n) => String(s).padEnd(n).slice(0, n);
/** PDB text for atoms (one model). Atom names are placed by the PDB convention (1-letter elements from column 14). */
function toPdb(atoms, { title = '', remarks = [] } = {}) {
  const out = [];
  if (title) out.push(`TITLE     ${title.slice(0, 70)}`);
  for (const r of remarks) out.push(`REMARK   1 ${String(r).slice(0, 68)}`);
  let n = 0;
  for (const a of atoms) {
    n++;
    const name = a.name.length < 4 && (a.elem || '').length < 2 ? ` ${a.name}` : a.name;
    out.push(`${padR(a.het ? 'HETATM' : 'ATOM', 6)}${pad(Math.min(99999, a.serial || n), 5)} ${padR(name, 4)}${padR(a.alt || '', 1)}${pad(String(a.resn).slice(0, 3), 3)} ${padR(a.chain || '', 1)}${pad(a.resi, 4)}${padR(a.icode || '', 1)}   ${pad(a.x.toFixed(3), 8)}${pad(a.y.toFixed(3), 8)}${pad(a.z.toFixed(3), 8)}${pad((a.occ ?? 1).toFixed(2), 6)}${pad((a.b ?? 0).toFixed(2), 6)}          ${pad((a.elem || '').toUpperCase(), 2)}  `);
  }
  out.push('END');
  return out.join('\n') + '\n';
}

function csvCell(v) {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n\r]/.test(s) || /^[=+\-@\t]/.test(s) && !/^-?\d/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csv(rows) { return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n'; }

module.exports = { distance, angle, dihedral, measure, hbonds, contacts, bindingSite, traceOf, align, fit, apply, superpose, transformAtoms, toPdb, csv, csvCell, topEigen4, grid };
