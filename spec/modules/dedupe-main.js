
// Require two different modules having identical content. This
// should cause browserify to dedupe the entries for both of these. 
var d1 = require('./dedupe-one');
var d2 = require('./dedupe-two');

console.log(d1);
console.log(d2);