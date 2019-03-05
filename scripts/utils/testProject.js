const path = require('path');
const fs = require('fs-extra');
const execa = require('execa');
const chalk = require('chalk');
const Scripts = require('../../test/scripts');

const ciEnv = {
  BUILD_NUMBER: 1,
  TEAMCITY_VERSION: 1,
  ARTIFACT_VERSION: '1.0.0-SNAPSHOT',
};

const localEnv = {
  BUILD_NUMBER: '',
  TEAMCITY_VERSION: '',
  ARTIFACT_VERSION: '',
};

module.exports = async ({
  templateDirectory,
  testDirectory,
  rootDirectory,
}) => {
  console.log();
  console.log(
    chalk.blue.bold(
      `> Testing ${chalk.underline(path.basename(templateDirectory))}`,
    ),
  );
  console.log();

  const scripts = new Scripts({ testDirectory });

  const options = {
    stdio: 'inherit',
    env: {
      ...process.env,
      TEST_DIRECTORY: testDirectory,
      PORT: scripts.serverProcessPort,
    },
    cwd: templateDirectory,
  };

  const failures = [];

  // Test production build (CI env)
  try {
    console.log(chalk.blue(`> Building project for production`));
    console.log();

    await scripts.build(ciEnv);

    console.log();
    console.log(
      chalk.blue(`> Running app's own tests against production build`),
    );
    console.log();

    await scripts.test(ciEnv);

    console.log();
    console.log(chalk.blue(`> Running production integration tests`));
    console.log();

    const serveResult = await scripts.serve();

    try {
      await execa.shell(
        `npx jest --config='jest.production.config.js' --no-cache --runInBand`,
        options,
      );
    } finally {
      await serveResult.done();
    }
  } catch (error) {
    failures.push(error);
  }

  // Test local build (local env)
  try {
    console.log();
    console.log(chalk.blue(`> Starting project for development`));
    console.log();

    const startResult = await scripts.start(localEnv);

    try {
      console.log();
      console.log(
        chalk.blue(`> Running app's own tests against development build`),
      );
      console.log();

      await scripts.test(localEnv);

      console.log();
      console.log(chalk.blue(`> Running development integration tests`));
      console.log();

      await execa.shell(
        `npx jest --config='jest.development.config.js' --no-cache --runInBand`,
        options,
      );
    } finally {
      await startResult.done();
    }
  } catch (error) {
    failures.push(error);
  }

  // Run additional tests (errors, analyze)
  try {
    console.log();
    console.log(chalk.blue(`> Running additional integration tests`));
    console.log();

    await execa.shell(
      `npx jest --config='jest.plain.config.js' --no-cache --runInBand`,
      options,
    );
  } catch (error) {
    failures.push(error);
  }

  // Clean eventually
  await fs.remove(rootDirectory);

  // Fail testing this project if any errors happened
  if (failures.length > 0) {
    throw new Error(failures.map(error => error.stack).join('\n\n'));
  }
};
