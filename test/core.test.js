'use strict';
// Core tests: file readers for every format, byte detection (debug symbol .pdb, gzip, binary), the tree summary and
// the geometry behind the Pro tools (measure, H-bond candidates, contacts, binding site, superposition), writers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const P = require('../src/core/parse');
const M = require('../src/core/model');
const G = require('../src/core/geom');
const { decode, symbolKind } = require('../src/core/detect');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures');
const read = (f) => fs.readFileSync(f, 'utf8');
const fix = (f) => read(path.join(FIX, f));
const near = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;
const HSG = P.parseStructure(read(path.join(ROOT, 'samples', '1hsg.pdb')), 'pdb');
const CRN = P.parseStructure(read(path.join(ROOT, 'samples', '1crn.cif')), 'cif');

// ---------- readers ----------
test('PDB: the 1HSG sample has 1,686 atoms, chains A and B of 99 residues, the MK1 inhibitor and 127 waters', () => {
  assert.equal(HSG.format, 'pdb');
  assert.equal(HSG.models.length, 1);
  assert.equal(HSG.models[0].atoms.length, 1686);
  assert.equal(HSG.id, '1HSG');
  const s = M.summarize(HSG);
  assert.deepEqual(s.chains.map((c) => [c.id, c.residues.length, c.polymer]), [['A', 99, 'protein'], ['B', 99, 'protein']]);
  assert.equal(s.chains[0].seq, 'PQITLWQRPLVTIKIGGQLKEALLDTGADDTVLEEMSLPGRWKPKMIGGIGGFIKVRQYDQILIEICGHKAIGTVLVGPTPVNIIGRNLLTQIGCTLNF');
  assert.deepEqual(s.ligands.map((l) => [l.resn, l.key, l.atoms, l.kind]), [['MK1', 'B:902', 45, 'ligand']]);
  assert.equal(s.waters, 127);
  assert.equal(s.kind, 'macro');
  assert.ok(s.hasB && s.bRange[0] < s.bRange[1]);
  assert.ok(HSG.helices.length >= 1 && HSG.sheets.length >= 1);
});

test('PDB: columns, elements from columns 77-78 or from the name, one-letter ions, alt locs, HELIX ranges', () => {
  const t = P.parseStructure(fix('tiny.pdb'), 'pdb');
  const a = t.models[0].atoms;
  assert.equal(a.length, 19);
  assert.deepEqual([a[0].serial, a[0].name, a[0].resn, a[0].chain, a[0].resi, a[0].x, a[0].y, a[0].z, a[0].b, a[0].elem], [1, 'N', 'ALA', 'A', 1, 11.104, 6.134, -6.504, 10, 'N']);
  assert.equal(a[14].elem, 'Zn');
  assert.equal(a[14].het, true);
  assert.deepEqual(t.helices, [{ chain: 'A', start: 1, end: 2 }]);
  // no element columns: CA is carbon, ZN residue ZN is zinc, FE in column 13 of a HETATM is iron
  assert.equal(P.elemFromPdbName(' CA ', 'ALA', false), 'C');
  assert.equal(P.elemFromPdbName('ZN  ', 'ZN', true), 'Zn');
  assert.equal(P.elemFromPdbName('FE  ', 'HEM', true), 'Fe');
  assert.equal(P.elemFromPdbName('1HB ', 'ALA', false), 'H');
  const alt = P.parsePdb('ATOM      1  CA AALA A   1       1.000   2.000   3.000  0.50 10.00           C\nATOM      2  CA BALA A   1       1.500   2.000   3.000  0.50 10.00           C\n');
  assert.deepEqual(alt.models[0].atoms.map((x) => [x.alt, x.occ]), [['A', 0.5], ['B', 0.5]]);
});

test('PDB: MODEL/ENDMDL gives one model each; a line too short to read is counted, not fatal', () => {
  const t = P.parseStructure(fix('models.pdb'), 'pdb');
  assert.equal(t.models.length, 2);
  assert.ok(near(t.models[1].atoms[0].x - t.models[0].atoms[0].x, 1));
  const bad = P.parsePdb('ATOM      1  N   ALA A   1      11.104   6.134\nATOM      2  CA  ALA A   1      11.639   6.071  -5.147  1.00 11.00           C\n');
  assert.equal(bad.models[0].atoms.length, 1);
  assert.match(bad.warnings[0], /1 ATOM\/HETATM line could not be read/);
});

test('mmCIF: the 1CRN sample (crambin, 46 residues, 327 atoms) with auth chain and numbers, title and helices', () => {
  assert.equal(CRN.format, 'cif');
  assert.equal(CRN.id, '1CRN');
  assert.equal(CRN.models[0].atoms.length, 327);
  const s = M.summarize(CRN);
  assert.equal(s.chains.length, 1);
  assert.equal(s.chains[0].seq, 'TTCCPSIVARSNFNVCRLPGTPEAICATYTGCIIIPGATCPGDYAN');
  assert.match(CRN.title, /WATER STRUCTURE OF A HYDROPHOBIC PROTEIN/);
  assert.equal(CRN.helices.length, 2);
});

test('mmCIF: quoted values, a multi-line text field, auth fields over label fields, models by pdbx_PDB_model_num', () => {
  const t = P.parseStructure(fix('tiny.cif'), 'cif');
  assert.equal(t.title, "Tiny test entry with a 'quoted' word over two lines");
  assert.equal(t.models.length, 2);
  const a = t.models[0].atoms;
  assert.equal(a.length, 4);
  assert.deepEqual([a[2].name, a[2].chain, a[2].resi, a[2].elem, a[2].b], ["C5'", 'B', 10, 'C', 7]);
  assert.equal(a[3].het, true);
  assert.equal(t.models[1].atoms[0].x, 1.5);
  const { blocks } = P.readCif("data_x\n_a.b 'it''s' \n_c.d \"q 'x' y\"\n");
  assert.equal(blocks[0].items.get('_c_d'), "q 'x' y");
});

test('CIF (small molecule): fractional coordinates through the unit cell, U(iso) to B', () => {
  const t = P.parseStructure(fix('salt.cif'), '');
  assert.equal(t.format, 'cif-small');
  const [na, cl] = t.models[0].atoms;
  assert.deepEqual([na.elem, na.x, na.y, na.z], ['Na', 0, 0, 0]);
  assert.ok(near(cl.x, 5) && near(cl.y, 5) && near(cl.z, 5));
  assert.ok(near(na.b, 8 * Math.PI * Math.PI * 0.01));
  const tri = P.fracToCart({ a: 5, b: 6, c: 7, al: 80, be: 95, ga: 110 });
  const [x, y, z] = tri([0, 0, 1]);
  assert.ok(near(Math.sqrt(x * x + y * y + z * z), 7));
});

test('SDF: V2000 and V3000 records in one file become two models with bonds and charges', () => {
  const t = P.parseStructure(fix('two.sdf'), 'sdf');
  assert.equal(t.models.length, 2);
  assert.deepEqual(t.models[0].atoms.map((a) => a.elem), ['O', 'H', 'H']);
  assert.deepEqual(t.models[0].bonds, [[0, 1, 1], [0, 2, 1]]);
  assert.deepEqual(t.models[1].atoms.map((a) => a.elem), ['N', 'H', 'H', 'H', 'H']);
  assert.equal(t.models[1].atoms[0].charge, 1);
  assert.equal(t.models[1].bonds.length, 4);
  assert.equal(t.title, 'water');
  const s = M.summarize(t);
  assert.equal(s.kind, 'small');
  assert.equal(s.formula, 'H2O');
});

test('MOL2, XYZ (frames, atomic numbers), GRO (nm to angstrom) and PQR (charges and radii)', () => {
  const m = P.parseStructure(fix('ethanol.mol2'), 'mol2');
  assert.deepEqual(m.models[0].atoms.map((a) => [a.name, a.elem, a.resn, a.resi]), [['C1', 'C', 'ETH', 1], ['C2', 'C', 'ETH', 1], ['O1', 'O', 'ETH', 1]]);
  assert.equal(m.models[0].bonds.length, 2);
  assert.equal(M.summarize(m).formula, 'C2O');
  const x = P.parseStructure(fix('frames.xyz'), 'xyz');
  assert.equal(x.models.length, 2);
  assert.equal(x.models[1].atoms[2].elem, 'O'); // "8" = oxygen
  assert.equal(x.models[1].name, 'frame two');
  const g = P.parseStructure(fix('water.gro'), 'gro');
  assert.equal(g.models[0].atoms.length, 6);
  assert.ok(near(g.models[0].atoms[0].x, 1.26) && near(g.models[0].atoms[0].z, 16.79));
  assert.deepEqual(g.models[0].atoms.map((a) => a.elem).join(''), 'OHHOHH');
  assert.equal(M.summarize(g).waters, 2);
  const q = P.parseStructure(fix('tiny.pqr'), 'pqr');
  assert.deepEqual(q.models[0].atoms.map((a) => [a.name, a.chain, a.charge, a.radius]), [['N', 'A', -0.3, 1.824], ['CA', 'A', 0.0337, 1.908], ['C', '', 0.5973, 1.908]]);
  const broken = P.parseStructure(fix('broken.xyz'), 'xyz');
  assert.match(broken.warnings[0], /has 2 of 5 atoms/);
});

test('format by name (case and .gz ignored) and by content when the name does not say', () => {
  assert.equal(P.formatByName('1CRN.PDB'), 'pdb');
  assert.equal(P.formatByName('x.cif.gz'), 'cif');
  assert.equal(P.formatByName('a.mol'), 'sdf');
  assert.equal(P.formatByName('a.ent'), 'pdb');
  assert.equal(P.formatByName('a.txt'), '');
  assert.equal(P.sniffFormat(fix('tiny.cif')), 'cif');
  assert.equal(P.sniffFormat(fix('tiny.pdb')), 'pdb');
  assert.equal(P.sniffFormat(fix('ethanol.mol2')), 'mol2');
  assert.equal(P.sniffFormat(fix('frames.xyz')), 'xyz');
  assert.equal(P.sniffFormat(fix('water.gro')), 'gro');
  assert.equal(P.sniffFormat('hello world'), '');
});

// ---------- bytes ----------
test('detect: debug symbol .pdb files (MSF 7.00, MSF 2.00, portable BSJB) are named, never parsed', () => {
  assert.deepEqual(decode(fs.readFileSync(path.join(FIX, 'symbols.pdb'))), { kind: 'symbols', which: 'msf7' });
  assert.deepEqual(decode(fs.readFileSync(path.join(FIX, 'portable.pdb'))), { kind: 'symbols', which: 'portable' });
  assert.equal(symbolKind(Buffer.from('Microsoft C/C++ program database 2.00\r\n\x1aJG\0\0', 'latin1')), 'msf2');
  assert.equal(symbolKind(Buffer.from('HEADER    PROTEIN')), '');
});
test('detect: gzip is unpacked, binary and empty files are named, a BOM is dropped', () => {
  const g = decode(fs.readFileSync(path.join(FIX, 'tiny.pdb.gz')));
  assert.equal(g.kind, 'text');
  assert.equal(g.gz, true);
  assert.match(g.text, /^HEADER/);
  assert.deepEqual(decode(fs.readFileSync(path.join(FIX, 'database.sdf'))), { kind: 'binary', what: 'binary' });
  assert.deepEqual(decode(Buffer.alloc(0)), { kind: 'empty' });
  assert.deepEqual(decode(Buffer.from([0x1f, 0x8b, 1, 2, 3])), { kind: 'binary', what: 'broken-gzip' });
  assert.equal(decode(Buffer.from('﻿ATOM')).text, 'ATOM');
  assert.equal(decode(zlib.gzipSync(fs.readFileSync(path.join(FIX, 'symbols.pdb')))).kind, 'symbols');
});

// ---------- summary ----------
test('summary: a HETATM UNK group with no C-alpha is a ligand, not a protein residue; a water box has only waters', () => {
  const het = ['HETATM    1  N   UNK     0     -16.879  -6.663   4.283 -0.2184 1.550', 'HETATM    2  C   UNK     0     -15.879  -6.663   4.283  0.1000 1.700', 'HETATM    3  O   UNK     0     -14.879  -6.663   4.283 -0.3000 1.520'].join('\n');
  const s = M.summarize(P.parseStructure(het, 'pqr'));
  assert.equal(s.residues, 0);
  assert.equal(s.chains.length, 0);
  assert.deepEqual(s.ligands.map((l) => [l.resn, l.atoms, l.kind]), [['UNK', 3, 'ligand']]);
  // a real UNK amino acid with a backbone stays a protein residue
  const unk = ['ATOM      1  N   UNK A   1      11.104   6.134  -6.504  1.00 10.00           N', 'ATOM      2  CA  UNK A   1      11.639   6.071  -5.147  1.00 10.00           C'].join('\n');
  assert.equal(M.summarize(P.parseStructure(unk, 'pdb')).residues, 1);
  const box = M.summarize(P.parseStructure(fix('water.gro'), 'gro'));
  assert.ok(box.waters > 0 && box.residues === 0 && box.ligands.length === 0);
});

test('summary: the B-factor color range is the 5-95 % range of the polymer atoms, not of waters and ligands', () => {
  const s = M.summarize(HSG);
  const poly = [];
  for (const a of HSG.models[0].atoms) if (!a.het) poly.push(a.b);
  poly.sort((x, y) => x - y);
  const at = (q) => poly[Math.round(q * (poly.length - 1))];
  assert.deepEqual(s.bClip, [Math.round(at(0.05) * 100) / 100, Math.round(at(0.95) * 100) / 100]);
  assert.ok(s.bClip[1] < s.bRange[1]);
});

test('summary: chains, residues with one-letter codes and secondary structure, ligands, ions and waters; residue atoms', () => {
  const t = P.parseStructure(fix('tiny.pdb'), 'pdb');
  const s = M.summarize(t);
  assert.equal(s.chains[0].seq, 'AGS');
  assert.deepEqual(s.chains[0].residues.map((r) => r.ss), ['H', 'H', '']);
  assert.deepEqual(s.ligands.map((l) => [l.resn, l.kind]), [['ZN', 'ion'], ['LIG', 'ligand']]);
  assert.equal(s.waters, 1);
  assert.equal(s.atoms, 19);
  const atoms = M.residueAtoms(t.models[0].atoms, 'A:3');
  assert.deepEqual(atoms.map((a) => a.name), ['N', 'CA', 'C', 'O', 'OG']);
  assert.equal(M.atomAt(t.models[0].atoms, { x: 16.9, y: 3.2, z: -0.3 }), 13);
  assert.equal(M.atomAt(t.models[0].atoms, { x: 0, y: 0, z: 0 }), -1);
  assert.equal(M.atomLabel(t.models[0].atoms[13]), 'A:SER 3 OG');
  assert.deepEqual(M.parseKey('A:42B'), { chain: 'A', resi: 42, icode: 'B' });
  assert.deepEqual(M.parseKey(':1'), { chain: '', resi: 1, icode: '' });
});

// ---------- geometry ----------
test('measure: distance, angle and dihedral against values worked out by hand', () => {
  const p = (x, y, z) => ({ x, y, z });
  assert.ok(near(G.distance(p(0, 0, 0), p(3, 4, 0)), 5));
  assert.ok(near(G.angle(p(1, 0, 0), p(0, 0, 0), p(0, 1, 0)), 90));
  assert.ok(near(G.angle(p(1, 0, 0), p(0, 0, 0), p(-1, 0, 0)), 180));
  assert.ok(near(G.dihedral(p(1, 0, 0), p(0, 0, 0), p(0, 0, 1), p(0, 1, 1)), 90));
  assert.ok(near(G.dihedral(p(1, 0, 0), p(0, 0, 0), p(0, 0, 1), p(0, -1, 1)), -90));
  assert.ok(near(G.dihedral(p(1, 0, 0), p(0, 0, 0), p(0, 0, 1), p(1, 0, 1)), 0));
  // 1CRN: CA-CA of residues 1 and 2 (trans peptide, about 3.8 A) and phi of residue 2 from the file coordinates
  const a = CRN.models[0].atoms;
  const at = (n, r) => a.findIndex((x) => x.name === n && x.resi === r);
  const d = G.measure(a, [at('CA', 1), at('CA', 2)]);
  assert.equal(d.kind, 'distance');
  assert.ok(near(d.value, 3.794, 0.002));
  assert.deepEqual(d.labels, ['A:THR 1 CA', 'A:THR 2 CA']);
  const phi = G.measure(a, [at('C', 1), at('N', 2), at('CA', 2), at('C', 2)]);
  assert.equal(phi.kind, 'dihedral');
  assert.ok(near(phi.value, -107.83, 0.01));
  assert.throws(() => G.measure(a, [1]), /2, 3 or 4 atoms/);
});

test('H-bond candidates: N/O pairs 2.5-3.5 A between residues, no backbone N-N or O-O, waters only on request', () => {
  const t = P.parseStructure(fix('tiny.pdb'), 'pdb');
  const a = t.models[0].atoms;
  const hb = G.hbonds(a);
  for (const h of hb) {
    assert.ok(h.d >= 2.5 && h.d <= 3.5);
    assert.ok(['N', 'O'].includes(a[h.a].elem) && ['N', 'O'].includes(a[h.b].elem));
    assert.notEqual(M.resKey(a[h.a]), M.resKey(a[h.b]));
  }
  // brute force reference
  const want = [];
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) {
    const x = a[i], y = a[j];
    if (!['N', 'O'].includes(x.elem) || !['N', 'O'].includes(y.elem) || x.resn === 'HOH' || y.resn === 'HOH' || M.resKey(x) === M.resKey(y)) continue;
    if (!x.het && !y.het && ((x.name === 'N' && y.name === 'N') || (x.name === 'O' && y.name === 'O'))) continue;
    const d = G.distance(x, y);
    if (d >= 2.5 && d <= 3.5) want.push([i, j]);
  }
  assert.deepEqual(hb.map((h) => [h.a, h.b]), want);
  assert.ok(G.hbonds(a, { water: true }).length >= hb.length);
  const crn = G.hbonds(CRN.models[0].atoms);
  assert.ok(crn.length > 40 && crn.length < 120, String(crn.length));
});

test('contacts: atoms of other residues within the cutoff of a residue, closest first', () => {
  const t = P.parseStructure(fix('tiny.pdb'), 'pdb');
  const a = t.models[0].atoms;
  const lig = new Set(a.map((x, i) => (x.resn === 'LIG' ? i : -1)).filter((i) => i >= 0));
  const c = G.contacts(a, lig, 4);
  assert.ok(c.length > 0);
  for (let k = 1; k < c.length; k++) assert.ok(c[k].d >= c[k - 1].d);
  assert.ok(c.every((x) => lig.has(x.a) && !lig.has(x.b) && x.d <= 4));
});

test('binding site: MK1 in 1HSG within 4 A is 26 residues in both chains with Asp25 closest, same as a brute-force count', () => {
  const a = HSG.models[0].atoms;
  const r = G.bindingSite(a, { key: 'B:902', resn: 'MK1' }, 4);
  assert.equal(r.residues.length, 26);
  assert.equal(r.ligand.atoms, 45);
  const asp = r.residues.filter((x) => x.resn === 'ASP' && x.resi === 25);
  assert.deepEqual(asp.map((x) => x.chain), ['A', 'B']);
  assert.ok(asp.every((x) => x.hbonds > 0));
  const ligAtoms = a.filter((x) => x.resn === 'MK1');
  const set = new Set();
  for (const y of a) {
    if (y.resn === 'MK1' || y.resn === 'HOH' || y.elem === 'H') continue;
    if (ligAtoms.some((x) => G.distance(x, y) <= 4)) set.add(`${y.chain}:${y.resi}`);
  }
  assert.deepEqual(r.residues.map((x) => x.key).sort(), [...set].sort());
  assert.ok(r.waters > 0);
  assert.throws(() => G.bindingSite(a, { key: 'Z:1' }, 4), /No residue/);
});

test('superpose: a rotated and moved copy fits back to RMSD 0; chains paired by sequence; per-residue rows', () => {
  const a = HSG.models[0].atoms;
  const th = 0.9;
  const R = [[Math.cos(th), 0, Math.sin(th)], [0, 1, 0], [-Math.sin(th), 0, Math.cos(th)]];
  const b = G.transformAtoms(a, { R, t: [5, -3, 12] }).map((x) => ({ ...x, chain: x.chain === 'A' ? 'X' : 'Y' }));
  const r = G.superpose(a, b);
  assert.equal(r.n, 198);
  assert.ok(r.rmsd < 1e-6, String(r.rmsd));
  assert.deepEqual(r.perChain.map((c) => [c.chainA, c.n]).sort(), [['A', 99], ['B', 99]]);
  assert.equal(r.perResidue.length, 198);
  assert.ok(r.perResidue.every((x) => x.dev < 1e-5));
  // the moved copy lands on the reference
  const back = G.transformAtoms(b, r);
  assert.ok(near(back[0].x, a[0].x) && near(back[100].z, a[100].z));
  // one chain each
  const one = G.superpose(a, b, { chainA: 'A', chainB: 'Y' });
  assert.equal(one.n, 99);
  assert.ok(one.rmsd > 0.05 && one.rmsd < 2, String(one.rmsd)); // the two protease chains: same sequence, slightly different shape
  assert.throws(() => G.superpose(a, P.parseStructure(fix('two.sdf'), 'sdf').models[0].atoms), /C-alpha/);
});

test('superpose: a noisy copy gives the RMSD of the noise; alignment skips an insertion', () => {
  const pts = [];
  for (let i = 0; i < 40; i++) pts.push({ x: Math.cos(i) * 10, y: Math.sin(i) * 10, z: i * 1.5 });
  const noise = pts.map((p, i) => ({ x: p.x + (i % 2 ? 0.5 : -0.5), y: p.y, z: p.z }));
  const f = G.fit(noise, pts);
  assert.ok(f.rmsd <= 0.5 + 1e-9 && f.rmsd > 0.4, String(f.rmsd));
  assert.deepEqual(G.align('ACDEFG', 'ACDXXEFG').filter(([i, j]) => 'ACDEFG'[i] === 'ACDXXEFG'[j]).length, 6);
  assert.throws(() => G.fit(pts.slice(0, 2), pts.slice(0, 2)), /At least 3/);
});

test('PDB writer: columns read back by the PDB reader; CSV quotes commas, quotes and formula-like cells', () => {
  const t = P.parseStructure(fix('tiny.pdb'), 'pdb');
  const text = G.toPdb(t.models[0].atoms, { title: 'round trip', remarks: ['moved'] });
  const back = P.parsePdb(text);
  assert.equal(back.models[0].atoms.length, 19);
  for (let i = 0; i < 19; i++) {
    const x = t.models[0].atoms[i], y = back.models[0].atoms[i];
    assert.deepEqual([y.name, y.resn, y.chain, y.resi, y.elem, y.het], [x.name, x.resn, x.chain, x.resi, x.elem, x.het]);
    assert.ok(near(y.x, x.x) && near(y.y, x.y) && near(y.z, x.z));
  }
  assert.equal(back.title, 'round trip');
  assert.equal(G.csv([['a,b', 'say "hi"', '=SUM(A1)', '-1.5']]), '"a,b","say ""hi""","=SUM(A1)",-1.5\n');
});
