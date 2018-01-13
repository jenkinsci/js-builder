var gulp = require('gulp');
var fs = require('fs');
var cwd = process.cwd();
var main = require('../index');
var langConfig = require('./langConfig');
var dependencies = require('./dependecies');
var paths = require('./paths');
var path = require('path');
var maven = require('./maven');
var logger = require('./logger');
var args = require('./args');
var notifier = require('./notifier');
var browserify = require('browserify');
var source = require('vinyl-source-stream');
var transformTools = require('browserify-transform-tools');
var _string = require('underscore.string');
var templates = require('./templates');
var ModuleSpec = require('@jenkins-cd/js-modules/js/ModuleSpec');
var entryModuleTemplate = templates.getTemplate('entry-module.hbs');
var entryModuleWrapperTemplate = templates.getTemplate('entry-module-wrapper.js');
var packageJson = require(process.cwd() + '/package.json');
var Version = require('@jenkins-cd/js-modules/js/Version');

var hasJenkinsJsModulesDependency = dependencies.hasJenkinsJsModulesDep();
var preBundleListeners = [];
var postBundleListeners = [];
var globalImportMappings = [];
var globalExportMappings = [];
var bundleSetupListeners = [];

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

/**
 * Add a listener to be called just after Browserify finishes bundling.
 * <p>
 * The listener is called with the {@code bundle} as {@code this} and
 * the location of the generated bundle as as the only arg.
 *
 * @param listener The listener to add.
 */
exports.onPostBundle = function(listener) {
    postBundleListeners.push(listener);
};

exports.onSetupBundle = function(listener) {
    bundleSetupListeners.push(listener);
};

exports.addGlobalImportMapping = function(mapping) {
    globalImportMappings.push(mapping);
};

exports.addGlobalExportMapping = function(mapping) {
    globalExportMappings.push(mapping);
};

exports.registerPackageJsonBundles = function(builder) {
    if (packageJson.jenkinscd && packageJson.jenkinscd.bundle) {
        var bundles = packageJson.jenkinscd.bundle;
        if (typeof bundles === 'string') {
            builder.bundle(bundles);
        } else {
            for (var i = 0; i < bundles.length; i++) {
                builder.bundle(bundles[i]);
            }
        }
    }
};

exports.doJSBundle = function(bundle, applyImports) {
    for (var i = 0; i < bundleSetupListeners.length; i++) {
        bundleSetupListeners[i].call(this, bundle, packageJson);
    }
    
    if (!bundle.bundleInDir) {
        var adjunctBase = setAdjunctInDir(bundle);
        logger.logInfo('Javascript bundle "' + bundle.as + '" will be available in Jenkins as adjunct "' + adjunctBase + '.' + bundle.as + '".')
    }

    // Add all global mappings.
    if (!bundle.globalModuleMappingsApplied) {
        if (bundle.useGlobalImportMappings === true) {
            for (var i = 0; i < globalImportMappings.length; i++) {
                bundle._import(globalImportMappings[i]);
            }
        }
        if (bundle.useGlobalExportMappings === true) {
            if (main.bundleCount() > 1 && globalExportMappings.length > 0) {
                logger.logError('Unable to apply bundle dependency "export" configurations from package.json because there are multiple bundles being generated.');
                logger.logError('   (exporting the same package from multiple bundles is not permitted)');
                logger.logError('   TIP: From inside gulpfile.js, call bundle.export([package-name]) directly on the bundle performing the export.');
            } else {
                for (var i = 0; i < globalExportMappings.length; i++) {
                    bundle.export(globalExportMappings[i]);
                }
            }
        }
        bundle.globalModuleMappingsApplied = true;
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

    bundle.doOnExecCall = true;
    if (bundle.startupModules.length > 0) {
        var wrapperFileDir = './target/js-bundle-src';
        var relativeStartupModules = [];

        for (var ii = 0; ii < bundle.startupModules.length; ii++) {
            var startupModule = bundle.startupModules[ii];
            if (startupModule.charAt(0) === '.') {
                var relativeModulePath = path.relative(wrapperFileDir, startupModule);
                if (fs.existsSync(cwd + '/' + startupModule + '.js') || fs.existsSync(cwd + '/' + startupModule)) {
                    relativeStartupModules.push(relativeModulePath);
                } else {
                    logger.logInfo('Javascript bundle "' + bundle.as + '" will not execute startup script "' + startupModule + '". Unable to find local script.')
                }
            } else {
                if (fs.existsSync(cwd + '/node_modules/' + startupModule + '.js') || fs.existsSync(cwd + '/node_modules/' + startupModule)) {
                    relativeStartupModules.push(startupModule);
                } else {
                    logger.logInfo('Javascript bundle "' + bundle.as + '" will not execute startup script "' + startupModule + '". Unable to find script in node_modules.')
                }
            }
        }

        if (relativeStartupModules.length > 0) {
            //
            // Lets load the entry module via a "wrapper" module. This wrapper
            // module will allow us to "inject" startup scripts (into the bundle) that
            // will need to execute and resolve before the entry module is allowed to execute.
            // Bundles will use this to async load resources that must be loaded before the
            // bundle can execute e.g. i18n plugin resources in Blue Ocean.
            //
            var fileToBasename = path.basename(fileToBundle);
            var wrapperFileName = wrapperFileDir + '/_js_wrapper-' + fileToBasename;
            var relativePath = path.relative(wrapperFileDir, fileToBundle);
            relativePath = relativePath.replace(/\\/g, '/');
            var wrapperFileContent = entryModuleWrapperTemplate({
                entrymodule: './' + relativePath,
                hpiPluginId: (maven.isHPI() ? maven.getArtifactId() : undefined),
                startupModules: relativeStartupModules
            });
            // Switch off the calling of the onExec callback. this is done inside
            // entryModuleWrapperTemplate, after all startup scripts are "done".
            bundle.doOnExecCall = false;
            paths.mkdirp(wrapperFileDir);
            fs.writeFileSync(wrapperFileName, wrapperFileContent);
            fileToBundle = wrapperFileName;
        }
    }

    var browserifyConfig = {
        entries: [fileToBundle],
        extensions: ['.js', '.es6', '.jsx', '.hbs'],
        cache: {},
        packageCache: {},
        fullPaths: true
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

    var bundleOutput = bundler.bundle()
        .on('error', function (err) {
            logger.logError('Browserify bundle processing error');
            if (err) {
                if (err.stack) {
                    logger.logError('\terror: ' + err.stack);
                } else {
                    logger.logError('\terror: ' + err);
                }
            }
            if (main.isRebundle() || main.isRetest()) {
                notifier.notify('bundle:watch failure', 'See console for details.');
                // ignore failures if we are running rebundle/retesting.
                this.emit('end');
            } else {
                throw new Error('Browserify bundle processing error. See above for details.');
            }
        });

    var bundleOutFile = bundleTo + '/' + bundle.bundleOutputFile;

    if (applyImports) {
        var bufferedTextTransform = require('./pipeline-transforms/buffered-text-accumulator-transform');
        var requireStubTransform = require('./pipeline-transforms/require-stub-transform');
        var pack = require('browser-pack');

        bundleOutput = bundleOutput.pipe(bufferedTextTransform())// gathers together all the bundle JS, preparing for the next pipeline stage
            .pipe(requireStubTransform.pipelinePlugin(bundle, bundleOutFile)) // transform the require stubs
            .pipe(pack()); // repack the bundle after the previous transform
    }

    var through = require('through2');
    return bundleOutput.pipe(source(bundle.bundleOutputFile))
        .pipe(gulp.dest(bundleTo))
        .pipe(through.obj(function (bundle, encoding, callback) {
            for (var i = 0; i < postBundleListeners.length; i++) {
                postBundleListeners[i].call(bundle, bundleOutFile);
            }
            callback();
        }));
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
    // Run less with the ieCompat option switched off. Sorry, but we don't care about IE8 !!!
    gulp.src(src)
        .pipe(less({ieCompat: false}).on('error', function (err) {
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
        var requireSearch = transformTools.makeStringTransform("requireSearch", {},
            function(content, opts, cb) {
                for (var i = 0; i < moduleMappings.length; i++) {
                    var mapping = moduleMappings[i];
                    // Do a rough search for the module name. If we find it, then we
                    // add that module name to the list. This may result in some false
                    // positives, but that's okay. The most important thing is that we
                    // do add the import for the module if it is required. Adding additional
                    // imports for modules not required is not optimal, but is also not the
                    // end of the world.
                    if (content.indexOf(mapping.fromSpec.moduleName) !== -1) {
                        var toSpec = new ModuleSpec(mapping.to);
                        var importAs = toSpec.importAs();
                        if (requiredModuleMappings.indexOf(importAs) === -1) {
                            requiredModuleMappings.push(importAs);
                        }
                    }
                }
                return cb(null, content);
            });
        bundler.transform({ global: true }, requireSearch);
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

                    var templateParams = {
                        bundle: bundle,
                        content: content,
                        css: []
                    };

                    if(exportModule) {
                        var normalizedPackageName = dependencies.normalizePackageName(packageJson.name);
                        // Always call export, even if the export function was not called on the builder instance.
                        // If the export function was not called, we export nothing (see above). In this case, it just
                        // generates an event for any modules that need to sync on the load event for the module.
                        templateParams.entryExport = {
                            namespace: exportNamespace,
                            module: exportModule,
                            normalizedPackageName: normalizedPackageName,
                            version: dependencies.mmpModuleNames(normalizedPackageName, new Version(packageJson.version)),
                        };
                    }

                    templateParams.dependencyExports = expandDependencyExports(bundle.moduleExports);

                    // perform addModuleCSSToPage actions for mappings that requested it.
                    // We don't need the imports to complete before adding these. We can just add
                    // them immediately.
                    for (var i = 0; i < moduleMappings.length; i++) {
                        var mapping = moduleMappings[i];
                        var addDefaultCSS = mapping.config.addDefaultCSS;
                        if (addDefaultCSS && addDefaultCSS === true) {
                            var parsedModuleQName = new ModuleSpec(mapping.to);
                            templateParams.css.push(parsedModuleQName);
                        }
                    }

                    var wrappedContent = entryModuleTemplate(templateParams);

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

function expandDependencyExports(bundleExports) {
    if (!bundleExports || bundleExports.length === 0) {
        return undefined;
    }

    var dependencyExports = [];
    for (var i in bundleExports) {
        var packageName = bundleExports[i];
        var versionMetadata = dependencies.externalizedVersionMetadata(packageName);
        if (versionMetadata) {
            dependencyExports.push(versionMetadata);
        } else {
            logger.logWarn("Ignoring export decl for package '" + packageName + "'. This package is not installed, or is not a declared dependency.");
        }
    }

    return dependencyExports;
}

function setAdjunctInDir(bundle) {
    var adjunctBase = 'org/jenkins/ui/jsmodules';
    if (bundle.bundleExportNamespace) {
        if (maven.isMavenProject && bundle.bundleExportNamespace === maven.getArtifactId()) {
            adjunctBase += '/' + maven.getArtifactId();
        } else {
            adjunctBase += '/' + normalizeForFilenameUse(bundle.bundleExportNamespace);
        }
    } else if (maven.isMavenProject) {
        adjunctBase += '/' + maven.getArtifactId();
    }
    bundle.bundleInDir = 'target/classes/' + adjunctBase;
    return _string.replaceAll(adjunctBase, '/', '\.');
}

function normalizeForFilenameUse(string) {
    // Replace all non alphanumerics with an underscore.
    return string.replace(/\W/g, '-');
}
