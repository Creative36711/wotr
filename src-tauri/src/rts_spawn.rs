use serde_json::{json, Value};
use std::{f64::consts::PI, path::Path};

const OBJECT_NAME: &str = "WOTRTemporaryVictoryAnchor";
const INTERNAL_PATH: &str = r"data\ini\object\zzz_wotr\system\zzz_spawn.ini";
const HERO_RADIUS: f64 = 95.0;
const HERO_SPACING: f64 = 20.0;
const RING1_RADIUS: f64 = 140.0;
const RING_GAP: f64 = 70.0;
const MAX_PER_RING: usize = 8;

/// Full definition of the starting-gold crate, copied from the reference
/// bridge (spawn.py GOLD_BASE_OBJECT). Per-slot child objects override the
/// resource amount and make the crate permanent.
const GOLD_BASE_OBJECT: &str = r#"Object WOTR_StartingGold
  Draw = W3DScriptedModelDraw ModuleTag_01
    DefaultModelConditionState
      Model = PchestTreasure
      ParticleSysBone NONE GoldChestGlimmer
      ParticleSysBone NONE GoldChestAura
    End
  End
  EditorSorting   = MISC_MAN_MADE
  DisplayName     = OBJECT:TreasureChest
    Side          = Civilian
  KindOf = SELECTABLE PARACHUTABLE IMMOBILE NOT_AUTOACQUIRABLE UNATTACKABLE CRATE
  ThreatLevel = 0.0
  Body = HighlanderBody ModuleTag_04
    MaxHealth      = 1.0
  End
  Behavior = SalvageCrateCollide ModuleTag_02
    ForbiddenKindOf = PROJECTILE ENVIRONMENT IGNORED_IN_GUI
    ExecuteFX = FX_GoldChestPickup
    BannerChance = 10%
    LevelUpChance = 100%
    LevelUpRadius = 100.0
    ResourceChance = 20%
    MinResource = 25
    MaxResource = 75
    AllowAIPickup = No
  End
  Behavior = DeletionUpdate ModuleTag_03
    MinLifetime = 30000
    MaxLifetime = 35000
  End
  Geometry = BOX
  GeometryMajorRadius = 12.0
  GeometryMinorRadius = 12.0
  GeometryHeight = 12.0
  GeometryIsSmall = Yes
  Shadow          = SHADOW_VOLUME
End
"#;

fn gold_child(slot: i64, amount: i64) -> String {
    format!(
        "ChildObject WOTR_StartingGold_Player_{slot} WOTR_StartingGold\n\n    ReplaceModule ModuleTag_02\n\n        Behavior = SalvageCrateCollide ModuleTag_022\n\n            ForbiddenKindOf = PROJECTILE ENVIRONMENT IGNORED_IN_GUI NEUTRALGOLLUM\n            BannerChance = 0%\n            LevelUpChance = 0%\n            LevelUpRadius = 0.0\n            ResourceChance = 100%\n            MinResource = {amount}\n            MaxResource = {amount}\n            AllowAIPickup = Yes\n            ExecuteFX = FX_GoldChestPickup\n        End\n\n    End\n\n    ReplaceModule ModuleTag_03\n\n        Behavior = DeletionUpdate ModuleTag_033\n\n            MinLifetime = -1\n            MaxLifetime = -1\n        End\n\n    End\n\nEnd\n"
    )
}

fn command_point_child(slot: i64, points: i64) -> String {
    format!("ChildObject WOTR_CommandPointBonus_Player_{slot} WOTR_CommandPointBonus\n    CommandPointBonus = {points}\nEnd\n")
}

fn faction_upgrade(id: &str) -> &'static str {
    match id {
        "men-of-the-west" | "men" => "Upgrade_MenFaction",
        "elves" => "Upgrade_ElfFaction",
        "dwarves" => "Upgrade_DwarfFaction",
        "isengard" => "Upgrade_IsengardFaction",
        "mordor" => "Upgrade_MordorFaction",
        "goblins" => "Upgrade_WildFaction",
        "angmar" => "Upgrade_AngmarFaction",
        _ => "Upgrade_AllFactionUpgrade",
    }
}
fn unit_position(index: usize, total: usize, radius: f64, offset: f64) -> (i32, i32, i32) {
    let alpha = index as f64 * 360.0 / total.max(1) as f64 + offset;
    let rad = alpha * PI / 180.0;
    (
        (radius * rad.cos()).round() as i32,
        (-radius * rad.sin()).round() as i32,
        ((360.0 - alpha) % 360.0).round() as i32,
    )
}
fn hero_position(index: usize, total: usize, gate: f64) -> (i32, i32, i32) {
    let alpha = gate * PI / 180.0;
    let center_x = HERO_RADIUS * alpha.cos();
    let center_y = -HERO_RADIUS * alpha.sin();
    let tangent_x = alpha.sin();
    let tangent_y = alpha.cos();
    let middle = (total / 2) as isize;
    let offset = (index as isize - middle) as f64 * HERO_SPACING;
    (
        (center_x + offset * tangent_x).round() as i32,
        (center_y + offset * tangent_y).round() as i32,
        ((360.0 - gate) % 360.0).round() as i32,
    )
}
fn add(
    lines: &mut Vec<String>,
    tag: &mut usize,
    prefix: &str,
    trigger: &str,
    thing: &str,
    x: i32,
    y: i32,
    angle: Option<i32>,
) {
    lines.push("    AddModule".into());
    lines.push(format!(
        "        Behavior = ObjectCreationUpgrade ModuleTag_{prefix}{}",
        *tag
    ));
    lines.push(format!("            TriggeredBy  = {trigger}"));
    lines.push(format!("            ThingToSpawn = {thing}"));
    lines.push(format!("            Offset       = X:{x} Y:{y} Z:0"));
    if let Some(value) = angle {
        lines.push(format!("            Angle        = {value}"));
    }
    lines.push("        End".into());
    lines.push("    End".into());
    *tag += 1;
}
fn build_big(data: &[u8]) -> Vec<u8> {
    let name = INTERNAL_PATH.as_bytes();
    let header_len = 16usize;
    let entries_len = 8 + name.len() + 1;
    let data_start = header_len + entries_len;
    let total = data_start + data.len();
    let mut output = Vec::with_capacity(total);
    output.extend_from_slice(b"BIGF");
    output.extend_from_slice(&(total as u32).to_le_bytes());
    output.extend_from_slice(&1u32.to_be_bytes());
    output.extend_from_slice(&(data_start as u32).to_be_bytes());
    output.extend_from_slice(&(data_start as u32).to_be_bytes());
    output.extend_from_slice(&(data.len() as u32).to_be_bytes());
    output.extend_from_slice(name);
    output.push(0);
    output.extend_from_slice(data);
    output
}

pub fn generate(path: &Path, battle: &Value) -> Result<Value, String> {
    let participants = battle
        .get("participants")
        .and_then(Value::as_array)
        .ok_or("battleConfig participants are missing")?;
    let mut prelude: Vec<String> = vec!["; generated by War of the Ring Tauri bridge".into()];
    let mut needs_gold_base = false;
    for participant in participants {
        let slot = participant.get("slot").and_then(Value::as_i64).unwrap_or(0);
        let bonuses = participant.get("bonuses");
        let gold = bonuses
            .and_then(|value| value.get("startingResources"))
            .and_then(Value::as_i64)
            .unwrap_or(0);
        let command_points = bonuses
            .and_then(|value| value.get("commandPointBonus"))
            .and_then(Value::as_i64)
            .unwrap_or(0);
        if gold > 0 {
            needs_gold_base = true;
            prelude.push(gold_child(slot, gold));
        }
        if command_points > 0 {
            prelude.push(command_point_child(slot, command_points));
        }
    }
    if needs_gold_base {
        prelude.insert(1, GOLD_BASE_OBJECT.to_string());
    }
    let mut lines = prelude;
    lines.push(format!("Object {OBJECT_NAME}"));
    let mut tag = 0usize;
    for participant in participants {
        let faction = participant
            .get("factionId")
            .and_then(Value::as_str)
            .unwrap_or("");
        let trigger = faction_upgrade(faction);
        let gate = participant
            .get("gateAngleDeg")
            .and_then(Value::as_f64)
            .unwrap_or(45.0);
        let slot = participant.get("slot").and_then(Value::as_i64).unwrap_or(0);
        let bonuses = participant.get("bonuses");
        let bonus_int = |key: &str| {
            bonuses
                .and_then(|value| value.get(key))
                .and_then(Value::as_i64)
                .unwrap_or(0)
        };
        // Контекстные бонусы владельца локации (см. §2/§7 ТЗ).
        if bonus_int("startingResources") > 0 {
            add(&mut lines, &mut tag, "Gold", trigger, &format!("WOTR_StartingGold_Player_{slot}"), 0, 0, None);
        }
        if bonus_int("commandPointBonus") > 0 {
            add(&mut lines, &mut tag, "CP", trigger, &format!("WOTR_CommandPointBonus_Player_{slot}"), 0, 0, None);
        }
        if bonuses
            .and_then(|value| value.get("signalFire"))
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            add(&mut lines, &mut tag, "SignalFire", trigger, "SignalFire", 9999, 9999, None);
        }
        let start_pp = bonus_int("palantirStartingPoints");
        if start_pp > 0 {
            add(&mut lines, &mut tag, "StartPP", trigger, &format!("WOTR_StartPP_{start_pp}"), 0, 0, None);
        }
        let pp_rate = bonus_int("palantirIncomePerInterval");
        if pp_rate > 0 {
            add(&mut lines, &mut tag, "PPRate", trigger, &format!("WOTR_PPRate_{pp_rate}"), 0, 0, None);
        }
        let units = participant
            .get("units")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for (ring_index, batch) in units.chunks(MAX_PER_RING).enumerate() {
            let radius = RING1_RADIUS + ring_index as f64 * RING_GAP;
            let offset = if ring_index % 2 == 0 { 0.0 } else { 22.5 };
            for (index, item) in batch.iter().enumerate() {
                let object_id = item.get("objectId").and_then(Value::as_str).unwrap_or("");
                if object_id.is_empty() {
                    continue;
                }
                let (x, y, angle) = unit_position(index, batch.len(), radius, offset);
                add(
                    &mut lines,
                    &mut tag,
                    &format!("R{}U", ring_index + 1),
                    trigger,
                    object_id,
                    x,
                    y,
                    Some(angle),
                );
                for upgrade in item
                    .get("upgrades")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                {
                    add(
                        &mut lines,
                        &mut tag,
                        &format!("R{}A", ring_index + 1),
                        trigger,
                        upgrade,
                        x,
                        y,
                        None,
                    )
                }
                if let Some(level) = item
                    .get("level")
                    .and_then(Value::as_u64)
                    .filter(|level| *level >= 2)
                {
                    add(
                        &mut lines,
                        &mut tag,
                        &format!("R{}L", ring_index + 1),
                        trigger,
                        &format!("WOTR_Aura_Level{}", level.min(10)),
                        x,
                        y,
                        None,
                    )
                }
            }
        }
        let heroes = participant
            .get("heroes")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for (index, item) in heroes.iter().enumerate() {
            let object_id = item.get("objectId").and_then(Value::as_str).unwrap_or("");
            if object_id.is_empty() {
                continue;
            }
            let (x, y, angle) = hero_position(index, heroes.len(), gate);
            add(
                &mut lines,
                &mut tag,
                "H",
                trigger,
                object_id,
                x,
                y,
                Some(angle),
            );
        }
        // Носитель Кольца Всевластья появляется рядом с линией героев (§4.7).
        if let Some(ring_hero) = participant
            .get("ringHeroObjectId")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
        {
            let (x, y, angle) = hero_position(heroes.len(), heroes.len() + 1, gate);
            add(&mut lines, &mut tag, "Ring", trigger, ring_hero, x, y, Some(angle));
        }
    }
    lines.push("End".into());
    lines.push(String::new());
    let ini = lines.join("\n").into_bytes();
    let big = build_big(&ini);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?
    }
    std::fs::write(path, &big)
        .map_err(|error| format!("Failed to write generated RTS spawn file: {error}"))?;
    Ok(
        json!({"size":big.len(),"iniBytes":ini.len(),"objects":tag,"targetFileName":"__wotr_generated_presets.big"}),
    )
}
