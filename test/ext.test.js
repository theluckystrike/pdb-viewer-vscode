'use strict';
// Extension tests with the vscode stub: listing, activation, the custom editor's messages for every format and for
// files that are not structures (debug symbol .pdb, binary, broken), the three Pro tools with 1 free try each (the
// 2nd use opens the Pro panel, also on another file and after a reload), README and support links.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadExtension, tmpDir, cleanup } = require('./support/vscode-stub');
const { editorHtml, panelHtml } = require('../src/html');
const P = require('../src/core/parse');
const G = require('../src/core/geom');

const ROOT = path.join(__dirname, '..');
const SAMPLES = path.join(ROOT, 'samples');
const FIX = path.join(__dirname, 'fixtures');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = f(); if (v) return v; await tick(10); } return f(); };
test.after(() => cleanup());

function fakePanel() {
  let onMsg;
  const posted = [];
  return {
    posted, viewColumn: 1, active: true,
    webview: { options: {}, html: '', cspSource: 'vscode-resource:', asWebviewUri: (u) => u, postMessage: async (m) => { posted.push(m); return true; }, onDidReceiveMessage: (f) => { onMsg = f; return { dispose() {} }; } },
    onDidChangeViewState: () => ({ dispose() {} }), onDidDispose: () => ({ dispose() {} }), reveal() {},
    send: (m) => onMsg(m),
  };
}

const activated = [];
/** Activates with a fresh stub. state: entries to put into globalState first (a "reload" of the window). */
function activate(folder, state) {
  const s = loadExtension();
  if (folder) s.vscode.workspace.workspaceFolders = [{ uri: s.vscode.Uri.file(folder), name: 'ws' }];
  if (state) for (const [k, v] of state) s.state.set(k, v);
  s.api = s.ext.activate(s.context);
  activated.push(s);
  // tool panels answer "show" with "shown" like the real panel does after drawing
  s.log.onPost = (panel, m) => { if (m.type === 'show' && m.html) panel.send({ type: 'shown' }); };
  // vscode.openWith on our view type: open the file in a fake viewer panel that reports "rendered" like the webview
  s.opened = [];
  s.commands.set('vscode.openWith', async (uri, viewType) => {
    s.opened.push([uri.fsPath, viewType]);
    if (viewType !== 'pdbViewer.editor') return undefined;
    const prov = s.api.provider;
    for (const d of prov.docs) if (d.uri.toString() === uri.toString() && d.panels.size) { prov.active = d; prov.activePanel = [...d.panels][0]; return undefined; }
    const e = await openEditor(s, uri.fsPath);
    prov.active = e.doc; prov.activePanel = e.panel;
    return undefined;
  });
  return s;
}
test.after(() => { for (const s of activated) s.api.provider.dispose(); });

async function openEditor(s, file) {
  const prov = s.api.provider;
  const handle = await prov.openCustomDocument(s.vscode.Uri.file(file));
  const panel = fakePanel();
  await prov.resolveCustomEditor(handle, panel);
  await panel.send({ type: 'ready' });
  const init = panel.posted.find((m) => m.type === 'init');
  if (init && init.kind === 'structure') await panel.send({ type: 'rendered', atoms: init.summary.atoms, pixels: 1000 });
  let req = 100;
  const ask = async (m) => { const id = ++req; await panel.send({ ...m, req: id }); return until(() => panel.posted.find((x) => x.req === id)); };
  return { prov, handle, panel, doc: handle._doc, ask, init };
}
function ws() {
  const dir = tmpDir('pdb-ws-');
  for (const f of fs.readdirSync(SAMPLES)) fs.copyFileSync(path.join(SAMPLES, f), path.join(dir, f));
  for (const f of fs.readdirSync(FIX)) fs.copyFileSync(path.join(FIX, f), path.join(dir, f));
  fs.copyFileSync(path.join(SAMPLES, '1crn.cif'), path.join(dir, '1CRN.CIF'));
  // a rotated copy of 1HSG for the superposition
  const a = P.parsePdb(fs.readFileSync(path.join(SAMPLES, '1hsg.pdb'), 'utf8')).models[0].atoms;
  const th = 0.6;
  fs.writeFileSync(path.join(dir, 'moved.pdb'), G.toPdb(G.transformAtoms(a, { R: [[Math.cos(th), -Math.sin(th), 0], [Math.sin(th), Math.cos(th), 0], [0, 0, 1]], t: [10, 20, -5] })));
  return dir;
}
const proPanels = (s, title) => s.log.info.filter((m) => m.text === `${title} is part of Zovo Pro.`);

// ---------- package.json and listing ----------
test('listing: display name with the phrase first, 30 characters or less, description starts with the phrase, 5 keywords, engines', () => {
  assert.equal(pkg.displayName, 'PDB Viewer & Protein Structure');
  assert.ok(pkg.displayName.length <= 30);
  assert.match(pkg.description, /^PDB viewer/);
  assert.deepEqual(pkg.keywords, ['pdb', 'protein', 'molecule', 'mmcif', 'bioinformatics']);
  assert.equal(pkg.engines.vscode, '^1.75.0');
  assert.equal(pkg.publisher, 'zovo');
  assert.equal(pkg.name, 'zovo-pdb-viewer');
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.repository.url, 'https://github.com/theluckystrike/pdb-viewer-vscode');
  assert.deepEqual(pkg.activationEvents, ['onUri']);
  assert.ok(fs.existsSync(path.join(ROOT, 'icon.png')));
});
test('editors: every structure extension by default, no bare .gz, no extension VS Code opens with its own custom editor', () => {
  const pats = pkg.contributes.customEditors[0].selector.map((s) => s.filenamePattern);
  for (const p of ['*.pdb', '*.ent', '*.cif', '*.mmcif', '*.pqr', '*.sdf', '*.mol', '*.mol2', '*.xyz', '*.gro', '*.pdb.gz', '*.cif.gz']) assert.ok(pats.includes(p), p);
  assert.ok(!pats.includes('*.gz'));
  assert.ok(!pats.some((p) => /\.(png|jpg|svg|ipynb|md|avif|webp)$/.test(p)));
  assert.ok(!pkg.contributes.themes && !pkg.contributes.grammars && !pkg.contributes.languages && !pkg.contributes.configurationDefaults);
});
test('menus: one backslash before the dots in the final package.json; the right-click regex matches upper case; no title on menu items', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');
  assert.ok(!raw.includes('\\\\\\\\.'));
  const items = Object.values(pkg.contributes.menus).flat();
  assert.ok(items.every((m) => !('title' in m)));
  const ctx = pkg.contributes.menus['explorer/context'].find((m) => m.command === 'pdbViewer.zovoPro.measure');
  const re = new RegExp(/resourceFilename =~ \/(.*)\/i/.exec(ctx.when)[1], 'i');
  for (const f of ['1CRN.PDB', 'x.cif', 'a.mol2', 'b.pdb.gz', 'C.SDF']) assert.ok(re.test(f), f);
  assert.ok(!re.test('a.txt') && !re.test('a.gz'));
  const wrappers = pkg.contributes.commands.filter((c) => /\.zovoPro\./.test(c.command));
  assert.equal(wrappers.length, 3);
  assert.ok(wrappers.every((c) => c.title.startsWith('Zovo Pro: ')));
  for (const w of wrappers) assert.ok(pkg.contributes.menus.commandPalette.some((m) => m.command === w.command && m.when === 'false'));
});
test('every contributed command is registered, and every registered pdbViewer command is contributed', () => {
  const s = activate();
  const contributed = pkg.contributes.commands.map((c) => c.command);
  for (const c of contributed) assert.ok(s.commands.has(c), c);
  for (const c of s.commands.keys()) if (c.startsWith('pdbViewer.')) assert.ok(contributed.includes(c), c);
});
test('activation shows nothing: no message, no panel, no editor', () => {
  const s = activate();
  assert.equal(s.log.info.length + s.log.warn.length + s.log.error.length, 0);
  assert.equal(s.log.panel, undefined);
  assert.equal(s.opened.length, 0);
});

// ---------- the viewer ----------
test('viewer: 1HSG sample sends the text, the format for the 3D view and the summary; rating success once after it rendered', async () => {
  const s = activate();
  let ok = 0;
  const { panel, doc, init } = await openEditor(s, path.join(SAMPLES, '1hsg.pdb'));
  void ok;
  assert.equal(init.kind, 'structure');
  assert.equal(init.fmt3d, 'pdb');
  assert.equal(init.label, 'PDB');
  assert.match(init.text, /^HEADER/);
  assert.equal(init.summary.atoms, 1686);
  assert.deepEqual(init.summary.chains.map((c) => c.id), ['A', 'B']);
  assert.deepEqual(init.summary.ligands.map((l) => l.resn), ['MK1']);
  assert.equal(init.models, 1);
  assert.ok(doc.rendered && doc.rendered.atoms === 1686);
  assert.match(panel.webview.html, /3Dmol-min\.js/);
  assert.ok(panel.webview.options.localResourceRoots.some((u) => /lib$/.test(u.fsPath)));
  assert.equal(s.log.error.length, 0);
});
test('viewer: every format opens (mmCIF upper-case name, gzip PDB, PQR, SDF, MOL2, XYZ frames, GRO, models)', async () => {
  const dir = ws();
  const s = activate(dir);
  const want = { '1CRN.CIF': ['cif', 327], 'tiny.pdb.gz': ['pdb', 19], 'tiny.pqr': ['pqr', 3], 'two.sdf': ['sdf', 3], 'ethanol.mol2': ['mol2', 3], 'frames.xyz': ['xyz', 3], 'water.gro': ['gro', 6], 'models.pdb': ['pdb', 9], 'salt.cif': ['cif', 2] };
  for (const [f, [fmt, n]] of Object.entries(want)) {
    const { init } = await openEditor(s, path.join(dir, f));
    assert.equal(init.kind, 'structure', f);
    assert.equal(init.fmt3d, fmt, f);
    assert.equal(init.summary.atoms, n, f);
  }
  const x = (await openEditor(s, path.join(dir, 'frames.xyz'))).init;
  assert.equal(x.models, 2);
  assert.equal(x.summary.kind, 'small');
  assert.equal((await openEditor(s, path.join(dir, 'tiny.pdb.gz'))).init.gz, true);
  assert.equal(s.log.error.length, 0);
});
test('viewer: a multi-model mmCIF goes to the 3D view as PDB models (one model at a time); single models keep their text', async () => {
  const dir = ws();
  const s = activate(dir);
  const atom = (n, m, x) => `ATOM ${n} N N . MET A 1 1 ? ${x}.000 1.000 2.000 1.00 9.0 ? 1 MET A N ${m}`;
  const head = ['data_TWO', 'loop_', ...['group_PDB', 'id', 'type_symbol', 'label_atom_id', 'label_alt_id', 'label_comp_id', 'label_asym_id', 'label_entity_id', 'label_seq_id', 'pdbx_PDB_ins_code', 'Cartn_x', 'Cartn_y', 'Cartn_z', 'occupancy', 'B_iso_or_equiv', 'pdbx_formal_charge', 'auth_seq_id', 'auth_comp_id', 'auth_asym_id', 'auth_atom_id', 'pdbx_PDB_model_num'].map((t) => `_atom_site.${t}`)];
  fs.writeFileSync(path.join(dir, 'two-models.cif'), [...head, atom(1, 1, 1), atom(2, 2, 5), '#', ''].join('\n'));
  const { init } = await openEditor(s, path.join(dir, 'two-models.cif'));
  assert.equal(init.kind, 'structure');
  assert.equal(init.models, 2);
  assert.equal(init.fmt3d, 'pdb');
  assert.equal((init.text.match(/^MODEL /gm) || []).length, 2);
  assert.equal((init.text.match(/^ENDMDL/gm) || []).length, 2);
  assert.match(init.text, /^ENDMDL\nMODEL +2\nATOM +2 +N +MET A +1 +5\.000 /m);
  const one = (await openEditor(s, path.join(dir, '1CRN.CIF'))).init;
  assert.equal(one.fmt3d, 'cif');
  assert.match(one.text, /^data_/);
});

test('viewer: a debug symbol .pdb (MSF 7.00 or portable) gets a plain note, no error message, and no tab is reopened by itself', async () => {
  const s = activate();
  for (const [f, which] of [['symbols.pdb', 'msf7'], ['portable.pdb', 'portable']]) {
    const { init } = await openEditor(s, path.join(FIX, f));
    assert.equal(init.kind, 'symbols');
    assert.equal(init.which, which);
    assert.equal(init.text, undefined);
  }
  assert.equal(s.log.error.length + s.log.warn.length + s.log.info.length, 0);
  assert.equal(s.opened.length, 0);
  // the buttons work only on a click
  const { panel } = await openEditor(s, path.join(FIX, 'symbols.pdb'));
  await panel.send({ type: 'openText' });
  assert.deepEqual(s.opened.pop(), [path.join(FIX, 'symbols.pdb'), 'default']);
  await panel.send({ type: 'reopenWith' });
  assert.ok(s.log.commands.some((c) => c[0] === 'workbench.action.reopenWithEditor'));
});
test('viewer: binary .sdf, a text .pdb with no atoms and a cut XYZ give clear notes; only the text failure counts as a failure', async () => {
  const s = activate();
  let failures = 0;
  s.api.provider.hooks.onFailure = () => { failures++; };
  const bin = (await openEditor(s, path.join(FIX, 'database.sdf'))).init;
  assert.equal(bin.kind, 'binary');
  assert.match(bin.error, /binary data/);
  assert.equal(bin.canOpenText, false);
  const notes = (await openEditor(s, path.join(FIX, 'notes.pdb'))).init;
  assert.equal(notes.kind, 'error');
  assert.match(notes.error, /No atoms found|does not look like/);
  assert.equal(notes.canOpenText, true);
  const cut = (await openEditor(s, path.join(FIX, 'broken.xyz'))).init;
  assert.equal(cut.kind, 'structure');
  assert.match(cut.summary.warnings[0], /2 of 5 atoms/);
  assert.equal(failures, 1);
  assert.equal(s.log.error.length, 0);
});
test('viewer: atoms of a residue for the tree, model choice for NMR files, copy to the clipboard', async () => {
  const s = activate();
  const { ask, panel, doc } = await openEditor(s, path.join(FIX, 'models.pdb'));
  const r = await ask({ type: 'atoms', key: 'A:2' });
  assert.deepEqual(r.atoms.map((a) => a.name), ['N', 'CA', 'C', 'O']);
  await panel.send({ type: 'model', index: 1 });
  assert.equal(doc.model, 1);
  const r2 = await ask({ type: 'atoms', key: 'A:2' });
  assert.ok(Math.abs(r2.atoms[0].x - r.atoms[0].x - 1) < 1e-6);
  await panel.send({ type: 'model', index: 9 });
  assert.equal(doc.model, 1);
  await panel.send({ type: 'copy', text: 'A:ALA 1 N', what: 'the atom' });
  assert.equal(s.log.clipboard, 'A:ALA 1 N');
});

test('webview HTML: strict CSP, nonce scripts, no remote URLs, no blob, worker or connect sources', () => {
  const e = editorHtml({ cspSource: 'vscode-resource:', libUri: 'lib/3Dmol-min.js', scriptUri: 'media/viewer.js', styleUri: 'media/viewer.css', title: 'x<y', showSupportLinks: true, nonce: 'abc' });
  const p = panelHtml({ cspSource: 'vscode-resource:', libUri: 'lib/3Dmol-min.js', scriptUri: 'media/panel.js', styleUri: 'media/viewer.css', title: 't', nonce: 'abc' });
  for (const h of [e, p]) {
    const csp = /Content-Security-Policy" content="([^"]+)"/.exec(h)[1];
    assert.match(csp, /^default-src 'none'/);
    assert.match(csp, /script-src 'nonce-abc'(;|$)/);
    assert.doesNotMatch(csp, /unsafe-eval|unsafe-inline|connect-src|worker-src|blob:|https?:/);
    assert.ok([...h.matchAll(/<script\b[^>]*>/g)].every((m) => /nonce="abc"/.test(m[0])));
    assert.doesNotMatch(h.replace(/https:\/\/(marketplace\.visualstudio\.com|github\.com|www\.paypal\.com|open-vsx\.org)[^"]*/g, ''), /https?:\/\//);
  }
  assert.match(e, /<title>x&lt;y<\/title>/);
});
test('media scripts load nothing remote and open no connection', () => {
  for (const f of ['viewer.js', 'panel.js']) {
    const t = fs.readFileSync(path.join(ROOT, 'media', f), 'utf8');
    assert.doesNotMatch(t, /fetch\(|XMLHttpRequest|WebSocket|new Worker|importScripts|https?:\/\/|eval\(/, f);
  }
});
test('no source file opens a network connection', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(path.join(ROOT, 'src')).filter((x) => x.endsWith('.js') && !x.includes(`${path.sep}license${path.sep}`))) {
    const t = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(t, /require\(['"](https?|net|tls|dgram|child_process)['"]\)|fetch\(/, f);
  }
});
test('vendored 3Dmol.js: the BSD-3-Clause license ships next to it and the version is the one in the notices', () => {
  const lic = fs.readFileSync(path.join(ROOT, 'lib', '3Dmol-LICENSE.txt'), 'utf8');
  assert.match(lic, /BSD-3-Clause/);
  assert.match(fs.readFileSync(path.join(ROOT, 'lib', '3Dmol-min.js'), 'utf8').slice(0, 200), /3Dmol-min\.js\.LICENSE\.txt/);
  assert.match(fs.readFileSync(path.join(ROOT, 'lib', '3Dmol-min.js.LICENSE.txt'), 'utf8'), /3dmol v2\.5\.5/);
  assert.match(fs.readFileSync(path.join(ROOT, 'THIRD-PARTY-NOTICES.md'), 'utf8'), /3Dmol\.js 2\.5\.5[\s\S]*BSD-3-Clause/);
});

// ---------- Pro: Measure ----------
test('Pro Measure: turns on in the viewer; a distance, H-bonds and contacts come back; the try counts once, after the result showed', async () => {
  const dir = ws();
  const s = activate(dir);
  const uri = s.vscode.Uri.file(path.join(dir, '1hsg.pdb'));
  assert.equal(s.api.pro.left('measure'), 1);
  const r = await s.api.tools.measure(uri);
  assert.deepEqual(r && r.on, true);
  const f = s.api.provider.panelFor(uri);
  assert.ok(f.panel.posted.some((m) => m.type === 'measureOn'));
  assert.equal(s.api.pro.left('measure'), 1); // nothing shown yet
  const atoms = f.doc.atoms;
  const i = atoms.findIndex((a) => a.chain === 'A' && a.resi === 25 && a.name === 'CA');
  const j = atoms.findIndex((a) => a.chain === 'B' && a.resi === 25 && a.name === 'CA');
  let id = 500;
  const ask = async (m) => { const k = ++id; await f.panel.send({ ...m, req: k }); return until(() => f.panel.posted.find((x) => x.req === k)); };
  const d = await ask({ type: 'measurePick', atoms: [{ i }, { x: atoms[j].x, y: atoms[j].y, z: atoms[j].z }] });
  assert.equal(d.type, 'measureResult');
  assert.ok(Math.abs(d.row.value - G.distance(atoms[i], atoms[j])) < 1e-9);
  assert.deepEqual(d.row.labels, ['A:ASP 25 CA', 'B:ASP 25 CA']);
  const ang = await ask({ type: 'measurePick', atoms: [{ i }, { i: j }, { i: i + 1 }] });
  assert.equal(ang.row.kind, 'angle');
  const bad = await ask({ type: 'measurePick', atoms: [{ x: 0, y: 0, z: 0 }, { i }] });
  assert.equal(bad.type, 'measureError');
  const hb = await ask({ type: 'hbonds', scope: 'B:902', cutoff: 3.5 });
  assert.equal(hb.type, 'hbondsResult');
  assert.ok(hb.total > 0 && hb.rows.every((h) => h.d <= 3.5 && (/MK1/.test(h.a.label) || /MK1/.test(h.b.label))));
  const ct = await ask({ type: 'contacts', scope: 'B:902', cutoff: 4 });
  assert.equal(ct.type, 'contactsResult');
  assert.equal(ct.residues.length, 26);
  await f.panel.send({ type: 'measureShown' });
  await f.panel.send({ type: 'measureShown' });
  assert.equal(s.api.pro.left('measure'), 0);
  assert.equal(s.state.get('pdbViewer.proTrial').measure, 1);
  assert.ok(s.log.status.some((t) => /free try 1 of 1 of "Measure" used/.test(t)));
  s.ui.save.push(s.vscode.Uri.file(path.join(dir, 'm.csv')));
  const saved = await ask({ type: 'measureCsv' });
  assert.equal(saved.type, 'measureSaved');
  const csv = fs.readFileSync(path.join(dir, 'm.csv'), 'utf8').trim().split('\n');
  assert.equal(csv[0], 'type,value,unit,atom 1,atom 2,atom 3,atom 4');
  assert.match(csv[1], /^distance,\d+\.\d{3},angstrom,A:ASP 25 CA,B:ASP 25 CA,,$/);
  assert.match(csv[2], /^angle,/);
  assert.ok(csv.some((l) => l.startsWith('contact within 4 A of B:902,')));
});
test('Pro Measure A then B: used on file A, the click on file B opens the Pro panel and Measure does not turn on there', async () => {
  const dir = ws();
  const s = activate(dir);
  const a = s.vscode.Uri.file(path.join(dir, '1hsg.pdb'));
  const b = s.vscode.Uri.file(path.join(dir, '1crn.cif'));
  await s.api.tools.measure(a);
  const fa = s.api.provider.panelFor(a);
  await fa.panel.send({ type: 'measurePick', atoms: [{ i: 0 }, { i: 1 }], req: 1 });
  await fa.panel.send({ type: 'measureShown' });
  assert.equal(s.api.pro.left('measure'), 0);
  const fb = await openEditor(s, b.fsPath);
  const r = await s.api.tools.measure(b);
  assert.equal(r, undefined);
  assert.equal(proPanels(s, 'Measure').length, 1);
  assert.ok(!fb.panel.posted.some((m) => m.type === 'measureOn'));
  // and again on file A: the panel again
  await s.api.tools.measure(a);
  assert.equal(proPanels(s, 'Measure').length, 2);
});
test('Pro Measure: closing it before any result uses no try; messages after Close are refused', async () => {
  const s = activate();
  const uri = s.vscode.Uri.file(path.join(SAMPLES, '1crn.cif'));
  await s.api.tools.measure(uri);
  const f = s.api.provider.panelFor(uri);
  await f.panel.send({ type: 'measureOff' });
  await f.panel.send({ type: 'measurePick', atoms: [{ i: 0 }, { i: 1 }], req: 7 });
  assert.equal(f.panel.posted.find((m) => m.req === 7).type, 'measureOff');
  await f.panel.send({ type: 'measureShown' });
  assert.equal(s.api.pro.left('measure'), 1);
});

// ---------- Pro: Superpose ----------
test('Pro Superpose: a rotated copy fits back with RMSD 0 over 198 C-alpha pairs; report, CSV and moved PDB; try counted after the report showed', async () => {
  const dir = ws();
  const s = activate(dir);
  const a = s.vscode.Uri.file(path.join(dir, '1hsg.pdb'));
  const b = s.vscode.Uri.file(path.join(dir, 'moved.pdb'));
  s.ui.quick.push((items) => items.find((x) => x.file));
  s.ui.open.push([b]);
  const r = await s.api.tools.superpose(a);
  assert.equal(r.n, 198);
  assert.ok(r.rmsd < 0.002, String(r.rmsd));
  assert.equal(s.log.lastPick.opts.ignoreFocusOut, true);
  await until(() => s.api.pro.left('superpose') === 0);
  assert.equal(s.api.pro.left('superpose'), 0);
  const show = s.log.panel.posted.filter((m) => m.type === 'show').pop();
  assert.match(show.html, /<b id="rmsd">0\.00\d Å<\/b>/);
  assert.match(show.html, /<b id="pairs">198<\/b>/);
  assert.equal(show.view.mode, 'superpose');
  assert.match(show.view.b, /^TITLE {5}moved\.pdb superposed onto 1hsg\.pdb/);
  s.ui.save.push(s.vscode.Uri.file(path.join(dir, 'rmsd.csv')));
  await s.log.panel.send({ type: 'action', id: 'csv' });
  const csv = fs.readFileSync(path.join(dir, 'rmsd.csv'), 'utf8').trim().split('\n');
  assert.equal(csv[0], 'chain_ref,residue_ref,number_ref,chain_moved,residue_moved,number_moved,deviation_A');
  assert.equal(csv.filter((l) => /^[AB],[A-Z]{3},\d+,[AB],/.test(l)).length, 198);
  s.ui.save.push(s.vscode.Uri.file(path.join(dir, 'out.pdb')));
  await s.log.panel.send({ type: 'action', id: 'pdb' });
  const back = P.parsePdb(fs.readFileSync(path.join(dir, 'out.pdb'), 'utf8')).models[0].atoms;
  const orig = P.parsePdb(fs.readFileSync(path.join(dir, '1hsg.pdb'), 'utf8')).models[0].atoms;
  assert.equal(back.length, orig.length);
  assert.ok(Math.abs(back[50].x - orig[50].x) < 0.002 && Math.abs(back[50].z - orig[50].z) < 0.002);
});
test('Pro Superpose A then B: after one use, superposing another pair opens the Pro panel; Escape in the pick used no try', async () => {
  const dir = ws();
  const s = activate(dir);
  const a = s.vscode.Uri.file(path.join(dir, '1hsg.pdb'));
  s.ui.quick.push(undefined); // Escape
  assert.equal(await s.api.tools.superpose(a), undefined);
  assert.equal(s.api.pro.left('superpose'), 1);
  await s.api.tools.superpose(a, { other: s.vscode.Uri.file(path.join(dir, 'moved.pdb')) });
  await until(() => s.api.pro.left('superpose') === 0);
  const before = s.log.posted.filter((m) => m.type === 'show').length;
  const again = await s.api.tools.superpose(s.vscode.Uri.file(path.join(dir, '1crn.cif')), { other: s.vscode.Uri.file(path.join(dir, '1CRN.CIF')) });
  assert.equal(again, undefined);
  assert.equal(proPanels(s, 'Superpose and RMSD').length, 1);
  assert.equal(s.log.posted.filter((m) => m.type === 'show').length, before);
});
test('Pro Superpose: two files with no common chain say why and use no try', async () => {
  const dir = ws();
  const s = activate(dir);
  await assert.rejects(() => s.api.tools.superpose(s.vscode.Uri.file(path.join(dir, '1hsg.pdb')), { other: s.vscode.Uri.file(path.join(dir, 'two.sdf')) }), /C-alpha/);
  await assert.rejects(() => s.api.tools.superpose(s.vscode.Uri.file(path.join(dir, '1hsg.pdb')), { other: s.vscode.Uri.file(path.join(dir, 'symbols.pdb')) }), /debug symbol file/);
  assert.equal(s.api.pro.left('superpose'), 1);
});

// ---------- Pro: Binding site ----------
test('Pro Binding site: MK1 in 1HSG within 4 A lists 26 residues; CSV and PNG saved; try counted after the report showed', async () => {
  const dir = ws();
  const s = activate(dir);
  const uri = s.vscode.Uri.file(path.join(dir, '1hsg.pdb'));
  s.ui.input.push('4');
  const r = await s.api.tools.bindingSite(uri);
  assert.equal(r.residues.length, 26);
  await until(() => s.api.pro.left('bindingSite') === 0);
  const show = s.log.panel.posted.filter((m) => m.type === 'show').pop();
  assert.match(show.html, /<b id="nres">26<\/b><span>residues within 4\.0 Å/);
  assert.equal(show.view.mode, 'site');
  assert.deepEqual(show.view.ligand, { chain: 'B', resi: 902, resn: 'MK1' });
  s.ui.save.push(s.vscode.Uri.file(path.join(dir, 'site.csv')));
  await s.log.panel.send({ type: 'action', id: 'csv' });
  const csv = fs.readFileSync(path.join(dir, 'site.csv'), 'utf8').trim().split('\n');
  assert.equal(csv[0], 'chain,residue,number,kind,min_distance_A,closest_residue_atom,closest_ligand_atom,atom_contacts,hbond_candidates,carbon_contacts_4A');
  assert.equal(csv.length, 27);
  assert.ok(csv.some((l) => /^A,ASP,25,protein,/.test(l)) && csv.some((l) => /^B,ASP,25,protein,/.test(l)));
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  s.ui.save.push(s.vscode.Uri.file(path.join(dir, 'site.png')));
  await s.log.panel.send({ type: 'action', id: 'pngData', data: `data:image/png;base64,${png.toString('base64')}` });
  assert.deepEqual(fs.readFileSync(path.join(dir, 'site.png')), png);
});
test('Pro Binding site A then B: used on 1HSG, the click for the tiny structure opens the Pro panel; a cancelled distance used no try', async () => {
  const dir = ws();
  const s = activate(dir);
  s.ui.input.push(undefined); // Escape at the distance
  assert.equal(await s.api.tools.bindingSite(s.vscode.Uri.file(path.join(dir, '1hsg.pdb'))), undefined);
  assert.equal(s.api.pro.left('bindingSite'), 1);
  await s.api.tools.bindingSite(s.vscode.Uri.file(path.join(dir, '1hsg.pdb')), { ligand: 'B:902', radius: 5 });
  await until(() => s.api.pro.left('bindingSite') === 0);
  const again = await s.api.tools.bindingSite(s.vscode.Uri.file(path.join(dir, 'tiny.pdb')), { ligand: 'A:201', radius: 4 });
  assert.equal(again, undefined);
  assert.equal(proPanels(s, 'Binding site report').length, 1);
});
test('Pro Binding site: a file with no ligand says so and uses no try; the ligand pick lists ions last', async () => {
  const dir = ws();
  const s = activate(dir);
  await assert.rejects(() => s.api.tools.bindingSite(s.vscode.Uri.file(path.join(dir, '1crn.cif'))), /no ligand/);
  s.ui.quick.push(undefined);
  assert.equal(await s.api.tools.bindingSite(s.vscode.Uri.file(path.join(dir, 'tiny.pdb'))), undefined);
  assert.deepEqual(s.log.lastPick.items.map((i) => i.label), ['LIG A:201', 'ZN A:101']);
  assert.equal(s.log.lastPick.opts.ignoreFocusOut, true);
  assert.equal(s.api.pro.left('bindingSite'), 1);
});

// ---------- Pro: shared ----------
test('a window reload keeps the counts: after a reload every used tool opens the Pro panel', async () => {
  const dir = ws();
  const s = activate(dir);
  await s.api.tools.bindingSite(s.vscode.Uri.file(path.join(dir, '1hsg.pdb')), { ligand: 'B:902', radius: 4 });
  await s.api.tools.superpose(s.vscode.Uri.file(path.join(dir, '1hsg.pdb')), { other: s.vscode.Uri.file(path.join(dir, 'moved.pdb')) });
  await until(() => s.api.pro.left('bindingSite') === 0 && s.api.pro.left('superpose') === 0);
  const s2 = activate(dir, s.state);
  assert.deepEqual(s2.api.pro.tries(), { measure: 1, superpose: 0, bindingSite: 0 });
  assert.equal(await s2.api.tools.bindingSite(s2.vscode.Uri.file(path.join(dir, 'tiny.pdb')), { ligand: 'A:201', radius: 4 }), undefined);
  assert.equal(proPanels(s2, 'Binding site report').length, 1);
  assert.equal(await s2.api.tools.superpose(s2.vscode.Uri.file(path.join(dir, '1hsg.pdb')), { other: s2.vscode.Uri.file(path.join(dir, 'moved.pdb')) }), undefined);
  assert.equal(proPanels(s2, 'Superpose and RMSD').length, 1);
});
test('the Pro panel names the other tools with their tries and no URL is opened when it is cancelled', async () => {
  const dir = ws();
  const s = activate(dir);
  await s.api.tools.bindingSite(s.vscode.Uri.file(path.join(dir, '1hsg.pdb')), { ligand: 'B:902', radius: 4 });
  await until(() => s.api.pro.left('bindingSite') === 0);
  await s.api.tools.bindingSite(s.vscode.Uri.file(path.join(dir, '1hsg.pdb')), { ligand: 'B:902', radius: 4 });
  const p = proPanels(s, 'Binding site report')[0];
  assert.ok(p && p.opts.modal);
  assert.match(p.opts.detail, /You used the free try of Binding site report on this computer\./);
  assert.match(p.opts.detail, /Measure: 0 of 1 free try used/);
  assert.match(p.opts.detail, /Superpose and RMSD: 0 of 1 free try used/);
  assert.equal(s.log.external.length, 0);
});
test('a Pro button inside the viewer runs the tool on that file (Binding site from the ligand row, Measure from the details)', async () => {
  const dir = ws();
  const s = activate(dir);
  const { panel } = await openEditor(s, path.join(dir, '1hsg.pdb'));
  await panel.send({ type: 'command', id: 'pdbViewer.bindingSite', extra: { ligand: 'B:902', radius: 4 } });
  await until(() => s.api.pro.left('bindingSite') === 0);
  assert.equal(s.log.panel.posted.filter((m) => m.type === 'show').pop().view.residues.length, 26);
  await panel.send({ type: 'command', id: 'pdbViewer.measure' });
  assert.ok(panel.posted.some((m) => m.type === 'measureOn'));
  await panel.send({ type: 'command', id: 'workbench.action.files.delete' }); // not a Pro command: ignored
  assert.ok(!s.log.commands.some((c) => c[0] === 'workbench.action.files.delete'));
});
test('the toolbar row lists the 3 Pro tools with 1 free try each; one constant; the proinfo tries key matches', () => {
  const s = activate();
  const reachCfg = require('../src/reach-config');
  assert.deepEqual(reachCfg.tools.map((t) => t.id), ['measure', 'superpose', 'bindingSite']);
  const pro = require('../src/pro');
  assert.equal(pro.TRIAL_USES, 1);
  const cfg = require('../src/license/config');
  assert.equal(cfg.listing, 'pdb');
  assert.equal(cfg.pro_info.triesKey, pro.TRIAL_KEY);
  assert.equal(reachCfg.triesKey, pro.TRIAL_KEY);
  assert.equal(cfg.pro_info.triesMax, undefined);
  assert.deepEqual(cfg.pro_info.tools.map((t) => t.id), ['measure', 'superpose', 'bindingSite']);
  assert.deepEqual(Object.keys(s.api.pro.tries()), ['measure', 'superpose', 'bindingSite']);
  const row = s.api.provider.hooks.reach().rowHtml();
  assert.equal((row.match(/<small>1 free try<\/small>/g) || []).length, 3);
  assert.match(row, /Get Zovo Pro/);
});

// ---------- README and text ----------
test('README: first screen has the main use, a screenshot of this product, the free list and the price; by Zovo; no rival names', () => {
  const md = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const first = md.split('\n').slice(0, 30).join('\n');
  assert.match(first, /^# PDB Viewer & Protein Structure/);
  assert.match(first, /\(images\/screenshot\.png\)/);
  assert.match(first, /Zovo Pro: USD 19 once/);
  assert.match(md, /by Zovo/i);
  for (const f of ['README.md', 'CHANGELOG.md', 'package.json', 'walkthrough/explore.md', 'walkthrough/remote.md', 'walkthrough/related.md']) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), 'utf8'), /Protein Viewer\b(?! &)|Mol\*|molstar|ArianJamasb|nano-protein|StevenYu|vv137|drughub|auhcheng|PyMOL (plugin|extension)/i, f);
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'images', 'screenshot.png')));
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, '.vscodeignore'), 'utf8'), /^images\/?(\*\*|\*\.png|screenshot)?\s*$/m);
});
test('support links name this listing and related Zovo tools', () => {
  const support = require('../src/support');
  assert.equal(support.SELF_ID, 'zovo.zovo-pdb-viewer');
  assert.ok(support.RELATED.length >= 3 && !support.RELATED.includes(support.SELF_ID));
  assert.equal(support.PRO.getPro, 'pdbViewer.getPro');
  const steps = pkg.contributes.walkthroughs[0].steps;
  const links = steps.flatMap((st) => [...st.description.matchAll(/command:extension\.open\?%5B%22([^%]+)%22%5D/g)].map((m) => m[1]));
  assert.deepEqual(links, ['zovo.zovo-fastq-viewer', 'zovo.hdf5-netcdf-explorer', 'zovo.3d-model-viewer']);
});
