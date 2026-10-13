"""Build UI prototypes A and B from the classic portal design.

    python prototypes/build_prototypes.py

The Immersive Map design (formerly prototype C) is now the main portal, "Pak Climate.html". The previous design is kept as
"Pak Climate - Classic.html" and is the base for A and B (it is only read, never changed). Each prototype is that page (same data, buttons,
AI, forecasts, 3D) with its own style sheet from this folder, plus a few small text swaps listed below. Re-run this
after changing the classic page so the prototypes pick up the change.
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'Pak Climate - Classic.html')

PROTOTYPES = {
    'A': {'file': 'Prototype A - Command Center.html', 'name': 'Command Center',
          'head': ['<link rel="stylesheet" href="prototypes/protoA.css">'], 'after_chartjs': [], 'swaps': []},
    'B': {'file': 'Prototype B - Clean Light.html', 'name': 'Clean Light',
          'head': ['<link rel="stylesheet" href="prototypes/protoB.css">'],
          'after_chartjs': ['<script src="prototypes/protoB.js"></script>'],
          'swaps': [('mapbox/dark-v11', 'mapbox/light-v11'),                                   # light basemap (both maps)
                    ("ctx.strokeStyle='rgba(255,255,255,.85)'", "ctx.strokeStyle='rgba(15,23,42,.65)'"),  # wind lines visible on light map
                    ("{color:'#94a3b8',weight:.7,opacity:.4,fill:false,className:'cty'}", "{color:'#64748b',weight:.7,opacity:.5,fill:false,className:'cty'}"),
                    ("winter:'#cbd5e1'", "winter:'#64748b'")]},  # Winter trend line readable on white
}


def build():
    with open(SRC, encoding='utf-8') as f:
        original = f.read()
    for key, p in PROTOTYPES.items():
        html = original
        for old, new in p['swaps']:
            if old not in html:
                raise SystemExit(f'Prototype {key}: text to swap not found in the original: {old!r}')
            html = html.replace(old, new)
        chart = '<script src="lib/chart.umd.js"></script>'
        if p['after_chartjs']:
            html = html.replace(chart, chart + '\n' + '\n'.join(p['after_chartjs']), 1)
        html = html.replace('</head>', '\n'.join(p['head']) + '\n</head>', 1)
        html = html.replace('<title>Pakistan Climate Driver Intelligence Dashboard</title>',
                            f'<title>Pakistan Climate Driver Intelligence · Prototype {key} ({p["name"]})</title>', 1)
        html = html.replace('<body>', f'<body class="proto-{key.lower()}">', 1)
        with open(os.path.join(ROOT, p['file']), 'w', encoding='utf-8') as f:
            f.write(html)
        print(f'built {p["file"]}')


if __name__ == '__main__':
    build()
