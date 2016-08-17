var maven = require('./maven');
var dependencies = require('./dependecies');
var logger = require('./logger');
var paths = require('./paths');
var fs = require('fs');
var ModuleSpec = require('@jenkins-cd/js-modules/js/ModuleSpec');
var cwd = process.cwd();
var templates = require('./templates');
var exportModuleTemplate = templates.getTemplate('export-module.hbs');

exports.bundleFor = function(builder, packageName) {
    var packageSpec = new ModuleSpec(packageName);

    if (!packageSpec.getLoadBundleFileNamePrefix()) {
        logger.logInfo('Not create Jenkins adjunct based external module bundle for package "' + packageName + '". Is using a non-specific version name.');
        return undefined;
    }

    var extVersionMetadata = dependencies.externalizedVersionMetadata(packageSpec.moduleName);
    
    if (!extVersionMetadata) {
        throw new Error('Unable to create Jenkins adjunct based external module bundle for package "' + packageName + '". This package is not installed.');
    }

    var normalizedPackageName = extVersionMetadata.normalizedPackageName;
    var jsModuleNames = extVersionMetadata.jsModuleNames;
    var depVersion = extVersionMetadata.depVersion;
    var inDir = 'target/classes/org/jenkins/ui/jsmodules/' + normalizedPackageName;
    
    if (!fs.existsSync(cwd + '/' + inDir + '/' + jsModuleNames.filenameFor(depVersion) + '.js')) {
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
    srcContent += exportModuleTemplate({
        packageName: packageName,
        normalizedPackageName: normalizedPackageName,
        jsModuleNames: jsModuleNames
    });
    
    var bundleSrcDir = 'target/js-bundle-src';
    
    paths.mkdirp(bundleSrcDir);
    
    var bundleSrcFile = bundleSrcDir + '/' + jsModuleNames.filenameFor(depVersion) + '.js';
    fs.writeFileSync(cwd +  '/' + bundleSrcFile, srcContent);
    return bundleSrcFile;
}