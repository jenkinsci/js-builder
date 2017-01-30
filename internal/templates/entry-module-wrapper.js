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
        onExec();
    }
}

{{#each startupModules}}
promise.make(function(fulfill) {
    try {
        var startupModule = require('{{this}}');
        startupModule.execute(fulfill, config);
    } catch (e) {
        throw new Error('Unexpected error executing startup module "{{this}}": ' + e);
    }
}).onFulfilled(function() {
    onFullfilled('{{this}}');
});
{{/each}}