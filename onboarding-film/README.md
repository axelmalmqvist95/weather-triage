# Välkomstfilm för nyanställda

En personlig film (1080×1920, 30 bilder/s, cirka 36 sekunder) per nyanställd: logga, "Välkommen, Erik.",
kartan över hans område med årets utförda jobb som ljuspunkter, tre före/efter-bilder, hans första vecka
och "Vi ses måndag." med tid, plats och gruppledare. Valfritt: ett kort hälsningsklipp från gruppledaren.

Allt ritas av `film.html`/`film.js` som en ren funktion av tiden (`window.renderAt(t)`), så alla filmer
blir exakt lika bra. `rendera.js` stegar igenom bildrutorna i Chromium (Playwright) och kodar med ffmpeg.

## Filer

| Fil | Vad |
|---|---|
| `config.json` | Sökvägar till källmaterial (logga, typsnitt, kartdata, foton) och vilka före/efter-par som används |
| `forbered.py` | Bygger `assets/` från källorna: typsnitt, ordbild, karta, inriktade och graderade foton |
| `film.html`, `film.js` | Själva filmen |
| `rendera.js` | Läser CSV, kontrollerar raderna, renderar MP4 + affischbild |
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
| `dag1` | Start {starttid} på {plats}. Arbetskläder och genomgång | gäller startdagen |
| `dag2` | tisdag: Du åker med {gruppledare} | börja med veckodag + kolon |
| `dag3` | fredag: Din första egna yta | börja med veckodag + kolon |
| `halsning` | klipp/jonas.mp4 | valfritt, se nedan |
| `halsning_start` | 1,5 | valfritt, sekunder in i klippet |
| `halsning_langd` | 5 | valfritt, 2–8 sekunder (standard 5) |

I dagtexterna kan du skriva `{gruppledare}`, `{starttid}`, `{plats}` och `{fornamn}`. Datum räknas ut
från startdatumet ("Tisdag" blir första tisdagen från och med startdagen). Max 80 tecken och 3 rader per dag.

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

Tid: cirka 2,5–3 minuter per film på en vanlig dator med 4 kärnor, alltså cirka 2 timmar för 40 personer.
Låt den gå i bakgrunden. `--arbetare 4` kan gå något fortare på en dator med fler kärnor.

Filstorlek: cirka 23 MB (H.264 high, CRF 17 med tak på 5 Mbit/s). Det går att mejla. För SMS: lägg filen
i OneDrive/SharePoint och skicka länken, MMS klarar inte så stora filer.

## Hälsningsklipp från gruppledaren

Fyll i `halsning` med sökvägen till ett mobilklipp (valfri orientering och längd). Då läggs en scen in efter
"Din första vecka": klippet i helbild (beskuret till 9:16 från mitten, långsam inzoomning), med
"Jonas, din gruppledare" som namnskylt. Klippets ljud behålls och normaliseras till −16 LUFS; används musik
sänks den under hälsningen. Utan `halsning` blir filmen exakt som vanligt.

Klippet avkodas en gång och sparas i `cache/`, så 40 filmer med samma gruppledare avkodar det bara en gång.

## Musik

Ingen musik är licensierad. Utan `--musik` får filmen ett tyst ljudspår (så att alla spelare beter sig).
Med `--musik fil.mp3` normaliseras musiken till −16 LUFS, tonas in (1,2 s) och ut (2,5 s), och loopas om den
är kortare än filmen.

## Byta bilder

Före/efter-paren står i `config.json` under `bilder`. Före- och efterbilden riktas in mot varandra automatiskt
(ECC, för fasaden SIFT + ECC) så att torkningen blir ren. `mask` begränsar inriktningen till själva ytan när
kameran flyttats mellan bilderna (altanen). `utsnitt` väljer var 9:16-utsnittet ligger, `fokus` var
inzoomningen siktar. Kör `python3 forbered.py bilder` efter ändring och titta på stillbilderna.

## Förhandsgranska enskilda bildrutor

```bash
node rendera.js --csv personer.csv --ut granskning/ --stillbilder 6.5,14.4,15.8
```
