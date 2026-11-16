# PDB Viewer & Protein Structure 0.1.0 (zovo.zovo-pdb-viewer)

New listing, staged only. NICHE6 row 4, built by lane NEWB13.

- vsix: out/NEWB13-dist/zovo.zovo-pdb-viewer/zovo.zovo-pdb-viewer-0.1.0.vsix
- sha256: 6e26a197e14a0dccf34f94e16ea0e904feea7baab461390ca72beadfbb1387cf (602,739 bytes, 40 files)
- Product repo: factory/products/pdb-viewer-vscode, local commits only (no remote).
- Unit tests: 250 of 250 pass with `npm test` (scripts/test.js). `node --test` in the repo root runs 252 of 252.
- Real-app gate: VS Code 1.142.0 on port 9444 through buildslot, run r1 on this exact vsix: 83 PASS, 0 FAIL (out/NEWB13-data/pdb/pdb-gate-r1.json and .tsv, gate-r1.log, screenshots in out/NEWB13-data/pdb/shots/pdb-r1-*.png). Earlier runs: dev1 (51 PASS, 9 FAIL, then the gate script crashed) and dev2 (83 PASS, 0 FAIL).

## What it is

- Display name: PDB Viewer & Protein Structure (30 characters). The phrase "pdb viewer" comes first, and the description starts with "PDB viewer".
- Keywords: pdb, protein, molecule, mmcif, bioinformatics. Engines: ^1.75.0. Activation: onUri plus the custom editor and commands (no "*", no onStartupFinished).
- Free core: a read-only custom editor (default) for .pdb, .ent, .pdb1, .cif, .mmcif, .mcif, .pqr, .sdf, .mol, .mol2, .xyz, .gro and .pdb.gz, .ent.gz, .cif.gz, .mmcif.gz. The 3D view uses 3Dmol.js 2.5.5 (BSD-3-Clause, vendored in lib/): cartoon, ball and stick, sticks, spheres, lines and a surface, colored by chain, residue, element, B-factor or secondary structure. A side tree of chains, residues and ligands with a filter and atom lists. Click an atom to see its name, element, residue, chain, serial, coordinates and B-factor. There is a sequence strip linked both ways and a model or frame picker for NMR entries and multi-frame files. The file is read through VS Code's file system API, so it works in Remote SSH and WSL windows. A .pdb that is a debug symbol file (MSF 7.00, MSF 2.00, .NET BSJB) gets a plain note with buttons and no error.
- Zovo Pro tools (1 free try each, module 2026-11-15.tries1, listing tag "pdb", tries key pdbViewer.proTrial, TRIAL_USES = 1 in src/pro.js):
  - Measure: distances, angles and dihedrals by clicking atoms, H-bond candidates and contacts within a chosen distance, drawn in 3D and saved as CSV.
  - Superpose and RMSD: fits a second structure on sequence-matched C-alpha atoms. You get the RMSD overall, per chain and per residue, both models overlaid in 3D, a CSV table and the moved structure as PDB.
  - Binding site report: residues within N angstrom of a ligand with closest atoms, contact and H-bond candidate counts, a focused 3D view, a CSV table and a PNG with a transparent background.
- The 4th row tool (publication images and GIF movies) was not built.
- Nothing pops up on open. No network calls: webview CSP default-src 'none', nonce scripts, no fetch or socket code. The Pro panel shows only after a click on a Pro tool with no tries left.

## Samples used

- Shipped: samples/1hsg.pdb and samples/1crn.cif (RCSB PDB entries 1HSG and 1CRN, CC0 1.0).
- Unit-test fixtures (ours, not in the vsix): test/fixtures (tiny PDB, PQR, mmCIF, small-molecule CIF, SDF, MOL2, XYZ frames, GRO, models, gzip, a debug symbol header, a portable PDB header, a binary .sdf, a text file named .pdb).
- Real-app gate (not shipped, downloaded once into newb13-work/pdb/dl, each in its own folder, never executed):
  - RCSB PDB (CC0 1.0): 1CRN.pdb, 1UBQ.pdb, 4HHB.pdb, 4HHB.cif, 1D3Z.cif (NMR, 10 models), 1UBQ.cif.gz, MK1_ideal.sdf (ligand MK1)
  - PubChem CID 2519, caffeine 3D SDF (public domain)
  - 3Dmol.js test structures (BSD-3-Clause): benzene.mol2, h-bn.mol2, multiple2.xyz, styled_pyridine_v3000.sdf, fullerene.sdf, m.pqr
  - GROMACS spc216.gro water box (from the GROMACS distribution, LGPL-2.1)
  - Debug symbol files: foo.pdb from the getsentry/pdb test fixtures (MIT or Apache-2.0) and Newtonsoft.Json.pdb from the Newtonsoft.Json .snupkg on nuget.org (MIT)
  - The first build session did not write down the exact download URLs. The sources above come from the folder names and the file contents.

## Gate coverage (r1)

Nothing pops up on start. 1HSG opens by default in the viewer. The gate checks the WebGL pixels, the atom count against the file, the chains, ligand and waters in the tree, and the sequence strip against the file. It clicks in the tree and the strip, lists a residue's atoms and clicks an atom in the 3D canvas, then compares name, chain, residue and B-factor with the file line. Each style and color is checked to draw something different, B-factor coloring has red and blue, and the surface, water and filter are checked. 15 files (14 real, 1 ours) in 7 formats open with atom counts checked against the file. The 1D3Z NMR models show one at a time and the last model redraws, as do the XYZ frames. Single-model files show no model picker. Two real debug symbol .pdb files, a text file named .pdb, a binary .sdf, an empty file and a cut PDB each give a clear note. The Explorer right-click on 1CRN.PDB shows the 3 Zovo Pro entries. For each Pro tool, use A runs fully and its output is checked against values worked out by the gate: the distance and the H-bond count with the CSV, the RMSD by its own Kabsch with the CSV and the moved PDB, and the 26 binding-site residues with the CSV and an RGBA PNG. Use B on a different file opens the Pro panel. The info tab shows "no free tries left" for all 3 tools. After a restart of VS Code with the same profile the counts stay. At the end there are no error toasts, no notification from the extension, no webview network requests, no extension host sockets, no console or CSP errors, no URL opened and no gate process left.

## Defects found and fixed in the gate runs

- Product: B-factor coloring showed no red on 1HSG, because the color range came from all atoms and waters stretched it. It now uses the 5 to 95 % range of the polymer atoms.
- Product: a multi-model mmCIF (1D3Z) drew all 10 models on top of each other, so the model picker changed nothing. The 3D view now gets the models as PDB MODEL blocks and shows one at a time.
- Product: a PQR of one HETATM UNK molecule (m.pqr) counted as a protein residue, so cartoon drew nothing. A HETATM UNK group with no C-alpha is now a ligand and is drawn.
- Product: a GROMACS water box (spc216.gro) drew nothing because waters are hidden by default. A file of only water now shows its waters.
- Product (small): an empty Model picker showed for single-model files (the CSS display rule beat the hidden attribute).
- Gate: the Superpose step in dev1 got no pick list after the Command Palette step. The cause was not found. The gate now starts Superpose from the viewer's Pro row, as a user would, and logs the palette result for the other steps. The gate also no longer crashes when a panel does not open (null webview guard).

## Known limits

- Hydrogen bonds are candidates by N/O distance only. Hydrogen positions and angles are not checked.
- Superpose pairs chains by sequence and fits C-alpha (or C4' for nucleic acids) atoms only. Small molecules cannot be superposed.
- Multi-model mmCIF files are handed to the 3D view as PDB text, so chain IDs longer than one character and residue names longer than three are cut in the 3D view of those files (the tree and the tools use the full names).
- Publication images and GIF movies (row tool 4) are not part of this release.
- The gate drove Save dialogs through VS Code's simple file dialog, not the native macOS dialog.
