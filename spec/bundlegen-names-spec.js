var cwd = process.cwd();
var fs = require('fs');

// Check that the generated bundles have the expected names.
describe("bundle generation naming tests", function () {

    it("- names as expected", function () {
        function moduleExists(fileName) {
            expect(fs.existsSync(cwd + '/target/testmodule/' + fileName)).toBe(true);
        }

        moduleExists('testmodule-1-1-1.js');
        moduleExists('testmodule_1.js');
        moduleExists('testmodule_2.js');
        moduleExists('testmodule_3.js');

        // See gulpfile.js - bundle "as" was specified with a
        // prerelease tag of "beta1" (testmodule@1.1.2-beta1) - that
        // should not be included in the file name
        moduleExists('testmodule-1-1-2.js');
    });
});
