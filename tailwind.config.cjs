module.exports = {
  content: { relative: true, files: ['./views/**/*.ejs', './public/*.js'] },
  theme: { extend: { fontFamily: { sans: ['Comic Neue', 'Arial', 'sans-serif'], comic: ['Bangers', 'Impact', 'sans-serif'] } } },
  // Generated badges and transaction statuses retain their utility selectors.
  safelist: [{ pattern: /^(bg|text|border)-(gray|slate|red|blue|green|yellow|orange|purple|indigo|emerald|amber)-(50|100|200|300|400|500|600|700|800|900|950)$/, variants: ['hover', 'focus', 'peer-checked', 'disabled'] }],
  plugins: []
};
