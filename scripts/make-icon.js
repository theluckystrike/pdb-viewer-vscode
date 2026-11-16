'use strict';
// Draws icon.png (128 x 128): a helix ribbon with a small ball-and-stick ligand on a dark blue tile. Our own design.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const W = 128, H = 128;
const px = Buffer.alloc(W * H * 4);
const set = (x, y, [r, g, b], a = 255) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; const k = a / 255; px[i] = Math.round(px[i] * (1 - k) + r * k); px[i + 1] = Math.round(px[i + 1] * (1 - k) + g * k); px[i + 2] = Math.round(px[i + 2] * (1 - k) + b * k); px[i + 3] = Math.max(px[i + 3], a); };
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
// rounded tile with a soft vertical gradient
const R = 22;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const dx = Math.max(R - x, 0, x - (W - 1 - R)), dy = Math.max(R - y, 0, y - (H - 1 - R));
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d <= R) set(x, y, mix(hex('#1B3552'), hex('#0E1C2C'), y / H), d > R - 1 ? Math.round(255 * (R - d)) : 255);
}
// helix ribbon: a band following a sine path, drawn back half first, then front half (lighter)
const back = hex('#3A6FB0'), front = hex('#5FB2FF'), edge = hex('#A9DCFF');
function disc(cx, cy, r, col, a = 255) {
  for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
    const d = Math.hypot(x - cx, y - cy);
    if (d <= r + 0.5) set(x, y, col, Math.round(a * Math.min(1, r + 0.5 - d)));
  }
}
const x0 = 18, x1 = 92, amp = 22, cy = 58, turns = 2.25;
for (const pass of ['back', 'front']) {
  for (let i = 0; i <= 900; i++) {
    const t = i / 900;
    const x = x0 + (x1 - x0) * t;
    const ph = t * turns * 2 * Math.PI;
    const y = cy + amp * Math.sin(ph);
    const facing = Math.cos(ph); // > 0: front of the coil
    if ((pass === 'front') !== (facing > 0)) continue;
    const w = 3.2 + 3.6 * Math.abs(facing);
    const col = pass === 'front' ? mix(front, edge, Math.max(0, facing) * 0.45) : mix(back, hex('#28507F'), 0.3);
    disc(x, y, w, col);
  }
}
// ligand: ball and stick in the lower right
const atoms = [[86, 96, '#F2F2F2'], [100, 88, '#FF5A4E'], [112, 97, '#F2F2F2'], [100, 74, '#52D273'], [74, 106, '#4F7DFF']];
const bonds = [[0, 1], [1, 2], [1, 3], [0, 4]];
for (const [a, b] of bonds) {
  const [ax, ay] = atoms[a], [bx, by] = atoms[b];
  for (let i = 0; i <= 60; i++) { const t = i / 60; disc(ax + (bx - ax) * t, ay + (by - ay) * t, 1.6, hex('#C8D2DC')); }
}
for (const [x, y, c] of atoms) { disc(x, y, 6, hex(c)); disc(x - 1.8, y - 1.8, 1.8, mix(hex(c), [255, 255, 255], 0.7), 200); }
// png
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (b) => { let c = -1; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
fs.writeFileSync(path.join(__dirname, '..', 'icon.png'), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log('icon.png written');
