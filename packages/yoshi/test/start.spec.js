const express = require('express');
const { expect } = require('chai');
const { killSpawnProcessAndHisChildren } = require('./helpers/process');
const tp = require('./helpers/test-phases');
const fx = require('./helpers/fixtures');
const fetch = require('node-fetch');
const retryPromise = require('retry-promise').default;
const { outsideTeamCity } = require('./helpers/env-variables');
const https = require('https');

describe('Aggregator: Start', () => {
  let test, child;

  describe('Yoshi', () => {
    beforeEach(() => {
      test = tp.create();
      child = null;
    });

    afterEach(() => {
      test.teardown();
      return killSpawnProcessAndHisChildren(child);
    });

    describe('tests', function() {
      it('should run tests initially', () => {
        child = test
          .setup({
            'src/test.spec.js': '',
            'src/client.js': '',
            'entry.js': '',
            'package.json': fx.packageJson(),
            'pom.xml': fx.pom(),
          })
          .spawn('start');

        return checkStdout('Testing with Mocha');
      });
    });

    describe('process.env', function() {
      it('should have default values', () => {
        const expected = {
          DEBUG: 'wix:*,wnp:*',
          NODE_ENV: 'development',
          PORT: '3000',
        };

        child = test
          .setup({
            'src/client.js': '',
            'index.js': `console.log(JSON.stringify(process.env))`,
            'package.json': fx.packageJson(),
            'pom.xml': fx.pom(),
          })
          .spawn('start');

        return checkServerLogContainsJson(expected);
      });

      it('should override values', () => {
        const expected = {
          DEBUG: 'wixstores:*',
          NODE_ENV: 'dev',
        };

        child = test
          .setup({
            'src/client.js': '',
            'index.js': `console.log(JSON.stringify(process.env))`,
            'package.json': fx.packageJson(),
            'pom.xml': fx.pom(),
          })
          .spawn('start', undefined, { DEBUG: 'wixstores:*', NODE_ENV: 'dev' });

        return checkServerLogContainsJson(expected);
      });
    });

    describe('--debug', () => {
      it('should not pass --inspect flag when parameter is not passed', () => {
        const checkIfInspectIsPassedInArgs = function() {
          return !!process.execArgv.find(arg => arg.indexOf('--inspect') === 0);
        };
        child = test
          .setup({
            'src/client.js': '',
            'index.js': `console.log((${checkIfInspectIsPassedInArgs.toString()})())`,
            'package.json': fx.packageJson(),
            'pom.xml': fx.pom(),
          })
          .spawn('start');

        return checkServerLogContains('false', { backoff: 100 });
      });

      it('should pass --inspect flag when parameter is passed with the correct port', () => {
        const port = 9230;
        const checkIfInspectIsPassedInArgs = function(port) {
          return !!process.execArgv.find(
            arg => arg.indexOf(`--inspect=127.0.0.1:${port}`) === 0,
          );
        };

        child = test
          .setup({
            'src/client.js': '',
            'index.js': `console.log((${checkIfInspectIsPassedInArgs.toString()})(${port}))`,
            'package.json': fx.packageJson(),
            'pom.xml': fx.pom(),
          })
          .spawn('start', `--debug=${port}`);

        return checkServerLogContains('true', { backoff: 100 });
      });
    });

    describe('--entry-point', () => {
      it('should run the entry point provided and add .js to entry if needed', () => {
        child = test
          .setup({
            'src/client.js': '',
            'entry.js': `console.log('hello world!')`,
            'package.json': fx.packageJson(),
            'pom.xml': fx.pom(),
          })
          .spawn('start', '--entry-point=entry');

        return checkServerLogContains('hello world!');
      });

      it('should run index.js by default', () => {
        child = test
          .setup({
            'src/client.js': '',
            'index.js': `console.log('hello world!')`,
            'package.json': fx.packageJson(),
            'pom.xml': fx.pom(),
          })
          .spawn('start');

        return checkServerLogContains('hello world!');
      });
    });

    describe('--no-server', () => {
      it('should not start a server if --no-server is passed', () => {
        child = test
          .setup({
            'src/assets/image.png': '',
            'index.js': `console.log('should not run');`,
            'package.json': fx.packageJson({
              servers: { cdn: { port: 3005 } },
            }),
            '.babelrc': '{}',
          })
          .spawn('start', ['--no-server']);

        return cdnIsServing('assets/image.png').then(() =>
          expect(test.stdout).not.to.contain('should not run'),
        );
      });
    });

    describe('hot reload', () => {
      it('should not run liveReload if liveReload if configured as false', () => {
        child = test
          .setup(
            {
              'src/client.js': `module.exports.wat = 'liveReload';\n`,
              'package.json': fx.packageJson({ liveReload: false }),
            },
            [],
          )
          .spawn('start');

        return checkServerIsServing({ port: 3200, file: 'app.bundle.js' }).then(
          content => expect(content).to.contain(`"reload":false`),
        );
      });
    });

    describe('HMR', () => {
      it('should create bundle with enabled hot module replacement', () => {
        child = test
          .setup({
            'src/client.js': `module.exports.wat = 'hmr';\n`,
            'package.json': fx.packageJson(),
          })
          .spawn('start');

        return checkServerIsServing({ port: 3200, file: 'app.bundle.js' }).then(
          content => expect(content).to.contain('"hot":true'),
        );
      });

      it('should create bundle with disabled hot module replacement if there is {hmr: false} in config', () => {
        child = test
          .setup(
            {
              'src/client.js': `module.exports.wat = 'hmr';\n`,
              'package.json': fx.packageJson({ hmr: false }),
            },
            [],
          )
          .spawn('start');

        return checkServerIsServing({ port: 3200, file: 'app.bundle.js' }).then(
          content => expect(content).to.contain(`"hot":false`),
        );
      });

      it('should wrap react root element with react-hot-loader HOC', () => {
        child = test
          .setup({
            'src/client.js': `import { render } from 'react-dom';
              render(<App />, rootEl);`,
            '.babelrc': `{"presets": ["${require.resolve(
              'babel-preset-wix',
            )}"]}`,
            'package.json': fx.packageJson(
              {
                hmr: 'auto',
                entry: './client.js',
              },
              {
                react: '16.0.0',
              },
            ),
          })
          .spawn('start');
        return checkServerIsServing({ port: 3200, file: 'app.bundle.js' }).then(
          content => {
            expect(content).to.contain('module.hot.accept()');
            expect(content).to.contain('react-hot-loader');
          },
        );
      });

      it('should wrap react root element with react-hot-loader HOC for default entry', () => {
        child = test
          .setup({
            'src/client.js': `import { render } from 'react-dom';
              render(<App />, rootEl);`,
            '.babelrc': `{"presets": ["${require.resolve(
              'babel-preset-wix',
            )}"]}`,
            'package.json': fx.packageJson(
              {
                hmr: 'auto',
              },
              {
                react: '16.0.0',
              },
            ),
          })
          .spawn('start');
        return checkServerIsServing({ port: 3200, file: 'app.bundle.js' }).then(
          content => {
            expect(content).to.contain('module.hot.accept()');
            expect(content).to.contain('react-hot-loader');
          },
        );
      });
    });

    describe('hot reload & HMR', () => {
      it('should not run webpack-hot-client if both hmr and liveReload are configured as false', () => {
        child = test
          .setup(
            {
              'src/client.js': `module.exports.wat = 'liveReload + hmr';\n`,
              'package.json': fx.packageJson({ liveReload: false, hmr: false }),
            },
            [],
          )
          .spawn('start');

        return checkServerIsServing({ port: 3200, file: 'app.bundle.js' }).then(
          content => {
            expect(content).to.not.contain(`"reload":false`);
            expect(content).to.not.contain(`"hot":false`);
          },
        );
      });
    });
    describe('Public path', () => {
      it('should set proper public path', () => {
        child = test
          .setup({
            'src/client.js': `module.exports.wat = 'hmr';\n`,
            'package.json': fx.packageJson(),
          })
          .spawn('start');

        return checkServerIsServing({ port: 3200, file: 'app.bundle.js' }).then(
          content =>
            expect(content).to.contain(
              `__webpack_require__.p = "http://localhost:3200/";`,
            ),
        );
      });

      it('should be able to set public path via servers.cdn.url', () => {
        child = test
          .setup({
            'src/client.js': `module.exports.wat = 'hmr';\n`,
            'package.json': fx.packageJson({
              servers: { cdn: { url: 'some.url' } },
            }),
          })
          .spawn('start');

        return checkServerIsServing({ port: 3200, file: 'app.bundle.js' }).then(
          content =>
            expect(content).to.contain(`__webpack_require__.p = "some.url";`),
        );
      });
    });

    describe('CDN server', () => {
      it('should serve files without "min" suffix when requested with a "min" suffix', () => {
        child = test
          .setup({
            'src/client.js': `module.exports = {};`,
            'package.json': fx.packageJson(),
          })
          .spawn('start');

        return checkServerIsServing({
          port: 3200,
          file: 'app.bundle.min.js',
        }).then(content => {
          expect(content).to.contain(
            `__webpack_require__.p = "http://localhost:3200/";`,
          );
        });
      });

      it('should serve files without "min" suffix when requested with a "min" suffix in ssl', () => {
        child = test
          .setup({
            'src/client.js': `module.exports = {};`,
            'package.json': fx.packageJson({ servers: { cdn: { ssl: true } } }),
          })
          .spawn('start');

        const agent = new https.Agent({
          rejectUnauthorized: false,
        });

        return checkServerIsServing({
          port: 3200,
          file: 'app.bundle.min.js',
          protocol: 'https',
          options: { agent },
        }).then(content =>
          expect(content).to.contain(
            `__webpack_require__.p = "https://localhost:3200/";`,
          ),
        );
      });

      it('should run cdn server with default dir', () => {
        child = test
          .setup({
            'src/assets/test.json': '{a: 1}',
            'src/index.js': 'var a = 1;',
            'package.json': fx.packageJson({
              servers: { cdn: { port: 3005 } },
            }),
          })
          .spawn('start');

        return cdnIsServing('assets/test.json');
      });

      it('should run cdn server with configured dir', () => {
        child = test
          .setup({
            'src/assets/test.json': '{a: 1}',
            'src/index.js': 'var a = 1;',
            'package.json': fx.packageJson({
              servers: { cdn: { port: 3005, dir: 'dist/statics' } },
            }),
          })
          .spawn('start');

        return cdnIsServing('assets/test.json');
      });

      it('should run cdn server from node_modules, on n-build project, using default dir', () => {
        child = test
          .setup({
            'node_modules/my-client-project/dist/test.json': '{a: 1}',
            'src/index.js': 'var a = 1;',
            'package.json': fx.packageJson({
              clientProjectName: 'my-client-project',
              servers: { cdn: { port: 3005 } },
            }),
          })
          .spawn('start');

        return cdnIsServing('test.json');
      });

      it('should run cdn server from node_modules, on n-build project, using configured dir', () => {
        child = test
          .setup({
            'node_modules/my-client-project/dist/statics/test.json': '{a: 1}',
            'src/index.js': 'var a = 1;',
            'package.json': fx.packageJson({
              clientProjectName: 'my-client-project',
              servers: { cdn: { port: 3005, dir: 'dist/statics' } },
            }),
          })
          .spawn('start');

        return cdnIsServing('test.json');
      });

      it('should support cross origin requests headers', () => {
        child = test
          .setup({
            'package.json': fx.packageJson(),
          })
          .spawn('start');

        return fetchCDN().then(res => {
          expect(res.headers.get('Access-Control-Allow-Methods')).to.equal(
            'GET, OPTIONS',
          );
          expect(res.headers.get('Access-Control-Allow-Origin')).to.equal('*');
        });
      });

      it('should support resource timing headers', () => {
        child = test
          .setup({
            'package.json': fx.packageJson(),
          })
          .spawn('start');

        return fetchCDN().then(res => {
          expect(res.headers.get('Timing-Allow-Origin')).to.equal('*');
        });
      });

      describe('HTTPS', () => {
        // This is because we're using self signed certificate - otherwise the request will fail
        const agent = new https.Agent({
          rejectUnauthorized: false,
        });

        it('should be able to create an https server', () => {
          child = test
            .setup({
              'src/assets/test.json': '{a: 1}',
              'src/index.js': 'var a = 1;',
              'package.json': fx.packageJson({
                servers: {
                  cdn: { port: 3005, dir: 'dist/statics', ssl: true },
                },
              }),
            })
            .spawn('start');

          return cdnIsServing('assets/test.json', 3005, 'https', { agent });
        });

        it('should enable ssl when ran --ssl', () => {
          child = test
            .setup({
              'src/assets/test.json': '{a: 1}',
              'src/index.js': 'var a = 1;',
              'package.json': fx.packageJson({
                servers: { cdn: { port: 3005, dir: 'dist/statics' } },
              }),
            })
            .spawn('start', '--ssl');

          return cdnIsServing('assets/test.json', 3005, 'https', { agent });
        });
      });
    });

    describe('when the default port is taken', () => {
      let server;

      beforeEach(() => (server = takePort(3000)));
      afterEach(() => server.close());

      it('it should use the next available port', () => {
        child = test
          .setup({
            'index.js': `console.log('port', process.env.PORT)`,
            'package.json': fx.packageJson(),
          })
          .spawn('start');

        return checkServerLogContains('port 3001');
      });
    });

    describe('Watch', function() {
      this.timeout(30000);

      describe('when using typescript', () => {
        it(`should rebuild and restart server after a file has been changed with typescript files`, () => {
          child = test
            .setup({
              'tsconfig.json': fx.tsconfig(),
              'src/server.ts': `declare var require: any; ${fx.httpServer(
                'hello',
              )}`,
              'src/config.ts': '',
              'src/client.ts': '',
              'index.js': `require('./dist/src/server')`,
              'package.json': fx.packageJson(),
              'pom.xml': fx.pom(),
            })
            .spawn('start');

          return checkServerIsServing({ max: 100 })
            .then(() => checkServerIsRespondingWith('hello'))
            .then(() =>
              test.modify(
                'src/server.ts',
                `declare var require: any; ${fx.httpServer('world')}`,
              ),
            )
            .then(() => {
              return checkServerIsRespondingWith('world');
            });
        });
      });

      describe('when using es6', () => {
        it(`should rebuild and restart server after a file has been changed`, () => {
          child = test
            .setup({
              'src/server.js': fx.httpServer('hello'),
              'src/config.js': '',
              'src/client.js': '',
              'index.js': `require('./src/server')`,
              'package.json': fx.packageJson(),
              'pom.xml': fx.pom(),
              '.babelrc': '{}',
            })
            .spawn('start');

          return checkServerIsServing()
            .then(() => checkServerIsRespondingWith('hello'))
            .then(() => test.modify('src/server.js', fx.httpServer('world')))
            .then(() => checkServerIsRespondingWith('world'));
        });
      });

      describe('when using no transpile', () => {
        it(`should restart server after a file has been changed`, () => {
          child = test
            .setup({
              'src/server.js': fx.httpServer('hello'),
              'src/config.js': '',
              'src/client.js': '',
              'index.js': `require('./src/server')`,
              'package.json': fx.packageJson(),
              'pom.xml': fx.pom(),
            })
            .spawn('start');

          return checkServerIsServing()
            .then(() => checkServerIsRespondingWith('hello'))
            .then(() => test.modify('src/server.js', fx.httpServer('world')))
            .then(() => checkServerIsRespondingWith('world'));
        });
      });

      describe('client side code', () => {
        it('should recreate and serve a bundle after file changes', () => {
          const file = { port: 3200, file: 'app.bundle.js' };
          const newSource = `module.exports = 'wat';\n`;

          child = test
            .setup({
              'src/client.js': `module.exports = function () {};\n`,
              'package.json': fx.packageJson(),
            })
            .spawn('start');

          return checkServerIsServing(file)
            .then(() => test.modify('src/client.js', newSource))
            .then(() => checkServerReturnsDifferentContent(file))
            .then(content => expect(content).to.contain(newSource));
        });
      });

      describe('with --manual-restart flag', () => {
        beforeEach(() => {
          child = test
            .setup({
              'src/someFile.js': '',
              'index.js': `
                console.log('onInit');
                setInterval(() => {}, 1000);
                process.on('SIGHUP', () => console.log('onRestart'));
              `,
              'package.json': fx.packageJson(),
              '.babelrc': '{}',
            })
            .spawn('start', ['--manual-restart']);
        });

        it('should send SIGHUP to entryPoint process on change', () =>
          checkServerLogContains('onInit').then(() =>
            triggerChangeAndCheckForRestartMessage(),
          ));

        it('should not restart server', () =>
          checkServerLogContains('onInit', { backoff: 200 })
            .then(() => triggerChangeAndCheckForRestartMessage())
            .then(() => expect(serverLogContent()).to.not.contain('onInit')));

        function triggerChangeAndCheckForRestartMessage() {
          clearServerLog();
          test.modify('src/someFile.js', ' ');
          return checkServerLogContains('onRestart', { backoff: 200 });
        }
      });
    });

    it('should use yoshi-update-node-version', () => {
      child = test
        .setup({
          'src/test.spec.js': '',
          'src/client.js': '',
          'entry.js': '',
          'package.json': fx.packageJson(),
          'pom.xml': fx.pom(),
        })
        .spawn('start', [], outsideTeamCity);

      return checkServerLogCreated().then(
        () => expect(test.contains('.nvmrc')).to.be.true,
      );
    });

    it(`should use yoshi-clean before building`, () => {
      child = test
        .setup({
          'dist/src/old.js': `const hello = "world!";`,
          'src/new.js': 'const world = "hello!";',
          'package.json': fx.packageJson(),
          '.babelrc': '{}',
        })
        .spawn('start');

      return checkServerLogCreated().then(() => {
        expect(test.stdout).to.contains(`Finished 'clean'`);
        expect(test.list('dist')).to.not.include('old.js');
        expect(test.list('dist/src')).to.include('new.js');
      });
    });

    describe('when there are runtime errors', () => {
      it('should display a warning message on the terminal', () => {
        child = test
          .setup({
            'index.js': `throw new Error('wix:error')`,
            'package.json': fx.packageJson(),
            'pom.xml': fx.pom(),
          })
          .spawn('start');

        return checkServerLogCreated()
          .then(wait(1000))
          .then(() =>
            expect(test.stdout).to.contains(
              `There are errors! Please check ./target/server.log`,
            ),
          );
      });
    });

    describe('Migrate Bower Artifactory', () => {
      it('should migrate .bowerrc', () => {
        const bowerrc = {
          registry: {
            search: [
              'https://bower.herokuapp.com',
              'http://wix:wix@mirror.wixpress.com:3333',
            ],
            register: 'http://wix:wix@mirror.wixpress.com:3333',
            publish: 'http://wix:wix@mirror.wixpress.com:3333',
          },
        };

        child = test
          .setup({
            'package.json': fx.packageJson(),
            '.bowerrc': JSON.stringify(bowerrc, null, 2),
          })
          .spawn('start');

        return retryPromise({ backoff: 100 }, () => {
          try {
            const newBowerrc = JSON.parse(test.content('.bowerrc'));
            expect(newBowerrc).to.eql({
              registry: 'https://bower.dev.wixpress.com',
              resolvers: ['bower-art-resolver'],
            });

            const newPj = JSON.parse(test.content('package.json'));
            expect(newPj.devDependencies['bower-art-resolver']).to.exist;
            return Promise.resolve();
          } catch (e) {
            return Promise.reject(e);
          }
        });
      });
    });
  });

  function checkServerLogCreated({ backoff = 100 } = {}) {
    return retryPromise(
      { backoff },
      () =>
        test.contains('target/server.log')
          ? Promise.resolve()
          : Promise.reject(new Error('No server.log found')),
    );
  }

  function serverLogContent() {
    return test.content('target/server.log');
  }

  function clearServerLog() {
    test.write('target/server.log', '');
  }

  function checkServerLogContains(str, { backoff = 100 } = {}) {
    return checkServerLogCreated({ backoff }).then(() =>
      retryPromise({ backoff }, () => {
        const content = serverLogContent();

        return content.includes(str)
          ? Promise.resolve()
          : Promise.reject(
              new Error(
                `Expect server.log to contain "${str}", got "${content}" instead`,
              ),
            );
      }),
    );
  }

  function checkServerLogContainsJson(expected, { backoff = 100 } = {}) {
    return checkServerLogCreated({ backoff }).then(() =>
      retryPromise({ backoff }, async () => {
        const content = serverLogContent();
        const json = JSON.parse(content);

        return expect(json).to.include(expected);
      }),
    );
  }

  function checkStdout(str) {
    return retryPromise(
      { backoff: 100 },
      () =>
        test.stdout.indexOf(str) > -1 ? Promise.resolve() : Promise.reject(),
    );
  }

  function takePort(port) {
    return express().listen(port);
  }

  function fetchCDN(port) {
    port = port || 3200;
    return retryPromise({ backoff: 100 }, () =>
      fetch(`http://localhost:${port}/`),
    );
  }

  function cdnIsServing(name, port = 3005, protocol = 'http', options = {}) {
    return retryPromise({ backoff: 100 }, () =>
      fetch(`${protocol}://localhost:${port}/${name}`, options).then(res => {
        expect(res.status).to.equal(200);
        return res.text();
      }),
    );
  }

  function checkServerIsRespondingWith(expected) {
    return retryPromise({ backoff: 1000 }, () =>
      fetch(`http://localhost:${fx.defaultServerPort()}/`)
        .then(res => res.text())
        .then(
          body => (body === expected ? Promise.resolve() : Promise.reject()),
        ),
    );
  }

  function wait(time) {
    return () => new Promise(resolve => setTimeout(resolve, time));
  }

  function checkServerIsServing({
    backoff = 100,
    max = 10,
    port = fx.defaultServerPort(),
    file = '',
    protocol = 'http',
    options = {},
  } = {}) {
    return retryPromise({ backoff, max }, () =>
      fetch(`${protocol}://localhost:${port}/${file}`, options).then(res =>
        res.text(),
      ),
    );
  }

  function checkServerReturnsDifferentContent({
    backoff = 100,
    max = 10,
    port = fx.defaultServerPort(),
    file = '',
  } = {}) {
    const url = `http://localhost:${port}/${file}`;
    let response;
    return retryPromise(
      { backoff, max },
      () =>
        new Promise((resolve, reject) =>
          fetch(url)
            .then(res => res.text())
            .then(content => {
              if (response && response !== content) {
                resolve(content);
              } else {
                reject(`response of ${url} did not change`);
              }
              response = content;
            })
            .catch(reject),
        ),
    );
  }
});