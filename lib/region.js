var TILES_X = 32;
var TILES_Y = 32;
var TILES_PER_REGION = TILES_X * TILES_Y;

var HEADER_BYTES = 3;
var BYTES_PER_TILE = 23;
var BYTES_PER_ROW = BYTES_PER_TILE * TILES_X;
var BYTES_PER_REGION = BYTES_PER_TILE * TILES_PER_REGION;

module.exports = Region;

function Region(data) {
  this.buffer = data.buffer;
  this.entities = data.entities;
  this.tileView = new DataView(data.buffer);
}

/**
 * Returns material ids and material mod ids used within the region.
 */
Region.prototype.getResourceIds = function () {
  var materialIds = [], matModIds = [], id;
  for (var offset = HEADER_BYTES; offset < HEADER_BYTES + BYTES_PER_REGION; offset += BYTES_PER_TILE) {
    id = this.tileView.getInt16(offset);
    if (id > 0 && materialIds.indexOf(id) == -1) materialIds.push(id);
    id = this.tileView.getInt16(offset + 7);
    if (id > 0 && materialIds.indexOf(id) == -1) materialIds.push(id);

    id = this.tileView.getInt16(offset + 4);
    if (id > 0 && matModIds.indexOf(id) == -1) matModIds.push(id);
    id = this.tileView.getInt16(offset + 11);
    if (id > 0 && matModIds.indexOf(id) == -1) matModIds.push(id);
  }

  return {materials: materialIds, matmods: matModIds};
};

Region.prototype.getMetadata = function (x, y) {
  var offset = this.getTileOffset(x, y);
  return [
    // Liquid
    this.tileView.getUint8(offset + 14),
    // Liquid pressure
    this.tileView.getUint16(offset + 15),
    // Collision map
    this.tileView.getUint8(offset + 17),
    // ?
    this.tileView.getInt16(offset + 18),
    // Biome?
    this.tileView.getUint8(offset + 20),
    // Biome?
    this.tileView.getUint8(offset + 21),
    // Indestructible
    !!this.tileView.getUint8(offset + 22)
  ];
};

Region.prototype.getNeighbors = function (x, y, opt_background) {
  var center = this.getTileOffset(x, y) + (opt_background ? 7 : 0);
  return {
    top: !!y && this.tileView.getInt16(center + BYTES_PER_ROW),
    right: (x < TILES_X - 1) && this.tileView.getInt16(center + BYTES_PER_TILE),
    bottom: (y < TILES_Y - 1) && this.tileView.getInt16(center - BYTES_PER_ROW),
    left: !!x && this.tileView.getInt16(center - BYTES_PER_TILE)
  };
};

Region.prototype.getTile = function (x, y) {
  var offset = this.getTileOffset(x, y);
  return [
    // Material id
    this.tileView.getInt16(offset),
    // Hue shift
    this.tileView.getUint8(offset + 2),
    // Variant?
    this.tileView.getUint8(offset + 3),
    // Mod
    this.tileView.getInt16(offset + 4),
    // Mod hue shift
    this.tileView.getUint8(offset + 6),

    // Material id
    this.tileView.getInt16(offset + 7),
    // Hue shift
    this.tileView.getUint8(offset + 9),
    // Variant?
    this.tileView.getUint8(offset + 10),
    // Mod
    this.tileView.getInt16(offset + 11),
    // Mod hue shift
    this.tileView.getUint8(offset + 13)
  ];
};

Region.prototype.getTileOffset = function (x, y) {
  return HEADER_BYTES + BYTES_PER_REGION - BYTES_PER_ROW * (y + 1) + BYTES_PER_TILE * x;
};
