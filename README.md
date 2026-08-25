# War of the Ring Remaster

A portable desktop remaster of **War of the Ring** for *The Battle for Middle-earth II: The Rise of the Witch-king 2.01*.

The project combines:

- a global turn-based strategy;
- a complete world and roster editor;
- isolated user mods;
- portable Tauri desktop packaging;
- a native Windows bridge that prepares and launches real ROTWK battles.

## Current data versions

```text
Application: 0.44.0
world.json: 31
roster.json: 14
savegame.json: 30
```

Campaign saves are compatible only with the same application version, save version, and mod ID. A new application version intentionally starts a new campaign: old saves are reported as incompatible instead of being migrated.

## Development

```powershell
cd C:\Projects\wotr
npm ci
npm run dev
```

`npm run dev` runs the global strategy and editor in a browser. A browser cannot launch a local BFME executable.

For real RTS integration:

```powershell
npm run tauri:dev
```

Portable Windows build:

```powershell
npm run desktop:portable
```

The application is portable-only. User data is stored beside the executable:

```text
<exe directory>\portable_data\
```

The application does not use AppData as a fallback for its own data. ROTWK itself still uses its normal AppData profile for `NetworkPref.ini` and `Options.ini`.

## First launch and localization

On first launch the user chooses:

```text
English
Russian
```

English is canonical for all editable game content. Other languages are stored in locale maps:

```json
{
  "id": "helms-deep",
  "name": "Helm's Deep",
  "nameTranslations": {
    "ru": "Хельмова Падь"
  }
}
```

Names are never IDs. Factions, map objects (domains/strongholds), units, heroes, captains, armies, and regions keep stable technical IDs separately.

The same architecture supports future locales without new schema fields:

```json
{
  "nameTranslations": {
    "ru": "Хельмова Падь",
    "fr": "...",
    "de": "..."
  }
}
```

The editor displays only the field for the currently selected language.

## Mods

Each mod is isolated under:

```text
portable_data\mods\<mod-id>\
```

A mod contains:

```text
mod.json
world.json
roster.json
saves\autosave.json
rts\
```

The built-in `Vanilla 2.01` mod contains world and roster data only. **No MapCache, module BIG, or maps BIG files are bundled.** Mod authors must supply current RTS assets themselves. The elevated deployment helper also removes obsolete `__wotr_ini.big`, `__wotr_maps.big`, and `__wotr_maps_cache.big` copies from the external game folder unless the active mod explicitly supplies a file with the same target name.

## World model

### Hierarchy: Region → Domain / Stronghold

The map uses a two-level territorial model. There is no separate “continent” entity — Middle-earth is implied by the map image.

```text
Region (Eriador)
 ├── Domain (Shire)        — multi-hex holding, auto-generated inside the region
 ├── Domain (Bree)
 ├── Stronghold (Weathertop) — single hex inside the region, never part of a domain
 └── ...
```

Glossary (English ID → Russian UI):

| ID | UI | Meaning |
| --- | --- | --- |
| `region` | Регион | Named set of land hexes, authored by the modder |
| `domain` | Владение | Anchor hex + auto-generated hexes inside one region |
| `stronghold` | Оплот | Single-hex object inside a region |
| `hex` | Гекс | Map grid cell |
| map object | Объект карты | Domain or stronghold together |

Rules:

- every land hex belongs to exactly one region; water hexes may be outside regions;
- a domain’s hexes are generated automatically and never cross region borders;
- a stronghold occupies one hex, belongs to a region, and is excluded from every domain;
- a region with no domains is allowed (wild land, no income);
- full regional control is derived when every domain and stronghold inside the region belongs to the same faction (bonuses may use this later).

### Structural types

Every map object has one structural type:

```text
domain      — multi-hex holding inside a region
stronghold  — single-hex holding inside a region
```

Example domain:

```json
{
  "id": "shire",
  "structuralType": "domain",
  "economicType": "farm",
  "hex": "5:14",
  "regionId": "region-eriador",
  "hexes": ["4:13", "5:13", "5:14", "6:14"]
}
```

Example stronghold:

```json
{
  "id": "helms-deep",
  "structuralType": "stronghold",
  "economicType": "fortress",
  "hex": "7:25",
  "regionId": "region-rohan"
}
```

Capturing a domain transfers its hexes and income. Capturing a stronghold transfers only its hex. There is no separate “capture region” action — regional control changes through its objects.

### Hex positioning

Objects store a stable axial hex ID for the anchor:

```json
"hex": "12:28"
```

The rendered pixel position is derived from the center of that hex.

Editor rules:

- every new object snaps to the nearest hex center inside a region;
- dragging always snaps to a hex;
- one map object per hex;
- occupied targets are shown in red and rejected;
- free targets are shown in green;
- moving an object updates `regionId` and regenerates domain hexes;
- stronghold hexes are carved out of surrounding domains.

### Economic types and icons

Structural behavior and economic behavior are independent. `economicType` controls icon, income, recruitment, queue size, and reserve capacity.

Domain-oriented types:

```text
capital, city, fortress, village, mine, farm, port,
wilderness, swamp, forest, mountains
```

Stronghold-oriented types:

```text
fortress, ruins, crossroads, ford, pass, signal_tower, camp
```

A fortress icon therefore may represent either a domain-fortress or a stronghold-fortress. Their capture footprint remains different.

## Regions

Regions are a first-class authored array in `world.json`:

```json
{
  "id": "region-eriador",
  "name": "Eriador",
  "nameTranslations": { "ru": "Эриадор" },
  "hexes": ["3:5", "3:6", "4:5"],
  "color": "#6B8E6B"
}
```

Vanilla 2.01 ships ten regions: Eriador, Angmar, Rhovanion, Enedwaith, Rohan, Gondor, Ithilien, Mordor, Harad, Rhûn.

The editor provides a **Regions** tab to create regions, edit names/colors/descriptions, paint hex membership (via hex selection on the map), and delete empty regions. Uncovered land hexes are invalid for a finished map.

Visualization layers when the region overlay is on:

1. map image  
2. hex grid (optional)  
3. region fill (~15%) and thick region borders  
4. domain fill (~30% owner color) and thin domain borders  
5. stronghold hex fill  
6. object icons, armies, order arrows  

Region names are drawn large and translucent near the region centroid and hide at high zoom.

Ownership, fog of war, income, recruitment, and battle context all use domains and strongholds. A region only aggregates them for full-control checks and labels.

## Campaign turn

The player sees a single coherent turn instead of separate planning and movement screens.

During **Your Turn**, the player may in any order:

- recruit units;
- manage reserves;
- summon heroes;
- form or disband armies;
- assign movement orders.

The main action is:

```text
End Turn
```

After it is pressed, the engine automatically:

1. executes player movement orders;
2. runs AI planning and movement;
3. scans conflict hexes;
4. resolves AI-only battles;
5. opens player battles;
6. applies retreats, captures, occupation, casualties, injuries, economy, and victory checks;
7. displays a turn summary;
8. starts the next player turn after Continue.

## Deferred movement orders

Clicking a destination creates or replaces a pending order. The army stays on its current hex until **End Turn**.

Orders are stored in `savegame.json`:

```json
{
  "pendingOrders": [
    {
      "armyId": "army-id",
      "destinationHexId": "12:28",
      "path": ["10:27", "11:27", "12:28"],
      "cost": 5,
      "locationId": "helms-deep"
    }
  ]
}
```

Behavior:

- the order is rendered as a solid faction-colored arrow with an arrowhead, drawn above the fog-of-war overlay so orders into unexplored hexes stay visible;
- after an order is placed the map returns from the tactical view to the cinematic view while the arrow remains on screen;
- assigning another destination replaces the previous order;
- right-clicking the arrow or army cancels it;
- canceling costs no movement points;
- paths longer than the current movement allowance stop at the furthest reachable intermediate hex;
- the player may continue the route on the next turn;
- orders are validated again when executed.

Allied AI armies pre-compute their marches at the start of the planning phase. During planning these plans are rendered as muted dashed arrows with arrowheads:

- only plans that start from a hex visible to the player are shown, so the fog of war is not leaked;
- allied arrows are view-only; hovering shows the faction, commander, destination, and distance;
- plans are executed during the movement phase and discarded afterwards; a plan that becomes invalid (blocked path, intercepted hex) falls back to fresh AI targeting, and the preview refreshes on the next round.

After **End Turn**, the turn summary lists the movements of every faction — the player, allies, and enemies — regardless of fog: `Faction: commander — march/siege/retreat/stay (distance)`.

Economic settlement pins use dedicated silhouette SVG icons (village, city, capital, port, mine, farm, wilderness, swamp, forest, mountains, ruins, crossroads, ford, pass, signal tower, camp) styled like the army banner and the fortress keep.

## Heroes

Hero campaign states include:

```text
locked, available, active, wounded, dead
```

Wounded heroes are removed from combat armies but remain visible in the **Wounded Heroes** panel. It shows:

- hero name and portrait;
- turns remaining;
- recovery location.

When recovery reaches zero, the hero returns to the appropriate reserve.

## BFME / ROTWK integration

### User-side executable

The ROTWK executable path is a local machine setting and is never exported with a mod.

The application can discover common installations and Windows registry paths or ask the user to select:

```text
lotrbfme2ep1.exe
```

### Required mod assets

No RTS files are preinstalled. A mod author provides:

- zero or more module BIG files;
- one shared BIG containing all supported maps;
- one MapCache BIG for each domain or stronghold that supports RTS battles.

Each map object stores exactly one MapCache. The same cache is used on the object’s anchor hex and as the battle map when a fight is resolved on that object (or on one of its domain hexes). Regions themselves do not store MapCaches.

### Elevated deployment

Windows protects installations under `Program Files`. Before an RTS battle, WOTR starts one elevated helper through UAC. That helper:

1. validates source assets;
2. copies/replaces BIG files in the game directory;
3. installs the selected active MapCache;
4. generates and installs `wotr_generated_presets.big`;
5. writes `NetworkPref.ini` in the real user profile;
6. launches ROTWK;
7. configures the room and starts the match.

### NetworkPref.ini

The current default rules are:

```text
0 0 0 400 1000 -1 -1 -1 -1 -1
```

The bridge writes:

```text
Rts:Rules
Rts:PlayerTemplate
Rts:Color
```

The real pre-elevation AppData path is passed to the elevated helper. Registry `UserDataLeafName`, known folder names, and profile scanning are used as fallbacks.

The player faction and color are not clicked again in the room because `NetworkPref.ini` already controls the first slot. This avoids duplicate first-slot clicks.

### Visual menu readiness

The bridge does not use a fixed main-menu delay. It embeds:

```text
src-tauri/assets/menu_marker.npy
src-tauri/assets/menu_marker.json
```

After the real `game.dat` window appears, Rust captures the target screen region through Win32 GDI once per second.

Parameters:

```text
required pixel match: 85%
per-channel tolerance: 30
poll interval: 1 second
timeout: 60 seconds
```

If the marker does not appear, automation stops instead of clicking an unready screen.

### Input protection

During automation, low-level Windows keyboard and mouse hooks block physical input while allowing WOTR-generated `SendInput` events identified by a private marker. `Ctrl+Alt+Del` remains available as an emergency escape.

### Generated RTS deployment

`wotr_generated_presets.big` is built per battle and contains:

```text
data\ini\object\system\systemwotr_spawn.ini
```

Strategic units are arranged in concentric rings. Heroes are arranged near the configured gate direction. Unit levels and aura upgrades are supported by the generated format; current strategic slots use level 1 until persistent level/upgrade data is added to the campaign model.

## Editor

The editor manages:

- top-level regions (hex painting, colors, names);
- domains and strongholds inside regions;
- economic types;
- hex terrain and infrastructure;
- factions: a free global-map color (picker plus palette; the color must stay unique per faction — a taken shade is auto-adjusted to the nearest free one) separately from the fixed BFME RTS color, which may repeat;
- units and BFME Object IDs;
- heroes, titles, unlock rules, and summoning;
- captains and localized name pools;
- starting armies;
- mod RTS files and per-object MapCaches.

Technical IDs remain automatic and stable. BFME Object IDs remain editable only where required for integration.

## Current limitations

- RTS results are not yet imported back into the global campaign.
- Strategic unit levels and upgrades are not yet persistent; generated RTS units currently use level 1.
- Only map objects with user-supplied current MapCache and shared maps BIG can launch RTS battles.
- The strategic AI difficulty setting is stored but strategic behavior is currently shared between difficulty levels.
