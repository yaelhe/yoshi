const { unprocessedModules } = require('yoshi-config');
const { createBabelConfig } = require('yoshi-helpers');

const babelConfig = createBabelConfig();

require('@babel/register')({
  only: [unprocessedModules],
  ...babelConfig,
});
