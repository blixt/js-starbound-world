var EventEmitter = require('events');
var util = require('util');

var RegionRenderer = require('./regionrenderer');
var World = require('./world');

module.exports = WorldRenderer;


var TILES_X = 32;
var TILES_Y = 32;
var TILES_PER_REGION = TILES_X * TILES_Y;

var HEADER_BYTES = 3;
var BYTES_PER_TILE = 30;
var BYTES_PER_ROW = BYTES_PER_TILE * TILES_X;
var BYTES_PER_REGION = HEADER_BYTES + BYTES_PER_TILE * TILES_PER_REGION;

var TILE_WIDTH = 8;
var TILE_HEIGHT = 8;

var REGION_WIDTH = TILE_WIDTH * TILES_X;
var REGION_HEIGHT = TILE_HEIGHT * TILES_Y;

var MIN_ZOOM = .1;
var MAX_ZOOM = 3;

var FNV_OFFSET_BASIS = 2166136279;
var FNV_PRIME = 16777619;
var FNV_SEED = 2938728349;

var BACKGROUND_VARIANT_SEED = 455934271;
var FOREGROUND_VARIANT_SEED = 786571541;


// Reusable buffer for calculating the bytes to FNV-hash.
var fnvView = new DataView(new ArrayBuffer(12));
fnvView.setUint32(8, FNV_SEED);

function fnvHashView(hash, view) {
  for (var i = 0; i < view.byteLength; i++) {
    hash = ((hash ^ view.getUint8(i)) >>> 0) * FNV_PRIME;
  }
  return hash;
}


function WorldRenderer(viewport, assetsManager, opt_world) {
  EventEmitter.call(this);

  // Ensure that canvases can be anchored to the viewport.
  var position = getComputedStyle(viewport).getPropertyValue('position');
  if (position != 'absolute' && position != 'relative') {
    viewport.style.position = 'relative';
  }

  this.viewport = viewport;
  this.assets = assetsManager;
  this.world = opt_world || null;

  this.centerX = 0;
  this.centerY = 0;
  this.zoom = 1;

  this.viewportX = 0;
  this.viewportY = 0;
  this.screenRegionWidth = REGION_WIDTH;
  this.screenRegionHeight = REGION_HEIGHT;

  this.materials = assetsManager.getResourceLoader('.material');
  this.matmods = assetsManager.getResourceLoader('.matmod');
  this.objects = assetsManager.getResourceLoader('.object');

  this.assets.on('images', () => this.requestRender());
  this.assets.on('resources', () => this.requestRender());

  this._canvasPool = [];
  this._freePool = null;
  this._poolLookup = null;

  this._backgrounds = [];
  this._regions = Object.create(null);

  this._bounds = viewport.getBoundingClientRect();
  this._regionsX = 0;
  this._regionsY = 0;
  this._tilesX = 0;
  this._tilesY = 0;
  this._fromRegionX = 0;
  this._fromRegionY = 0;
  this._toRegionX = 0;
  this._toRegionY = 0;
  this._visibleRegionsX = 0;
  this._visibleRegionsY = 0;

  this._loaded = false;
  this._requestingRender = false;
  this._setup = false;

  this._bgVariantHashBase = NaN;
  this._fgVariantHashBase = NaN;

  // Set up information about the world if it's available.
  if (this.world) {
    this._loadMetadata();
  }
}
util.inherits(WorldRenderer, EventEmitter);

/**
 * Centers the renderer viewport on the specified coordinates.
 * @param {number} tileX The X in-game coordinate to center on.
 * @param {number} tileY The Y in-game coordinate to center on.
 */
WorldRenderer.prototype.center = function (tileX, tileY) {
  this.centerX = tileX;
  this.centerY = tileY;
  this._calculateViewport();
};

WorldRenderer.prototype.getCanvas = function (region, z, opt_width, opt_height) {
  var key = region.x + ':' + region.y + ':' + z;

  var item = this._poolLookup[key], canvas;

  if (item) {
    canvas = item.canvas;
  } else {
    if (this._freePool.length) {
      item = this._freePool.pop();
      canvas = item.canvas;
    } else {
      // Create new <canvas> elements as they are needed.
      canvas = document.createElement('canvas');
      canvas.style.position = 'absolute';
      canvas.style.visibility = 'hidden';
      this.viewport.appendChild(canvas);

      // Register the new canvas in the pool.
      item = {canvas: canvas, region: region, z: z};
      this._canvasPool.push(item);
    }

    item.z = z;
    item.region = region;
    this._poolLookup[key] = item;

    // Mark the region as dirty since it's not reusing a canvas.
    region.setDirty();
  }

  // Only resize the canvas if necessary, since resizing clears the canvas.
  var width = typeof opt_width == 'number' ? opt_width : canvas.width,
      height = typeof opt_height == 'number' ? opt_height : canvas.height;

  if (canvas.width != width || canvas.height != height) {
    canvas.width = width;
    canvas.height = height;
    region.setDirty();
  }

  canvas.style.width = Math.round(width * this.zoom) + 'px';
  canvas.style.height = Math.round(height * this.zoom) + 'px';
  canvas.style.zIndex = z;

  return canvas;
};

WorldRenderer.prototype.getRegion = function (regionX, regionY, opt_skipNeighbors) {
  if (!this._loaded) return null;

  // Wrap the X axis.
  if (regionX >= this._regionsX) {
    regionX -= this._regionsX;
  } else if (regionX < 0) {
    regionX += this._regionsX;
  }

  // The Y axis doesn't wrap.
  if (regionY < 0 || regionY >= this._regionsY) {
    return null;
  }

  var key = regionX + ':' + regionY;

  // Get or create the region.
  var region;
  if (key in this._regions) {
    region = this._regions[key];
  } else {
    region = new RegionRenderer(regionX, regionY);
    this._regions[key] = region;
  }

  // Load the region data if it has not been initialized yet.
  if (region.state == RegionRenderer.STATE_UNINITIALIZED) {
    region.state = RegionRenderer.STATE_LOADING;

    this.world.getRegion(regionX, regionY, (err, regionData) => {
      if (err) {
        region.state = RegionRenderer.STATE_ERROR;
        if (err.message != 'Key not found') {
          console.error(err.stack);
        }
        return;
      } else if (regionData.buffer.byteLength != BYTES_PER_REGION) {
        region.state = RegionRenderer.STATE_ERROR;
        console.error('Corrupted region ' + regionX + ', ' + regionY);
        return;
      }

      region.entities = regionData.entities;
      region.view = new DataView(regionData.buffer);
      region.state = RegionRenderer.STATE_READY;

      region.setDirty();
      this.requestRender();
    });
  }

  // If the region should not get neighbors, return now.
  if (opt_skipNeighbors) return region;

  // Add references to surrounding regions.
  if (!region.neighbors) {
    region.neighbors = [
      this.getRegion(regionX, regionY + 1, true),
      this.getRegion(regionX + 1, regionY + 1, true),
      this.getRegion(regionX + 1, regionY, true),
      this.getRegion(regionX + 1, regionY - 1, true),
      this.getRegion(regionX, regionY - 1, true),
      this.getRegion(regionX - 1, regionY - 1, true),
      this.getRegion(regionX - 1, regionY, true),
      this.getRegion(regionX - 1, regionY + 1, true)
    ];

    for (var i = 0; i < 8; i++) {
      var neighbor = region.neighbors[i];
      if (!neighbor) continue;
      neighbor.setDirty();
    }

    region.setDirty();
    this.requestRender();
  }

  return region;
};

WorldRenderer.prototype.getVariant = function (x, y, opt_background) {
  var hash = opt_background ? this._bgVariantHashBase : this._fgVariantHashBase;

  fnvView.setUint32(0, x);
  fnvView.setUint32(4, y);

  return fnvHashView(hash, fnvView);
};

WorldRenderer.prototype.isRegionVisible = function (region) {
  if (!region) return false;

  var fromX = this._fromRegionX, toX = this._toRegionX,
      fromY = this._fromRegionY, toY = this._toRegionY;

  var visibleY = region.y >= fromY && region.y < toY;
  var visibleX = (region.x >= fromX && region.x < toX) ||
    (region.x >= fromX - this._regionsX && region.x < toX - this._regionsX) ||
    (region.x >= fromX + this._regionsX && region.x < toX + this._regionsX);

  return visibleX && visibleY;
};

// Start loading the resource indexes.
WorldRenderer.prototype.preload = function () {
  this.materials.loadIndex();
  this.matmods.loadIndex();
  this.objects.loadIndex();
};

WorldRenderer.prototype.refresh = function () {
  this._calculateViewport();
};

// TODO: When Chrome and Firefox support CanvasProxy offload rendering to the
//       worker.
WorldRenderer.prototype.render = function () {
  if (!this._loaded) return;

  if (!this._setup) {
    this._calculateViewport();
    return;
  }

  // Precalculate free canvases and a canvas lookup map.
  this._prepareCanvasPool();

  // Render background overlays.
  for (var i = 0; i < this._backgrounds.length; i++) {
    var bg = this._backgrounds[i];

    var image = this.assets.getImage(bg.image);
    if (!image) continue;

    var width = image.naturalWidth * this.zoom,
        height = image.naturalHeight * this.zoom;

    var x = bg.min[0] * this._screenTileWidth - this.viewportX,
        y = bg.min[1] * this._screenTileHeight - this.viewportY;

    image.style.left = x + 'px';
    image.style.bottom = y + 'px';
    image.style.width = width + 'px';
    image.style.height = height + 'px';

    if (!image.parentNode) {
      image.style.position = 'absolute';
      image.style.zIndex = 0;
      this.viewport.appendChild(image);
    }
  }

  // Render regions and their objects.
  for (var regionY = this._fromRegionY; regionY < this._toRegionY; regionY++) {
    for (var regionX = this._fromRegionX; regionX < this._toRegionX; regionX++) {
      var region = this.getRegion(regionX, regionY);
      if (!region) continue;

      // Calculate the region's position in the viewport and render it.
      var offsetX = regionX * this.screenRegionWidth - this.viewportX,
          offsetY = regionY * this.screenRegionHeight - this.viewportY;
      region.render(this, offsetX, offsetY);
    }
  }
};

WorldRenderer.prototype.requestRender = function () {
  if (!this._loaded || this._requestingRender) return;
  this._requestingRender = true;

  var requestAnimationFrame = window.requestAnimationFrame || window.mozRequestAnimationFrame ||
                              window.webkitRequestAnimationFrame;

  requestAnimationFrame(() => {
    this.render();
    this._requestingRender = false;
  });
};

WorldRenderer.prototype.scroll = function (deltaX, deltaY, opt_screenPixels) {
  if (opt_screenPixels) {
    deltaX /= this._screenTileWidth;
    deltaY /= this._screenTileHeight;
  }

  this.centerX += deltaX;
  this.centerY += deltaY;

  if (this.centerX < 0) {
    this.centerX += this._tilesX;
  } else if (this.centerX >= this._tilesX) {
    this.centerX -= this._tilesX;
  }

  this._calculateRegions();
};

WorldRenderer.prototype.setWorld = function (world) {
  if (!world || !(world instanceof World)) {
    throw new Error('Invalid world');
  }

  this.unload();

  this.world = world;
  this._loadMetadata();
  this._calculateViewport();
};

WorldRenderer.prototype.setZoom = function (zoom) {
  if (zoom < MIN_ZOOM) zoom = MIN_ZOOM;
  if (zoom > MAX_ZOOM) zoom = MAX_ZOOM;
  if (zoom == this.zoom) return;

  this.zoom = zoom;
  this._calculateViewport();
};

WorldRenderer.prototype.unload = function () {
  if (!this._loaded) return;

  this.zoom = 1;
  this.centerX = 0;
  this.centerY = 0;

  this._tilesX = 0;
  this._tilesY = 0;
  this._regionsX = 0;
  this._regionsY = 0;

  for (var i = 0; i < this._canvasPool.length; i++) {
    var poolItem = this._canvasPool[i];
    poolItem.region = null;
    poolItem.canvas.style.visibility = 'hidden';
  }

  // Unload regions to remove cyclic references.
  for (var key in this._regions) {
    this._regions[key].unload();
  }
  this._regions = Object.create(null);

  for (var i = 0; i < this._backgrounds.length; i++) {
    var image = this.assets.getImage(this._backgrounds[i].image);
    if (image) {
      this.viewport.removeChild(image);
    }
  }
  this._backgrounds = [];

  this.world = null;

  this._loaded = false;
  this._setup = false;

  this.emit('unload');
};

WorldRenderer.prototype.zoomIn = function () {
  this.setZoom(this.zoom + this.zoom * .1);
};

WorldRenderer.prototype.zoomOut = function () {
  this.setZoom(this.zoom - this.zoom * .1);
};

WorldRenderer.prototype._calculateRegions = function () {
  if (!this._loaded) return;

  this._fromRegionX = Math.floor(this.centerX / TILES_X - this._bounds.width / 2 / this.screenRegionWidth) - 1;
  this._fromRegionY = Math.floor(this.centerY / TILES_Y - this._bounds.height / 2 / this.screenRegionHeight) - 2;
  this._toRegionX = this._fromRegionX + this._visibleRegionsX;
  this._toRegionY = this._fromRegionY + this._visibleRegionsY;

  this.viewportX = this.centerX * this._screenTileWidth - this._bounds.width / 2,
  this.viewportY = this.centerY * this._screenTileHeight - this._bounds.height / 2;

  this.requestRender();
};

WorldRenderer.prototype._calculateViewport = function () {
  if (!this._loaded) return;

  this._setup = true;

  this.screenRegionWidth = Math.round(REGION_WIDTH * this.zoom);
  this.screenRegionHeight = Math.round(REGION_HEIGHT * this.zoom);
  this._screenTileWidth = this.screenRegionWidth / TILES_X;
  this._screenTileHeight = this.screenRegionHeight / TILES_Y;

  this._bounds = this.viewport.getBoundingClientRect();
  this._visibleRegionsX = Math.ceil(this._bounds.width / this.screenRegionWidth + 3);
  this._visibleRegionsY = Math.ceil(this._bounds.height / this.screenRegionHeight + 3);

  this._calculateRegions();
};

WorldRenderer.prototype._loadMetadata = function () {
  var spawn, size;

  this.centerX = this.world.spawnX;
  this.centerY = this.world.spawnY;

  this._tilesX = this.world.tilesX;
  this._tilesY = this.world.tilesY;

  // TODO: Figure out why some world sizes aren't divisible by 32.
  this._regionsX = Math.ceil(this._tilesX / TILES_X);
  this._regionsY = Math.ceil(this._tilesY / TILES_Y);

  if (this.world.metadata.centralStructure) {
    this._backgrounds = this.world.metadata.centralStructure.backgroundOverlays;
  }

  // Calculate FNV hash bases for the variant algorithm.
  var view = new DataView(new ArrayBuffer(4));

  view.setUint32(0, this.world.seed + BACKGROUND_VARIANT_SEED);
  this._bgVariantHashBase = fnvHashView(FNV_OFFSET_BASIS, view);

  view.setUint32(0, this.world.seed + FOREGROUND_VARIANT_SEED);
  this._fgVariantHashBase = fnvHashView(FNV_OFFSET_BASIS, view);

  // Notify listeners that a world has been loaded.
  this._loaded = true;
  this.emit('load');
};

WorldRenderer.prototype._prepareCanvasPool = function () {
  var freePool = [], poolLookup = {};
  for (var i = 0; i < this._canvasPool.length; i++) {
    var poolItem = this._canvasPool[i],
        region = poolItem.region;

    if (region && this.isRegionVisible(region)) {
      poolLookup[region.x + ':' + region.y + ':' + poolItem.z] = poolItem;
    } else {
      poolItem.canvas.style.visibility = 'hidden';
      freePool.push(poolItem);
    }
  }

  this._freePool = freePool;
  this._poolLookup = poolLookup;
};
