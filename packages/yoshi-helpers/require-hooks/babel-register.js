const { unprocessedModules } = require('yoshi-config');

require('@babel/register')({
  only: [unprocessedModules],
  babelrc: false,
  configFile: false,
  presets: [require.resolve('babel-preset-yoshi')],
});
