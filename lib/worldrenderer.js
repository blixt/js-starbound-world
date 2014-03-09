var RegionRenderer = require('./regionrenderer');

module.exports = WorldRenderer;


var TILES_X = 32;
var TILES_Y = 32;
var TILES_PER_REGION = TILES_X * TILES_Y;

var HEADER_BYTES = 3;
var BYTES_PER_TILE = 23;
var BYTES_PER_ROW = BYTES_PER_TILE * TILES_X;
var BYTES_PER_REGION = HEADER_BYTES + BYTES_PER_TILE * TILES_PER_REGION;

var TILE_WIDTH = 8;
var TILE_HEIGHT = 8;

var REGION_WIDTH = TILE_WIDTH * TILES_X;
var REGION_HEIGHT = TILE_HEIGHT * TILES_Y;

var MIN_ZOOM = .1;
var MAX_ZOOM = 3;


function WorldRenderer(viewport, worldManager, assetsManager) {
  // Ensure that canvases can be anchored to the viewport.
  var position = getComputedStyle(viewport).getPropertyValue('position');
  if (position != 'absolute' && position != 'relative') {
    viewport.style.position = 'relative';
  }

  this.viewport = viewport;
  this.world = worldManager;
  this.assets = assetsManager;

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

  this._regions = {};

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

  // Set up information about the world when it's available.
  if (worldManager.metadata) {
    this._loadMetadata(worldManager.metadata);
  }

  worldManager.on('load', () => this._loadMetadata(worldManager.metadata));
}

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

WorldRenderer.prototype.setZoom = function (zoom) {
  if (zoom < MIN_ZOOM) zoom = MIN_ZOOM;
  if (zoom > MAX_ZOOM) zoom = MAX_ZOOM;
  if (zoom == this.zoom) return;

  this.zoom = zoom;
  this._calculateViewport();
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

WorldRenderer.prototype._loadMetadata = function (metadata) {
  var spawn, size;
  switch (metadata.__version__) {
    case 1:
      spawn = metadata.playerStart;
      size = metadata.planet.size;
      break;
    case 2:
    case 3:
      spawn = metadata.playerStart;
      size = metadata.worldTemplate.size;
      break;
    default:
      throw new Error('Unsupported metadata version ' + metadata.__version__);
  }

  this.centerX = spawn[0];
  this.centerY = spawn[1];

  this._tilesX = size[0];
  this._tilesY = size[1];

  // TODO: Figure out why some world sizes aren't divisible by 32.
  this._regionsX = Math.ceil(this._tilesX / TILES_X);
  this._regionsY = Math.ceil(this._tilesY / TILES_Y);

  this._loaded = true;
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
