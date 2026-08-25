# Brief for Vision AI — place WOTR map objects on the hex grid

## Goal
Place every **Region**, **Domain** (владение) and **Stronghold** (оплот) from the approved catalog onto the project’s strategic map with correct axial hex IDs.

Do **not** invent a new grid. Use the project grid exactly.

---

## 1. Grid specification (hard constraints)

| Parameter | Value |
|---|---|
| Map image size | **5120 × 4115** px |
| Pixel origin | **Top-left** = (0,0); **X right**, **Y down** |
| Hex orientation | **Pointy-top** axial |
| Hex size | **72** px (center → vertex) |
| Axial origin | Hex `0:0` center is at pixel **(36, 36)** |
| Hex ID format | `"{q}:{r}"` e.g. `12:28`, `-2:15` |

### Pixel center of hex (q, r)

```text
x = 36 + 72 * sqrt(3) * (q + r / 2)
y = 36 + 72 * 1.5 * r
```

### Pixel → hex

```text
px = (x - 36) / 72
py = (y - 36) / 72
q  = (sqrt(3)/3)*px - (1/3)*py
r  = (2/3)*py
then cube-round to nearest integer axial (standard hex round)
id = f"{q}:{r}"
```

### Placement rules
- Only **land** hexes (not water). If a click lands on water, snap to nearest land hex.
- **One object per hex** (domain or stronghold).
- A **stronghold** occupies exactly 1 hex.
- A **domain** has an **anchor hex** (center); its territory hexes are filled later by the game (nearest-domain inside region).
- A **region** is a set of land hexes; every land hex belongs to exactly one region.
- Domains/strongholds must sit **inside** their region.

---

## 2. Images to send the vision model (all of them)

1. **`public/templates/map.jpg`** (or active mod map) — the **exact** 5120×4115 image used in the game. This is the coordinate ground truth.
2. **`_tools/information map.jpg`** — labeled reference (regions / geography). Use for **names and relative layout only**, not for pixel math.
3. Optional: a third Tolkien atlas screenshot if labels are unclear — again, **relative only**.

**Critical:** All pixel measurements and hex IDs must be computed on image (1) only. Image (2) may have different crop, scale, or projection.

---

## 3. Recommended workflow (step by step)

### Step A — Calibrate
On image (1), pick 4–6 **obvious landmarks** that already exist in `world.json` (manual baseline), e.g.:
- Minas Tirith, Edoras, Helm’s Deep, Isengard, Rivendell, Barad-dûr, Grey Havens, Erebor

For each: mark pixel (x,y) of the settlement on the game map → convert to `{q}:{r}` with the formula → compare to `world.json` baseline.  
If error > 1 hex, fix the click (not the formula).

### Step B — Regions (paint first)
For each of the **14 catalog regions**, produce a list of land hex IDs:
- Prefer painting along natural borders (mountains, big rivers, coasts) visible on image (1).
- Use image (2) only to know *which* area is “Lindon” vs “Eriador”.
- Output:

```json
{ "id": "region-lindon", "name": "Lindon", "hexes": ["q:r", "..."], "color": "#......" }
```

Validation: every land hex in the authored grid appears in exactly one region.

### Step C — Objects (anchors)
For each domain and stronghold in the catalog:
1. Find the place on image (2) by name.
2. Find the **same place** on image (1).
3. Click the center → convert to hex ID.
4. Ensure the hex is land and inside the correct region.
5. Ensure unique hexes.

Output:

```json
{
  "id": "mithlond",
  "structuralType": "stronghold",
  "name": "Mithlond",
  "nameTranslations": { "ru": "Митлонд (Серые Гавани)" },
  "hex": "2:12",
  "regionId": "region-lindon",
  "economicType": "port"
}
```

### Step D — Do not flood-fill domains yourself
Only anchors + region hex lists. The game regenerates domain `hexes[]` inside each region.

---

## 4. Output file format (single JSON)

```json
{
  "grid": {
    "worldWidth": 5120,
    "worldHeight": 4115,
    "size": 72,
    "originX": 36,
    "originY": 36,
    "orientation": "pointy"
  },
  "regions": [ { "id", "name", "nameTranslations", "color", "hexes": [] } ],
  "mapObjects": [
    {
      "id": "kebab-case-english-id",
      "structuralType": "domain" | "stronghold",
      "name": "English canonical name",
      "nameTranslations": { "ru": "..." },
      "hex": "q:r",
      "regionId": "region-...",
      "economicType": "capital|city|fortress|village|port|mine|farm|wilderness|forest|ruins|ford|pass|camp|signal_tower|crossroads",
      "notes": "optional landmark used"
    }
  ],
  "calibration": [
    { "id": "minas-tirith", "pixel": [x,y], "hex": "q:r", "matchesBaseline": true }
  ]
}
```

IDs: stable English kebab-case. Names: English canonical + `nameTranslations.ru`.

---

## 5. Catalog regions (14) — target structure

1. Lindon  
2. Eriador  
3. Angmar  
4. Forodwaith  
5. Misty Mountains  
6. Enedwaith  
7. Dunland  
8. Rohan  
9. Gondor  
10. Mordor  
11. Rhovanion  
12. Mirkwood  
13. Harad  
14. Rhûn  

(Full domain/stronghold lists are in the user message / design doc. Rivers/roads are labels only for now — not separate entities.)

---

## 6. What NOT to do
- Do not use free-form x%, y% without converting through the hex formula.
- Do not place objects from the information map’s pixels as if they were the game map.
- Do not put two objects on one hex.
- Do not leave land hexes outside all regions.
- Do not auto-generate 100+ objects by nearest-seed from a few wrong anchors.

---

## 7. After vision AI returns JSON
A separate code pass will:
- merge into `public/mods/default/world.json`
- regenerate domain territories
- validate coverage / uniqueness
- bump data version if the object set changes
