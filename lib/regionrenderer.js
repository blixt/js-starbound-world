module.exports = RegionRenderer;


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


function getInt16(region, offset) {
  if (region && region.view) return region.view.getInt16(offset);
}

function getOrientation(orientations, index) {
  var curIndex = 0, image, direction;

  // This is a tremendous amount of logic for deciding which image to use...
  for (var i = 0; i < orientations.length; i++) {
    var o = orientations[i];
    if (curIndex == index) {
      if (o.imageLayers) {
        // TODO: Support multiple layers.
        image = o.imageLayers[0].image;
      } else {
        image = o.image || o.leftImage || o.dualImage;
      }
      direction = o.direction || 'left';
      if (!image) throw new Error('Could not get image for orientation');
      break;
    }

    curIndex++;

    if (o.dualImage || o.rightImage) {
      if (curIndex == index) {
        image = o.rightImage || o.dualImage;
        direction = 'right';
        break;
      }

      curIndex++;
    }
  }

  if (!image) {
    throw new Error('Could not get orientation');
  }

  return {
    image: image,
    direction: direction,
    flip: o.flipImages || !!(o.dualImage && direction == 'left'),
    info: o
  };
}

function getUint8(region, offset) {
  if (region && region.view) return region.view.getUint8(offset);
}


function RegionRenderer(x, y) {
  this.x = x;
  this.y = y;

  this.entities = null;
  this.view = null;

  this.neighbors = null;
  this.state = RegionRenderer.STATE_UNINITIALIZED;

  // Whether a layer needs to be rerendered.
  this.dirty = {background: false, foreground: false, sprites: false};

  this._spritesMinX = 0;
  this._spritesMinY = 0;
}

RegionRenderer.STATE_ERROR = -1;
RegionRenderer.STATE_UNITIALIZED = 0;
RegionRenderer.STATE_LOADING = 1;
RegionRenderer.STATE_READY = 2;

// TODO: Implement support for rendering only a part of the region.
RegionRenderer.prototype.render = function (renderer, offsetX, offsetY) {
  if (this.state != RegionRenderer.STATE_READY) return;

  this._renderEntities(renderer, offsetX, offsetY);
  this._renderTiles(renderer, offsetX, offsetY);
};

RegionRenderer.prototype.setDirty = function () {
  this.dirty.background = true;
  this.dirty.foreground = true;
  this.dirty.sprites = true;
};

RegionRenderer.prototype._renderEntities = function (renderer, offsetX, offsetY) {
  var canvas = renderer.getCanvas(this, 2);
  if (!this.dirty.sprites) {
    canvas.style.left = (offsetX + this._spritesMinX * renderer.zoom) + 'px';
    canvas.style.top = (offsetY + this._spritesMinY * renderer.zoom) + 'px';
    canvas.style.visibility = 'visible';
  }

  this.dirty.sprites = false;

  var minX = 0, maxX = 0, minY = 0, maxY = 0,
      originX = this.x * TILES_X, originY = this.y * TILES_Y,
      allSprites = [];

  for (var i = 0; i < this.entities.length; i++) {
    var entity = this.entities[i],
        sprites = null;

    switch (entity.__name__ + entity.__version__) {
      case 'ItemDropEntity1':
        sprites = this._renderItem(renderer, entity);
        break;
      case 'MonsterEntity1':
        sprites = this._renderMonster(renderer, entity);
        break;
      case 'NpcEntity1':
        // TODO: Convert to version 2 before rendering.
        break;
      case 'NpcEntity2':
        sprites = this._renderNPC(renderer, entity);
        break;
      case 'ObjectEntity1':
        // TODO: Potential conversion code.
      case 'ObjectEntity2':
        sprites = this._renderObject(renderer, entity);
        break;
      case 'PlantEntity1':
        sprites = this._renderPlant(renderer, entity);
        break;
      default:
        console.warn('Unsupported entity/version:', entity);
    }

    if (sprites) {
      for (var j = 0; j < sprites.length; j++) {
        var sprite = sprites[j];
        if (!sprite || !sprite.image) {
          this.dirty.sprites = true;
          continue;
        }

        if (!sprite.sx) sprite.sx = 0;
        if (!sprite.sy) sprite.sy = 0;
        if (!sprite.width) sprite.width = sprite.image.width;
        if (!sprite.height) sprite.height = sprite.image.height;

        sprite.canvasX = (sprite.x - originX) * TILE_WIDTH;
        sprite.canvasY = REGION_HEIGHT - (sprite.y - originY) * TILE_HEIGHT - sprite.height;

        minX = Math.min(sprite.canvasX, minX);
        maxX = Math.max(sprite.canvasX + sprite.width, maxX);
        minY = Math.min(sprite.canvasY, minY);
        maxY = Math.max(sprite.canvasY + sprite.height, maxY);

        allSprites.push(sprite);
      }
    } else {
      this.dirty.sprites = true;
    }
  }

  // This will resize the canvas if necessary.
  canvas = renderer.getCanvas(this, 2, maxX - minX, maxY - minY);
  this._spritesMinX = minX;
  this._spritesMinY = minY;

  if (allSprites.length) {
    canvas.style.left = (offsetX + minX * renderer.zoom) + 'px';
    canvas.style.top = (offsetY + minY * renderer.zoom) + 'px';
    canvas.style.visibility = 'visible';

    var context = canvas.getContext('2d');

    for (var i = 0; i < allSprites.length; i++) {
      var sprite = allSprites[i];
      context.drawImage(sprite.image, sprite.sx, sprite.sy, sprite.width, sprite.height,
                        -minX + sprite.canvasX, -minY + sprite.canvasY, sprite.width, sprite.height);
    }
  } else {
    canvas.style.visibility = 'hidden';
  }
};

RegionRenderer.prototype._renderItem = function (renderer, entity) {
  // TODO: Not sure what to do about items.
};

RegionRenderer.prototype._renderMonster = function (renderer, entity) {
  // TODO: Not sure what to do about monsters.
};

RegionRenderer.prototype._renderNPC = function (renderer, entity) {
  // TODO: Not sure what to do about NPCs.
};

RegionRenderer.prototype._renderObject = function (renderer, entity) {
  var objects = renderer.objects.index;
  if (!objects) return;

  var assets = renderer.assets;
  var def = objects[entity.name];
  if (!def) throw new Error('Object not in index: ' + entity.name);

  if (def.animation) {
    var animationPath = assets.getResourcePath(def, def.animation);
    // TODO: assets.getAnimation(animationPath);
  }

  var orientation = getOrientation(def.orientations, entity.orientationIndex);

  var pathAndFrame = orientation.image.split(':');
  var imagePath = assets.getResourcePath(def, pathAndFrame[0]);
  var frames = assets.getFrames(imagePath);

  // Flip all the frames horizontally if the sprite is using a dual image.
  if (orientation.flip) {
    if (!frames) return;
    imagePath += '?flipgridx=' + frames.frameGrid.size[0];
  }

  var image = assets.getImage(imagePath);
  if (!frames || !image) return;

  // TODO: Get the correct frame in the frame grid.

  var sprite = {
    image: image,
    x: entity.tilePosition[0] + orientation.info.imagePosition[0] / TILE_WIDTH,
    y: entity.tilePosition[1] + orientation.info.imagePosition[1] / TILE_HEIGHT,
    sx: 0,
    sy: 0,
    width: frames.frameGrid.size[0],
    height: frames.frameGrid.size[1]
  };

  return [sprite];
};

RegionRenderer.prototype._renderPlant = function (renderer, entity) {
  var assets = renderer.assets,
      position = entity.tilePosition,
      x = position[0],
      y = position[1];

  return entity.pieces.map(function (piece) {
    return {
      image: assets.getImage(piece.image),
      x: x + piece.offset[0],
      y: y + piece.offset[1]
    };
  });
};

RegionRenderer.prototype._renderTiles = function (renderer, offsetX, offsetY) {
  var bg = renderer.getCanvas(this, 1, REGION_WIDTH, REGION_HEIGHT);
  bg.style.left = offsetX + 'px';
  bg.style.top = offsetY + 'px';
  bg.style.visibility = 'visible';

  var fg = renderer.getCanvas(this, 4, REGION_WIDTH, REGION_HEIGHT);
  fg.style.left = offsetX + 'px';
  fg.style.top = offsetY + 'px';
  fg.style.visibility = 'visible';

  if (!this.dirty.background && !this.dirty.foreground) return;

  var assets = renderer.assets,
      materials = renderer.materials.index,
      matmods = renderer.matmods.index;

  // Don't allow rendering until resources are indexed.
  if (!materials || !matmods) {
    this.dirty.background = true;
    this.dirty.foreground = true;
    return;
  }

  // Store flags for choosing whether to render background/foreground tiles.
  var drawBackground = this.dirty.background || this.dirty.foreground,
      drawForeground = this.dirty.foreground;

  // Prepare the rendering step.
  var bgContext = bg.getContext('2d'), fgContext = fg.getContext('2d');
  if (drawBackground) bgContext.clearRect(0, 0, bg.width, bg.height);
  if (drawForeground) fgContext.clearRect(0, 0, fg.width, fg.height);

  // Reset dirty flags now so that the code below can reset them if needed.
  this.dirty.background = false;
  this.dirty.foreground = false;

  var view = this.view,
      backgroundId, foregroundId, foreground;

  // Used to darken background tiles.
  bgContext.fillStyle = 'rgba(0, 0, 0, .5)';

  var neighbors = [
    this, HEADER_BYTES + BYTES_PER_ROW,
    this, HEADER_BYTES + BYTES_PER_ROW + BYTES_PER_TILE,
    null, null,
    this.neighbors[4], BYTES_PER_REGION - BYTES_PER_ROW + BYTES_PER_TILE,
    this.neighbors[4], BYTES_PER_REGION - BYTES_PER_ROW,
    this.neighbors[5], BYTES_PER_REGION - BYTES_PER_TILE,
    null, null,
    this.neighbors[6], HEADER_BYTES + BYTES_PER_ROW + BYTES_PER_ROW - BYTES_PER_TILE
  ];

  var x = 0, y = 0, sx = 0, sy = REGION_HEIGHT - TILE_HEIGHT;
  for (var offset = HEADER_BYTES; offset < BYTES_PER_REGION; offset += BYTES_PER_TILE) {
    if (x == 0) {
      neighbors[4] = this;
      neighbors[5] = offset + BYTES_PER_TILE;

      if (y == 1) {
        neighbors[8] = this;
        neighbors[9] = HEADER_BYTES;
      }

      neighbors[12] = this.neighbors[6];
      neighbors[13] = offset - BYTES_PER_TILE + BYTES_PER_ROW;

      if (y == TILES_Y - 1) {
        neighbors[0] = this.neighbors[0];
        neighbors[1] = HEADER_BYTES;
        neighbors[2] = this.neighbors[0];
        neighbors[3] = HEADER_BYTES + BYTES_PER_TILE;
        neighbors[14] = this.neighbors[7];
        neighbors[15] = HEADER_BYTES + BYTES_PER_ROW - BYTES_PER_TILE;
      } else if (y > 0) {
        neighbors[6] = this;
        neighbors[7] = offset - BYTES_PER_ROW + BYTES_PER_TILE;
        neighbors[10] = this.neighbors[6];
        neighbors[11] = offset - BYTES_PER_TILE;
        neighbors[14] = this.neighbors[6];
        neighbors[15] = offset - BYTES_PER_TILE + BYTES_PER_ROW + BYTES_PER_ROW;
      }
    } else if (x == 1) {
      if (y == 0) {
        neighbors[10] = this.neighbors[4];
        neighbors[11] = BYTES_PER_REGION - BYTES_PER_ROW;
      } else {
        neighbors[10] = this;
        neighbors[11] = offset - BYTES_PER_ROW - BYTES_PER_TILE;
      }

      neighbors[12] = this;
      neighbors[13] = offset - BYTES_PER_TILE;

      if (y == TILES_Y - 1) {
        neighbors[14] = this.neighbors[0];
        neighbors[15] = HEADER_BYTES;
      } else {
        neighbors[14] = this;
        neighbors[15] = offset + BYTES_PER_ROW - BYTES_PER_TILE;
      }
    } else if (x == TILES_X - 1) {
      if (y == TILES_Y - 1) {
        neighbors[2] = this.neighbors[1];
        neighbors[3] = HEADER_BYTES;
      } else {
        neighbors[2] = this.neighbors[2];
        neighbors[3] = offset + BYTES_PER_TILE;
      }

      neighbors[4] = this.neighbors[2];
      neighbors[5] = offset - BYTES_PER_ROW + BYTES_PER_TILE;

      if (y == 0) {
        neighbors[6] = this.neighbors[3];
        neighbors[7] = BYTES_PER_REGION - BYTES_PER_ROW;
      } else {
        neighbors[6] = this.neighbors[2];
        neighbors[7] = offset - BYTES_PER_TILE;
      }
    }

    // TODO: Figure out the real variant algorithm.
    var variant = Math.round(Math.random() * 255);

    foregroundId = view.getInt16(offset);
    foreground = materials[foregroundId];

    // Only render the background if the foreground doesn't cover it.
    if (drawBackground && (!foreground || foreground.transparent)) {
      if (!this._renderTile(bgContext, sx, sy, assets, materials, matmods, view, offset, 7, variant, neighbors)) {
        this.dirty.background = true;
      }

      // Darken background tiles.
      bgContext.globalCompositeOperation = 'source-atop';
      bgContext.fillRect(sx, sy, 8, 8);
      bgContext.globalCompositeOperation = 'source-over';
    }

    // Render the foreground tile and/or edges.
    if (drawForeground) {
      if (!this._renderTile(fgContext, sx, sy, assets, materials, matmods, view, offset, 0, variant, neighbors)) {
        this.dirty.foreground = true;
      }
    }

    // TODO: Only increment the offsets that actually need it.
    for (var i = 1; i < 16; i += 2) {
      neighbors[i] += BYTES_PER_TILE;
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

RegionRenderer.prototype._renderTile = function (context, x, y, assets, materials, matmods, view, offset, delta, variant, neighbors) {
  var mcenter = view.getInt16(offset + delta),
      mtop = getInt16(neighbors[0], neighbors[1] + delta),
      mright = getInt16(neighbors[4], neighbors[5] + delta),
      mbottom = getInt16(neighbors[8], neighbors[9] + delta),
      mleft = getInt16(neighbors[12], neighbors[13] + delta),
      icenter, itop, iright, ibottom, ileft,
      ocenter, otop, oright, obottom, oleft,
      vcenter, vtop, vright, vbottom, vleft;

  var dtop = mtop > 0 && (mcenter < 1 || mcenter > mtop),
      dright = mright > 0 && (mcenter < 1 || mcenter > mright),
      dbottom = mbottom > 0 && (mcenter < 1 || mcenter > mbottom),
      dleft = mleft > 0 && (mcenter < 1 || mcenter > mleft);

  if (dtop) {
    otop = materials[mtop];
    if (!otop) return false;

    if (otop.platform) {
      dtop = false;
    } else {
      itop = assets.getTileImage(otop, 'frames', getUint8(neighbors[0], neighbors[1] + delta + 2));
      if (!itop) return false;
      vtop = variant % otop.variants * 16;
    }
  }

  if (dright) {
    oright = materials[mright];
    if (!oright) return false;

    if (oright.platform) {
      dright = false;
    } else {
      iright = assets.getTileImage(oright, 'frames', getUint8(neighbors[4], neighbors[5] + delta + 2));
      if (!iright) return false;
      vright = variant % oright.variants * 16;
    }
  }

  if (dleft) {
    oleft = materials[mleft];
    if (!oleft) return false;

    if (oleft.platform) {
      dleft = false;
    } else {
      ileft = assets.getTileImage(oleft, 'frames', getUint8(neighbors[12], neighbors[13] + delta + 2));
      if (!ileft) return false;
      vleft = variant % oleft.variants * 16;
    }
  }

  if (dbottom) {
    obottom = materials[mbottom];
    if (!obottom) return false;

    if (obottom.platform) {
      dbottom = false;
    } else {
      ibottom = assets.getTileImage(obottom, 'frames', getUint8(neighbors[8], neighbors[9] + delta + 2));
      if (!ibottom) return false;
      vbottom = variant % obottom.variants * 16;
    }
  }

  if (mcenter > 0) {
    ocenter = materials[mcenter];
    if (!ocenter) return false;

    var hueShift = view.getUint8(offset + delta + 2);

    if (ocenter.platform) {
      icenter = assets.getTileImage(ocenter, 'platformImage', hueShift);
      if (!icenter) return false;

      vcenter = variant % ocenter.platformVariants * 8;
      if (mleft > 0 && mleft != mcenter && mright > 0 && mright != mcenter) {
        vcenter += 24 * ocenter.platformVariants;
      } else if (mright > 0 && mright != mcenter) {
        vcenter += 16 * ocenter.platformVariants;
      } else if (mleft < 1 || mleft == mcenter) {
        vcenter += 8 * ocenter.platformVariants;
      }

      context.drawImage(icenter, vcenter, 0, 8, 8, x, y, 8, 8);
    } else {
      icenter = assets.getTileImage(ocenter, 'frames', hueShift);
      if (!icenter) return false;

      vcenter = variant % ocenter.variants * 16;
      context.drawImage(icenter, vcenter + 4, 12, 8, 8, x, y, 8, 8);
    }
  }

  if (dtop) {
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
  var modId = view.getInt16(offset + delta + 4), mod, modImage;
  if (modId > 0) {
    mod = matmods[modId];
    if (!mod) return false;

    modImage = assets.getTileImage(mod, 'frames', view.getUint8(offset + delta + 6));
    if (!modImage) return false;

    context.drawImage(modImage, 4 + variant % mod.variants * 16, 12, 8, 8, x, y - 4, 8, 8);
  }

  // Render the matmod of the tile below this one (if it overflows).
  if (!ocenter && neighbors[8]) {
    modId = getInt16(neighbors[8], neighbors[9] + delta + 4);
    if (modId > 0) {
      mod = matmods[modId];
      if (!mod) return false;

      modImage = assets.getTileImage(mod, 'frames', getUint8(neighbors[8], neighbors[9] + delta + 6));
      if (!modImage) return false;

      context.drawImage(modImage, 4 + variant % mod.variants * 16, 8, 8, 4, x, y, 8, 4);
    }
  }

  return true;
};
