/*
 * Calcul de la redevance — reproduit la formule du classeur :
 *   = jours × ( participants × RECHERCHE(participants) + linéaire × RECHERCHE(linéaire)
 *             + emprise × RECHERCHE(emprise) + véhicules × tarif(véhicules) )
 * Le coût unitaire du palier atteint s'applique à TOUTE la quantité (pas de tranches).
 */
(function (global) {
  'use strict';

  /** Palier atteint : dernier palier dont la borne basse est ≤ quantité (comme RECHERCHE dans Excel). */
  function palierPour(quantite, paliers) {
    var trouve = null;
    for (var i = 0; i < paliers.length; i++) {
      if (quantite >= paliers[i].min) trouve = paliers[i];
    }
    return trouve; // null si la quantité est sous la première borne (ex. 0 véhicule)
  }

  function entier(v) {
    var n = Math.round(Number(v));
    return isFinite(n) && n > 0 ? n : 0;
  }

  /** Arrondi au centime, sans piège de virgule flottante (1129,575 -> 1129,58). */
  function arrondi2(x) { return Math.round(Number((x * 100).toPrecision(12))) / 100; }

  /**
   * @param {{jours:number, participants:number, lineaire:number, emprise:number, vehicules:number}} p
   * @param {object} bareme  CDL_CONFIG.bareme
   */
  function calculer(p, bareme) {
    var q = {
      participants: entier(p.participants),
      lineaire: entier(p.lineaire),
      emprise: entier(p.emprise),
      vehicules: entier(p.vehicules)
    };
    var jours = Math.max(1, entier(p.jours));
    var parts = {};
    var sousTotal = 0;
    ['participants', 'lineaire', 'emprise', 'vehicules'].forEach(function (cle) {
      var palier = palierPour(q[cle], bareme[cle].paliers);
      var cout = palier ? palier.cout : 0;
      var montant = q[cle] * cout;
      parts[cle] = {
        cle: cle, titre: bareme[cle].titre, unite: bareme[cle].unite,
        quantite: q[cle], cout: cout, palier: palier, montant: arrondi2(montant)
      };
      sousTotal += montant;
    });
    return {
      jours: jours,
      parts: parts,
      sousTotalJour: arrondi2(sousTotal),
      total: arrondi2(jours * sousTotal)
    };
  }

  /* ---------- Mise en forme (français) ---------- */

  function grouper(entierTxt, sep) {
    return entierTxt.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  }

  /** 1234.5 -> « 1 234,50 € » */
  function euros(x, sep) {
    sep = sep === undefined ? ' ' : sep;
    var s = Math.abs(x).toFixed(2).split('.');
    return (x < 0 ? '-' : '') + grouper(s[0], sep) + ',' + s[1] + sep + '€';
  }

  /** Coût unitaire : 0.075 -> « 0,075 € », 50 -> « 50 € » */
  function coutUnitaire(x, sep) {
    sep = sep === undefined ? ' ' : sep;
    var txt = String(Math.round(x * 1000) / 1000).replace('.', ',');
    if (/,\d$/.test(txt)) txt += '0';
    return txt + sep + '€';
  }

  /** 12345 -> « 12 345 » */
  function nombre(x, sep) {
    sep = sep === undefined ? ' ' : sep;
    return grouper(String(Math.round(x)), sep);
  }

  /** Distance lisible : 850 -> « 850 m », 12 340 -> « 12,3 km » */
  function distance(m, sep) {
    sep = sep === undefined ? ' ' : sep;
    if (m < 1000) return Math.round(m) + sep + 'm';
    var km = (Math.round(m / 100) / 10).toFixed(1).split('.');
    return grouper(km[0], sep) + (km[1] === '0' && m >= 100000 ? '' : ',' + km[1]) + sep + 'km';
  }

  global.CDL = global.CDL || {};
  global.CDL.redevance = {
    calculer: calculer, palierPour: palierPour,
    euros: euros, coutUnitaire: coutUnitaire, nombre: nombre, distance: distance
  };
})(typeof window !== 'undefined' ? window : globalThis);
