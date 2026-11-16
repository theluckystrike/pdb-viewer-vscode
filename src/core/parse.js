'use strict';
// Structure file readers written for this listing: PDB/ENT, PQR, mmCIF and small-molecule CIF, SDF/MOL (V2000 and
// V3000), MOL2, XYZ (one or more frames) and GRO. They feed the side tree, the sequence strip and the Pro tools; the 3D
// view reads the same text with its own reader. Pure functions, no vscode import, no file access.
//
// Result: { format, title, models: [{ atoms: [Atom], bonds?: [[i, j, order]] }], helices: [], sheets: [], warnings: [] }
// Atom: { serial, name, alt, resn, chain, resi, icode, x, y, z, occ, b, elem, het, charge }

const ELEMENTS = ['H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne', 'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar', 'K', 'Ca', 'Sc', 'Ti', 'V', 'Cr',
  'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr', 'Rb', 'Sr', 'Y', 'Zr', 'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In',
  'Sn', 'Sb', 'Te', 'I', 'Xe', 'Cs', 'Ba', 'La', 'Ce', 'Pr', 'Nd', 'Pm', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu', 'Hf', 'Ta', 'W',
  'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg', 'Tl', 'Pb', 'Bi', 'Po', 'At', 'Rn', 'Fr', 'Ra', 'Ac', 'Th', 'Pa', 'U', 'Np', 'Pu', 'Am', 'Cm', 'Bk', 'Cf', 'Es',
  'Fm', 'Md', 'No', 'Lr'];
const ELEMENT_SET = new Map(ELEMENTS.map((e) => [e.toUpperCase(), e]));
/** "FE" -> "Fe", "c" -> "C"; unknown -> ''. */
function normElem(s) {
  const t = String(s || '').replace(/[^A-Za-z]/g, '').toUpperCase();
  if (!t) return '';
  if (t === 'D') return 'H'; // deuterium
  return ELEMENT_SET.get(t) || ELEMENT_SET.get(t[0]) || '';
}
/** Element from an atom number (XYZ files sometimes give 6 for carbon). */
function elemFromNumber(n) { const i = Number(n); return Number.isInteger(i) && i >= 1 && i <= ELEMENTS.length ? ELEMENTS[i - 1] : ''; }

const TWO_LETTER_IONS = new Set(['FE', 'ZN', 'MG', 'MN', 'CU', 'CO', 'NI', 'CL', 'BR', 'NA', 'CA', 'CD', 'HG', 'SE', 'LI', 'AL', 'AU', 'AG', 'PT', 'SR', 'BA', 'CS', 'RB', 'GA', 'IR', 'OS', 'RU', 'PB', 'YB', 'SM', 'GD', 'EU', 'TB', 'LA', 'CE', 'TL', 'IN']);
/** PDB atom name (4 columns, as in the file) to an element when columns 77-78 are empty. */
function elemFromPdbName(name4, resn, het) {
  const raw = name4.replace(/\s+$/, '');
  const t = raw.trim().toUpperCase();
  if (!t) return '';
  const r = String(resn || '').trim().toUpperCase();
  // an ion residue named like its element (ZN, MG, CL, NA, CA...): the atom is that element
  if (het && r === t && TWO_LETTER_IONS.has(t)) return normElem(t);
  // name starting in column 13 = two-letter element (FE, ZN), column 14 = one letter (C, N, O, CA = C-alpha)
  if (raw.length >= 2 && raw[0] !== ' ' && /[A-Z]/i.test(raw[0]) && /[A-Z]/i.test(raw[1]) && !/^[0-9]/.test(raw) && het && TWO_LETTER_IONS.has(t.slice(0, 2))) return normElem(t.slice(0, 2));
  const letters = t.replace(/^[0-9]+/, '').replace(/[^A-Z]/g, '');
  return normElem(letters[0] || '');
}

const num = (s) => { const v = parseFloat(s); return Number.isFinite(v) ? v : NaN; };
const lines = (text) => String(text).split(/\r\n|\r|\n/);

// ---------------------------------------------------------------- PDB / ENT / PQR (fixed columns)
function parsePdb(text, { pqr = false } = {}) {
  const out = { format: pqr ? 'pqr' : 'pdb', title: '', id: '', models: [], helices: [], sheets: [], warnings: [], seqres: {} };
  let atoms = [];
  let titleParts = [];
  let modelOpen = false;
  let bad = 0;
  const finishModel = () => { if (atoms.length) out.models.push({ atoms }); atoms = []; };
  for (const line of lines(text)) {
    const rec = line.slice(0, 6).trim().toUpperCase();
    if (rec === 'ATOM' || rec === 'HETATM') {
      const a = pqr ? pqrAtom(line, rec) : pdbAtom(line, rec);
      if (a) atoms.push(a); else bad++;
    } else if (rec === 'MODEL') {
      if (atoms.length) finishModel();
      modelOpen = true;
    } else if (rec === 'ENDMDL') {
      finishModel(); modelOpen = false;
    } else if (rec === 'HEADER') {
      out.id = line.slice(62, 66).trim();
      if (!titleParts.length) out.header = line.slice(10, 50).trim();
    } else if (rec === 'TITLE') {
      titleParts.push(line.slice(10).trim());
    } else if (rec === 'COMPND' && !titleParts.length && pqr) {
      out.header = line.slice(10).trim();
    } else if (rec === 'HELIX') {
      out.helices.push({ chain: line[19] === undefined ? '' : line[19].trim(), start: parseInt(line.slice(21, 25), 10), end: parseInt(line.slice(33, 37), 10) });
    } else if (rec === 'SHEET') {
      out.sheets.push({ chain: line[21] === undefined ? '' : line[21].trim(), start: parseInt(line.slice(22, 26), 10), end: parseInt(line.slice(33, 37), 10) });
    } else if (rec === 'SEQRES') {
      const ch = (line[11] || '').trim();
      (out.seqres[ch] = out.seqres[ch] || []).push(...line.slice(19).trim().split(/\s+/).filter(Boolean));
    }
  }
  if (atoms.length || modelOpen) finishModel();
  out.title = titleParts.join(' ').replace(/\s+/g, ' ').trim();
  if (bad) out.warnings.push(`${bad} ATOM/HETATM line${bad === 1 ? '' : 's'} could not be read and ${bad === 1 ? 'was' : 'were'} skipped.`);
  return out;
}

function pdbAtom(line, rec) {
  if (line.length < 54) return null;
  const x = num(line.slice(30, 38)), y = num(line.slice(38, 46)), z = num(line.slice(46, 54));
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  const name4 = line.slice(12, 16);
  const resn = line.slice(17, 20).trim();
  const het = rec === 'HETATM';
  let elem = normElem(line.slice(76, 78));
  if (!elem) elem = elemFromPdbName(name4, resn, het);
  const occ = num(line.slice(54, 60));
  const b = num(line.slice(60, 66));
  const ch = line.slice(78, 80).trim();
  return {
    serial: parseInt(line.slice(6, 11), 10) || 0, name: name4.trim(), alt: (line[16] || ' ').trim(), resn, chain: (line[21] || ' ').trim(),
    resi: parseInt(line.slice(22, 26), 10) || 0, icode: (line[26] || ' ').trim(), x, y, z,
    occ: Number.isFinite(occ) ? occ : 1, b: Number.isFinite(b) ? b : 0, elem, het,
    charge: /^\d[+-]$/.test(ch) ? Number(ch[1] + ch[0]) : /^[+-]\d$/.test(ch) ? Number(ch) : 0,
  };
}

// PQR: whitespace separated, the chain is optional, then x y z charge radius (and sometimes an element at the end).
function pqrAtom(line, rec) {
  let t = line.trim().split(/\s+/);
  while (t.length && !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t[t.length - 1])) t = t.slice(0, -1);
  if (t.length < 10) return pdbAtom(line, rec);
  const [x, y, z, q, r] = t.slice(-5).map(Number);
  const mid = t.slice(4, -5);
  let chain = '', resi;
  if (mid.length >= 2) { chain = mid[0]; resi = parseInt(mid[1], 10); } else resi = parseInt(mid[0], 10);
  if (![x, y, z].every(Number.isFinite)) return null;
  const name = t[2], resn = t[3];
  return { serial: parseInt(t[1], 10) || 0, name, alt: '', resn, chain: /^\d+$/.test(chain) && mid.length < 2 ? '' : chain, resi: resi || 0, icode: '', x, y, z,
    occ: 1, b: 0, elem: elemFromPdbName(name.length < 4 ? ` ${name}` : name, resn, rec === 'HETATM'), het: rec === 'HETATM', charge: q, radius: r };
}

// ---------------------------------------------------------------- CIF (mmCIF and small-molecule CIF)
const CIF_TOKEN = /'(?:[^']|'(?=\S))*'(?=\s|$)|"(?:[^"]|"(?=\S))*"(?=\s|$)|\S+/g;
/** Reads a CIF text into { blocks: [{ name, items: Map(tag -> value), loops: [{ tags, rows }] }] }. Tags are lower case
 *  with the category dot turned into an underscore (_atom_site.Cartn_x -> _atom_site_cartn_x), so CIF1 and mmCIF match. */
function readCif(text, { wantLoops } = {}) {
  const blocks = [];
  let block = null;
  let loop = null; // { tags, rows, values } while reading a loop
  let pendingTag = null; // a single item waiting for its value
  const norm = (t) => t.toLowerCase().replace('.', '_');
  const endLoop = () => { if (loop) { if (!loop.skip) block.loops.push(loop); loop = null; } };
  const value = (v) => {
    if (pendingTag) { block.items.set(pendingTag, v); pendingTag = null; return; }
    if (loop && loop.reading) { if (!loop.skip) loop.values.push(v); if (!loop.skip && loop.values.length === loop.tags.length) { loop.rows.push(loop.values); loop.values = []; } return; }
  };
  const all = lines(text);
  for (let li = 0; li < all.length; li++) {
    const line = all[li];
    if (line[0] === ';') { // multi-line text field
      let t = line.slice(1);
      li++;
      while (li < all.length && all[li][0] !== ';') { t += '\n' + all[li]; li++; }
      if (!block) continue;
      value(t.trim());
      // anything after the closing ';' on that line
      const rest = li < all.length ? all[li].slice(1).trim() : '';
      if (rest) li--, all[li + 1] = ' ' + rest; // re-read the rest of the closing line
      continue;
    }
    if (!line || line[0] === '#') continue;
    CIF_TOKEN.lastIndex = 0;
    let m;
    while ((m = CIF_TOKEN.exec(line))) {
      let tok = m[0];
      if (tok[0] === '#') break;
      const low = tok.toLowerCase();
      if (low.startsWith('data_')) { endLoop(); block = { name: tok.slice(5), items: new Map(), loops: [] }; blocks.push(block); pendingTag = null; continue; }
      if (!block) { block = { name: '', items: new Map(), loops: [] }; blocks.push(block); }
      if (low === 'loop_') { endLoop(); loop = { tags: [], rows: [], values: [], reading: false }; pendingTag = null; continue; }
      if (tok[0] === '_' && !(pendingTag)) {
        if (loop && !loop.reading) { loop.tags.push(norm(tok)); continue; }
        endLoop();
        pendingTag = norm(tok);
        continue;
      }
      if ((tok[0] === "'" || tok[0] === '"') && tok.length >= 2 && tok[tok.length - 1] === tok[0]) tok = tok.slice(1, -1);
      if (loop && !loop.reading) {
        loop.reading = true;
        if (wantLoops && !loop.tags.some((t) => wantLoops.some((w) => t.startsWith(w)))) loop.skip = true;
      }
      value(tok);
    }
  }
  endLoop();
  return { blocks };
}

const cifNull = (v) => v === undefined || v === '?' || v === '.';
function loopTable(block, prefix) {
  const lp = block.loops.find((l) => l.tags.some((t) => t.startsWith(prefix)));
  if (lp) {
    const col = (name) => lp.tags.indexOf(prefix + name);
    return { rows: lp.rows, col };
  }
  // a category written as single items (one row)
  const tags = [...block.items.keys()].filter((k) => k.startsWith(prefix));
  if (!tags.length) return null;
  return { rows: [tags.map((t) => block.items.get(t))], col: (name) => tags.indexOf(prefix + name) };
}

function parseCif(text) {
  const out = { format: 'cif', title: '', id: '', models: [], helices: [], sheets: [], warnings: [] };
  const { blocks } = readCif(text);
  const block = blocks.find((b) => b.loops.some((l) => l.tags.some((t) => t.startsWith('_atom_site_')))) || blocks[0];
  if (!block) return out;
  out.id = block.items.get('_entry_id') || block.name || '';
  const title = block.items.get('_struct_title') || block.items.get('_chemical_name_common') || block.items.get('_chemical_name_systematic') || '';
  out.title = cifNull(title) ? '' : String(title).replace(/\s+/g, ' ').trim();
  const t = loopTable(block, '_atom_site_');
  if (!t) return out;
  const c = (n) => t.col(n);
  const ix = { x: c('cartn_x'), y: c('cartn_y'), z: c('cartn_z'), fx: c('fract_x'), fy: c('fract_y'), fz: c('fract_z') };
  const cart = ix.x >= 0 && ix.y >= 0 && ix.z >= 0;
  const frac = !cart && ix.fx >= 0 && ix.fy >= 0 && ix.fz >= 0;
  if (!cart && !frac) { out.warnings.push('The CIF file has an atom list without coordinates.'); return out; }
  let toCart = null;
  if (frac) {
    out.format = 'cif-small';
    const g = (k) => num(String(block.items.get(k) || '').replace(/\(.*\)$/, ''));
    const cell = { a: g('_cell_length_a'), b: g('_cell_length_b'), c: g('_cell_length_c'), al: g('_cell_angle_alpha'), be: g('_cell_angle_beta'), ga: g('_cell_angle_gamma') };
    if (![cell.a, cell.b, cell.c, cell.al, cell.be, cell.ga].every(Number.isFinite)) { out.warnings.push('The CIF file has fractional coordinates but no complete unit cell.'); return out; }
    out.cell = cell;
    toCart = fracToCart(cell);
  }
  const col = {
    group: c('group_pdb'), id: c('id'), type: c('type_symbol'), aname: c('auth_atom_id'), lname: c('label_atom_id'), label: c('label'), alt: c('label_alt_id'),
    acomp: c('auth_comp_id'), lcomp: c('label_comp_id'), aasym: c('auth_asym_id'), lasym: c('label_asym_id'), aseq: c('auth_seq_id'), lseq: c('label_seq_id'),
    ins: c('pdbx_pdb_ins_code'), occ: c('occupancy'), b: c('b_iso_or_equiv'), u: c('u_iso_or_equiv'), model: c('pdbx_pdb_model_num'), charge: c('pdbx_formal_charge'),
  };
  const get = (row, i) => (i >= 0 && !cifNull(row[i]) ? row[i] : '');
  const stripSu = (s) => String(s).replace(/\(\d+\)$/, '');
  const byModel = new Map();
  let order = 0;
  for (const row of t.rows) {
    let x, y, z;
    if (cart) { x = num(row[ix.x]); y = num(row[ix.y]); z = num(row[ix.z]); } else {
      const f = [num(stripSu(row[ix.fx])), num(stripSu(row[ix.fy])), num(stripSu(row[ix.fz]))];
      [x, y, z] = toCart(f);
    }
    if (![x, y, z].every(Number.isFinite)) continue;
    const name = get(row, col.aname) || get(row, col.lname) || get(row, col.label);
    const resn = get(row, col.acomp) || get(row, col.lcomp);
    let elem = normElem(get(row, col.type));
    if (!elem) elem = normElem(name.replace(/[0-9].*$/, ''));
    const mnum = get(row, col.model) || '1';
    if (!byModel.has(mnum)) byModel.set(mnum, { order: order++, atoms: [] });
    const group = get(row, col.group).toUpperCase();
    const bRaw = get(row, col.b);
    const uRaw = get(row, col.u);
    byModel.get(mnum).atoms.push({
      serial: parseInt(get(row, col.id), 10) || byModel.get(mnum).atoms.length + 1, name, alt: get(row, col.alt), resn,
      chain: get(row, col.aasym) || get(row, col.lasym), resi: parseInt(get(row, col.aseq) || get(row, col.lseq), 10) || 0, icode: get(row, col.ins),
      x, y, z, occ: get(row, col.occ) ? num(stripSu(get(row, col.occ))) : 1,
      b: bRaw ? num(stripSu(bRaw)) : uRaw ? 8 * Math.PI * Math.PI * num(stripSu(uRaw)) : 0,
      elem, het: group ? group === 'HETATM' : frac, charge: parseInt(get(row, col.charge), 10) || 0,
    });
  }
  out.models = [...byModel.values()].sort((a, b) => a.order - b.order).map((m) => ({ atoms: m.atoms }));
  for (const m of out.models) for (const a of m.atoms) { if (!Number.isFinite(a.occ)) a.occ = 1; if (!Number.isFinite(a.b)) a.b = 0; }
  // secondary structure (mmCIF)
  const conf = loopTable(block, '_struct_conf_');
  if (conf) {
    const ch = conf.col('beg_auth_asym_id'), s = conf.col('beg_auth_seq_id'), e = conf.col('end_auth_seq_id'), ty = conf.col('conf_type_id');
    for (const r of conf.rows) if (ch >= 0 && (ty < 0 || /^HELX/i.test(r[ty]))) out.helices.push({ chain: r[ch], start: parseInt(r[s], 10), end: parseInt(r[e], 10) });
  }
  const sheet = loopTable(block, '_struct_sheet_range_');
  if (sheet) {
    const ch = sheet.col('beg_auth_asym_id'), s = sheet.col('beg_auth_seq_id'), e = sheet.col('end_auth_seq_id');
    for (const r of sheet.rows) if (ch >= 0) out.sheets.push({ chain: r[ch], start: parseInt(r[s], 10), end: parseInt(r[e], 10) });
  }
  return out;
}

/** Fractional to Cartesian (a along x, b in the xy plane). */
function fracToCart({ a, b, c, al, be, ga }) {
  const r = Math.PI / 180;
  const ca = Math.cos(al * r), cb = Math.cos(be * r), cg = Math.cos(ga * r), sg = Math.sin(ga * r);
  const v = Math.sqrt(Math.max(0, 1 - ca * ca - cb * cb - cg * cg + 2 * ca * cb * cg));
  return ([fx, fy, fz]) => [a * fx + b * cg * fy + c * cb * fz, b * sg * fy + c * ((ca - cb * cg) / sg) * fz, c * (v / sg) * fz];
}

// ---------------------------------------------------------------- SDF / MOL
function parseSdf(text) {
  const out = { format: 'sdf', title: '', models: [], helices: [], sheets: [], warnings: [] };
  const all = lines(text);
  const recs = [];
  let start = 0;
  for (let i = 0; i < all.length; i++) if (/^\$\$\$\$/.test(all[i])) { recs.push(all.slice(start, i)); start = i + 1; }
  if (all.slice(start).some((l) => l.trim())) recs.push(all.slice(start));
  for (const L of recs) {
    const countsAt = L.length > 3 && (/V[23]000\s*$/i.test(L[3]) || /^\s*\d+\s*\d+/.test(L[3])) ? 3 : -1;
    if (countsAt < 0) continue;
    const name = (L[countsAt - 3] || '').trim();
    const counts = L[countsAt];
    const atoms = [], bonds = [];
    if (/V3000/i.test(counts)) {
      let mode = '';
      for (let i = countsAt + 1; i < L.length; i++) {
        const l = L[i];
        if (/^M\s+END/.test(l)) break;
        const m = /^M\s+V30\s+(.*)$/.exec(l);
        if (!m) continue;
        const body = m[1].trim();
        if (/^BEGIN ATOM/i.test(body)) { mode = 'atom'; continue; }
        if (/^BEGIN BOND/i.test(body)) { mode = 'bond'; continue; }
        if (/^END/i.test(body)) { mode = ''; continue; }
        const f = body.split(/\s+/);
        if (mode === 'atom' && f.length >= 5) {
          const chg = /CHG=(-?\d+)/.exec(body);
          atoms.push(smallAtom(atoms.length, f[1], num(f[2]), num(f[3]), num(f[4]), chg ? Number(chg[1]) : 0));
        } else if (mode === 'bond' && f.length >= 4) bonds.push([Number(f[2]) - 1, Number(f[3]) - 1, Number(f[1]) || 1]);
      }
    } else {
      const na = parseInt(counts.slice(0, 3), 10) || 0, nb = parseInt(counts.slice(3, 6), 10) || 0;
      for (let i = 0; i < na; i++) {
        const l = L[countsAt + 1 + i] || '';
        const x = num(l.slice(0, 10)), y = num(l.slice(10, 20)), z = num(l.slice(20, 30));
        const sym = l.slice(31, 34).trim() || (l.trim().split(/\s+/)[3] || '');
        const ccc = parseInt(l.slice(36, 39), 10) || 0; // 1..7 = +3..-3
        atoms.push(smallAtom(i, sym, x, y, z, ccc ? 4 - ccc : 0));
      }
      for (let i = 0; i < nb; i++) {
        const l = L[countsAt + 1 + na + i] || '';
        const a = parseInt(l.slice(0, 3), 10), b = parseInt(l.slice(3, 6), 10), o = parseInt(l.slice(6, 9), 10);
        if (a && b) bonds.push([a - 1, b - 1, o || 1]);
      }
      for (let i = countsAt + 1 + na + nb; i < L.length; i++) { // M  CHG lines override
        const m = /^M\s+CHG\s+\d+((?:\s+-?\d+\s+-?\d+)+)/.exec(L[i]);
        if (m) { const v = m[1].trim().split(/\s+/).map(Number); for (let k = 0; k + 1 < v.length; k += 2) if (atoms[v[k] - 1]) atoms[v[k] - 1].charge = v[k + 1]; }
      }
    }
    const good = atoms.filter((a) => [a.x, a.y, a.z].every(Number.isFinite));
    if (good.length !== atoms.length) { out.warnings.push('Some atom lines could not be read.'); continue; }
    if (atoms.length) out.models.push({ atoms, bonds, name });
  }
  out.title = out.models.length ? out.models[0].name : '';
  return out;
}

function smallAtom(i, sym, x, y, z, charge) {
  const elem = normElem(sym) || elemFromNumber(sym);
  return { serial: i + 1, name: `${elem || sym}${i + 1}`, alt: '', resn: 'MOL', chain: '', resi: 1, icode: '', x, y, z, occ: 1, b: 0, elem, het: true, charge: charge || 0 };
}

// ---------------------------------------------------------------- MOL2
function parseMol2(text) {
  const out = { format: 'mol2', title: '', models: [], helices: [], sheets: [], warnings: [] };
  let cur = null, sec = '', molLine = 0;
  for (const raw of lines(text)) {
    const l = raw.trim();
    if (!l || l[0] === '#') continue;
    const s = /^@<TRIPOS>(\w+)/i.exec(l);
    if (s) {
      sec = s[1].toUpperCase();
      if (sec === 'MOLECULE') { cur = { atoms: [], bonds: [], name: '', ids: new Map() }; out.models.push(cur); molLine = 0; }
      continue;
    }
    if (!cur) continue;
    if (sec === 'MOLECULE') { if (molLine === 0) cur.name = l; molLine++; continue; }
    const f = l.split(/\s+/);
    if (sec === 'ATOM' && f.length >= 6) {
      const x = num(f[2]), y = num(f[3]), z = num(f[4]);
      if (![x, y, z].every(Number.isFinite)) continue;
      const type = f[5];
      const elem = normElem(type.split('.')[0]) || normElem(f[1].replace(/[0-9].*$/, ''));
      const substId = parseInt(f[6], 10) || 1;
      const subst = f[7] || 'MOL';
      const m = /^([A-Za-z]{2,4}?)(-?\d+)$/.exec(subst);
      cur.ids.set(f[0], cur.atoms.length);
      cur.atoms.push({ serial: parseInt(f[0], 10) || cur.atoms.length + 1, name: f[1], alt: '', resn: m ? m[1].toUpperCase() : subst.slice(0, 4).toUpperCase(), chain: '',
        resi: m ? parseInt(m[2], 10) : substId, icode: '', x, y, z, occ: 1, b: 0, elem, het: true, charge: num(f[8]) || 0, type });
    } else if (sec === 'BOND' && f.length >= 4) {
      const a = cur.ids.get(f[1]), b = cur.ids.get(f[2]);
      if (a !== undefined && b !== undefined) cur.bonds.push([a, b, f[3] === 'ar' ? 1.5 : Number(f[3]) || 1]);
    }
  }
  out.models = out.models.filter((m) => m.atoms.length).map((m) => ({ atoms: m.atoms, bonds: m.bonds, name: m.name }));
  out.title = out.models.length ? out.models[0].name : '';
  // protein MOL2 files carry residues as substructures: mark standard residues as polymer atoms
  for (const m of out.models) for (const a of m.atoms) if (RESIDUE_KIND[a.resn]) a.het = false;
  return out;
}

// ---------------------------------------------------------------- XYZ
function parseXyz(text) {
  const out = { format: 'xyz', title: '', models: [], helices: [], sheets: [], warnings: [] };
  const L = lines(text);
  let i = 0;
  while (i < L.length) {
    while (i < L.length && !L[i].trim()) i++;
    if (i >= L.length) break;
    const n = parseInt(L[i].trim(), 10);
    if (!Number.isInteger(n) || n <= 0 || !/^\s*\d+\s*$/.test(L[i])) { if (!out.models.length) out.warnings.push('The first line of an XYZ file must be the atom count.'); break; }
    const comment = (L[i + 1] || '').trim();
    const atoms = [];
    for (let k = 0; k < n; k++) {
      const f = (L[i + 2 + k] || '').trim().split(/\s+/);
      if (f.length < 4) break;
      const x = num(f[1]), y = num(f[2]), z = num(f[3]);
      if (![x, y, z].every(Number.isFinite)) break;
      atoms.push(smallAtom(k, f[0], x, y, z, 0));
    }
    if (atoms.length !== n) { out.warnings.push(`Frame ${out.models.length + 1} has ${atoms.length} of ${n} atoms; reading stopped there.`); if (atoms.length) out.models.push({ atoms, name: comment }); break; }
    out.models.push({ atoms, name: comment });
    i += 2 + n;
  }
  out.title = out.models.length ? out.models[0].name : '';
  return out;
}

// ---------------------------------------------------------------- GRO (GROMACS, nm)
function parseGro(text) {
  const out = { format: 'gro', title: '', models: [], helices: [], sheets: [], warnings: [] };
  const L = lines(text);
  let i = 0;
  while (i + 1 < L.length) {
    const title = L[i];
    const n = parseInt((L[i + 1] || '').trim(), 10);
    if (!Number.isInteger(n) || n <= 0) { if (!out.models.length) out.warnings.push('The second line of a GRO file must be the atom count.'); break; }
    const atoms = [];
    // decimals from the first atom line: the distance between the first two dots
    const first = L[i + 2] || '';
    const d1 = first.indexOf('.', 20), d2 = first.indexOf('.', d1 + 1);
    const w = d1 > 0 && d2 > d1 ? d2 - d1 : 8;
    for (let k = 0; k < n; k++) {
      const l = L[i + 2 + k];
      if (l === undefined) break;
      const x = num(l.slice(20, 20 + w)), y = num(l.slice(20 + w, 20 + 2 * w)), z = num(l.slice(20 + 2 * w, 20 + 3 * w));
      if (![x, y, z].every(Number.isFinite)) break;
      const resn = l.slice(5, 10).trim(), name = l.slice(10, 15).trim();
      atoms.push({ serial: parseInt(l.slice(15, 20), 10) || k + 1, name, alt: '', resn, chain: '', resi: parseInt(l.slice(0, 5), 10) || 0, icode: '',
        x: x * 10, y: y * 10, z: z * 10, occ: 1, b: 0, elem: groElem(name, resn), het: !RESIDUE_KIND[resn], charge: 0 });
    }
    if (atoms.length !== n) { out.warnings.push(`Frame ${out.models.length + 1} has ${atoms.length} of ${n} atoms.`); if (atoms.length) out.models.push({ atoms, name: title.trim() }); break; }
    out.models.push({ atoms, name: title.trim() });
    i += n + 3; // title, count, atoms, box
  }
  out.title = out.models.length ? out.models[0].name : '';
  return out;
}
function groElem(name, resn) {
  const r = resn.toUpperCase(), t = name.toUpperCase();
  if (TWO_LETTER_IONS.has(t) && (r === t || r.startsWith(t) || !RESIDUE_KIND[r])) return normElem(t);
  if (/^(SOD|NA\+?)$/.test(t)) return 'Na';
  if (/^(CLA|CL-?)$/.test(t)) return 'Cl';
  return normElem(t.replace(/^[0-9]+/, '')[0] || '');
}

// ---------------------------------------------------------------- residues
// one-letter codes and kinds of standard residues
const AMINO = { ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLN: 'Q', GLU: 'E', GLY: 'G', HIS: 'H', ILE: 'I', LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F',
  PRO: 'P', SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V', SEC: 'U', PYL: 'O', MSE: 'M', HID: 'H', HIE: 'H', HIP: 'H', HSD: 'H', HSE: 'H', HSP: 'H',
  CYX: 'C', CYM: 'C', ASH: 'D', GLH: 'E', LYN: 'K', ASX: 'B', GLX: 'Z', UNK: 'X' };
const NUCLEIC = { DA: 'A', DC: 'C', DG: 'G', DT: 'T', DU: 'U', A: 'A', C: 'C', G: 'G', U: 'U', T: 'T', DI: 'I', I: 'I', ADE: 'A', CYT: 'C', GUA: 'G', THY: 'T', URA: 'U' };
const WATER = new Set(['HOH', 'WAT', 'H2O', 'DOD', 'SOL', 'TIP', 'TIP3', 'TIP4', 'SPC', 'T3P', 'T4P', 'OH2']);
const RESIDUE_KIND = {};
for (const k of Object.keys(AMINO)) RESIDUE_KIND[k] = 'protein';
for (const k of Object.keys(NUCLEIC)) RESIDUE_KIND[k] = 'nucleic';
for (const k of ['NME', 'ACE', 'NH2']) RESIDUE_KIND[k] = 'protein';

// ---------------------------------------------------------------- dispatch
const FORMAT_BY_EXT = { pdb: 'pdb', ent: 'pdb', pdb1: 'pdb', pqr: 'pqr', cif: 'cif', mmcif: 'cif', mcif: 'cif', sdf: 'sdf', mol: 'sdf', sd: 'sdf', mol2: 'mol2', ml2: 'mol2', xyz: 'xyz', gro: 'gro' };
/** Format from the file name (a .gz suffix is ignored). */
function formatByName(name) {
  const n = String(name || '').toLowerCase().replace(/\.(gz|bgz)$/, '');
  const m = /\.([a-z0-9]+)$/.exec(n);
  return m ? FORMAT_BY_EXT[m[1]] || '' : '';
}
/** Format from the text when the name gives none or the wrong one. */
function sniffFormat(text) {
  const head = String(text).slice(0, 20000);
  if (/^data_/m.test(head) && /^_atom_site[._]/m.test(head)) return 'cif';
  if (/^data_/m.test(head) || /^loop_/m.test(head)) return 'cif';
  if (/^@<TRIPOS>/m.test(head)) return 'mol2';
  if (/^(ATOM  |HETATM)/m.test(head) || /^(HEADER|COMPND|REMARK|CRYST1|MODEL )/m.test(head)) return 'pdb';
  const L = head.split(/\r?\n/);
  if (L.length > 3 && /V[23]000\s*$/i.test(L[3])) return 'sdf';
  if (/^\s*\d+\s*$/.test(L[0] || '') && /^\s*[A-Za-z]{1,3}\s+-?\d/.test(L[2] || '')) return 'xyz';
  if (/^\s*\d+\s*$/.test(L[1] || '') && /^\s*\d+\S+\s+\S+\s+\d+\s+-?\d*\.\d+/.test(L[2] || '')) return 'gro';
  return '';
}

/** Parses text with the given format ('' = sniff). */
function parseStructure(text, format) {
  const f = format || sniffFormat(text);
  switch (f) {
    case 'pdb': return parsePdb(text);
    case 'pqr': return parsePdb(text, { pqr: true });
    case 'cif': return parseCif(text);
    case 'sdf': return parseSdf(text);
    case 'mol2': return parseMol2(text);
    case 'xyz': return parseXyz(text);
    case 'gro': return parseGro(text);
    default: return { format: '', title: '', models: [], helices: [], sheets: [], warnings: ['The file does not look like a structure file.'] };
  }
}

module.exports = {
  parseStructure, parsePdb, parseCif, readCif, parseSdf, parseMol2, parseXyz, parseGro, formatByName, sniffFormat, fracToCart,
  normElem, elemFromPdbName, AMINO, NUCLEIC, WATER, RESIDUE_KIND, ELEMENTS, FORMAT_BY_EXT,
};
