/*
 * Interface : carte, recherche de site, import du GPX, fenêtre de paramètres, redevance, exports.
 */
(function () {
  'use strict';

  var cfg = window.CDL_CONFIG, geo = window.CDL.geo, R = window.CDL.redevance, exporter = window.CDL.exporter;
  var $ = function (id) { return document.getElementById(id); };

  var etat = {
    fond: cfg.fondParDefaut,
    index: null,          // sites indexés pour les croisements
    trace: null,          // { nom, segments, croisement }
    params: null,         // { nom, jours, participants, lineaire, emprise, vehicules }
    resultat: null
  };
  window.CDL.etat = etat; // pratique pour le débogage

  /* ================================================================ Carte */
  var carte = L.map('carte', { preferCanvas: true, zoomControl: false, worldCopyJump: true });
  L.control.zoom({ position: 'topright', zoomInTitle: 'Zoomer', zoomOutTitle: 'Dézoomer' }).addTo(carte);
  L.control.scale({ imperial: false, position: 'bottomright' }).addTo(carte);
  carte.attributionControl.setPrefix(false);

  var fonds = {}, idDuFond = {};
  cfg.fonds.forEach(function (f) {
    var couche = L.tileLayer(f.url.replace('{cle}', f.cle || ''), {
      maxNativeZoom: f.zoomMax, maxZoom: 19, attribution: cfg.attributionFond
    });
    fonds[f.nom] = couche; idDuFond[f.nom] = f.id;
    if (f.id === etat.fond) couche.addTo(carte);
  });
  L.control.layers(fonds, null, { position: 'topright', collapsed: false }).addTo(carte);
  carte.on('baselayerchange', function (e) { etat.fond = idDuFond[e.name] || etat.fond; });

  var legende = L.control({ position: 'bottomleft' });
  legende.onAdd = function () {
    var d = L.DomUtil.create('div', 'legende');
    d.innerHTML = '<div><i class="l-site"></i>Terrains du Conservatoire</div>' +
      '<div class="l-si-trace" hidden><i class="l-cdl"></i>Tracé sur les terrains</div>' +
      '<div class="l-si-trace" hidden><i class="l-trace"></i>Tracé hors terrains</div>';
    return d;
  };
  legende.addTo(carte);

  function versBounds(b) { return L.latLngBounds([b[1], b[0]], [b[3], b[2]]); }
  carte.fitBounds(versBounds(cfg.territoires[0].bbox));

  var coucheSites = null, coucheChoix = L.layerGroup().addTo(carte), coucheTrace = L.layerGroup().addTo(carte);

  function bulleSite(f) {
    var p = f.properties, d = document.createElement('div');
    var n = document.createElement('p'); n.className = 'bulle-nom'; n.textContent = p.nom; d.appendChild(n);
    var i = document.createElement('p'); i.className = 'bulle-info';
    i.textContent = p.terr + (p.ha ? ' · environ ' + R.nombre(p.ha) + ' ha' : '');
    d.appendChild(i);
    if (p.inpn) {
      var l = document.createElement('p'); l.className = 'bulle-info';
      var a = document.createElement('a');
      a.href = 'https://inpn.mnhn.fr/espace/protege/' + encodeURIComponent(p.inpn);
      a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Fiche du site sur l\'INPN';
      l.appendChild(a); d.appendChild(l);
    }
    return d;
  }

  function montrerSite(f, ouvrirBulle) {
    coucheChoix.clearLayers();
    L.geoJSON(f, { interactive: false, style: { color: cfg.couleurs.siteChoisi, weight: 4, fill: false } }).addTo(coucheChoix);
    carte.fitBounds(versBounds(f.bbox), { padding: [60, 60], maxZoom: 16 });
    if (ouvrirBulle) L.popup().setLatLng([f.properties.c[1], f.properties.c[0]]).setContent(bulleSite(f)).openOn(carte);
  }

  /* ============================================================ Sites */
  var sitesRecherche = [];

  function sansAccent(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, ' '); }

  function sitesCharges() {
    var fc = window.CDL_SITES;
    etat.index = geo.indexerSites(fc);
    coucheSites = L.geoJSON(fc, {
      style: { color: cfg.couleurs.siteTrait, weight: 1.2, fillColor: '#2E86DE', fillOpacity: 0.30 }
    }).addTo(carte);
    coucheSites.on('click', function (e) {
      L.popup().setLatLng(e.latlng).setContent(bulleSite(e.layer.feature)).openOn(carte);
    });
    coucheTrace.eachLayer(function (l) { if (l.bringToFront) l.bringToFront(); });
    sitesRecherche = fc.features.map(function (f) { return { f: f, cle: sansAccent(f.properties.nom + ' ' + f.properties.terr) }; });
    $('recherche').disabled = false; $('btn-gpx').disabled = false; $('btn-exemple').disabled = false;
    var m = fc.meta || {};
    $('etat-sites').textContent = R.nombre(fc.features.length) + ' sites sur la carte. Cliquer sur un site pour afficher son nom.';
    $('pied-donnees').textContent = 'Périmètres : ' + (m.source || 'Conservatoire du littoral') +
      (m.extraction ? ', extraction du ' + m.extraction.split('-').reverse().join('/') : '') + '.';
  }

  (function chargerSites() {
    var s = document.createElement('script');
    s.src = 'data/sites_cdl.js';
    s.onload = function () { setTimeout(sitesCharges, 0); };
    s.onerror = function () {
      $('etat-sites').textContent = 'Les sites n\'ont pas pu être chargés (fichier data/sites_cdl.js introuvable). Recharger la page.';
      $('etat-sites').className = 'alerte';
    };
    document.body.appendChild(s);
  })();

  /* -------- Recherche */
  var champ = $('recherche'), liste = $('resultats'), propositions = [], actif = -1;

  function fermerListe() { liste.hidden = true; champ.setAttribute('aria-expanded', 'false'); actif = -1; }

  function chercher() {
    var q = sansAccent(champ.value).trim();
    liste.textContent = '';
    if (q.length < 2) { fermerListe(); return; }
    var mots = q.split(/\s+/);
    propositions = sitesRecherche.filter(function (s) {
      return mots.every(function (m) { return s.cle.indexOf(m) >= 0; });
    }).sort(function (a, b) {
      var da = a.cle.indexOf(q) === 0 ? 0 : 1, db = b.cle.indexOf(q) === 0 ? 0 : 1;
      return da - db || a.cle.localeCompare(b.cle);
    }).slice(0, 12);
    if (!propositions.length) {
      var li = document.createElement('li'); li.className = 'aucun';
      li.textContent = 'Aucun site ne porte ce nom. Essayer un mot plus court.';
      liste.appendChild(li);
    }
    propositions.forEach(function (s, i) {
      var li = document.createElement('li');
      li.setAttribute('role', 'option'); li.id = 'res-' + i; li.setAttribute('aria-selected', 'false');
      var a = document.createElement('span'); a.className = 'lieu'; a.textContent = s.f.properties.nom;
      var b = document.createElement('span'); b.className = 'ou'; b.textContent = s.f.properties.terr;
      li.appendChild(a); li.appendChild(b);
      li.addEventListener('mousedown', function (e) { e.preventDefault(); choisir(i); });
      liste.appendChild(li);
    });
    liste.hidden = false; champ.setAttribute('aria-expanded', 'true'); actif = -1;
  }

  function choisir(i) {
    var s = propositions[i];
    if (!s) return;
    champ.value = s.f.properties.nom;
    fermerListe();
    montrerSite(s.f, true);
  }

  function activer(i) {
    var items = liste.querySelectorAll('[role=option]');
    if (!items.length) return;
    actif = (i + items.length) % items.length;
    items.forEach(function (li, n) { li.setAttribute('aria-selected', n === actif ? 'true' : 'false'); });
    items[actif].scrollIntoView({ block: 'nearest' });
    champ.setAttribute('aria-activedescendant', items[actif].id);
  }

  champ.addEventListener('input', chercher);
  champ.addEventListener('blur', function () { setTimeout(fermerListe, 120); });
  champ.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (liste.hidden) chercher(); activer(actif + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activer(actif - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); choisir(actif >= 0 ? actif : 0); }
    else if (e.key === 'Escape') { fermerListe(); }
  });

  var selTerr = $('territoire');
  cfg.territoires.forEach(function (t, i) {
    var o = document.createElement('option'); o.value = i; o.textContent = t.nom; selTerr.appendChild(o);
  });
  selTerr.addEventListener('change', function () {
    var t = cfg.territoires[selTerr.value];
    if (t) carte.fitBounds(versBounds(t.bbox));
  });

  /* ============================================================= Tracé */
  function erreurGpx(msg) { var e = $('erreur-gpx'); e.textContent = msg || ''; e.hidden = !msg; }

  function chargerTexteGpx(texte, nomFichier) {
    erreurGpx('');
    var gpx;
    try { gpx = geo.lireGPX(texte); }
    catch (err) { erreurGpx(err.message); return; }
    var nom = gpx.nom || String(nomFichier || '').replace(/\.gpx$/i, '').replace(/[_-]+/g, ' ').trim() || 'Trail sans nom';
    var croisement = geo.croiser(gpx.segments, etat.index);
    etat.trace = { nom: nom, segments: gpx.segments, croisement: croisement };
    etat.resultat = null;
    var prec = etat.params || {};
    etat.params = {
      nom: nom,
      jours: prec.jours || cfg.valeursParDefaut.jours,
      participants: prec.participants !== undefined ? prec.participants : cfg.valeursParDefaut.participants,
      lineaire: Math.round(croisement.longueurCdl),
      emprise: prec.emprise !== undefined ? prec.emprise : cfg.valeursParDefaut.emprise,
      vehicules: prec.vehicules !== undefined ? prec.vehicules : cfg.valeursParDefaut.vehicules
    };
    carte.closePopup();
    coucheChoix.clearLayers();
    dessinerTrace();
    afficherTrace();
    afficherRedevance();
    ouvrirFenetre();
  }

  function latlngs(pts) { return pts.map(function (p) { return [p[1], p[0]]; }); }

  function dessinerTrace() {
    coucheTrace.clearLayers();
    document.querySelectorAll('.l-si-trace').forEach(function (el) { el.hidden = !etat.trace; });
    if (!etat.trace) return;
    var t = etat.trace, c = cfg.couleurs;
    t.segments.forEach(function (s) { L.polyline(latlngs(s), { color: '#FFFFFF', weight: 7, opacity: 0.9, interactive: false }).addTo(coucheTrace); });
    t.segments.forEach(function (s) { L.polyline(latlngs(s), { color: c.trace, weight: 3, interactive: false }).addTo(coucheTrace); });
    t.croisement.tronconsCdl.forEach(function (s) { L.polyline(latlngs(s), { color: c.traceCdl, weight: 5, interactive: false }).addTo(coucheTrace); });
    var premier = t.segments[0][0], dern = t.segments[t.segments.length - 1];
    var fin = dern[dern.length - 1];
    L.circleMarker([fin[1], fin[0]], { radius: 6, color: '#FFFFFF', weight: 2, fillColor: c.trace, fillOpacity: 1 }).bindTooltip('Arrivée').addTo(coucheTrace);
    L.circleMarker([premier[1], premier[0]], { radius: 6, color: c.trace, weight: 2.5, fillColor: '#FFFFFF', fillOpacity: 1 }).bindTooltip('Départ').addTo(coucheTrace);
    carte.fitBounds(versBounds(t.croisement.bbox), { padding: [50, 50] });
  }

  function afficherTrace() {
    var t = etat.trace;
    $('import').hidden = !!t; $('trace').hidden = !t;
    if (!t) return;
    var c = t.croisement;
    $('trace-nom').textContent = etat.params.nom;
    $('trace-total').textContent = R.distance(c.longueurTotale);
    $('trace-cdl').textContent = R.nombre(c.longueurCdl) + ' m';
    $('trace-vide').hidden = c.sites.length > 0;
    var ul = $('trace-sites'); ul.textContent = '';
    c.sites.forEach(function (s) {
      var li = document.createElement('li'), b = document.createElement('button'), m = document.createElement('span');
      b.type = 'button'; b.className = 'lien'; b.textContent = s.nom; b.title = 'Voir ce site sur la carte';
      b.addEventListener('click', function () { montrerSite(etat.index.fc.features[s.index], false); });
      m.textContent = R.nombre(s.metres) + ' m';
      li.appendChild(b); li.appendChild(m); ul.appendChild(li);
    });
  }

  function retirerTrace() {
    etat.trace = null; etat.resultat = null;
    coucheChoix.clearLayers();
    dessinerTrace(); afficherTrace(); afficherRedevance(); erreurGpx('');
  }

  function lireFichier(f) {
    if (!f) return;
    if (!etat.index) { erreurGpx('Les sites sont encore en cours de chargement. Réessayer dans un instant.'); return; }
    var lecteur = new FileReader();
    lecteur.onload = function () { chargerTexteGpx(String(lecteur.result), f.name); };
    lecteur.onerror = function () { erreurGpx('Le fichier n\'a pas pu être lu.'); };
    lecteur.readAsText(f);
  }

  $('btn-gpx').addEventListener('click', function () { $('fichier-gpx').click(); });
  $('btn-autre').addEventListener('click', function () { $('fichier-gpx').click(); });
  $('fichier-gpx').addEventListener('change', function (e) { lireFichier(e.target.files[0]); e.target.value = ''; });
  $('btn-retirer').addEventListener('click', retirerTrace);
  $('btn-exemple').addEventListener('click', function () {
    if (window.CDL_EXEMPLE_GPX) chargerTexteGpx(window.CDL_EXEMPLE_GPX, cfg.exemple.nom);
    else erreurGpx('Le tracé d\'exemple est introuvable. Importer le fichier ' + cfg.exemple.fichier + ' à la main.');
  });

  // Glisser-déposer sur toute la page
  var voile = $('voile-depot'), survols = 0;
  function aDesFichiers(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0; }
  window.addEventListener('dragenter', function (e) { if (aDesFichiers(e)) { survols++; voile.hidden = false; e.preventDefault(); } });
  window.addEventListener('dragover', function (e) { if (aDesFichiers(e)) e.preventDefault(); });
  window.addEventListener('dragleave', function (e) { if (aDesFichiers(e)) { survols = Math.max(0, survols - 1); if (!survols) voile.hidden = true; } });
  window.addEventListener('drop', function (e) {
    if (!aDesFichiers(e)) return;
    e.preventDefault(); survols = 0; voile.hidden = true;
    lireFichier(e.dataTransfer.files[0]);
  });

  /* ========================================================== Paramètres */
  var fenetre = $('fenetre');
  var champsNum = ['jours', 'participants', 'lineaire', 'emprise', 'vehicules'];

  function lireFormulaire() {
    var p = { nom: $('p-nom').value.trim() };
    champsNum.forEach(function (c) {
      var v = Math.round(Number($('p-' + c).value));
      p[c] = isFinite(v) && v > 0 ? v : 0;
    });
    if (p.jours < 1) p.jours = 1;
    return p;
  }

  function ligneDetail(table, titre, sousTitre, calcul, montant, classe) {
    var tr = document.createElement('tr'), th = document.createElement('th'), td = document.createElement('td');
    if (classe) tr.className = classe;
    th.scope = 'row'; th.textContent = titre;
    if (sousTitre) { var s = document.createElement('small'); s.textContent = sousTitre; th.appendChild(s); }
    if (calcul) { var c = document.createElement('span'); c.className = 'calc'; c.textContent = calcul + ' = '; td.appendChild(c); }
    td.appendChild(document.createTextNode(montant));
    tr.appendChild(th); tr.appendChild(td); table.appendChild(tr);
  }

  function remplirDetail(table, res, avecPaliers) {
    table.textContent = '';
    ['participants', 'lineaire', 'emprise', 'vehicules'].forEach(function (cle) {
      var p = res.parts[cle];
      ligneDetail(table, p.titre, avecPaliers && p.palier ? 'palier ' + p.palier.libelle : '',
        R.nombre(p.quantite) + ' × ' + R.coutUnitaire(p.cout), R.euros(p.montant));
    });
    ligneDetail(table, 'Sous-total par jour', '', '', R.euros(res.sousTotalJour));
    ligneDetail(table, 'Redevance', '', res.jours > 1 ? res.jours + ' jours × ' + R.euros(res.sousTotalJour) : '', R.euros(res.total), 'total');
  }

  function afficherBareme(res) {
    var zone = $('bareme'); zone.textContent = '';
    ['participants', 'lineaire', 'emprise', 'vehicules'].forEach(function (cle) {
      var b = cfg.bareme[cle], h = document.createElement('h3'), t = document.createElement('table');
      h.textContent = b.titre + ' (coût par ' + b.unite + ' et par jour)';
      b.paliers.forEach(function (pal) {
        var tr = document.createElement('tr'), a = document.createElement('td'), c = document.createElement('td');
        if (res.parts[cle].palier === pal) tr.className = 'atteint';
        a.textContent = pal.libelle; c.textContent = R.coutUnitaire(pal.cout);
        tr.appendChild(a); tr.appendChild(c); t.appendChild(tr);
      });
      zone.appendChild(h); zone.appendChild(t);
    });
  }

  function apercu() {
    var p = lireFormulaire(), res = R.calculer(p, cfg.bareme);
    $('apercu-total').textContent = R.euros(res.total);
    remplirDetail($('apercu-detail'), res, false);
    ['participants', 'lineaire', 'emprise', 'vehicules'].forEach(function (cle) {
      var part = res.parts[cle];
      $('palier-' + cle).textContent = part.palier
        ? 'Palier ' + part.palier.libelle + ' : ' + R.coutUnitaire(part.cout) + ' par ' + part.unite + ' et par jour'
        : 'Aucun ' + part.unite + ' : part nulle';
    });
    afficherBareme(res);
    var mesure = etat.trace ? Math.round(etat.trace.croisement.longueurCdl) : null;
    var reprendre = $('p-lineaire-reprendre');
    reprendre.hidden = mesure === null || p.lineaire === mesure;
    if (mesure !== null) reprendre.textContent = 'Reprendre la mesure du tracé (' + R.nombre(mesure) + ' m)';
  }

  function ouvrirFenetre() {
    if (!etat.params) return;
    $('p-nom').value = etat.params.nom || '';
    champsNum.forEach(function (c) { $('p-' + c).value = etat.params[c]; });
    apercu();
    if (fenetre.showModal) { if (!fenetre.open) fenetre.showModal(); } else fenetre.setAttribute('open', '');
    var cible = $('p-participants'); cible.focus(); cible.select();
  }

  function fermerFenetre() { if (fenetre.close) fenetre.close(); else fenetre.removeAttribute('open'); }

  $('formulaire').addEventListener('input', apercu);
  $('p-lineaire-reprendre').addEventListener('click', function () {
    $('p-lineaire').value = Math.round(etat.trace.croisement.longueurCdl); apercu();
  });
  $('f-annuler').addEventListener('click', fermerFenetre);
  $('formulaire').addEventListener('submit', function (e) {
    e.preventDefault();
    etat.params = lireFormulaire();
    if (!etat.params.nom) etat.params.nom = etat.trace ? etat.trace.nom : 'Trail sans nom';
    etat.resultat = R.calculer(etat.params, cfg.bareme);
    fermerFenetre();
    afficherTrace();
    afficherRedevance();
    $('bloc-redevance').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  $('btn-params').addEventListener('click', ouvrirFenetre);
  $('btn-modifier').addEventListener('click', ouvrirFenetre);

  /* =========================================================== Redevance */
  function afficherRedevance() {
    var res = etat.resultat;
    $('bloc-redevance').hidden = !res;
    $('btn-params').hidden = !!res;
    $('etat-export').textContent = '';
    if (!res) return;
    $('montant-total').textContent = R.euros(res.total);
    $('montant-duree').textContent = etat.params.nom + ', ' + (res.jours > 1 ? res.jours + ' jours' : '1 jour');
    remplirDetail($('detail'), res, true);
  }

  function exporterEn(format) {
    if (!etat.resultat || !etat.trace) return;
    var note = $('etat-export'), boutons = [$('btn-png'), $('btn-pdf')];
    boutons.forEach(function (b) { b.disabled = true; });
    note.className = 'note'; note.textContent = 'Préparation de la fiche…';
    exporter.composerFiche(etat).then(function (fiche) {
      return exporter[format](fiche.canvas, etat.params.nom).then(function (fichier) {
        note.textContent = 'Fiche téléchargée : ' + fichier + (fiche.avertissement ? ' ' + fiche.avertissement : '');
      });
    }).catch(function (err) {
      note.className = 'alerte';
      note.textContent = 'La fiche n\'a pas pu être produite (' + (err && err.message ? err.message : 'erreur inconnue') + '). Changer de fond de carte puis réessayer.';
    }).then(function () { boutons.forEach(function (b) { b.disabled = false; }); });
  }
  $('btn-png').addEventListener('click', function () { exporterEn('png'); });
  $('btn-pdf').addEventListener('click', function () { exporterEn('pdf'); });

  $('pied-bareme').textContent = 'Barème : ' + cfg.versionBareme + '.';
  window.addEventListener('resize', function () { carte.invalidateSize(); });
})();
