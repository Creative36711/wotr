# QA: middle_earth_world.json (vision AI pass)

**Status: REJECTED for full apply.** Baseline hand-placed `world.json` (0.44 first) is kept.

## What the file contains
- Correct grid block (5120×4115, size 72, origin 36,36, pointy)
- 6 calibration points (formula-consistent with claimed hexes)
- 14 regions with partial hex lists
- 105 mapObjects (66 domain + 39 stronghold)

## Critical failures

| Check | Result |
|---|---|
| Calibration vs hand baseline | **Fail** — 3–6 hex error on every known landmark, but flagged `matchesBaseline: true` |
| Land coverage by regions | **147 / 537** land hexes (~27%) |
| Region hexes on water / missing | Many (e.g. Lindon 0 land / 18 listed) |
| Objects on land | **41 / 105** only; **64** on water or outside authored grid |
| Object collisions | 0 (good) |
| Shared IDs vs baseline | Almost all shifted 2–6 hexes |

### Calibration (claimed vs your hand placement)

| id | baseline | AI | Δ |
|---|---|---|---|
| minas-tirith | 14:27 | 12:31 | ~4 |
| edoras | 9:26 | 5:28 | ~4 |
| helms-deep | 7:25 | 4:28 | ~3 |
| isengard | 8:22 | 4:25 | ~4 |
| rivendell | 13:14 | 12:12 | ~3 |
| barad-dur | 22:25 | 20:29 | ~4 |

Pixel→hex math is fine; **clicks on the game map are systematically wrong** (or the model looked at the wrong image).

## Recommendation for next vision pass
1. Overlay a **hex grid PNG** exported from the game (or draw centers of baseline objects as red dots on map.jpg) so the model can see the actual grid.
2. Require calibration error ≤ 1 hex vs baseline before painting anything else.
3. Paint regions only on **land** hex IDs that exist in `world.json` `grid.cells`.
4. Return objects only after regions cover ≥ 95% land.

## Safe merge strategy (if we proceed partially)
- Keep all baseline object hexes untouched.
- Only add **AI-only ids** after snapping to nearest free land hex inside a valid region.
- Rebuild region hexes ourselves from seeds (objects + manual borders), not from the incomplete AI lists.
