// Weather codes, formatting, air-quality categories and the forecast-map variables.
import { HAS_DISTRICTS, DISTRICTS } from './data.js';

// WMO weather codes -> [day icon, text]
const WMO = {
  0: ['☀️', 'Clear sky'], 1: ['🌤️', 'Mainly clear'], 2: ['⛅', 'Partly cloudy'], 3: ['☁️', 'Overcast'], 45: ['🌫️', 'Fog'], 48: ['🌫️', 'Freezing fog'],
  51: ['🌦️', 'Light drizzle'], 53: ['🌦️', 'Drizzle'], 55: ['🌧️', 'Heavy drizzle'], 56: ['🌧️', 'Freezing drizzle'], 57: ['🌧️', 'Freezing drizzle'],
  61: ['🌦️', 'Light rain'], 63: ['🌧️', 'Rain'], 65: ['🌧️', 'Heavy rain'], 66: ['🌧️', 'Freezing rain'], 67: ['🌧️', 'Freezing rain'],
  71: ['🌨️', 'Light snow'], 73: ['🌨️', 'Snow'], 75: ['❄️', 'Heavy snow'], 77: ['🌨️', 'Snow grains'],
  80: ['🌦️', 'Light showers'], 81: ['🌧️', 'Showers'], 82: ['⛈️', 'Violent showers'], 85: ['🌨️', 'Snow showers'], 86: ['❄️', 'Heavy snow showers'],
  95: ['⛈️', 'Thunderstorm'], 96: ['⛈️', 'Thunderstorm with hail'], 99: ['⛈️', 'Severe thunderstorm with hail'],
};
export const wmo = (c, isDay = 1) => { const w = WMO[c] || ['🌡️', '—']; return (!isDay && c <= 2) ? ['🌙', w[1]] : w; };
export const compass = deg => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((deg % 360) + 360) % 360 / 45) % 8];
export const r0 = v => v == null ? '–' : Math.round(v);
export function wxKind(code) {
  if (code >= 95) return 'storm';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 51) return 'rain';
  if (code === 45 || code === 48) return 'fog';
  if (code === 3) return 'cloud';
  return code === 2 ? 'partly' : 'sun';
}
export function sunPosition(date, lat, lon) { // returns {alt, az} in degrees; az clockwise from north
  const rad = Math.PI / 180, J = date.valueOf() / 864e5 + 2440587.5 - 2451545, M = (357.5291 + 0.98560028 * J) * rad;
  const L = M + (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) * rad + 102.9372 * rad + Math.PI, e = 23.4397 * rad;
  const dec = Math.asin(Math.sin(L) * Math.sin(e)), ra = Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L));
  const H = (280.16 + 360.9856235 * J) * rad + lon * rad - ra, phi = lat * rad;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return { alt: alt / rad, az: (az / rad + 180) % 360 };
}

// US AQI categories: label, colour, short health advice
export function aqiInfo(v) {
  const t = [[50, 'Good', '#22c55e', 'Air is clean.'], [100, 'Moderate', '#eab308', 'Unusually sensitive people should limit long outdoor exertion.'],
    [150, 'Unhealthy for sensitive groups', '#f97316', 'Children, the elderly and people with asthma or heart disease should reduce outdoor activity.'],
    [200, 'Unhealthy', '#ef4444', 'Everyone should reduce prolonged outdoor exertion; sensitive groups stay indoors.'],
    [300, 'Very unhealthy', '#a855f7', 'Avoid outdoor activity; wear a mask (N95) if you must go out.'], [1e9, 'Hazardous', '#7f1d1d', 'Stay indoors with windows closed; health warning for everyone.']];
  const r = t.find(x => v <= x[0]); return { cat: r[1], color: r[2], advice: r[3] };
}

// ---- Whole-Pakistan forecast map variables: Open-Meteo 0.75° grid (/api/pakforecast) and CAMS air quality (/api/aqmap) ----
export const PK_VARS = {
  precipitation_sum: { label: 'Rain (mm)', unit: ' mm', fmt: v => v < 0.1 ? 'dry' : v.toFixed(1) + ' mm',
    ramp: [[0, 'rgba(0,0,0,0)'], [0.2, 'rgba(191,219,254,.55)'], [2, '#7cc4fa'], [5, '#3b82f6'], [10, '#6366f1'], [20, '#a855f7'], [40, '#ec4899']] },
  precipitation_probability_max: { label: 'Chance of rain', unit: '%', fmt: v => Math.round(v) + '%',
    ramp: [[0, 'rgba(0,0,0,0)'], [20, 'rgba(148,163,184,.35)'], [40, '#7cc4fa'], [60, '#3b82f6'], [80, '#4f46e5'], [100, '#312e81']] },
  temperature_2m_max: { label: 'Max temperature', unit: '°C', fmt: v => Math.round(v) + '°C',
    ramp: [[-20, '#312e81'], [-10, '#3b82f6'], [0, '#93c5fd'], [10, '#a7f3d0'], [20, '#fde68a'], [30, '#f59e0b'], [40, '#dc2626'], [48, '#7f1d1d']] },
  temperature_2m_min: { label: 'Min temperature', unit: '°C', fmt: v => Math.round(v) + '°C',
    ramp: [[-25, '#312e81'], [-10, '#3b82f6'], [0, '#93c5fd'], [10, '#a7f3d0'], [20, '#fde68a'], [28, '#f59e0b'], [35, '#dc2626']] },
  wind_speed_10m_max: { label: 'Max wind (km/h)', unit: ' km/h', fmt: v => Math.round(v) + ' km/h',
    ramp: [[0, '#1e3a8a'], [10, '#0ea5e9'], [20, '#22c55e'], [30, '#eab308'], [45, '#f97316'], [60, '#dc2626']] },
  // air quality (Open-Meteo / CAMS, 5 days; colours follow the US AQI breakpoints)
  us_aqi: { src: 'aq', label: 'Air quality (AQI)', note: 'worst hour of the day', unit: '', fmt: v => 'AQI ' + Math.round(v),
    ramp: [[0, '#22c55e'], [50, '#eab308'], [100, '#f97316'], [150, '#ef4444'], [200, '#a855f7'], [300, '#7f1d1d']] },
  pm2_5: { src: 'aq', label: 'Smog: PM2.5', note: 'daily average', unit: ' µg/m³', fmt: v => Math.round(v) + ' µg/m³',
    ramp: [[0, '#22c55e'], [12, '#eab308'], [35, '#f97316'], [55, '#ef4444'], [150, '#a855f7'], [250, '#7f1d1d']] },
  pm10: { src: 'aq', label: 'Smog: PM10', note: 'daily average', unit: ' µg/m³', fmt: v => Math.round(v) + ' µg/m³',
    ramp: [[0, '#22c55e'], [54, '#eab308'], [154, '#f97316'], [254, '#ef4444'], [354, '#a855f7'], [424, '#7f1d1d']] },
  aerosol_optical_depth: { src: 'aq', label: 'Aerosol (AOD)', note: 'daily average · 0 clear, over 1 very hazy', unit: '', fmt: v => v.toFixed(2) + ' AOD',
    ramp: [[0, 'rgba(0,0,0,0)'], [0.1, '#fef3c7'], [0.3, '#fcd34d'], [0.6, '#f59e0b'], [1, '#b45309'], [2, '#7c2d12']] },
  dust: { src: 'aq', label: 'Dust', note: 'daily peak', unit: ' µg/m³', fmt: v => Math.round(v) + ' µg/m³',
    ramp: [[0, 'rgba(0,0,0,0)'], [20, '#fde68a'], [50, '#f59e0b'], [100, '#d97706'], [200, '#92400e'], [500, '#451a03']] },
};
function parseColor(c) {
  const x = document.createElement('canvas').getContext('2d'); x.fillStyle = c; const s = x.fillStyle;
  if (s[0] === '#') return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), 255];
  const m = s.match(/[\d.]+/g).map(Number); return [m[0], m[1], m[2], Math.round((m[3] ?? 1) * 255)];
}
for (const k in PK_VARS) PK_VARS[k].stops = PK_VARS[k].ramp.map(([v, c]) => [v, parseColor(c)]);
export function pkColor(v, stops) {
  if (v == null) return [0, 0, 0, 0];
  if (v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) if (v <= stops[i][0]) { const [a, ca] = stops[i - 1], [b, cb] = stops[i], f = (v - a) / (b - a); return ca.map((x, j) => x + (cb[j] - x) * f); }
  return stops[stops.length - 1][1];
}

// A view of the forecast map = the dataset behind the selected variable (D), the variable (v) and the day index.
export function pkValue(D, v, day, lat, lon) { // bilinear value at a point, or null outside the grid
  const g = D && D.grid; if (!g || day >= D.days.length) return null;
  const fx = (lon - g.lon0) / g.step, fy = (lat - g.lat0) / g.step; if (fx < 0 || fy < 0 || fx > g.nx - 1 || fy > g.ny - 1) return null;
  const A = D.vars[v][day], x0 = Math.min(Math.floor(fx), g.nx - 2), y0 = Math.min(Math.floor(fy), g.ny - 2), tx = fx - x0, ty = fy - y0;
  const at = (y, x) => A[y * g.nx + x]; const q = [at(y0, x0), at(y0, x0 + 1), at(y0 + 1, x0), at(y0 + 1, x0 + 1)]; if (q.some(x => x == null)) return null;
  return (q[0] * (1 - tx) + q[1] * tx) * (1 - ty) + (q[2] * (1 - tx) + q[3] * tx) * ty;
}
// City labels use the city's own point forecast (the grid averages towns with surrounding mountains).
export function pkCityValue(D, v, day, c) { const x = D && D.cities && D.cities[c.n] && D.cities[c.n][v]; return x && x[day] != null ? x[day] : pkValue(D, v, day, c.ll[1], c.ll[0]); }
// District average (mean over sample points inside the district), cached per view.
export function pkDistrictValue(D, v, day, d) {
  const key = v + '|' + day + '|' + (D || {}).fetched;
  if (d.avgKey !== key) { const vals = d.samples.map(([la, lo]) => pkValue(D, v, day, la, lo)).filter(x => x != null); d.avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null; d.avgKey = key; }
  return d.avg;
}
export function pkDistrictTable(D, v, day) { // [{name, province, value}] for every district with data, highest first
  if (!HAS_DISTRICTS) return [];
  return DISTRICTS.features.filter(d => !d.properties.disputed).map(d => ({ name: d.properties.n, province: d.properties.p, value: pkDistrictValue(D, v, day, d) }))
    .filter(x => x.value != null).sort((a, b) => b.value - a.value);
}
