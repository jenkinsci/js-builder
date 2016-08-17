/**
 * A Buffer transform that consumes a js-modules bundle and rewrites the
 * bundle map entries (source stubs and deps) to get the module export from
 * js-modules.
 */

var through = require('through2');
var unpack = require('browser-unpack');
var ModuleSpec = require('@jenkins-cd/js-modules/js/ModuleSpec');
var logger = require('../logger');

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

    // We could remove unused modules from the packEntries at this point i.e. modules
    // that did not make an entry in modulesDefs are modules that nothing depends on.
    // Is there any good reason why these can not be removed from the bundle? Is there
    // a reason why browserify did not remove them? I've (TF) seen this and I'm not
    // talking about the entry module, which would often not have anything depending
    // on it.

    addDependantsToDefs(packEntries, modulesDefs);
    addDependanciesToDefs(packEntries, modulesDefs);

    var jsModulesModuleDef = getPackEntriesByName(modulesDefs, '@jenkins-cd/js-modules');

    if (jsModulesModuleDef.length === 0) {
        // If @jenkins-cd/js-modules is not present in the pack, then
        // the earlier require transformers must not have found require
        // statements for the modules defined in the supplied moduleMappings.
        // In that case, nothing to be done so exit out.
    } else {
        for (var i in moduleMappings) {
            var moduleMapping = moduleMappings[i];

            if (!moduleMapping.fromSpec) {
                moduleMapping.fromSpec = new ModuleSpec(moduleMapping.from);
            }

            var moduleName = moduleMapping.fromSpec.moduleName;
            var packEntries = getPackEntriesByName(modulesDefs, moduleName);
            if (packEntries.length === 1) {
                var packEntry = packEntries[0];
                var moduleDef = modulesDefs[packEntry.id];

                if (moduleDef) {
                    var toSpec = new ModuleSpec(moduleMapping.to);
                    var importAs = toSpec.importAs();

                    packEntry.source = "module.exports = require('@jenkins-cd/js-modules').require('" + importAs + "');";
                    packEntry.deps = {
                        '@jenkins-cd/js-modules': jsModulesModuleDef[0].id
                    };

                    // Go to all of the dependencies and remove this module from
                    // it's list of dependants.
                    removeDependant(moduleDef, modulesDefs, packEntries);
                }
            } else if (packEntries.length > 1) {
                logger.logWarn('Cannot map module "' + moduleName + '". Multiple bundle map entries are known by this name (in different contexts).');
            } else {
                // This can happen if the pack with that ID was already removed
                // because it's no longer being used (has nothing depending on it).
                // See removeDependant and how it calls removePackEntryById.
            }
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
        getPackEntriesByName: function(name) {
            return getPackEntriesByName(modulesDefs, name);
        },
        getModuleDefById: function(id) {
            return modulesDefs[id];
        },
        getModuleDefByName: function(name) {
            return modulesDefs[name];
        }
    };
}

function removeDependant(moduleDefToRemove, modulesDefs, packEntries) {
    for (var packId in modulesDefs) {
        if (modulesDefs.hasOwnProperty(packId)) {
            var moduleDef = modulesDefs[packId];
            if (moduleDef && moduleDef !== moduleDefToRemove) {
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
                        delete moduleDef.packEntry;
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

        for (var moduleName in packEntry.deps) {
            if (packEntry.deps.hasOwnProperty(moduleName)) {
                var depPackId = packEntry.deps[moduleName];
                var moduleDef = modulesDefs[depPackId];
                if (!moduleDef) {
                    var depPackEntry = getPackEntryById(packEntries, depPackId);
                    moduleDef = {
                        id: depPackId,
                        packEntry: depPackEntry,
                        knownAs: [],
                        isKnownAs: function(name) {
                            // Note that we need to be very careful about how we
                            // use this. Relative module names may obviously
                            // resolve to different pack entries, depending on
                            // the context,
                            return (this.knownAs.indexOf(name) !== -1);
                        },
                        dependants: [],
                        dependancies: []
                    };
                    modulesDefs[depPackId] = moduleDef;
                }
                if (moduleDef.knownAs.indexOf(moduleName) === -1) {
                    moduleDef.knownAs.push(moduleName);
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
                var entryDepId = packEntry.deps[module];
                var moduleDef = modulesDefs[entryDepId];
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
        var moduleDef = modulesDefs[packEntry.id];

        if (!moduleDef) {
            // This is only expected if it's the entry module.
            if (!packEntry.entry) {
                // No moduleDef created for moduleId with that pack ID. This module probably has
                // nothing depending on it (and in reality, could probably be removed from the bundle).
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

function getPackEntriesByName(modulesDefs, name) {
    var packEntries = [];

    for (var packId in modulesDefs) {
        if (modulesDefs.hasOwnProperty(packId)) {
            var modulesDef = modulesDefs[packId];
            if (modulesDef.isKnownAs(name) && modulesDef.packEntry) {
                packEntries.push(modulesDef.packEntry);
            }
        }
    }

    return packEntries;
}

function removePackEntryById(packEntries, id) {
    for (var i in packEntries) {
        if (packEntries[i].id === id) {
            packEntries.splice(i, 1);
            return
        }
    }
}

exports.pipelinePlugin = pipelingPlugin;
exports.updateBundleStubs = updateBundleStubs;