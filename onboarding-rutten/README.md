# En dag på rutten

Interaktiv onboardingövning för nya operatörer. En fristående HTML-fil som fungerar utan nät och utan inloggning, på storskärm (grupp röstar med A, B eller C) och på egen telefon (ger en kod som läses in på storskärmen).

## Bygga

1. Lägg bilderna (png) i `bilder/`. Namnen står i `situationer.py` (fältet `bild`) och `bygg_html.py` (`BESKAR`). Bilderna kommer från OneDrive (Onboarding_Utbildning/Bilder Onboarding) och SharePoint (SE Marknadsföring/1. Bilder/Tak samt danska nanostone.dk: Videomateriale och Ydelser/Facade/Algebehandling) och checkas aldrig in. Bilder med EXIF-rotation vänds rätt före sparning.
2. `python3 situationer.py` skriver `situationer-v2.json`.
3. `python3 bygg_html.py` skriver `en-dag-pa-rutten.html` (cirka 4 MB, allt inbäddat, ingen EXIF).

## Innehåll

Texterna står i `situationer.py`. Regler från Axel (18 nov 2026): närmast ansvarig för allt tekniskt, kundtjänst vid yta mer än 20 m² över ordern och för allt som rör pengar, ingen egen rödmarkering, ingen egen rabatt, provtvätt 1 m² vid sten och altan (aldrig Softwash), bomkörningsavgift när kunden hindrar jobbet. Inga trycksiffror och inga interna siffror visas.

`bygg_html.py` sprider rätt svar jämnt över A, B och C.

## Kartan

`karta.json` byggs av `kartbygg.py` från tre öppna källor och checkas in (cirka 85 kB):
- kustlinje: OpenStreetMap via geo-maps `countries-land-100m` (ODbL),
- kommungränser: Lantmäteriet, Kommun, län och rike 2026 (CC0), via GioPalusa/SwedenGeoJSON,
- större vägar: Natural Earth `ne_10m_roads` (public domain).

Stoppen är påhittade punkter i rätt ort, inga adresser. `VIA` i `kartbygg.py` håller rutten på land. Källorna anges på startsidan.

## Kapitel i 3D och före/efter

`kapitel.js` och `kapitel.css` byggs in av `bygg_html.py`. Två kapitel i ren CSS 3D, utan bibliotek:
- **Bilkontrollen** (efter hemfärden, och från startsidan): QR-koden, elva bilder, mätarställning, mönsterdjup med lagkrav 1,6 och 3,0 mm, en kontrollfråga. Bygger på Axels Bilkontroll-skript (Kod.gs).
- **Se hela huset** (efter läge 14:05 om taket): merförsäljning runt kundens hus.

Före- och efterpar (`FE` i `bygg_html.py`) visas i svaren och på slutsidan. Par med samma vinkel får ett dragreglage, övriga växlar.
