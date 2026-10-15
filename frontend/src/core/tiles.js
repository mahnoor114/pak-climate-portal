// Map tiles drawn onto canvases for the 3D globes: NASA GIBS live layers and Esri satellite imagery.

// Daily satellite photos (true colour, snow) are still being imaged for the parts of the world where it is not yet
// daytime, which leaves black areas. For those layers use yesterday's complete day.
export function gibsDay(id) { if (!/CorrectedReflectance|Snow_Cover_Daily/.test(id)) return ''; const d = new Date(Date.now() - 864e5); return d.toISOString().slice(0, 10) + '/'; }
export const gibsUrl = (id, ext, lvl) => 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/' + id + '/default/' + gibsDay(id) + 'GoogleMapsCompatible_Level' + lvl + '/{z}/{y}/{x}.' + ext;

// Draws Web-Mercator tiles x0..x1, y0..y1 (inclusive) at zoom z onto one canvas.
export function loadTileRect(urlFn, z, x0, x1, y0, y1) {
  return new Promise(res => {
    const c = document.createElement('canvas'); c.width = (x1 - x0 + 1) * 256; c.height = (y1 - y0 + 1) * 256;
    const ctx = c.getContext('2d');
    let pending = (x1 - x0 + 1) * (y1 - y0 + 1);
    const done = () => { if (--pending === 0) res(c); };
    // NASA GIBS occasionally answers a tile with a temporary 500; retry each tile up to twice before leaving it blank.
    const load = (x, y, tries) => {
      const img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = () => { try { ctx.drawImage(img, (x - x0) * 256, (y - y0) * 256, 256, 256); } catch (e) { /* tainted tile */ } done(); };
      img.onerror = () => tries < 2 ? setTimeout(() => load(x, y, tries + 1), 800 * (tries + 1)) : done();
      img.src = urlFn(z, x, y) + (tries ? (urlFn(z, x, y).includes('?') ? '&' : '?') + 'retry=' + tries : '');
    };
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) load(x, y, 0);
  });
}
export function loadWorldTiles(id, ext, z, lvl) {
  const n = Math.pow(2, z) - 1;
  return loadTileRect((z, x, y) => 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/' + id + '/default/' + gibsDay(id) + 'GoogleMapsCompatible_Level' + lvl + '/' + z + '/' + y + '/' + x + '.' + ext, z, 0, n, 0, n);
}
export const ESRI_SAT = (z, x, y) => 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/' + z + '/' + y + '/' + x;

// Reprojects a Mercator tile canvas (from loadTileRect) to an equirectangular lon/lat window.
export function mercatorPatchToEquirect(src, z, x0, y0, lonW, lonE, latS, latN, outW) {
  const W = 256 * Math.pow(2, z), outH = Math.round(outW * (latN - latS) / (lonE - lonW));
  const sd = src.getContext('2d').getImageData(0, 0, src.width, src.height).data, sw = src.width, sh = src.height;
  const out = document.createElement('canvas'); out.width = outW; out.height = outH;
  const octx = out.getContext('2d'), od = octx.createImageData(outW, outH), dd = od.data;
  const xs = new Int32Array(outW);
  for (let x = 0; x < outW; x++) { const lon = lonW + (x + .5) / outW * (lonE - lonW); xs[x] = Math.min(sw - 1, Math.max(0, ((lon + 180) / 360 * W - x0 * 256) | 0)); }
  for (let y = 0; y < outH; y++) {
    const lat = Math.max(-85.05, Math.min(85.05, latN - (y + .5) / outH * (latN - latS))) * Math.PI / 180;
    const sy = Math.min(sh - 1, Math.max(0, ((1 - Math.log(Math.tan(Math.PI / 4 + lat / 2)) / Math.PI) / 2 * W - y0 * 256) | 0));
    const ro = y * outW * 4, so = sy * sw * 4;
    for (let x = 0; x < outW; x++) { const ri = ro + x * 4, si = so + xs[x] * 4; dd[ri] = sd[si]; dd[ri + 1] = sd[si + 1]; dd[ri + 2] = sd[si + 2]; dd[ri + 3] = 255; }
  }
  octx.putImageData(od, 0, 0);
  return out;
}
// Global Esri imagery (zoom 4) as one 4096×2048 equirectangular canvas, loaded once and shared by the 3D view and the driver card.
let satWorldReq = null;
export function getSatWorld() {
  if (!satWorldReq) satWorldReq = loadTileRect(ESRI_SAT, 4, 0, 15, 0, 15).then(c => mercatorPatchToEquirect(c, 4, 0, 0, -180, 180, -90, 90, 4096));
  return satWorldReq;
}
export function mercatorToEquirect(src) {
  const W = src.width, H = W >> 1;
  const sd = src.getContext('2d').getImageData(0, 0, W, W).data;
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const octx = out.getContext('2d'); const od = octx.createImageData(W, H); const dd = od.data;
  for (let y = 0; y < H; y++) {
    const lat = (90 - (y + .5) / H * 180) * Math.PI / 180;
    let sy = -1;
    if (Math.abs(lat) < 1.4844) {
      sy = (W / 2 - W * Math.log(Math.tan(Math.PI / 4 + lat / 2)) / (2 * Math.PI)) | 0;
      if (sy < 0) sy = 0; if (sy >= W) sy = W - 1;
    }
    const ro = y * W * 4, so = sy * W * 4;
    for (let x = 0; x < W; x++) {
      const ri = ro + x * 4;
      if (sy < 0) { dd[ri + 3] = 0; continue; }
      const si = so + x * 4;
      dd[ri] = sd[si]; dd[ri + 1] = sd[si + 1]; dd[ri + 2] = sd[si + 2]; dd[ri + 3] = sd[si + 3];
    }
  }
  octx.putImageData(od, 0, 0);
  return out;
}

export function loadAsset(tag, attrs) {
  return new Promise((res, rej) => { const e = document.createElement(tag); Object.assign(e, attrs); e.onload = res; e.onerror = () => rej(new Error('could not load ' + (attrs.src || attrs.href))); document.head.appendChild(e); });
}
