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
- Online hra (sdílená databáze, přihlášení, AI hráči přes `window.claude.use('db'|'user'|'sample')`) funguje jen v Claude artefaktu. Mimo něj (GitHub Pages, lokálně) běží `localBackend` – hra jen v jednom prohlížeči (localStorage), boti místo AI.
- Kódy provincií jsou anglické zkratky (VIE, BUD…), texty v UI česky. Pobřeží: NC/SC/EC → česky SP/JP/VP.
- Jednotky: A = armáda, F = loďstvo (v UI „L“).

## Jak pracovat
- Dělej cílené úpravy jen v dotčeném souboru, nepřepisuj celé soubory.
- Test enginu: `node -e 'global.window=globalThis;require("./js/data.js");require("./js/engine.js");…'`
- Lokální náhled: `python3 -m http.server` a otevřít `http://localhost:8000/` (`#mapa` = průzkumník mapy, `#tutorial`).
- Komunikace s Danielem česky, stručně.
