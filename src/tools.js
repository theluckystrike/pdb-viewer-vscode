'use strict';
// The three Zovo Pro tools: Measure, Superpose and RMSD, Binding site report. Each asks pro.allowed() on every click
// and calls pro.produced() only after its result is on screen (the first measurement or list drawn in the viewer, the
// report drawn in its panel), so Escape, Cancel or an error never uses a free try. Everything runs on this computer;
// files are read and written through VS Code's file system API, so it works the same on remote folders.
const vscode = require('vscode');
const path = require('path');
const P = require('./core/parse');
const M = require('./core/model');
const G = require('./core/geom');
const { loadStructure, FMT_3D, VIEW_TYPE } = require('./editor');
const { panelHtml } = require('./html');
const support = require('./support');

const PREFIX = 'pdbViewer';
const setting = (k, d) => vscode.workspace.getConfiguration(PREFIX).get(k, d);
const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fix = (x, d) => Number(x).toFixed(d);
const base = (uri) => path.posix.basename(uri.path);
const STRUCT_RE = /\.(pdb|ent|pdb1|cif|mmcif|mcif|pqr|sdf|mol|mol2|xyz|gro)(\.gz)?$/i;
const FILTERS = { 'Structure files': ['pdb', 'ent', 'cif', 'mmcif', 'pqr', 'sdf', 'mol', 'mol2', 'xyz', 'gro', 'gz'], 'All files': ['*'] };
const MAX_ROWS = 3000; // rows drawn in the viewer lists (the CSV has all)

function sibling(uri, suffix) {
  const name = base(uri).replace(/(\.gz)$/i, '').replace(/\.[^.]+$/, '');
  return vscode.Uri.joinPath(uri, '..', `${name}${suffix}`);
}
async function writeText(uri, text) { await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8')); }

function createTools({ context, provider, pro, reach }) {
  const panels = {};

  // ---------- panels ----------
  function openPanel(kind, title) {
    const media = vscode.Uri.joinPath(context.extensionUri, 'media');
    const lib = vscode.Uri.joinPath(context.extensionUri, 'lib');
    const old = panels[kind];
    if (old && !old.disposed) old.panel.dispose();
    const panel = vscode.window.createWebviewPanel(`${PREFIX}.${kind}`, title, { viewColumn: vscode.ViewColumn.Active, preserveFocus: false }, {
      enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [media, lib],
      enableCommandUris: (reach ? reach.commandIds() : []).concat(support.commandUris(PREFIX)),
    });
    panel.webview.html = panelHtml({
      cspSource: panel.webview.cspSource,
      libUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(lib, '3Dmol-min.js')).toString(),
      scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'panel.js')).toString(),
      styleUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'viewer.css')).toString(),
      title, head: reach ? (n) => reach.headHtml(n) : undefined, showSupportLinks: setting('showSupportLinks', true) !== false,
    });
    if (reach) reach.attach(panel.webview, panel);
    let readyFn;
    const p = { panel, kind, disposed: false, actions: null, shown: null };
    p.ready = new Promise((r) => { readyFn = r; });
    p.post = (msg) => { try { const r = panel.webview.postMessage(msg); if (r && r.then) r.then(undefined, () => false); } catch (e) { /* disposed */ } };
    p.show = async (o) => { await p.ready; p.post({ type: 'show', ...o }); };
    panel.webview.onDidReceiveMessage(async (m) => {
      if (reach && reach.onMessage(m)) return;
      if (!m || typeof m !== 'object') return;
      try {
        if (m.type === 'ready') readyFn();
        else if (m.type === 'shown') { if (p.shown) { const f = p.shown; p.shown = null; await f(m); } }
        else if (m.type === 'action' && p.actions) await p.actions(m.id, m);
      } catch (e) { vscode.window.showErrorMessage(String((e && e.message) || e)); }
    });
    panel.onDidDispose(() => { p.disposed = true; if (panels[kind] === p) delete panels[kind]; });
    panels[kind] = p;
    return p;
  }

  // ---------- files ----------
  /** The file a tool works on: the clicked one, else the file of the active viewer, else an open dialog. */
  async function targetFile(arg, title) {
    if (arg && arg.scheme) return arg;
    if (provider.active) return provider.active.uri;
    const ed = vscode.window.activeTextEditor;
    if (ed && STRUCT_RE.test(ed.document.uri.path)) return ed.document.uri;
    const r = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Choose', title, filters: FILTERS });
    return r && r[0];
  }
  /** { data, atoms, model, summary } of a structure: the viewer's own when the file is open (with its shown model). */
  async function structureFor(uri) {
    for (const d of provider.docs) {
      if (d.uri.toString() === uri.toString() && d.data && d.data.kind === 'structure') return { data: d.data, atoms: d.atoms, model: d.model, summary: M.summarize(d.data.struct, d.model) };
    }
    const data = await loadStructure(uri);
    if (data.kind === 'symbols') throw new Error(`${base(uri)} is a debug symbol file (program database), not a protein structure.`);
    if (data.kind !== 'structure') throw new Error(`${base(uri)} could not be read as a structure file${data.error ? `: ${data.error}` : '.'}`);
    return { data, atoms: data.struct.models[0].atoms, model: 0, summary: M.summarize(data.struct, 0) };
  }
  const isSmall = (doc) => !!(doc.summary && doc.summary.kind === 'small');

  // ---------- 1. Measure ----------
  async function measure(arg) {
    if (!(await pro.allowed('measure', arg))) return undefined;
    const uri = await targetFile(arg, 'Measure: choose a structure file');
    if (!uri) return undefined;
    const f = await provider.openAndWait(uri);
    if (!f) throw new Error(`${base(uri)} did not open in the PDB Viewer.`);
    if (!f.doc.data || f.doc.data.kind !== 'structure') throw new Error(`${base(uri)} is not a structure file the viewer could read, so there is nothing to measure.`);
    f.doc.measure = { counted: false, rows: [], hb: null, ct: null };
    provider.send(f.panel.webview, { type: 'measureOn', hbondCutoff: setting('hbondCutoff', 3.5), small: isSmall(f.doc) });
    return { uri, on: true };
  }

  const atomRow = (atoms, i, small) => { const a = atoms[i]; return { i, label: M.atomLabel(a, small), x: a.x, y: a.y, z: a.z }; };
  function scopeSet(doc, scope) {
    const atoms = doc.atoms;
    if (!scope || scope === 'all') return null;
    const s = new Set();
    if (scope.startsWith('chain:')) { const c = scope.slice(6); atoms.forEach((a, i) => { if (a.chain === c) s.add(i); }); return s; }
    atoms.forEach((a, i) => { if (M.resKey(a) === scope) s.add(i); });
    return s;
  }

  /** Measure messages from the viewer (only while Measure is on for that file). */
  async function onToolMessage(doc, panel, m) {
    const ms = doc.measure;
    const reply = (o) => provider.send(panel.webview, { req: m.req, ...o });
    if (!ms) { if (/^(measure|hbonds|contacts)/.test(m.type)) reply({ type: 'measureOff' }); return; }
    const atoms = doc.atoms;
    const small = isSmall(doc);
    switch (m.type) {
      case 'measurePick': {
        const idx = (Array.isArray(m.atoms) ? m.atoms : []).map((p) => (Number.isInteger(p && p.i) ? p.i : M.atomAt(atoms, p || {}, 0.05)));
        if (idx.length < 2 || idx.length > 4 || idx.some((i) => i < 0 || i >= atoms.length)) { reply({ type: 'measureError', message: 'Those atoms are not in the shown model. Pick them again.' }); return; }
        if (new Set(idx).size !== idx.length) { reply({ type: 'measureError', message: 'Pick different atoms.' }); return; }
        const r = G.measure(atoms, idx, small);
        ms.rows.push(r);
        reply({ type: 'measureResult', row: { kind: r.kind, value: r.value, unit: r.unit, labels: r.labels, atoms: idx.map((i) => atomRow(atoms, i, small)) }, n: ms.rows.length });
        return;
      }
      case 'hbonds': {
        const cutoff = Math.min(4, Math.max(2.6, Number(m.cutoff) || setting('hbondCutoff', 3.5)));
        const within = scopeSet(doc, String(m.scope || 'all'));
        const list = G.hbonds(atoms, { cutoff, within, water: !!m.water });
        ms.hb = { cutoff, scope: String(m.scope || 'all'), list };
        reply({ type: 'hbondsResult', cutoff, scope: ms.hb.scope, total: list.length, rows: list.slice(0, MAX_ROWS).map((h) => ({ d: h.d, a: atomRow(atoms, h.a, small), b: atomRow(atoms, h.b, small) })) });
        return;
      }
      case 'contacts': {
        const cutoff = Math.min(8, Math.max(1, Number(m.cutoff) || 4));
        const sel = scopeSet(doc, String(m.scope || ''));
        if (!sel || !sel.size) { reply({ type: 'measureError', message: 'Choose a residue, ligand or chain for the contacts first.' }); return; }
        const list = G.contacts(atoms, sel, cutoff, { water: !!m.water });
        ms.ct = { cutoff, scope: String(m.scope), list };
        const byRes = new Map();
        for (const c of list) { const k = `${atoms[c.b].chain}:${atoms[c.b].resn} ${atoms[c.b].resi}${atoms[c.b].icode || ''}`; const v = byRes.get(k); if (!v || c.d < v.d) byRes.set(k, { res: k, d: c.d, n: (v ? v.n : 0) + 1, a: atomRow(atoms, c.a, small), b: atomRow(atoms, c.b, small) }); else v.n++; }
        reply({ type: 'contactsResult', cutoff, scope: ms.ct.scope, total: list.length, residues: [...byRes.values()].sort((x, y) => x.d - y.d).slice(0, MAX_ROWS), rows: list.slice(0, MAX_ROWS).map((c) => ({ d: c.d, a: atomRow(atoms, c.a, small), b: atomRow(atoms, c.b, small) })) });
        return;
      }
      case 'measureShown':
        if (!ms.counted) { ms.counted = true; await pro.produced('measure'); }
        return;
      case 'measureClear': ms.rows = []; ms.hb = null; ms.ct = null; return;
      case 'measureCsv': {
        const rows = [['type', 'value', 'unit', 'atom 1', 'atom 2', 'atom 3', 'atom 4']];
        for (const r of ms.rows) rows.push([r.kind, fix(r.value, r.kind === 'distance' ? 3 : 2), r.unit === 'Å' ? 'angstrom' : 'degree', ...r.labels, '', '', ''].slice(0, 7));
        if (ms.hb) for (const h of ms.hb.list) rows.push(['hbond candidate', fix(h.d, 3), 'angstrom', M.atomLabel(atoms[h.a], small), M.atomLabel(atoms[h.b], small), '', '']);
        if (ms.ct) for (const c of ms.ct.list) rows.push([`contact within ${ms.ct.cutoff} A of ${ms.ct.scope}`, fix(c.d, 3), 'angstrom', M.atomLabel(atoms[c.a], small), M.atomLabel(atoms[c.b], small), '', '']);
        if (rows.length === 1) { reply({ type: 'measureError', message: 'Nothing to save yet: measure something first.' }); return; }
        const dest = await vscode.window.showSaveDialog({ defaultUri: sibling(doc.uri, '.measurements.csv'), filters: { CSV: ['csv'] }, title: 'Save the measurements as CSV' });
        if (!dest) return;
        await writeText(dest, G.csv(rows));
        reply({ type: 'measureSaved', path: dest.fsPath || dest.path, rows: rows.length - 1 });
        vscode.window.setStatusBarMessage(`Saved ${rows.length - 1} rows to ${base(dest)}`, 5000);
        return;
      }
      case 'measureOff': doc.measure = null; return;
      default:
    }
  }

  // ---------- 2. Superpose and RMSD ----------
  async function superpose(arg, extra = {}) {
    if (!(await pro.allowed('superpose', arg))) return undefined;
    const uriA = await targetFile(arg, 'Superpose: choose the reference structure');
    if (!uriA) return undefined;
    let uriB = extra.other;
    if (!uriB) {
      const open = [...provider.docs].filter((d) => d.uri.toString() !== uriA.toString() && d.data && d.data.kind === 'structure');
      const items = open.map((d) => ({ label: d.name, description: vscode.workspace.asRelativePath ? vscode.workspace.asRelativePath(d.uri) : d.uri.fsPath, uri: d.uri }));
      items.push({ label: 'Choose a file...', description: 'PDB, mmCIF, PQR, GRO or MOL2 with a protein or nucleic acid chain', file: true });
      const pick = await vscode.window.showQuickPick(items, { ignoreFocusOut: true, title: `Superpose onto ${base(uriA)}`, placeHolder: 'The structure to move onto the reference' });
      if (!pick) return undefined;
      if (pick.file) {
        const r = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Superpose', title: `Superpose onto ${base(uriA)}: choose the structure to move`, filters: FILTERS });
        uriB = r && r[0];
      } else uriB = pick.uri;
    }
    if (!uriB) return undefined;
    const A = await structureFor(uriA);
    const B = await structureFor(uriB);
    const r = G.superpose(A.atoms, B.atoms, { chainA: extra.chainA, chainB: extra.chainB });
    const moved = G.transformAtoms(B.atoms, r);
    const movedPdb = G.toPdb(moved, { title: `${base(uriB)} superposed onto ${base(uriA)}`, remarks: [`Superposed with Zovo PDB Viewer: RMSD ${fix(r.rmsd, 3)} A over ${r.n} matched C-alpha/C4' atoms`] });
    const refPdb = G.toPdb(A.atoms, { title: base(uriA) });
    const title = `Superpose: ${base(uriB)} onto ${base(uriA)}`;
    const p = openPanel('superpose', title);
    p.result = r;
    p.shown = async () => { await pro.produced('superpose'); };
    p.actions = async (id, m) => {
      if (id === 'csv') {
        const dest = await vscode.window.showSaveDialog({ defaultUri: sibling(uriB, '.rmsd.csv'), filters: { CSV: ['csv'] }, title: 'Save the per-residue deviations as CSV' });
        if (!dest) return;
        const rows = [['chain_ref', 'residue_ref', 'number_ref', 'chain_moved', 'residue_moved', 'number_moved', 'deviation_A']];
        for (const x of r.perResidue) rows.push([x.chainA, x.resnA, `${x.resiA}${x.icodeA || ''}`, x.chainB, x.resnB, `${x.resiB}${x.icodeB || ''}`, fix(x.dev, 3)]);
        rows.push([]);
        rows.push(['chain_ref', 'chain_moved', 'pairs', 'rmsd_A', 'identity_pct']);
        for (const c of r.perChain) rows.push([c.chainA, c.chainB, c.n, fix(c.rmsd, 3), fix(100 * c.identity, 1)]);
        rows.push(['all', 'all', r.n, fix(r.rmsd, 3), '']);
        await writeText(dest, G.csv(rows));
        p.post({ type: 'patch', target: 'saved', html: `Saved ${esc(dest.fsPath || dest.path)} (${r.perResidue.length} residues).` });
      } else if (id === 'pdb') {
        const dest = await vscode.window.showSaveDialog({ defaultUri: sibling(uriB, '.superposed.pdb'), filters: { PDB: ['pdb'] }, title: 'Save the moved structure as PDB' });
        if (!dest) return;
        await writeText(dest, movedPdb);
        p.post({ type: 'patch', target: 'saved', html: `Saved ${esc(dest.fsPath || dest.path)} (${moved.length} atoms).` });
      }
    };
    const chainRows = r.perChain.map((c) => `<tr><td>${esc(c.chainA || '-')}</td><td>${esc(c.chainB || '-')}</td><td class="num">${c.n}</td><td class="num">${fix(c.rmsd, 3)}</td><td class="num">${fix(100 * c.identity, 1)} %</td></tr>`).join('');
    const worst = r.perResidue.slice().sort((x, y) => y.dev - x.dev).slice(0, 10);
    const resRows = r.perResidue.map((x) => `<tr class="${x.dev >= 2 ? 'hi' : ''}"><td>${esc(x.chainA)}</td><td>${esc(x.resnA)} ${x.resiA}${esc(x.icodeA)}</td><td>${esc(x.chainB)}</td><td>${esc(x.resnB)} ${x.resiB}${esc(x.icodeB)}</td><td class="num">${fix(x.dev, 3)}</td></tr>`).join('');
    const html = `<p class="row"><button class="tb act" data-id="csv">Save table as CSV...</button> <button class="tb act" data-id="pdb">Save moved structure as PDB...</button> <span id="saved" class="muted"></span></p>
<div class="stats"><div><b id="rmsd">${fix(r.rmsd, 3)} Å</b><span>RMSD</span></div><div><b id="pairs">${r.n}</b><span>matched C-alpha pairs</span></div><div><b>${r.perChain.length}</b><span>chain pair${r.perChain.length === 1 ? '' : 's'}</span></div></div>
<p class="muted">Reference (blue): ${esc(base(uriA))}${A.data.struct.models.length > 1 ? `, model ${A.model + 1}` : ''}. Moved (orange): ${esc(base(uriB))}${B.data.struct.models.length > 1 ? ', model 1' : ''}. Chains are paired by sequence identity; residues with the same type at aligned positions are fitted.</p>
<h3>Per chain</h3><table id="chainTable"><tr><th>Reference chain</th><th>Moved chain</th><th>Pairs</th><th>RMSD (Å)</th><th>Identity</th></tr>${chainRows}</table>
<h3>Largest deviations</h3><p>${worst.map((x) => `${esc(x.chainA)}:${esc(x.resnA)} ${x.resiA} ${fix(x.dev, 2)} Å`).join(', ')}</p>
<h3>Per residue</h3><table id="resTable"><tr><th>Ref chain</th><th>Ref residue</th><th>Moved chain</th><th>Moved residue</th><th>Deviation (Å)</th></tr>${resRows}</table>`;
    await p.show({ title, html, view: { mode: 'superpose', a: refPdb, b: movedPdb }, result: { rmsd: r.rmsd, n: r.n } });
    return r;
  }

  // ---------- 3. Binding site report ----------
  async function bindingSite(arg, extra = {}) {
    if (!(await pro.allowed('bindingSite', arg))) return undefined;
    const uri = await targetFile(arg, 'Binding site report: choose a structure file');
    if (!uri) return undefined;
    const S = await structureFor(uri);
    const ligs = S.summary.ligands.slice().sort((a, b) => (a.kind === 'ion') - (b.kind === 'ion') || b.atoms - a.atoms);
    if (!ligs.length) throw new Error(`${base(uri)} has no ligand (a group other than polymer residues and water), so there is no binding site to report.`);
    let lig = extra.ligand ? ligs.find((l) => l.key === extra.ligand || `${l.resn} ${l.key}` === extra.ligand) : null;
    if (extra.ligand && !lig) throw new Error(`No ligand ${extra.ligand} in ${base(uri)}.`);
    if (!lig) {
      const big = ligs.filter((l) => l.kind === 'ligand');
      if (big.length === 1 && ligs.length === 1) lig = big[0];
      else {
        const pick = await vscode.window.showQuickPick(ligs.map((l) => ({ label: `${l.resn} ${l.key}`, description: `${l.atoms} atom${l.atoms === 1 ? '' : 's'}${l.kind === 'ion' ? ', ion' : ''}`, lig: l })), { ignoreFocusOut: true, title: `Binding site report: ${base(uri)}`, placeHolder: 'Choose the ligand' });
        if (!pick) return undefined;
        lig = pick.lig;
      }
    }
    let radius = Number(extra.radius);
    if (!Number.isFinite(radius)) {
      const t = await vscode.window.showInputBox({ ignoreFocusOut: true, title: `Residues near ${lig.resn} ${lig.key}`, prompt: 'Distance from any ligand atom, in angstrom (2 to 12)', value: String(setting('bindingSiteRadius', 5)), validateInput: (v) => { const n = Number(v); return Number.isFinite(n) && n >= 2 && n <= 12 ? '' : 'Type a number from 2 to 12'; } });
      if (t === undefined) return undefined;
      radius = Number(t);
    }
    const r = G.bindingSite(S.atoms, { key: lig.key, resn: lig.resn }, radius);
    const title = `Binding site: ${lig.resn} ${lig.key} in ${base(uri)}`;
    const p = openPanel('site', title);
    p.result = r;
    p.shown = async () => { await pro.produced('bindingSite'); };
    const csvRows = () => {
      const rows = [['chain', 'residue', 'number', 'kind', 'min_distance_A', 'closest_residue_atom', 'closest_ligand_atom', 'atom_contacts', 'hbond_candidates', 'carbon_contacts_4A']];
      for (const x of r.residues) rows.push([x.chain, x.resn, `${x.resi}${x.icode || ''}`, x.kind, fix(x.min, 2), x.closest[0], x.closest[1], x.contacts, x.hbonds, x.hydrophobic]);
      return rows;
    };
    p.actions = async (id, m) => {
      if (id === 'csv') {
        const dest = await vscode.window.showSaveDialog({ defaultUri: sibling(uri, `.${lig.resn.toLowerCase()}-site.csv`), filters: { CSV: ['csv'] }, title: 'Save the binding site table as CSV' });
        if (!dest) return;
        await writeText(dest, G.csv(csvRows()));
        p.post({ type: 'patch', target: 'saved', html: `Saved ${esc(dest.fsPath || dest.path)} (${r.residues.length} residues).` });
      } else if (id === 'pngData') {
        const data = String((m && m.data) || '');
        const mm = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(data);
        if (!mm) return;
        const dest = await vscode.window.showSaveDialog({ defaultUri: sibling(uri, `.${lig.resn.toLowerCase()}-site.png`), filters: { PNG: ['png'] }, title: 'Save the focused view as PNG' });
        if (!dest) return;
        const buf = Buffer.from(mm[1], 'base64');
        await vscode.workspace.fs.writeFile(dest, buf);
        p.post({ type: 'patch', target: 'saved', html: `Saved ${esc(dest.fsPath || dest.path)} (${Math.round(buf.length / 1024)} KB).` });
      }
    };
    const rows = r.residues.map((x) => `<tr data-chain="${esc(x.chain)}" data-resi="${x.resi}"><td>${esc(x.chain || '-')}</td><td>${esc(x.resn)} ${x.resi}${esc(x.icode)}</td><td class="num">${fix(x.min, 2)}</td><td>${esc(x.closest[0])} - ${esc(x.closest[1])}</td><td class="num">${x.contacts}</td><td class="num">${x.hbonds}</td><td class="num">${x.hydrophobic}</td></tr>`).join('');
    const html = `<p class="row"><button class="tb act" data-id="csv">Save table as CSV...</button> <button class="tb act" data-id="png">Save view as PNG...</button> <label class="chk"><input type="checkbox" id="transparent" checked> transparent background</label> <span id="saved" class="muted"></span></p>
<div class="stats"><div><b id="nres">${r.residues.length}</b><span>residues within ${fix(radius, 1)} Å</span></div><div><b>${r.ligand.atoms}</b><span>ligand atoms</span></div><div><b>${r.residues.reduce((s, x) => s + x.hbonds, 0)}</b><span>H-bond candidates (N/O pairs 2.4 to 3.5 Å)</span></div><div><b>${r.waters}</b><span>waters within ${fix(radius, 1)} Å</span></div></div>
<p class="muted">Distances are between heavy atoms. H-bond candidates are geometric (no hydrogens or angles are checked); carbon contacts count C-C pairs within 4 Å.</p>
<table id="siteTable"><tr><th>Chain</th><th>Residue</th><th>Closest (Å)</th><th>Closest atoms (residue - ligand)</th><th>Contacts</th><th>H-bond cand.</th><th>C-C 4 Å</th></tr>${rows}</table>`;
    await p.show({ title, html, view: { mode: 'site', text: G.toPdb(S.atoms, { title: base(uri) }), ligand: { chain: lig.chain, resi: lig.resi, resn: lig.resn }, residues: r.residues.map((x) => ({ chain: x.chain, resi: x.resi, resn: x.resn })) }, result: { residues: r.residues.length } });
    return r;
  }

  return { measure, superpose, bindingSite, onToolMessage, panels, structureFor, targetFile };
}

module.exports = { createTools, sibling, STRUCT_RE, VIEW_TYPE, P, FMT_3D };
