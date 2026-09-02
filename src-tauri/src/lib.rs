use std::{fs, fs::OpenOptions, io::Write, path::{Path, PathBuf}, process::Command};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
mod bfme_automation;
mod rts_spawn;

const DEFAULT_WORLD: &str = include_str!("../../public/mods/default/world.json");
const DEFAULT_ROSTER: &str = include_str!("../../public/mods/default/roster.json");
const DEFAULT_MOD: &str = include_str!("../../public/mods/default/mod.json");
const DEFAULT_APP: &str = include_str!("../../public/app.json");
const DEFAULT_MAP: &[u8] = include_bytes!("../../public/templates/map.jpg");
const WORLD_TEMPLATE: &str = include_str!("../../public/templates/world_template.json");
const ROSTER_TEMPLATE: &str = include_str!("../../public/templates/roster_template.json");
const GAME_VERSION: &str = "0.46.7";
const SAVE_VERSION: u64 = 29;

fn executable_dir() -> Result<PathBuf, String> {
    let executable = std::env::current_exe().map_err(|error| format!("Не удалось определить путь EXE: {error}"))?;
    executable.parent().map(Path::to_path_buf).ok_or_else(|| "Не удалось определить папку приложения".to_string())
}

fn data_root(_app: &AppHandle) -> Result<PathBuf, String> {
    let executable_dir = executable_dir()?;
    let root = executable_dir.join("portable_data");
    fs::create_dir_all(&root).map_err(|error| format!(
        "Не удалось создать portable_data рядом с приложением.\nПапка: {}\nОшибка: {}\n\nПереместите EXE в папку с правом записи, например D:\\Games\\WOTR или Документы.",
        executable_dir.display(), error
    ))?;
    let test_path = root.join(".write_test");
    let mut test = OpenOptions::new().create(true).write(true).truncate(true).open(&test_path).map_err(|error| format!(
        "Папка приложения недоступна для записи.\nПапка данных: {}\nОшибка: {}\n\nПереместите EXE вместе с portable_data в доступную для записи папку.",
        root.display(), error
    ))?;
    test.write_all(b"write-ok").map_err(|error| format!("Не удалось проверить запись в {}: {error}", root.display()))?;
    drop(test);
    let _ = fs::remove_file(test_path);
    Ok(root)
}
fn safe_id(id:&str)->Result<(),String>{if id.len()<2||id.len()>64||!id.chars().all(|c|c.is_ascii_lowercase()||c.is_ascii_digit()||c=='-'){Err("Недопустимый ID мода".into())}else{Ok(())}}
fn mods_root(app:&AppHandle)->Result<PathBuf,String>{let root=data_root(app)?.join("mods");fs::create_dir_all(&root).map_err(|e|e.to_string())?;Ok(root)}
fn mod_root(app:&AppHandle,id:&str)->Result<PathBuf,String>{safe_id(id)?;Ok(mods_root(app)?.join(id))}
fn mod_file(app:&AppHandle,id:&str,kind:&str)->Result<PathBuf,String>{let root=mod_root(app,id)?;match kind{"world"=>Ok(root.join("world.json")),"roster"=>Ok(root.join("roster.json")),"savegame"=>Ok(root.join("saves").join("autosave.json")),"mod"=>Ok(root.join("mod.json")),_=>Err("Неизвестный файл мода".into())}}
fn atomic_write(path:&Path,contents:&[u8])->Result<(),String>{if let Some(parent)=path.parent(){fs::create_dir_all(parent).map_err(|e|e.to_string())?}let temp=path.with_extension("tmp");fs::write(&temp,contents).map_err(|e|e.to_string())?;if path.exists(){fs::remove_file(path).map_err(|e|e.to_string())?}fs::rename(temp,path).map_err(|e|e.to_string())}
fn copy_dir_recursive(source:&Path,destination:&Path)->Result<(),String>{if !source.exists(){return Ok(())}fs::create_dir_all(destination).map_err(|e|e.to_string())?;for entry in fs::read_dir(source).map_err(|e|e.to_string())?{let entry=entry.map_err(|e|e.to_string())?;let target=destination.join(entry.file_name());if entry.path().is_dir(){copy_dir_recursive(&entry.path(),&target)?}else{fs::copy(entry.path(),target).map_err(|e|e.to_string())?;}}Ok(())}
fn safe_asset_id(id:&str)->Result<(),String>{if id.is_empty()||id.len()>100||!id.chars().all(|c|c.is_ascii_alphanumeric()||c=='-'||c=='_'){Err("Недопустимый ID RTS-ресурса".into())}else{Ok(())}}
fn safe_big_name(name:&str)->Result<(),String>{if name.len()<5||!name.to_ascii_lowercase().ends_with(".big")||name.chars().any(|c|matches!(c,'<'|'>'|':'|'"'|'/'|'\\'|'|'|'?'|'*')||c.is_control()){Err("Недопустимое имя BIG-файла".into())}else{Ok(())}}
fn rts_asset_path(app:&AppHandle,mod_id:&str,scope:&str,entity_id:&str)->Result<PathBuf,String>{safe_asset_id(entity_id)?;let root=mod_root(app,mod_id)?.join("rts");match scope{"module"=>Ok(root.join("modules").join(format!("{entity_id}.big"))),"maps"=>Ok(root.join("maps/maps.big")),"location-cache"=>Ok(root.join("map-caches/locations").join(format!("{entity_id}.big"))),_=>Err("Неизвестная категория RTS-ресурса".into())}}
fn decode_cache_key(value:&str)->String{let bytes=value.as_bytes();let mut result=String::new();let mut index=0;while index<bytes.len(){if bytes[index]==b'_'&&index+2<bytes.len(){if let Ok(hex)=u8::from_str_radix(&value[index+1..index+3],16){result.push(hex as char);index+=3;continue}}result.push(bytes[index] as char);index+=1}result}
fn parse_map_cache(bytes:&[u8])->Result<Value,String>{let text=String::from_utf8_lossy(bytes);let mut cache_key=String::new();let mut num_players=0u64;let mut starts=Vec::new();for line in text.lines(){let trimmed=line.trim();if let Some(position)=trimmed.find("MapCache "){cache_key=trimmed[position+9..].trim().to_string()}else if let Some(value)=trimmed.strip_prefix("numPlayers ="){num_players=value.trim().parse().unwrap_or(0)}else if trimmed.starts_with("Player_")&&trimmed.contains("_Start ="){let slot=trimmed.trim_start_matches("Player_").split('_').next().and_then(|v|v.parse::<u64>().ok()).unwrap_or(0);let number=|prefix:&str|trimmed.split(prefix).nth(1).and_then(|v|v.split_whitespace().next()).and_then(|v|v.parse::<f64>().ok()).unwrap_or(0.0);starts.push(json!({"slot":slot,"x":number("X:"),"y":number("Y:"),"z":number("Z:")}))}}if cache_key.is_empty(){return Err("В BIG-файле не найден блок MapCache".into())}let map_path=decode_cache_key(&cache_key);let normalized_map_path=map_path.replace('\\',"/");let map_name=Path::new(&normalized_map_path).file_stem().and_then(|v|v.to_str()).unwrap_or("").to_string();Ok(json!({"cacheKey":cache_key,"mapPath":map_path,"mapName":map_name,"numPlayers":num_players,"playerStarts":starts}))}
fn asset_result(path:&Path,root:&Path,id:&str,original:&str,target:&str,scope:&str)->Result<Value,String>{let size=fs::metadata(path).map_err(|e|e.to_string())?.len();let storage=path.strip_prefix(root).map_err(|e|e.to_string())?.to_string_lossy().replace('\\',"/");let mut value=json!({"id":id,"originalFileName":original,"targetFileName":target,"storageName":storage,"size":size});if scope.ends_with("-cache"){let parsed=parse_map_cache(&fs::read(path).map_err(|e|e.to_string())?)?;if let(Some(target_obj),Some(parsed_obj))=(value.as_object_mut(),parsed.as_object()){for(k,v)in parsed_obj{target_obj.insert(k.clone(),v.clone());}}}Ok(value)}

fn initialize_mods(app:&AppHandle)->Result<(),String>{
 let root=data_root(app)?;
 let default=mods_root(app)?.join("default");
 fs::create_dir_all(&default).map_err(|e|e.to_string())?;
 if !default.join("world.json").exists(){atomic_write(&default.join("world.json"),DEFAULT_WORLD.as_bytes())?}
 if !default.join("roster.json").exists(){atomic_write(&default.join("roster.json"),DEFAULT_ROSTER.as_bytes())?}
 if !default.join("mod.json").exists(){atomic_write(&default.join("mod.json"),DEFAULT_MOD.as_bytes())?}

 let rts_dir = default.join("rts");
 fs::create_dir_all(rts_dir.join("maps")).map_err(|e|e.to_string())?;
 fs::create_dir_all(rts_dir.join("map-caches/locations")).map_err(|e|e.to_string())?;
 fs::create_dir_all(rts_dir.join("modules")).map_err(|e|e.to_string())?;

 if let Ok(exe_dir) = executable_dir() {
     let candidate_dirs = vec![
         exe_dir.join("../public/mods/default/rts"),
         exe_dir.join("resources/public/mods/default/rts"),
         exe_dir.join("public/mods/default/rts"),
         exe_dir.join("resources/mods/default/rts"),
     ];
     for src_rts in candidate_dirs {
         if src_rts.exists() {
             copy_dir_recursive(&src_rts, &rts_dir);
             break;
         }
     }
 }

 let app_file=root.join("app.json");if !app_file.exists(){atomic_write(&app_file,DEFAULT_APP.as_bytes())?}
 Ok(())
}

#[tauri::command] fn read_app_settings(app:AppHandle)->Result<String,String>{fs::read_to_string(data_root(&app)?.join("app.json")).map_err(|e|e.to_string())}
#[tauri::command] fn write_app_settings(app:AppHandle,contents:String)->Result<(),String>{serde_json::from_str::<Value>(&contents).map_err(|e|e.to_string())?;atomic_write(&data_root(&app)?.join("app.json"),contents.as_bytes())}
#[tauri::command] fn read_mod_file(app:AppHandle,mod_id:String,kind:String)->Result<String,String>{fs::read_to_string(mod_file(&app,&mod_id,&kind)?).map_err(|e|e.to_string())}
#[tauri::command] fn write_mod_file(app:AppHandle,mod_id:String,kind:String,contents:String)->Result<(),String>{serde_json::from_str::<Value>(&contents).map_err(|e|e.to_string())?;atomic_write(&mod_file(&app,&mod_id,&kind)?,contents.as_bytes())}
#[tauri::command] fn write_rts_asset(app:AppHandle,mod_id:String,scope:String,entity_id:String,file_name:String,target_file_name:String,data_url:String)->Result<Value,String>{safe_big_name(&file_name)?;let target=if target_file_name.is_empty(){file_name.clone()}else{safe_big_name(&target_file_name)?;target_file_name};let encoded=data_url.split_once(',').map(|(_,v)|v).unwrap_or(&data_url);let bytes=STANDARD.decode(encoded).map_err(|e|e.to_string())?;let path=rts_asset_path(&app,&mod_id,&scope,&entity_id)?;atomic_write(&path,&bytes)?;asset_result(&path,&mod_root(&app,&mod_id)?,&entity_id,&file_name,&target,&scope)}
#[tauri::command] fn import_rts_asset(app:AppHandle,mod_id:String,scope:String,entity_id:String,source_path:String,target_file_name:String)->Result<Value,String>{let source=PathBuf::from(&source_path);let original=source.file_name().and_then(|v|v.to_str()).ok_or("Не удалось определить имя файла")?.to_string();safe_big_name(&original)?;let target=if target_file_name.is_empty(){original.clone()}else{safe_big_name(&target_file_name)?;target_file_name};let destination=rts_asset_path(&app,&mod_id,&scope,&entity_id)?;if let Some(parent)=destination.parent(){fs::create_dir_all(parent).map_err(|e|e.to_string())?}fs::copy(&source,&destination).map_err(|e|format!("Не удалось импортировать {}: {e}",source.display()))?;asset_result(&destination,&mod_root(&app,&mod_id)?,&entity_id,&original,&target,&scope)}
#[tauri::command] fn pick_and_import_rts_asset(app:AppHandle,mod_id:String,scope:String,entity_id:String,target_file_name:String)->Result<Option<Value>,String>{let selected=app.dialog().file().add_filter("BIG archives",&["big"]).blocking_pick_file();let Some(file_path)=selected else{return Ok(None)};let source=file_path.as_path().ok_or("Выбранный ресурс не является локальным файлом")?.to_path_buf();import_rts_asset(app,mod_id,scope,entity_id,source.to_string_lossy().to_string(),target_file_name).map(Some)}
fn rts_executable_candidates()->Vec<PathBuf>{let mut result=vec![PathBuf::from(r"C:\RotWK\lotrbfme2ep1.exe"),PathBuf::from(r"D:\Games\RotWK\lotrbfme2ep1.exe")];for key in ["ProgramFiles(x86)","ProgramFiles"]{if let Ok(root)=std::env::var(key){result.push(PathBuf::from(root).join(r"Electronic Arts\The Lord of the Rings, The Rise of the Witch-king\lotrbfme2ep1.exe"));}}for registry_key in [r"HKLM\SOFTWARE\WOW6432Node\Electronic Arts\Electronic Arts\The Lord of the Rings, The Rise of the Witch-king",r"HKLM\SOFTWARE\Electronic Arts\Electronic Arts\The Lord of the Rings, The Rise of the Witch-king"]{if let Ok(output)=Command::new("reg").args(["query",registry_key,"/v","InstallPath"]).output(){let text=String::from_utf8_lossy(&output.stdout);for line in text.lines(){if line.contains("InstallPath"){if let Some(value)=line.split("REG_SZ").nth(1){result.push(PathBuf::from(value.trim()).join("lotrbfme2ep1.exe"));}}}}}result}
#[tauri::command] fn discover_rts_executable()->Option<String>{rts_executable_candidates().into_iter().find(|path|path.is_file()).map(|path|path.to_string_lossy().to_string())}
#[tauri::command] fn validate_rts_executable(executable_path:String)->bool{Path::new(&executable_path).is_file()}
#[tauri::command] fn pick_rts_executable(app:AppHandle)->Result<Option<String>,String>{let selected=app.dialog().file().add_filter("ROTWK executable",&["exe"]).blocking_pick_file();let Some(file_path)=selected else{return Ok(None)};let path=file_path.as_path().ok_or("Выбранный ресурс не является локальным файлом")?.to_path_buf();if !path.is_file(){return Err("Выбранный EXE-файл не существует".into())}Ok(Some(path.to_string_lossy().to_string()))}
#[tauri::command] fn delete_rts_asset(app:AppHandle,mod_id:String,scope:String,entity_id:String)->Result<(),String>{let path=rts_asset_path(&app,&mod_id,&scope,&entity_id)?;if path.exists(){fs::remove_file(path).map_err(|e|e.to_string())?}Ok(())}
#[tauri::command] fn list_rts_map_caches(app:AppHandle,mod_id:String)->Result<Vec<Value>,String>{let root=mod_root(&app,&mod_id)?;let mut result=Vec::new();for(scope,relative)in[("location-cache","rts/map-caches/locations")]{let directory=root.join(relative);let entries=match fs::read_dir(&directory){Ok(value)=>value,Err(_)=>continue};for entry in entries{let entry=entry.map_err(|e|e.to_string())?;let path=entry.path();if path.extension().and_then(|v|v.to_str()).map(|v|v.eq_ignore_ascii_case("big"))!=Some(true){continue}let entity_id=path.file_stem().and_then(|v|v.to_str()).unwrap_or("");if safe_asset_id(entity_id).is_err(){continue}let parsed=parse_map_cache(&fs::read(&path).map_err(|e|e.to_string())?)?;let mut item=json!({"scope":scope,"entityId":entity_id,"assetId":entity_id,"originalFileName":path.file_name().and_then(|v|v.to_str()).unwrap_or(""),"storageName":path.strip_prefix(&root).map_err(|e|e.to_string())?.to_string_lossy().replace('\\',"/"),"size":fs::metadata(&path).map_err(|e|e.to_string())?.len()});if let(Some(target),Some(source))=(item.as_object_mut(),parsed.as_object()){for(k,v)in source{target.insert(k.clone(),v.clone());}}result.push(item)}}Ok(result)}
fn custom_map_name(meta:&Value)->Option<String>{meta.get("mapImage").and_then(Value::as_str).filter(|name|matches!(*name,"map.jpg"|"map.png"|"map.webp")).map(str::to_string)}
fn map_mime(name:&str)->&'static str{if name.ends_with(".png"){"image/png"}else if name.ends_with(".webp"){"image/webp"}else{"image/jpeg"}}
#[tauri::command] fn read_mod_map(app:AppHandle,mod_id:String)->Result<String,String>{let root=mod_root(&app,&mod_id)?;let meta:Value=serde_json::from_str(&fs::read_to_string(root.join("mod.json")).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;let custom=custom_map_name(&meta);let (bytes,mime)=if let Some(name)=custom.as_deref(){match fs::read(root.join(name)){Ok(bytes)=>(bytes,map_mime(name)),Err(_)=>(DEFAULT_MAP.to_vec(),"image/jpeg")}}else{(DEFAULT_MAP.to_vec(),"image/jpeg")};Ok(format!("data:{mime};base64,{}",STANDARD.encode(bytes)))}
#[tauri::command] fn write_mod_map(app:AppHandle,mod_id:String,data_url:String)->Result<(),String>{let (header,encoded)=data_url.split_once(',').unwrap_or(("data:image/jpeg;base64",&data_url));let extension=if header.contains("image/png"){"png"}else if header.contains("image/webp"){"webp"}else{"jpg"};let bytes=STANDARD.decode(encoded).map_err(|e|e.to_string())?;let root=mod_root(&app,&mod_id)?;let meta_file=root.join("mod.json");let mut meta:Value=serde_json::from_str(&fs::read_to_string(&meta_file).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;let old=custom_map_name(&meta);let name=format!("map.{extension}");atomic_write(&root.join(&name),&bytes)?;if old.as_deref()!=Some(name.as_str()){if let Some(old_name)=old{let _=fs::remove_file(root.join(old_name));}}if let Some(obj)=meta.as_object_mut(){obj.insert("mapImage".into(),json!(name));obj.insert("updatedAt".into(),json!(chrono_like_now()));}atomic_write(&meta_file,serde_json::to_string_pretty(&meta).map_err(|e|e.to_string())?.as_bytes())}
#[tauri::command] fn reset_mod_map(app:AppHandle,mod_id:String)->Result<(),String>{let root=mod_root(&app,&mod_id)?;let meta_file=root.join("mod.json");let mut meta:Value=serde_json::from_str(&fs::read_to_string(&meta_file).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;if let Some(name)=custom_map_name(&meta){let _=fs::remove_file(root.join(name));}if let Some(obj)=meta.as_object_mut(){obj.insert("mapImage".into(),Value::Null);obj.insert("updatedAt".into(),json!(chrono_like_now()));}atomic_write(&meta_file,serde_json::to_string_pretty(&meta).map_err(|e|e.to_string())?.as_bytes())}
fn deploy_rts_file(source:&Path,destination:&Path,expected:u64,always_replace:bool)->Result<Value,String>{if !source.exists(){return Err(format!("Исходный BIG-файл отсутствует: {}",source.display()))}let source_size=fs::metadata(source).map_err(|e|e.to_string())?.len();if expected>0&&source_size!=expected{return Err(format!("Размер ресурса {} изменён: ожидалось {}, найдено {}",source.display(),expected,source_size))}let existing=fs::metadata(destination).ok().map(|m|m.len());let action=if !always_replace&&existing==Some(source_size){"kept"}else{if let Some(parent)=destination.parent(){fs::create_dir_all(parent).map_err(|e|e.to_string())?}let temp=destination.with_extension("wotr-tmp");fs::copy(source,&temp).map_err(|e|format!("Не удалось скопировать {}: {e}",destination.display()))?;if destination.exists(){fs::remove_file(destination).map_err(|e|e.to_string())?}fs::rename(temp,destination).map_err(|e|e.to_string())?;if existing.is_some(){"replaced"}else{"copied"}};let actual=fs::metadata(destination).map_err(|e|e.to_string())?.len();Ok(json!({"name":destination.file_name().and_then(|v|v.to_str()).unwrap_or(""),"expectedSize":source_size,"actualSize":actual,"action":action}))}
#[tauri::command] fn prepare_rts_battle(app:AppHandle,mod_id:String,executable_path:String,cache_scope:String,entity_id:String,battle_config:Value)->Result<Value,String>{let exe=PathBuf::from(&executable_path);if !exe.is_file(){return Err(format!("Исполняемый файл BFME не найден: {}",exe.display()))}let game_dir=exe.parent().ok_or("Не удалось определить папку игры")?;let mod_root_path=mod_root(&app,&mod_id)?;let meta:Value=serde_json::from_str(&fs::read_to_string(mod_root_path.join("mod.json")).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;let rts=meta.get("rts").ok_or("В моде отсутствуют системные настройки BFME")?;let mut deployed=Vec::new();let mut errors=Vec::new();if let Some(files)=rts.get("moduleFiles").and_then(Value::as_array){for file in files{let id=file.get("id").and_then(Value::as_str).unwrap_or("");let target=file.get("targetFileName").and_then(Value::as_str).unwrap_or("");let size=file.get("size").and_then(Value::as_u64).unwrap_or(0);if safe_big_name(target).is_err(){errors.push(format!("Некорректное имя файла мода: {target}"));continue}match rts_asset_path(&app,&mod_id,"module",id).and_then(|source|deploy_rts_file(&source,&game_dir.join(target),size,false)){Ok(report)=>deployed.push(report),Err(e)=>errors.push(e)}}}if let Some(file)=rts.get("mapsFile").filter(|v|!v.is_null()){let target=file.get("targetFileName").and_then(Value::as_str).unwrap_or("");let size=file.get("size").and_then(Value::as_u64).unwrap_or(0);if safe_big_name(target).is_err(){errors.push(format!("Некорректное имя архива карт: {target}"))}else{match rts_asset_path(&app,&mod_id,"maps","maps").and_then(|source|deploy_rts_file(&source,&game_dir.join(target),size,false)){Ok(report)=>deployed.push(report),Err(e)=>errors.push(e)}}}else{errors.push("В мод не загружен единый BIG-архив карт".into())}let cache_target=rts.get("mapCacheTargetFileName").and_then(Value::as_str).unwrap_or("");if safe_big_name(cache_target).is_err(){errors.push("Некорректное имя целевого кэша карт".into())}else{match rts_asset_path(&app,&mod_id,&cache_scope,&entity_id).and_then(|source|deploy_rts_file(&source,&game_dir.join(cache_target),battle_config.get("map").and_then(|v|v.get("expectedSize")).and_then(Value::as_u64).unwrap_or(0),true)){Ok(report)=>deployed.push(report),Err(e)=>errors.push(e)}}let temp=data_root(&app)?.join("temp");fs::create_dir_all(&temp).map_err(|e|e.to_string())?;let config_path=temp.join("current_battle.json");atomic_write(&config_path,serde_json::to_string_pretty(&battle_config).map_err(|e|e.to_string())?.as_bytes())?;Ok(json!({"ok":errors.is_empty(),"gameDirectory":game_dir.to_string_lossy(),"executablePath":exe.to_string_lossy(),"deployed":deployed,"errors":errors,"battleConfigPath":config_path.to_string_lossy()}))}
fn plan_rts_deployment(source:&Path,destination:&Path,expected:u64,always_replace:bool,language:&str)->Result<Value,String>{
 if !source.is_file(){return Err(if language=="en"{format!("Source BIG file is missing: {}",source.display())}else{format!("Исходный BIG-файл отсутствует: {}",source.display())})}
 let size=fs::metadata(source).map_err(|error|error.to_string())?.len();
 if expected>0&&size!=expected{return Err(if language=="en"{format!("Resource size mismatch for {}: expected {expected}, found {size}",source.display())}else{format!("Размер ресурса {} изменён: ожидалось {expected}, найдено {size}",source.display())})}
 Ok(json!({"sourcePath":source.to_string_lossy(),"destinationPath":destination.to_string_lossy(),"expectedSize":size,"alwaysReplace":always_replace}))
}

#[tauri::command]
fn prepare_and_start_rts_battle(app:AppHandle,mod_id:String,executable_path:String,cache_scope:String,entity_id:String,mut battle_config:Value)->Result<Value,String>{
 if let Ok(real_appdata)=std::env::var("APPDATA"){if let Some(object)=battle_config.as_object_mut(){object.insert("_realAppData".into(),json!(real_appdata));}}
 let language=battle_config.get("language").and_then(Value::as_str).unwrap_or("ru");
 let exe=PathBuf::from(&executable_path);
 if !exe.is_file(){return Err(if language=="en"{format!("BFME executable was not found: {}",exe.display())}else{format!("Исполняемый файл BFME не найден: {}",exe.display())})}
 let game_dir=exe.parent().ok_or_else(||if language=="en"{"Could not determine the game folder".to_string()}else{"Не удалось определить папку игры".to_string()})?;
 let mod_root_path=mod_root(&app,&mod_id)?;
 let meta:Value=serde_json::from_str(&fs::read_to_string(mod_root_path.join("mod.json")).map_err(|error|error.to_string())?).map_err(|error|error.to_string())?;
 let rts=meta.get("rts").ok_or_else(||if language=="en"{"The mod has no BFME system settings".to_string()}else{"В моде отсутствуют системные настройки BFME".to_string()})?;
 let mut deployment=Vec::new();let mut errors=Vec::new();
 if let Some(files)=rts.get("moduleFiles").and_then(Value::as_array){for file in files{let id=file.get("id").and_then(Value::as_str).unwrap_or("");let target=file.get("targetFileName").and_then(Value::as_str).unwrap_or("");let size=file.get("size").and_then(Value::as_u64).unwrap_or(0);if safe_big_name(target).is_err(){errors.push(if language=="en"{format!("Invalid mod file name: {target}")}else{format!("Некорректное имя файла мода: {target}")});continue}match rts_asset_path(&app,&mod_id,"module",id).and_then(|source|plan_rts_deployment(&source,&game_dir.join(target),size,false,language)){Ok(item)=>deployment.push(item),Err(error)=>errors.push(error)}}}
 if let Some(file)=rts.get("mapsFile").filter(|value|!value.is_null()){let target=file.get("targetFileName").and_then(Value::as_str).unwrap_or("");let size=file.get("size").and_then(Value::as_u64).unwrap_or(0);if safe_big_name(target).is_err(){errors.push(if language=="en"{format!("Invalid map archive name: {target}")}else{format!("Некорректное имя архива карт: {target}")})}else{match rts_asset_path(&app,&mod_id,"maps","maps").and_then(|source|plan_rts_deployment(&source,&game_dir.join(target),size,false,language)){Ok(item)=>deployment.push(item),Err(error)=>errors.push(error)}}}else{errors.push(if language=="en"{"The mod has no shared BIG map archive".into()}else{"В мод не загружен единый BIG-архив карт".into()})}
 let cache_target=rts.get("mapCacheTargetFileName").and_then(Value::as_str).unwrap_or("");
 if safe_big_name(cache_target).is_err(){errors.push(if language=="en"{"Invalid active map cache file name".into()}else{"Некорректное имя целевого кэша карт".into()})}else{let expected=battle_config.get("map").and_then(|value|value.get("expectedSize")).and_then(Value::as_u64).unwrap_or(0);match rts_asset_path(&app,&mod_id,&cache_scope,&entity_id).and_then(|source|plan_rts_deployment(&source,&game_dir.join(cache_target),expected,true,language)){Ok(item)=>deployment.push(item),Err(error)=>errors.push(error)}}
 let temp=data_root(&app)?.join("temp");fs::create_dir_all(&temp).map_err(|error|error.to_string())?;let config_path=temp.join("current_battle.json");atomic_write(&config_path,serde_json::to_string_pretty(&battle_config).map_err(|error|error.to_string())?.as_bytes())?;
 let spawn_path=temp.join("wotr_generated_presets.big");match rts_spawn::generate(&spawn_path,&battle_config).and_then(|report|plan_rts_deployment(&spawn_path,&game_dir.join("wotr_generated_presets.big"),report.get("size").and_then(Value::as_u64).unwrap_or(0),true,language)){Ok(item)=>deployment.push(item),Err(error)=>errors.push(error)}
 if !errors.is_empty(){return Ok(json!({"ok":false,"gameDirectory":game_dir.to_string_lossy(),"executablePath":exe.to_string_lossy(),"deployed":[],"errors":errors,"battleConfigPath":config_path.to_string_lossy()}))}
 let deployed=bfme_automation::deploy_and_launch_with_elevation(&exe,&battle_config,&temp,&Value::Array(deployment))?;
 Ok(json!({"ok":true,"gameDirectory":game_dir.to_string_lossy(),"executablePath":exe.to_string_lossy(),"deployed":deployed,"errors":[],"battleConfigPath":config_path.to_string_lossy()}))
}

#[tauri::command] fn launch_rts_game(executable_path:String)->Result<(),String>{let exe=PathBuf::from(executable_path);let dir=exe.parent().ok_or("Не удалось определить папку игры")?;Command::new(&exe).current_dir(dir).spawn().map_err(|e|format!("Не удалось запустить BFME: {e}"))?;Ok(())}
#[tauri::command] fn configure_and_start_rts_battle(app:AppHandle,executable_path:String,battle_config:Value)->Result<(),String>{let temp=data_root(&app)?.join("temp");bfme_automation::launch_with_elevation(&PathBuf::from(executable_path),&battle_config,&temp)}

#[tauri::command]
fn list_mods(app:AppHandle)->Result<Vec<Value>,String>{
    let mut result=Vec::new();
    for entry in fs::read_dir(mods_root(&app)?).map_err(|e|e.to_string())?{
        let entry=entry.map_err(|e|e.to_string())?;
        if !entry.path().is_dir(){continue}
        let root=entry.path();
        let mod_id=entry.file_name().to_string_lossy().to_string();
        let meta_path=root.join("mod.json");
        if !meta_path.exists(){continue}
        let mut meta:Value=serde_json::from_str(&fs::read_to_string(meta_path).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
        let world:Value=serde_json::from_str(&fs::read_to_string(root.join("world.json")).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
        let roster:Value=serde_json::from_str(&fs::read_to_string(root.join("roster.json")).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
        let compatible=fs::read_to_string(root.join("saves/autosave.json")).ok()
            .and_then(|s|serde_json::from_str::<Value>(&s).ok())
            .map(|s|s.get("version").and_then(Value::as_u64)==Some(SAVE_VERSION)
                &&s.get("gameVersion").and_then(Value::as_str)==Some(GAME_VERSION)
                &&s.get("modId").and_then(Value::as_str)==Some(mod_id.as_str()))
            .unwrap_or(false);
        if let Some(obj)=meta.as_object_mut(){
            obj.insert("locationCount".into(),json!(world.get("locations").and_then(Value::as_array).map(|v|v.len()).unwrap_or(0)));
            obj.insert("heroCount".into(),json!(roster.get("heroes").and_then(Value::as_array).map(|v|v.len()).unwrap_or(0)));
            obj.insert("factionCount".into(),json!(world.get("factions").and_then(Value::as_array).map(|v|v.iter().filter(|f|f.get("playable").and_then(Value::as_bool)==Some(true)).count()).unwrap_or(0)));
            obj.insert("hasCompatibleSave".into(),json!(compatible));
        }
        result.push(meta)
    }
    result.sort_by(|a,b|a.get("name").and_then(Value::as_str).unwrap_or("").cmp(b.get("name").and_then(Value::as_str).unwrap_or("")));
    Ok(result)
}

#[tauri::command]
fn create_mod(app: AppHandle, metadata: Value, source_mod_id: Option<String>) -> Result<Value, String> {
    let id = metadata.get("id").and_then(Value::as_str).ok_or("Нет ID")?;
    safe_id(id)?;
    let dest = mod_root(&app, id)?;
    if dest.exists() { return Err("Мод с таким ID уже существует".into()); }
    fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    let mut map_image: Option<String> = None;
    let mut source_rts: Option<Value> = None;
    let mut source_locales: Option<Value> = None;
    let mut source_default_locale: Option<Value> = None;
    if let Some(source_id) = source_mod_id {
        let src = mod_root(&app, &source_id)?;
        fs::copy(src.join("world.json"), dest.join("world.json")).map_err(|e| e.to_string())?;
        fs::copy(src.join("roster.json"), dest.join("roster.json")).map_err(|e| e.to_string())?;
        let source_meta: Value = serde_json::from_str(&fs::read_to_string(src.join("mod.json")).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        source_rts = source_meta.get("rts").cloned();
        source_locales = source_meta.get("supportedLocales").cloned();
        source_default_locale = source_meta.get("defaultLocale").cloned();
        copy_dir_recursive(&src.join("rts"),&dest.join("rts"))?;
        if let Some(source_map) = custom_map_name(&source_meta) {
            fs::copy(src.join(&source_map), dest.join(&source_map)).map_err(|e| e.to_string())?;
            map_image = Some(source_map);
        }
    } else {
        atomic_write(&dest.join("world.json"), WORLD_TEMPLATE.as_bytes())?;
        atomic_write(&dest.join("roster.json"), ROSTER_TEMPLATE.as_bytes())?;
    }
    let now = chrono_like_now();
    let mut mod_data = metadata;
    let obj = mod_data.as_object_mut().ok_or("Неверные метаданные")?;
    obj.insert("createdAt".into(), json!(now));
    obj.insert("updatedAt".into(), json!(now));
    obj.insert("supportedLocales".into(), source_locales.unwrap_or_else(||json!(["en","ru"])));
    obj.insert("defaultLocale".into(), source_default_locale.unwrap_or_else(||json!("ru")));
    obj.insert("mapImage".into(), json!(map_image));
    obj.insert("rts".into(), source_rts.unwrap_or_else(||json!({"enabled":true,"factionOrder":[],"moduleFiles":[],"mapsFile":null,"mapCacheTargetFileName":"__wotr_maps_cache.big","networkRules":"0 0 0 400 1000 -1 -1 -1 -1 -1"})));
    obj.insert("dataVersions".into(), json!({"world":35,"roster":14}));
    atomic_write(&dest.join("mod.json"), serde_json::to_string_pretty(&mod_data).map_err(|e| e.to_string())?.as_bytes())?;
    Ok(mod_data)
}

fn chrono_like_now()->String{use std::time::{SystemTime,UNIX_EPOCH};let secs=SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();format!("unix:{secs}")}
#[tauri::command] fn delete_mod(app:AppHandle,mod_id:String)->Result<(),String>{if mod_id=="default"{return Err("Встроенный мод удалить нельзя".into())}fs::remove_dir_all(mod_root(&app,&mod_id)?).map_err(|e|e.to_string())}
#[tauri::command] fn open_mods_folder(app:AppHandle)->Result<String,String>{let path=mods_root(&app)?;#[cfg(target_os="windows")]Command::new("explorer").arg(&path).spawn().map_err(|e|e.to_string())?;Ok(path.to_string_lossy().to_string())}
#[tauri::command] fn portable_data_directory(app:AppHandle)->Result<String,String>{Ok(data_root(&app)?.to_string_lossy().to_string())}
#[tauri::command] fn open_application_folder()->Result<String,String>{let path=executable_dir()?;#[cfg(target_os="windows")]Command::new("explorer").arg(&path).spawn().map_err(|e|e.to_string())?;Ok(path.to_string_lossy().to_string())}
#[tauri::command] fn exit_application(app:AppHandle){app.exit(0)}

pub fn run_rts_helper_if_requested()->bool{bfme_automation::run_helper_if_requested()}

#[cfg_attr(mobile,tauri::mobile_entry_point)] pub fn run(){tauri::Builder::default().plugin(tauri_plugin_dialog::init()).setup(|app|{let _=initialize_mods(app.handle());Ok(())}).invoke_handler(tauri::generate_handler![read_app_settings,write_app_settings,read_mod_file,write_mod_file,write_rts_asset,import_rts_asset,pick_and_import_rts_asset,discover_rts_executable,validate_rts_executable,pick_rts_executable,delete_rts_asset,list_rts_map_caches,prepare_rts_battle,prepare_and_start_rts_battle,launch_rts_game,configure_and_start_rts_battle,read_mod_map,write_mod_map,reset_mod_map,list_mods,create_mod,delete_mod,open_mods_folder,portable_data_directory,open_application_folder,exit_application]).run(tauri::generate_context!()).expect("error while running War of the Ring")}
