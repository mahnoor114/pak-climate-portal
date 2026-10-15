// Upper-level wind (GFS via Open-Meteo, the same model earth.nullschool draws), shared by the 2D map, the 3D globe,
// the 3D terrain and the jet-stream driver card. Global 7.5° grid (75°S-75°N, all longitudes); the server sends
// its grid with the data and fetchWind adopts it.
import { SOURCES } from './constants.js';

let WG = { lat0: -75, lon0: -180, step: 7.5, ny: 21, nx: 48 };
let windData = null, windReq = null, windRegion = null; // windRegion: finer grid over the western-disturbance corridor, if the server has it
let windDay = null;
export const getWindDay = () => windDay;
export const hasWind = () => !!windData;

// Daily cache: one successful Open-Meteo call per calendar day per browser; a failed call is retried after WIND_RETRY_MS.
const WIND_RETRY_MS = 15 * 60000;
function readWindCache() { try { return JSON.parse(localStorage.getItem('pkWindDaily2') || 'null') || {}; } catch (e) { return {}; } }
function writeWindCache(c) { try { localStorage.setItem('pkWindDaily2', JSON.stringify(c)); } catch (e) { /* storage blocked */ } }

// Prefer the portal server's shared cache (one Open-Meteo call every few hours for everyone);
// fall back to calling Open-Meteo from this browser only when the page is served without the portal server.
export function fetchWind() {
  if (windData) return Promise.resolve(windData);
  if (windReq) return windReq;
  windReq = fetch('/api/wind').then(r => {
    if (r.status === 503) return r.json().then(js => { throw new Error(js.error || 'wind unavailable'); });
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) return null;
    return r.json();
  }, () => null).then(js => {
    if (!js) { windReq = null; return fetchWindDirect(); }
    if (js.grid) WG = js.grid;
    windData = js.d; windRegion = js.region || null;
    const ft = new Date(js.fetched.replace(' UTC', 'Z').replace(' ', 'T'));
    windDay = (isNaN(ft) ? js.fetched : ft.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC') + (js.stale ? ' (latest available)' : '');
    return windData;
  });
  windReq.catch(() => { windReq = null; });
  return windReq;
}
function fetchWindDirect() {
  if (windReq) return windReq;
  const today = new Date().toLocaleDateString('en-CA'), c = readWindCache();
  const useCache = () => { if (c.d) { windData = c.d; windDay = c.day; return windData; } throw new Error('no wind data cached'); };
  if (c.d && c.day === today) return Promise.resolve(useCache());
  if (Date.now() - c.tried < WIND_RETRY_MS) { windReq = Promise.resolve().then(useCache); windReq.catch(() => { windReq = null; }); return windReq; }
  writeWindCache({ day: c.day, d: c.d, tried: Date.now() });
  const urls = [];
  for (let j0 = 0; j0 < WG.ny; j0 += 3) {
    const la = [], lo = []; for (let j = j0; j < Math.min(j0 + 3, WG.ny); j++) for (let i = 0; i < WG.nx; i++) { la.push(WG.lat0 + j * WG.step); lo.push(WG.lon0 + i * WG.step); }
    urls.push('https://api.open-meteo.com/v1/gfs?latitude=' + la.join(',') + '&longitude=' + lo.join(',') + '&current=wind_speed_250hPa,wind_direction_250hPa,wind_speed_500hPa,wind_direction_500hPa&wind_speed_unit=ms');
  }
  windReq = Promise.all(urls.map(u => fetch(u).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }))).then(parts => {
    const arr = parts.flatMap(js => Array.isArray(js) ? js : [js]), d = { 250: { u: [], v: [] }, 500: { u: [], v: [] } };
    arr.forEach(o => { const c = o.current || {}; [250, 500].forEach(lv => { const s = c['wind_speed_' + lv + 'hPa'] || 0, a = (c['wind_direction_' + lv + 'hPa'] || 0) * Math.PI / 180; d[lv].u.push(-s * Math.sin(a)); d[lv].v.push(-s * Math.cos(a)); }); });
    windData = d; windDay = today;
    writeWindCache({ day: today, d, tried: Date.now() });
    return d;
  }).catch(useCache);
  windReq.catch(() => { windReq = null; });
  return windReq;
}

function windGridAt(G, g, lat, lon) { // bilinear u,v from one grid (no wrap); null outside
  const fx = (lon - G.lon0) / G.step, fy = (lat - G.lat0) / G.step; if (fx < 0 || fy < 0 || fx > G.nx - 1 || fy > G.ny - 1) return null;
  const x0 = Math.min(Math.floor(fx), G.nx - 2), y0 = Math.min(Math.floor(fy), G.ny - 2), tx = fx - x0, ty = fy - y0, k = (y, x) => y * G.nx + x;
  const bl = A => (A[k(y0, x0)] * (1 - tx) + A[k(y0, x0 + 1)] * tx) * (1 - ty) + (A[k(y0 + 1, x0)] * (1 - tx) + A[k(y0 + 1, x0 + 1)] * tx) * ty;
  return { w: [bl(g.u), bl(g.v)], edge: Math.min(fx, fy, G.nx - 1 - fx, G.ny - 1 - fy) };
}
// [u, v] in m/s at a point and pressure level (250 or 500 hPa), or null before the data has loaded
export function windAt(lat, lon, lv) {
  const g = windData && windData[lv]; if (!g) return null;
  // longitudes wrap around the globe; latitudes beyond the grid reuse its edge rows
  const span = WG.nx * WG.step, fx = ((((lon - WG.lon0) % span) + span) % span) / WG.step;
  const fy = Math.max(0, Math.min(WG.ny - 1, (lat - WG.lat0) / WG.step));
  const x0 = Math.floor(fx) % WG.nx, x1 = (x0 + 1) % WG.nx, y0 = Math.min(Math.floor(fy), WG.ny - 2), tx = fx - Math.floor(fx), ty = fy - y0;
  const k = (y, x) => y * WG.nx + x, a = k(y0, x0), b = k(y0, x1), c = k(y0 + 1, x0), e = k(y0 + 1, x1);
  const bl = A => (A[a] * (1 - tx) + A[b] * tx) * (1 - ty) + (A[c] * (1 - tx) + A[e] * tx) * ty;
  const glob = [bl(g.u), bl(g.v)];
  // finer 2.5° grid along the western-disturbance corridor, blended into the global one over its outer cell
  const R = windRegion && windRegion.d[lv] && windGridAt(windRegion.grid, windRegion.d[lv], lat, lon);
  if (!R) return glob;
  const t = Math.min(1, R.edge); return [glob[0] + (R.w[0] - glob[0]) * t, glob[1] + (R.w[1] - glob[1]) * t];
}
const WIND_RAMP = [[0, [20, 40, 110]], [.2, [30, 120, 190]], [.4, [40, 190, 170]], [.6, [150, 210, 70]], [.75, [250, 200, 50]], [.9, [240, 90, 60]], [1, [200, 50, 160]]];
export function windColor(s, level) {
  const t = Math.min(1, s / (level == 250 ? 80 : 50));
  for (let i = 1; i < WIND_RAMP.length; i++) if (t <= WIND_RAMP[i][0]) {
    const [t0, c0] = WIND_RAMP[i - 1], [t1, c1] = WIND_RAMP[i], f = (t - t0) / (t1 - t0);
    return c0.map((v, j) => Math.round(v + (c1[j] - v) * f));
  }
  return WIND_RAMP[WIND_RAMP.length - 1][1];
}

// 250 hPa wind speed averaged over 30°N and 35°N, by longitude (jet-stream driver card and AI snapshot)
export function jetSeries() {
  const g = windData && windData[250]; if (!g) return null;
  const labels = [], values = [];
  for (let lon = 15; lon <= 125; lon += 5) {
    const sp = lat => { const w = windAt(lat, lon, 250); return w ? Math.hypot(w[0], w[1]) : 0; };
    labels.push(lon + '°E'); values.push(Math.round((sp(30) + sp(35)) / 2 * 10) / 10);
  }
  return { title: '250 hPa wind speed along 30–35°N', unit: 'm/s', source: 'GFS via Open-Meteo', url: SOURCES.jet.url, labels, values, kind: 'line', through: windDay, xIsLon: true };
}
