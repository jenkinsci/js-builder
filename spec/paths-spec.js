var paths = require('../internal/paths');
var cwd = process.cwd();
var fs = require('fs');

describe("paths test", function () {

    it("- test getAbsoluteJSRoot", function () {
        expect(paths.getAbsoluteJSRoot()).toBe(cwd + '/internal');
    });

    it("- test toAbsoluteJSPath", function () {
        expect(paths.toAbsoluteJSPath('menu/MyWidget')).toBe(cwd + '/internal/menu/MyWidget');
    });

    it("- test mkdirp", function () {
        var pathRoot = 'target/' + (new Date().getTime());
        var path = pathRoot + '/d1/d2/d3';
        
        // Make sure it doesn't exist first.
        expect(fs.existsSync(path)).toBe(false);
        expect(fs.existsSync(pathRoot)).toBe(false);

        // Create it and test that it exists.
        paths.mkdirp(path);
        expect(fs.existsSync(path)).toBe(true);

        // Creating it again shouldn't throw a wobbler.
        paths.mkdirp(path);
    });
    
    it("- test findClosest", function () {
        expect(__dirname).toBeDefined();
        expect(paths.findClosest('package.json', __dirname)).toBeDefined();
        expect(paths.findClosest('blah-xxx-whatever-1234.xyz', __dirname)).not.toBeDefined();
    });
    
    it("- test walkDirs - no stopAtDepth", function () {
        var dirs = [];
        paths.walkDirs(cwd + '/spec', function (dir) {
            dirs.push(dir);
        });
        expect(dirs.length).toBe(4); // yeah, this will need to be changed if folders are added. That's fine.
    });
    
    it("- test walkDirs - with stopAtDepth", function () {
        var dirs = [];
        
        paths.walkDirs(cwd, function (dir) {
            if (dir.indexOf('/node_modules') !== -1) {
                dirs.push(dir);
            }
        }, 1);
        
        // Should only be one dir that has /node_modules in the path.
        // If there's more than one then we didn't stop recursion in time.
        expect(dirs.length).toBe(1);
    });
    
    it("- test walkDirs - with callback controlled stop", function () {
        var dirs = [];
        
        paths.walkDirs(cwd, function (dir) {
            if (dir.indexOf('/node_modules') !== -1) {
                dirs.push(dir);
                // returning false should stop the recursion.
                return false;
            }
        });
        
        // Should only be one dir that has /node_modules in the path.
        // If there's more than one then we didn't stop recursion in time.
        expect(dirs.length).toBe(1);
    });
});