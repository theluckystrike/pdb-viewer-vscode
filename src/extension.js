'use strict';
// PDB Viewer & Protein Structure by Zovo: opens PDB, mmCIF, PQR, SDF/MOL, MOL2, XYZ and GRO files as a 3D model.
// No network, no telemetry. Activation shows nothing: no message, no popup. The viewer opens only for files the user
// opens, and it never reopens a tab in another editor by itself.
const vscode = require('vscode');
const { StructEditorProvider, VIEW_TYPE } = require('./editor');
const { createTools } = require('./tools');
const { createPro } = require('./pro');
const { createRatingPrompt } = require('./rate');
const support = require('./support');
const { createReach, runAs } = require('./reach');
const reachConfig = require('./reach-config');

const PREFIX = 'pdbViewer';
const EXT_ID = 'zovo.zovo-pdb-viewer';
const setting = (k, d) => vscode.workspace.getConfiguration(PREFIX).get(k, d);

function activate(context) {
  const sub = (d) => context.subscriptions.push(d);
  let rating = { success() {}, failure() {} };
  try { rating = createRatingPrompt({ vscode, context, extensionId: EXT_ID, section: PREFIX, name: 'PDB Viewer' }); } catch (e) { /* rating is optional */ }
  support.registerSupport({ vscode, context, prefix: PREFIX, selfId: EXT_ID });
  const pro = createPro({ vscode, context });
  const reach = createReach({ vscode, ...reachConfig, maximum: pro.TRIAL_USES, context, licensed: () => !!pro.licensed, shown: () => setting('showProTools', true) !== false });
  reach.registerCtx();
  sub(pro.onDidChange(() => reach.refresh()));

  let tools = null;
  const provider = new StructEditorProvider(context, {
    reach: () => reach,
    onSuccess: (doc) => rating.success(doc.uri),
    onFailure: () => rating.failure(),
    // a Pro button inside the viewer (Measure in the details, Binding site on a ligand row): tagged toolbar
    runTool: (name, uri, extra) => runAs('toolbar', () => (name === 'measure' ? tools.measure(uri) : name === 'superpose' ? tools.superpose(uri, extra) : tools.bindingSite(uri, extra))).catch((e) => vscode.window.showErrorMessage(String((e && e.message) || e))),
    onToolMessage: (doc, panel, m) => tools.onToolMessage(doc, panel, m),
  });
  sub(vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: true }));
  sub(provider);
  tools = createTools({ context, provider, pro, reach });

  const reg = (id, fn) => sub(vscode.commands.registerCommand(id, async (...a) => {
    try { return await fn(...a); } catch (e) { vscode.window.showErrorMessage(String((e && e.message) || e)); return undefined; }
  }));
  const target = (uri) => (uri && uri.scheme ? uri : undefined);
  const sample = (name) => vscode.Uri.joinPath(context.extensionUri, 'samples', name);
  reg(`${PREFIX}.openWithViewer`, (uri) => {
    const u = uri && uri.scheme ? uri : (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri);
    if (!u) { vscode.window.showInformationMessage('Select a PDB, mmCIF, SDF, MOL2, XYZ, GRO or PQR file first.'); return undefined; }
    return vscode.commands.executeCommand('vscode.openWith', u, VIEW_TYPE);
  });
  reg(`${PREFIX}.openAsText`, (uri) => {
    const u = uri && uri.scheme ? uri : (provider.active && provider.active.uri);
    return u ? vscode.commands.executeCommand('vscode.openWith', u, 'default') : undefined;
  });
  reg(`${PREFIX}.openSample`, () => vscode.commands.executeCommand('vscode.openWith', sample('1hsg.pdb'), VIEW_TYPE));
  reg(`${PREFIX}.openSampleCif`, () => vscode.commands.executeCommand('vscode.openWith', sample('1crn.cif'), VIEW_TYPE));
  reg(`${PREFIX}.openWalkthrough`, () => vscode.commands.executeCommand('workbench.action.openWalkthrough', `${EXT_ID}#${PREFIX}.start`, false));
  reg(`${PREFIX}.measure`, reach.wrap((uri) => tools.measure(target(uri))));
  reg(`${PREFIX}.superpose`, reach.wrap((uri, extra) => tools.superpose(target(uri), extra && !extra.scheme && !Array.isArray(extra) ? extra : {})));
  reg(`${PREFIX}.bindingSite`, reach.wrap((uri, extra) => tools.bindingSite(target(uri), extra && !extra.scheme && !Array.isArray(extra) ? extra : {})));
  sub(vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration(`${PREFIX}.showProTools`)) reach.refresh(); }));
  sub(vscode.window.registerUriHandler({ handleUri: (uri) => pro.handleUri(uri) }));
  return { provider, tools, pro };
}

function deactivate() {}

module.exports = { activate, deactivate };
