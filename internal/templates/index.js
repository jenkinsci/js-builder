var fs = require('fs');
var Handlebars = require('handlebars');

exports.getTemplate = function(name) {
    var filePath = __dirname + '/' + name;

    if (!fs.existsSync(filePath)) {
        throw new Error('Template file "' + filePath + '" does not exist.');
    }

    var templateSource = fs.readFileSync(filePath, 'utf8');

    return Handlebars.compile(templateSource, {noEscape: true});
};