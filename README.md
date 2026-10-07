# Redevance trail – terrains du Conservatoire du littoral

Site web statique (première ébauche) pour estimer la redevance d'un trail dont le tracé traverse des terrains du Conservatoire du littoral.

## Ce que fait le site

- Carte de tous les sites du Conservatoire (814 sites, Hexagone et outre-mer), en zonage bleu sur fond IGN.
- Recherche d'un site par son nom, ou accès direct à un territoire.
- Import d'un tracé GPX (bouton ou glisser-déposer). Le fichier reste dans le navigateur : rien n'est envoyé.
- Mesure automatique du linéaire du tracé situé à l'intérieur des terrains, avec le détail par site.
- Fenêtre de paramètres : nom du trail, nombre de jours, participants, linéaire, emprise au sol, véhicules.
- Calcul de la redevance et affichage du détail par poste.
- Téléchargement d'une fiche A4 en image (PNG) ou en PDF : logo, carte du tracé et des terrains, détail du calcul, montant final.

## Mise en ligne avec GitHub Pages

1. Créer un dépôt public sur GitHub.
2. Déposer **le contenu** de ce dossier à la racine du dépôt (`index.html` doit être à la racine).
3. Dans le dépôt : *Settings* > *Pages* > *Build and deployment* > *Source* : « Deploy from a branch », branche `main`, dossier `/ (root)`.
4. Le site est disponible après une à deux minutes à l'adresse `https://<compte>.github.io/<dépôt>/`.

Le site fonctionne aussi hors ligne de GitHub : un double-clic sur `index.html` suffit pour l'essayer (une connexion internet reste nécessaire pour les fonds de carte IGN).

## Formule de calcul

Reprise du classeur `projet-redevance-MS_260626.xlsx` :

```
Redevance = Nb de jours × (part participants + part linéaire + part emprise + part véhicules)
```

Chaque part vaut la quantité multipliée par le coût unitaire du palier atteint. Le coût du palier s'applique à toute la quantité (pas de calcul par tranches).

| Participants | €/participant/jour | | Linéaire | €/m/jour |
|---|---|---|---|---|
| 0 à 100 | 0,50 | | 0 à 1 000 m | 0,05 |
| 101 à 500 | 0,75 | | 1 001 à 3 000 m | 0,075 |
| 501 à 999 | 1,00 | | 3 001 à 5 000 m | 0,10 |
| 1 000 et plus | 2,00 | | plus de 5 000 m | 0,20 |

| Emprise | €/m²/jour | | Véhicules | €/véhicule/jour |
|---|---|---|---|---|
| 0 à 5 m² | 1,00 | | 1 | 50 |
| 6 à 10 m² | 1,50 | | 2 | 75 |
| 11 à 20 m² | 2,00 | | 3 | 100 |
| plus de 20 m² | 4,00 | | 4 et plus | 200 |

Les quantités sont arrondies à l'unité (mètre, m², personne) avant le calcul. Le calcul du site a été comparé au classeur d'origine sur 60 cas, bornes de paliers comprises : résultats identiques.

## Modifier le barème ou les réglages

Tout se règle dans `js/config.js` :

- `bareme` : paliers (`min` = borne basse, `cout` = coût unitaire) ;
- `versionBareme` : mention reprise en pied de fiche ;
- `fonds` : fonds de carte IGN. Le fond « Carte IGN (SCAN 25) » passe par une clé (`cle`) à remplacer par celle de l'établissement ;
- `valeursParDefaut`, `territoires`, `couleurs`.

## Logo

- Le logo du Conservatoire figure en haut du panneau et en tête de la fiche exportée, sur fond blanc.
- Pour le changer : remplacer `img/logo-cdl.jpg` par le nouveau fichier (même nom), puis lancer `python scripts/logo_vers_js.py img/logo-cdl.jpg img/logo-cdl.js`. Cette seconde étape ne sert qu'à l'essai par double-clic ; une fois le site en ligne, le fichier image suffit.
- Pour un autre nom ou un autre format (PNG, SVG), modifier `logo.fichier` dans `js/config.js`.

## Mettre à jour les sites

Les périmètres proviennent du flux WFS de l'IGN (Géoplateforme), couche `patrinat_cdl:conservatoire_littoral` (sites acquis, source PatriNat / Conservatoire du littoral), extraction du 07/10/2026.

1. Dans QGIS, exporter la couche en GeoJSON, en EPSG:4326.
2. Lancer : `python scripts/prep_sites.py export.geojson data/sites_cdl.js 2 5` (nécessite le module `shapely`).

Le script ne garde que les polygones, simplifie les contours à 2 m près et écrit `data/sites_cdl.js`.

## Limites de cette ébauche

- Le linéaire est mesuré sur des périmètres simplifiés à 2 m : l'écart peut atteindre quelques mètres à chaque franchissement de limite.
- Le linéaire dépend de la qualité du GPX fourni par l'organisateur.
- Un tronçon parcouru plusieurs fois (aller-retour, boucles) est compté autant de fois qu'il figure dans le GPX.
- Les noms de sites sont ceux du flux, sans correction.
- La fiche PDF est une image : son texte n'est pas sélectionnable.
- Montants indicatifs, sans valeur contractuelle.

## Organisation des fichiers

```
index.html              page unique
css/style.css           mise en forme
js/config.js            barème et réglages
js/redevance.js         calcul de la redevance
js/geo.js               lecture du GPX, croisement tracé / terrains
js/export.js            fiche A4, export PNG et PDF
js/app.js               interface
data/sites_cdl.js       périmètres des sites
img/                    logo du Conservatoire du littoral
exemples/               tracé d'exemple (fictif) à Mayotte
scripts/prep_sites.py   préparation des périmètres
scripts/logo_vers_js.py copie de secours du logo
vendor/                 Leaflet 1.9.4 (BSD-2), polices Source Sans 3 et Source Serif 4 (OFL)
```
