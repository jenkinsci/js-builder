// Need this require just the make the transfor
// apply the mappings ... will ignore if it finds no
// js-modules in the pack. The bundling transforms make sure
// this happens in the real bundling process.
var jsmodules = require('@jenkins-cd/js-modules');

// We structure the module dependencies as follows and then use that to
// test require-stub-transform.js. We'll have tests that specify import
// mappings for different modules and then we can test to make sure that
// module's body gets removed from the generated bundle, as well as
// complete removal of modules that have become unused because of the
// removal of dependencies etc.

//  module1 -
//          |- module2 -
//                     |- module4 -
//                                |- module6
//          |- module3
//                     |- module5 -
//                                |- module6
//          |- module7
//                     |- module8

var module2 = require('./module2');
var module3 = require('./module3');
var module7 = require('./module7');

console.log('*** module: ', module2);
console.log('*** module: ', module3);
console.log('*** module: ', module7);