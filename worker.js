var World = require('starbound-files').World;
var workerproxy = require('workerproxy');

var metadata, world;

workerproxy({
  getRegion: function (x, y, callback) {
    if (!world) {
      throw new Error('A world has to be opened before getting regions.');
    }

    // TODO: Cache regions.
    var buffer = world.getRegionData(1, x, y),
        entities = world.getEntities(x, y);

    var region = {buffer: buffer, entities: entities};
    callback.transfer([region.buffer], null, region);
  },

  open: function (file, callback) {
    if (world) {
      throw new Error('A world has already been opened.');
    }

    world = World.open(file);
    metadata = world.getMetadata();

    callback(null, metadata);
  }
}, {catchErrors: true});
