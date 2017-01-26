var fs = require('fs');
var cwd = process.cwd();

exports.isMavenProject = fs.existsSync(cwd + '/pom.xml');

if (exports.isMavenProject) {
    var xmlParser = require('xml2js').parseString;
    var pomXML = fs.readFileSync('pom.xml', "utf-8");

    xmlParser(pomXML, function (err, parseResult) {
        exports.pom = parseResult;
    });
}

exports.getArtifactId = function() {
    assertIsMavenProject();
    return exports.pom.project.artifactId[0];
};

exports.getPackaging = function() {
    assertIsMavenProject();
    if (exports.pom.project.packaging) {
        return exports.pom.project.packaging[0];
    } else {
        return 'jar';
    }
};

exports.isHPI = function() {
    return (exports.isMavenProject && exports.getPackaging() === 'hpi');
};

function assertIsMavenProject(preamble) {
    if (!exports.isMavenProject) {
        if (preamble) {
            throw new Error(preamble + ' - This is not a maven project.');
        } else {
            throw new Error('This is not a maven project.');
        }
    }
}


