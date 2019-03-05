const path = require('path');
const globby = require('globby');
const webpack = require('webpack');
const { isObject } = require('lodash');
const nodeExternals = require('webpack-node-externals');
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
const CaseSensitivePathsPlugin = require('case-sensitive-paths-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const StylableWebpackPlugin = require('@stylable/webpack-plugin');
const TpaStyleWebpackPlugin = require('tpa-style-webpack-plugin');
const RtlCssPlugin = require('rtlcss-webpack-plugin');
const typescriptFormatter = require('react-dev-utils/typescriptFormatter');
const WriteFilePlugin = require('write-file-webpack-plugin');
const ModuleNotFoundPlugin = require('react-dev-utils/ModuleNotFoundPlugin');
const OptimizeCSSAssetsPlugin = require('optimize-css-assets-webpack-plugin');
const { localIdentName } = require('../src/constants');
const EnvirnmentMarkPlugin = require('../src/webpack-plugins/environment-mark-plugin');

const {
  ROOT_DIR,
  SRC_DIR,
  BUILD_DIR,
  STATICS_DIR,
  TSCONFIG_FILE,
} = require('yoshi-config/paths');
const project = require('yoshi-config');
const {
  shouldDeployToCDN,
  getProjectCDNBasePath,
  toIdentifier,
  isSingleEntry,
  isProduction: checkIsProduction,
  inTeamCity: checkInTeamCity,
  isTypescriptProject: checkIsTypescriptProject,
  getProjectArtifactId,
  createBabelConfig,
} = require('yoshi-helpers');
const { addEntry, overrideRules } = require('../src/webpack-utils');

const reScript = /\.js?$/;
const reStyle = /\.(css|less|scss|sass)$/;
const reAssets = /\.(png|jpg|jpeg|gif|woff|woff2|ttf|otf|eot|wav|mp3)$/;

const extensions = ['.js', '.jsx', '.ts', '.tsx', '.json'];

const babelConfig = createBabelConfig({ modules: false });

const disableTsThreadOptimization =
  process.env.DISABLE_TS_THREAD_OPTIMIZATION === 'true';

const disableModuleConcat = process.env.DISABLE_MODULE_CONCATENATION === 'true';

const isProduction = checkIsProduction();

const inTeamCity = checkInTeamCity();

const isTypescriptProject = checkIsTypescriptProject();

const isDevelopment = process.env.NODE_ENV === 'development';

const computedSeparateCss =
  project.separateCss === 'prod'
    ? inTeamCity || isProduction
    : project.separateCss;

const artifactVersion = process.env.ARTIFACT_VERSION;

const staticAssetName = 'media/[name].[ext]';

// default public path
let publicPath = '/';

if (!inTeamCity || isDevelopment) {
  // When on local machine or on dev environment,
  // set the local dev-server url as the public path
  publicPath = project.servers.cdn.url;
}

// In case we are running in CI and there is a pom.xml file, change the public path according to the path on the cdn
// The path is created using artifactName from pom.xml and artifact version from an environment param.
if (shouldDeployToCDN()) {
  publicPath = getProjectCDNBasePath();
}

function exists(entry) {
  return (
    globby.sync(`${entry}(${extensions.join('|')})`, {
      cwd: SRC_DIR,
    }).length > 0
  );
}

// NOTE ABOUT PUBLIC PATH USING UNPKG SERVICE
// Projects that uses `wnpm-ci` have their package.json version field on a fixed version which is not their real version
// These projects determine their version on the "release" step, which means they will have a wrong public path
// We currently can't support static public path of packages that deploy to unpkg

const stylableSeparateCss = project.enhancedTpaStyle;

const defaultSplitChunksConfig = {
  chunks: 'all',
  name: 'commons',
  minChunks: 2,
};

const useSplitChunks = project.splitChunks;

const splitChunksConfig = isObject(useSplitChunks)
  ? useSplitChunks
  : defaultSplitChunksConfig;

const entry = project.entry || project.defaultEntry;

const possibleServerEntries = ['./server', '../test/dev-server'];

// Common function to get style loaders
const getStyleLoaders = ({
  embedCss,
  isDebug,

  // Allow overriding defaults
  separateCss = computedSeparateCss,
  hmr = project.hmr,
  tpaStyle = project.tpaStyle,
}) => {
  const cssLoaderOptions = {
    camelCase: true,
    sourceMap: !!separateCss,
    localIdentName: isDebug ? localIdentName.long : localIdentName.short,
    // Make sure every package has unique class names
    hashPrefix: project.name,
    // https://github.com/css-modules/css-modules
    modules: project.cssModules,
    // PostCSS, less-loader, sass-loader and resolve-url-loader, so
    // composition will work with import
    importLoaders: 4 + Number(tpaStyle),
  };

  return [
    {
      test: reStyle,
      exclude: /\.st\.css$/,
      rules: [
        ...(embedCss
          ? [
              // https://github.com/shepherdwind/css-hot-loader
              ...(hmr ? [{ loader: 'css-hot-loader' }] : []),

              // Process every style asset with either `style-loader`
              // or `mini-css-extract-plugin`
              ...(separateCss
                ? [
                    {
                      loader: MiniCssExtractPlugin.loader,
                      options: {
                        // By default it use publicPath in webpackOptions.output
                        // We are overriding it to restore relative paths in url() calls
                        publicPath: '',
                      },
                    },
                  ]
                : [
                    {
                      loader: 'style-loader',
                      options: {
                        // Reuses a single `<style></style>` element
                        singleton: true,
                      },
                    },
                  ]),

              {
                oneOf: [
                  // Files ending with `.global.(css|sass|scss|less)` will be transpiled with
                  // `modules: false`
                  {
                    test: /\.global\.[A-z]*$/,
                    loader: 'css-loader',
                    options: {
                      ...cssLoaderOptions,
                      modules: false,
                    },
                    sideEffects: true,
                  },
                  {
                    // https://github.com/webpack/css-loader
                    loader: 'css-loader',
                    options: cssLoaderOptions,
                  },
                ],
              },
              {
                loader: 'postcss-loader',
                options: {
                  // https://github.com/facebookincubator/create-react-app/issues/2677
                  ident: 'postcss',
                  plugins: [
                    require('autoprefixer')({
                      // https://github.com/browserslist/browserslist
                      browsers: [
                        '> 0.5%',
                        'last 2 versions',
                        'Firefox ESR',
                        'not dead',
                        'ie >= 11',
                      ].join(','),
                      flexbox: 'no-2009',
                    }),
                  ],
                  sourceMap: isDebug,
                },
              },

              // https://github.com/bholloway/resolve-url-loader
              {
                loader: 'resolve-url-loader',
              },
            ]
          : [
              {
                loader: 'css-loader',
                options: {
                  ...cssLoaderOptions,
                  importLoaders: 2 + Number(tpaStyle),
                  exportOnlyLocals: true,
                  sourceMap: false,
                },
              },
            ]),

        // https://github.com/wix/wix-tpa-style-loader
        ...(tpaStyle ? [{ loader: 'wix-tpa-style-loader' }] : []),

        // https://github.com/webpack-contrib/less-loader
        {
          test: /\.less$/,
          loader: 'less-loader',
          options: {
            sourceMap: embedCss,
            paths: ['.', 'node_modules'],
          },
        },

        // https://github.com/webpack-contrib/sass-loader
        {
          test: /\.(scss|sass)$/,
          loader: 'sass-loader',
          options: {
            sourceMap: embedCss,
            includePaths: ['node_modules', 'node_modules/compass-mixins/lib'],
          },
        },
      ],
    },
  ];
};

//
// Common configuration chunk to be used for both
// client-side (client.js) and server-side (server.js) bundles
// -----------------------------------------------------------------------------
function createCommonWebpackConfig({
  isDebug = true,
  isHmr = false,
  withLocalSourceMaps,
} = {}) {
  const config = {
    context: SRC_DIR,

    mode: isProduction ? 'production' : 'development',

    output: {
      path: STATICS_DIR,
      publicPath,
      pathinfo: isDebug,
      filename: isDebug ? '[name].bundle.js' : '[name].bundle.min.js',
      chunkFilename: isDebug ? '[name].chunk.js' : '[name].chunk.min.js',
      hotUpdateMainFilename: 'updates/[hash].hot-update.json',
      hotUpdateChunkFilename: 'updates/[id].[hash].hot-update.js',
    },

    resolve: {
      modules: ['node_modules', SRC_DIR],

      extensions,

      alias: project.resolveAlias,

      // Whether to resolve symlinks to their symlinked location.
      symlinks: false,
    },

    // Since Yoshi doesn't depend on every loader it uses directly, we first look
    // for loaders in Yoshi's `node_modules` and then look at the root `node_modules`
    //
    // See https://github.com/wix/yoshi/pull/392
    resolveLoader: {
      modules: [path.join(__dirname, '../node_modules'), 'node_modules'],
    },

    plugins: [
      // This gives some necessary context to module not found errors, such as
      // the requesting resource
      new ModuleNotFoundPlugin(ROOT_DIR),
      // https://github.com/Urthen/case-sensitive-paths-webpack-plugin
      new CaseSensitivePathsPlugin(),
      // Way of communicating to `babel-preset-yoshi` or `babel-preset-wix` that
      // it should optimize for Webpack
      new EnvirnmentMarkPlugin(),
      // https://github.com/Realytics/fork-ts-checker-webpack-plugin
      ...(isTypescriptProject && project.projectType === 'app' && isDebug
        ? [
            // Since `fork-ts-checker-webpack-plugin` requires you to have
            // TypeScript installed when its required, we only require it if
            // this is a TypeScript project
            new (require('fork-ts-checker-webpack-plugin'))({
              tsconfig: TSCONFIG_FILE,
              async: false,
              silent: true,
              checkSyntacticErrors: true,
              formatter: typescriptFormatter,
            }),
          ]
        : []),
      ...(isHmr ? [new webpack.HotModuleReplacementPlugin()] : []),
    ],

    module: {
      // Makes missing exports an error instead of warning
      strictExportPresence: true,

      rules: [
        // https://github.com/wix/externalize-relative-module-loader
        ...(project.features.externalizeRelativeLodash
          ? [
              {
                test: /[\\/]node_modules[\\/]lodash/,
                loader: 'externalize-relative-module-loader',
              },
            ]
          : []),

        // https://github.com/huston007/ng-annotate-loader
        ...(project.isAngularProject
          ? [
              {
                test: reScript,
                loader: 'ng-annotate-loader',
                include: project.unprocessedModules,
              },
            ]
          : []),

        // Rules for TS / TSX
        {
          test: /\.(ts|tsx)$/,
          exclude: /(node_modules)/,
          use: [
            ...(disableTsThreadOptimization
              ? []
              : [
                  {
                    loader: 'thread-loader',
                    options: {
                      workers: require('os').cpus().length - 1,
                    },
                  },
                ]),

            // https://github.com/huston007/ng-annotate-loader
            ...(project.isAngularProject
              ? [{ loader: 'ng-annotate-loader' }]
              : []),

            {
              loader: 'ts-loader',
              options: {
                // This implicitly sets `transpileOnly` to `true`
                happyPackMode: !disableTsThreadOptimization,
                compilerOptions: project.isAngularProject
                  ? {}
                  : {
                      // force es modules for tree shaking
                      module: 'esnext',
                      // use same module resolution
                      moduleResolution: 'node',
                      // optimize target to latest chrome for local development
                      ...(isDevelopment
                        ? {
                            // allow using Promises, Array.prototype.includes, String.prototype.padStart, etc.
                            lib: ['es2017'],
                            // use async/await instead of embedding polyfills
                            target: 'es2017',
                          }
                        : {}),
                    },
              },
            },
          ],
        },

        // Rules for JS
        {
          test: reScript,
          include: project.unprocessedModules,
          use: [
            {
              loader: 'thread-loader',
              options: {
                workers: require('os').cpus().length - 1,
              },
            },
            {
              loader: 'babel-loader',
              options: {
                ...babelConfig,
              },
            },
          ],
        },

        // Rules for assets
        {
          oneOf: [
            // Inline SVG images into CSS
            {
              test: /\.inline\.svg$/,
              loader: 'svg-inline-loader',
            },

            // Allows you to use two kinds of imports for SVG:
            // import logoUrl from './logo.svg'; gives you the URL.
            // import { ReactComponent as Logo } from './logo.svg'; gives you a component.
            {
              test: /\.svg$/,
              issuer: {
                test: /\.(j|t)sx?$/,
              },
              use: [
                require.resolve('@svgr/webpack'),
                {
                  loader: 'svg-url-loader',
                  options: {
                    iesafe: true,
                    noquotes: true,
                    limit: 10000,
                  },
                },
              ],
            },
            {
              test: /\.svg$/,
              use: [
                {
                  loader: 'svg-url-loader',
                  options: {
                    iesafe: true,
                    limit: 10000,
                  },
                },
              ],
            },
            // Rules for Markdown
            {
              test: /\.md$/,
              loader: 'raw-loader',
            },

            // Rules for HAML
            {
              test: /\.haml$/,
              loader: 'ruby-haml-loader',
            },

            // Rules for HTML
            {
              test: /\.html$/,
              loader: 'html-loader',
            },

            // Rules for GraphQL
            {
              test: /\.(graphql|gql)$/,
              loader: 'graphql-tag/loader',
            },
            // Try to inline assets as base64 or return a public URL to it if it passes
            // the 10kb limit
            {
              test: reAssets,
              loader: 'url-loader',
              options: {
                name: staticAssetName,
                limit: 10000,
              },
            },
          ],
        },
      ],
    },

    // https://webpack.js.org/configuration/stats/
    stats: 'none',

    // https://github.com/webpack/node-libs-browser/tree/master/mock
    node: {
      fs: 'empty',
      net: 'empty',
      tls: 'empty',
      __dirname: true,
    },

    // https://webpack.js.org/configuration/devtool
    // If we are in CI or requested explictly we create full source maps
    // Once we are in a local build, we create cheap eval source map only
    // for a development build (hence the !isProduction)
    devtool:
      inTeamCity || withLocalSourceMaps
        ? 'source-map'
        : !isProduction
        ? 'cheap-module-eval-source-map'
        : false,
  };

  return config;
}

//
// Configuration for the client-side bundle (client.js)
// -----------------------------------------------------------------------------
function createClientWebpackConfig({
  isAnalyze = false,
  isDebug = true,
  isHmr = false,
  withLocalSourceMaps,
} = {}) {
  const config = createCommonWebpackConfig({
    isDebug,
    isHmr,
    withLocalSourceMaps,
  });

  const styleLoaders = getStyleLoaders({ embedCss: true, isDebug });

  const clientConfig = {
    ...config,

    name: 'client',

    target: 'web',

    entry: isSingleEntry(entry) ? { app: entry } : entry,

    optimization: {
      minimize: !isDebug,
      splitChunks: useSplitChunks ? splitChunksConfig : false,
      concatenateModules: isProduction && !disableModuleConcat,
      minimizer: [
        new TerserPlugin({
          // Use multi-process parallel running to improve the build speed
          // Default number of concurrent runs: os.cpus().length - 1
          parallel: true,
          // Enable file caching
          cache: true,
          sourceMap: true,
          terserOptions: {
            output: {
              // support emojis
              ascii_only: true,
            },
            keep_fnames: project.keepFunctionNames,
          },
        }),

        // https://github.com/NMFR/optimize-css-assets-webpack-plugin
        new OptimizeCSSAssetsPlugin(),
      ],
    },

    output: {
      ...config.output,

      // https://github.com/wix/yoshi/pull/497
      jsonpFunction: `webpackJsonp_${toIdentifier(project.name)}`,

      // Bundle as UMD format if the user configured that this is a library
      ...(project.exports
        ? {
            library: project.exports,
            libraryTarget: 'umd',
            globalObject: "(typeof self !== 'undefined' ? self : this)",
          }
        : {}),

      // https://webpack.js.org/configuration/output/#output-umdnameddefine
      umdNamedDefine: project.umdNamedDefine,
    },

    plugins: [
      ...config.plugins,

      // https://github.com/gajus/write-file-webpack-plugin
      new WriteFilePlugin({
        exitOnErrors: false,
        log: false,
        useHashIndex: false,
      }),

      // https://webpack.js.org/plugins/loader-options-plugin
      new webpack.LoaderOptionsPlugin({
        minimize: !isDebug,
      }),

      ...(computedSeparateCss
        ? [
            // https://github.com/webpack-contrib/mini-css-extract-plugin
            new MiniCssExtractPlugin({
              filename: isDebug ? '[name].css' : '[name].min.css',
            }),
            // https://github.com/wix-incubator/tpa-style-webpack-plugin
            ...(project.enhancedTpaStyle ? [new TpaStyleWebpackPlugin()] : []),
            // https://github.com/wix/rtlcss-webpack-plugin
            new RtlCssPlugin(isDebug ? '[name].rtl.css' : '[name].rtl.min.css'),
          ]
        : []),

      // https://webpack.js.org/plugins/define-plugin/
      new webpack.DefinePlugin({
        'process.env.NODE_ENV': JSON.stringify(
          isProduction ? 'production' : 'development',
        ),
        'process.env.IS_MINIFIED': isDebug ? 'false' : 'true',
        'window.__CI_APP_VERSION__': JSON.stringify(
          artifactVersion ? artifactVersion : '0.0.0',
        ),
        'process.env.ARTIFACT_ID': JSON.stringify(getProjectArtifactId()),
      }),

      // https://github.com/jmblog/how-to-optimize-momentjs-with-webpack
      new webpack.IgnorePlugin(/^\.\/locale$/, /moment$/),

      // https://github.com/wix/stylable
      new StylableWebpackPlugin({
        outputCSS: stylableSeparateCss,
        filename: '[name].stylable.bundle.css',
        includeCSSInJS: !stylableSeparateCss,
        optimize: { classNameOptimizations: false, shortNamespaces: false },
        runtimeMode: 'shared',
        globalRuntimeId: '__stylable_yoshi__',
        generate: {
          runtimeStylesheetId: 'namespace',
        },
      }),

      // https://github.com/th0r/webpack-bundle-analyzer
      ...(isAnalyze
        ? [
            new BundleAnalyzerPlugin({
              openAnalyzer: process.env.BROWSER !== 'none',
            }),
          ]
        : []),
    ],

    module: {
      ...config.module,

      rules: [
        ...config.module.rules,

        // Rules for Style Sheets
        ...styleLoaders,
      ],
    },

    externals: project.externals,

    // https://webpack.js.org/configuration/performance
    performance: {
      ...(isProduction
        ? project.performanceBudget || { hints: false }
        : {
            hints: false,
          }),
    },
  };

  if (isHmr) {
    addEntry(clientConfig, [
      require.resolve('webpack/hot/dev-server'),
      require.resolve('webpack-dev-server/client'),
    ]);
  }

  return clientConfig;
}

//
// Configuration for the server-side bundle (server.js)
// -----------------------------------------------------------------------------
function createServerWebpackConfig({ isDebug = true, isHmr = false } = {}) {
  const config = createCommonWebpackConfig({ isDebug, isHmr });

  const styleLoaders = getStyleLoaders({ embedCss: false, isDebug });

  const serverConfig = {
    ...config,

    name: 'server',

    target: 'node',

    entry: {
      server: possibleServerEntries.find(exists) || possibleServerEntries[0],
    },

    output: {
      ...config.output,
      path: BUILD_DIR,
      filename: '[name].js',
      chunkFilename: 'chunks/[name].js',
      libraryTarget: 'umd',
      libraryExport: 'default',
      globalObject: "(typeof self !== 'undefined' ? self : this)",
      // Point sourcemap entries to original disk location (format as URL on Windows)
      devtoolModuleFilenameTemplate: info =>
        path.resolve(info.absoluteResourcePath).replace(/\\/g, '/'),
    },

    // Webpack mutates resolve object, so clone it to avoid issues
    // https://github.com/webpack/webpack/issues/4817
    resolve: {
      ...config.resolve,
    },

    module: {
      ...config.module,

      rules: [
        ...overrideRules(config.module.rules, rule => {
          // Override paths to static assets
          if (rule.loader === 'file-loader' || rule.loader === 'url-loader') {
            return {
              ...rule,
              options: {
                ...rule.options,
                emitFile: false,
              },
            };
          }

          if (rule.loader === 'babel-loader') {
            const serverBabelConfig = createBabelConfig({
              modules: false,
              targets: 'current node',
            });

            return {
              ...rule,
              options: {
                ...serverBabelConfig,
              },
            };
          }

          if (rule.loader === 'ts-loader') {
            return {
              ...rule,
              options: {
                ...rule.options,

                compilerOptions: {
                  ...rule.options.compilerOptions,

                  // allow using Promises, Array.prototype.includes, String.prototype.padStart, etc.
                  lib: ['es2017'],
                  // use async/await instead of embedding polyfills
                  target: 'es2017',
                },
              },
            };
          }

          return rule;
        }),

        // Rules for Style Sheets
        ...styleLoaders,
      ],
    },

    externals: [
      // Treat node modules as external for a small (and fast) server
      // bundle
      nodeExternals({
        whitelist: [reStyle, reAssets, /bootstrap-hot-loader/],
      }),
      // Here for local integration tests as Yoshi's `node_modules`
      // are symlinked locally
      nodeExternals({
        modulesDir: path.resolve(__dirname, '../node_modules'),
      }),
    ],

    plugins: [
      ...config.plugins,

      // https://webpack.js.org/plugins/banner-plugin/
      new webpack.BannerPlugin({
        // https://github.com/evanw/node-source-map-support
        banner: 'require("source-map-support").install();',
        raw: true,
        entryOnly: false,
      }),
    ],

    // https://webpack.js.org/configuration/optimization
    optimization: {
      // Do not modify/set the value of `process.env.NODE_ENV`
      nodeEnv: false,
      // Don't minimize server code at all
      // Faster build time and possibly easier debugging
      minimize: false,
    },

    // Do not replace node globals with polyfills
    // https://webpack.js.org/configuration/node/
    node: {
      console: false,
      global: false,
      process: false,
      Buffer: false,
      __filename: false,
      __dirname: false,
    },

    devtool: 'cheap-module-inline-source-map',
  };

  if (isHmr) {
    addEntry(serverConfig, [require.resolve('./hot')]);
  }

  return serverConfig;
}

module.exports = {
  createCommonWebpackConfig,
  createClientWebpackConfig,
  createServerWebpackConfig,
  getStyleLoaders,
};
