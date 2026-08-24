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
Application: 0.42.0
world.json: 30
roster.json: 14
savegame.json: 29
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

Names are never IDs. Factions, locations, units, heroes, captains, armies, and regions keep stable technical IDs separately.

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

### Structural types

Every map object has one structural type:

```text
domain      — owns a surrounding region
stronghold  — owns only its single hex
```

Example:

```json
{
  "id": "helms-deep",
  "structuralType": "stronghold",
  "economicType": "fortress",
  "hex": "12:28"
}
```

A domain creates a region. Capturing the domain transfers the whole region.

A stronghold never creates a region. Capturing it transfers only its own hex.

### Hex positioning

Objects no longer store free `x` and `y` map percentages. Their position is a stable axial hex ID:

```json
"hex": "12:28"
```

The rendered pixel position is derived from the center of that hex.

Editor rules:

- every new object snaps to the nearest hex center;
- dragging always snaps to a hex;
- one map object per hex;
- occupied targets are shown in red and rejected;
- free targets are shown in green;
- moving or deleting a domain rebuilds region ownership;
- moving or deleting a stronghold affects only its own hex.

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

A fortress icon therefore may represent either a domain-fortress or a stronghold-fortress. Their capture behavior remains different.

## Regions

Regions exist only for domains. Their IDs are derived from domain IDs:

```text
region-<domain-id>
```

Unmodified hexes are assigned to the nearest domain. A stronghold hex is removed from domain regions and rendered as a one-hex control island above the regional fill.

Region and stronghold ownership is reflected in:

- map fill and borders;
- capture rules;
- fog of war;
- income;
- recruitment and occupation;
- strategic battle context.

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

Each map object stores exactly one MapCache. The same cache is used:

- on the domain center;
- anywhere inside that domain region;
- on the single stronghold hex.

There is no separate “location cache” versus “region cache” model.

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

- domains and strongholds;
- economic types;
- hex terrain and infrastructure;
- factions and fixed BFME colors;
- units and BFME Object IDs;
- heroes, titles, unlock rules, and summoning;
- captains and localized name pools;
- starting armies;
- domain regions;
- mod RTS files and per-object MapCaches.

Technical IDs remain automatic and stable. BFME Object IDs remain editable only where required for integration.

## Current limitations

- RTS results are not yet imported back into the global campaign.
- Strategic unit levels and upgrades are not yet persistent; generated RTS units currently use level 1.
- Only map objects with user-supplied current MapCache and shared maps BIG can launch RTS battles.
- The strategic AI difficulty setting is stored but strategic behavior is currently shared between difficulty levels.
