var gulp = require('gulp');
var gutil = require('gulp-util');
var jasmine = require('gulp-jasmine');
var jasmineReporters = require('jasmine-reporters');
var browserify = require('browserify');
var _string = require('underscore.string');
var fs = require('fs');
var cwd = process.cwd();
var args = require('./internal/args');
var logger = require('./internal/logger');
var notifier = require('./internal/notifier');
var paths = require('./internal/paths');
var dependencies = require('./internal/dependecies');
var maven = require('./internal/maven');
var bundlegen = require('./internal/bundlegen');
var testWebServer;
var skipBundle = skipBundle();
var skipTest = (args.isArgvSpecified('--skipTest') || args.isArgvSpecified('--skipTests'));
var packageJson = require(cwd + '/package.json');

var bundles = []; // see exports.bundle function
var bundleDependencyTaskNames = ['log-env'];

var rebundleRunning = false;
var retestRunning = false;

// Make this builder instance globally available.
global.__builder = exports;

logger.logInfo('**********************************************************************');
logger.logInfo('This build is using Jenkins JS Builder.');
logger.logInfo('  For command line options and other help, go to');
logger.logInfo('  https://www.npmjs.com/package/@jenkins-cd/js-builder');
logger.logInfo('**********************************************************************');

if (maven.isMavenProject) {
    logger.logInfo("Maven project.");
    if (maven.isHPI()) {
        logger.logInfo("\t- Jenkins plugin (HPI): " + maven.getArtifactId());
    }
}

exports.gulp = gulp;
exports.browserify = browserify;

// Expose the internal modules.
exports.logger = logger;
exports.paths = paths;
exports.dependencies = dependencies;
exports.maven = maven;
exports.args = args;

var langConfig = require('./internal/langConfig');
var lintConfig = {
    level: 'configured',
    src: true,
    tests: false
};

exports.isRebundle = function() {
    return rebundleRunning;
};

exports.isRetest = function() {
    return retestRunning;
};

/**
 * Set the JavaScript language configuration.
 */
exports.lang = function(config) {
    if (typeof config === 'number') {
        langConfig.ecmaVersion = parseInt(config);
    } else if (typeof config === 'string') {
        if (config === 'es5') {
            langConfig.ecmaVersion = 5;
        } else if (config === 'es6') {
            langConfig.ecmaVersion = 6;
        } else if (config === 'react') {
            langConfig.ecmaVersion = 6;
        }
    } else {
        if (config.ecmaVersion) {
            langConfig.ecmaVersion = config.ecmaVersion;
        }
    }
    return exports;
};

/**
 * Set the lint config.
 * @param config The lint config. A string of "none", "configured", or
 * an .
 */
exports.lint = function(config) {
    if (typeof config === 'string') {
        if (config === 'none') {
            lintConfig.level = 'none';
        }
    } else {
        if (config.src) {
            lintConfig.src = config.src;
        }
        if (config.tests) {
            lintConfig.tests = config.tests;
        }
    }
};

exports.defineTasks = function(tasknames) {
    if (!tasknames) {
        tasknames = ['test'];
    }

    var envLogged = false;
    gulp.task('log-env', function() {
        if (envLogged === false) {
            logger.logInfo("Source Dirs:");
            logger.logInfo(" - src: " + paths.srcPaths);
            logger.logInfo(" - test: " + paths.testSrcPath);
            envLogged = true;
        }
    });

    var defaults = [];

    for (var i = 0; i < tasknames.length; i++) {
        var taskname = tasknames[i];
        var gulpTask = tasks[taskname];

        if (!gulpTask) {
            throw "Unknown gulp task '" + taskname + "'.";
        }

        exports.defineTask(taskname, gulpTask);
        if (taskname === 'lint' || taskname === 'test' || taskname === 'bundle') {
            defaults.push(taskname);
        }
    }

    if (defaults.length > 0) {
        logger.logInfo('Defining default tasks...');
        gulp.task('default', defaults);
    }
};

exports.defineTask = function(taskname, gulpTask) {
    if (taskname === 'test') {
        if (!skipTest) {
            // Want to make sure the 'bundle' task gets run with the 'test' task.
            gulp.task('test', ['bundle'], gulpTask);
        }
    } else if (taskname === 'bundle') {
        if (!skipBundle) {
            // Define the bundle task so that it depends on the "sub" bundle tasks.
            gulp.task('bundle', bundleDependencyTaskNames, gulpTask);
        }
    } else if (taskname === 'bundle:watch') {
        // Run bundle at the start of bundle:watch
        gulp.task('bundle:watch', ['bundle'], gulpTask);
    } else if (taskname === 'test:watch') {
        // Run test at the start of test:watch
        gulp.task('test:watch', ['test'], gulpTask);
    } else {
        gulp.task(taskname, gulpTask);
    }
};

exports.defineBundleTask = function(taskname, gulpTask) {
    var bundleTaskName = taskname + '_bundle_' + bundleDependencyTaskNames.length;
    
    bundleDependencyTaskNames.push(bundleTaskName);
    exports.defineTask(bundleTaskName, gulpTask);
    // Define the 'bundle' task again so it picks up the new dependency
    exports.defineTask('bundle', tasks.bundle);
};

exports.src = function(newPaths) {
    if (newPaths) {
        paths.srcPaths = [];
        if (typeof newPaths === 'string') {
            paths.srcPaths.push(normalizePath(newPaths));
        } else if (newPaths.constructor === Array) {
            for (var i = 0; i < newPaths.length; i++) {
                paths.srcPaths.push(normalizePath(newPaths[i]));
            }
        }
    }
    return paths.srcPaths;
};

exports.tests = function(newPath) {
    if (newPath) {
        paths.testSrcPath = normalizePath(newPath);
    }
    return paths.testSrcPath;
};

exports.startTestWebServer = function(config) {
    _stopTestWebServer();
    _startTestWebServer(config);
    logger.logInfo("\t(call require('gulp').emit('testing_completed') when testing is completed - watch async test execution)");
};

exports.onTaskStart = function(taskName, callback) {
    gulp.on('task_start', function(event) {
        if (event.task === taskName) {
            callback();
        }
    });
};

exports.onTaskEnd = function(taskName, callback) {
    gulp.on('task_stop', function(event) {
        if (event.task === taskName) {
            callback();
        }
    });
};

exports.import = function(module, to, config) {
    var moduleMapping = toModuleMapping(module, to, config);
    if (moduleMapping) {
        bundlegen.addGlobalImportMapping(moduleMapping);
    }
    return exports;
};

exports.export = function(module) {
    bundlegen.addGlobalExportMapping(module);
    return exports;
};

exports.withExternalModuleMapping = function(from, to, config) {
    logger.logWarn('DEPRECATED use of builder.withExternalModuleMapping function. Change to builder.import.');
    return exports.import(from, to, config);
};

/**
 * Add a listener to be called just before Browserify starts bundling.
 * <p>
 * The listener is called with the {@code bundle} as {@code this} and
 * the {@code bundler} as as the only arg.
 *
 * @param listener The listener to add.
 */
exports.onPreBundle = function(listener) {
    bundlegen.onPreBundle(listener);
    return exports;
};

function normalizePath(path) {
    path = _string.ltrim(path, './');
    path = _string.ltrim(path, '/');
    path = _string.rtrim(path, '/');

    return path;
}

exports.bundle = function(resource, as) {
    if (_string.endsWith(resource, '.css')) {
        return bundleCss(resource, 'css', as);
    } if (_string.endsWith(resource, '.less')) {
        return bundleCss(resource, 'less', as);
    } else {
        return bundleJs(resource, as);
    }
};

function bundleJs(moduleToBundle, as) {
    if (!moduleToBundle) {
        gutil.log(gutil.colors.red("Error: Invalid bundle registration for module 'moduleToBundle' must be specify."));
        throw "'bundle' registration failed. See error above.";
    }

    var bundle = {};

    bundle.js = _string.strRightBack(moduleToBundle, '/'); // The short name of the javascript file (with extension but without path)
    bundle.module = _string.strLeftBack(bundle.js, '.js'); // The short name with the .js extension removed
    bundle.bundleDependencyModule = (moduleToBundle === bundle.module); // The specified module to bundle is the name of a module dependency.

    if (!as) {
        bundle.as = bundle.module;
    } else {
        bundle.as = _string.strLeftBack(as, '.js');
    }

    function assertBundleOutputUndefined() {
        if (bundle.bundleInDir) {
            gutil.log(gutil.colors.red("Error: Invalid bundle registration. Bundle output (inDir) already defined."));
            throw "'bundle' registration failed. See error above.";
        }
    }

    bundle.bundleModule = moduleToBundle;
    bundle.bundleOutputFile = bundle.as + '.js';
    bundle.moduleMappings = [];
    bundle.moduleExports = [];
    bundle.exportEmptyModule = true;
    bundle.useGlobalModuleMappings = true;
    bundle.minifyBundle = args.isArgvSpecified('--minify');
    bundle.generateNoImportsBundle = function() {
        if (skipBundle) {
            return bundle;
        }
        // Create a self contained version of the bundle (no imports) - useful for
        // testing and probably more.
        defineJSBundleTask(bundle, false);
        return bundle;
    };
    bundle.minify = function() {
        if (skipBundle) {
            return bundle;
        }
        bundle.minifyBundle = true;
        return bundle;
    };
    bundle.inDir = function(dir) {
        if (skipBundle) {
            return bundle;
        }
        if (!dir) {
            gutil.log(gutil.colors.red("Error: Invalid bundle registration for module '" + moduleToBundle + "'. You can't specify a 'null' dir name when calling inDir."));
            throw "'bundle' registration failed. See error above.";
        }
        assertBundleOutputUndefined();
        bundle.bundleInDir = normalizePath(dir);
        if (bundle.isDuplicate === false) {
            gutil.log(gutil.colors.green("Bundle of '" + moduleToBundle + "' will be generated in directory '" + bundle.bundleInDir + "' as '" + bundle.as + ".js'."));
        }
        return bundle;
    };
    bundle.withTransforms = function(transforms) {
        if (skipBundle) {
            return bundle;
        }
        bundle.bundleTransforms = transforms;
        return bundle;
    };
    
    bundle.ignoreGlobalModuleMappings = function() {
        bundle.useGlobalModuleMappings = false;
        return bundle;
    };
    
    bundle.noEmptyModuleExport = function() {
        bundle.exportEmptyModule = false;
        return bundle;
    };
    
    bundle._import = function(moduleMapping) {
        if (skipBundle) {
            return bundle;
        }
        if (moduleMapping.to === bundle.getModuleQName()) {
            // Do not add mappings to itself.
            return bundle;
        }

        for (var i in bundle.moduleMappings) {
            if (bundle.moduleMappings[i].from === moduleMapping.from) {
                logger.logWarn('Ignoring require mapping of "' + moduleMapping.from + '" to "' + moduleMapping.to + '". The bundle already has a mapping for "' + moduleMapping.from + '".');
                return bundle;
            }
        }

        bundle.moduleMappings.push(moduleMapping);
        return bundle;
    };
    
    bundle.import = function(module, to, config) {
        var moduleMapping = toModuleMapping(module, to, config);
        bundle._import(moduleMapping);
        return bundle;
    };

    bundle.withExternalModuleMapping = function(from, to, config) {
        logger.logWarn('DEPRECATED use of bundle.withExternalModuleMapping function. Change to bundle.import.');
        return bundle.import(from, to, config);
    };

    bundle.less = function(src, targetDir) {
        if (skipBundle) {
            return bundle;
        }
        bundle.lessSrcPath = src;
        if (targetDir) {
            bundle.lessTargetDir = targetDir;
        }
        return bundle;
    };
    bundle.namespace = function(toNamespace) {
        bundle.bundleExportNamespace = toNamespace;
        return bundle;
    };
    bundle.export = function(moduleName) {
        if (skipBundle) {
            return bundle;
        }
        dependencies.assertHasJenkinsJsModulesDependency('Cannot bundle "export".');

        if (moduleName) {
            if (moduleName === packageJson.name) {
                // We are exporting the top/entry level module of the generated bundle.
                // This is the "traditional" export use case.
                bundle.bundleExport = true;
                bundle.bundleExportNamespace = packageJson.name;
            } else if (dependencies.getDependency(moduleName) !== undefined) {
                // We are exporting some dependency of this module Vs exporting
                // the top/entry level module of the generated bundle. This allows the bundle
                // to control loading of a specific dependency (or set of) and then share that with
                // other bundles, which is needed where we have "singleton" type modules
                // e.g. react and react-dom.
                bundle.moduleExports.push(moduleName);
            } else {
                logger.logError("Error: Cannot export module '" + moduleName + "' - not the name of this module or one of it's dependencies.");
                logger.logError("       (if '" + moduleName + "' is the namespace you want to export to, use the 'bundle.namespace' function)");
            }
        } else {
            if (bundle.bundleExportNamespace) {
                bundle.bundleExport = true;
            } else if (maven.isMavenProject) {
                bundle.bundleExport = true;
                // Use the maven artifactId as the namespace.
                bundle.bundleExportNamespace = maven.getArtifactId();
                if (!maven.isHPI()) {
                    logger.logWarn("\t- Bundling process will use the maven pom artifactId ('" + bundle.bundleExportNamespace + "') as the bundle export namespace. You can specify a namespace as a parameter to the 'export' method call.");
                }
            } else {
                logger.logError("Error: This is not a maven project. You must define a namespace via the 'namespace' function on the bundle.");
                return;
            }
            logger.logInfo("\t- Bundle will be exported as '" + bundle.bundleExportNamespace + ":" + bundle.as + "'.");
        }
    };

    bundle.getModuleQName = function() {
        if (bundle.bundleExportNamespace) {
            return bundle.bundleExportNamespace + ':' + bundle.as;
        } else {
            return 'undefined:' + bundle.as;
        }
    };

    bundle.findModuleMapping = function(from) {
        var moduleMappings = bundle.moduleMappings;
        for (var i = 0; i < moduleMappings.length; i++) {
            var mapping = moduleMappings[i];
            if (from === mapping.from) {
                return mapping;
            }
        }
        return undefined;
    };

    if (skipBundle) {
        return bundle;
    }

    bundle.isDuplicate = false;
    for (var i = 0; i < bundles.length; i++) {
        if (bundles[i].bundleModule === bundle.bundleModule && bundles[i].as === bundle.as) {
            bundle.isDuplicate = true;
            break;
        }
    }
    
    if (bundle.isDuplicate === true) {
        // Just return the bundle object, but do not register a task
        // for creating it.
        return bundle;
    }
    
    bundles.push(bundle);

    function defineJSBundleTask(bundle, applyImports) {
        var bundleTaskName = 'js_bundle_' + bundle.as;

        if (!applyImports) {
            bundleTaskName += '_no_imports';
        }

        exports.defineBundleTask(bundleTaskName, function() {
            if (!bundle.bundleInDir) {
                var adjunctBase = setAdjunctInDir(bundle);
                logger.logInfo('Javascript bundle "' + bundle.as + '" will be available in Jenkins as adjunct "' + adjunctBase + '.' + bundle.as + '".')
            }

            // Add all global mappings.
            if (bundle.useGlobalModuleMappings === true) {
                for (var i = 0; i < globalModuleMappingArgs.length; i++) {
                    bundle._withExternalModuleMapping(globalModuleMappingArgs[i]);
                }
            }

            var bundleTo = bundle.bundleInDir;

            if (!applyImports) {
                bundleTo += '/no_imports';
            }

            // Only process LESS when generating the bundle containing imports. If using the "no_imports" bundle, you
            // need to take care of adding the CSS yourself.
            if (applyImports && bundle.lessSrcPath) {
                var lessBundleTo = bundleTo;

                if (bundle.lessTargetDir) {
                    lessBundleTo = bundle.lessTargetDir;
                }

                less(bundle.lessSrcPath, lessBundleTo);
            }

            var fileToBundle = bundle.bundleModule;
            if (bundle.bundleDependencyModule) {
                // Lets generate a temp file containing the module require.
                if (!fs.existsSync('target')) {
                    fs.mkdirSync('target');
                }
                fileToBundle = 'target/' + bundle.bundleOutputFile;
                fs.writeFileSync(fileToBundle, "module.exports = require('" + bundle.module + "');");
            }

            var fullPaths = args.isArgvSpecified('--full-paths');
            
            var browserifyConfig = {
                entries: [fileToBundle],
                extensions: ['.js', '.es6', '.jsx', '.hbs'],
                cache: {},
                packageCache: {},
                fullPaths: fullPaths
            };
            if (bundle.minifyBundle === true) {
                browserifyConfig.debug = true;
            }
            var bundler = browserify(browserifyConfig);

            var hasJSX = paths.hasSourceFiles('jsx');
            var hasES6 = paths.hasSourceFiles('es6');
            var hasBabelRc = fs.existsSync('.babelrc');

            if (langConfig.ecmaVersion === 6 || hasJSX || hasES6 || hasBabelRc) {
                var babelify = require('babelify');
                var presets = [];
                var plugins = [];

                if (hasBabelRc) {
                    logger.logInfo("Will use babel config from .babelrc");
                }
                else if (hasJSX) {
                    presets.push('react');
                    dependencies.warnOnMissingDependency('babel-preset-react', 'You have JSX sources in this project. Transpiling these will require the "babel-preset-react" package.');
                    presets.push('es2015');
                    dependencies.warnOnMissingDependency('babel-preset-es2015', 'You have JSX/ES6 sources in this project. Transpiling these will require the "babel-preset-es2015" package.');
                } else {
                    presets.push('es2015');
                    dependencies.warnOnMissingDependency('babel-preset-es2015', 'You have ES6 sources in this project. Transpiling these will require the "babel-preset-es2015" package.');
                }

                var babelConfig = {};

                // if no .babelrc was found, configure babel with the default presets and plugins from above
                if (!hasBabelRc) {
                    babelConfig.presets = presets;
                    babelConfig.plugins = plugins;
                }

                // if .babelrc was found, an empty config object must be passed in order for .babelrc config to be read automatically
                bundler.transform(babelify, babelConfig);
            }

            if (bundle.bundleTransforms) {
                for (var i = 0; i < bundle.bundleTransforms.length; i++) {
                    bundler.transform(bundle.bundleTransforms[i]);
                }
            }

            if (applyImports) {
                addModuleMappingTransforms(bundle, bundler);
            }

            if (bundle.minifyBundle === true) {
                var sourceMap = bundle.as + '.map.json';
                bundler.plugin('minifyify', {
                    map: sourceMap,
                    output: bundleTo + '/' + sourceMap
                });
            }

            for (var i = 0; i < preBundleListeners.length; i++) {
                preBundleListeners[i].call(bundle, bundler);
            }
            
            // Allow reading of stuff from the filesystem.
            bundler.transform(require('brfs'));
            
            return bundler.bundle()
                .on('error', function (err) {
                    logger.logError('Browserify bundle processing error');
                    if (err) {
                        logger.logError('\terror: ' + err);
                    }
                    if (exports.isRebundle() || exports.isRetest()) {
                        notifier.notify('bundle:watch failure', 'See console for details.');
                        // ignore failures if we are running rebundle/retesting.
                        this.emit('end');
                    } else {
                        throw 'Browserify bundle processing error. See above for details.';
                    }
                })
                .pipe(source(bundle.bundleOutputFile))
                .pipe(gulp.dest(bundleTo))
                ;
        });
    }

    // Create a bundle with imports applied/transformed.
    defineJSBundleTask(bundle, true);

    return bundle;
}

function bundleCss(resource, format) {
    var bundle = {
        format: format
    };

    var folder = paths.parentDir(resource);

    bundle.fileExtension = '.' + format;
    bundle.shortName = _string.strRightBack(resource, '/');
    bundle.as = _string.strLeftBack(bundle.shortName, bundle.fileExtension);
    bundle.bundleExportNamespace = _string.strRightBack(folder, '/');

    bundle.inDir = function(dir) {
        if (skipBundle) {
            return bundle;
        }
        if (!dir) {
            logger.logError("Error: Invalid bundle registration for CSS resource '" + resource + "'. You can't specify a 'null' dir name when calling inDir.");
            throw "'bundle' registration failed. See error above.";
        }
        bundle.bundleInDir = normalizePath(dir);
        return bundle;
    };
    
    var bundleTaskName = format + '_bundle_' + bundle.as;
    exports.defineBundleTask(bundleTaskName, function() {
        return bundlegen.doCSSBundle(bundle, resource);
    });
    
    return bundle;
}

function toModuleMapping(from, to, config) {
    dependencies.assertHasJenkinsJsModulesDependency('Cannot bundle "withExternalModuleMapping".');
    
    // 'to' is optional, so maybe the second arg is a 
    // config object. 
    if (to && typeof to === 'object') {
        config = to;
        to = undefined;
    }

    if (config === undefined) {
        config = {};
    } else if (typeof config === 'string') {
        // config is the require mapping override (backward compatibility).
        config = {
            require: config
        };
    } else {
        // Clone the config object because we're going to be
        // making changes to it.
        config = JSON.parse(JSON.stringify(config));
    }

    if (!from) {
        var message = "Cannot call 'withExternalModuleMapping' without defining the 'from' module name.";
        logger.logError(message);
        throw message;
    }
    if (!to) {
        var adjExt = require('./internal/adjunctexternal');
        to = adjExt.bundleFor(exports, from);
    }

    // special case because we are externalizing handlebars runtime for handlebarsify.
    if (from === 'handlebars' && to === 'handlebars:handlebars3' && !config.require) {
        config.require = 'jenkins-handlebars-rt/runtimes/handlebars3_rt';
    }

    return {
        from: from,
        to: to,
        config: config
    };
}

function buildSrcWatchList(includeTestSrc) {
    var watchList = [];

    watchList.push('./index.js');
    for (var i = 0; i < paths.srcPaths.length; i++) {
        var srcPath = paths.srcPaths[i];
        watchList.push(srcPath + '/*.*');
        watchList.push(srcPath + '/**/*.*');
    }

    if (includeTestSrc && includeTestSrc === true) {
        watchList.push(paths.testSrcPath + '/**/*.*');
    }

    return watchList;
}

function rebundleLogging() {
    if (rebundleRunning === true) {
        logger.logInfo('*********************************************');
        logger.logInfo('bundle:watch: watching for source changes again ...');
    }
}

var tasks = {
    test: function () {
        if (!paths.testSrcPath) {
            logger.logWarn("Warn: Test src path has been unset. No tests to run.");
            return;
        }

        var terminalReporter = new jasmineReporters.TerminalReporter({
            verbosity: 3,
            color: true,
            showStack: true
        });
        var junitReporter = new jasmineReporters.JUnitXmlReporter({
            savePath: 'target/surefire-reports',
            consolidateAll: true,
            filePrefix: 'JasmineReport'
        });

        var testFileSuffix = args.argvValue('--testFileSuffix', 'spec');
        
        var testSpecs = paths.testSrcPath + '/**/' + args.argvValue('--test', '') + '*-' + testFileSuffix + '.js';
        logger.logInfo('Test specs: ' + testSpecs + ' (use --testFileSuffix switch to select different files)');

        global.jenkinsBuilder = exports;
        _startTestWebServer();
        gulp.src(testSpecs)
            .pipe(jasmine({reporter: [terminalReporter, junitReporter, {
                jasmineDone: function () {
                    gulp.emit('testing_completed');
                }
            }]})
            .on('error', function (err) {
                logger.logError('Jasmine test failures. See console for details (or surefire JUnit report files in target folder).', err);
                if (exports.isRebundle() || exports.isRetest()) {
                    notifier.notify('Jasmine test failures', 'See console for details (or surefire JUnit report files in target folder).');
                    // ignore failures if we are running rebundle/retesting.
                    this.emit('end');
                } else {
                    process.exit(1);
                }
            })
            )
        ;
    },
    bundle: function() {
        if (bundles.length === 0) {
            logger.logWarn("Warning: Skipping 'bundle' task. No 'module' bundles are registered. Call require('jenkins-js-build').bundle([module]) in gulpfile.js.");
        }
        logger.logInfo('bundling: done');
        rebundleLogging();
    },
    'bundle:watch': function() {
        var watchList = buildSrcWatchList(false);
        logger.logInfo('bundle:watch watch list: ' + watchList);
        rebundleRunning = true;
        gulp.watch(watchList, ['bundle']);
        rebundleLogging();
    },
    'test:watch': function() {
        var watchList = buildSrcWatchList(true);
        logger.logInfo('test:watch watch list: ' + watchList);
        retestRunning = true;
        gulp.watch(watchList, ['test']);
    },

    lint: function() {
        require('./internal/lint').exec(langConfig, lintConfig);
    }
};

function skipBundle() {
    // Can't skip bundle if there are handlebars file and a dependency on hbsify
    if (dependencies.getDependency('hbsfy') && paths.hasSourceFiles('hbs')) {
        return false;
    }
    
    return args.isArgvSpecified('--skipBundle');
}

function _startTestWebServer(config) {
    if (!config) {
        config = {}
    }
    if (!config.port) {
        config.port = 18999;
    }
    if (!config.root) {
        config.root = cwd;
    }

    if (!testWebServer) {
        // Start a web server that will allow tests to request resources.
        testWebServer = require('node-http-server').deploy(config);
        logger.logInfo('Testing web server started on port ' + config.port + ' (http://localhost:' + config.port + '). Content root: ' + config.root);
    }
}

gulp.on('testing_completed', function() {
    _stopTestWebServer();
    if (retestRunning === true) {
        logger.logInfo('*********************************************');
        logger.logInfo('test:watch: watching for source changes again ...');
    }
});

function _stopTestWebServer() {
    if (testWebServer) {
        testWebServer.close();
        testWebServer = undefined;
        logger.logInfo('Testing web server stopped.');
    }
}

if (args.isArgvSpecified('--h') || args.isArgvSpecified('--help')) {
    skipBundle = true;
    gulp.task('default', function() {});
} else {
    // Defined default tasks. Can be overridden.
    var defaultTasks = [];
    if (!args.isArgvSpecified('--skipLint')) {
        defaultTasks.push('lint');
    } else {
        gulp.task('lint', function() {
            logger.logInfo(' - lint skipped (--skipLint)');
        });
    }
    if (!skipTest) {
        defaultTasks.push('test');
    } else {
        gulp.task('test', function() {
            logger.logInfo(' - tests skipped (--skipTests)');
        });
    }
    if (!skipBundle) {
        defaultTasks.push('bundle');
    } else {
        gulp.task('bundle', function() {
            logger.logInfo(' - bundle skipped (--skipBundle)');
        });
    }
    defaultTasks.push('bundle:watch');
    defaultTasks.push('test:watch');
    exports.defineTasks(defaultTasks);
    
    dependencies.processExternalizedDependencies(this);
    
    // Install plugins.
    require('./internal/plugins').install(exports);
}