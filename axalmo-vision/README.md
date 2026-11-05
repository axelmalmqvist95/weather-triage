# Axalmo Vision 1.0

Mobilanpassad PWA (React + Vite + TypeScript) som visar livekamera med **lokal** kroppsspårning
(MediaPipe Pose Landmarker), markeringsrutor, rörelseriktning och uppskattad hastighet.

- Ingen backend, ingen API-nyckel, ingen molntjänst vid körning.
- All bildbehandling sker i telefonens webbläsare. Inga bilder sparas eller skickas.
- Ingen ansiktsigenkänning eller biometrisk identifiering. Objekt får bara löpnummer (t.ex. Människa 3).
- Fungerar offline efter första laddningen (service worker cachar app, modell och WASM).

## Kom igång

Kräver Node.js 18+ (testat med 22).

```bash
cd axalmo-vision
npm install
npm run dev        # utvecklingsserver på http://localhost:5173
npm run build      # produktionsbygge till dist/ (inkl. TypeScript-kontroll)
npm run preview    # serverar dist/ på http://localhost:4173
```

`npm run dev` och `npm run build` kör först `scripts/setup-assets.mjs`, som kopierar MediaPipes
WASM-filer från `node_modules` och laddar ner modellerna `pose_landmarker_lite/full.task` och `efficientdet_lite0.tflite` samt objektdetektorn **en gång**
till `public/`. Därefter serveras allt från appens egen adress.

> Service workern (offline-läget) är bara aktiv i produktionsbygget (`build` + `preview` eller publicerad sajt).

## Använda appen

1. Tryck **Starta**. Först då frågar Safari om kamerabehörighet.
2. Appen känner igen **80 typer av saker** (EfficientDet-Lite0) och färgar dem efter kategori:
   **cyan = människa**, **grön = djur**, **orange = fordon**, **rosa = föremål**.
3. Varje sak får namn och säkerhet (t.ex. "Hund 86 %"), hastighet i **px/s**, riktning
   (höger/vänster/upp/ner), **närmar sig/avlägsnar sig** och hur länge den varit i bild.
4. Personer får dessutom ett **skelett** (MediaPipe Pose).
5. **✦ AI-analys** (kortet nederst) beskriver i klartext vad som händer, t.ex.
   "Människa 1 går åt vänster, mot kameran och håller i en mobil" eller "Hund 3 springer åt höger".
   - Aktivitet för personer: står still, går, springer, sitter, ligger ner, är på huk, hoppar, räcker upp handen.
   - Samspel: håller i föremål, cyklar, sitter i soffan/på stol, går med hunden, vid en bil, personer nära varandra.
   - Miljö gissas från föremålen (kök, vardagsrum, kontor, badrum, gata, natur …), ljusnivå och aktivitetsnivå.
   - Händelser loggas: "började springa", "satte sig", "Två personer möts" och **⚠ Möjligt fall**.
   - **Röst** (⚙︎) läser upp händelserna på svenska.
   Analysen är regelbaserad och körs lokalt – den kan ha fel och är ingen larmtjänst.
6. **Handhållen användning:** appen mäter din egen kamerarörelse (📷 stilla / rör sig / snabb rörelse) och
   drar bort den från objektens fart. km/h visas bara när kameran står stilla. Skärmen hålls tänd medan appen kör.
7. **◎ Skanna** samlar i 3 sekunder in allt som syns och visar en **lägesrapport** (vad, hur många, vad de gör,
   miljö, ljus, snabbast). Rapporten sparas i tidslinjen och kan läsas upp med rösten.
8. Överst i bilden visas en sammanfattning, t.ex. "1 människa · 2 djur".
9. **Tidslinje** visar allt som dykt upp, lämnat bilden, händelser, larm och rapporter. Den sparas i telefonen
   (bara text, aldrig bilder), kan filtreras och **exporteras som CSV** till Excel. **Rensa** tömmer den.
   En person som går ut och in räknas två gånger – appen identifierar aldrig individer.
10. **⚙︎ Inställningar**: röst på/av, CPU/GPU, skelett på/av, Snabb/Exakt skelettmodell, antal skelett och kalibrering.
11. **Bak ⇄ / Fram** byter kamera. Framkameran visas spegelvänd.

### km/h (uppskattning)

km/h visas **bara** när du har kalibrerat och bekräftat att kameran står stilla:

1. Ställ telefonen still (stativ eller stöd).
2. Tryck **⚙︎ › Kalibrera km/h › Markera punkter** och peka på två punkter i bilden med känt avstånd,
   t.ex. två koner 2 m isär på marken där personen ska röra sig.
3. Ange avståndet i meter, bocka i **Kameran står stilla** och tryck **Spara**.

Värdet märks alltid "uppskattning". Det stämmer bara för rörelse tvärs bilden på ungefär samma
avstånd från kameran som den kalibrerade sträckan. Byter du kamera eller upplösning slutar km/h visas
tills du kalibrerar om. Kalibreringen sparas inte mellan sessioner.

## Testa på iPhone (kräver säker anslutning)

Safari ger bara kameraåtkomst på **HTTPS** eller **localhost**. En vanlig `http://192.168.x.x`-adress
fungerar alltså **inte**. Välj ett av alternativen:

### Alternativ A – GitHub Pages (automatiskt, rekommenderas)

Repot innehåller `.github/workflows/axalmo-vision-pages.yml` som bygger och publicerar appen vid varje
push till `main` som rör `axalmo-vision/`. Engångsinställning: **Settings › Pages › Source: GitHub Actions**.
Adressen blir `https://axelmalmqvist95.github.io/weather-triage/`.

### Alternativ A2 – publicera manuellt

`dist/` är en helt statisk sajt. Kör `npm run build` och lägg upp mappen på en tjänst med HTTPS, t.ex.:

- **Netlify Drop**: dra mappen `dist` till https://app.netlify.com/drop
- **Cloudflare Pages** eller **GitHub Pages** (appen använder relativa sökvägar och fungerar i en undermapp)

Öppna adressen i Safari på iPhone. Bara appfilerna laddas upp – kamerabilden lämnar aldrig telefonen.

### Alternativ B – HTTPS i hemmanätverket med mkcert

1. Installera [mkcert](https://github.com/FiloSottile/mkcert) på datorn och kör:
   ```bash
   mkcert -install
   mkdir -p certs
   mkcert -cert-file certs/cert.pem -key-file certs/key.pem localhost 192.168.1.50   # din dators IP
   ```
2. Starta: `npm run build && npm run preview` (HTTPS aktiveras automatiskt när `certs/` finns).
3. Lita på certifikatet på iPhone:
   - Kör `mkcert -CAROOT` och skicka filen `rootCA.pem` till telefonen (t.ex. AirDrop).
   - Installera profilen: **Inställningar › Profil hämtad › Installera**.
   - Slå på: **Inställningar › Allmänt › Om › Certifikatförtroende** → aktivera mkcert.
4. Öppna `https://192.168.1.50:4173` i Safari (telefon och dator på samma wifi).

`certs/` och `*.pem` är ignorerade av git – checka aldrig in nycklar.

### Alternativ C – HTTPS-tunnel

Kör `npm run build && npm run preview` och starta en tunnel, t.ex.
`npx cloudflared tunnel --url http://localhost:4173`. Öppna den `https://…`-adress som skrivs ut.
Tunneln skickar bara appens filer; bildbehandlingen sker fortfarande lokalt i telefonen.

### Lägg till på hemskärmen

I Safari: **Dela › Lägg till på hemskärmen**. Öppna appen en gång med internet så att modellen cachas –
därefter fungerar den offline.

## Felsökning

| Meddelande | Åtgärd |
|---|---|
| "Kamerabehörighet nekades" | Inställningar › Safari › Kamera → Fråga/Tillåt, ladda om sidan. |
| "Kameran kräver säker anslutning" | Använd HTTPS enligt ovan. |
| "Kameran används redan av en annan app" | Stäng FaceTime/kamera-appen och försök igen. |
| "Modellen kunde inte laddas" | Första start kräver internet. Kontrollera anslutningen. |
| Låg FPS / hackigt | Under ⚙︎: prova **CPU**/**GPU**, stäng av skelett eller välj **Snabb**. God belysning hjälper. Appen kör 480×360. |

## Teknik i korthet

| Fil | Innehåll |
|---|---|
| `src/App.tsx` | UI, kamera (getUserMedia), huvudloop, kalibrering |
| `src/vision.ts` | Laddar objektdetektor och Pose Landmarker, vald delegat med den andra som reserv |
| `src/analyze.ts` | Lokal AI-analys: aktivitet, samspel, miljö, ljus, händelser och fall |
| `src/egomotion.ts` | Mäter kamerans egen rörelse (handhållen) för att kompensera objektens fart |
| `src/scan.ts` | Skanning och lägesrapport |
| `src/labels.ts` | Svenska namn och kategorier för de 80 klasserna |
| `src/filter.ts` | One Euro-filter som stabiliserar rutor och kroppspunkter |
| `src/tracker.ts` | Spårning per klass (IoU), hastighet, riktning, tid i bild, in/ut-händelser |
| `src/draw.ts` | Ritar skelett, rutor, pilar och etiketter på canvas; koordinatmappning |
| `sw/sw.js` | Service worker-mall; precache-listan genereras vid build (`vite.config.ts`) |
| `scripts/setup-assets.mjs` | Kopierar WASM och laddar ner modellen till `public/` |

Prestanda: överlägget ritas varje skärmuppdatering och förflyttas med uppmätt hastighet mellan analyserna;
inferensen får använda högst ~50 % av huvudtråden så att video och knappar förblir mjuka. Kroppspunkter jämnas ut mot darr. HUD uppdateras 4 ggr/s, canvasupplösning begränsad till 2× och kameran stoppas när appen
hamnar i bakgrunden.

## Axalmo Intelligence v0.1 (förhandsversion)

Separat vy för strukturerad fastighetsanalys. Öppnas via **INTEL ›** i Vision-vyns sidhuvud (eller `#/intelligence`).
Vision-delen och kamerans inferensflöde är oförändrade; Intelligence laddas som en egen kodbit först när den öppnas.

- **Ontologi** (`src/ontology/`): Fastighet → Yta (kan vara del av annan yta) → Observation, plus en append-only
  **händelselogg** som revisionsspår. Alla ändringar sker via *actions* som validerar schema, referenser,
  statusövergångar och en integritetspolicy (avvisar t.ex. personnummer, e-post, mobilnummer och persondatafält).
  Aktören är alltid en roll (inspektör/system) – ontologin har ingen persontyp.
- **Lagring**: lokal IndexedDB-databas `axalmo-intelligence` (separat från Vision). Export/import som JSON med
  schemaversion; import ersätter all data atomiskt.
- **Vy**: sökbar och filtrerbar händelselogg, detaljpanel och relationsgraf (SVG, ingen grafmotor) per fastighet.
- **Syntetisk testdata**: påhittade fastigheter skapas via samma actions som riktig data.

Tester (Node `node:test`, IndexedDB simuleras med utvecklingsberoendet `fake-indexeddb`):

```bash
npm test
```

## Axalmo OS v0.2 – Vision Memory (förhandsversion)

Arbetsflöde: **CAPTURE → MEMORY → RECALL → COMPARE**, för hem, bil, elektronik, förråd och egna projekt.

1. **Capture** – i Vision: starta kameran och **tryck på ett föremål** i bilden. Ett förslag visas med det
   kameran faktiskt såg (klass + säkerhet). Rätta arbetsyta, plats, föremål, observation och anteckning.
   Inget sparas förrän du trycker **Spara i minnet**. Personer kan inte sparas. Inga bilder sparas.
2. **Memory** – observationen kopplas till arbetsyta, plats och föremål med källa (`kamera`), tid och
   modellens säkerhet. Allt skrivs i en transaktion i samma lokala databas och händelselogg som Intelligence.
   Sparas ett befintligt föremål på en ny plats registreras en flytt.
3. **Recall** – Intelligence › **Minne**: sök bland godkända observationer och filtrera på arbetsyta, plats
   (inkl. underplatser), föremål och datum. Tryck på en rad för föremålets historik och relationer.
4. **Compare** – markera två observationer av samma föremål. Bara registrerade fält jämförs (status, plats,
   anteckning, metadata, modellens säkerhet). Visuella skillnader jämförs inte eftersom inga bilder finns.

**Datamodell v2** (bakåtkompatibel): fastigheter är arbetsytor (`kind`, standard `fastighet`), ytor är platser,
nya typer *föremål* och *relation*. IndexedDB uppgraderas v1 → v2 genom att bara lägga till lager och index;
v1-exporter (JSON) kan fortfarande importeras.
