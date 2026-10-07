"""Prépare la couche des sites du Conservatoire du littoral pour le site web.
Entrée : GeoJSON brut (EPSG:4326) exporté du flux WFS IGN  patrinat_cdl:conservatoire_littoral
Sortie : data/sites_cdl.js  (window.CDL_SITES = FeatureCollection allégée)
Usage  : python prep_sites.py brut.geojson sortie.js [tolerance_m] [decimales]
"""
import json, math, sys, datetime
from shapely.geometry import shape, mapping, MultiPolygon, Polygon
from shapely.validation import make_valid
from shapely import set_precision

src, dst = sys.argv[1], sys.argv[2]
tol_m = float(sys.argv[3]) if len(sys.argv) > 3 else 1.5
dec = int(sys.argv[4]) if len(sys.argv) > 4 else 6

TERRITOIRES = [  # (nom, lon_min, lat_min, lon_max, lat_max)
    ('Mayotte', 44.9, -13.1, 45.4, -12.5), ('La Réunion', 55.1, -21.5, 55.9, -20.8),
    ('Guadeloupe', -61.9, 15.8, -60.9, 16.6), ('Martinique', -61.3, 14.3, -60.7, 14.95),
    ('Saint-Martin / Saint-Barthélemy', -63.2, 17.8, -62.7, 18.2), ('Guyane', -54.7, 2.0, -51.5, 6.0),
    ('Saint-Pierre-et-Miquelon', -56.6, 46.7, -56.0, 47.2), ('Corse', 8.4, 41.3, 9.7, 43.1),
]

PARTICULES = {'De', 'Du', 'Des', 'La', 'Le', 'Les', 'Et', 'En', 'Sur', 'Sous', 'Aux', 'Au', 'A'}
def nom_propre(n):
    """'Baie De Boueni' -> 'Baie de Boueni' (les particules repassent en minuscules, sauf en tête)."""
    mots = (n or '').strip().split(' ')
    return ' '.join(m.lower() if i > 0 and m in PARTICULES else m for i, m in enumerate(mots))

def polys_of(g):
    if g.is_empty: return []
    if g.geom_type == 'Polygon': return [g]
    if g.geom_type in ('MultiPolygon', 'GeometryCollection'):
        out = []
        for x in g.geoms: out += polys_of(x)
        return out
    return []

def area_m2(poly, lat0):
    k = math.cos(math.radians(lat0))
    return poly.area * (111320.0 ** 2) * k

d = json.load(open(src, encoding='utf-8'))
feats, n_in, n_out = [], 0, 0
for f in d['features']:
    g = shape(f['geometry'])
    ps = polys_of(g)
    if not ps: continue
    mp = MultiPolygon(ps)
    if not mp.is_valid: mp = MultiPolygon(polys_of(make_valid(mp)))
    n_in += sum(len(p.exterior.coords) + sum(len(i.coords) for i in p.interiors) for p in mp.geoms)
    lat0 = mp.centroid.y
    tol = tol_m / 111320.0
    s = mp.simplify(tol, preserve_topology=True)
    try:
        s = set_precision(make_valid(s), 10 ** -dec)
    except Exception:
        pass
    ps = [p for p in polys_of(make_valid(s)) if not p.is_empty]
    if not ps: ps = polys_of(mp)
    s = MultiPolygon(ps)
    n_out += sum(len(p.exterior.coords) + sum(len(i.coords) for i in p.interiors) for p in s.geoms)
    c = s.representative_point()
    terr = 'Hexagone'
    for nom, x0, y0, x1, y1 in TERRITOIRES:
        if x0 <= c.x <= x1 and y0 <= c.y <= y1: terr = nom
    p = f['properties']
    b = s.bounds
    feats.append({'type': 'Feature',
        'properties': {'id': p.get('id_local'), 'nom': nom_propre(p.get('nom_site')), 'terr': terr,
                       'ha': round(area_m2(mp, lat0) / 10000.0, 1), 'inpn': p.get('id_mnhn'),
                       'c': [round(c.x, 5), round(c.y, 5)]},
        'bbox': [round(v, dec) for v in b],
        'geometry': mapping(s)})

feats.sort(key=lambda f: f['properties']['nom'].lower())
fc = {'type': 'FeatureCollection',
      'meta': {'source': 'Flux WFS IGN Géoplateforme — patrinat_cdl:conservatoire_littoral (PatriNat / Conservatoire du littoral)',
               'extraction': datetime.date.today().isoformat(), 'tolerance_m': tol_m, 'nb_sites': len(feats)},
      'features': feats}

def rnd(o):
    if isinstance(o, float): return round(o, dec)
    if isinstance(o, (list, tuple)): return [rnd(x) for x in o]
    if isinstance(o, dict): return {k: rnd(v) for k, v in o.items()}
    return o
txt = json.dumps(rnd(fc), ensure_ascii=False, separators=(',', ':'))
open(dst, 'w', encoding='utf-8').write('/* Sites du Conservatoire du littoral — fichier généré, ne pas modifier à la main */\nwindow.CDL_SITES=' + txt + ';\n')
print('sites', len(feats), 'sommets', n_in, '->', n_out, 'taille', round(len(txt.encode()) / 1e6, 2), 'Mo')
import collections
print(collections.Counter(f['properties']['terr'] for f in feats))
print('total ha', round(sum(f['properties']['ha'] for f in feats)))
