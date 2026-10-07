"""Download the latest climate-driver series (NOAA, NASA, Rutgers) into lib/indices.js.

portal_server.py runs this automatically once a day; to refresh by hand:  python update_data.py
The dashboard loads lib/indices.js like the other lib/ files, so it makes no data requests itself.
If a source is down, its previous series is kept rather than dropped.
Each monthly series carries `z`: the standardized anomaly against its own 1991-2020 monthly climatology.
"""
import datetime as dt
import json
import os
import statistics
import urllib.request

MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
N_MONTHS = 24
CLIM = (1991, 2020)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib', 'indices.js')


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'PakClimateDashboard/1.0'})
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.read().decode('utf-8', 'replace')


def label(y, m):
    return f'{MONTHS[m - 1]} {str(y)[2:]}'


def zscores(pts):
    """pts: [(year, month, value)] -> z for each point, using the per-calendar-month 1991-2020 mean and std."""
    clim = {}
    for m in range(1, 13):
        vals = [v for y, mm, v in pts if mm == m and CLIM[0] <= y <= CLIM[1]]
        if len(vals) < 5:  # short record: fall back to everything available for that month
            vals = [v for y, mm, v in pts if mm == m]
        mean = statistics.fmean(vals)
        sd = statistics.pstdev(vals) or 1.0
        clim[m] = (mean, sd)
    return [(v - clim[m][0]) / clim[m][1] for y, m, v in pts]


def psl_table(url, missing):
    """NOAA PSL year-per-row tables: 'YYYY v1 .. v12'."""
    pts = []
    for line in get(url).splitlines():
        parts = line.split()
        if len(parts) == 13 and parts[0].isdigit() and len(parts[0]) == 4:
            y = int(parts[0])
            for m, v in enumerate(parts[1:], 1):
                v = float(v)
                if v > missing:
                    pts.append((y, m, v))
    return pts


def cpc_monthly(url):
    """NOAA CPC 'YYYY M value' monthly files (AO, NAO)."""
    pts = []
    for line in get(url).splitlines():
        parts = line.split()
        if len(parts) == 3 and parts[0].isdigit():
            pts.append((int(parts[0]), int(parts[1]), float(parts[2])))
    return pts


def cpc_dmi():
    """NOAA CPC Dipole Mode Index from ERSSTv6: 'Year Month WTIO SETIO DMI'. Updated monthly, ~1 month lag
    (the HadISST-based PSL index lags ~4 months)."""
    pts = []
    for line in get('https://www.cpc.ncep.noaa.gov/products/international/ocean_monitoring/IODMI/mnth.ersstv6.clim19912020.dmi_current.txt').splitlines():
        parts = line.split()
        if len(parts) == 5 and parts[0].isdigit() and len(parts[0]) == 4:
            v = float(parts[4])
            if v > -99:
                pts.append((int(parts[0]), int(parts[1]), v))
    return pts


def rutgers_snow():
    pts = []
    for line in get('https://climate.rutgers.edu/snowcover/files/moncov.eurasia.txt').splitlines():
        parts = line.split()
        if len(parts) == 3 and parts[0].isdigit():
            pts.append((int(parts[0]), int(parts[1]), int(parts[2]) / 1e6))
    return pts


def nasa_power(param, lat, lon):
    url = ('https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=' + param +
           f'&community=RE&longitude={lon}&latitude={lat}&start={CLIM[0]}&end={dt.date.today().year}&format=JSON')
    data = json.loads(get(url))['properties']['parameter'][param]
    pts = []
    for k in sorted(data):
        m = int(k[4:])
        if 1 <= m <= 12 and data[k] != -999:
            pts.append((int(k[:4]), m, data[k]))
    return pts


def cpc_mjo(n=36):
    """NOAA CPC MJO pentad index; columns ordered 20E,70E,80E,100E,120E,140E,160E,120W,40W,10W."""
    rows = []
    for line in get('https://www.cpc.ncep.noaa.gov/products/precip/CWlink/daily_mjo_index/proj_norm_order.ascii').splitlines():
        parts = line.split()
        if len(parts) == 11 and parts[0].isdigit() and '*' not in line:
            d = dt.datetime.strptime(parts[0], '%Y%m%d')
            rows.append((d.strftime('%d %b'), float(parts[3]), float(parts[4])))
    return rows[-n:]


def series(title, unit, source, url, pts, kind='line', **extra):
    z = zscores(pts)
    pts, z = pts[-N_MONTHS:], z[-N_MONTHS:]
    return dict(title=title, unit=unit, source=source, url=url, kind=kind,
                labels=[label(y, m) for y, m, v in pts],
                values=[round(v, 3) for y, m, v in pts],
                z=[round(x, 2) for x in z], **extra)


def build():
    out = {}
    jobs = {
        'enso': lambda: series('Niño 3.4 SST anomaly', '°C', 'NOAA PSL · ERSST', 'https://psl.noaa.gov/data/timeseries/month/DS/NINO34/',
                               psl_table('https://psl.noaa.gov/data/correlation/nina34.anom.data', -99), 'bar', thresholds=[0.5, -0.5]),
        'iod': lambda: series('Dipole Mode Index (IOD)', '°C', 'NOAA CPC · ERSSTv6', 'https://www.cpc.ncep.noaa.gov/products/international/ocean_monitoring/IODMI/DMI_month.html',
                              cpc_dmi(), 'bar', thresholds=[0.4, -0.4]),
        'ao': lambda: series('Arctic Oscillation index', 'σ', 'NOAA CPC', 'https://www.cpc.ncep.noaa.gov/products/precip/CWlink/daily_ao_index/ao.shtml',
                             cpc_monthly('https://www.cpc.ncep.noaa.gov/products/precip/CWlink/daily_ao_index/monthly.ao.index.b50.current.ascii'), 'bar'),
        'nao': lambda: series('North Atlantic Oscillation index', 'σ', 'NOAA CPC', 'https://www.cpc.ncep.noaa.gov/products/precip/CWlink/pna/nao.shtml',
                              cpc_monthly('https://www.cpc.ncep.noaa.gov/products/precip/CWlink/pna/norm.nao.monthly.b5001.current.ascii'), 'bar'),
        'snow': lambda: series('Eurasian snow cover extent', 'million km²', 'Rutgers Global Snow Lab', 'https://climate.rutgers.edu/snowcover/',
                               rutgers_snow()),
        'sst': lambda: series('Arabian Sea surface temperature (15°N 65°E)', '°C', 'NASA POWER · MERRA-2', 'https://power.larc.nasa.gov/',
                              nasa_power('TS', 15, 65)),
        'bengal': lambda: series('Bay of Bengal surface temperature (15°N 88°E)', '°C', 'NASA POWER · MERRA-2', 'https://power.larc.nasa.gov/',
                                 nasa_power('TS', 15, 88)),
        'tibet': lambda: series('Tibetan Plateau air temperature (32°N 90°E)', '°C', 'NASA POWER · MERRA-2', 'https://power.larc.nasa.gov/',
                                nasa_power('T2M', 32, 90)),
        'wd': lambda: series('Northern Pakistan precipitation (34°N 72°E)', 'mm/day', 'NASA POWER · MERRA-2', 'https://power.larc.nasa.gov/',
                             nasa_power('PRECTOTCORR', 34, 72), 'bar'),
    }
    for key, job in jobs.items():
        try:
            out[key] = job()
            s = out[key]
            print(f'ok    {key:7s} {s["labels"][-1]}  value {s["values"][-1]}  z {s["z"][-1]}')
        except Exception as e:  # keep going; the page falls back for missing keys
            print(f'FAIL  {key:7s} {e}')
    try:
        rows = cpc_mjo()
        out['mjo'] = dict(title='MJO index · Indian Ocean (80°E, 100°E)', unit='σ', source='NOAA CPC', kind='line',
                          url='https://www.cpc.ncep.noaa.gov/products/precip/CWlink/MJO/mjo.shtml',
                          labels=[r[0] for r in rows], values=[r[1] for r in rows], values2=[r[2] for r in rows],
                          z=[r[1] for r in rows], names=['80°E', '100°E'])
        print(f'ok    mjo     {rows[-1][0]}')
    except Exception as e:
        print(f'FAIL  mjo     {e}')
    return out


def previous_series():
    """Series from the current lib/indices.js, so a source that is down today doesn't vanish from the portal."""
    try:
        with open(OUT, encoding='utf-8') as f:
            txt = f.read()
        return json.loads(txt[txt.index('{'):txt.rindex('}') + 1])['series']
    except (OSError, ValueError, KeyError):
        return {}


def update():
    """Download everything and rewrite lib/indices.js (also called daily by portal_server.py)."""
    series_out = build()
    for key, old in previous_series().items():
        if key not in series_out:
            series_out[key] = old
            print(f'kept  {key:7s} previous copy (through {old["labels"][-1]})')
    data = {'updated': dt.datetime.now().strftime('%Y-%m-%d %H:%M'), 'series': series_out}
    tmp = OUT + '.tmp'  # write then swap, so the page never loads a half-written file
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write('const CLIMATE_DATA=' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
    os.replace(tmp, OUT)
    print('wrote', OUT)


if __name__ == '__main__':
    update()
