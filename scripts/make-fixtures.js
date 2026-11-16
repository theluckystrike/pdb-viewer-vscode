'use strict';
// Writes the small hand-made test files in test/fixtures (made up for the tests; not real structures).
// node scripts/make-fixtures.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const FIX = path.join(__dirname, '..', 'test', 'fixtures');
fs.mkdirSync(FIX, { recursive: true });
const w = (name, text) => fs.writeFileSync(path.join(FIX, name), text);
const pad = (s, n) => String(s).padStart(n);
const padR = (s, n) => String(s).padEnd(n);
function atom(rec, serial, name, resn, chain, resi, x, y, z, b, elem) {
  const nm = name.length < 4 && elem.length < 2 ? ` ${name}` : name;
  return `${padR(rec, 6)}${pad(serial, 5)} ${padR(nm, 4)} ${pad(resn, 3)} ${chain}${pad(resi, 4)}    ${pad(x.toFixed(3), 8)}${pad(y.toFixed(3), 8)}${pad(z.toFixed(3), 8)}${pad('1.00', 6)}${pad(b.toFixed(2), 6)}          ${pad(elem.toUpperCase(), 2)}  `;
}
const A = [
  ['ATOM', 'N', 'ALA', 'A', 1, 11.104, 6.134, -6.504, 'N'], ['ATOM', 'CA', 'ALA', 'A', 1, 11.639, 6.071, -5.147, 'C'], ['ATOM', 'C', 'ALA', 'A', 1, 13.140, 5.814, -5.152, 'C'],
  ['ATOM', 'O', 'ALA', 'A', 1, 13.793, 5.869, -6.204, 'O'], ['ATOM', 'CB', 'ALA', 'A', 1, 11.344, 7.371, -4.403, 'C'],
  ['ATOM', 'N', 'GLY', 'A', 2, 13.685, 5.536, -3.969, 'N'], ['ATOM', 'CA', 'GLY', 'A', 2, 15.112, 5.269, -3.839, 'C'], ['ATOM', 'C', 'GLY', 'A', 2, 15.552, 4.946, -2.418, 'C'],
  ['ATOM', 'O', 'GLY', 'A', 2, 14.737, 4.882, -1.494, 'O'],
  ['ATOM', 'N', 'SER', 'A', 3, 16.850, 4.700, -2.250, 'N'], ['ATOM', 'CA', 'SER', 'A', 3, 17.400, 4.400, -0.930, 'C'], ['ATOM', 'C', 'SER', 'A', 3, 18.900, 4.200, -1.000, 'C'],
  ['ATOM', 'O', 'SER', 'A', 3, 19.500, 4.300, -2.070, 'O'], ['ATOM', 'OG', 'SER', 'A', 3, 16.900, 3.200, -0.300, 'O'],
  ['HETATM', 'ZN', 'ZN', 'A', 101, 16.000, 3.000, -4.500, 'Zn'],
  ['HETATM', 'C1', 'LIG', 'A', 201, 14.000, 7.000, -2.000, 'C'], ['HETATM', 'O1', 'LIG', 'A', 201, 14.500, 7.500, -0.900, 'O'], ['HETATM', 'N1', 'LIG', 'A', 201, 13.200, 7.900, -2.600, 'N'],
  ['HETATM', 'O', 'HOH', 'A', 301, 12.000, 3.000, -2.000, 'O'],
];
const lines = ['HEADER    TEST PROTEIN                            15-NOV-26   0TST              ', 'TITLE     TINY TEST STRUCTURE MADE FOR THE UNIT TESTS                         ',
  'HELIX    1   1 ALA A    1  GLY A    2  1                                   2    '];
A.forEach((a, i) => lines.push(atom(a[0], i + 1, a[1], a[2], a[3], a[4], a[5], a[6], a[7], 10 + i, a[8])));
lines.push('END');
w('tiny.pdb', lines.join('\n') + '\n');
fs.writeFileSync(path.join(FIX, 'tiny.pdb.gz'), zlib.gzipSync(lines.join('\n') + '\n'));
// two models (NMR style)
const m2 = ['TITLE     TWO MODELS', 'MODEL        1'];
A.slice(0, 9).forEach((a, i) => m2.push(atom(a[0], i + 1, a[1], a[2], a[3], a[4], a[5], a[6], a[7], 0, a[8])));
m2.push('ENDMDL', 'MODEL        2');
A.slice(0, 9).forEach((a, i) => m2.push(atom(a[0], i + 1, a[1], a[2], a[3], a[4], a[5] + 1, a[6], a[7], 0, a[8])));
m2.push('ENDMDL', 'END');
w('models.pdb', m2.join('\n') + '\n');
// mmCIF with quotes, a text field and two models
w('tiny.cif', `data_0TST
#
_entry.id 0TST
_struct.title
;Tiny test entry with a 'quoted' word
over two lines
;
loop_
_atom_site.group_PDB
_atom_site.id
_atom_site.type_symbol
_atom_site.label_atom_id
_atom_site.label_alt_id
_atom_site.label_comp_id
_atom_site.label_asym_id
_atom_site.label_seq_id
_atom_site.pdbx_PDB_ins_code
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
_atom_site.occupancy
_atom_site.B_iso_or_equiv
_atom_site.auth_seq_id
_atom_site.auth_comp_id
_atom_site.auth_asym_id
_atom_site.auth_atom_id
_atom_site.pdbx_PDB_model_num
ATOM 1 N N . MET A 1 ? 1.000 2.000 3.000 1.00 5.00 10 MET B N 1
ATOM 2 C CA . MET A 1 ? 2.000 2.000 3.000 1.00 6.00 10 MET B CA 1
ATOM 3 C "C5'" . MET A 1 ? 3.000 2.000 3.000 1.00 7.00 10 MET B "C5'" 1
HETATM 4 O O . HOH C . ? 9.000 9.000 9.000 1.00 8.00 501 HOH B O 1
ATOM 1 N N . MET A 1 ? 1.500 2.000 3.000 1.00 5.00 10 MET B N 2
ATOM 2 C CA . MET A 1 ? 2.500 2.000 3.000 1.00 6.00 10 MET B CA 2
ATOM 3 C "C5'" . MET A 1 ? 3.500 2.000 3.000 1.00 7.00 10 MET B "C5'" 2
#
`);
// small-molecule CIF with fractional coordinates (cubic cell, 10 A)
w('salt.cif', `data_salt
_chemical_name_common 'test salt'
_cell_length_a 10.0
_cell_length_b 10.0
_cell_length_c 10.0
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_U_iso_or_equiv
Na1 Na 0.0 0.0 0.0 0.0100(2)
Cl1 Cl 0.5 0.5 0.5 0.0120(3)
`);
// SDF V2000 (water) and V3000 (ammonium, charge) in one file
w('two.sdf', `water
  test

  3  2  0  0  0  0  0  0  0  0999 V2000
    0.0000    0.0000    0.1173 O   0  0  0  0  0  0  0  0  0  0  0  0
    0.0000    0.7572   -0.4692 H   0  0  0  0  0  0  0  0  0  0  0  0
    0.0000   -0.7572   -0.4692 H   0  0  0  0  0  0  0  0  0  0  0  0
  1  2  1  0
  1  3  1  0
M  END
$$$$
ammonium
  test

  0  0  0     0  0            999 V3000
M  V30 BEGIN CTAB
M  V30 COUNTS 5 4 0 0 0
M  V30 BEGIN ATOM
M  V30 1 N 0 0 0 0 CHG=1
M  V30 2 H 0.6 0.6 0.6 0
M  V30 3 H -0.6 -0.6 0.6 0
M  V30 4 H -0.6 0.6 -0.6 0
M  V30 5 H 0.6 -0.6 -0.6 0
M  V30 END ATOM
M  V30 BEGIN BOND
M  V30 1 1 1 2
M  V30 2 1 1 3
M  V30 3 1 1 4
M  V30 4 1 1 5
M  V30 END BOND
M  V30 END CTAB
M  END
$$$$
`);
w('ethanol.mol2', `@<TRIPOS>MOLECULE
ethanol
 3 2 1 0 0
SMALL
NO_CHARGES

@<TRIPOS>ATOM
      1 C1          0.0000    0.0000    0.0000 C.3     1  ETH1        0.0000
      2 C2          1.5200    0.0000    0.0000 C.3     1  ETH1        0.0000
      3 O1          2.0300    1.3400    0.0000 O.3     1  ETH1       -0.4000
@<TRIPOS>BOND
     1     1     2    1
     2     2     3    1
`);
w('frames.xyz', `3
frame one
O 0.0 0.0 0.0
H 0.96 0.0 0.0
H -0.24 0.93 0.0
3
frame two
O 0.0 0.0 0.1
H 0.96 0.0 0.1
8 -0.24 0.93 0.1
`);
w('water.gro', `two waters
    6
    1SOL     OW    1   0.126   1.624   1.679
    1SOL    HW1    2   0.190   1.661   1.747
    1SOL    HW2    3   0.177   1.568   1.613
    2SOL     OW    4   1.275   0.053   0.622
    2SOL    HW1    5   1.337   0.002   0.680
    2SOL    HW2    6   1.326   0.120   0.568
   1.86206   1.86206   1.86206
`);
w('tiny.pqr', `REMARK test pqr
ATOM      1  N   ALA A   1      11.104   6.134  -6.504 -0.3000 1.8240
ATOM      2  CA  ALA A   1      11.639   6.071  -5.147  0.0337 1.9080
ATOM      3  C   ALA     1      13.140   5.814  -5.152  0.5973 1.9080
END
`);
// not structures
fs.writeFileSync(path.join(FIX, 'symbols.pdb'), Buffer.concat([Buffer.from('Microsoft C/C++ MSF 7.00\r\n\x1aDS\0\0\0', 'latin1'), Buffer.alloc(200)]));
fs.writeFileSync(path.join(FIX, 'portable.pdb'), Buffer.concat([Buffer.from('BSJB', 'latin1'), Buffer.from([1, 0, 1, 0, 0, 0, 0, 0]), Buffer.alloc(100)]));
fs.writeFileSync(path.join(FIX, 'database.sdf'), Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x00, 0x01, 0x20, 0x7f]), Buffer.alloc(300, 0x11)]));
w('notes.pdb', 'These are my notes about the project database.\nNothing to see here.\n');
w('broken.xyz', '5\ncomment\nC 0 0 0\nC 1 0 0\n');
console.log('fixtures written to', FIX);
