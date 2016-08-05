/**
 * A Buffer transform that consumes a js-modules bundle and rewrites the
 * bundle map entries (source stubs and deps) to get the module export from
 * js-modules.
 */

var through = require('through2');
var logger = require('../logger');
var unpack = require('browser-unpack');

function plugin(moduleMappings) {
    var stream = through.obj(function (bundle, encoding, callback) {
        if (!(bundle instanceof Buffer)) {
            callback(new Error('Sorry, this transform only supports Buffers.'));
            return;
        }

        var bundleContent = bundle.toString('utf8');
        var packEntries = updateBundleStubs(bundleContent, moduleMappings);

        this.push(JSON.stringify(packEntries));
        callback();
    });
    return stream;
}

function updateBundleStubs(bundleContent, moduleMappings) {
    var packEntries  = unpack(bundleContent);
    var modulesDefs = extractModuleDefs(packEntries);

    addDependantsToDefs(packEntries, modulesDefs);
    addDependanciesToDefs(packEntries, modulesDefs);

    var jsModulesModuleDef = modulesDefs['@jenkins-cd/js-modules'];

    if (!jsModulesModuleDef) {
        // If @jenkins-cd/js-modules is not present in the pack, then
        // the earlier require transformers must not have found require
        // statements for the modules defined in the supplied moduleMappings.
        // In that case, nothing to be done so exit out.
        return packEntries;
    } else {
        for (var i in moduleMappings) {
            var moduleMapping = moduleMappings[i];
            var modulesDef = modulesDefs[moduleMapping.from];

            if (modulesDef) {
                var packEntry = getPackEntryById(packEntries, modulesDef.id);

                packEntry.source = "module.exports = require('@jenkins-cd/js-modules').require('" + moduleMapping.to + "')";
                packEntry.deps['@jenkins-cd/js-modules'] = jsModulesModuleDef.id;
            }
        }

        // Keeping as it's handy for debug purposes.
        //require('fs').writeFileSync('./target/bundlepack.json', JSON.stringify(packEntries, undefined, 4));

        return packEntries;
    }
}

function extractModuleDefs(packEntries) {
    var modulesDefs = {};

    for (var i in packEntries) {
        var packEntry = packEntries[i];

        for (var module in packEntry.deps) {
            if (packEntry.deps.hasOwnProperty(module)) {
                var moduleDef = modulesDefs[module];
                if (!moduleDef) {
                    var entryDepId = packEntry.deps[module];
                    modulesDefs[module] = {
                        id: entryDepId,
                        dependants: [],
                        dependancies: []
                    };
                }
            }
        }
    }

    return modulesDefs;
}

function addDependantsToDefs(packEntries, modulesDefs) {
    for (var i in packEntries) {
        var packEntry = packEntries[i];

        for (var module in packEntry.deps) {
            if (packEntry.deps.hasOwnProperty(module)) {
                var moduleDef = modulesDefs[module];
                if (moduleDef.dependants.indexOf(packEntry.id) === -1) {
                    moduleDef.dependants.push(packEntry.id);
                }
            }
        }
    }
}

function addDependanciesToDefs(packEntries, modulesDefs) {
    for (var i in packEntries) {
        var packEntry = packEntries[i];
        var moduleDef = getModuleDefById(modulesDefs, packEntry.id);

        if (!moduleDef) {
            // This is only expected if it's the entry module.
            if (!packEntry.entry) {
                logger.logWarn('No moduleDef created for moduleId ' + packEntry.id);
            }
            continue;
        }

        for (var module in packEntry.deps) {
            if (packEntry.deps.hasOwnProperty(module)) {
                var entryDepId = packEntry.deps[module];
                if (moduleDef.dependancies.indexOf(entryDepId) === -1) {
                    moduleDef.dependancies.push(entryDepId);
                }
            }
        }
    }
}

function getPackEntryById(packEntries, id) {
    for (var i in packEntries) {
        if (packEntries[i].id === id) {
            return packEntries[i];
        }
    }

    return undefined;
}

function getModuleDefById(modulesDefs, id) {
    for (var moduleName in modulesDefs) {
        if (modulesDefs.hasOwnProperty(moduleName)) {
            var moduleDef = modulesDefs[moduleName];
            if (moduleDef.id === id) {
                return moduleDef;
            }
        }
    }

    return undefined;
}

function streamToString(stream, callback) {
    var str = '';
    stream.on('data', function (chunk) {
        str += chunk;
    });
    stream.on('end', function () {
        callback(str);
    });
}

module.exports = plugin;