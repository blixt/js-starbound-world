module.exports = World;

function World(manager, file, info) {
  this._handle = info.handle;
  this._manager = manager;

  this.lastModified = file.lastModifiedDate;
  this.metadata = info.metadata;

  // TODO: Remove this logic once world metadata is automatically upgraded.
  var location, data, params;
  switch (info.metadata.__version__) {
    case 1:
      data = info.metadata.planet;
      params = data.config.celestialParameters;

      var coord = data.config.skyParameters.coordinate;
      if (coord) {
        location = coord.parentSystem.location;
      }

      break;
    case 2:
    case 3:
      data = info.metadata.worldTemplate;
      params = data.celestialParameters;

      if (params) {
        location = params.coordinate.location;
      }

      break;
    default:
      throw new Error('Unsupported metadata version ' + metadata.__version__);
  }

  this.tilesX = data.size[0];
  this.tilesY = data.size[1];

  this.spawnX = info.metadata.playerStart[0];
  this.spawnY = info.metadata.playerStart[1];

  // Ships don't have name or location.
  if (params) {
    this.name = params.name;
    this.biome = params.primaryBiomeName || params.scanData.primaryBiomeName;
  } else {
    if (file.name.match(/\.shipworld$/)) {
      this.name = 'Ship';
    } else {
      this.name = 'Unknown';
    }
    this.biome = null;
  }

  if (location) {
    this.x = location[0];
    this.y = location[1];
  } else {
    this.x = null;
    this.y = null;
  }
}

World.prototype.close = function (callback) {
  this._manager.api.close(this._handle, callback);
  this._manager = null;
  this._handle = -1;
};

World.prototype.getRegion = function (x, y, callback) {
  if (!this._manager) throw new Error('The world file is closed');
  this._manager.api.getRegion(this._handle, x, y, callback);
};

World.prototype.isOpen = function () {
  return !!this._manager;
};
