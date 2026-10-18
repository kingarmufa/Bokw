'use strict';
const catalogue = require('../public/comic-templates');
const PALETTE = catalogue.get('default').palette;
const THEMES = Object.freeze(['yellow', 'black', 'white', 'green']);
const PARTICLES = Object.freeze(['pow', 'halloween', 'lebaran', 'imlek', 'cosmic', 'ocean', 'stars', 'dots', 'speed', 'none', 'galaxy', 'sakura', 'neon', 'arcade', 'graffiti', 'mecha', 'aurora']);
// Legacy fields remain readable in MongoDB. Old records use KOMIK DEFAULT.
module.exports = { PALETTE, THEMES, PARTICLES, TEMPLATE_IDS: catalogue.ids,
  TEMPLATES: catalogue.templates, normalizeComicSettings: catalogue.normalize };
