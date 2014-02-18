module.exports = RegionRenderer;


function RegionRenderer(x, y) {
  this.x = x;
  this.y = y;

  this.data = null;
  this.neighbors = null;

  this.state = RegionRenderer.STATE_UNINITIALIZED;

  // This flag will be true if this region successfully rendered completely.
  this.complete = false;
}

RegionRenderer.STATE_ERROR = -1;
RegionRenderer.STATE_UNITIALIZED = 0;
RegionRenderer.STATE_LOADING = 1;
RegionRenderer.STATE_READY = 2;

// TODO: Implement support for rendering only a part of the region.
RegionRenderer.prototype.render = function (renderer, canvas) {
  if (this.state != RegionRenderer.STATE_READY) return;

  var complete = true;

  var context = canvas.getContext('2d');
  context.fillStyle = '#000';
  context.fillRect(0, 0, canvas.width, canvas.height);

  // TODO: Optimize to use buffer directly, and reuse neighbors.
  for (var y = 0; y < 32; y++) {
    for (var x = 0; x < 32; x++) {
      var tile = this.data.getTile(x, y);

      // TODO: Figure out the real variant algorithm.
      var variant = Math.round(Math.random() * 255);

      // TODO: The right way to do this is to darken the pixel values.
      // TODO: The background doesn't need to be rendered if the foreground
      //       tile is opaque (see "transparent" property).
      context.globalAlpha = .5;
      complete = complete && this._renderTile(renderer, context, tile[5], x * 8, y * 8, variant, this.data.getNeighbors(x, y, true));
      context.globalAlpha = 1;
      complete = complete && this._renderTile(renderer, context, tile[0], x * 8, y * 8, variant, this.data.getNeighbors(x, y));
    }
  }

  this.complete = complete;
};

RegionRenderer.prototype._renderTile = function (renderer, context, material, x, y, variant, neighbors) {
  var dtop = neighbors[0] > 0 && neighbors[0] != 39,
      dright = neighbors[1] > 0 && neighbors[1] != 39,
      dbottom = neighbors[2] > 0 && neighbors[2] != 39,
      dleft = neighbors[3] > 0 && neighbors[3] != 39;

  if (material > 0 && material != 39) {
    var ocenter = renderer.materials.get(material),
        icenter = renderer.materials.getImage(ocenter, 'frames');
    if (!icenter) return false;

    context.drawImage(icenter, variant % ocenter.variants * 16 + 4, 12, 8, 8, x, y, 8, 8);

    dtop = dtop && material > neighbors[0];
    dright = dright && material > neighbors[1];
    dbottom = dbottom && material > neighbors[2];
    dleft = dleft && material > neighbors[3];
  }

  var itop, iright, ibottom, ileft,
      otop, oright, obottom, oleft,
      vtop, vright, vbottom, vleft;

  if (dright) {
    oright = renderer.materials.get(neighbors[1]);
    iright = renderer.materials.getImage(oright, 'frames');
    if (!iright) return false;
    vright = variant % oright.variants * 16;
  }

  if (dleft) {
    oleft = renderer.materials.get(neighbors[3]);
    ileft = renderer.materials.getImage(oleft, 'frames');
    if (!ileft) return false;
    vleft = variant % oleft.variants * 16;
  }

  if (dtop) {
    otop = renderer.materials.get(neighbors[0]);
    itop = renderer.materials.getImage(otop, 'frames');
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
    obottom = renderer.materials.get(neighbors[2]);
    ibottom = renderer.materials.getImage(obottom, 'frames');
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
