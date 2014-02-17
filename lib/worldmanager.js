var merge = require('merge');
var workerproxy = require('workerproxy');

var Region = require('./region');

module.exports = WorldManager;

function WorldManager(opt_options) {
  var options = {
    workerPath: __dirname + '/worker.js'
  };

  Object.seal(options);
  merge(options, opt_options);
  Object.freeze(options);

  this.options = options;

  var worker = new Worker(options.workerPath);
  this.api = workerproxy(worker);

  // Reroute some functions to the worker.
  this.open = this.api.open;
}

WorldManager.prototype.getRegion = function (x, y, callback) {
  this.api.getRegion(x, y, function (err, regionData) {
    callback(null, new Region(regionData));
  });
};
