# E.2B Preview Asset Provenance

This checkpoint does not include any third-party or hotlinked photography.

No safe, license-clear Istanbul destination photography was available to source locally within this environment without a network request to a third-party image host, and this preview must work with network access disabled. Rather than hotlinking arbitrary external images (unsafe, breaks offline behavior, and risks unclear licensing) or leaving empty gradient placeholders, this checkpoint uses original, hand-authored inline SVG illustrations.

## Assets

| File | Component | Description |
|---|---|---|
| `src/components/e2b-illustrations/e2b-illustrations.tsx` | `DestinationIllustration` | Three destination-themed vector scenes (skyline, bazaar arches, Bosphorus water/boat) |
| same file | `RouteVisualization` | An illustrative Baku → Istanbul route diagram, explicitly labeled "not a live map" |
| same file | `HotelIllustration` | An abstract façade/window-grid vector representing a boutique property |
| same file | `DiningIllustration` | An abstract plate/table-setting vector representing a dining scene |
| same file | `ExperienceIllustration` | Time-of-day (morning/afternoon/evening) abstract vector backdrops |

## Provenance

- **Creator:** authored directly for this checkpoint, VOYARA AI, 2026.
- **Source:** none — these are original inline SVG markup, not derived from any photograph, stock image, or third-party asset.
- **License:** proprietary to VOYARA AI, same as the rest of this repository's source code.
- **Usage constraint:** these illustrations must never be presented as, or mistaken for, real photography of an actual confirmed hotel, restaurant, or supplier property. Every card that uses them carries an explicit "illustrative" label in the UI.

## If real photography is added later

Any future addition of real destination photography must:
1. Record the exact source URL, creator, and organization in this file.
2. Confirm the license explicitly permits this commercial usage.
3. Store the optimized image locally under `public/` — never hotlink a third-party host at runtime.
4. Never imply the imagery represents a specific, confirmed, currently-available supplier product.
