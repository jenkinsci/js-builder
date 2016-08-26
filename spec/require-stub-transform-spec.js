var fs = require('fs');
var browserify = require('browserify');
var unpack = require('browser-unpack');
var transformModule = require('../internal/pipeline-transforms/require-stub-transform');

describe("require-stub-transform", function () {

    it("- test no mappings", function (done) {
        buildBrowserPack('module1.js', function (packEntries) {
            var metadata = transformModule.updateBundleStubs(packEntries, []);

            //logMetadata(metadata);

            // Check we have defs for all modules. We won't have a def for
            // module1 because it's the bundle "entry" module.
            expect(getPackEntryByName(metadata, './module2')).toBeDefined();
            expect(getPackEntryByName(metadata, './module3')).toBeDefined();
            expect(getPackEntryByName(metadata, './module4')).toBeDefined();
            expect(getPackEntryByName(metadata, './module5')).toBeDefined();
            expect(getPackEntryByName(metadata, './module6')).toBeDefined();
            expect(getPackEntryByName(metadata, './module7')).toBeDefined();
            expect(getPackEntryByName(metadata, './module8')).toBeDefined();
            expect(getPackEntryByName(metadata, './module9')).toBeDefined();

            done()
        });
    });

    it("- test one mapping - no dependencies", function (done) {
        buildBrowserPack('module1.js', function (packEntries) {
            // Add a mapping for module6. module4 and module5 both depend
            // on module6, but module6 has no dependencies, which means
            // that stubbing it out should not really have any effect other
            // than a rewrite of it's source to get the module from js-modules.
            // See the dependency graph illustration in module1.js
            var metadata = transformModule.updateBundleStubs(packEntries, [{from: './module6', to: 'mod6:mod6v2'}]);

            //logMetadata(metadata);

            // We should still have defs for all modules.
            expect(getPackEntryByName(metadata, './module2')).toBeDefined();
            expect(getPackEntryByName(metadata, './module3')).toBeDefined();
            expect(getPackEntryByName(metadata, './module4')).toBeDefined();
            expect(getPackEntryByName(metadata, './module5')).toBeDefined();
            expect(getPackEntryByName(metadata, './module6')).toBeDefined();
            expect(getPackEntryByName(metadata, './module7')).toBeDefined();
            expect(getPackEntryByName(metadata, './module8')).toBeDefined();
            expect(getPackEntryByName(metadata, './module9')).toBeDefined();

            // Now check the bundle pack map entry for module6...
            var module6PackEntry = getPackEntryByName(metadata, './module6');
            expect(module6PackEntry).toBeDefined();
            // The source should just be the js-modules require ...
            expect(module6PackEntry.source).toBe("module.exports = require('@jenkins-cd/js-modules').require('mod6:mod6v2');");
            // Should only depend on js-modules ...
            expect(countDependencies(module6PackEntry)).toBe(1);
            expect(module6PackEntry.deps['@jenkins-cd/js-modules']).toBeDefined();

            done()
        });
    });

    it("- test one mapping - has unshared dependencies", function (done) {
        buildBrowserPack('module1.js', function (packEntries) {
            // Add a mapping for module7. module7 depends on module8/9.
            // module8/9 has no other dependants, so mapping/stubbing module7
            // should also result in module8/9 being removed from the bundle
            // because they are no longer in use.
            // See the dependency graph illustration in module1.js
            var metadata = transformModule.updateBundleStubs(packEntries, [{from: './module7', to: 'mod7:mod6v2'}]);

            // We should have defs for all modules except module8.
            expect(getPackEntryByName(metadata, './module2')).toBeDefined();
            expect(getPackEntryByName(metadata, './module3')).toBeDefined();
            expect(getPackEntryByName(metadata, './module4')).toBeDefined();
            expect(getPackEntryByName(metadata, './module5')).toBeDefined();
            expect(getPackEntryByName(metadata, './module6')).toBeDefined();
            expect(getPackEntryByName(metadata, './module7')).toBeDefined();
            expect(getPackEntryByName(metadata, './module8')).not.toBeDefined();
            expect(getPackEntryByName(metadata, './module9')).not.toBeDefined();

            done()
        });
    });

    it("- test one mapping - has shared dependencies", function (done) {
        buildBrowserPack('module1.js', function (packEntries) {
            // Add a mapping for module2. module2 depends on module4 and
            // module4 depends on module6.
            // module4 has no other dependants, so mapping/stubbing module2
            // should also result in module4 being removed from the bundle
            // because it is no longer in use. module6 however would still
            // have a dependants (module5) so should not be removed from
            // the bundle.
            // See the dependency graph illustration in module1.js
            var metadata = transformModule.updateBundleStubs(packEntries, [{from: './module2', to: 'mod2:mod6v2'}]);

            // We should have defs for all modules except module4.
            expect(getPackEntryByName(metadata, './module2')).toBeDefined();
            expect(getPackEntryByName(metadata, './module3')).toBeDefined();
            expect(getPackEntryByName(metadata, './module4')).not.toBeDefined();
            expect(getPackEntryByName(metadata, './module5')).toBeDefined();
            expect(getPackEntryByName(metadata, './module6')).toBeDefined();
            expect(getPackEntryByName(metadata, './module7')).toBeDefined();
            expect(getPackEntryByName(metadata, './module8')).toBeDefined();
            expect(getPackEntryByName(metadata, './module9')).toBeDefined();

            done()
        });
    });

    it("- test two mappings - has shared dependencies - all pruned", function (done) {
        buildBrowserPack('module1.js', function (packEntries) {
            // Add mappings for module2 and module3. module2 depends on module4 and
            // module4 depends on module6.  module3 depends on module5 and
            // module5 also depends on module6 (just as module4).
            // In the previous test, maping module4 on its own resulted in module6
            // being kept in the bundle because of module5 depending on it.
            // Mapping module2 and module3 should remove in module4 and module5 being
            // removed from the bundle, which in turn should result in module6 being removed
            // because it is no longer in use.
            // See the dependency graph illustration in module1.js
            var metadata = transformModule.updateBundleStubs(packEntries, [
                {from: './module2', to: 'mod2:mod6v2'},
                {from: './module3', to: 'mod3:mod6v2'}
            ]);

            // We should have defs for all modules except module4, module5 and module6.
            expect(getPackEntryByName(metadata, './module2')).toBeDefined();
            expect(getPackEntryByName(metadata, './module3')).toBeDefined();
            expect(getPackEntryByName(metadata, './module4')).not.toBeDefined();
            expect(getPackEntryByName(metadata, './module5')).not.toBeDefined();
            expect(getPackEntryByName(metadata, './module6')).not.toBeDefined();
            expect(getPackEntryByName(metadata, './module7')).toBeDefined();
            expect(getPackEntryByName(metadata, './module8')).toBeDefined();
            expect(getPackEntryByName(metadata, './module9')).toBeDefined();

            done()
        });
    });


    it("- test browserify dedupe - JENKINS-37714", function (done) {
        buildBrowserPack('dedupe-main.js', function (packEntries) {
                        var metadata = transformModule.updateBundleStubs(packEntries, []);

            // We should have defs for all modules except module4, module5 and module6.
            var dedupeOnePackEntry = getPackEntryByName(metadata, './dedupe-one');
            var dedupeTwoPackEntry = getPackEntryByName(metadata, './dedupe-two');
            
            expect(dedupeOnePackEntry).toBeDefined();
            expect(dedupeTwoPackEntry).toBeDefined();
            expect(dedupeOnePackEntry.id).toBe(2);
            expect(dedupeTwoPackEntry.id).toBe(3);
            
            // The contents of both these modules are identical, causing browserify
            // to optimize by pointing dedupeTwoPackEntry to just point to dedupeOnePackEntry.
            // We ant to check that the module id was properly translated.
            expect(dedupeTwoPackEntry.source).toBe('arguments[4][' + dedupeOnePackEntry.id + '][0].apply(exports,arguments)');

            done()
        });
    });    
});

function getPackEntryByName(metadata, name) {
    var packEntries = metadata.getPackEntriesByName(name);
    if (packEntries.length > 0) {
        return packEntries[0];
    }
    return undefined;
}

function countDependencies(packEntry) {
    var count = 0;
    for (var dep in packEntry.deps) {
        if (packEntry.deps.hasOwnProperty(dep)) {
            count++;
        }
    }
    return count;
}

function logMetadata(metadata) {
    var moduleDefs = metadata.modulesDefs;

    for (var packId in moduleDefs) {
        if (moduleDefs.hasOwnProperty(packId)) {
            var moduleDef = moduleDefs[packId];

            console.log(moduleDef);
            console.log('');
        }
    }
}

function buildBrowserPack(source, onDone) {
    var browserifyConfig = {
        entries: ['./spec/modules/' + source],
        extensions: ['.js'],
        cache: {},
        packageCache: {},
        fullPaths: true
    };
    var b = browserify(browserifyConfig);

    if (!fs.existsSync('./target/testbundles')) {
        fs.mkdirSync('./target/testbundles');
    }

    var bundlePath = './target/testbundles/' + source;
    var writeStream = fs.createWriteStream(bundlePath);

    writeStream.on('close', function() {
        if (onDone) {
            var bundleContent = fs.readFileSync(bundlePath);
            onDone(unpack(bundleContent));
        }
    });

    b.bundle().pipe(writeStream);
}