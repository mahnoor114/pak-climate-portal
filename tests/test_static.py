"""The server serves the built React app (dist/), the lib/ data files and the API, and nothing outside the portal.

Needs a built dist/ (build_frontend.ps1, or `npm run build` in frontend/). Runs the FastAPI app in-process
without its startup hook, so no data refresh threads start and no external API is called.
"""
import os
import re
import sys

import pytest
from fastapi.testclient import TestClient

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import portal_api  # noqa: E402

pytestmark = pytest.mark.skipif(not os.path.isfile(os.path.join(ROOT, 'dist', 'index.html')), reason='dist/ not built')
client = TestClient(portal_api.app)  # not used as a context manager: the lifespan (background refresh) doesn't run


def test_home_is_the_react_app():
    r = client.get('/')
    assert r.status_code == 200
    assert 'text/html' in r.headers['content-type']
    assert '<div id="root">' in r.text


def test_app_assets_are_served():
    html = client.get('/').text
    assets = re.findall(r'/assets/[^"]+\.(?:js|css)', html)
    assert assets, 'index.html references no built assets'
    for a in assets:
        r = client.get(a)
        assert r.status_code == 200, a
        assert r.content


def test_old_page_redirects_to_app():
    r = client.get('/Pak%20Climate.html', follow_redirects=False)
    assert r.status_code == 301
    assert r.headers['location'] == '/'


def test_data_files_load():
    for f in ('lib/indices.js', 'lib/pak_boundary.js', 'lib/districts.js'):
        r = client.get('/' + f)
        assert r.status_code == 200, f
        assert 'javascript' in r.headers['content-type'], f


def test_ai_status():
    r = client.get('/api/ai-status')
    assert r.status_code == 200
    assert set(r.json()) >= {'grok', 'claude'}


@pytest.mark.parametrize('path', ['/groc%20api.txt', '/..%2F..%2Fwindows%2Fwin.ini', '/assets/../../portal_db.py/x', '/no-such-file.js'])
def test_secrets_and_outside_files_are_not_served(path):
    assert client.get(path).status_code == 404
