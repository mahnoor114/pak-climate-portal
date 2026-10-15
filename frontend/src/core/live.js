// What the user is looking at right now, so the AI assistant's answers match the screen. Components write their
// part into `live` as it changes; aiSnapshot() turns it into the page snapshot sent with each question.
import { CLIMATE_DATA } from './data.js';
import { FC_CITIES, HORIZONS } from './constants.js';
import { SCORES, SCORE_NAME, horizonStatus } from './scores.js';
import { jetSeries } from './wind.js';
import { wmo, PK_VARS, pkCityValue, pkDistrictTable } from './weather.js';

export const live = {
  view: '2D map', activeLayer: 'ENSO', liveSrc: '', driverCard: null,
  forecastOpen: false, forecastView: 'map',
  pk: null, // {data, aq, day, v} of the forecast map
  mb: null, // {data, air} of the city/point forecast
};

const pktNow = () => { const d = new Date(), pk = new Date(d.getTime() + d.getTimezoneOffset() * 60000 + 5 * 3600000); return pk.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' PKT'; };
export const pktClock = pktNow;

export function aiSnapshot() {
  const scores = {};
  for (const id in SCORE_NAME) scores[SCORE_NAME[id]] = SCORES ? { score: SCORES[id].score + ' / 100', status: SCORES[id].status } : { score: '– / 100', status: 'No data file yet. Run "python update_data.py".' };
  const js = jetSeries(), pk = live.pk, mb = live.mb;
  const pkD = pk && pk.data && (PK_VARS[pk.v].src === 'aq' ? pk.aq : pk.data);
  return {
    date: new Date().toISOString().slice(0, 10), time_pkt: pktNow(), view: live.view, forecast_window_open: live.forecastOpen,
    forecast_map: live.forecastOpen && live.forecastView === 'map' && pk && pk.data ? {
      day: pk.data.days[pk.day], showing: PK_VARS[pk.v].label,
      top_districts: pkDistrictTable(pkD, pk.v, pk.day).slice(0, 8).map(x => ({ district: x.name, province: x.province, value: Math.round(x.value * 10) / 10 })),
      city_values: Object.fromEntries(FC_CITIES.map(c => [c.n, pkD ? pkCityValue(pkD, pk.v, pk.day, c) : null]).filter(([, v]) => v != null).map(([n, v]) => [n, Math.round(v * 10) / 10])),
    } : null,
    forecast_shown: live.forecastOpen && mb && mb.data ? {
      city: mb.data.city,
      now: { temp_c: mb.data.current.temperature_2m, feels_c: mb.data.current.apparent_temperature, sky: wmo(mb.data.current.weather_code, mb.data.current.is_day)[1], wind_kmh: mb.data.current.wind_speed_10m, gust_kmh: mb.data.current.wind_gusts_10m, humidity_pct: mb.data.current.relative_humidity_2m },
      days: mb.data.daily.time.map((t, i) => ({ date: t, sky: wmo(mb.data.daily.weather_code[i])[1], max_c: mb.data.daily.temperature_2m_max[i], min_c: mb.data.daily.temperature_2m_min[i], rain_mm: mb.data.daily.precipitation_sum[i], rain_chance_pct: mb.data.daily.precipitation_probability_max[i], wind_max_kmh: mb.data.daily.wind_speed_10m_max[i], uv: mb.data.daily.uv_index_max[i] })),
      air_quality_now: mb.air || null, source: 'Open-Meteo (weather), CAMS (air)',
    } : null,
    active_layer: live.activeLayer, map_layer_source: live.liveSrc,
    driver_card_open: live.driverCard,
    influence_scores: scores,
    forecast_horizon: HORIZONS.map(h => h.range + ' ' + h.name + ': ' + horizonStatus(h.drivers)),
    jet_stream_live: js ? { data_date: js.through, peak_wind_ms: Math.max(...js.values), peak_at: js.labels[js.values.indexOf(Math.max(...js.values))] } : 'live GFS wind data not loaded yet',
    data_file_updated: CLIMATE_DATA ? CLIMATE_DATA.updated : 'missing - run python update_data.py',
  };
}

// Short message at the bottom of the screen (rendered by <Toast/>)
export function toast(msg) { window.dispatchEvent(new CustomEvent('portal-toast', { detail: msg })); }
