var EventEmitter = require('events');
var merge = require('merge');
var util = require('util');
var workerproxy = require('workerproxy');

var Region = require('./region');

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

  this.metadata = null;
}
util.inherits(WorldManager, EventEmitter);

WorldManager.prototype.getRegion = function (x, y, callback) {
  this.api.getRegion(x, y, function (err, regionData) {
    if (err) {
      callback(err);
    } else {
      callback(null, new Region(regionData));
    }
  });
};

WorldManager.prototype.open = function (file, callback) {
  var self = this;
  this.api.open(file, function (err, metadata) {
    self.metadata = metadata;
    self.emit('load', {metadata: metadata});
    callback(err, metadata);
  });
};
