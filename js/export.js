/*
 * Export : compose une fiche A4 (carte du tracé + terrains du Conservatoire + détail de la redevance)
 * sur un canvas, puis la propose en image PNG ou en PDF. Aucune bibliothèque externe.
 */
(function (global) {
  'use strict';

  var ECH = 2;                 // facteur de netteté (2 = ~190 dpi sur un A4)
  var LARG = 794, HAUT = 1123; // A4 à 96 dpi, en « pixels de mise en page »
  var MARGE = 44;
  var SANS = '"Source Sans 3", "Segoe UI", Arial, sans-serif';
  var SERIF = '"Source Serif 4", Georgia, serif';
  var ENCRE = '#10283A', ENCRE2 = '#4A6172', MER = '#0B5C8A', FILET = '#D3DDE3';

  /* ----------------------------------------------------- Projection (Web Mercator) */
  function mondeX(lon, z) { return (lon + 180) / 360 * 256 * Math.pow(2, z); }
  function mondeY(lat, z) {
    var s = Math.sin(lat * Math.PI / 180);
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * Math.pow(2, z);
  }
  function lonDe(x, z) { return x / (256 * Math.pow(2, z)) * 360 - 180; }
  function latDe(y, z) {
    var n = Math.PI - 2 * Math.PI * y / (256 * Math.pow(2, z));
    return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  }

  function chargerTuile(url) {
    return new Promise(function (resolve) {
      var img = new Image(), fini = false;
      function fin(v) { if (!fini) { fini = true; clearTimeout(minuterie); resolve(v); } }
      var minuterie = setTimeout(function () { fin(null); }, 12000);
      img.crossOrigin = 'anonymous';
      img.onload = function () { fin(img); };
      img.onerror = function () { fin(null); };
      img.src = url;
    });
  }

  /**
   * Dessine la carte (fond IGN, terrains, tracé) dans un canvas de L × H pixels réels.
   * @returns {Promise<{canvas:HTMLCanvasElement, tuilesManquantes:number, tuiles:number}>}
   */
  function dessinerCarte(L, H, etat) {
    var cfg = global.CDL_CONFIG, coul = cfg.couleurs;
    var fond = cfg.fonds.filter(function (f) { return f.id === etat.fond; })[0] || cfg.fonds[0];
    var bb = etat.trace.croisement.bbox;
    var canvas = document.createElement('canvas');
    canvas.width = L; canvas.height = H;
    var ctx = canvas.getContext('2d');

    // Zoom « idéal » (fractionnaire) pour que le tracé tienne avec une marge, puis zoom de tuiles le plus proche
    var dx0 = Math.max(mondeX(bb[2], 0) - mondeX(bb[0], 0), 1e-9);
    var dy0 = Math.max(mondeY(bb[1], 0) - mondeY(bb[3], 0), 1e-9);
    var zIdeal = Math.log(Math.min(L * 0.80 / dx0, H * 0.78 / dy0)) / Math.LN2;
    zIdeal = Math.min(zIdeal, 17 + Math.log(ECH) / Math.LN2);
    var z = Math.max(0, Math.min(fond.zoomMax, Math.round(zIdeal)));
    var k = Math.pow(2, zIdeal - z); // agrandissement appliqué aux tuiles
    var cx = (mondeX(bb[0], z) + mondeX(bb[2], z)) / 2, cy = (mondeY(bb[1], z) + mondeY(bb[3], z)) / 2;
    var ox = cx - L / (2 * k), oy = cy - H / (2 * k);
    function px(p) { return [(mondeX(p[0], z) - ox) * k, (mondeY(p[1], z) - oy) * k]; }

    ctx.fillStyle = '#E3ECF0';
    ctx.fillRect(0, 0, L, H);

    var n = Math.pow(2, z), attente = [];
    var tx0 = Math.floor(ox / 256), tx1 = Math.floor((ox + L / k) / 256);
    var ty0 = Math.floor(oy / 256), ty1 = Math.floor((oy + H / k) / 256);
    for (var tx = tx0; tx <= tx1; tx++) {
      for (var ty = ty0; ty <= ty1; ty++) {
        if (ty < 0 || ty >= n) continue;
        (function (tx, ty) {
          var url = fond.url.replace('{cle}', fond.cle || '').replace('{z}', z)
            .replace('{x}', ((tx % n) + n) % n).replace('{y}', ty);
          attente.push(chargerTuile(url).then(function (img) { return { img: img, tx: tx, ty: ty }; }));
        })(tx, ty);
      }
    }

    return Promise.all(attente).then(function (tuiles) {
      var manquantes = 0;
      ctx.imageSmoothingQuality = 'high';
      tuiles.forEach(function (t) {
        if (!t.img) { manquantes++; return; }
        var x0 = Math.round((t.tx * 256 - ox) * k), x1 = Math.round(((t.tx + 1) * 256 - ox) * k);
        var y0 = Math.round((t.ty * 256 - oy) * k), y1 = Math.round(((t.ty + 1) * 256 - oy) * k);
        ctx.drawImage(t.img, x0, y0, x1 - x0, y1 - y0);
      });

      // Terrains du Conservatoire visibles dans le cadre
      var vue = [lonDe(ox, z), latDe(oy + H / k, z), lonDe(ox + L / k, z), latDe(oy, z)];
      ctx.beginPath();
      etat.index.fc.features.forEach(function (f) {
        var b = f.bbox;
        if (b[0] > vue[2] || b[2] < vue[0] || b[1] > vue[3] || b[3] < vue[1]) return;
        var polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
        polys.forEach(function (anneaux) {
          anneaux.forEach(function (an) {
            for (var i = 0; i < an.length; i++) {
              var p = px(an[i]);
              if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
            }
            ctx.closePath();
          });
        });
      });
      ctx.fillStyle = coul.siteFond;
      ctx.fill('evenodd');
      ctx.strokeStyle = coul.siteTrait; ctx.lineWidth = 1.2 * ECH; ctx.lineJoin = 'round';
      ctx.stroke();

      function ligne(points, couleur, epaisseur) {
        ctx.beginPath();
        for (var i = 0; i < points.length; i++) {
          var p = px(points[i]);
          if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
        }
        ctx.strokeStyle = couleur; ctx.lineWidth = epaisseur * ECH; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.stroke();
      }
      etat.trace.segments.forEach(function (s) { ligne(s, 'rgba(255,255,255,0.9)', 5.5); });
      etat.trace.segments.forEach(function (s) { ligne(s, coul.trace, 2.6); });
      etat.trace.croisement.tronconsCdl.forEach(function (s) { ligne(s, coul.traceCdl, 4.2); });

      // Départ et arrivée
      var premier = etat.trace.segments[0], dernier = etat.trace.segments[etat.trace.segments.length - 1];
      function pastille(pt, plein) {
        var p = px(pt);
        ctx.beginPath(); ctx.arc(p[0], p[1], 5.5 * ECH, 0, 2 * Math.PI);
        ctx.fillStyle = plein ? coul.trace : '#FFFFFF'; ctx.fill();
        ctx.strokeStyle = plein ? '#FFFFFF' : coul.trace; ctx.lineWidth = 2 * ECH; ctx.stroke();
      }
      pastille(dernier[dernier.length - 1], true);
      pastille(premier[0], false);

      // Échelle graphique
      var latC = (bb[1] + bb[3]) / 2;
      var mParPx = 156543.03392 * Math.cos(latC * Math.PI / 180) / Math.pow(2, z) / k;
      var pas = [20, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000, 100000];
      var longueur = pas[0];
      for (var i = 0; i < pas.length; i++) { if (pas[i] / mParPx <= 150 * ECH) longueur = pas[i]; }
      var lpx = longueur / mParPx, ex = 14 * ECH, ey = H - 16 * ECH;
      var texte = longueur >= 1000 ? (longueur / 1000) + ' km' : longueur + ' m';
      ctx.font = '600 ' + (11 * ECH) + 'px ' + SANS;
      var lt = ctx.measureText(texte).width;
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.fillRect(ex - 7 * ECH, ey - 16 * ECH, lpx + lt + 22 * ECH, 25 * ECH);
      ctx.strokeStyle = ENCRE; ctx.lineWidth = 1.6 * ECH; ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.moveTo(ex, ey - 6 * ECH); ctx.lineTo(ex, ey); ctx.lineTo(ex + lpx, ey); ctx.lineTo(ex + lpx, ey - 6 * ECH);
      ctx.stroke();
      ctx.fillStyle = ENCRE; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
      ctx.fillText(texte, ex + lpx + 7 * ECH, ey + 1 * ECH);

      // Nord
      var nx = L - 26 * ECH, ny = 30 * ECH;
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.beginPath(); ctx.arc(nx, ny, 17 * ECH, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = ENCRE;
      ctx.beginPath(); ctx.moveTo(nx, ny - 13 * ECH); ctx.lineTo(nx + 5 * ECH, ny - 1 * ECH); ctx.lineTo(nx - 5 * ECH, ny - 1 * ECH); ctx.closePath(); ctx.fill();
      ctx.font = '700 ' + (10 * ECH) + 'px ' + SANS; ctx.textAlign = 'center';
      ctx.fillText('N', nx, ny + 11 * ECH);

      // Sources
      var src = (manquantes < tuiles.length ? 'Fond : ' + cfg.attributionFond + '. ' : '') + cfg.attributionSites;
      ctx.font = '400 ' + (9.5 * ECH) + 'px ' + SANS; ctx.textAlign = 'right';
      var ls = ctx.measureText(src).width;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(L - ls - 14 * ECH, H - 18 * ECH, ls + 14 * ECH, 18 * ECH);
      ctx.fillStyle = ENCRE; ctx.fillText(src, L - 7 * ECH, H - 6 * ECH);
      ctx.textAlign = 'left';

      return { canvas: canvas, tuilesManquantes: manquantes, tuiles: tuiles.length };
    });
  }

  /* -------------------------------------------------------------------- Logo */
  function imageDepuis(src) {
    return new Promise(function (resolve) {
      if (!src) { resolve(null); return; }
      var img = new Image();
      img.onload = function () {
        try { // l'image est-elle utilisable dans un canvas exportable ?
          var essai = document.createElement('canvas');
          essai.width = essai.height = 1;
          var c = essai.getContext('2d');
          c.drawImage(img, 0, 0, 1, 1);
          c.getImageData(0, 0, 1, 1);
          resolve(img);
        } catch (e) { resolve(null); }
      };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }

  function chargerLogo() {
    var cfg = global.CDL_CONFIG;
    if (!cfg.logo || !cfg.logo.fichier) return Promise.resolve(null);
    return imageDepuis(cfg.logo.fichier).then(function (img) {
      return img || imageDepuis(global.CDL_LOGO_SECOURS);
    });
  }

  /* ----------------------------------------------------------- Outils de texte */
  function couper(ctx, texte, largeurMax, lignesMax) {
    var mots = String(texte).split(/\s+/), lignes = [], courante = '';
    mots.forEach(function (m) {
      var essai = courante ? courante + ' ' + m : m;
      if (ctx.measureText(essai).width <= largeurMax || !courante) courante = essai;
      else { lignes.push(courante); courante = m; }
    });
    if (courante) lignes.push(courante);
    if (lignesMax && lignes.length > lignesMax) {
      lignes = lignes.slice(0, lignesMax);
      var d = lignes[lignesMax - 1];
      while (d.length > 1 && ctx.measureText(d + '…').width > largeurMax) d = d.slice(0, -1);
      lignes[lignesMax - 1] = d + '…';
    }
    return lignes.map(function (l) {
      if (ctx.measureText(l).width <= largeurMax) return l;
      while (l.length > 1 && ctx.measureText(l + '…').width > largeurMax) l = l.slice(0, -1);
      return l + '…';
    });
  }

  /**
   * Compose la fiche complète.
   * @param etat { fond, index, trace:{nom, segments, croisement}, params, resultat }
   * @returns {Promise<{canvas, avertissement:string}>}
   */
  function composerFiche(etat) {
    var R = global.CDL.redevance, cfg = global.CDL_CONFIG;
    var polices = (document.fonts && document.fonts.load) ? Promise.all([
      document.fonts.load('400 12px "Source Sans 3"'), document.fonts.load('700 12px "Source Sans 3"'),
      document.fonts.load('italic 600 28px "Source Serif 4"')
    ]).catch(function () {}) : Promise.resolve();

    var carteL = LARG - 2 * MARGE, carteH = 404;
    return polices.then(function () {
      return Promise.all([dessinerCarte(carteL * ECH, carteH * ECH, etat), chargerLogo()]);
    }).then(function (prets) {
      var carte = prets[0], logo = prets[1];
      var c = document.createElement('canvas');
      c.width = LARG * ECH; c.height = HAUT * ECH;
      var ctx = c.getContext('2d');
      ctx.scale(ECH, ECH);
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, LARG, HAUT);
      ctx.textBaseline = 'alphabetic';
      var x0 = MARGE, x1 = LARG - MARGE, y = MARGE;
      var res = etat.resultat, cro = etat.trace.croisement, nom = etat.params.nom || 'Trail sans nom';

      function txt(t, x, yy, police, couleur, aligne) {
        ctx.font = police; ctx.fillStyle = couleur || ENCRE; ctx.textAlign = aligne || 'left';
        ctx.fillText(t, x, yy);
      }
      function filet(yy, xa, xb, couleur, ep) {
        ctx.strokeStyle = couleur || FILET; ctx.lineWidth = ep || 1;
        ctx.beginPath(); ctx.moveTo(xa, yy); ctx.lineTo(xb, yy); ctx.stroke();
      }

      // En-tête
      var date = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
      if (logo) {
        var hl = 44, ll = hl * logo.naturalWidth / logo.naturalHeight;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(logo, x0, y, ll, hl);
        txt('Proposition de redevance pour une manifestation sportive', x1, y + 19, '600 12.5px ' + SANS, ENCRE, 'right');
        txt('Simulation du ' + date, x1, y + 37, '400 12.5px ' + SANS, ENCRE2, 'right');
        filet(y + hl + 14, x0, x1, ENCRE, 1);
        y += hl + 20;
      } else {
        y += 10;
        txt('Proposition de redevance pour une manifestation sportive', x0, y, '600 12.5px ' + SANS, ENCRE2);
        txt('Simulation du ' + date, x1, y, '400 12.5px ' + SANS, ENCRE2, 'right');
      }
      ctx.font = 'italic 600 30px ' + SERIF;
      var titres = couper(ctx, nom, x1 - x0, 2);
      titres.forEach(function (l) { y += 34; txt(l, x0, y, 'italic 600 30px ' + SERIF, MER); });
      y += 20;
      txt('Terrains du Conservatoire du littoral traversés par le tracé', x0, y, '400 13px ' + SANS, ENCRE);

      // Carte
      y += 14;
      ctx.drawImage(carte.canvas, x0, y, carteL, carteH);
      ctx.strokeStyle = ENCRE; ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, y + 0.5, carteL - 1, carteH - 1);
      y += carteH;

      // Légende
      y += 20;
      var lx = x0;
      ctx.fillStyle = cfg.couleurs.siteFond; ctx.fillRect(lx, y - 10, 20, 12);
      ctx.strokeStyle = cfg.couleurs.siteTrait; ctx.lineWidth = 1.2; ctx.strokeRect(lx, y - 10, 20, 12);
      txt('Terrains du Conservatoire', lx + 27, y, '400 12px ' + SANS); lx += 27 + ctx.measureText('Terrains du Conservatoire').width + 22;
      filet(y - 4, lx, lx + 22, cfg.couleurs.traceCdl, 4);
      txt('Tracé sur les terrains', lx + 29, y, '400 12px ' + SANS); lx += 29 + ctx.measureText('Tracé sur les terrains').width + 22;
      filet(y - 4, lx, lx + 22, cfg.couleurs.trace, 2.6);
      txt('Tracé hors terrains', lx + 29, y, '400 12px ' + SANS); lx += 29 + ctx.measureText('Tracé hors terrains').width + 22;
      ctx.beginPath(); ctx.arc(lx + 5, y - 4, 4.5, 0, 2 * Math.PI); ctx.fillStyle = '#FFFFFF'; ctx.fill();
      ctx.strokeStyle = ENCRE; ctx.lineWidth = 1.6; ctx.stroke();
      txt('Départ', lx + 15, y, '400 12px ' + SANS); lx += 15 + ctx.measureText('Départ').width + 16;
      ctx.beginPath(); ctx.arc(lx + 5, y - 4, 5, 0, 2 * Math.PI); ctx.fillStyle = ENCRE; ctx.fill();
      txt('Arrivée', lx + 15, y, '400 12px ' + SANS);

      // Bandeau du montant
      y += 18;
      var bh = 70;
      ctx.fillStyle = ENCRE; ctx.fillRect(x0, y, x1 - x0, bh);
      txt('Redevance proposée', x0 + 20, y + 30, '600 16px ' + SANS, '#FFFFFF');
      txt(res.jours > 1 ? 'pour ' + res.jours + ' jours de manifestation' : 'pour 1 jour de manifestation',
        x0 + 20, y + 50, '400 12.5px ' + SANS, '#B9CBD6');
      txt(R.euros(res.total), x1 - 20, y + 47, '700 36px ' + SANS, '#FFFFFF', 'right');
      y += bh;

      // Deux colonnes : tracé | détail du calcul
      y += 32;
      var colG = x0, colGL = 262, colD = x0 + 296, yHaut = y;

      txt('Tracé', colG, y, '700 14px ' + SANS);
      filet(y + 8, colG, colG + colGL, ENCRE, 1);
      var yg = y + 28;
      function mesure(lib, val, fort) {
        txt(lib, colG, yg, (fort ? '600' : '400') + ' 12.5px ' + SANS, fort ? ENCRE : ENCRE2);
        txt(val, colG + colGL, yg, '600 12.5px ' + SANS, fort ? cfg.couleurs.traceCdl : ENCRE, 'right');
        filet(yg + 8, colG, colG + colGL);
        yg += 24;
      }
      mesure('Longueur totale', R.distance(cro.longueurTotale));
      mesure('Sur les terrains du Conservatoire', R.nombre(cro.longueurCdl) + ' m', true);
      if (etat.params.lineaire !== Math.round(cro.longueurCdl)) {
        mesure('Linéaire retenu pour le calcul', R.nombre(etat.params.lineaire) + ' m');
      }
      yg += 6;
      txt(cro.sites.length > 1 ? 'Sites traversés' : cro.sites.length === 1 ? 'Site traversé' : 'Aucun site traversé',
        colG, yg, '600 12.5px ' + SANS);
      yg += 6;
      var maxSites = 6;
      cro.sites.slice(0, maxSites).forEach(function (s) {
        yg += 19;
        var m = R.nombre(s.metres) + ' m';
        ctx.font = '400 12px ' + SANS;
        var lm = ctx.measureText(m).width;
        ctx.font = 'italic 400 13.5px ' + SERIF;
        var lignesNom = couper(ctx, s.nom, colGL - lm - 14, 2);
        txt(lignesNom[0], colG, yg, 'italic 400 13.5px ' + SERIF, MER);
        txt(m, colG + colGL, yg, '400 12px ' + SANS, ENCRE, 'right');
        if (lignesNom[1]) { yg += 16; txt(lignesNom[1], colG, yg, 'italic 400 13.5px ' + SERIF, MER); }
      });
      if (cro.sites.length > maxSites) {
        yg += 19;
        txt('et ' + (cro.sites.length - maxSites) + ' autre' + (cro.sites.length - maxSites > 1 ? 's' : ''), colG, yg, '400 12px ' + SANS, ENCRE2);
      }

      // Détail du calcul
      var cQ = colD + 196, cC = colD + 300, cM = x1;
      txt('Détail du calcul', colD, y, '700 14px ' + SANS);
      txt('Quantité', cQ, y, '400 11.5px ' + SANS, ENCRE2, 'right');
      txt('Coût unitaire', cC, y, '400 11.5px ' + SANS, ENCRE2, 'right');
      txt('Montant', cM, y, '400 11.5px ' + SANS, ENCRE2, 'right');
      filet(y + 8, colD, x1, ENCRE, 1);
      var yd = y + 27;
      ['participants', 'lineaire', 'emprise', 'vehicules'].forEach(function (cle) {
        var p = res.parts[cle];
        txt(p.titre, colD, yd, '600 12.5px ' + SANS);
        txt(p.palier ? 'palier ' + p.palier.libelle : 'aucun', colD, yd + 14, '400 11px ' + SANS, ENCRE2);
        txt(R.nombre(p.quantite), cQ, yd, '400 12.5px ' + SANS, ENCRE, 'right');
        txt(R.coutUnitaire(p.cout), cC, yd, '400 12.5px ' + SANS, ENCRE, 'right');
        txt(R.euros(p.montant), cM, yd, '400 12.5px ' + SANS, ENCRE, 'right');
        filet(yd + 22, colD, x1);
        yd += 38;
      });
      yd -= 4;
      txt('Sous-total par jour', colD, yd, '400 12.5px ' + SANS);
      txt(R.euros(res.sousTotalJour), cM, yd, '400 12.5px ' + SANS, ENCRE, 'right');
      filet(yd + 9, colD, x1); yd += 26;
      txt('Nombre de jours', colD, yd, '400 12.5px ' + SANS);
      txt('× ' + res.jours, cM, yd, '400 12.5px ' + SANS, ENCRE, 'right');
      filet(yd + 9, colD, x1, ENCRE, 1); yd += 27;
      txt('Redevance proposée', colD, yd, '700 13.5px ' + SANS);
      txt(R.euros(res.total), cM, yd, '700 13.5px ' + SANS, ENCRE, 'right');

      // Mode de calcul
      y = Math.max(yg, yd) + 34;
      y = Math.max(y, yHaut + 250);
      ctx.font = '400 11.5px ' + SANS;
      var explication = 'Mode de calcul : redevance = nombre de jours × (part participants + part linéaire + part emprise + part véhicules). ' +
        'Chaque part est la quantité multipliée par le coût unitaire du palier atteint. ' +
        'Le linéaire est la longueur du tracé située à l\'intérieur des terrains du Conservatoire, mesurée sur le fichier GPX fourni.';
      couper(ctx, explication, x1 - x0).forEach(function (l) { txt(l, x0, y, '400 11.5px ' + SANS, ENCRE2); y += 15; });

      // Pied de page
      var yp = HAUT - MARGE;
      filet(yp - 30, x0, x1);
      txt('Simulation indicative, sans valeur contractuelle. Barème : ' + cfg.versionBareme + '.', x0, yp - 13, '400 10.5px ' + SANS, ENCRE2);
      txt('Périmètres des sites : ' + (etat.index.fc.meta ? etat.index.fc.meta.source + ', extraction du ' + dateFr(etat.index.fc.meta.extraction) : 'Conservatoire du littoral') + '.',
        x0, yp, '400 10.5px ' + SANS, ENCRE2);

      var avertissement = '';
      if (carte.tuiles && carte.tuilesManquantes === carte.tuiles) avertissement = 'Le fond de carte n\'a pas pu être chargé : la fiche montre le tracé et les terrains sans fond.';
      else if (carte.tuilesManquantes) avertissement = 'Une partie du fond de carte n\'a pas pu être chargée.';
      return { canvas: c, avertissement: avertissement };
    });
  }

  function dateFr(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? m[3] + '/' + m[2] + '/' + m[1] : (iso || '');
  }

  /* ------------------------------------------------------------ Téléchargements */
  function nomFichier(nom, ext) {
    var base = String(nom || 'trail').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'trail';
    return 'redevance-' + base + '.' + ext;
  }

  function telecharger(blob, fichier) {
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = fichier;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function enBlob(canvas, type, qualite) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error('Image impossible à produire.')); }, type, qualite);
    });
  }

  function png(canvas, nom) {
    var f = nomFichier(nom, 'png');
    return enBlob(canvas, 'image/png').then(function (b) { telecharger(b, f); return f; });
  }

  /** PDF d'une page A4 contenant la fiche (image JPEG). */
  function pdf(canvas, nom) {
    var f = nomFichier(nom, 'pdf');
    return enBlob(canvas, 'image/jpeg', 0.93).then(function (b) { return b.arrayBuffer(); }).then(function (buf) {
      var octets = construirePdf(new Uint8Array(buf), canvas.width, canvas.height, 'Redevance – ' + (nom || 'trail'));
      telecharger(new Blob([octets], { type: 'application/pdf' }), f);
      return f;
    });
  }

  function hexUtf16(s) {
    var h = 'FEFF';
    for (var i = 0; i < s.length; i++) h += ('000' + s.charCodeAt(i).toString(16)).slice(-4).toUpperCase();
    return '<' + h + '>';
  }

  function construirePdf(jpeg, largeurPx, hauteurPx, titre) {
    var enc = new TextEncoder(), morceaux = [], pos = 0, decalages = [];
    function ajouter(x) { var o = typeof x === 'string' ? enc.encode(x) : x; morceaux.push(o); pos += o.length; }
    function objet(n, corps, flux) {
      decalages[n] = pos;
      ajouter(n + ' 0 obj\n' + corps);
      if (flux !== undefined) { ajouter('\nstream\n'); ajouter(flux); ajouter('\nendstream'); }
      ajouter('\nendobj\n');
    }
    var W = 595.28, H = 841.89;
    ajouter('%PDF-1.4\n');
    ajouter(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));
    objet(1, '<< /Type /Catalog /Pages 2 0 R >>');
    objet(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    objet(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>');
    objet(4, '<< /Type /XObject /Subtype /Image /Width ' + largeurPx + ' /Height ' + hauteurPx +
      ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.length + ' >>', jpeg);
    var contenu = 'q ' + W + ' 0 0 ' + H + ' 0 0 cm /Im0 Do Q';
    objet(5, '<< /Length ' + contenu.length + ' >>', contenu);
    objet(6, '<< /Title ' + hexUtf16(titre) + ' /Creator ' + hexUtf16('Redevance trail') + ' >>');
    var debutXref = pos, table = 'xref\n0 7\n0000000000 65535 f \n';
    for (var i = 1; i <= 6; i++) table += ('0000000000' + decalages[i]).slice(-10) + ' 00000 n \n';
    ajouter(table);
    ajouter('trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n' + debutXref + '\n%%EOF\n');
    var sortie = new Uint8Array(pos), o = 0;
    morceaux.forEach(function (m) { sortie.set(m, o); o += m.length; });
    return sortie;
  }

  global.CDL = global.CDL || {};
  global.CDL.exporter = { composerFiche: composerFiche, png: png, pdf: pdf, nomFichier: nomFichier };
})(window);
