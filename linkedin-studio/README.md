# LinkedIn Studio

Gör råa bilder och filmer till färdiga LinkedIn-inlägg i Nanostones designspråk.
Texterna skrivs av Claude enligt `PLAYBOOK.md`. Det här verktyget sköter bild, karusell och film.

## Mappen

```
LinkedIn/
  In/            lägg bilder, filmer och korta anteckningar (.txt) här
  Klart/         färdiga veckor: Klart/2026-v47/1-mandag/inlagg.txt + media
  Arkiv/         använt råmaterial
  resultat.csv   en rad per inlägg, fyll i siffrorna en vecka efter publicering
```

## Så används det

I en Claude-session med det här repot och mappen tillgänglig: skriv **"gör veckans LinkedIn-inlägg"**.
Claude följer då `.claude/skills/linkedin-vecka`.

För hand:

```
python3 studio.py granska  ~/Desktop/LinkedIn             # översikt av In
python3 studio.py bygg     ~/Desktop/LinkedIn plan.json   # bygger veckan
python3 studio.py kontroll inlagg.txt                     # kontrollerar en text
```

Kräver Python 3.10+, `pip install pillow` och ffmpeg.

## Vad som byggs

| `typ` i planen | Resultat |
|---|---|
| `bild` | Foto 1080 x 1350, försiktigt förbättrat, med eller utan rubrikfält |
| `fore-efter` | Före och efter i samma bild, utan bildförbättring |
| `tre-steg` | Tre bilder av samma yta i `bilder` med etiketterna FÖRE, TVÄTTAD, FOGAD, utan bildförbättring |
| `fraga` | Kort för Förvaltarens fråga: löpande nummer, fråga, svar och slutrad |
| `karusell` | PDF för LinkedIn-dokument: omslag, numrerade sidor, avslutning |
| `film` | Klipp och stillbilder ihopklippta, rubrik de första 3 sekunderna, textskyltar, slutkort, jämn ljudnivå |

Se `exempel-plan.json` för alla fält. `fokus: [x, y]` (0 till 1) styr vad som behålls vid beskärning.
Format väljs med `"format"`: `4:5` (standard), `1:1`, `9:16` eller `16:9`.

## Logotyp

Se `assets/logo/LÄS-MIG.md`. Typsnittet Open Sans ligger i `assets/fonts` (licens: OFL).
