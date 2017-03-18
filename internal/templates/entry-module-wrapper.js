var promise = require("@jenkins-cd/js-modules/js/promise");

var numStartupModules = {{startupModules.length}};
var fullfilled = [];
var config = {
    hpiPluginId: {{#if hpiPluginId}}'{{hpiPluginId}}'{{else}}undefined{{/if}}
};

function onFullfilled(moduleName) {
    if (fullfilled.indexOf(moduleName) === -1) {
        fullfilled.push(moduleName);
    }
    if (fullfilled.length === numStartupModules) {
        require('{{entrymodule}}');
        try {
            if (onExec) {
                onExec();
            }
        } catch (e) {
            console.log('No onExec function, or an unexpected error executing it. Probably because of bundle.generateNoImportsBundle().');
        }
    }
}

{{#each startupModules}}
promise.make(function(fulfill) {
    try {
        var startupModule = require('{{this}}');
        startupModule.execute(fulfill, config);
    } catch (e) {
        console.error(e);
        throw new Error('Unexpected error executing startup module "{{this}}": ' + e);
    }
}).onFulfilled(function() {
    onFullfilled('{{this}}');
});
{{/each}}