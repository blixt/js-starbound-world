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

  context.fillStyle = 'rgba(0, 0, 0, .5)';

  var x = 0, y = 0, sx = 0, sy = REGION_HEIGHT - TILE_HEIGHT;
  for (var offset = HEADER_BYTES; offset < BYTES_PER_REGION; offset += BYTES_PER_TILE) {
    // TODO: Figure out the real variant algorithm.
    var variant = Math.round(Math.random() * 255);

    neighbors = this._getTileNeighbors(offset, x, y);

    foregroundId = view.getInt16(offset);
    foreground = materials.index[foregroundId];

    // Only render the background if the foreground doesn't cover it.
    if (!foreground || foreground.transparent) {
      if (!this._renderTile(context, sx, sy, materials, matmods, view, offset, 7, variant, neighbors)) {
        this.dirty = true;
      }
      context.fillRect(sx, sy, 8, 8);
    }

    // Render the foreground tile and/or edges.
    context.globalAlpha = 1;
    if (!this._renderTile(context, sx, sy, materials, matmods, view, offset, 0, variant, neighbors)) {
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
    above && above.tileView, aboveOffset,
    right && right.tileView, rightOffset,
    below && below.tileView, belowOffset,
    left && left.tileView, leftOffset
  ];
};

RegionRenderer.prototype._renderTile = function (context, x, y, materials, matmods, view, offset, delta, variant, neighbors) {
  var mcenter = view.getInt16(offset + delta),
      mtop = neighbors[0] && neighbors[0].getInt16(neighbors[1] + delta),
      mright = neighbors[2] && neighbors[2].getInt16(neighbors[3] + delta),
      mbottom = neighbors[4] && neighbors[4].getInt16(neighbors[5] + delta),
      mleft = neighbors[6] && neighbors[6].getInt16(neighbors[7] + delta),
      icenter, itop, iright, ibottom, ileft,
      ocenter, otop, oright, obottom, oleft,
      vcenter, vtop, vright, vbottom, vleft;

  var dtop = mtop > 0,
      dright = mright > 0,
      dbottom = mbottom > 0,
      dleft = mleft > 0;

  if (mcenter > 0) {
    ocenter = materials.index[mcenter];
    icenter = materials.getImage(ocenter, 'frames', view.getUint8(offset + delta + 2));
    if (!icenter) return false;
    vcenter = variant % ocenter.variants * 16;

    context.drawImage(icenter, vcenter + 4, 12, 8, 8, x, y, 8, 8);

    dtop = dtop && mcenter > mtop;
    dright = dright && mcenter > mright;
    dbottom = dbottom && mcenter > mbottom;
    dleft = dleft && mcenter > mleft;
  }

  if (dright) {
    oright = materials.index[mright],
    iright = materials.getImage(oright, 'frames', neighbors[2].getUint8(neighbors[3] + delta + 2));
    if (!iright) return false;
    vright = variant % oright.variants * 16;
  }

  if (dleft) {
    oleft = materials.index[mleft];
    ileft = materials.getImage(oleft, 'frames', neighbors[6].getUint8(neighbors[7] + delta + 2));
    if (!ileft) return false;
    vleft = variant % oleft.variants * 16;
  }

  if (dtop) {
    otop = materials.index[mtop];
    itop = materials.getImage(otop, 'frames', neighbors[0].getUint8(neighbors[1] + delta + 2));
    if (!itop) return false;
    vtop = variant % otop.variants * 16;

    if (mtop == mleft) {
      context.drawImage(itop, vtop, 0, 4, 4, x, y, 4, 4);
    } else if (mtop < mleft) {
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
    if (mtop == mright) {
      context.drawImage(itop, vtop + 4, 0, 4, 4, x, y, 4, 4);
    } else if (mtop < mright) {
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
    obottom = materials.index[mbottom];
    ibottom = materials.getImage(obottom, 'frames', neighbors[4].getUint8(neighbors[5] + delta + 2));
    if (!ibottom) return false;
    vbottom = variant % obottom.variants * 16;

    if (mbottom == mright) {
      context.drawImage(ibottom, vbottom + 4, 4, 4, 4, x, y, 4, 4);
    } else if (mbottom < mright) {
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
    if (mbottom == mleft) {
      context.drawImage(ibottom, vbottom, 4, 4, 4, x, y, 4, 4);
    } else if (mbottom < mleft) {
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

  // TODO: Figure out how matmods work.
  // Render the matmod for this tile.
  var modId = view.getInt16(offset + delta + 4);
  var mod = matmods.index[modId];
  var modImage = matmods.getImage(mod, 'frames', view.getUint8(offset + delta + 6));
  if (modImage) {
    context.drawImage(modImage, 4 + variant % mod.variants * 16, 12, 8, 8, x, y - 4, 8, 8);
  } else if (mod) {
    return false;
  }

  // Render the matmod of the tile below this one (if it overflows).
  if (!ocenter && neighbors[4]) {
    modId = neighbors[4].getInt16(neighbors[5] + delta + 4);
    mod = matmods.index[modId];
    modImage = matmods.getImage(mod, 'frames', neighbors[4].getUint8(neighbors[5] + delta + 6));
    if (modImage) {
      context.drawImage(modImage, 4 + variant % mod.variants * 16, 8, 8, 4, x, y, 8, 4);
    } else if (mod) {
      return false;
    }
  }

  return true;
};
