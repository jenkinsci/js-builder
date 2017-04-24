/**
 * Testing related tasks and code.
 */

var gulp = require('gulp');
var args = require('./args');
var paths = require('./paths');
var cwd = process.cwd();
var dependencies = require('./dependecies');
var logger = require('./logger');
var jasmine = require('gulp-jasmine');
var jasmineReporters = require('jasmine-reporters');

var testFileSuffix = args.argvValue('--testFileSuffix', 'spec');
var testSpecs = paths.testSrcPath + '/**/' + args.argvValue('--test', '') + '*-' + testFileSuffix + '.{js,jsx}';
var testWebServer;
var builder = global.__builder;

logger.logInfo('Test specs: ' + testSpecs + ' (use --testFileSuffix switch to select different files)');

exports.getTestTask = function() {
    if (!paths.testSrcPath) {
        return function() {
            logger.logWarn("Warn: Test src path has been unset. No tests to run.");
        };
    }
    if (dependencies.getDependency('gulp-mocha')) {
        return mochaTestTask;
    } else {
        return jasmineTestTask;
    }
};

exports.startTestWebServer = function(config) {
    _stopTestWebServer();
    _startTestWebServer(config);
    logger.logInfo("\t(call require('gulp').emit('testing_completed') when testing is completed - watch async test execution)");
};

function jasmineTestTask() {
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

    _startTestWebServer();
    gulp.src(testSpecs)
        .pipe(jasmine({reporter: [terminalReporter, junitReporter, {
                jasmineDone: function () {
                    gulp.emit('testing_completed');
                }
            }]})
            .on('error', function (err) {
                logger.logError('Jasmine test failures. See console for details (or surefire JUnit report files in target folder).' + err);
                if (builder.isRebundle() || builder.isRetest()) {
                    notifier.notify('Jasmine test failures', 'See console for details (or surefire JUnit report files in target folder).');
                    // ignore failures if we are running rebundle/retesting.
                    this.emit('end');
                } else {
                    process.exit(1);
                }
            })
        )
    ;
}

function mochaTestTask() {
    var mocha = require('gulp-mocha');
    var mochaConfig = {};

    if (dependencies.getDependency('babel-core')) {
        mochaConfig.compilers = {
            js: require('babel-core/register')
        };
    }

    //
    // Mocha spec loading can fail during mocha initialization. If path.resolve
    // fails for some reason, you get a stack trace, but it's totally useless
    // because it doesn't tell you which spec file was the source of the resolve
    // error. The following code patches that.
    //
    var MochaConstructor = require('mocha');
    if (MochaConstructor.prototype.loadFiles && !MochaConstructor.__jenkinsLoadfilesWrapped) {
        var path = require('path');
        MochaConstructor.prototype.loadFiles = function(fn) {
            var self = this;
            var suite = this.suite;
            this.files.forEach(function(file) {
                try {
                    file = path.resolve(file);
                    suite.emit('pre-require', global, file, self);
                    suite.emit('require', require(file), file, self);
                    suite.emit('post-require', global, file, self);
                } catch(e) {
                    logger.logError('*****************************************************************');
                    logger.logError('Mocha test initialization failure. Failed to load spec file "' + file + '". Tests will not run. See stack trace below.');
                    logger.logError('*****************************************************************');
                    throw e;
                }
            });
            fn && fn();
        };
        MochaConstructor.__jenkinsLoadfilesWrapped = true;
    }

    gulp.src(testSpecs).pipe(mocha(mochaConfig))
        .on('error', function (e) {
            logger.logError('Mocha test failures. See console for details (or surefire JUnit report files in target folder).' + e);
            if (builder.isRetest()) {
                console.log('**** is retest .... ignoring error');
                // ignore test failures if we are running retest.
                return;
            }
            process.exit(1);
        }) // https://github.com/sindresorhus/gulp-mocha#test-suite-not-exiting
        .once('end', function () {
          process.exit();
        });
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

function _stopTestWebServer() {
    if (testWebServer) {
        testWebServer.close();
        testWebServer = undefined;
        logger.logInfo('Testing web server stopped.');
    }
}

gulp.on('testing_completed', function() {
    _stopTestWebServer();
    if (builder.isRetest()) {
        logger.logInfo('*********************************************');
        logger.logInfo('test:watch: watching for source changes again ...');
    }
});
