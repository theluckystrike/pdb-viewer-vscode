// Panel of a Pro tool (Superpose and RMSD, Binding site report): the report table from the extension host and a 3D
// view drawn with 3Dmol.js from lib/. No network request.
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  let viewer = null;
  let bgHex = '#1e1e1e';

  function themeBackground() {
    const v = getComputedStyle(document.body).getPropertyValue('--vscode-editor-background').trim();
    if (/^#[0-9a-f]{6}$/i.test(v)) return v;
    const r = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(v);
    if (r) return '#' + [r[1], r[2], r[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('');
    return '#1e1e1e';
  }

  function draw(view) {
    const box = $('pview');
    if (!view || typeof $3Dmol === 'undefined') { box.hidden = true; return false; }
    box.hidden = false;
    try { if ($3Dmol.setSyncSurface) $3Dmol.setSyncSurface(true); } catch (e) { /* older build */ }
    bgHex = themeBackground();
    viewer = $3Dmol.createViewer(box, { backgroundColor: bgHex, antialias: true });
    if (!viewer) { box.hidden = true; return false; }
    if (view.mode === 'superpose') {
      const a = viewer.addModel(view.a, 'pdb');
      const b = viewer.addModel(view.b, 'pdb');
      a.setStyle({}, { cartoon: { color: '#4a90e2' } });
      b.setStyle({}, { cartoon: { color: '#f5a623' } });
      // atoms with no cartoon (ligands, small chains) as thin sticks in the same colors
      a.setStyle({ hetflag: true }, { stick: { radius: 0.12, color: '#4a90e2' } });
      b.setStyle({ hetflag: true }, { stick: { radius: 0.12, color: '#f5a623' } });
      viewer.zoomTo();
    } else if (view.mode === 'site') {
      const m = viewer.addModel(view.text, 'pdb');
      const lig = { chain: view.ligand.chain || undefined, resi: view.ligand.resi, resn: view.ligand.resn };
      if (!lig.chain) delete lig.chain;
      m.setStyle({}, { cartoon: { color: '#9aa5b1', opacity: 0.55 } });
      for (const r of view.residues) {
        const s = { resi: r.resi, resn: r.resn };
        if (r.chain) s.chain = r.chain;
        m.setStyle(s, { cartoon: { color: '#9aa5b1', opacity: 0.55 }, stick: { radius: 0.16, colorscheme: 'default' } });
        viewer.addLabel(`${r.resn}${r.resi}${r.chain ? ':' + r.chain : ''}`, { fontSize: 10, fontColor: '#ffffff', backgroundColor: '#303030', backgroundOpacity: 0.6 }, s);
      }
      m.setStyle(lig, { stick: { radius: 0.24, colorscheme: 'greenCarbon' }, sphere: { scale: 0.22, colorscheme: 'greenCarbon' } });
      m.setStyle({ resn: ['HOH', 'WAT', 'DOD', 'SOL'] }, {});
      viewer.zoomTo(lig);
      viewer.zoom(0.8);
    }
    viewer.render();
    return true;
  }

  function lit() {
    const c = $('pview').querySelector('canvas');
    if (!c || !c.width) return 0;
    const w = Math.min(c.width, 300), h = Math.round((c.height * w) / c.width) || 1;
    const t = document.createElement('canvas'); t.width = w; t.height = h;
    const g = t.getContext('2d'); g.drawImage(c, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    const br = parseInt(bgHex.slice(1, 3), 16), bg = parseInt(bgHex.slice(3, 5), 16), bb = parseInt(bgHex.slice(5, 7), 16);
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - br) + Math.abs(d[i + 1] - bg) + Math.abs(d[i + 2] - bb) > 40) n++;
    return n;
  }

  function png(transparent) {
    if (!viewer) return '';
    if (transparent) viewer.setBackgroundColor(0x000000, 0);
    viewer.render();
    const url = viewer.pngURI();
    if (transparent) { viewer.setBackgroundColor(bgHex, 1); viewer.render(); }
    return url;
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('button.act');
    if (!b) return;
    if (b.dataset.id === 'png') {
      const t = $('transparent');
      vscode.postMessage({ type: 'action', id: 'pngData', data: png(!t || t.checked) });
      return;
    }
    vscode.postMessage({ type: 'action', id: b.dataset.id });
  });
  document.addEventListener('click', (e) => {
    const tr = e.target.closest('#siteTable tr[data-resi]');
    if (!tr || !viewer) return;
    const s = { resi: Number(tr.dataset.resi) };
    if (tr.dataset.chain) s.chain = tr.dataset.chain;
    viewer.zoomTo(s, 300);
    document.querySelectorAll('#siteTable tr.sel').forEach((x) => x.classList.remove('sel'));
    tr.classList.add('sel');
  });

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || typeof m !== 'object') return;
    if (m.type === 'show') {
      if (m.title) $('title').textContent = m.title;
      if (m.html !== undefined) $('report').innerHTML = m.html;
      if (m.view) {
        const ok = draw(m.view);
        setTimeout(() => {
          const n = ok ? lit() : 0;
          document.body.dataset.pixels = String(n);
          document.body.dataset.state = 'shown';
          vscode.postMessage({ type: 'shown', pixels: n });
        }, 120);
      } else if (m.html !== undefined) {
        document.body.dataset.state = 'shown';
        vscode.postMessage({ type: 'shown' });
      }
    } else if (m.type === 'patch') {
      const t = $(m.target);
      if (t) t.innerHTML = m.html;
    }
  });
  vscode.postMessage({ type: 'ready' });
})();
