// Public Mapbox token (pk.*): restrict it to this site's URL in the Mapbox account so others can't reuse it.
export const MAPBOX_TOKEN = 'pk.eyJ1IjoiemVlc2hhbjEwIiwiYSI6ImNtMXN0YXVhbTBhYnIybHNhOHRheHRwOWoifQ.vgmSlaE3lAnZPy59Ni7SkQ';
export const ACCENT = '#38bdf8';
export const PAK_BOUNDS = [[23.6, 60.8], [37.1, 77.9]];

// Four driver groups, one colour each (bottom bar, map markers, driver cards, contribution chart, key)
const GROUP_COLOR = { ocean: '#38bdf8', circulation: '#a78bfa', land: '#fbbf24', remote: '#34d399' };
const DRIVER_GROUP = { enso: 'ocean', iod: 'ocean', sst: 'ocean', bengal: 'ocean', mjo: 'circulation', wd: 'circulation', jet: 'circulation', tibet: 'land', snow: 'land', ao: 'remote', nao: 'remote' };

// The driver chips of the bottom bar, in order; points/radius/popup are the map markers of each driver's region.
export const DRIVERS = [
  { key: 'enso', icon: '🌊', name: 'ENSO', points: [[0, 160], [10, 175], [0, 140], [-10, 170]], radius: 9, popup: 'ENSO signal zone' },
  { key: 'iod', icon: '◐', name: 'Indian Ocean Dipole', points: [[-5, 50], [0, 60], [5, 70], [10, 80]], radius: 8, popup: 'Indian Ocean Dipole signal' },
  { key: 'mjo', icon: '➤', name: 'MJO convection', points: [[-5, 70], [0, 85], [5, 100], [10, 115]], radius: 7, popup: 'MJO convection pathway' },
  { key: 'sst', icon: '🌡', name: 'Arabian Sea SST', points: [[23, 59], [20, 62], [17, 65], [14, 68]], radius: 9, popup: 'Arabian Sea SST anomaly zone' },
  { key: 'bengal', icon: '≈', name: 'Bay of Bengal', points: [[15, 88], [18, 90], [21, 91], [24, 90]], radius: 8, popup: 'Bay of Bengal moisture source' },
  { key: 'wd', icon: '✦', name: 'Western disturbances', points: [[38, 30], [36, 38], [34, 46], [32, 54], [30, 61]], radius: 7, popup: 'Western disturbance track' },
  { key: 'jet', icon: '〰', name: 'Jet stream', points: [[42, 20], [40, 30], [38, 40], [36, 50], [34, 60], [32, 70]], radius: 5, popup: 'Jet stream corridor' },
  { key: 'tibet', icon: '▲', name: 'Tibetan Plateau', points: [[30, 84], [32, 87], [34, 90], [36, 93]], radius: 8, popup: 'Tibetan Plateau heating' },
  { key: 'ao', icon: 'A', name: 'Arctic Oscillation', points: [[60, 0], [55, 30], [58, 60], [62, 90]], radius: 7, popup: 'Arctic Oscillation influence' },
  { key: 'nao', icon: 'N', name: 'North Atlantic', points: [[55, -20], [50, 0], [48, 20], [45, 40]], radius: 7, popup: 'North Atlantic circulation' },
  { key: 'snow', icon: '❄', name: 'Eurasian snow', points: [[50, 50], [55, 70], [58, 90], [52, 110]], radius: 8, popup: 'Eurasian snow cover signal' },
].map(d => ({ ...d, color: GROUP_COLOR[DRIVER_GROUP[d.key]] }));
export const DRIVER = Object.fromEntries(DRIVERS.map(d => [d.key, d]));

const NS = 'https://earth.nullschool.net/#';
// Live layer per driver: NASA GIBS tiles [layer id, format, max level], or the animated GFS wind at a pressure level
export const SOURCES = {
  enso: { gibs: ['GHRSST_L4_MUR_Sea_Surface_Temperature_Anomalies', 'png', 7], label: 'GHRSST MUR sea-surface temp anomaly', url: NS + 'current/ocean/surface/currents/overlay=sea_surface_temp_anomaly/orthographic=69.17,-0.40,523' },
  iod: { gibs: ['GHRSST_L4_MUR_Sea_Surface_Temperature_Anomalies', 'png', 7], label: 'GHRSST MUR SST anomaly — Indian Ocean', url: NS + 'current/ocean/surface/currents/overlay=sea_surface_temp_anomaly/orthographic=75,-10,350' },
  mjo: { gibs: ['IMERG_Precipitation_Rate', 'png', 6], label: 'GPM IMERG precipitation rate', url: NS + 'current/wind/surface/level/orthographic=85,0,350' },
  sst: { gibs: ['GHRSST_L4_MUR_Sea_Surface_Temperature', 'png', 7], label: 'GHRSST MUR sea-surface temperature', url: NS + 'current/ocean/surface/currents/overlay=sea_surface_temp/orthographic=62,15,350' },
  bengal: { gibs: ['GHRSST_L4_MUR_Sea_Surface_Temperature', 'png', 7], label: 'GHRSST MUR sea-surface temperature', url: NS + 'current/ocean/surface/currents/overlay=sea_surface_temp/orthographic=88,15,350' },
  wd: { wind: 500, label: 'GFS 500 hPa wind (western disturbances) — as on earth.nullschool', url: NS + 'current/wind/isobaric/500hPa/orthographic=-288.72,7.69,561' },
  jet: { wind: 250, label: 'GFS 250 hPa wind (jet stream) — as on earth.nullschool', url: NS + 'current/wind/isobaric/250hPa/orthographic=-288.72,7.69,561' },
  tibet: { gibs: ['VIIRS_NOAA20_NDVI_8Day', 'png', 8], label: 'VIIRS NOAA-20 NDVI (land heating)', url: NS + 'current/wind/surface/level/orthographic=90,32,350' },
  ao: { gibs: ['MODIS_Terra_CorrectedReflectance_TrueColor', 'jpeg', 9], label: 'MODIS Terra true color', url: NS + 'current/wind/surface/level/orthographic=0,85,400' },
  nao: { gibs: ['MODIS_Terra_CorrectedReflectance_TrueColor', 'jpeg', 9], label: 'MODIS Terra true color', url: NS + 'current/wind/surface/level/orthographic=-30,50,350' },
  snow: { gibs: ['MODIS_Terra_L3_NDSI_Snow_Cover_Daily', 'png', 8], label: 'MODIS Terra NDSI snow cover', url: NS + 'current/wind/surface/level/orthographic=70,50,350' },
};

export const DESCRIPTIONS = {
  enso: 'ENSO modifies tropical circulation and can alter Pakistan monsoon and seasonal temperature/rainfall patterns.',
  iod: 'IOD changes the west–east Indian Ocean SST gradient and can modulate South Asian monsoon rainfall.',
  mjo: 'MJO is a subseasonal tropical convection pulse useful for 1–6 week rainfall and thunderstorm outlooks.',
  sst: 'Arabian Sea SST influences moisture availability, coastal heat and monsoon moisture transport.',
  bengal: 'Bay of Bengal convection is a major moisture source for the South Asian monsoon circulation.',
  wd: 'Western disturbances are a primary source of winter rain and snowfall across northern and western Pakistan.',
  jet: 'Jet-stream position helps determine the track and intensity of western disturbances and large-scale weather systems.',
  tibet: 'Tibetan Plateau heating contributes to the thermal structure supporting the South Asian summer monsoon.',
  ao: 'AO affects Northern Hemisphere pressure patterns and can influence cold-air outbreaks and winter circulation.',
  nao: 'NAO-related circulation changes can influence Eurasian weather patterns and western-disturbance pathways.',
  snow: 'Eurasian snow cover can modify land heating and downstream circulation relevant to monsoon variability.',
};

// Forecast cities ([lon, lat]); also labelled in the 3D terrain view, where clicking one opens its forecast.
// Same list as PAK_CITIES in portal_server.py.
export const FC_CITIES = [
  { n: 'Islamabad', ll: [73.05, 33.69] }, { n: 'Lahore', ll: [74.34, 31.55] }, { n: 'Karachi', ll: [67.01, 24.86] }, { n: 'Peshawar', ll: [71.58, 34.01] },
  { n: 'Quetta', ll: [66.99, 30.18] }, { n: 'Multan', ll: [71.47, 30.20] }, { n: 'Faisalabad', ll: [73.08, 31.42] }, { n: 'Hyderabad', ll: [68.37, 25.40] },
  { n: 'Sukkur', ll: [68.86, 27.70] }, { n: 'Gwadar', ll: [62.32, 25.13] }, { n: 'Muzaffarabad', ll: [73.47, 34.37] }, { n: 'Gilgit', ll: [74.31, 35.92] },
  { n: 'Skardu', ll: [75.63, 35.30] }, { n: 'Chitral', ll: [71.79, 35.85] },
];
// 3D terrain "Fly to" places: centre, zoom, pitch, bearing
export const PLACES = [
  { n: 'K2 & Karakoram', c: [76.51, 35.88], z: 9.4, p: 72, b: -35 },
  { n: 'Nanga Parbat', c: [74.59, 35.24], z: 10.2, p: 70, b: 160 },
  { n: 'Hunza Valley', c: [74.66, 36.32], z: 10.6, p: 70, b: 40 },
  { n: 'Hindu Kush', c: [71.84, 36.26], z: 9.6, p: 70, b: 200 },
  { n: 'Tarbela Dam', c: [72.69, 34.09], z: 11.2, p: 65, b: 120 },
  { n: 'Islamabad', c: [73.05, 33.72], z: 10.8, p: 62, b: -20 },
  { n: 'Quetta', c: [67.0, 30.18], z: 9.6, p: 66, b: 90 },
  { n: 'Indus Delta', c: [67.6, 24.3], z: 8.4, p: 55, b: 0 },
  { n: 'All Pakistan', c: [69.3, 30.3], z: 4.8, p: 40, b: 0 },
];

export const HORIZONS = [
  { drivers: ['jet', 'wd', 'mjo'], range: '0–10 days', name: 'Synoptic', small: 'Jet + WD + MJO' },
  { drivers: ['mjo', 'sst', 'enso'], range: '10–45 days', name: 'Subseasonal', small: 'MJO + SST + ENSO' },
  { drivers: ['enso', 'iod', 'sst'], range: '1–3 months', name: 'Seasonal', small: 'ENSO + IOD + SST' },
  { drivers: ['enso', 'ao', 'nao', 'snow'], range: '3–12 months', name: 'Climate', small: 'ENSO + AO + NAO + Snow' },
];
