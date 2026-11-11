# Regelbok för LinkedIn-inlägg

Gäller alla inlägg som systemet skriver åt Axel Malmqvist, Nanostone AB.
Rader märkta **[BEKRÄFTA]** är antaganden som Axel ska godkänna eller ändra.

## 1. Målgrupp

Förvaltare, styrelser i bostadsrättsföreningar och fastighetsägare. **[BEKRÄFTA]**
De läser i mobilen, mellan två möten, och vill ha något de kan använda i sitt eget hus.

## 2. Veckorytm

| Dag | Typ | Bästa format |
|---|---|---|
| Måndag | Från fältet: ett jobb, ett problem, vad vi gjorde, hur det blev **[BEKRÄFTA]** | Före/efter-bild eller kort film |
| Tisdag | Kunskap: en sak förvaltaren kan kontrollera eller besluta om själv **[BEKRÄFTA]** | Karusell (PDF) eller bild med rubrik |
| Torsdag | **Förvaltarens fråga** (fast serie, se avsnitt 6) | Frågekort, vid behov karusell eller film |

## 3. Det som skiljer ett riktigt inlägg från ett AI-inlägg

Ett inlägg publiceras bara om det innehåller **minst två uppgifter som bara Nanostone kan känna till**:

- en siffra från jobbet (yta, ålder på taket, antal dagar, temperatur, antal lägenheter)
- material eller skadebild med rätt namn (betongpannor, puts, alger på norrsidan)
- något som gick fel eller överraskade
- vad kunden sa eller frågade, återgivet som det sades
- ort eller typ av fastighet

Uppgifterna hämtas ur bilderna, filmerna och anteckningarna i `In`. Finns de inte där frågar systemet Axel.
Saknas svaret skrivs `[FYLL I: vad som saknas]`. **Ingenting hittas på: inga siffror, inga kunder, inga citat.**

Kundnamn, adresser, registreringsskyltar och ansikten används bara när Axel har sagt att kunden gett sitt ok.

## 4. Så byggs texten

1. **Första raden** bär hela inlägget. Högst cirka 140 tecken, annars klipps den i mobilen. Den ska vara ett konkret påstående, en siffra eller en fråga som en förvaltare faktiskt har ställt. Ingen uppvärmning.
2. **En poäng per inlägg.** Hellre tre inlägg om tre saker än ett om allt.
3. **Korta stycken**, 1 till 3 meningar, med blankrad mellan.
4. **Slutet** är antingen en konkret fråga som går att svara på med egen erfarenhet ("Hur gammalt är taket på er fastighet?") eller ingenting. Aldrig "Vad tycker ni?".
5. Längd: 600 till 1 300 tecken för vanliga inlägg. Kortare om bilden säger det mesta.
6. Högst 3 hashtaggar, sist. Länkar läggs i första kommentaren.
7. Högst 2 emojier, aldrig som punktlista.

## 5. Ton

Axels egen: rak, saklig, kunnig, utan säljspråk.

- Första meningen säger vad det gäller.
- Starka formuleringar, inga onödiga förbehåll.
- Aldrig tankstreck. Punkt, komma eller kolon.
- Siffror före adjektiv.
- "Vi" om Nanostone, "jag" när det är Axels egen iakttagelse.
- Förbjudet: "i dagens ...", "vi är stolta över", "glada att meddela", "spännande resa", "helhetslösning", "skräddarsydda lösningar", "det handlar inte om X utan om Y", "inte bara X utan också Y".

`studio.py kontroll` stoppar texter som bryter mot detta.

## 6. Förvaltarens fråga (torsdag)

**[BEKRÄFTA]** Formatet nedan är ett förslag. Det justeras efter två eller tre av Axels tidigare inlägg i serien.

```
Förvaltarens fråga: <frågan, som förvaltaren ställde den>

<Kort svar på en rad: ja, nej eller det beror på, och på vad.>

<Varför, 2 till 3 meningar. En siffra eller ett exempel från ett verkligt jobb.>

<Vad förvaltaren själv kan göra eller kontrollera.>

<När det är dags att ta hjälp.>

Har du en fråga till nästa torsdag? Skriv den i en kommentar.
```

- Frågan ska vara verklig: från ett kundsamtal, ett mejl eller en kommentar. Systemet föreslår frågor men Axel väljer.
- Bilden är ett frågekort (`"typ": "fraga"`) med löpande nummer, så att serien känns igen i flödet.
- Kommentarer med nya frågor sparas i `In/fragor.txt` och blir kommande torsdagar.

## 7. Val av bild och film

| Material i `In` | Gör så här |
|---|---|
| En före- och en efterbild från samma vinkel | `fore-efter`. Bilderna förbättras aldrig, jämförelsen ska vara ärlig |
| En stark bild | `bild`, med rubrik om bilden behöver förklaras |
| Flera bilder som visar steg eller tecken | `karusell`, 6 till 10 sidor, en sak per sida |
| Filmklipp | `film`, 20 till 60 sekunder, rubriken syns de första 3 sekunderna, textskylt på varje klipp eftersom de flesta tittar utan ljud |
| Inget material | Rent textinlägg eller frågekort |

Stående format (4:5) är standard eftersom det tar störst plats i mobilflödet.

## 8. Vad som faktiskt fungerar

Offentliga uppgifter om vilka format LinkedIn gynnar kommer mest från byråbloggar och säger emot varandra.
De flesta pekar på att karuseller (dokument) når längst och att länkar i texten sänker räckvidden, medan uppgifterna om film går isär.
Det enda som räknas är därför Axels egna siffror:

1. Varje inlägg läggs som en rad i `resultat.csv` när veckan byggs.
2. En vecka efter publicering fyller Axel i visningar, reaktioner, kommentarer, delningar och förfrågningar.
3. Efter fyra veckor jämför systemet format och ämnen och justerar nästa månads plan efter det. Förfrågningar väger tyngst, sedan kommentarer.
