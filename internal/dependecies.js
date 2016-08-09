var fs = require('fs');
var cwd = process.cwd();
var packageJson = require(cwd + '/package.json');
var logger = require('./logger');

exports.getDependency = function(depName) {
    function findDep(onDepMap) {
        if (onDepMap) {
            return onDepMap[depName];
        }
        return undefined;
    }
    
    var version = findDep(packageJson.dependencies);
    if (version) {
        return {
            type: 'runtime',
            version: version
        };
    } else {
        version = findDep(packageJson.devDependencies);
        if (version) {
            return {
                type: 'dev',
                version: version
            };
        } else {
            version = findDep(packageJson.peerDependencies);
            if (version) {
                return {
                    type: 'peer',
                    version: version
                };
            }
            // TODO: bundled and optional deps?
        }
    }
    
    return undefined;
};

exports.hasJenkinsJsModulesDep = function() {
    return (exports.getDependency('@jenkins-cd/js-modules') !== undefined);
};

exports.exitOnMissingDependency = function(depName, message) {
    if (!message) {
        message = 'Missing required NPM dependency.';
    }
    logger.logError(message + '\n\t- You must install the ' + depName + ' NPM package i.e. "npm install --save ' + depName + '" (use "--save-dev" to add as a devDependency)');
    process.exit(1);
};

exports.warnOnMissingDependency = function(depName, message) {
    if (exports.getDependency(depName)) {
        // It's there.
        return;
    }
    if (!message) {
        message = 'Missing NPM dependency "' + depName + '" (may be required).';
    }
    logger.logWarn(message + '\n\t- To install the ' + depName + ' NPM package, run "npm install --save ' + depName + '" (use "--save-dev" to add as a devDependency)');
};

exports.assertHasJenkinsJsModulesDependency = function(message) {
    if(!exports.hasJenkinsJsModulesDep()) {
        exports.exitOnMissingDependency('@jenkins-cd/js-modules', message);
    }
};

exports.processExternalizedDependencies = function(builder) {
    if (packageJson.jenkinscd && packageJson.jenkinscd.extDependencies) {
        var extDependencies = packageJson.jenkinscd.extDependencies;
        if (extDependencies.length) {
            for (var i = 0; i < extDependencies.length; i++) {
                builder.withExternalModuleMapping(extDependencies[i]);
            }
        }
    }
};

/**
 * Get the externalized package metadata for the named NPM dependency.
 * @param depPackageName The NPM dependency package name.
 */
exports.externalizedVersionMetadata = function(depPackageName) {
    var packageJsonFile = cwd + '/node_modules/' + depPackageName + '/package.json';
    
    if (!fs.existsSync(packageJsonFile)) {
        return undefined;
    }

    var packageJson = require(packageJsonFile);
    
    var metadata = {};
    metadata.packageName = depPackageName;
    metadata.installedVersion = parseVersion(packageJson.version);
    metadata.depVersion = parseVersion(exports.getDependency(depPackageName).version);
    metadata.normalizedPackageName = exports.normalizePackageName(depPackageName);
    metadata.jsModuleNames = mmpModuleNames(metadata.normalizedPackageName, metadata.installedVersion);
    metadata.importAs = function (scope) {
        var scopedName;
        if (scope) {
            scopedName = metadata.jsModuleNames[scope];
            if (!scopedName) {
                throw new Error('Unknown scope "' + scope + '".');
            }
        } else {
            scopedName = metadata.jsModuleNames.nameFor(metadata.depVersion);
        }

        return metadata.normalizedPackageName + ':' + scopedName;
    };
    
    return metadata;
};

function parseVersion(version) {
    function removeNonDigits(string) {
        // remove anything that's not a digit, a dot or an x.
        return string.replace(/[^\d.x]/g, '');
    }
    
    var versionTokens = version.split('.');
    var parsedVer = {};
    
    parsedVer.prerelease = undefined;

    var patchAndPrerelease = '';
    for (var i = 2; i < versionTokens.length; i++) {
        if (patchAndPrerelease.length > 0) {
            patchAndPrerelease += '.';
        }
        patchAndPrerelease += versionTokens[i];

        var separatorIdx = patchAndPrerelease.indexOf('-');
        if (separatorIdx !== -1) {
            parsedVer.patch = removeNonDigits(patchAndPrerelease.substring(0, separatorIdx));
            parsedVer.prerelease = patchAndPrerelease.substring(separatorIdx + 1);
        } else {
            parsedVer.patch = removeNonDigits(patchAndPrerelease);
        }
    }

    if (versionTokens.length >= 2) {
        parsedVer.minor = removeNonDigits(versionTokens[1]);
    }
    if (versionTokens.length >= 1) {
        parsedVer.major = removeNonDigits(versionTokens[0]);
    }
    
    return parsedVer;
}

exports.parseVersion = parseVersion;

/**
 * Normalize an NPM package name by removing all non alpha numerics and replacing
 * with hyphens.
 * @param packageName The NPM package name.
 * @returns The normalized NPM package name.
 */
exports.normalizePackageName = function(packageName) {
    packageName = packageName.replace(/[^\w.]/g, "-"); // replace non alphanumerics.
    if (packageName.charAt(0) === '-') {
        packageName = packageName.substring(1);
    }
    return packageName;
};

/**
 * Create major, minor and patch (version) module names that can
 * then be used in the .js generation and module exporting. 
 * @param normalizedPackageName The normalized NPM package name.
 * @param fullVersion The full version of the installed NPM package.
 */
function mmpModuleNames(normalizedPackageName, fullVersion) {
    return {
        any: normalizedPackageName,
        major: normalizedPackageName + '-' + fullVersion.major + '.x',
        minor: normalizedPackageName + '-' + fullVersion.major + '.' + fullVersion.minor + '.x',
        patch: normalizedPackageName + '-' + fullVersion.major + '.' + fullVersion.minor + '.' + fullVersion.patch,
        nameFor: function (depVersion) {
            if (depVersion.minor === 'x') {
                return this.major;
            } else if (depVersion.patch === 'x') {
                return this.minor;
            } else {
                return this.patch;
            }
        }
    };
}