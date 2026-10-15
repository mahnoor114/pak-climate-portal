// Portal data from the lib/*.js files (see index.html). Each is null when its file is missing.
const D = window.PORTAL_DATA || {};
export const EARTH_TEX = D.EARTH_TEX;
export const BOUND_TEX = D.BOUND_TEX;
export const CLIMATE_DATA = D.CLIMATE_DATA;
export const COUNTRIES = D.COUNTRIES;
export const PAK_BOUNDARY = D.PAK_BOUNDARY;
export const DISTRICTS = D.DISTRICTS;
export const HAS_PAK_BOUNDARY = !!PAK_BOUNDARY;
export const HAS_DISTRICTS = !!DISTRICTS;

// ---- Districts (Pakistan_Districts.geojson -> lib/districts.js): lookup and sample points for district averages ----
function inRing(x, y, r) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }
function inDistrict(x, y, f) { const b = f.bb; if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) return false; return f.geometry.coordinates.some(poly => inRing(x, y, poly[0]) && !poly.slice(1).some(h => inRing(x, y, h))); }
export function districtAt(lat, lon) { return HAS_DISTRICTS ? DISTRICTS.features.find(f => inDistrict(lon, lat, f)) : null; }
if (HAS_DISTRICTS) DISTRICTS.features.forEach(f => { // bounding box + sample points used for district averages
  const xs = [], ys = []; f.geometry.coordinates.forEach(p => p[0].forEach(([x, y]) => { xs.push(x); ys.push(y); }));
  f.bb = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const step = Math.min(.2, Math.max(.04, Math.min(f.bb[2] - f.bb[0], f.bb[3] - f.bb[1]) / 6)); f.samples = [];
  for (let y = f.bb[1] + step / 2; y < f.bb[3]; y += step) for (let x = f.bb[0] + step / 2; x < f.bb[2]; x += step) if (inDistrict(x, y, f)) f.samples.push([y, x]);
  if (!f.samples.length) f.samples.push([f.properties.c[1], f.properties.c[0]]);
});
