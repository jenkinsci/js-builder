var Browser = require("zombie");

describe("index.js", function () {

    it("- test testmodule_1", function (done) {
        var browser = new Browser();
        var jsLoads = [];

        browser.debug();
        browser.on('request', function(request) {
            var url = request.url;
            if (endsWith(url, '.js')) {
                jsLoads.push(url);
            }
        });
        
        browser.visit('http://localhost:18999/spec/testmodule_1.html', function() {
            expect(browser.success).toBe(true);
            
            // Make sure all the scripts were loaded as expected.
            expect(browser.success).toBe(true);
            expect(jsLoads.length).toBe(1);
            expect(jsLoads[0]).toBe('http://localhost:18999/target/testmodule/testmodule_1.js');
            
            // Make sure the bundle executed...
            expect(browser.window.testmoduleXYZ).toBe('Hello');
            
            done();
        });
    });

    it("- test testmodule_2", function (done) {
        var browser = new Browser();
        var jsLoads = [];

        browser.debug();
        browser.on('request', function(request) {
            var url = request.url;
            if (endsWith(url, '.js')) {
                jsLoads.push(url);
            }
        });
        
        browser.visit('http://localhost:18999/spec/testmodule_2.html', function() {
            expect(browser.success).toBe(true);
            
            // Make sure all the scripts were loaded as expected.
            expect(browser.success).toBe(true);
            expect(jsLoads.length).toBe(2);
            expect(jsLoads[0]).toBe('http://localhost:18999/target/testmodule/testmodule_2.js');
            expect(jsLoads[1]).toBe('http://localhost:18999/target/classes/org/jenkins/ui/jsmodules/underscore.string/underscore.string-3-3-4.js'); // loading of the dependency

            // Shouldn't be any css loaded
            browser.assert.elements('link', 0);
            
            // Make sure the bundle executed...
            expect(browser.window.testmoduleXYZ).toBe('Hello');
            
            done();
        });
    });

    it("- test testmodule_3", function (done) {
        var browser = new Browser();
        var jsLoads = [];

        browser.debug();
        browser.on('request', function(request) {
            var url = request.url;
            if (endsWith(url, '.js')) {
                jsLoads.push(url);
            }
        });
        
        browser.visit('http://localhost:18999/spec/testmodule_3.html', function() {
            expect(browser.success).toBe(true);
            
            // Make sure all the scripts were loaded as expected.
            expect(browser.success).toBe(true);
            expect(jsLoads.length).toBe(2);
            expect(jsLoads[0]).toBe('http://localhost:18999/target/testmodule/testmodule_3.js');
            expect(jsLoads[1]).toBe('http://localhost:18999/target/classes/org/jenkins/ui/jsmodules/underscore.string/underscore.string-3-3-4.js'); // loading of the dependency

            // Should be css on page
            browser.assert.elements('link', 1);
            browser.assert.attribute('link', 'href', '/target/classes/org/jenkins/ui/jsmodules/underscore.string/underscore.string-3-3-4/style.css');
            
            // Make sure the bundle executed...
            expect(browser.window.testmoduleXYZ).toBe('Hello');
            
            done();
        });
    });

    it("- test testmodule_3_no_imports", function (done) {
        var browser = new Browser();
        var jsLoads = [];

        browser.debug();
        browser.on('request', function(request) {
            var url = request.url;
            if (endsWith(url, '.js')) {
                jsLoads.push(url);
            }
        });
        
        browser.visit('http://localhost:18999/spec/testmodule_3_no_imports.html', function() {
            expect(browser.success).toBe(true);
            
            // Make sure all the scripts were loaded as expected.
            expect(browser.success).toBe(true);
            expect(jsLoads.length).toBe(1);
            expect(jsLoads[0]).toBe('http://localhost:18999/target/testmodule/no_imports/testmodule_3.js');
            
            // check that the template was applied
            var messageDiv = browser.window.document.getElementById('messageDiv');
            expect(messageDiv).toBeDefined();
            expect(messageDiv.textContent).toBe('Hello World');
            
            // Make sure the bundle executed...
            expect(browser.window.testmoduleXYZ).toBe('Hello');
            
            done();
        });
    });
});

function endsWith(string, suffix) {
    return string.indexOf(suffix, string.length - suffix.length) !== -1;
}