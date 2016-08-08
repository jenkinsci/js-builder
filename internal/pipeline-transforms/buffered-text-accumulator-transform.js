/**
 * Buffered text accumulator stream transform.
 * <p>
 * Simply gathers and accumulates all test chunks passed to the transformer
 * instance, emitting the full content in one go at the end during flush).
 */

var Transform = require('stream').Transform;

module.exports = function() {
    var transform = new Transform();
    var content = '';

    transform._transform = function (chunk, encoding, callback) {
        if (!(chunk instanceof Buffer)) {
            callback(new Error('Sorry, this transform only supports Buffers.'));
            return;
        }

        content += chunk.toString('utf8');
        callback();
    };
    transform._flush = function (callback) {
        this.push(content);
        callback();
    };

    return transform;
};
