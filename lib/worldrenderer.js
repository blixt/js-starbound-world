module.exports = WorldRenderer;

function WorldRenderer(assets) {
  this._materials = null;
  this._matmods = null;
  this._metadata = null;
  this._objects = null;
  this._regions = {};
}

WorldRenderer.prototype.center = function (x, y) {
};

WorldRenderer.prototype.loadWorld = function (file) {
};
