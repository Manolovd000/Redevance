"""Régénère la copie de secours du logo (utilisée pour la fiche quand le site est ouvert par double-clic).
Usage : python scripts/logo_vers_js.py img/logo-cdl.jpg img/logo-cdl.js
"""
import base64, mimetypes, sys
src, dst = sys.argv[1], sys.argv[2]
mime = mimetypes.guess_type(src)[0] or 'image/png'
b64 = base64.b64encode(open(src, 'rb').read()).decode('ascii')
open(dst, 'w', encoding='utf-8').write(
    '/* Copie de secours du logo — fichier généré par scripts/logo_vers_js.py */\n'
    'window.CDL_LOGO_SECOURS="data:%s;base64,%s";\n' % (mime, b64))
print(dst, len(b64), 'caractères')
