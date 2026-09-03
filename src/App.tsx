import { useCallback, useEffect, useRef, useState } from 'react'
import BattleReportModal from './components/BattleReportModal'
import ConflictModal from './components/ConflictModal'
import CampaignResultModal from './components/CampaignResultModal'
import Inspector from './components/Inspector'
import MainMenu from './components/MainMenu'
import LanguageSelector from './components/LanguageSelector'
import MapCanvas from './components/MapCanvas'
import ModManager from './components/ModManager'
import RtsUserSettings from './components/RtsUserSettings'
import Sidebar from './components/Sidebar'
import Topbar from './components/Topbar'
import WorldDataEditor from './components/WorldDataEditor'
import { createMod, deleteMod, listMods, loadAppSettings, loadModDefinition, loadModMapUrl, loadSaveGame, loadWorld, openApplicationFolder, openModsFolder, exitApplication, resetModMap, discoverRtsExecutable, pickRtsExecutable, validateRtsExecutable, saveAppSettings, saveGame, saveModDefinition, saveModMap, saveWorld } from './dataService'
import { extractSaveGame } from './game/saveGame'
import { useMapStore } from './store/useMapStore'
import type { AppMode, AppSettings, ModDefinition, ModSummary, SaveState, WorldData } from './types'
import { GAME_VERSION, WORLD_DATA_VERSION } from './version'
import { registerWorldTranslations, useI18n } from './i18n'
import type { AppLanguage } from './i18n'

function currentWorld(): WorldData {
  const state = useMapStore.getState()
  return { version: WORLD_DATA_VERSION, locations: state.locations, grid: state.grid, factions: state.factions, economicTypes: state.economicTypes, unitTypes: state.unitTypes, heroes: state.heroes, captains: state.captains, armies: state.armies, regions: state.regions, buildingTypes: state.buildingTypes, palantirSettings: state.palantirSettings, ringForging: state.ringForging, defaultUnitMaxLevel: state.defaultUnitMaxLevel, defaultHeroMaxLevel: state.defaultHeroMaxLevel, campaign: state.campaign, battles: state.battles }
}

export default function App() {
  const { language, setLanguage, t } = useI18n()
  const [loading,setLoading]=useState(true)
  const [loadError,setLoadError]=useState<string|null>(null)
  const [saveState,setSaveState]=useState<SaveState>('idle')
  const [saveErrorDetail,setSaveErrorDetail]=useState<string|null>(null)
  const [appView,setAppView]=useState<'menu'|'faction'|'mods'|'rts-settings'|'language'|'workspace'>('menu')
  const [saveCompatible,setSaveCompatible]=useState(false)
  const [saveCompatibilityReason,setSaveCompatibilityReason]=useState<string|null>(null)
  const [dataEditorOpen,setDataEditorOpen]=useState(false)
  const [focusTarget,setFocusTarget]=useState<{id:string;nonce:number}|null>(null)
  const [appSettings,setAppSettings]=useState<AppSettings|null>(null)
  const [mods,setMods]=useState<ModSummary[]>([])
  const [activeMod,setActiveMod]=useState<ModDefinition|null>(null)
  const [mapImageUrl,setMapImageUrl]=useState('')
  const [modBusy,setModBusy]=useState(false)
  const [modError,setModError]=useState<string|null>(null)
  const saveSequence=useRef(0)

  const locations=useMapStore((s)=>s.locations),grid=useMapStore((s)=>s.grid),factions=useMapStore((s)=>s.factions);const economicTypes=useMapStore((s)=>s.economicTypes),unitTypes=useMapStore((s)=>s.unitTypes),heroes=useMapStore((s)=>s.heroes),captains=useMapStore((s)=>s.captains),armies=useMapStore((s)=>s.armies),regions=useMapStore((s)=>s.regions),campaign=useMapStore((s)=>s.campaign),battles=useMapStore((s)=>s.battles),mode=useMapStore((s)=>s.mode),gameSaveState=useMapStore((s)=>s.gameSave),revision=useMapStore((s)=>s.revision)
  const initialize=useMapStore((s)=>s.initialize),newGame=useMapStore((s)=>s.newGame),setMode=useMapStore((s)=>s.setMode),undo=useMapStore((s)=>s.undo),redo=useMapStore((s)=>s.redo),setAddKind=useMapStore((s)=>s.setAddKind),setViewMode=useMapStore((s)=>s.setViewMode),setHexEdit=useMapStore((s)=>s.setHexEdit)
  const activeModId=activeMod?.id ?? appSettings?.activeModId ?? 'default'

  useEffect(()=>{registerWorldTranslations({factions,locations,unitTypes,heroes,captains,regions})},[factions,locations,unitTypes,heroes,captains,regions])

  const loadModData=useCallback(async(modId:string)=>{
    const [world,mapUrl]=await Promise.all([loadWorld(modId),loadModMapUrl(modId)])
    registerWorldTranslations(world)
    const definition=await loadModDefinition(modId,world.factions)
    const loadedSave=await loadSaveGame(world,modId,definition.name)
    initialize(world,loadedSave.saveGame)
    setActiveMod(definition);setMapImageUrl(mapUrl);setSaveCompatible(loadedSave.compatible);setSaveCompatibilityReason(loadedSave.reason);setSaveState('saved')
    return definition
  },[initialize])

  useEffect(()=>{let active=true;(async()=>{try{const [settings,catalog]=await Promise.all([loadAppSettings(),listMods()]);if(!active)return;if(settings.language)setLanguage(settings.language);const selected=catalog.some((m)=>m.id===settings.activeModId)?settings.activeModId:catalog.find((m)=>m.id==='default')?.id??catalog[0]?.id;if(!selected)throw new Error('Не найден ни один мод');const normalizedSettings={...settings,activeModId:selected,appVersion:GAME_VERSION,language:settings.language??null,rtsExecutablePath:settings.rtsExecutablePath||''};setMods(catalog);setAppSettings(normalizedSettings);await saveAppSettings(normalizedSettings);await loadModData(selected)}catch(error){if(active)setLoadError(error instanceof Error?error.message:String(error))}finally{if(active)setLoading(false)}})();return()=>{active=false}},[loadModData,setLanguage])

  const persist=useCallback(async(snapshot?:WorldData,targetMode?:AppMode)=>{if(!activeModId)return;const sequence=++saveSequence.current;setSaveState('saving');setSaveErrorDetail(null);try{const world=snapshot??currentWorld();const saveMode=targetMode??useMapStore.getState().mode;if(saveMode==='edit')await saveWorld(world,activeModId);else await saveGame(extractSaveGame(world,useMapStore.getState().gameSave,activeModId),activeModId);if(sequence===saveSequence.current)setSaveState('saved')}catch(error){console.error(error);if(sequence===saveSequence.current){setSaveErrorDetail(error instanceof Error?error.message:String(error));setSaveState('error')}}},[activeModId])

  useEffect(()=>{if(loading||revision===0||!activeMod)return;setSaveState('saving');const snapshot:WorldData=currentWorld();const timer=window.setTimeout(()=>persist(snapshot,mode),450);return()=>window.clearTimeout(timer)},[locations,grid,factions,economicTypes,unitTypes,heroes,captains,armies,regions,campaign,battles,mode,gameSaveState,revision,loading,persist,activeMod])
  useEffect(()=>{if(loading||mode!=='edit'||!gameSaveState||!saveCompatible||revision===0||!activeMod)return;void saveGame(gameSaveState,activeMod.id).catch(console.error)},[gameSaveState,loading,mode,revision,saveCompatible,activeMod])

  const activateMod=useCallback(async(modId:string,openEditor=false)=>{if(modId===activeModId&&!openEditor){setAppView('menu');return}setModBusy(true);setModError(null);try{if(revision>0&&activeMod)await persist();const definition=await loadModData(modId);const settings:AppSettings={activeModId:modId,lastPlayedMod:modId,appVersion:GAME_VERSION,language:appSettings?.language??language,recentMods:[modId,...(appSettings?.recentMods??[]).filter((id)=>id!==modId)].slice(0,8),rtsExecutablePath:appSettings?.rtsExecutablePath||''};await saveAppSettings(settings);setAppSettings(settings);setMods(await listMods());setDataEditorOpen(false);if(openEditor){setMode('edit');setAppView('workspace')}else setAppView('menu');setActiveMod(definition)}catch(error){setModError(error instanceof Error?error.message:String(error))}finally{setModBusy(false)}},[activeMod,activeModId,appSettings,language,loadModData,persist,revision,setMode])

  const handleCreateMod=async(metadata:Pick<ModDefinition,'id'|'name'|'description'|'author'|'version'|'bfmeVersion'>,sourceModId:string|null)=>{setModBusy(true);setModError(null);try{await createMod(metadata,sourceModId);setMods(await listMods());await activateMod(metadata.id,true)}catch(error){setModError(error instanceof Error?error.message:String(error));setModBusy(false)}}
  const handleDeleteMod=async(id:string)=>{setModBusy(true);setModError(null);try{await deleteMod(id);setMods(await listMods())}catch(error){setModError(error instanceof Error?error.message:String(error))}finally{setModBusy(false)}}
  const handleOpenMods=async()=>{try{const path=await openModsFolder();if(path&&!('__TAURI_INTERNALS__' in window))window.alert(`Папка модов:\n${path}`)}catch(error){setModError(error instanceof Error?error.message:String(error))}}
  const handleMapChange=async(id:string,file:File)=>{setModBusy(true);setModError(null);try{await saveModMap(id,file);if(id===activeModId)setMapImageUrl(await loadModMapUrl(id));setMods(await listMods())}catch(error){setModError(error instanceof Error?error.message:String(error))}finally{setModBusy(false)}}
  const handleMapReset=async(id:string)=>{setModBusy(true);setModError(null);try{await resetModMap(id);if(id===activeModId)setMapImageUrl(await loadModMapUrl(id));setMods(await listMods())}catch(error){setModError(error instanceof Error?error.message:String(error))}finally{setModBusy(false)}}
  const handleModDefinitionChange=async(definition:ModDefinition)=>{setActiveMod(definition);await saveModDefinition(definition.id,definition);setMods(await listMods())}
  const handleAppSettingsChange=async(settings:AppSettings)=>{setAppSettings(settings);await saveAppSettings(settings)}
  const handleLanguageSelection=async(nextLanguage:AppLanguage)=>{if(!appSettings)return;const settings={...appSettings,language:nextLanguage};await saveAppSettings(settings);setAppSettings(settings);setLanguage(nextLanguage);window.location.reload()}
  const handleNewCampaign=async()=>{if('__TAURI_INTERNALS__' in window&&activeMod?.rts.enabled&&appSettings){let selected=appSettings.rtsExecutablePath;const valid=selected?await validateRtsExecutable(selected):false;if(!valid)selected=await discoverRtsExecutable()??await pickRtsExecutable()??'';if(!selected){setAppView('rts-settings');return}if(selected!==appSettings.rtsExecutablePath)await handleAppSettingsChange({...appSettings,rtsExecutablePath:selected})}setAppView('faction')}

  useEffect(()=>{const handle=(event:KeyboardEvent)=>{if(appView!=='workspace'){if(event.key==='Escape'&&appView==='faction')setAppView('menu');return}const modifier=event.ctrlKey||event.metaKey;const target=event.target as HTMLElement|null;const typing=['INPUT','SELECT','TEXTAREA'].includes(target?.tagName??'');if(modifier&&event.key.toLowerCase()==='s'){event.preventDefault();void persist()}else if(modifier&&event.key.toLowerCase()==='z'&&!event.shiftKey){event.preventDefault();undo()}else if(modifier&&(event.key.toLowerCase()==='y'||event.key.toLowerCase()==='z'&&event.shiftKey)){event.preventDefault();redo()}else if(!typing&&event.key.toLowerCase()==='g'){const state=useMapStore.getState();setViewMode(state.viewMode==='strategic'?'cinematic':'strategic')}else if(!typing&&event.key.toLowerCase()==='t')setViewMode('tactical');else if(event.key==='Escape'){setDataEditorOpen(false);setAddKind(null);setHexEdit(false)}};window.addEventListener('keydown',handle);return()=>window.removeEventListener('keydown',handle)},[appView,persist,redo,setAddKind,setHexEdit,setViewMode,undo])

  if(loading)return <main className="loading-screen"><span className="loading-ring"><i/></span><b>{t('Война за Кольцо')}</b><small>{t('Загружаем активный мод…')}</small></main>
  if(loadError)return <main className="error-screen portable-error"><div>!</div><h1>Не удалось открыть рабочую папку</h1><p>{loadError}</p><section><b>Приложение работает только в portable-режиме.</b><span>Переместите EXE в обычную папку с правом записи, например на Рабочий стол, в Документы или D:\Games\WOTR. Данные будут созданы рядом с EXE в папке portable_data.</span></section><footer>{'__TAURI_INTERNALS__' in window&&<button onClick={()=>void openApplicationFolder()}>Открыть папку EXE</button>}<button onClick={()=>window.location.reload()}>Повторить</button>{'__TAURI_INTERNALS__' in window&&<button className="danger" onClick={()=>void exitApplication()}>Выход</button>}</footer></main>
  if(appSettings&&!appSettings.language)return <LanguageSelector firstRun mapImageUrl={mapImageUrl} supportedLocales={activeMod?.supportedLocales} onSelect={(next)=>void handleLanguageSelection(next)}/>
  if(appView==='language')return <LanguageSelector mapImageUrl={mapImageUrl} supportedLocales={activeMod?.supportedLocales} onSelect={(next)=>void handleLanguageSelection(next)} onClose={()=>setAppView('menu')}/>
  if(appView==='rts-settings')return appSettings?<RtsUserSettings settings={appSettings} activeMod={activeMod} onSave={(settings)=>void handleAppSettingsChange(settings)} onClose={()=>setAppView('menu')}/>:null
  if(appView==='mods')return <ModManager mods={mods} activeModId={activeModId} busy={modBusy} error={modError} onClose={()=>setAppView('menu')} onActivate={(id)=>void activateMod(id)} onEdit={(id)=>void activateMod(id,true)} onDelete={(id)=>void handleDeleteMod(id)} onCreate={(meta,source)=>void handleCreateMod(meta,source)} onOpenFolder={()=>void handleOpenMods()} onMapChange={(id,file)=>void handleMapChange(id,file)} onMapReset={(id)=>void handleMapReset(id)}/>
  if(appView!=='workspace')return <MainMenu view={appView} canContinue={saveCompatible} continueReason={saveCompatibilityReason} mapImageUrl={mapImageUrl} activeModName={activeMod?.name??activeModId} onMods={()=>setAppView('mods')} onRtsSettings={()=>setAppView('rts-settings')} onLanguage={()=>setAppView('language')} onNewCampaign={()=>void handleNewCampaign()} onContinue={()=>{if(saveCompatible){setMode('game');setAppView('workspace')}}} onEditor={()=>{setMode('edit');setAppView('workspace')}} onBack={()=>setAppView('menu')} onStart={(factionId,fogEnabled,activeFactionIds,strategicDifficulty,rtsDifficulty)=>{newGame(factionId,fogEnabled,activeModId,activeFactionIds,strategicDifficulty,rtsDifficulty);setSaveCompatible(true);setSaveCompatibilityReason(null);setAppView('workspace')}}/>

  return <div className="app-shell"><Topbar saveState={saveState} activeModName={activeMod?.name??activeModId} onSave={()=>void persist()} onOpenData={()=>setDataEditorOpen(true)} onMenu={()=>{setDataEditorOpen(false);setAppView('menu')}}/><main className="workspace"><Sidebar onFocus={(id)=>setFocusTarget({id,nonce:Date.now()})}/><section className="map-column"><MapCanvas focusTarget={focusTarget} mapImageUrl={mapImageUrl}/></section><Inspector activeModId={activeModId} activeMod={activeMod} appSettings={appSettings} onModChange={(definition)=>void handleModDefinitionChange(definition)}/></main>{dataEditorOpen&&activeMod&&<WorldDataEditor onClose={()=>setDataEditorOpen(false)} activeMod={activeMod} onModChange={(definition)=>void handleModDefinitionChange(definition)}/>}<ConflictModal activeMod={activeMod} appSettings={appSettings}/><BattleReportModal/>{mode==='game'&&<CampaignResultModal onMenu={()=>setAppView('menu')}/>} {saveState==='error'&&<div className="save-error" role="alert"><b>Не удалось записать данные мода.</b><span>{saveErrorDetail??<>Запустите проект через <code>npm run dev</code> и повторите.</>}</span><button onClick={()=>void persist()}>Повторить</button></div>}</div>
}
