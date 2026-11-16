'use strict';
// Zovo Pro for the PDB Viewer, on top of the shared license module (src/license, copied unchanged from
// factory/sprint/license by apply.sh). Three Pro tools, 1 free try each on this computer. A try counts only after the
// tool showed its result (the first measurement, H-bond or contact list drawn; the superposition report drawn; the
// binding site report drawn); Escape, Cancel or an error never uses one. Every click on a Pro tool checks the count
// again, whatever the file: the 2nd use opens the Pro panel, on the same file or another one.
// Nothing about Pro shows on open or activation: the panel appears only after a click on a Pro tool with no tries left.
const { createLicense } = require('./license');
const { currentSurface } = require('./reach');

const SKU = 'pdb-viewer-pro';
// OWNER DECISION 15 Nov (TRIES1): 1 free try per Pro tool. The only place this listing sets the number.
const TRIAL_USES = 1;
const TRIAL_KEY = 'pdbViewer.proTrial';

const FEATURES = {
  measure: {
    title: 'Measure',
    detail: 'Distances, angles and dihedrals by clicking atoms, hydrogen bond candidates and contacts within a distance you choose, drawn in the 3D view and saved as CSV.',
  },
  superpose: {
    title: 'Superpose and RMSD',
    detail: 'Fits a second structure onto this one on sequence-matched C-alpha atoms and reports the RMSD overall, per chain and per residue, with both models overlaid in 3D, a CSV table and the moved structure as PDB.',
  },
  bindingSite: {
    title: 'Binding site report',
    detail: 'Lists the residues within a distance of a ligand with the closest atoms, contact counts and hydrogen bond candidates, shows a focused 3D view, and saves the table as CSV and the view as PNG.',
  },
};
const TOOLS = Object.values(FEATURES).map((f) => f.title);

function surfaceOf(arg) {
  const s = currentSurface();
  if (s) return s;
  if (arg && typeof arg === 'object' && typeof arg.surface === 'string') return arg.surface;
  return undefined;
}

function createPro({ vscode, context, license, prefix = 'pdbViewer', productName = 'PDB Viewer' }) {
  const emitter = new vscode.EventEmitter();
  const lic = license || createLicense({ vscode, context, sku: SKU, name: 'Zovo', product: productName, commandPrefix: prefix, proTools: TOOLS });
  if (lic.onDidChange) lic.onDidChange(() => emitter.fire(lic.isPro(SKU)));

  // Counts never go down in a session: globalState can hand back an older value for a moment after a write, so the
  // highest count seen here wins.
  const seen = {};
  const used = (f) => Math.max(Number((context.globalState.get(TRIAL_KEY) || {})[f]) || 0, seen[f] || 0);
  const left = (f) => (FEATURES[f] ? Math.max(0, TRIAL_USES - used(f)) : 0);
  const licensed = () => lic.isPro(SKU);

  /** Before a Pro tool runs: true when it may run (licensed, or a free try left). Otherwise the one panel. */
  async function allowed(f, arg) {
    if (licensed()) { if (lic.refresh) lic.refresh(); return true; }
    if (left(f) > 0) return true;
    const feat = FEATURES[f] || { title: 'This tool', detail: '' };
    const surface = surfaceOf(arg);
    return !!(await lic.requirePro(feat.title, { detail: feat.detail, toolId: f, triesUsed: used(f), ...(surface ? { surface } : {}) }));
  }

  /** After the tool showed its result: counts one free try (nothing when licensed). */
  async function produced(f) {
    if (licensed() || !FEATURES[f]) return;
    const m = { ...(context.globalState.get(TRIAL_KEY) || {}) };
    for (const k of Object.keys(seen)) m[k] = Math.max(Number(m[k]) || 0, seen[k]);
    m[f] = used(f) + 1;
    seen[f] = m[f];
    await context.globalState.update(TRIAL_KEY, m);
    const l = left(f);
    vscode.window.setStatusBarMessage(`Zovo Pro: free try ${used(f)} of ${TRIAL_USES} of "${FEATURES[f].title}" used${l ? `, ${l} left` : ''} on this computer.`, 8000);
    emitter.fire(false);
  }

  context.subscriptions.push(emitter);
  return {
    SKU, FEATURES, TRIAL_USES,
    get licensed() { return licensed(); },
    ready: lic.ready,
    allowed, produced, left, used,
    tries: () => Object.fromEntries(Object.keys(FEATURES).map((f) => [f, left(f)])),
    handleUri: (uri) => (lic.handleUri ? lic.handleUri(uri) : undefined),
    onDidChange: emitter.event,
    license: lic,
  };
}

module.exports = { createPro, FEATURES, SKU, TRIAL_USES, TRIAL_KEY, TOOLS, surfaceOf };
