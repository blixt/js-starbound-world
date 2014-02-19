module.exports = RegionRenderer;

var TILES_X = 32;
var TILES_Y = 32;
var TILES_PER_REGION = TILES_X * TILES_Y;

var HEADER_BYTES = 3;
var BYTES_PER_TILE = 23;
var BYTES_PER_ROW = BYTES_PER_TILE * TILES_X;
var BYTES_PER_REGION = BYTES_PER_TILE * TILES_PER_REGION;


function RegionRenderer(x, y) {
  this.x = x;
  this.y = y;

  this.data = null;
  this.neighbors = null;

  this.state = RegionRenderer.STATE_UNINITIALIZED;

  // Whether this region needs to be rerendered.
  this.dirty = false;
}

RegionRenderer.STATE_ERROR = -1;
RegionRenderer.STATE_UNITIALIZED = 0;
RegionRenderer.STATE_LOADING = 1;
RegionRenderer.STATE_READY = 2;

// TODO: Implement support for rendering only a part of the region.
RegionRenderer.prototype.render = function (renderer, canvas) {
  if (this.state != RegionRenderer.STATE_READY) return;

  // Reset dirty flag now so that the code below can set it to true if needed.
  this.dirty = false;

  var context = canvas.getContext('2d');
  context.fillStyle = '#000';
  context.fillRect(0, 0, canvas.width, canvas.height);

  // TODO: Optimize to use buffer directly, and reuse neighbors.
  for (var y = 0; y < 32; y++) {
    for (var x = 0; x < 32; x++) {
      var tile = this.data.getTile(x, y);

      // TODO: Figure out the real variant algorithm.
      var variant = Math.round(Math.random() * 255);

      var fg = tile[0] > 0 && renderer.materials.get(tile[0]);

      // Only render the background if the foreground doesn't cover it.
      if (!fg || fg.transparent) {
        var bg = tile[5] > 0 && renderer.materials.get(tile[5]);

        // TODO: The right way to do this is to darken the pixel values.
        context.globalAlpha = .5;
        this._renderTile(renderer, context, bg, x * 8, y * 8, variant, this._getTileNeighbors(x, y, true));
      }

      context.globalAlpha = 1;
      this._renderTile(renderer, context, fg, x * 8, y * 8, variant, this._getTileNeighbors(x, y));
    }
  }
};

RegionRenderer.prototype._getTileNeighbors = function (x, y, opt_background) {
  var center = this.data.getTileOffset(x, y) + (opt_background ? 7 : 0),
      above, aboveOffset,
      right, rightOffset,
      below, belowOffset,
      left, leftOffset;

  if (y) {
    above = this;
    aboveOffset = center + BYTES_PER_ROW;
  } else {
    above = this.neighbors[0];
    aboveOffset = center - BYTES_PER_REGION + BYTES_PER_ROW;
  }

  if (x < TILES_X - 1) {
    right = this;
    rightOffset = center + BYTES_PER_TILE;
  } else {
    right = this.neighbors[1];
    rightOffset = center - BYTES_PER_ROW + BYTES_PER_TILE;
  }

  if (y < TILES_Y - 1) {
    below = this;
    belowOffset = center - BYTES_PER_ROW;
  } else {
    below = this.neighbors[2];
    belowOffset = center + BYTES_PER_REGION - BYTES_PER_ROW;
  }

  if (x) {
    left = this;
    leftOffset = center - BYTES_PER_TILE;
  } else {
    left = this.neighbors[3];
    leftOffset = center + BYTES_PER_ROW - BYTES_PER_TILE;
  }

  return [
    above && above.data && above.data.tileView.getInt16(aboveOffset),
    right && right.data && right.data.tileView.getInt16(rightOffset),
    below && below.data && below.data.tileView.getInt16(belowOffset),
    left && left.data && left.data.tileView.getInt16(leftOffset)
  ];
};

RegionRenderer.prototype._renderTile = function (renderer, context, material, x, y, variant, neighbors) {
  var dtop = neighbors[0] > 0 && neighbors[0] != 39,
      dright = neighbors[1] > 0 && neighbors[1] != 39,
      dbottom = neighbors[2] > 0 && neighbors[2] != 39,
      dleft = neighbors[3] > 0 && neighbors[3] != 39;

  if (material) {
    var icenter = renderer.materials.getImage(material, 'frames');
    if (!icenter) {
      this.dirty = true;
      return false;
    }

    context.drawImage(icenter, variant % material.variants * 16 + 4, 12, 8, 8, x, y, 8, 8);

    dtop = dtop && material.materialId > neighbors[0];
    dright = dright && material.materialId > neighbors[1];
    dbottom = dbottom && material.materialId > neighbors[2];
    dleft = dleft && material.materialId > neighbors[3];
  }

  var itop, iright, ibottom, ileft,
      otop, oright, obottom, oleft,
      vtop, vright, vbottom, vleft;

  if (dright) {
    oright = renderer.materials.get(neighbors[1]);
    iright = renderer.materials.getImage(oright, 'frames');
    if (!iright) {
      this.dirty = true;
      return false;
    }
    vright = variant % oright.variants * 16;
  }

  if (dleft) {
    oleft = renderer.materials.get(neighbors[3]);
    ileft = renderer.materials.getImage(oleft, 'frames');
    if (!ileft) {
      this.dirty = true;
      return false;
    }
    vleft = variant % oleft.variants * 16;
  }

  if (dtop) {
    otop = renderer.materials.get(neighbors[0]);
    itop = renderer.materials.getImage(otop, 'frames');
    if (!itop) {
      this.dirty = true;
      return false;
    }
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
    obottom = renderer.materials.get(neighbors[2]);
    ibottom = renderer.materials.getImage(obottom, 'frames');
    if (!ibottom) {
      this.dirty = true;
      return false;
    }
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
