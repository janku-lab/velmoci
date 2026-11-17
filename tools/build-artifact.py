# Sestaví verzi pro Claude artefakt: jeden index.html s vloženým CSS a skripty (bez gate.js a Firebase).
# python3 tools/build-artifact.py  → dist/index.html (+ assety se publikují vedle: map.jpg, hero.mp4, hero-v0.jpg, hero.jpg, music/*.mp3)
import pathlib
R = pathlib.Path(__file__).resolve().parent.parent
css = (R / 'css/style.css').read_text()
js = ''.join('<script>\n' + (R / f).read_text().replace('</script', '<\\/script') + '\n</script>\n' for f in ['js/data.js', 'js/engine.js', 'js/app.js'])
html = f'''<!DOCTYPE html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Velmoci 1901</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>:root{{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}}html{{scroll-padding-top:env(safe-area-inset-top,0px)}}body{{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#000}}img{{max-width:100%}}[hidden]:not([hidden=until-found i]){{display:none!important}}</style>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&family=EB+Garamond:ital,wght@0,400;0,600;1,400&family=IM+Fell+English+SC&display=swap">
<style>
{css}
</style>
</head>
<body>
<div id="app"></div>
{js}</body>
</html>
'''
(R / 'dist').mkdir(exist_ok=True)
(R / 'dist/index.html').write_text(html)
print('dist/index.html', len(html))
