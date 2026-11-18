---
name: linkedin-vecka
description: Gör veckans tre LinkedIn-inlägg (måndag, tisdag, torsdag med Förvaltarens fråga) åt Axel Malmqvist, Nanostone AB, av bilder och filmer i hans LinkedIn-mapp. Använd när han ber om veckans inlägg, LinkedIn-inlägg, Förvaltarens fråga eller säger att han lagt in nytt material.
---

# Veckans LinkedIn-inlägg

Verktyget ligger i `linkedin-studio/` i det här repot. Läs `linkedin-studio/PLAYBOOK.md` innan du skriver något. Den är regelboken.

`<mapp>` är Axels LinkedIn-mapp med undermapparna `In`, `Klart` och `Arkiv`. Fråga efter sökvägen om du inte har den.

## Steg

1. **Granska materialet.** Kör `python3 linkedin-studio/studio.py granska <mapp>`. Öppna sedan varje bild i `<mapp>/_granskning/` och läs `oversikt.json`. Titta på bilderna på riktigt: vad syns, vilket material, vilken skada, vilken årstid. Läs anteckningar och `In/fragor.txt` om de finns.
2. **Fråga om det som saknas.** Fakta får bara komma från bilderna, filmerna, anteckningarna och det Axel säger. Ställ högst fem korta frågor på en gång. Hitta aldrig på svar. Det som inte går att belägga skrivs `[KONTROLLERA: påståendet]`.
3. **Planera veckan.** Måndag är Förra veckan i fält, tisdag Drift och ledarskap, torsdag Förvaltarens fråga med nästa löpande nummer (PLAYBOOK avsnitt 2, 5 och 7). Torsdagens fråga ska vara en verklig fråga: föreslå två eller tre och låt Axel välja. Har `resultat.csv` minst fyra veckor med ifyllda siffror: läs den och låt det som gett förfrågningar och kommentarer styra valet av format och ämne.
4. **Skriv texterna** enligt PLAYBOOK avsnitt 1 till 5 och jämför tonen med de godkända inläggen i avsnitt 6. Avsluta varje text med @Nanostone. För film: välj tidpunkter ur kontaktkartorna och skriv en textskylt per klipp.
5. **Skriv `plan.json`** (format: se `linkedin-studio/exempel-plan.json`) och kör
   `python3 linkedin-studio/studio.py bygg <mapp> plan.json`.
   Rätta alla rader märkta FEL och bygg om tills det går igenom.
6. **Kontrollera resultatet med egna ögon.** Öppna varje färdig bild, minst första och sista sidan i varje karusell och några rutor ur varje film. Text som krockar med märket, avskurna ansikten eller fel beskärning rättas med `fokus` eller kortare rubrik.
7. **Lämna över.** Visa de tre texterna i chatten, säg var filerna ligger och vad Axel behöver fylla i eller godkänna. Kör `bygg` med `--arkivera` först när han godkänt veckan.

## Regler

- Publicera aldrig själv. Axel lägger ut inläggen.
- Logotypen kommer bara från de officiella filerna i `linkedin-studio/assets/logo/`. Rita aldrig om den.
- Före/efter-bilder förbättras inte.
- Allt ska vara Nanostone: tjänster Nanostone utför och metoder ur Nanostones eget underlag. Osäkert skrivs `[KONTROLLERA: ...]`.
- Inga adresser, inga personnamn eller kundnamn, inga belopp eller ekonomisiffror. Personer beskrivs med roll.
- Granska varje bild och varje filmklipp efter husnummer, gatuskyltar, namnskyltar, brevlådor, registreringsskyltar och ansikten innan materialet används. Beskär bort det med `fokus` eller välj annat material, och säg till Axel vad som valdes bort och varför.
- Uppdatera numret för Förvaltarens fråga i PLAYBOOK avsnitt 5 när en ny fråga godkänts.
