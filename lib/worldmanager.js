var EventEmitter = require('events');
var merge = require('merge');
var util = require('util');
var workerproxy = require('workerproxy');

var World = require('./world');

module.exports = WorldManager;

function WorldManager(opt_options) {
  EventEmitter.call(this);

  var options = {
    workerPath: __dirname + '/worker.js'
  };

  Object.seal(options);
  merge(options, opt_options);
  Object.freeze(options);

  this.options = options;

  var worker = new Worker(options.workerPath);
  this.api = workerproxy(worker);
}
util.inherits(WorldManager, EventEmitter);

WorldManager.prototype.open = function (file, opt_callback) {
  this.api.open(file, (err, info) => {
    if (err) {
      if (opt_callback) opt_callback(err, null);
      return;
    }

    // TODO: Convert metadata to latest version.
    var world = new World(this, file, info);
    this.emit('load', {world: world});
    if (opt_callback) opt_callback(err, world);
  });
};
