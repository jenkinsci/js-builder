describe("dependencies test", function () {

    it("- getDependency", function () {
        var dependecies = require('../internal/dependecies');
        var dep;
        
        dep = dependecies.getDependency('@jenkins-cd/js-modules');
        expect(dep.type).toBe('dev');
        
        dep = dependecies.getDependency('zombie');
        expect(dep.type).toBe('dev');
    });
});
