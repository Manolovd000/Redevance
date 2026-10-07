/*
 * Géométrie : lecture d'un GPX et croisement du tracé avec les terrains du Conservatoire.
 * Aucune dépendance : fonctionne dans le navigateur comme sous Node (pour les tests).
 */
(function (global) {
  'use strict';

  var R = 6371008.8; // rayon terrestre moyen (m)
  var RAD = Math.PI / 180;
  var BLOC = 48;     // taille des blocs d'arêtes pour accélérer les croisements

  /** Distance sur la sphère entre deux points [lon, lat], en mètres. */
  function distance(a, b) {
    var dLat = (b[1] - a[1]) * RAD, dLon = (b[0] - a[0]) * RAD;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  /* ------------------------------------------------------------------ GPX */

  /**
   * Lit un GPX (traces <trk>, à défaut itinéraires <rte>).
   * @returns {{nom:string, segments:number[][][]}} segments = listes de points [lon, lat]
   */
  function lireGPX(texte) {
    var doc = new DOMParser().parseFromString(texte, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) {
      throw new Error('Le fichier n\'est pas un GPX lisible (XML invalide).');
    }
    function points(parent, balise) {
      var out = [], els = parent.getElementsByTagNameNS('*', balise);
      for (var i = 0; i < els.length; i++) {
        var lat = parseFloat(els[i].getAttribute('lat')), lon = parseFloat(els[i].getAttribute('lon'));
        if (isFinite(lat) && isFinite(lon)) out.push([lon, lat]);
      }
      return out;
    }
    var segments = [];
    var segs = doc.getElementsByTagNameNS('*', 'trkseg');
    for (var i = 0; i < segs.length; i++) {
      var p = points(segs[i], 'trkpt');
      if (p.length > 1) segments.push(p);
    }
    if (!segments.length) {
      var rtes = doc.getElementsByTagNameNS('*', 'rte');
      for (var j = 0; j < rtes.length; j++) {
        var r = points(rtes[j], 'rtept');
        if (r.length > 1) segments.push(r);
      }
    }
    if (!segments.length) {
      throw new Error('Aucun tracé dans ce fichier : il faut une trace (trk) ou un itinéraire (rte) d\'au moins deux points.');
    }
    var nom = '';
    var cherche = ['trk', 'rte', 'metadata'];
    for (var k = 0; k < cherche.length && !nom; k++) {
      var bloc = doc.getElementsByTagNameNS('*', cherche[k])[0];
      if (!bloc) continue;
      for (var c = bloc.firstElementChild; c; c = c.nextElementSibling) {
        if (c.localName === 'name' && c.textContent.trim()) { nom = c.textContent.trim(); break; }
      }
    }
    return { nom: nom, segments: segments };
  }

  /* ---------------------------------------------------------------- Index */

  function blocsDe(anneau) {
    var blocs = [];
    for (var i = 0; i < anneau.length - 1; i += BLOC) {
      var fin = Math.min(i + BLOC, anneau.length - 1);
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (var j = i; j <= fin; j++) {
        var p = anneau[j];
        if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
        if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
      }
      blocs.push([i, fin, x0, y0, x1, y1]);
    }
    return blocs;
  }

  /**
   * Prépare les sites pour les croisements : une entrée par polygone, avec son emprise.
   * @param {object} fc FeatureCollection (Polygon / MultiPolygon, EPSG:4326)
   */
  function indexerSites(fc) {
    var polys = [];
    fc.features.forEach(function (f, numSite) {
      var g = f.geometry;
      if (!g) return;
      var liste = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      liste.forEach(function (anneaux) {
        var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        var ext = anneaux[0];
        for (var i = 0; i < ext.length; i++) {
          if (ext[i][0] < x0) x0 = ext[i][0]; if (ext[i][0] > x1) x1 = ext[i][0];
          if (ext[i][1] < y0) y0 = ext[i][1]; if (ext[i][1] > y1) y1 = ext[i][1];
        }
        polys.push({ site: numSite, anneaux: anneaux, bbox: [x0, y0, x1, y1], blocs: null });
      });
    });
    return { fc: fc, polys: polys };
  }

  function blocsDuPoly(poly) {
    if (!poly.blocs) poly.blocs = poly.anneaux.map(blocsDe);
    return poly.blocs;
  }

  /** Point dans un polygone (règle pair-impair sur tous les anneaux : les trous sont exclus). */
  function dansPoly(x, y, poly) {
    var b = poly.bbox;
    if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) return false;
    var dedans = false, blocs = blocsDuPoly(poly);
    for (var a = 0; a < poly.anneaux.length; a++) {
      var an = poly.anneaux[a], bl = blocs[a];
      for (var k = 0; k < bl.length; k++) {
        var B = bl[k];
        if (y < B[3] || y > B[5] || x > B[4]) continue;
        for (var i = B[0]; i < B[1]; i++) {
          var p = an[i], q = an[i + 1];
          if ((p[1] > y) !== (q[1] > y) && x < (q[0] - p[0]) * (y - p[1]) / (q[1] - p[1]) + p[0]) dedans = !dedans;
        }
      }
    }
    return dedans;
  }

  /** Paramètres t (0..1) où le segment a→b coupe le contour du polygone. */
  function coupes(a, b, poly, out) {
    var sx0 = Math.min(a[0], b[0]), sx1 = Math.max(a[0], b[0]);
    var sy0 = Math.min(a[1], b[1]), sy1 = Math.max(a[1], b[1]);
    var rx = b[0] - a[0], ry = b[1] - a[1];
    var blocs = blocsDuPoly(poly);
    for (var n = 0; n < poly.anneaux.length; n++) {
      var an = poly.anneaux[n], bl = blocs[n];
      for (var k = 0; k < bl.length; k++) {
        var B = bl[k];
        if (B[2] > sx1 || B[4] < sx0 || B[3] > sy1 || B[5] < sy0) continue;
        for (var i = B[0]; i < B[1]; i++) {
          var c = an[i], d = an[i + 1];
          var qx = d[0] - c[0], qy = d[1] - c[1];
          var den = rx * qy - ry * qx;
          if (den === 0) continue; // parallèles
          var t = ((c[0] - a[0]) * qy - (c[1] - a[1]) * qx) / den;
          var u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
          if (t > 0 && t < 1 && u >= 0 && u <= 1) out.push(t);
        }
      }
    }
  }

  function emprise(segments) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    segments.forEach(function (s) {
      s.forEach(function (p) {
        if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
        if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
      });
    });
    return [x0, y0, x1, y1];
  }

  /**
   * Croise le tracé avec les sites.
   * @returns {{
   *   longueurTotale:number, longueurCdl:number, bbox:number[],
   *   sites:{index:number, nom:string, metres:number}[],
   *   tronconsCdl:number[][][]   // portions du tracé situées sur les terrains
   * }}
   */
  function croiser(segments, index) {
    var bb = emprise(segments);
    var candidats = index.polys.filter(function (p) {
      return !(p.bbox[0] > bb[2] || p.bbox[2] < bb[0] || p.bbox[1] > bb[3] || p.bbox[3] < bb[1]);
    });
    var total = 0, cdl = 0, parSite = {}, troncons = [];
    segments.forEach(function (seg) {
      var courant = null; // tronçon « sur terrain » en cours de construction
      for (var i = 0; i < seg.length - 1; i++) {
        var a = seg[i], b = seg[i + 1];
        if (a[0] === b[0] && a[1] === b[1]) continue;
        var L = distance(a, b);
        total += L;
        var sx0 = Math.min(a[0], b[0]), sx1 = Math.max(a[0], b[0]);
        var sy0 = Math.min(a[1], b[1]), sy1 = Math.max(a[1], b[1]);
        var proches = [];
        for (var c = 0; c < candidats.length; c++) {
          var pb = candidats[c].bbox;
          if (!(pb[0] > sx1 || pb[2] < sx0 || pb[1] > sy1 || pb[3] < sy0)) proches.push(candidats[c]);
        }
        if (!proches.length) { courant = null; continue; }
        var ts = [0, 1];
        for (var k = 0; k < proches.length; k++) coupes(a, b, proches[k], ts);
        ts.sort(function (x, y) { return x - y; });
        for (var j = 0; j < ts.length - 1; j++) {
          var t0 = ts[j], t1 = ts[j + 1];
          if (t1 - t0 < 1e-12) continue;
          var tm = (t0 + t1) / 2;
          var mx = a[0] + (b[0] - a[0]) * tm, my = a[1] + (b[1] - a[1]) * tm;
          var site = -1;
          for (var m = 0; m < proches.length; m++) {
            if (dansPoly(mx, my, proches[m])) { site = proches[m].site; break; }
          }
          if (site < 0) { courant = null; continue; }
          var d = L * (t1 - t0);
          cdl += d;
          parSite[site] = (parSite[site] || 0) + d;
          var p0 = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
          var p1 = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
          if (!courant) { courant = [p0]; troncons.push(courant); }
          courant.push(p1);
        }
        // si le segment se termine hors terrain, le tronçon est déjà clos (courant = null)
      }
    });
    var sites = Object.keys(parSite).map(function (i) {
      var f = index.fc.features[i];
      return { index: Number(i), nom: f.properties.nom, terr: f.properties.terr, metres: parSite[i] };
    }).sort(function (x, y) { return y.metres - x.metres; });
    return { longueurTotale: total, longueurCdl: cdl, bbox: bb, sites: sites, tronconsCdl: troncons };
  }

  global.CDL = global.CDL || {};
  global.CDL.geo = { distance: distance, lireGPX: lireGPX, indexerSites: indexerSites, croiser: croiser, emprise: emprise };
})(typeof window !== 'undefined' ? window : globalThis);
