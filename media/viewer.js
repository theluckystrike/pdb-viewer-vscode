// PDB Viewer webview: 3D view (3Dmol.js from lib/), side tree, sequence strip, atom details and the Measure pane.
// It gets the file text from the extension host by message and makes no network request of its own.
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmtNum = (n) => Number(n).toLocaleString('en-US');
  const WATER = ['HOH', 'WAT', 'H2O', 'DOD', 'SOL', 'TIP', 'TIP3', 'TIP4', 'SPC', 'T3P', 'T4P'];
  const NUCLEIC = ['DA', 'DC', 'DG', 'DT', 'DU', 'A', 'C', 'G', 'U', 'T', 'DI', 'I'];
  const POLY_CODE = { H: 'Helix', E: 'Strand' };

  let viewer = null;
  let S = null; // summary from the host
  let init = null;
  let small = false;
  let ligandResn = [];
  let waterOnly = false;
  let selected = null; // residue key
  let selectedAtom = null;
  const st = { style: 'cartoon', color: 'chain', surface: false, ligands: true, water: false, model: 0 };
  let req = 0;
  const pending = new Map();
  const ask = (msg) => new Promise((resolve) => { const id = ++req; pending.set(id, resolve); vscode.postMessage({ ...msg, req: id }); });
  // Measure (Pro): on after the host allowed it
  const ms = { on: false, mode: 2, picks: [], rows: [], shown: false, cutoff: 3.5 };

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || typeof m !== 'object') return;
    if (m.req && pending.has(m.req)) { const f = pending.get(m.req); pending.delete(m.req); f(m); return; }
    switch (m.type) {
      case 'init': onInit(m); break;
      case 'measureOn': measureOn(m); break;
      case 'measureOff': measureOff(); break;
      case 'error': status(m.message, true); break;
      default:
    }
  });

  // ---------------------------------------------------------------- init
  function onInit(m) {
    init = m;
    S = m.summary || null;
    document.body.dataset.kind = m.kind;
    const footer = $('zovo-footer');
    if (footer && !$('footer').childElementCount) $('footer').innerHTML = footer.innerHTML;
    $('openText').onclick = () => vscode.postMessage({ type: 'openText' });
    if (m.kind === 'symbols') { showSymbols(m); return; }
    if (m.kind !== 'structure') { showError(m.error, m.canOpenText); return; }
    small = S.kind === 'small';
    ligandResn = [...new Set(S.ligands.map((l) => l.resn))];
    $('fmt').textContent = `${m.label}${m.gz ? ' (gzip)' : ''} · ${m.sizeText} · ${fmtNum(S.atoms)} atoms${m.models > 1 ? ` · ${m.models} models` : ''}`;
    const polymer = S.residues > 0;
    const s = m.settings || {};
    st.style = s.style && s.style !== 'auto' ? s.style : (small || !polymer ? 'ballstick' : 'cartoon');
    if (st.style === 'cartoon' && !polymer) st.style = 'ballstick';
    st.color = s.color && s.color !== 'auto' ? s.color : (small || !polymer ? 'element' : 'chain');
    const styleSel = $('style');
    [...styleSel.options].forEach((o) => { if (o.value === 'cartoon') o.disabled = !polymer; });
    styleSel.value = st.style;
    $('color').value = st.color;
    [...$('color').options].forEach((o) => { if (o.value === 'bfactor') o.disabled = !S.hasB; if (o.value === 'ss' || o.value === 'chain' || o.value === 'residue') o.disabled = !polymer; });
    $('ligWrap').hidden = small || !S.ligands.length;
    $('watWrap').hidden = !S.waters;
    // a file of only water (a solvent box) shows its waters from the start, in the chosen style
    waterOnly = !small && !polymer && !S.ligands.length && S.waters > 0;
    if (waterOnly) { st.water = true; $('water').checked = true; }
    if (m.models > 1) {
      $('modelWrap').hidden = false;
      $('model').innerHTML = Array.from({ length: m.models }, (_, i) => `<option value="${i}">${i + 1} of ${m.models}</option>`).join('');
    }
    buildViewer(m);
    buildTree();
    buildSeq();
    buildFacts();
    bindToolbar();
  }

  function themeBackground(mode) {
    if (mode === 'black') return '#000000';
    if (mode === 'white') return '#ffffff';
    const v = getComputedStyle(document.body).getPropertyValue('--vscode-editor-background').trim();
    if (/^#[0-9a-f]{6}$/i.test(v)) return v;
    if (/^#[0-9a-f]{3}$/i.test(v)) return '#' + v.slice(1).split('').map((c) => c + c).join('');
    const r = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(v);
    if (r) return '#' + [r[1], r[2], r[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('');
    return '#1e1e1e';
  }
  let bgHex = '#1e1e1e';

  function buildViewer(m) {
    if (typeof $3Dmol === 'undefined') { showError('The 3D view could not start (3Dmol.js did not load).', true); vscode.postMessage({ type: 'renderError' }); return; }
    try { if ($3Dmol.setSyncSurface) $3Dmol.setSyncSurface(true); } catch (e) { /* older build */ }
    bgHex = themeBackground((m.settings || {}).background);
    try {
      viewer = $3Dmol.createViewer($('view'), { backgroundColor: bgHex, antialias: true, id: 'pdbv3d' });
    } catch (e) { viewer = null; }
    if (!viewer) { showError('The 3D view needs WebGL, and this window could not start it. The tree and sequence still work.', true); vscode.postMessage({ type: 'renderError' }); return; }
    const opt = { keepH: true };
    try {
      if (m.models > 1) viewer.addModelsAsFrames(m.text, m.fmt3d, opt); else viewer.addModel(m.text, m.fmt3d, opt);
    } catch (e) {
      showError(`The 3D view could not read this file: ${e && e.message ? e.message : e}`, true);
      vscode.postMessage({ type: 'renderError' });
      return;
    }
    viewer.setClickable({}, true, (atom) => onAtomClick(atom));
    applyStyle();
    viewer.zoomTo();
    viewer.render(() => {});
    setTimeout(() => afterRender(), 60);
    window.addEventListener('resize', () => { if (viewer) { viewer.resize(); viewer.render(); } });
  }

  function canvasPixels() {
    const c = $('view').querySelector('canvas');
    if (!c || !c.width) return { lit: 0, total: 0 };
    const w = Math.min(c.width, 400), h = Math.round((c.height * w) / c.width) || 1;
    const t = document.createElement('canvas'); t.width = w; t.height = h;
    const g = t.getContext('2d');
    g.drawImage(c, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    const br = parseInt(bgHex.slice(1, 3), 16), bgg = parseInt(bgHex.slice(3, 5), 16), bb = parseInt(bgHex.slice(5, 7), 16);
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - br) + Math.abs(d[i + 1] - bgg) + Math.abs(d[i + 2] - bb) > 40) lit++;
    return { lit, total: w * h };
  }

  function afterRender() {
    let atoms = 0;
    try { atoms = viewer.selectedAtoms({}).length; } catch (e) { atoms = 0; }
    const px = canvasPixels();
    document.body.dataset.state = 'ready';
    document.body.dataset.atoms3d = String(atoms);
    document.body.dataset.pixels = String(px.lit);
    vscode.postMessage({ type: 'rendered', atoms, pixels: px.lit });
    status(`${fmtNum(S.atoms)} atoms${S.chains.length ? ` · ${S.chains.length} chain${S.chains.length === 1 ? '' : 's'}` : ''}${S.ligands.length && !small ? ` · ${S.ligands.length} ligand${S.ligands.length === 1 ? '' : 's'}` : ''}${S.waters ? ` · ${fmtNum(S.waters)} waters` : ''}`);
  }

  // ---------------------------------------------------------------- styles
  function colorScheme(kind) {
    switch (st.color) {
      case 'chain': return { colorscheme: 'chain' };
      case 'residue': return { colorscheme: kind === 'nucleic' ? 'nucleic' : 'amino' };
      case 'bfactor': { const r = S.bClip || S.bRange; return { colorscheme: { prop: 'b', gradient: 'rwb', min: r[1], max: r[0] } }; }
      case 'ss': return { colorscheme: 'ssJmol' };
      default: return { colorscheme: 'default' };
    }
  }
  function spec(style, cs) {
    switch (style) {
      case 'cartoon': return { cartoon: { ...cs, arrows: true } };
      case 'ballstick': return { stick: { radius: 0.14, ...cs }, sphere: { scale: 0.25, ...cs } };
      case 'stick': return { stick: { radius: 0.2, ...cs } };
      case 'sphere': return { sphere: { ...cs } };
      case 'line': return { line: { linewidth: 1, ...cs } };
      default: return { stick: { ...cs } };
    }
  }
  const sel = {
    poly: () => ({ not: { resn: WATER.concat(ligandResn) } }),
    nucleic: () => ({ resn: NUCLEIC }),
    lig: () => ({ resn: ligandResn }),
    water: () => ({ resn: WATER }),
  };
  function applyStyle(surface = true) {
    if (!viewer) return;
    viewer.setStyle({}, {});
    if (small) {
      viewer.setStyle({}, spec(st.style === 'cartoon' ? 'ballstick' : st.style, colorScheme('small')));
    } else {
      viewer.setStyle(sel.poly(), spec(st.style, colorScheme('protein')));
      if (st.color === 'residue') viewer.setStyle({ and: [sel.poly(), sel.nucleic()] }, spec(st.style, colorScheme('nucleic')));
      if (st.ligands && ligandResn.length) {
        const ions = S.ligands.filter((l) => l.kind === 'ion').map((l) => l.resn);
        const ligCs = st.color === 'element' || st.color === 'chain' || st.color === 'residue' || st.color === 'ss' ? { colorscheme: 'greenCarbon' } : colorScheme('ligand');
        const ligStyle = st.style === 'sphere' ? spec('sphere', ligCs) : st.style === 'line' ? spec('line', ligCs) : spec('ballstick', ligCs);
        viewer.setStyle(sel.lig(), ligStyle);
        if (ions.length) viewer.setStyle({ resn: ions }, { sphere: { scale: 0.6, colorscheme: 'default' } });
      }
      if (st.water && S.waters) viewer.setStyle(sel.water(), waterOnly ? spec(st.style === 'cartoon' ? 'ballstick' : st.style, { colorscheme: 'default' }) : { sphere: { scale: 0.18, color: '#ff4d4d' } });
    }
    if (selected) highlight(selected);
    if (surface) {
      viewer.removeAllSurfaces();
      if (st.surface) viewer.addSurface($3Dmol.SurfaceType.VDW, { opacity: 0.72, ...colorScheme('protein') }, small ? {} : sel.poly());
    }
    redrawMeasure();
    viewer.render();
  }

  function bindToolbar() {
    $('style').onchange = (e) => { st.style = e.target.value; applyStyle(); };
    $('color').onchange = (e) => { st.color = e.target.value; applyStyle(); };
    $('surface').onchange = (e) => { st.surface = e.target.checked; status(st.surface ? 'Drawing the surface...' : ''); setTimeout(() => { applyStyle(); if (st.surface) status('Surface on.'); }, 20); };
    $('ligands').onchange = (e) => { st.ligands = e.target.checked; applyStyle(); };
    $('water').onchange = (e) => { st.water = e.target.checked; applyStyle(); };
    $('model').onchange = (e) => {
      st.model = Number(e.target.value) || 0;
      vscode.postMessage({ type: 'model', index: st.model });
      const p = viewer.setFrame(st.model);
      const done = () => { applyStyle(); viewer.render(); status(`Model ${st.model + 1} of ${init.models}`); };
      if (p && p.then) p.then(done); else done();
    };
    $('reset').onclick = () => { if (viewer) { viewer.zoomTo({}, 300); viewer.render(); } };
    $('filter').oninput = () => buildTree($('filter').value);
  }

  // ---------------------------------------------------------------- selection
  function residueSel(key) {
    const m = /^(.*):(-?\d+)([A-Za-z]?)$/.exec(key);
    if (!m) return null;
    const s = { resi: Number(m[2]) };
    if (m[1]) s.chain = m[1];
    return s;
  }
  function highlight(key) {
    const s = residueSel(key);
    if (viewer && s) viewer.addStyle(s, { stick: { radius: 0.24, colorscheme: 'yellowCarbon' } });
  }
  function findResidue(key) {
    for (const c of S.chains) for (const r of c.residues) if (r.key === key) return r;
    return S.ligands.find((l) => l.key === key) || null;
  }
  function select(key, { zoom = true, from = '' } = {}) {
    selected = key;
    if (viewer) { applyStyle(false); if (zoom) { const s = residueSel(key); if (s) viewer.zoomTo(s, 400); } viewer.render(); }
    document.querySelectorAll('.sel').forEach((e) => e.classList.remove('sel'));
    document.querySelectorAll(`[data-key="${CSS.escape(key)}"]`).forEach((e) => { e.classList.add('sel'); if (from !== 'tree' || e.closest('#seq')) e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
    const sc = $('mScope');
    if (sc) { const o = sc.querySelector('option[data-res]'); if (o) { o.value = key; o.textContent = `Selected: ${(findResidue(key) || {}).resn || ''} ${key}`; o.disabled = false; } }
    const cs = $('cScope');
    if (cs) { cs.value = key; }
  }

  function onAtomClick(atom) {
    const info = { name: atom.atom, elem: atom.elem, resn: atom.resn, resi: atom.resi, icode: atom.icode || '', chain: atom.chain || '', serial: atom.serial, x: atom.x, y: atom.y, z: atom.z, b: atom.b, alt: atom.altLoc && atom.altLoc !== ' ' ? atom.altLoc : '' };
    showAtom(info);
    if (ms.on) { addPick({ x: atom.x, y: atom.y, z: atom.z, label: atomText(info) }); return; }
    if (!small && info.resi !== undefined) select(`${info.chain}:${info.resi}${info.icode}`, { zoom: false });
  }
  const atomText = (a) => (small ? `${a.name}` : `${a.chain ? a.chain + ':' : ''}${a.resn} ${a.resi}${a.icode || ''} ${a.name}`);
  function showAtom(a) {
    selectedAtom = a;
    const f = (v) => (typeof v === 'number' ? v.toFixed(3) : '');
    $('atomInfo').innerHTML = `<h3>Atom</h3><table class="kv" id="atomTable">
<tr><th>Name</th><td id="aName">${esc(a.name)}</td></tr><tr><th>Element</th><td id="aElem">${esc(a.elem)}</td></tr>
${small ? '' : `<tr><th>Residue</th><td id="aRes">${esc(a.resn)} ${esc(a.resi)}${esc(a.icode)}</td></tr><tr><th>Chain</th><td id="aChain">${esc(a.chain || '(none)')}</td></tr>`}
<tr><th>Serial</th><td id="aSerial">${esc(a.serial)}</td></tr>
<tr><th>x, y, z (Å)</th><td id="aXyz">${f(a.x)}, ${f(a.y)}, ${f(a.z)}</td></tr>
${small ? '' : `<tr><th>B-factor</th><td id="aB">${typeof a.b === 'number' ? a.b.toFixed(2) : ''}</td></tr>`}${a.alt ? `<tr><th>Alt loc</th><td>${esc(a.alt)}</td></tr>` : ''}</table>
<p><button class="tb" id="copyAtom">Copy</button>${ms.on ? '' : ' <button class="tb pro" id="measureBtn" title="Measure distances, angles and H-bonds (Zovo Pro)">Measure...</button>'}</p>`;
    $('copyAtom').onclick = () => vscode.postMessage({ type: 'copy', what: 'the atom details', text: `${atomText(a)}\t${f(a.x)}\t${f(a.y)}\t${f(a.z)}\tB ${a.b}` });
    const mb = $('measureBtn');
    if (mb) mb.onclick = () => vscode.postMessage({ type: 'command', id: 'pdbViewer.measure' });
  }

  // ---------------------------------------------------------------- tree
  function buildTree(filter) {
    const t = $('tree');
    const q = String(filter || '').trim().toUpperCase();
    const match = (r) => {
      if (!q) return true;
      if (/^[A-Z0-9]*:-?\d+[A-Z]?$/.test(q)) return r.key.toUpperCase() === q;
      if (/^-?\d+$/.test(q)) return String(r.resi) === q;
      return String(r.resn).toUpperCase().startsWith(q);
    };
    const parts = [];
    if (small) {
      const l = S.ligands[0];
      parts.push(`<div class="node open" data-group="mol"><div class="row head" role="treeitem"><span class="tw">▾</span><b>Molecule</b> <span class="muted">${esc(S.formula)} · ${fmtNum(S.atoms)} atoms${init.models > 1 ? ` · ${init.models} ${init.format === 'xyz' || init.format === 'gro' ? 'frames' : 'models'}` : ''}</span></div>
        <div class="kids">${S.ligands.map((x) => resRow(x, true)).join('')}</div></div>`);
      if (S.name) parts.push(`<p class="muted small">${esc(S.name)}</p>`);
      void l;
    } else {
      for (const c of S.chains) {
        const rs = c.residues.filter(match);
        if (q && !rs.length) continue;
        const open = q || S.chains.length === 1 || c.residues.length <= 400;
        parts.push(`<div class="node${open ? ' open' : ''}" data-chain="${esc(c.id)}"><div class="row head chainRow" role="treeitem" data-chain="${esc(c.id)}"><span class="tw">${open ? '▾' : '▸'}</span><b>Chain ${esc(c.id || '(none)')}</b> <span class="muted">${c.polymer || 'residues'}, ${c.residues.length}${c.ligands ? `, ${c.ligands} ligand${c.ligands === 1 ? '' : 's'}` : ''}</span></div>
          <div class="kids">${open ? rs.map((r) => resRow(r, false)).join('') : ''}</div></div>`);
      }
      const ligs = S.ligands.filter(match);
      if (ligs.length) {
        parts.push(`<div class="node open" data-group="lig"><div class="row head" role="treeitem"><span class="tw">▾</span><b>Ligands</b> <span class="muted">${ligs.length}</span></div><div class="kids">${ligs.map((l) => resRow(l, true)).join('')}</div></div>`);
      }
      if (S.waters && !q) parts.push(`<div class="node" data-group="water"><div class="row head" role="treeitem"><span class="tw"> </span><b>Water</b> <span class="muted">${fmtNum(S.waters)} molecules</span></div></div>`);
    }
    t.innerHTML = parts.join('') || '<p class="muted">No residue matches.</p>';
    if (selected) document.querySelectorAll(`#tree [data-key="${CSS.escape(selected)}"]`).forEach((e) => e.classList.add('sel'));
  }
  function resRow(r, lig) {
    const ss = r.ss ? ` <span class="ss ss${r.ss}" title="${POLY_CODE[r.ss]}">${r.ss}</span>` : '';
    const site = lig && !small && r.kind === 'ligand' ? ' <button class="mini pro siteBtn" title="Binding site report (Zovo Pro)">Site</button>' : '';
    return `<div class="res" data-key="${esc(r.key)}"><div class="row resRow" role="treeitem" data-key="${esc(r.key)}"><span class="tw atw" title="Show atoms">▸</span><span class="rn">${esc(r.resn)}</span> <span class="rk">${esc(lig || !r.key.startsWith(':') ? r.key : r.resi)}</span>${lig ? ` <span class="muted">${r.atoms} atom${r.atoms === 1 ? '' : 's'}</span>` : ''}${ss}${site}</div><div class="atoms"></div></div>`;
  }
  $('tree').addEventListener('click', async (e) => {
    const siteBtn = e.target.closest('.siteBtn');
    if (siteBtn) { const k = siteBtn.closest('.res').dataset.key; vscode.postMessage({ type: 'command', id: 'pdbViewer.bindingSite', extra: { ligand: k } }); return; }
    const atomRow = e.target.closest('.atomRow');
    if (atomRow) {
      const a = JSON.parse(atomRow.dataset.atom);
      const r = findResidue(atomRow.closest('.res').dataset.key) || {};
      const info = { ...a, resn: a.resn || r.resn, resi: r.resi, icode: r.icode || '', chain: r.chain !== undefined ? r.chain : (atomRow.closest('.res').dataset.key.split(':')[0]) };
      showAtom(info);
      if (ms.on) addPick({ i: a.i, x: a.x, y: a.y, z: a.z, label: atomText(info) });
      else if (viewer) { viewer.zoomTo({ x: a.x, y: a.y, z: a.z }, 0); viewer.center({ serial: a.serial }, 300); }
      document.querySelectorAll('.atomRow.sel').forEach((x) => x.classList.remove('sel'));
      atomRow.classList.add('sel');
      return;
    }
    const tw = e.target.closest('.atw');
    if (tw) { await toggleAtoms(tw.closest('.res'), tw); return; }
    const head = e.target.closest('.chainRow');
    if (head && e.target.closest('.tw')) {
      const node = head.parentElement;
      const c = S.chains.find((x) => x.id === node.dataset.chain);
      node.classList.toggle('open');
      head.querySelector('.tw').textContent = node.classList.contains('open') ? '▾' : '▸';
      const kids = node.querySelector('.kids');
      if (node.classList.contains('open') && !kids.childElementCount && c) kids.innerHTML = c.residues.map((r) => resRow(r, false)).join('');
      return;
    }
    if (head) { const c = head.dataset.chain; if (viewer) { viewer.zoomTo(c ? { chain: c } : {}, 400); viewer.render(); } return; }
    const rr = e.target.closest('.resRow');
    if (rr) select(rr.dataset.key, { from: 'tree' });
  });
  async function toggleAtoms(res, tw) {
    const box = res.querySelector('.atoms');
    if (box.childElementCount) { box.innerHTML = ''; tw.textContent = '▸'; return; }
    const r = await ask({ type: 'atoms', key: res.dataset.key });
    tw.textContent = '▾';
    box.innerHTML = (r.atoms || []).map((a) => `<div class="row atomRow" data-atom="${esc(JSON.stringify(a))}" data-i="${a.i}"><span class="el el-${esc(a.elem)}">${esc(a.elem)}</span> ${esc(a.name)}${a.alt ? ` (${esc(a.alt)})` : ''} <span class="muted">#${a.serial}</span></div>`).join('') || '<p class="muted">No atoms in this model.</p>';
  }

  // ---------------------------------------------------------------- sequence strip
  function buildSeq() {
    const box = $('seq');
    const chains = S.chains.filter((c) => c.polymer && c.residues.length);
    if (small || !chains.length) { box.hidden = true; return; }
    box.innerHTML = chains.map((c) => `<div class="seqRow"><span class="seqChain" title="Chain ${esc(c.id)}">${esc(c.id || '-')}</span><span class="seqRes">${c.residues.map((r, i) => `${i % 10 === 0 ? `<i class="tick">${r.resi}</i>` : ''}<span class="aa${r.ss ? ' ss' + r.ss : ''}" data-key="${esc(r.key)}" title="${esc(r.resn)} ${esc(r.key)}">${esc(r.code)}</span>`).join('')}</span></div>`).join('');
    box.addEventListener('click', (e) => { const a = e.target.closest('.aa'); if (a) select(a.dataset.key, { from: 'seq' }); });
  }

  function buildFacts() {
    const rows = [];
    if (S.id) rows.push(['Entry', S.id]);
    if (S.title) rows.push(['Title', S.title]);
    else if (S.header) rows.push(['Header', S.header]);
    rows.push(['Atoms', fmtNum(S.atoms)]);
    if (!small) { rows.push(['Chains', S.chains.map((c) => c.id || '-').join(', ') || '-']); rows.push(['Residues', fmtNum(S.residues)]); rows.push(['Ligands', S.ligands.length ? [...new Set(S.ligands.map((l) => l.resn))].join(', ') : 'none']); }
    else rows.push(['Formula', S.formula]);
    if (S.waters) rows.push(['Waters', fmtNum(S.waters)]);
    if (init.models > 1) rows.push([init.format === 'xyz' || init.format === 'gro' ? 'Frames' : 'Models', init.models]);
    if (S.hasB && !small) rows.push(['B-factor', `${S.bRange[0]} to ${S.bRange[1]}`]);
    $('facts').innerHTML = `<h3>File</h3><table class="kv" id="factTable">${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>${S.warnings.length ? `<p class="warn">${S.warnings.map(esc).join('<br>')}</p>` : ''}`;
  }

  // ---------------------------------------------------------------- notes
  function showSymbols(m) {
    document.body.dataset.state = 'symbols';
    const what = m.which === 'portable' ? 'a .NET portable debug symbol file (it starts with "BSJB")' : `a Microsoft debug symbol file, a program database (it starts with "Microsoft C/C++ ${m.which === 'msf2' ? 'program database 2.00' : 'MSF 7.00'}")`;
    note(`<h2>This .pdb file holds debug symbols, not a protein structure</h2>
<p>${esc(m.name)} is ${esc(what)}. Compilers write these next to programs. The PDB Viewer opens Protein Data Bank files, which use the same .pdb extension.</p>
<p class="row">${m.hex ? `<button class="tb" id="nHex">Open in ${esc(m.hex)}</button> ` : ''}<button class="tb" id="nReopen">Reopen with another editor...</button> <button class="tb" id="nText">Open as Text</button></p>`);
    if ($('nHex')) $('nHex').onclick = () => vscode.postMessage({ type: 'openHex' });
    $('nReopen').onclick = () => vscode.postMessage({ type: 'reopenWith' });
    $('nText').onclick = () => vscode.postMessage({ type: 'openText' });
  }
  function showError(text, canText) {
    document.body.dataset.state = 'error';
    note(`<h2>This file could not be shown as a structure</h2><p id="errText">${esc(text)}</p><p class="row">${canText ? '<button class="tb" id="nText">Open as Text</button> ' : ''}<button class="tb" id="nReopen">Reopen with another editor...</button></p>`);
    if ($('nText')) $('nText').onclick = () => vscode.postMessage({ type: 'openText' });
    $('nReopen').onclick = () => vscode.postMessage({ type: 'reopenWith' });
  }
  function note(html) {
    document.body.classList.add('noted');
    const msg = $('msg');
    msg.innerHTML = html;
    msg.hidden = false;
  }
  function status(t, err) { $('statusText').textContent = t || ''; $('statusText').classList.toggle('err', !!err); }

  // ---------------------------------------------------------------- Measure (Pro)
  function measureOn(m) {
    ms.on = true; ms.picks = []; ms.rows = []; ms.shown = false; ms.cutoff = m.hbondCutoff || 3.5; ms.hb = null; ms.ct = null;
    const box = $('measure');
    box.hidden = false;
    const chainOpts = small ? '' : S.chains.map((c) => `<option value="chain:${esc(c.id)}">Chain ${esc(c.id || '-')}</option>`).join('');
    const ligOpts = S.ligands.map((l) => `<option value="${esc(l.key)}">${esc(l.resn)} ${esc(l.key)}</option>`).join('');
    box.innerHTML = `<h3>Measure <span class="badge">Pro</span></h3>
<div class="seg" role="group" aria-label="What to measure"><button class="tb on" data-n="2" id="mDist">Distance</button><button class="tb" data-n="3" id="mAng">Angle</button><button class="tb" data-n="4" id="mDih">Dihedral</button></div>
<p id="mPick" class="muted">Click 2 atoms in the view or in the tree.</p>
<table id="mTable" class="grid"></table>
${small ? '' : `<div class="mrow"><b>H-bonds</b> in <select id="mScope"><option value="all">Whole structure</option>${chainOpts}<option data-res value="" disabled>Selected residue</option>${ligOpts}</select> up to <input id="mCut" type="number" min="2.6" max="4" step="0.1" value="${ms.cutoff}"> Å <button class="tb" id="mHb">Find</button></div>
<div class="mrow"><b>Contacts</b> of <select id="cScope">${ligOpts}${chainOpts}${selected ? `<option value="${esc(selected)}">${esc(selected)}</option>` : ''}</select> within <input id="cCut" type="number" min="1" max="8" step="0.5" value="4"> Å <button class="tb" id="mCt">Find</button></div>`}
<p class="row"><button class="tb" id="mCsv">Save CSV...</button> <button class="tb" id="mClear">Clear</button> <button class="tb" id="mClose">Close</button> <span id="mSaved" class="muted"></span></p>
<div id="mList"></div>`;
    if (selected) select(selected, { zoom: false });
    box.querySelectorAll('.seg .tb').forEach((b) => { b.onclick = () => { box.querySelectorAll('.seg .tb').forEach((x) => x.classList.remove('on')); b.classList.add('on'); ms.mode = Number(b.dataset.n); ms.picks = []; pickHint(); }; });
    if ($('mHb')) $('mHb').onclick = async () => {
      const r = await ask({ type: 'hbonds', scope: $('mScope').value || 'all', cutoff: Number($('mCut').value) });
      if (r.type !== 'hbondsResult') return measureError(r);
      ms.hb = r; ms.ct = null; drawLists(); redrawMeasure(); shown();
    };
    if ($('mCt')) $('mCt').onclick = async () => {
      const scope = $('cScope').value;
      const r = await ask({ type: 'contacts', scope, cutoff: Number($('cCut').value) });
      if (r.type !== 'contactsResult') return measureError(r);
      ms.ct = r; ms.hb = null; drawLists(); redrawMeasure(); shown();
    };
    $('mCsv').onclick = async () => { const r = await ask({ type: 'measureCsv' }); if (r.type === 'measureSaved') $('mSaved').textContent = `Saved ${r.rows} rows to ${r.path}`; else if (r.type === 'measureError') measureError(r); };
    $('mClear').onclick = () => { ms.picks = []; ms.rows = []; ms.hb = null; ms.ct = null; vscode.postMessage({ type: 'measureClear' }); drawTable(); drawLists(); redrawMeasure(); pickHint(); };
    $('mClose').onclick = () => { vscode.postMessage({ type: 'measureOff' }); measureOff(); };
    drawTable();
    pickHint();
    if (selectedAtom) showAtom(selectedAtom);
  }
  function measureOff() {
    ms.on = false; ms.picks = []; ms.rows = []; ms.hb = null; ms.ct = null;
    $('measure').hidden = true; $('measure').innerHTML = '';
    redrawMeasure();
    if (viewer) viewer.render();
  }
  function shown() { if (!ms.shown) { ms.shown = true; vscode.postMessage({ type: 'measureShown' }); } }
  function measureError(r) { $('mPick').textContent = r.message || 'That did not work.'; $('mPick').classList.add('err'); }
  function pickHint() {
    const names = { 2: 'distance', 3: 'angle (the 2nd atom is the vertex)', 4: 'dihedral' };
    const p = $('mPick');
    if (!p) return;
    p.classList.remove('err');
    p.textContent = ms.picks.length ? `Picked ${ms.picks.map((x) => x.label).join(', ')}. ${ms.mode - ms.picks.length} more for the ${names[ms.mode]}.` : `Click ${ms.mode} atoms for a ${names[ms.mode]}, in the view or in the tree.`;
  }
  async function addPick(p) {
    ms.picks.push(p);
    redrawMeasure();
    if (ms.picks.length < ms.mode) { pickHint(); return; }
    const picks = ms.picks.splice(0);
    const r = await ask({ type: 'measurePick', atoms: picks.map((x) => (Number.isInteger(x.i) ? { i: x.i } : { x: x.x, y: x.y, z: x.z })) });
    if (r.type !== 'measureResult') { measureError(r); return; }
    ms.rows.push(r.row);
    drawTable();
    redrawMeasure();
    pickHint();
    shown();
  }
  function valueText(row) { return `${row.value.toFixed(row.kind === 'distance' ? 3 : 2)} ${row.unit}`; }
  function drawTable() {
    const t = $('mTable');
    if (!t) return;
    t.innerHTML = ms.rows.length ? `<tr><th>Type</th><th>Value</th><th>Atoms</th></tr>${ms.rows.map((r) => `<tr class="mrow-${r.kind}"><td>${r.kind}</td><td class="num mval">${valueText(r)}</td><td>${r.labels.map(esc).join(' – ')}</td></tr>`).join('')}` : '';
  }
  function drawLists() {
    const box = $('mList');
    if (!box) return;
    if (ms.hb) {
      box.innerHTML = `<h4 id="hbHead">${fmtNum(ms.hb.total)} H-bond candidate${ms.hb.total === 1 ? '' : 's'} (N/O pairs 2.5 to ${ms.hb.cutoff} Å)${ms.hb.total > ms.hb.rows.length ? `, first ${fmtNum(ms.hb.rows.length)} listed` : ''}</h4><table class="grid" id="hbTable"><tr><th>Atom</th><th>Atom</th><th>Å</th></tr>${ms.hb.rows.slice(0, 500).map((h) => `<tr><td>${esc(h.a.label)}</td><td>${esc(h.b.label)}</td><td class="num">${h.d.toFixed(2)}</td></tr>`).join('')}</table>`;
    } else if (ms.ct) {
      box.innerHTML = `<h4 id="ctHead">${fmtNum(ms.ct.residues.length)} residue${ms.ct.residues.length === 1 ? '' : 's'} within ${ms.ct.cutoff} Å of ${esc(ms.ct.scope)} (${fmtNum(ms.ct.total)} atom pairs)</h4><table class="grid" id="ctTable"><tr><th>Residue</th><th>Closest pair</th><th>Å</th><th>Pairs</th></tr>${ms.ct.residues.map((c) => `<tr><td>${esc(c.res)}</td><td>${esc(c.a.label)} – ${esc(c.b.label)}</td><td class="num">${c.d.toFixed(2)}</td><td class="num">${c.n}</td></tr>`).join('')}</table>`;
    } else box.innerHTML = '';
  }
  function dashed(a, b, color, r) { viewer.addCylinder({ start: { x: a.x, y: a.y, z: a.z }, end: { x: b.x, y: b.y, z: b.z }, radius: r || 0.05, color, dashed: true, fromCap: 1, toCap: 1 }); }
  function redrawMeasure() {
    if (!viewer) return;
    viewer.removeAllShapes();
    if (!ms.on) { redrawLabels(); return; }
    for (const p of ms.picks) viewer.addSphere({ center: { x: p.x, y: p.y, z: p.z }, radius: 0.45, color: '#ffd400', opacity: 0.55 });
    for (const r of ms.rows) {
      const a = r.atoms;
      for (let i = 0; i + 1 < a.length; i++) dashed(a[i], a[i + 1], '#ffd400', 0.06);
    }
    if (ms.hb) for (const h of ms.hb.rows.slice(0, 1500)) dashed(h.a, h.b, '#33d6ff', 0.04);
    if (ms.ct) for (const c of ms.ct.rows.slice(0, 1500)) dashed(c.a, c.b, '#ff9a3c', 0.03);
    redrawLabels();
  }
  function redrawLabels() {
    if (!viewer) return;
    viewer.removeAllLabels();
    if (selected) {
      const s = residueSel(selected);
      const r = findResidue(selected);
      if (s && r && !small) viewer.addLabel(`${r.resn} ${selected}`, { fontSize: 12, backgroundOpacity: 0.65, backgroundColor: '#202020', fontColor: '#ffffff', inFront: true }, s);
    }
    if (!ms.on) return;
    for (const r of ms.rows) {
      const a = r.atoms;
      const at = r.kind === 'distance' ? { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2, z: (a[0].z + a[1].z) / 2 } : r.kind === 'angle' ? a[1] : { x: (a[1].x + a[2].x) / 2, y: (a[1].y + a[2].y) / 2, z: (a[1].z + a[2].z) / 2 };
      viewer.addLabel(valueText(r), { position: at, fontSize: 12, fontColor: '#111111', backgroundColor: '#ffd400', backgroundOpacity: 0.9, inFront: true });
    }
  }

  // test hook for the real-app gate: screen position of a model point (read only)
  window.__pdbView = { screenOf: (p) => (viewer ? viewer.modelToScreen(p) : null), pixels: () => canvasPixels(), frames: () => (viewer ? viewer.getNumFrames() : 0) };

  vscode.postMessage({ type: 'ready' });
})();
