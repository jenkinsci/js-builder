var gulp = require('gulp');
var fs = require('fs');
var main = require('../index');
var langConfig = require('./langConfig');
var dependencies = require('./dependecies');
var paths = require('./paths');
var maven = require('./maven');
var logger = require('./logger');
var args = require('./args');
var notifier = require('./notifier');
var browserify = require('browserify');
var source = require('vinyl-source-stream');
var transformTools = require('browserify-transform-tools');
var _string = require('underscore.string');

var hasJenkinsJsModulesDependency = dependencies.hasJenkinsJsModulesDep();
var preBundleListeners = [];
var globalModuleMappings = [];

/**
 * Add a listener to be called just before Browserify starts bundling.
 * <p>
 * The listener is called with the {@code bundle} as {@code this} and
 * the {@code bundler} as as the only arg.
 *
 * @param listener The listener to add.
 */
exports.onPreBundle = function(listener) {
    preBundleListeners.push(listener);
};

exports.addGlobalModuleMapping = function(mapping) {
    globalModuleMappings.push(mapping);
};

exports.doJSBundle = function(bundle, applyImports) {
    if (!bundle.bundleInDir) {
        var adjunctBase = setAdjunctInDir(bundle);
        logger.logInfo('Javascript bundle "' + bundle.as + '" will be available in Jenkins as adjunct "' + adjunctBase + '.' + bundle.as + '".')
    }

    // Add all global mappings.
    if (bundle.useGlobalModuleMappings === true) {
        for (var i = 0; i < globalModuleMappings.length; i++) {
            bundle._withExternalModuleMapping(globalModuleMappings[i]);
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
    if (langConfig.ecmaVersion === 6 || hasJSX || hasES6) {
        var babelify = require('babelify');
        var presets = [];

        if (hasJSX) {
            presets.push('react');
            dependencies.warnOnMissingDependency('babel-preset-react', 'You have JSX sources in this project. Transpiling these will require the "babel-preset-react" package.');
            presets.push('es2015');
            dependencies.warnOnMissingDependency('babel-preset-es2015', 'You have JSX/ES6 sources in this project. Transpiling these will require the "babel-preset-es2015" package.');
        } else {
            presets.push('es2015');
            dependencies.warnOnMissingDependency('babel-preset-es2015', 'You have ES6 sources in this project. Transpiling these will require the "babel-preset-es2015" package.');
        }

        bundler.transform(babelify, {presets: presets});
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

    var bufferedTextTransform = require('./pipeline-transforms/buffered-text-accumulator-transform');
    var requireStubTransform = require('./pipeline-transforms/require-stub-transform');
    var pack = require('browser-pack');

    return bundler.bundle()
        .on('error', function (err) {
            logger.logError('Browserify bundle processing error');
            if (err) {
                logger.logError('\terror: ' + err);
            }
            if (main.isRebundle() || main.isRetest()) {
                notifier.notify('bundle:watch failure', 'See console for details.');
                // ignore failures if we are running rebundle/retesting.
                this.emit('end');
            } else {
                throw new Error('Browserify bundle processing error. See above for details.');
            }
        })
        .pipe(bufferedTextTransform())// gathers together all the bundle JS, preparing for the next pipeline stage
        .pipe(requireStubTransform.pipelinePlugin(bundle.moduleMappings)) // transform the require stubs
        .pipe(pack()) // repack the bundle after the previous transform
        .pipe(source(bundle.bundleOutputFile))
        .pipe(gulp.dest(bundleTo));
};

exports.doCSSBundle = function(bundle, resource) {
    var ncp = require('ncp').ncp;
    var folder = paths.parentDir(resource);

    if (!bundle.bundleInDir) {
        var adjunctBase = setAdjunctInDir(bundle);
        logger.logInfo('CSS resource "' + resource + '" will be available in Jenkins as adjunct "' + adjunctBase + '.' + bundle.as + '".')
    }

    paths.mkdirp(bundle.bundleInDir);
    ncp(folder, bundle.bundleInDir, function (err) {
        if (err) {
            return logger.logError(err);
        }
        if (bundle.format === 'less') {
            less(resource, bundle.bundleInDir);
        }
        // Add a .adjunct marker file in each of the subdirs
        paths.walkDirs(bundle.bundleInDir, function(dir) {
            var dotAdjunct = dir + '/.adjunct';
            if (!fs.existsSync(dotAdjunct)) {
                fs.writeFileSync(dotAdjunct, '');
            }
        });
    });
};

function less(src, targetDir) {
    var less = require('gulp-less');
    gulp.src(src)
        .pipe(less().on('error', function (err) {
            logger.logError('LESS processing error:');
            if (err) {
                logger.logError('\tmessage: ' + err.message);
                logger.logError('\tline #:  ' + err.line);
                if (err.extract) {
                    logger.logError('\textract: ' + JSON.stringify(err.extract));
                }
            }
            if (main.isRebundle() || main.isRetest()) {
                notifier.notify('LESS processing error', 'See console for details.');
                // ignore failures if we are running rebundle/retesting.
                this.emit('end');
            } else {
                throw new Error('LESS processing error. See above for details.');
            }
        }))
        .pipe(gulp.dest(targetDir));
    logger.logInfo("LESS CSS pre-processing completed to '" + targetDir + "'.");
}

function addModuleMappingTransforms(bundle, bundler) {
    var moduleMappings = bundle.moduleMappings;
    var requiredModuleMappings = [];

    if (moduleMappings.length > 0) {
        var requireTransform = transformTools.makeRequireTransform("requireTransform",
            {evaluateArguments: true},
            function(args, opts, cb) {
                var required = args[0];
                for (var i = 0; i < moduleMappings.length; i++) {
                    var mapping = moduleMappings[i];
                    if (mapping.from === required) {
                        if (requiredModuleMappings.indexOf(mapping.to) === -1) {
                            requiredModuleMappings.push(mapping.to);
                        }
                        return cb();
                    }
                }
                return cb();
            });
        bundler.transform({ global: true }, requireTransform);
    }
    var importExportApplied = false;
    var importExportTransform = transformTools.makeStringTransform("importExportTransform", {},
        function (content, opts, done) {
            if (!importExportApplied) {
                try {
                    if(!hasJenkinsJsModulesDependency) {
                        throw new Error("This module must have a dependency on the '@jenkins-cd/js-modules' package. Please run 'npm install --save @jenkins-cd/js-modules'.");
                    }

                    var exportNamespace = 'undefined'; // global namespace
                    var exportModule = undefined;

                    if (bundle.exportEmptyModule) {
                        exportModule = '{}'; // exporting nothing (an "empty" module object)
                    }

                    if (bundle.bundleExportNamespace) {
                        // It's a hpi plugin, so use it's name as the export namespace.
                        exportNamespace = "'" + bundle.bundleExportNamespace + "'";
                    }
                    if (bundle.bundleExport) {
                        // export function was called, so export the module.
                        exportModule = 'module'; // export the module
                    }

                    if(exportModule) {
                        // Always call export, even if the export function was not called on the builder instance.
                        // If the export function was not called, we export nothing (see above). In this case, it just
                        // generates an event for any modules that need to sync on the load event for the module.
                        content += "\n" +
                            "\t\trequire('@jenkins-cd/js-modules').export(" + exportNamespace + ", '" + bundle.as + "', " + exportModule + ");";
                    }
                    content += "\n\n";

                    var wrappedContent =
                        "var ___$$$___jsModules = require('@jenkins-cd/js-modules');\n\n" +
                        "___$$$___jsModules.whoami('" + bundle.bundleExportNamespace + ":" + bundle.as + "');\n\n" +
                        "/*** Start Module Exec Function ***************************************/\n" +
                        "function ___$$$___exec() {\n" +
                            content +
                        //"\n" +
                        //"   console.debug('jenkins-js-modules: JS bundle " + (bundle.bundleExportNamespace || 'nns') + ":" + bundle.as + " started.');" +
                        //"\n" +
                        "}\n" +
                        "/*** End Module Exec Function   ***************************************/\n" +
                        "\n" +
                        "if (___$$$___requiredModuleMappings.length > 0) {\n" +
                        //"\n" +
                        //"   console.debug('jenkins-js-modules: JS bundle " + (bundle.bundleExportNamespace || 'nns') + ":" + bundle.as + " waiting on bundle loads: ', ___$$$___requiredModuleMappings);" +
                        //"\n" +
                        "    ___$$$___jsModules.import.apply(___$$$___jsModules.import, ___$$$___requiredModuleMappings)\n" +
                        "        .onFulfilled(function() {\n" +
                        "\n" +
                        "        ___$$$___exec();\n" +
                        "\n" +
                        "    });\n\n" +
                        "} else {\n\n" +
                        "    ___$$$___exec();\n\n" +
                        "}";

                    // perform addModuleCSSToPage actions for mappings that requested it.
                    // We don't need the imports to complete before adding these. We can just add
                    // them immediately.
                    var jsmodules = require('@jenkins-cd/js-modules/js/internal');
                    for (var i = 0; i < moduleMappings.length; i++) {
                        var mapping = moduleMappings[i];
                        var addDefaultCSS = mapping.config.addDefaultCSS;
                        if (addDefaultCSS && addDefaultCSS === true) {
                            var parsedModuleQName = jsmodules.parseResourceQName(mapping.to);
                            wrappedContent +=
                                "require('@jenkins-cd/js-modules').addModuleCSSToPage('" + parsedModuleQName.namespace + "', '" + parsedModuleQName.moduleName + "');\n";
                        }
                    }

                    return done(null, wrappedContent);
                } finally {
                    importExportApplied = true;
                }
            } else {
                return done(null, content);
            }
        });

    bundler.transform(importExportTransform);

    var through = require('through2');
    bundler.pipeline.get('deps').push(through.obj(function (row, enc, next) {
        if (row.entry) {
            row.source = "var ___$$$___requiredModuleMappings = " + JSON.stringify(requiredModuleMappings) + ";\n\n" + row.source;
        }
        this.push(row);
        next();
    }));
}

function setAdjunctInDir(bundle) {
    var adjunctBase = 'org/jenkins/ui/jsmodules';
    if (bundle.bundleExportNamespace) {
        adjunctBase += '/' + normalizeForJavaIdentifier(bundle.bundleExportNamespace);
    } else if (maven.isMavenProject) {
        adjunctBase += '/' + normalizeForJavaIdentifier(maven.getArtifactId());
    }
    bundle.bundleInDir = 'target/classes/' + adjunctBase;
    return _string.replaceAll(adjunctBase, '/', '\.');
}

function normalizeForJavaIdentifier(string) {
    // Replace all non alphanumerics with an underscore.
    return string.replace(/\W/g, '_');
}