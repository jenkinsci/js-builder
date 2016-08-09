describe("dependencies test", function () {

    it("- getDependency", function () {
        var dependecies = require('../internal/dependecies');
        var dep;
        
        dep = dependecies.getDependency('@jenkins-cd/js-modules');
        expect(dep.type).toBe('dev');
        
        dep = dependecies.getDependency('zombie');
        expect(dep.type).toBe('dev');
    });


    it("- parseVersion", function () {
        var dependecies = require('../internal/dependecies');

        var parsedVer = dependecies.parseVersion('1.2.3');
        expect(parsedVer.major).toBe('1');
        expect(parsedVer.minor).toBe('2');
        expect(parsedVer.patch).toBe('3');
        expect(parsedVer.prerelease).toBe(undefined);

        parsedVer = dependecies.parseVersion('1.2.3-beta.1');
        expect(parsedVer.major).toBe('1');
        expect(parsedVer.minor).toBe('2');
        expect(parsedVer.patch).toBe('3');
        expect(parsedVer.prerelease).toBe('beta.1');
    });

});
