'use strict';
// What is in the bytes of a file the viewer was asked to open. .pdb is also the Microsoft debug symbol format
// (program database): those files start with "Microsoft C/C++ MSF 7.00", "Microsoft C/C++ program database 2.00" or,
// for .NET portable symbols, "BSJB". They get a plain note in the viewer, never an error. Pure, no vscode import.
const zlib = require('zlib');

const MSF7 = Buffer.from('Microsoft C/C++ MSF 7.00');
const MSF2 = Buffer.from('Microsoft C/C++ program database 2.00');
const BSJB = Buffer.from('BSJB');
const MAX_TEXT = 512 * 1024 * 1024; // larger text files are refused with a note

const startsWith = (b, sig) => b.length >= sig.length && b.subarray(0, sig.length).equals(sig);

/** Which kind of debug symbol file the bytes are, or ''. */
function symbolKind(b) {
  if (startsWith(b, MSF7)) return 'msf7';
  if (startsWith(b, MSF2)) return 'msf2';
  if (startsWith(b, BSJB)) return 'portable';
  return '';
}

/** True when the first bytes look binary (NUL bytes or many control characters). */
function looksBinary(b) {
  const n = Math.min(b.length, 8192);
  if (!n) return false;
  let ctrl = 0;
  for (let i = 0; i < n; i++) {
    const c = b[i];
    if (c === 0) return true;
    if (c < 9 || (c > 13 && c < 32)) ctrl++;
  }
  return ctrl / n > 0.1;
}

/**
 * bytes -> { kind: 'text', text, gz } | { kind: 'symbols', which } | { kind: 'binary', what } | { kind: 'empty' } | { kind: 'large', size }
 */
function decode(bytes) {
  let b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength);
  if (!b.length) return { kind: 'empty' };
  const sym = symbolKind(b);
  if (sym) return { kind: 'symbols', which: sym };
  let gz = false;
  if (b[0] === 0x1f && b[1] === 0x8b) {
    try { b = zlib.gunzipSync(b, { maxOutputLength: MAX_TEXT }); gz = true; } catch (e) {
      if (e && /max|buffer/i.test(String(e.message)) && e.code === 'ERR_BUFFER_TOO_LARGE') return { kind: 'large', size: MAX_TEXT };
      return { kind: 'binary', what: 'broken-gzip' };
    }
    const s2 = symbolKind(b);
    if (s2) return { kind: 'symbols', which: s2 };
  }
  if (b.length > MAX_TEXT) return { kind: 'large', size: b.length };
  if (startsWith(b, Buffer.from('PK\x03\x04', 'latin1'))) return { kind: 'binary', what: 'zip' };
  if (looksBinary(b)) return { kind: 'binary', what: 'binary' };
  let text = b.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return { kind: 'text', text, gz };
}

module.exports = { decode, symbolKind, looksBinary, MAX_TEXT };
