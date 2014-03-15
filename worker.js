var World = require('starbound-files').World;
var workerproxy = require('workerproxy');

// Keep open worlds in a map, identified by a handle.
var worlds = {},
    nextHandle = 1;

workerproxy({
  close: function (handle, callback) {
    handle = handle.toString();
    if (!(handle in worlds)) {
      throw new Error('The specified world is not open.');
    }

    // TODO: Is there any clean up that could be done on the world or should we
    //       just rely on the GC?
    delete worlds[handle];
    callback(null);
  },

  getRegion: function (handle, x, y, callback) {
    handle = handle.toString();
    if (!(handle in worlds)) {
      throw new Error('The specified world is not open.');
    }

    var world = worlds[handle].world;

    var buffer = world.getRegionData(1, x, y),
        entities = world.getEntities(x, y);

    var region = {buffer: buffer, entities: entities};
    callback.transfer([region.buffer], null, region);
  },

  open: function (file, callback) {
    // Open the world and get its metadata.
    var world = World.open(file),
        metadata = world.getMetadata();

    // Store the world in the worlds map.
    var handle = nextHandle++;
    worlds[handle] = {world: world};

    callback(null, {handle: handle, metadata: metadata});
  }
}, {catchErrors: true});
