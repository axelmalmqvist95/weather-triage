# Axalmo Vision 1.0

Mobilanpassad PWA (React + Vite + TypeScript) som visar livekamera med **lokal** kroppsspårning
(MediaPipe Pose Landmarker), markeringsrutor, rörelseriktning och uppskattad hastighet.

- Ingen backend, ingen API-nyckel, ingen molntjänst vid körning.
- All bildbehandling sker i telefonens webbläsare. Inga bilder sparas eller skickas.
- Ingen ansiktsigenkänning eller biometrisk identifiering. Personer får bara löpnummer (P1, P2 …).
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
WASM-filer från `node_modules` och laddar ner modellen `pose_landmarker_lite.task` (~6 MB) **en gång**
till `public/`. Därefter serveras allt från appens egen adress.

> Service workern (offline-läget) är bara aktiv i produktionsbygget (`build` + `preview` eller publicerad sajt).

## Använda appen

1. Tryck **Starta**. Först då frågar Safari om kamerabehörighet.
2. **Bakkamera ⇄ / Framkamera** byter kamera. Framkameran visas spegelvänd.
3. **1P / 2P / 3P** väljer hur många personer modellen letar efter. 1P är snabbast och rekommenderas på iPhone.
4. Varje person får skelett, markeringsruta, en pil för rörelseriktningen och hastighet i **px/s**.
   Riktning visas som höger/vänster/upp/ner samt "närmar sig/avlägsnar sig" (via ändrad axelbredd).
5. Överst visas FPS och modellstatus (GPU eller CPU). Under bilden visas inferenstid.

### km/h (uppskattning)

km/h visas **bara** när du har kalibrerat och bekräftat att kameran står stilla:

1. Ställ telefonen still (stativ eller stöd).
2. Tryck **Kalibrera** → **Markera** och peka på två punkter i bilden med känt avstånd,
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
| Låg FPS | Välj 1P, använd bakkameran och god belysning. Appen kör 640×480 för att spara prestanda. |

## Teknik i korthet

| Fil | Innehåll |
|---|---|
| `src/App.tsx` | UI, kamera (getUserMedia), huvudloop, kalibrering |
| `src/pose.ts` | Laddar Pose Landmarker (lite-modell), GPU med CPU som reserv |
| `src/tracker.ts` | Enkel spårning (närmaste-granne), utjämnad hastighet px/s, riktning |
| `src/draw.ts` | Ritar skelett, rutor, pilar och etiketter på canvas; koordinatmappning |
| `sw/sw.js` | Service worker-mall; precache-listan genereras vid build (`vite.config.ts`) |
| `scripts/setup-assets.mjs` | Kopierar WASM och laddar ner modellen till `public/` |

Prestanda: en inferens per ny videobildruta (`requestVideoFrameCallback` med `requestAnimationFrame`
som reserv), HUD uppdateras 4 ggr/s, canvasupplösning begränsad till 2× och kameran stoppas när appen
hamnar i bakgrunden.
