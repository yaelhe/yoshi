const babelJest = require('babel-jest');

module.exports = babelJest.createTransformer({
  presets: [require.resolve('babel-preset-yoshi')],
  babelrc: false,
  configFile: false,
});
