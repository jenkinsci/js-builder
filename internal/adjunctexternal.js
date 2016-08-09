var maven = require('./maven');
var dependencies = require('./dependecies');
var logger = require('./logger');
var paths = require('./paths');
var fs = require('fs');
var cwd = process.cwd();

exports.bundleFor = function(builder, packageName) {
    var extVersionMetadata = dependencies.externalizedVersionMetadata(packageName);
    
    if (!extVersionMetadata) {
        throw new Error('Unable to create Jenkins adjunct based external module bundle for package "' + packageName + '". This package is not installed.');
    }

    var normalizedPackageName = extVersionMetadata.normalizedPackageName;
    var jsModuleNames = extVersionMetadata.jsModuleNames;
    var depVersion = extVersionMetadata.depVersion;
    var inDir = 'target/classes/org/jenkins/ui/jsmodules/' + normalizedPackageName;
    
    if (!fs.existsSync(cwd + '/' + inDir + '/' + jsModuleNames.nameFor(depVersion) + '.js')) {
        // We need to generate an adjunct bundle for the package.
        var bundleSrc = generateBundleSrc(extVersionMetadata);
        builder.bundle(bundleSrc).inDir(inDir).namespace(normalizedPackageName).noEmptyModuleExport().ignoreGlobalModuleMappings();
    } else {
        // The bundle has already been generated. No need to do it again.
        // For linked modules ... do an rm -rf of the target dir ... sorry :)
        logger.logInfo('Bundle for "' + packageName + '" already created. Delete "target" directory ad run bundle again to recreate.');
    }

    return extVersionMetadata.importAs();
};

function generateBundleSrc(extVersionMetadata) {
    var packageName = extVersionMetadata.packageName;
    var normalizedPackageName = extVersionMetadata.normalizedPackageName;
    var jsModuleNames = extVersionMetadata.jsModuleNames;
    var depVersion = extVersionMetadata.depVersion;
    var srcContent = '';

    srcContent += "//\n";
    srcContent += "// NOTE: This file is generated and should NOT be added to source control.\n";
    srcContent += "//\n";
    srcContent += "\n";
    // Export for each compatible version scope of the installed package,
    // allowing it to be shared where compatible and so avoiding loading of
    // multiple versions of the same lib where possible.
    srcContent += "require('@jenkins-cd/js-modules').export('" + normalizedPackageName + "', '" + jsModuleNames.patch + "', require('" + packageName + "'));\n";
    srcContent += "require('@jenkins-cd/js-modules').export('" + normalizedPackageName + "', '" + jsModuleNames.minor + "', require('" + packageName + "'));\n";
    srcContent += "require('@jenkins-cd/js-modules').export('" + normalizedPackageName + "', '" + jsModuleNames.major + "', require('" + packageName + "'));\n";
    srcContent += "require('@jenkins-cd/js-modules').export('" + normalizedPackageName + "', '" + jsModuleNames.any + "', require('" + packageName + "'));\n";
    
    var bundleSrcDir = 'target/js-bundle-src';
    
    paths.mkdirp(bundleSrcDir);
    
    var bundleSrcFile = bundleSrcDir + '/' + jsModuleNames.nameFor(depVersion) + '.js';
    fs.writeFileSync(cwd +  '/' + bundleSrcFile, srcContent);
    return bundleSrcFile;
}