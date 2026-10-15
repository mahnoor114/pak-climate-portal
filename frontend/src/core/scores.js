// Influence scores from lib/indices.js. A transparent heuristic: 50 = normal, each driver's standardized anomaly
// (z vs 1991-2020) pushes it up or down.
import { CLIMATE_DATA } from './data.js';

export const CD = CLIMATE_DATA ? CLIMATE_DATA.series : null;
export const DRV_NAME = { enso: 'ENSO', iod: 'IOD', mjo: 'MJO', sst: 'Arabian Sea SST', bengal: 'Bay of Bengal', wd: 'W. disturbance rain', tibet: 'Tibetan Plateau', ao: 'Arctic Osc.', nao: 'North Atlantic', snow: 'Eurasian snow' };
export const SCORE_W = {
  monsoon: { enso: -1, iod: .8, sst: .5, bengal: .5, tibet: .5, mjo: .3 },
  winter: { enso: .7, nao: .5, wd: .6 },
  heat: { tibet: 1, sst: .6, bengal: .4, enso: .3 },
  flood: { sst: .6, bengal: .4, iod: .5, enso: -.4, wd: .5 },
};
export const SCORE_NAME = { monsoon: 'Monsoon', winter: 'Winter precipitation', heat: 'Heat risk', flood: 'Flood-supporting signal' };
export const PHASE = {
  enso: v => v >= .5 ? 'El Niño conditions' : v <= -.5 ? 'La Niña conditions' : 'ENSO-neutral',
  iod: v => v >= .4 ? 'Positive IOD' : v <= -.4 ? 'Negative IOD' : 'Neutral IOD',
  ao: v => v >= 0 ? 'Positive phase' : 'Negative phase',
  nao: v => v >= 0 ? 'Positive phase' : 'Negative phase',
};
export function latestZ(k) { const s = CD && CD[k]; return s && s.z && s.z.length ? s.z[s.z.length - 1] : 0; }
export const fz = z => (z >= 0 ? '+' : '') + z.toFixed(1) + 'σ';
export function scoreFrom(w, zf) {
  let tot = 0, sw = 0; const parts = [];
  for (const k in w) { const c = w[k] * zf(k); tot += c; sw += Math.abs(w[k]); parts.push([k, c]); }
  const score = Math.max(0, Math.min(100, Math.round(50 + 25 * tot / sw)));
  const agree = parts.reduce((a, [k, c]) => a + (Math.sign(c) === Math.sign(tot) && c !== 0 ? Math.abs(w[k]) : 0), 0) / sw;
  parts.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  return { score, agree, parts };
}

// Current scores: {monsoon: {score, status, lead}, ...}; null when indices.js is missing
export const SCORES = CD ? Object.fromEntries(Object.keys(SCORE_W).map(id => {
  const r = scoreFrom(SCORE_W[id], latestZ), lead = r.parts[0][0];
  return [id, { score: r.score, lead, status: (r.score >= 60 ? 'Above normal' : r.score <= 40 ? 'Below normal' : 'Near normal') + ' · led by ' + DRV_NAME[lead] + ' ' + fz(latestZ(lead)) }];
})) : null;

// Trend: monthly scores over the last 12 months (drivers carried forward when a series lags, MJO excluded as it is pentad data)
export function trendSeries() {
  const months = CD.enso.labels.slice(-12), zAt = {};
  for (const k in CD) { if (k === 'mjo') continue; const m = {}; CD[k].labels.forEach((l, i) => m[l] = CD[k].z[i]); zAt[k] = m; }
  const carry = {}, series = { monsoon: [], winter: [], heat: [], flood: [] };
  CD.enso.labels.forEach(l => {
    for (const k in zAt) if (zAt[k][l] !== undefined) carry[k] = zAt[k][l];
    if (months.indexOf(l) < 0) return;
    for (const id in series) series[id].push(scoreFrom(SCORE_W[id], k => carry[k] || 0).score);
  });
  return { months, series };
}

// Forecast horizon tile status line, e.g. "Jet live · WD +1.2σ · MJO -0.3σ"
export const horizonStatus = ks => CD ? ks.map(k => k === 'jet' ? 'Jet live' : DRV_NAME[k].split(' ')[0] + ' ' + fz(latestZ(k))).join(' · ') : '';
