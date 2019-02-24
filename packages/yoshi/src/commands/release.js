const wnpm = require('wnpm-ci');
const { createRunner } = require('haste-core');
const LoggerPlugin = require('../plugins/haste-plugin-yoshi-logger');
const parseArgs = require('minimist');
const fs = require('fs-extra');
const { FEDOPSCONFIG_FILE } = require('yoshi-config/paths');
const fedopsGrapanaApi = require('@wix/fedops-grafana-api');

const cliArgs = parseArgs(process.argv.slice(2));

const shouldBumpMinor = cliArgs.minor;

const runner = createRunner({
  logger: new LoggerPlugin(),
});

const syncFedopsGrafana = async () => {
  if (await fs.pathExists(FEDOPSCONFIG_FILE)) {
    const fedopsJson = await fs.readJson(FEDOPSCONFIG_FILE);
    return fedopsGrapanaApi.sync(fedopsJson);
  }
};

module.exports = runner.command(() => {
  return Promise.all([
    wnpm.prepareForRelease({ shouldBumpMinor }),
    syncFedopsGrafana(),
  ]);
});
