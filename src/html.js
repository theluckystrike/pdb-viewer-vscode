'use strict';
// Webview HTML for the viewer and the Pro tool panels. No vscode import, so tests can check the CSP: no remote origin,
// no connect-src, no worker or blob source, scripts only with the page nonce. The 3D view is 3Dmol.js from lib/.
const crypto = require('crypto');
const { footerHtml, FOOTER_CSS } = require('./support');

const PREFIX = 'pdbViewer';
const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function csp(cspSource, n) {
  return ["default-src 'none'", `style-src ${cspSource} 'nonce-${n}'`, `script-src 'nonce-${n}'`, `img-src ${cspSource} data:`, `font-src ${cspSource}`].join('; ');
}

/** p: { cspSource, libUri, scriptUri, styleUri, title, showSupportLinks, head?(nonce) } */
function editorHtml(p) {
  const n = p.nonce || crypto.randomBytes(18).toString('base64url');
  const footer = footerHtml(PREFIX, p.showSupportLinks !== false, '');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp(p.cspSource, n)}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${attr(p.styleUri)}">
${footer ? `<style nonce="${n}">${FOOTER_CSS}</style>` : ''}
${typeof p.head === 'function' ? p.head(n) : ''}
<title>${attr(p.title)}</title>
</head>
<body>
<div id="toolbar" role="toolbar" aria-label="Structure viewer">
  <span id="fmt" class="chip" title="Format and size"></span>
  <label class="grp">Style <select id="style" aria-label="Style">
    <option value="cartoon">Cartoon</option><option value="ballstick">Ball and stick</option><option value="stick">Sticks</option><option value="sphere">Spheres</option><option value="line">Lines</option>
  </select></label>
  <label class="grp">Color <select id="color" aria-label="Color">
    <option value="chain">Chain</option><option value="residue">Residue</option><option value="element">Element</option><option value="bfactor">B-factor</option><option value="ss">Secondary structure</option>
  </select></label>
  <label class="grp chk"><input type="checkbox" id="surface"> Surface</label>
  <label class="grp chk" id="ligWrap"><input type="checkbox" id="ligands" checked> Ligands</label>
  <label class="grp chk" id="watWrap"><input type="checkbox" id="water"> Water</label>
  <label class="grp" id="modelWrap" hidden>Model <select id="model" aria-label="Model"></select></label>
  <button class="tb" id="reset" title="Fit the whole structure in the view">Reset view</button>
  <button class="tb" id="openText" title="Open the file in the text editor">Open as Text</button>
</div>
<div id="app">
  <aside id="side" aria-label="Chains, residues and ligands">
    <input id="filter" type="search" spellcheck="false" placeholder="Filter residues (HIS, 42, A:57)" aria-label="Filter the tree">
    <div id="tree" role="tree"></div>
  </aside>
  <main id="viewWrap">
    <div id="view" aria-label="3D view"></div>
    <div id="msg" role="alert" hidden></div>
    <div id="hint" class="muted">Drag to rotate, scroll to zoom, right-drag or Ctrl-drag to move. Click an atom for its details.</div>
  </main>
  <aside id="info" aria-label="Details">
    <section id="atomInfo"><h3>Atom</h3><p class="muted">Click an atom in the view or in the tree.</p></section>
    <section id="measure" hidden></section>
    <section id="facts"></section>
  </aside>
</div>
<div id="seq" aria-label="Sequence"></div>
<div id="status"><span id="statusText"></span></div>
<div id="footer"></div>
<template id="zovo-footer">${footer}</template>
<script nonce="${n}" src="${attr(p.libUri)}"></script>
<script nonce="${n}" src="${attr(p.scriptUri)}"></script>
</body>
</html>`;
}

/** Panel of a Pro tool. p: { cspSource, libUri, scriptUri, styleUri, title, head?(nonce), showSupportLinks } */
function panelHtml(p) {
  const n = p.nonce || crypto.randomBytes(18).toString('base64url');
  const footer = footerHtml(PREFIX, p.showSupportLinks !== false, '');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp(p.cspSource, n)}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${attr(p.styleUri)}">
${footer ? `<style nonce="${n}">${FOOTER_CSS}</style>` : ''}
${typeof p.head === 'function' ? p.head(n) : ''}
<title>${attr(p.title)}</title>
</head>
<body class="panel">
<div id="toolbar" role="toolbar"><strong id="title"></strong><span id="actions"></span></div>
<div id="app" class="panelApp">
  <div id="pview" aria-label="3D view" hidden></div>
  <div id="report"><p class="muted">Working...</p></div>
</div>
<div id="footer">${footer}</div>
<script nonce="${n}" src="${attr(p.libUri)}"></script>
<script nonce="${n}" src="${attr(p.scriptUri)}"></script>
</body>
</html>`;
}

module.exports = { editorHtml, panelHtml, csp };
