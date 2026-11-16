# Velmoci 1901 – kontext projektu

Česká webová verze deskové hry Diplomacie („Velmoci“). Statický web bez build kroku: čisté HTML/CSS/JS.

## Struktura
- `index.html` – kostra stránky, jen načítá CSS a skripty (neměnit, pokud není nutné)
- `css/style.css` – veškeré styly (barvy velmocí v `:root`: `--RAK`, `--ANG`, `--FRA`, `--NEM`, `--ITA`, `--RUS`, `--TUR`)
- `js/data.js` – `window.VDATA`: názvy provincií, sousedství, moře, vnitrozemí, souřadnice jednotek/center/popisků na mapě (3600×2549 px)
- `data/vdata.json` – čitelná kopie stejných dat; **při změně dat uprav obojí** (nebo vygeneruj data.js z json)
- `js/engine.js` – `window.VEngine`: pravidla, rozhodčí (Kruijswijk), ústupy, stavby, bot, parser rozkazů
- `js/app.js` – UI klient: lobby, hra, chat, tutoriál, průzkumník mapy (`#mapa`), přehrávání kol, hudba, AI hráči
- `map.jpg`, `hero.jpg`, `music/*.mp3` – assety

## Důležité
- Backendy (vybírá `boot()` v app.js): v Claude artefaktu `dbBackend` (Claude db/user/sample, včetně AI diplomatů; AI nefunguje u veřejně sdíleného artefaktu). Na vlastním webu `js/fb.js` = Firebase projekt `velmoci-b14db` (anonymní přihlášení, Firestore europe-west3, přezdívky v `profiles`, zámky v `leases`) – online hra s přáteli, bez AI. Když Firebase selže, `localBackend` (jen tento prohlížeč).
- Web: velmoci.danieljanku.cz = Netlify projekt „velmoci“ propojený s GitHubem, každý push na main se nasadí sám (+ GitHub Pages jako záloha).
- Web načítá skripty přes `js/gate.js` (heslo, pak Firebase SDK + fb.js + hra).
- Kódy provincií jsou anglické zkratky (VIE, BUD…), texty v UI česky. Pobřeží: NC/SC/EC → česky SP/JP/VP.
- Jednotky: A = armáda, F = loďstvo (v UI „L“).

## Jak pracovat
- Dělej cílené úpravy jen v dotčeném souboru, nepřepisuj celé soubory.
- Boti: `botOrders(st, pw, level)` v engine.js – v2 (výchozí): hodnoty provincií + 14 variant tahů ověřených rozhodčím proti předpovědi soupeřů + lokální vylepšování; v1 = původní jednoduchý bot (soupeř pro testy). Sílu měř `node tools/bench.js 10 1912` (průměr center v2 vs v1, poslední měření 6,9 vs 4,8).
- Test enginu: `node -e 'global.window=globalThis;require("./js/data.js");require("./js/engine.js");…'`
- Lokální náhled: `python3 -m http.server` a otevřít `http://localhost:8000/` (`#mapa` = průzkumník mapy, `#tutorial`).
- Komunikace s Danielem česky, stručně.
