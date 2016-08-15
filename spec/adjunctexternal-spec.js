var paths = require('../internal/paths');
var cwd = process.cwd();
var fs = require('fs');

describe("adjunctexternal test", function () {

    it("- test NPM org package name", function () {
        // The bundling should have generated an externalized bundle 
        // for @jenkins-cd/js-modules. See the gulpfile.js
        
        var dependecies = require('../internal/dependecies');
        var jsModulesVersion = dependecies.getDependency('@jenkins-cd/js-modules').version;
        var generatedBundleFile = 'target/js-bundle-src/jenkins-cd-js-modules-0-0-6.js';
        
        expect(fs.existsSync(generatedBundleFile)).toBe(true);
        
        var fileContents = fs.readFileSync(generatedBundleFile, 'utf8');
        //console.log(fileContents);
        
        // Check that the file contains an export for the module and that the names used in the export are
        // properly normalized i.e. no "@jenkins-cd" etc 
        var indexOfPart = fileContents.indexOf("jsModules.export('jenkins-cd-js-modules', 'jenkins-cd-js-modules@0.0.6', require('@jenkins-cd/js-modules'));");
        expect(indexOfPart !== -1).toBe(true);
        // And that the 'any' version is exported.
        indexOfPart = fileContents.indexOf("jsModules.export('jenkins-cd-js-modules', 'jenkins-cd-js-modules@any', require('@jenkins-cd/js-modules'));");
        expect(indexOfPart !== -1).toBe(true);
    });
});