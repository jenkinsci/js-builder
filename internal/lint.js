var gulp = require('gulp');
var gulpIf = require('gulp-if');
var merge = require('merge-stream');
var fs = require('fs');
var cwd = process.cwd();
var paths = require('./paths');
var path = require('path');
var logger = require('./logger');
var args = require('./args');
var hasJsHintConfig = fs.existsSync(cwd + '/.jshintrc');
var esLintConfig = paths.findClosest('.eslintrc');
var cleanPath = require('./bundlegen').cleanPath;
var hasJSX = paths.hasSourceFiles('jsx');
var hasES6 = paths.hasSourceFiles('es6');

if (esLintConfig) {
    esLintConfig = cleanPath(path.relative(cwd, esLintConfig));
}

exports.exec = function(langConfig, lintConfig) {
    if (lintConfig.level === 'none') {
        logger.logInfo('Code linting is disabled. Check gulpfile.js.');
        return;
    }

    if (hasJsHintConfig) {
        // We only use jshint if it's explicitly configured
        // with a .jshintrc file.
        runJsHint(lintConfig);
    } else {
        return runEslint(langConfig, lintConfig);
    }
};

function runJsHint(lintConfig) {
    var jshint = require('gulp-jshint');
    var jshintConfig;

    if (!hasJsHintConfig) {
        logger.logInfo('\t- Using default JSHint configuration (in js-builder). Override by defining a .jshintrc in this folder.');
        jshintConfig = require('../res/default.jshintrc');
    }
    function _runJsHint(pathSet) {
        for (var i = 0; i < pathSet.length; i++) {
            // TODO: eslint for .jsx and .es6 files.
            gulp.src(['./index.js', pathSet[i] + '/**/*.js'])
                .pipe(jshint(jshintConfig))
                .pipe(jshint.reporter('default'))
                .pipe(jshint.reporter('fail'));
        }
    }
    if (lintConfig.src) {
        _runJsHint(paths.srcPaths);
    }
    if (lintConfig.tests) {
        return _runJsHint([paths.testSrcPath]);
    }
}

function runEslint(langConfig, lintConfig) {
    var eslint = require('gulp-eslint');
    var eslintConfig;

    if (!esLintConfig) {
        if (hasJSX) {
            logger.logInfo('\t- Using the "react" eslint configuration from eslint-config-jenkins. Override by defining a .eslintrc in this folder (if you really must).');
            eslintConfig = require('@jenkins-cd/eslint-config-jenkins/react');
        } else if (langConfig.ecmaVersion === 6 || hasES6) {
            logger.logInfo('\t- Using the "es6" eslint configuration from eslint-config-jenkins. Override by defining a .eslintrc in this folder (if you really must).');
            eslintConfig = require('@jenkins-cd/eslint-config-jenkins/es6');
        } else {
            logger.logInfo('\t- Using the "es5" eslint configuration from eslint-config-jenkins. Override by defining a .eslintrc in this folder (if you really must).');
            eslintConfig = require('@jenkins-cd/eslint-config-jenkins/es5');
        }
    } else {
        logger.logInfo('\t- Using ' + esLintConfig + '. Override by defining a .eslintrc in this folder.');
        eslintConfig = {
            extends: esLintConfig
        };
    }

    var fixLint = args.isArgvSpecified('--fixLint');
    if (fixLint) {
        eslintConfig.fix = true;
    }
    function isFixed(file) {
        // Has ESLint fixed the file contents?
        return fixLint && file.eslint != null && file.eslint.fixed;
    }

    var mergedStreams = merge();

    function _runEsLint(pathSet, patterns) {

        function getSrcPaths(path) {
            var srcPaths = [];
            for (var i = 0; i < patterns.length; i++) {
                srcPaths.push(path + '/' + patterns[i]);
            }
            return srcPaths;
        }

        for (var i = 0; i < pathSet.length; i++) {
            var srcPaths = getSrcPaths(pathSet[i]);
            var stream = gulp.src(srcPaths)
                .pipe(eslint(eslintConfig))
                .pipe(eslint.format())
                .pipe(eslint.results(function (results) {
                    if (results.errorCount > 0 || results.warningCount > 0) {
                        logger.logWarn('Oops, there are some eslint errors/warnings:');
                        if (results.warningCount > 0) {
                            logger.logWarn('\tWarnings: ' + results.warningCount);
                        }
                        if (results.errorCount > 0) {
                            logger.logError('\tErrors:   ' + results.errorCount);
                            if (!fixLint && !args.isArgvSpecified('--continueOnLint')) {
                                logger.logError('There are eslint errors. Failing the build now. (--continueOnLint to continue on lint errors)');
                                logger.logInfo('** try "gulp lint --fixLint" to fix some/all linting issues **');
                                process.exit(1);
                            } else {
                                logger.logInfo('** try "gulp lint --fixLint" to fix some/all linting issues **');
                            }
                        }
                    }
                }))
                .pipe(gulpIf(isFixed, gulp.dest(pathSet[i])));

            mergedStreams.add(stream);
        }
    }

    if (lintConfig.src) {
        _runEsLint([cwd], ['index.js']);
        _runEsLint(paths.srcPaths, ['**/*.js', '**/*.jsx', '**/*.es6']);
    }
    if (lintConfig.tests) {
        _runEsLint([paths.testSrcPath], ['**/*.js', '**/*.jsx', '**/*.es6']);
    }

    return mergedStreams;
}
