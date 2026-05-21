# Stuck Products — Manual Dashboard Fix Needed

_Generated 2026-05-20 — 2 producten waar alle auto-fix paden (XPath / HTML AI / vision / vision-with-clicks) faalden._

Beide hebben een verkeerde sync-prijs in DB nu (van de eerdere AI-default-variant misread). Open het dashboard en zet de echte prijs handmatig + `manual_lock=true`.

## XXLNutrition — Perfect Whey Protein | 4kg

- **Huidige (foute) prijs in DB**: €23,99
- **Issue**: vision discovery zag knop "4000 gram" maar Playwright kon 'm niet klikken (timeout). Mogelijk ander label of complexe dropdown.
- Live URL: https://xxlnutrition.com/nl/perfect-whey-protein
- Edit: https://dashboard.gieriggroeien.nl/dashboard/products/edit/XWlUAmmqKqv8VTpkudF9
- Te doen: open URL, klik 4kg-variant, noteer prijs, zet in dashboard, vink `manual_lock=true`

## VanBeekumSpecerijen — Whey Protein met Smaak | 15kg

- **Huidige (foute) prijs in DB**: €34,99 (= 1KG prijs, NIET 15kg)
- **Issue**: vision discovery klikte op "15 KG - Zak (bulk verpakking)" maar pagina bleef "1 KG" tonen. Click matched waarschijnlijk een dropdown-option die de variant niet wisselt.
- Live URL: https://www.vanbeekumspecerijen.nl/nl/whey-protein-vanille.html?id=286990934
- Edit: https://dashboard.gieriggroeien.nl/dashboard/products/edit/9XVeGrt0gK5qCbX6cbpP
- Te doen: open URL, klik 15kg variant correct, noteer prijs, zet in dashboard, vink `manual_lock=true`

---

Na deze 2 → 0 stuck producten in het hele systeem.
