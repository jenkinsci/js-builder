/**
 * A Buffer transform that consumes a js-modules bundle and rewrites the
 * bundle map entries (source stubs and deps) to get the module export from
 * js-modules.
 */

var through = require('through2');
var logger = require('../logger');
var unpack = require('browser-unpack');

function pipelingPlugin(moduleMappings) {
    return through.obj(function (bundle, encoding, callback) {
        if (!(bundle instanceof Buffer)) {
            callback(new Error('Sorry, this transform only supports Buffers.'));
            return;
        }

        var bundleContent = bundle.toString('utf8');
        var packEntries  = unpack(bundleContent);

        updateBundleStubs(packEntries, moduleMappings);

        this.push(JSON.stringify(packEntries));
        callback();
    });
}

function updateBundleStubs(packEntries, moduleMappings) {
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
            var moduleDef = modulesDefs[moduleMapping.from];

            if (moduleDef) {
                var packEntry = getPackEntryById(packEntries, moduleDef.id);

                packEntry.source = "module.exports = require('@jenkins-cd/js-modules').require('" + moduleMapping.to + "');";
                packEntry.deps = {
                    '@jenkins-cd/js-modules': jsModulesModuleDef.id
                };

                // Go to all of the dependencies and remove this module from
                // it's list of dependants.
                removeDependant(moduleDef, modulesDefs, packEntries);
            }
        }

        // Keeping as it's handy for debug purposes.
        //require('fs').writeFileSync('./target/bundlepack.json', JSON.stringify(packEntries, undefined, 4));

        return {
            packEntries: packEntries,
            modulesDefs: modulesDefs,
            getPackEntryById: function(id) {
                return getPackEntryById(packEntries, id);
            },
            getPackEntryByName: function(name) {
                var moduleDef = modulesDefs[name];
                if (!moduleDef) {
                    return undefined;
                }
                return getPackEntryById(packEntries, moduleDef.id);
            },
            getModuleDefById: function(id) {
                return getModuleDefById(modulesDefs, id);
            },
            getModuleDefByName: function(name) {
                return modulesDefs[name];
            }
        };
    }
}

function removeDependant(moduleDefToRemove, modulesDefs, packEntries) {
    for (var moduleName in modulesDefs) {
        if (modulesDefs.hasOwnProperty(moduleName)) {
            var moduleDef = modulesDefs[moduleName];
            if (moduleDef !== moduleDefToRemove) {
                var dependantEntryIndex = moduleDef.dependants.indexOf(moduleDefToRemove.id);
                if (dependantEntryIndex !== -1) {
                    moduleDef.dependants.splice(dependantEntryIndex, 1);
                    if (moduleDef.dependants.length === 0) {
                        // If this module no longer has any dependants (i.e. nothing depends on it),
                        // that means that we can remove this module from the bundle. In turn, that
                        // also means that we can remove this module from the dependants list of other
                        // modules in the bundle. Therefore, there's a potential cascading effect that
                        // prunes the bundle of modules that are no longer in use as a result of
                        // mapping/stubbing modules.
                        removePackEntryById(packEntries, moduleDef.id);
                        removeDependant(moduleDef, modulesDefs, packEntries);
                    }
                }
            }
        }
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

function removePackEntryById(packEntries, id) {
    for (var i in packEntries) {
        if (packEntries[i].id === id) {
            packEntries.splice(i, 1);
            return
        }
    }
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

exports.pipelinePlugin = pipelingPlugin;
exports.updateBundleStubs = updateBundleStubs;