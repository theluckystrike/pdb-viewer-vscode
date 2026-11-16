'use strict';
// Read-only custom editor for structure files. The extension host reads the file through VS Code's file system API
// (so it works the same over Remote SSH, WSL, containers and virtual folders), unzips .gz, reads the structure for the
// tree, the sequence strip and the Pro tools (src/core), and hands the text to the webview, which draws it with
// 3Dmol.js. The webview has no network access (CSP default-src 'none').
// A .pdb that is a Microsoft debug symbol file gets a plain note with buttons to open it elsewhere: no error popup,
// and the viewer never reopens a tab by itself.
const vscode = require('vscode');
const path = require('path');
const { decode } = require('./core/detect');
const P = require('./core/parse');
const M = require('./core/model');
const G = require('./core/geom');
const { editorHtml } = require('./html');
const support = require('./support');

const VIEW_TYPE = 'pdbViewer.editor';
const PREFIX = 'pdbViewer';
const setting = (k, d) => vscode.workspace.getConfiguration(PREFIX).get(k, d);
const PRO_COMMANDS = /^pdbViewer\.(measure|superpose|bindingSite)$/;
const FMT_3D = { pdb: 'pdb', pqr: 'pqr', cif: 'cif', 'cif-small': 'cif', sdf: 'sdf', mol2: 'mol2', xyz: 'xyz', gro: 'gro' };
const FMT_LABEL = { pdb: 'PDB', pqr: 'PQR', cif: 'mmCIF', 'cif-small': 'CIF', sdf: 'SDF/MOL', mol2: 'MOL2', xyz: 'XYZ', gro: 'GRO' };
// Hex editors the symbol-file note can hand a file to, when installed: [extension id, view type, name]
const HEX_EDITORS = [['zovo.zovo-hex-viewer', 'hexViewer.editor', 'Hex Viewer'], ['ms-vscode.hexeditor', 'hexEditor.hexedit', 'Hex Editor']];

/** 3D text for a multi-model mmCIF: the models as PDB MODEL/ENDMDL blocks, so the 3D view shows one model at a time
 * (its mmCIF reader puts every model into one set of atoms). Other files go to the 3D view as they are. */
function text3d(d) {
  if (FMT_3D[d.format] !== 'cif' || d.struct.models.length < 2) return { text: d.text, fmt3d: FMT_3D[d.format] || 'pdb' };
  const out = [];
  d.struct.models.forEach((m, i) => {
    out.push(`MODEL     ${String(i + 1).padStart(4)}`);
    for (const l of G.toPdb(m.atoms).split('\n')) if (/^(ATOM|HETATM)/.test(l)) out.push(l);
    out.push('ENDMDL');
  });
  out.push('END');
  return { text: out.join('\n') + '\n', fmt3d: 'pdb' };
}

function sizeText(n) {
  if (n < 1024) return `${n} bytes`;
  const u = ['KB', 'MB', 'GB']; let v = n / 1024; let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`;
}

/** Reads and parses a structure file. Shared by the viewer and the Pro tools. */
async function loadStructure(uri) {
  const name = path.posix.basename(uri.path);
  const bytes = await vscode.workspace.fs.readFile(uri);
  const out = { uri, name, size: bytes.byteLength, kind: 'error', text: '', struct: null, format: '', error: '' };
  const d = decode(bytes);
  if (d.kind === 'symbols') { out.kind = 'symbols'; out.which = d.which; return out; }
  if (d.kind === 'binary') { out.kind = 'binary'; out.what = d.what; return out; }
  if (d.kind === 'empty') { out.kind = 'empty'; return out; }
  if (d.kind === 'large') { out.kind = 'large'; return out; }
  out.gz = d.gz;
  let format = P.formatByName(name);
  let struct = P.parseStructure(d.text, format);
  if (!struct.models.length) { // the name may be wrong: try what the text looks like
    const sniff = P.sniffFormat(d.text);
    if (sniff && sniff !== format) { const s2 = P.parseStructure(d.text, sniff); if (s2.models.length) { struct = s2; format = sniff; } }
  }
  if (!struct.models.length || !struct.models[0].atoms.length) {
    out.kind = 'error';
    out.error = struct.warnings[0] || `No atoms found. The file does not look like ${FMT_LABEL[format] ? `a ${FMT_LABEL[format]} file` : 'a structure file'}.`;
    return out;
  }
  out.kind = 'structure';
  out.text = d.text;
  out.struct = struct;
  out.format = struct.format;
  return out;
}

class StructDocument {
  constructor(uri) { this.uri = uri; this.panels = new Set(); this.listeners = []; this.model = 0; this.data = null; this.summary = null; this.rendered = null; this.measure = null; }
  get name() { return path.posix.basename(this.uri.path); }
  get atoms() { const s = this.data && this.data.struct; return s ? (s.models[this.model] || s.models[0]).atoms : []; }
  async load() {
    try { this.data = await loadStructure(this.uri); } catch (e) { this.data = { kind: 'error', error: String((e && e.message) || e), name: this.name }; }
    this.summary = this.data.kind === 'structure' ? M.summarize(this.data.struct, 0) : null;
    this.model = 0;
    this.rendered = null;
  }
  dispose() { for (const l of this.listeners) { try { l.dispose(); } catch (e) { /* gone */ } } }
}

class StructEditorProvider {
  constructor(context, hooks = {}) {
    this.context = context;
    this.hooks = hooks;
    this.docs = new Set();
    this.active = null;
    this.activePanel = null;
    this._success = new WeakSet();
    this._waiters = [];
  }
  dispose() { for (const d of this.docs) d.dispose(); this.docs.clear(); }

  async openCustomDocument(uri) {
    const doc = new StructDocument(uri);
    await doc.load();
    this.docs.add(doc);
    try {
      const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.joinPath(uri, '..'), path.posix.basename(uri.path)));
      let timer = null;
      const reload = () => { clearTimeout(timer); timer = setTimeout(async () => { await doc.load(); for (const p of doc.panels) this.init(doc, p.webview); }, 500); };
      doc.listeners.push(w, w.onDidChange(reload), w.onDidCreate(reload));
    } catch (e) { /* no watcher: the view still works */ }
    return { uri, dispose: () => { this.docs.delete(doc); doc.dispose(); if (this.active === doc) this.active = null; }, _doc: doc };
  }

  async resolveCustomEditor(handle, panel) {
    const doc = handle._doc;
    doc.panels.add(panel);
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    const lib = vscode.Uri.joinPath(this.context.extensionUri, 'lib');
    const reach = this.hooks.reach ? this.hooks.reach() : null;
    panel.webview.options = {
      enableScripts: true, localResourceRoots: [media, lib],
      enableCommandUris: (reach ? reach.commandIds() : []).concat(support.commandUris(PREFIX)),
    };
    panel.webview.html = editorHtml({
      cspSource: panel.webview.cspSource,
      libUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(lib, '3Dmol-min.js')).toString(),
      scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'viewer.js')).toString(),
      styleUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'viewer.css')).toString(),
      title: doc.name,
      head: reach ? (n) => reach.headHtml(n) : undefined,
      showSupportLinks: setting('showSupportLinks', true) !== false,
    });
    if (reach) reach.attach(panel.webview, panel);
    const setActive = () => { if (panel.active) { this.active = doc; this.activePanel = panel; } };
    setActive();
    panel.onDidChangeViewState(setActive);
    panel.onDidDispose(() => { doc.panels.delete(panel); if (this.activePanel === panel) { this.activePanel = null; if (this.active === doc) this.active = null; } });
    panel.webview.onDidReceiveMessage(async (m) => {
      if (reach && reach.onMessage(m)) return;
      if (!m || typeof m !== 'object') return;
      try { await this.onMessage(doc, panel, m); } catch (e) { this.send(panel.webview, { type: 'error', req: m.req, message: String((e && e.message) || e) }); }
    });
  }

  send(webview, msg) { try { const r = webview.postMessage(msg); if (r && r.then) r.then(undefined, () => false); } catch (e) { /* disposed */ } }

  settings() {
    return { style: setting('style', 'auto'), color: setting('color', 'auto'), background: setting('background', 'theme'), showPro: setting('showProTools', true) !== false };
  }

  hexEditor() {
    for (const [id, viewType, name] of HEX_EDITORS) { try { if (vscode.extensions.getExtension(id)) return { viewType, name }; } catch (e) { /* none */ } }
    return null;
  }

  init(doc, webview) {
    const d = doc.data || { kind: 'error', error: 'The file could not be read.' };
    const base = { type: 'init', name: doc.name, settings: this.settings(), kind: d.kind };
    if (d.kind === 'symbols') {
      const hex = this.hexEditor();
      this.send(webview, { ...base, which: d.which, hex: hex ? hex.name : '' });
      return;
    }
    if (d.kind !== 'structure') {
      const why = d.kind === 'binary' ? (d.what === 'broken-gzip' ? 'This file starts like a gzip file but could not be unpacked.' : d.what === 'zip' ? 'This file is a ZIP archive, not a structure file.' : 'This file holds binary data, not structure text. A .sdf file can also be a SQL Server Compact database, and a .pdb file a debug symbol file.')
        : d.kind === 'empty' ? 'This file is empty.' : d.kind === 'large' ? 'This file is larger than 512 MB unpacked, which is more than the viewer reads.' : d.error || 'The file could not be read.';
      this.send(webview, { ...base, error: why, canOpenText: d.kind !== 'binary' });
      if (d.kind === 'error' && this.hooks.onFailure) this.hooks.onFailure(doc);
      return;
    }
    this.send(webview, {
      ...base, format: d.format, label: FMT_LABEL[d.format] || d.format, ...text3d(d), gz: !!d.gz,
      size: d.size, sizeText: sizeText(d.size), summary: doc.summary, models: d.struct.models.length,
    });
  }

  /** The panel showing uri (the active one first), or null. */
  panelFor(uri) {
    const key = uri.toString();
    if (this.active && this.active.uri.toString() === key && this.activePanel) return { doc: this.active, panel: this.activePanel };
    for (const d of this.docs) if (d.uri.toString() === key) for (const p of d.panels) return { doc: d, panel: p };
    return null;
  }

  /** Opens uri in this viewer (or shows its tab) and waits until its 3D view is drawn. */
  async openAndWait(uri, ms = 30000) {
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const f = this.panelFor(uri);
      if (f && (f.doc.rendered || (f.doc.data && f.doc.data.kind !== 'structure'))) return f;
      await new Promise((r) => setTimeout(r, 100));
    }
    return this.panelFor(uri);
  }

  async onMessage(doc, panel, m) {
    const w = panel.webview;
    const reply = (o) => this.send(w, { req: m.req, ...o });
    switch (m.type) {
      case 'ready': this.init(doc, w); return;
      case 'rendered':
        doc.rendered = { atoms: Number(m.atoms) || 0, pixels: m.pixels, at: Date.now() };
        if (!this._success.has(doc) && doc.data && doc.data.kind === 'structure') { this._success.add(doc); if (this.hooks.onSuccess) this.hooks.onSuccess(doc); }
        return;
      case 'renderError': if (this.hooks.onFailure) this.hooks.onFailure(doc); return;
      case 'model': {
        const n = doc.data && doc.data.struct ? doc.data.struct.models.length : 1;
        doc.model = Math.max(0, Math.min(n - 1, m.index | 0));
        return;
      }
      case 'atoms': reply({ type: 'atoms', key: String(m.key || ''), atoms: M.residueAtoms(doc.atoms, String(m.key || '')) }); return;
      case 'openText': await vscode.commands.executeCommand('vscode.openWith', doc.uri, 'default'); return;
      case 'openHex': { const h = this.hexEditor(); if (h) await vscode.commands.executeCommand('vscode.openWith', doc.uri, h.viewType); return; }
      case 'reopenWith': this.active = doc; this.activePanel = panel; await vscode.commands.executeCommand('workbench.action.reopenWithEditor'); return;
      case 'copy': if (typeof m.text === 'string') { await vscode.env.clipboard.writeText(m.text.slice(0, 100000)); vscode.window.setStatusBarMessage(`Copied ${m.what || 'the text'}`, 3000); } return;
      case 'command':
        if (typeof m.id === 'string' && PRO_COMMANDS.test(m.id)) {
          this.active = doc; this.activePanel = panel;
          if (this.hooks.runTool) await this.hooks.runTool(m.id.split('.')[1], doc.uri, m.extra && typeof m.extra === 'object' ? m.extra : {});
          else await vscode.commands.executeCommand(m.id, { surface: 'toolbar' });
        }
        return;
      default:
        if (this.hooks.onToolMessage) await this.hooks.onToolMessage(doc, panel, m);
    }
  }
}

module.exports = { StructEditorProvider, StructDocument, loadStructure, VIEW_TYPE, FMT_3D, FMT_LABEL, sizeText, text3d };
