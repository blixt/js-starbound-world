module.exports = RegionRenderer;


var TILES_X = 32;
var TILES_Y = 32;
var TILES_PER_REGION = TILES_X * TILES_Y;

var HEADER_BYTES = 3;
var BYTES_PER_TILE = 23;
var BYTES_PER_ROW = BYTES_PER_TILE * TILES_X;
var BYTES_PER_REGION = BYTES_PER_TILE * TILES_PER_REGION;

var TILE_WIDTH = 8;
var TILE_HEIGHT = 8;

var REGION_WIDTH = TILE_WIDTH * TILES_X;
var REGION_HEIGHT = TILE_HEIGHT * TILES_Y;


function RegionRenderer(x, y) {
  this.x = x;
  this.y = y;

  this.entities = null;
  this.tileView = null;

  this.neighbors = null;
  this.state = RegionRenderer.STATE_UNINITIALIZED;

  // Whether this region needs to be rerendered.
  this.dirty = false;
}

RegionRenderer.STATE_ERROR = -1;
RegionRenderer.STATE_UNITIALIZED = 0;
RegionRenderer.STATE_LOADING = 1;
RegionRenderer.STATE_READY = 2;

/**
 * Returns material ids and material mod ids used within the region.
 */
RegionRenderer.prototype.getResourceIds = function () {
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

// TODO: Implement support for rendering only a part of the region.
RegionRenderer.prototype.render = function (renderer, canvas) {
  if (this.state != RegionRenderer.STATE_READY) return;

  // Get lookup tables for resources.
  var materials = renderer.materials,
      matmods = renderer.matmods;

  // Don't allow rendering until resources are indexed.
  if (!materials.index || !matmods.index) {
    return;
  }

  // Prepare the rendering step.
  var context = canvas.getContext('2d');
  context.fillStyle = '#000';
  context.fillRect(0, 0, canvas.width, canvas.height);

  // Reset dirty flag now so that the code below can set it to true if needed.
  this.dirty = false;

  var view = this.tileView,
      backgroundId, foregroundId, foreground,
      neighbors;

  var x = 0, y = 0, sx = 0, sy = REGION_HEIGHT - TILE_HEIGHT;
  for (var offset = HEADER_BYTES; offset < BYTES_PER_REGION; offset += BYTES_PER_TILE) {
    // TODO: Figure out the real variant algorithm.
    var variant = Math.round(Math.random() * 255);

    foregroundId = view.getInt16(offset);
    foreground = materials.index[foregroundId];

    // Only render the background if the foreground doesn't cover it.
    if (!foreground || foreground.transparent) {
      backgroundId = view.getInt16(offset + 7);

      // TODO: The right way to do this is to darken the pixel values.
      neighbors = this._getTileNeighbors(offset + 7, x, y);
      context.globalAlpha = .5;
      if (!this._renderTile(context, sx, sy, materials, backgroundId, variant, neighbors)) {
        this.dirty = true;
      }
    }

    // Render the foreground tile and/or edges.
    neighbors = this._getTileNeighbors(offset, x, y);
    context.globalAlpha = 1;
    if (!this._renderTile(context, sx, sy, materials, foregroundId, variant, neighbors)) {
      this.dirty = true;
    }

    // Calculate the next set of X, Y coordinates.
    if (++x == 32) {
      x = 0; y++;
      sx = 0; sy -= TILE_HEIGHT;
    } else {
      sx += TILE_WIDTH;
    }
  }
};

RegionRenderer.prototype._getTileNeighbors = function (offset, x, y) {
  var above = this, aboveOffset = offset + BYTES_PER_ROW,
      right = this, rightOffset = offset + BYTES_PER_TILE,
      below = this, belowOffset = offset - BYTES_PER_ROW,
      left = this, leftOffset = offset - BYTES_PER_TILE;

  if (aboveOffset > BYTES_PER_REGION) {
    above = this.neighbors[0];
    aboveOffset -= BYTES_PER_REGION;
  }

  if (x == TILES_X - 1) {
    right = this.neighbors[1];
    rightOffset -= BYTES_PER_ROW;
  }

  if (belowOffset < HEADER_BYTES) {
    below = this.neighbors[2];
    belowOffset += BYTES_PER_REGION;
  }

  if (!x) {
    left = this.neighbors[3];
    leftOffset += BYTES_PER_ROW;
  }

  return [
    above && above.tileView && above.tileView.getInt16(aboveOffset),
    right && right.tileView && right.tileView.getInt16(rightOffset),
    below && below.tileView && below.tileView.getInt16(belowOffset),
    left && left.tileView && left.tileView.getInt16(leftOffset)
  ];
};

RegionRenderer.prototype._renderTile = function (context, x, y, materials, material, variant, neighbors) {
  var dtop = neighbors[0] > 0,
      dright = neighbors[1] > 0,
      dbottom = neighbors[2] > 0,
      dleft = neighbors[3] > 0;

  var icenter, itop, iright, ibottom, ileft,
      ocenter, otop, oright, obottom, oleft,
      vcenter, vtop, vright, vbottom, vleft;

  if (material > 0) {
    ocenter = materials.index[material];
    icenter = materials.getImage(ocenter, 'frames');
    if (!icenter) return false;
    vcenter = variant % ocenter.variants * 16;

    context.drawImage(icenter, vcenter + 4, 12, 8, 8, x, y, 8, 8);

    dtop = dtop && material > neighbors[0];
    dright = dright && material > neighbors[1];
    dbottom = dbottom && material > neighbors[2];
    dleft = dleft && material > neighbors[3];
  }

  if (dright) {
    oright = materials.index[neighbors[1]],
    iright = materials.getImage(oright, 'frames');
    if (!iright) return false;
    vright = variant % oright.variants * 16;
  }

  if (dleft) {
    oleft = materials.index[neighbors[3]];
    ileft = materials.getImage(oleft, 'frames');
    if (!ileft) return false;
    vleft = variant % oleft.variants * 16;
  }

  if (dtop) {
    otop = materials.index[neighbors[0]];
    itop = materials.getImage(otop, 'frames');
    if (!itop) return false;
    vtop = variant % otop.variants * 16;

    if (neighbors[0] == neighbors[3]) {
      context.drawImage(itop, vtop, 0, 4, 4, x, y, 4, 4);
    } else if (neighbors[0] < neighbors[3]) {
      if (dleft)
        context.drawImage(ileft, vleft + 12, 12, 4, 4, x, y, 4, 4);
      context.drawImage(itop, vtop + 4, 20, 4, 4, x, y, 4, 4);
    } else {
      context.drawImage(itop, vtop + 4, 20, 4, 4, x, y, 4, 4);
      if (dleft)
        context.drawImage(ileft, vleft + 12, 12, 4, 4, x, y, 4, 4);
    }
  } else if (dleft) {
    context.drawImage(ileft, vleft + 12, 12, 4, 4, x, y, 4, 4);
  }

  x += 4;

  if (dtop) {
    if (neighbors[0] == neighbors[1]) {
      context.drawImage(itop, vtop + 4, 0, 4, 4, x, y, 4, 4);
    } else if (neighbors[0] < neighbors[1]) {
      if (dright)
        context.drawImage(iright, vright, 12, 4, 4, x, y, 4, 4);
      context.drawImage(itop, vtop + 8, 20, 4, 4, x, y, 4, 4);
    } else {
      context.drawImage(itop, vtop + 8, 20, 4, 4, x, y, 4, 4);
      if (dright)
        context.drawImage(iright, vright, 12, 4, 4, x, y, 4, 4);
    }
  } else if (dright) {
    context.drawImage(iright, vright, 12, 4, 4, x, y, 4, 4);
  }

  y += 4;

  if (dbottom) {
    obottom = materials.index[neighbors[2]];
    ibottom = materials.getImage(obottom, 'frames');
    if (!ibottom) return false;
    vbottom = variant % obottom.variants * 16;

    if (neighbors[2] == neighbors[1]) {
      context.drawImage(ibottom, vbottom + 4, 4, 4, 4, x, y, 4, 4);
    } else if (neighbors[2] < neighbors[1]) {
      if (dright)
        context.drawImage(iright, vright, 16, 4, 4, x, y, 4, 4);
      context.drawImage(ibottom, vbottom + 8, 8, 4, 4, x, y, 4, 4);
    } else {
      context.drawImage(ibottom, vbottom + 8, 8, 4, 4, x, y, 4, 4);
      if (dright)
        context.drawImage(iright, vright, 16, 4, 4, x, y, 4, 4);
    }
  } else if (dright) {
    context.drawImage(iright, vright, 16, 4, 4, x, y, 4, 4);
  }

  x -= 4;

  if (dbottom) {
    if (neighbors[2] == neighbors[3]) {
      context.drawImage(ibottom, vbottom, 4, 4, 4, x, y, 4, 4);
    } else if (neighbors[2] < neighbors[3]) {
      if (dleft)
        context.drawImage(ileft, vleft + 12, 16, 4, 4, x, y, 4, 4);
      context.drawImage(ibottom, vbottom + 4, 8, 4, 4, x, y, 4, 4);
    } else {
      context.drawImage(ibottom, vbottom + 4, 8, 4, 4, x, y, 4, 4);
      if (dleft)
        context.drawImage(ileft, vleft + 12, 16, 4, 4, x, y, 4, 4);
    }
  } else if (dleft) {
    context.drawImage(ileft, vleft + 12, 16, 4, 4, x, y, 4, 4);
  }

  return true;
};
