# Välkomstfilm för nyanställda (version 2)

En personlig film (1080×1920, 30 bilder/s, 31–40 sekunder) per nyanställd. Allt klipps på en fast takt
(120 BPM, ett slag var 0,5 s) så att musik kan läggas på i efterhand.

| Slag | Scen |
|---|---|
| 0–4 | Bomärket byggs (tre delar) med ett basslag |
| 4–16 | **Namnet tvättas fram ur smutsig sten**: förnamnet blir ren sten bokstav för bokstav, som omvänd graffiti, med stänk, dimma och våt yta som torkar. Sedan "Välkommen," ovanför |
| 16–28 | Montage: filmklipp på takten (se nedan), annars tre foton |
| 28–40 | Kartan: flygning in i personens område, årets jobb tänds som ljuspunkter |
| 40–48 | Ett före/efter (fasaden), diagonal torkning |
| (valfritt) | Hälsning från gruppledaren, filmens känslomässiga topp |
| +10 | "Vi ses måndag." med datum, tid, plats och "Jonas möter dig." |
| +5 | Logga och nanostone.se |

Scenlängderna i slag står i `config.json` under `film.slag`; filmens faktiska tidslinje (sekunder och slag)
skrivs bredvid varje film som `valkomst-NAMN-tidslinje.json`.

Allt ritas av `film.html`/`film.js` som en ren funktion av tiden (`window.renderAt(t)`), så alla filmer
blir exakt lika bra. `rendera.js` stegar igenom bildrutorna i Chromium (Playwright) och kodar med ffmpeg.
`ljud.js` syntetiserar ljudbädden (basslag, vinddrag på övergångar, högtryckstvätt synkad med namnet,
glitter på kartan, stigande ton in i hälsningen, svag rumston).

## Filer

| Fil | Vad |
|---|---|
| `config.json` | Sökvägar till källmaterial (logga, typsnitt, kartdata, foton) och vilka före/efter-par som används |
| `forbered.py` | Bygger `assets/` från källorna: typsnitt, ordbild, karta, inriktade och graderade foton |
| `film.html`, `film.js` | Själva filmen |
| `rendera.js` | Läser CSV, kontrollerar raderna, bygger ljudet, renderar MP4 + affischbild |
| `ljud.js` | Syntetisk ljudbädd, deterministisk |
| `personer-exempel.csv` | Exempelrad (Erik) att utgå från |

`assets/`, `cache/` och alla renderade filer checkas aldrig in (se `.gitignore`).

## Första gången

```bash
pip install pillow numpy opencv-python-headless
python3 forbered.py            # cirka 1 minut; kör igen om foton, karta eller logga byts
```

Kartdata hämtas från Driftcentralens exportfiler (`kartdata_mapp` i `config.json`). Kör `python3 forbered.py karta`
när du vill ha med nya besök. Bara koordinater och antal används, inga namn eller adresser.

## Fyll i personerna

Kopiera `personer-exempel.csv` till `personer.csv` (UTF-8, semikolon). En rad per person:

| Kolumn | Exempel | Regler |
|---|---|---|
| `fornamn` | Erik | bara förnamn, max 12 tecken |
| `region` | Norra Skåne | Södra Skåne, Norra Skåne, Göteborg eller Stockholm |
| `startdatum` | 2027-01-11 | ÅÅÅÅ-MM-DD |
| `starttid` | 07:00 | TT:MM |
| `plats` | kontoret i Trelleborg | max 34 tecken |
| `gruppledare` | Jonas | bara förnamn |
| `halsning` | klipp/jonas.mp4 | valfritt, se nedan |
| `halsning_start` | 1,5 | valfritt, sekunder in i klippet |
| `halsning_langd` | 5 | valfritt, 2–8 sekunder (standard 5) |

Kolumnerna `dag1`–`dag3` från version 1 får finnas kvar i filen men används inte längre (veckoschemat
blir en egen PDF). Förnamnet tvättas fram i versaler; långa namn (upp till cirka 11 tecken) får mindre text.

## Kontrollera och rendera

```bash
node rendera.js --csv personer.csv --kontrollera                 # bara kontroll, inget renderas
node rendera.js --csv personer.csv --ut ut/                      # alla rader
node rendera.js --csv personer.csv --ut ut/ --namn Erik          # bara Erik (eller --rad 7)
node rendera.js --csv personer.csv --ut ut/ --musik musik.mp3    # med licensierad musik
```

Alla rader kontrolleras innan något renderas. Är något fel (okänd region, felaktigt datum, för lång text för
layouten, klipp som saknas) stoppar skriptet med ett svenskt felmeddelande som säger vilken rad och vad som
ska rättas. Ingen halvfärdig film skapas.

Per person skapas `valkomst-erik.mp4` och `valkomst-erik.jpg` (affischbild). Med `--kontaktark` också
kontaktark (12 och 24 bilder) och tre stillbilder i full storlek för granskning.

Tid: cirka 3,5 minuter per film på en dator med 4 kärnor, alltså cirka 2,5 timmar för 40 personer.
Låt den gå i bakgrunden. `--arbetare 4` kan gå något fortare på en dator med fler kärnor.

Filstorlek: 20–25 MB (H.264 high, CRF 17 med tak på 5 Mbit/s). Det går att mejla. För SMS: lägg filen
i OneDrive/SharePoint och skicka länken, MMS klarar inte så stora filer.

## Hälsningsklipp från gruppledaren

Fyll i `halsning` med sökvägen till ett mobilklipp (valfri orientering och längd), gärna `halsning_start`
och `halsning_langd` (standard 5 s, max 8 s). Då läggs en scen in efter före/efter: klippet i helbild
(beskuret till 9:16 från mitten, långsam inzoomning), med "Jonas, din gruppledare" som namnskylt. Klippets
ljud behålls och normaliseras; används musik sänks den under hälsningen. Utan `halsning` blir filmen
exakt som vanligt, utan glapp. Klippet avkodas en gång och sparas i `cache/`.

## Montage med riktiga filmklipp

Montaget läser klipp från `config.json`, inte från CSV-filen (samma klipp till alla):

```json
"montage": [
  {"fil": "/sökväg/till/klipp1.mp4", "start": 2.0, "langd": 1.5},
  {"fil": "/sökväg/till/klipp2.mp4", "start": 0.0, "langd": 2.0, "slowmo": true},
  {"fil": "/sökväg/till/klipp3.mp4", "start": 4.5, "langd": 1.5}
]
```

- 3–5 klipp, 1,2–2 s vardera. `start` = var i klippet (sekunder), `langd` avrundas till hela slag.
- Klippen beskärs till 9:16 från mitten och får samma gradering som fotona. Hårda klipp på slaget.
- `slowmo: true` ger halv fart med uträknade mellanrutor (ffmpeg minterpolate). Titta på resultatet;
  ser rörelsen kladdig ut, ta bort `slowmo`.
- Inga människor som inte har sagt ja, inga kundadresser eller registreringsskyltar i bild.
- Tom lista = reservsekvens med tre foton (`reservbilder` i `config.json`).
- För att prova en uppsättning utan att ändra `config.json`: `--montage minlista.json`.

Klippen avkodas en gång och cachas i `cache/montage-…`. Det fungerar likadant på Axels dator: lägg klippen
i en mapp, skriv in sökvägarna i `config.json` och kör `rendera.js` som vanligt.

## Musik och ljud

Ingen musik är licensierad. Utan `--musik` får filmen bara den syntetiska ljudbädden. Med `--musik fil.mp3`
läggs musiken under effekterna (loopas om den är för kort, tonas in och ut, sänks under hälsningen).
Hela mixen normaliseras till −16 LUFS med toppar under −1,5 dBTP. Byt `film.bpm` i `config.json` om
musiken har ett annat tempo, så hamnar scenbytena på musikens slag.

## Byta bilder

Före/efter-paren står i `config.json` under `bilder`. `film.namnbild` väljer vilket par namnet tvättas
fram ur (smutsig och ren bild av samma yta, inriktade; ju större tonskillnad desto tydligare namn) och
`film.namn_fokus` var i bilden kameran siktar. `film.fore_efter` väljer paret i före/efter-scenen. Före- och efterbilden riktas in mot varandra automatiskt
(ECC, för fasaden SIFT + ECC) så att torkningen blir ren. `mask` begränsar inriktningen till själva ytan när
kameran flyttats mellan bilderna (altanen). `utsnitt` väljer var 9:16-utsnittet ligger, `fokus` var
inzoomningen siktar. Kör `python3 forbered.py bilder` efter ändring och titta på stillbilderna.

## Förhandsgranska enskilda bildrutor

```bash
node rendera.js --csv personer.csv --ut granskning/ --stillbilder 6.5,14.4,15.8
```
