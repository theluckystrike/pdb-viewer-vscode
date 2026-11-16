'use strict';
// REACH1: this listing's Pro tools for the viewer toolbar row and the Explorer entries (src/reach.js).
module.exports = {
  prefix: 'pdbViewer',
  triesKey: 'pdbViewer.proTrial',
  slot: '#toolbar',
  tools: [
    { id: 'measure', title: 'Measure', command: 'pdbViewer.measure' },
    { id: 'superpose', title: 'Superpose and RMSD', command: 'pdbViewer.superpose' },
    { id: 'bindingSite', title: 'Binding site report', command: 'pdbViewer.bindingSite' },
  ],
};
