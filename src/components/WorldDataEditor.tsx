import { useState } from 'react'
import type { CSSProperties } from 'react'
import { getFaction } from '../constants'
import { armyCommandPointLimit, armyCommandPoints, armyUnitSlotCap, factionArmyLimit } from '../game/army'
import { autoBalanceHero, autoBalanceUnit, DEFAULT_AUTO_BALANCE_COEFFICIENT } from '../game/autoBalance'
import { ALL_SETTLEMENT_TYPES } from '../game/recruitment'
import { economicTypeLabel, getActiveEconomicTypes } from '../game/economicTypes'
import { locationHexId } from '../hex/hexGrid'
import { useMapStore } from '../store/useMapStore'
import { ensureUniqueFactionColor } from '../utils/color'
import { imageFileToDataUrl } from '../utils/image'
import { sortByText } from '../utils/sort'
import { localizedTranslationsPatch, localizedValue, useI18n } from '../i18n'
import LocalizedNameFields from './LocalizedNameFields'
import { createAssetId, NETWORK_COMMAND_VALUES, NETWORK_RESOURCE_VALUES, networkRuleParts, RTS_COLORS, validBigFileName, withNetworkRulePart } from '../rts'
import { deleteRtsAsset, pickAndImportRtsAsset, uploadRtsAsset } from '../dataService'
import type { EconomicTypeDefinition, HeroUnlockType, ModDefinition, OwnerBattleModifiers, RtsStoredFile, SettlementType, UnitCategory } from '../types'
import { ARMY_UPGRADE_IDS } from '../types'
import { rotwkUnitLevelCap } from '../game/unitLevelCaps'

const UPGRADE_TITLES: Record<typeof ARMY_UPGRADE_IDS[number], string> = { weaponUpgrade: 'Оружие', armorUpgrade: 'Броня', bannerUpgrade: 'Знамя' }

type Tab = 'factions' | 'economy' | 'buildings' | 'ring' | 'units' | 'heroes' | 'captains' | 'armies' | 'regions' | 'rts'
const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'factions', label: 'Фракции', icon: '⚑' }, { id: 'economy', label: 'Экономика', icon: '¤' }, { id: 'units', label: 'Юниты', icon: '⚔' }, { id: 'heroes', label: 'Герои', icon: '♛' }, { id: 'captains', label: 'Капитаны', icon: '◆' }, { id: 'armies', label: 'Стартовые армии', icon: '♜' }, { id: 'buildings', label: 'Постройки', icon: '▣' }, { id: 'ring', label: 'Кольцо', icon: '◎' }, { id: 'regions', label: 'Регионы', icon: '⬡' }, { id: 'rts', label: 'BFME', icon: '◈' },
]
const CATEGORIES: Array<[UnitCategory, string]> = [['infantry', 'Пехота'], ['archers', 'Стрелки'], ['cavalry', 'Кавалерия'], ['monsters', 'Монстры'], ['siege', 'Осада']]
/** Suggested distinct hues for global-map faction colors; any custom color is allowed via the picker. */
const MAP_COLOR_PALETTE = ['#4a7fb5', '#56b6a5', '#c9973b', '#b33f32', '#709b4f', '#50618e', '#a9aca7', '#b06bb3', '#d0784a', '#8a5a44', '#c4547a', '#5aa0c9']

interface WorldDataEditorProps { onClose:()=>void; activeMod:ModDefinition; onModChange:(definition:ModDefinition)=>void }
export default function WorldDataEditor({ onClose, activeMod, onModChange }: WorldDataEditorProps) {
  const {language}=useI18n()
  const [tab, setTab] = useState<Tab>('factions')
  const [factionFilter, setFactionFilter] = useState('all')
  const [armyCreating, setArmyCreating] = useState(false)
  const [armyFactionId, setArmyFactionId] = useState('')
  const [armyLocationId, setArmyLocationId] = useState('')
  const [armyCommanderChoice, setArmyCommanderChoice] = useState('captain')
  const [armyInitialUnitId, setArmyInitialUnitId] = useState('')
  const [rtsBusy, setRtsBusy] = useState(false)
  const [rtsError, setRtsError] = useState<string|null>(null)
  const [autoBalanceCoefficient, setAutoBalanceCoefficient] = useState(() => { try { const saved = Number(window.localStorage.getItem('wotr.auto-balance-coefficient')); return Number.isFinite(saved) && saved > 0 ? Math.min(2, saved) : DEFAULT_AUTO_BALANCE_COEFFICIENT } catch { return DEFAULT_AUTO_BALANCE_COEFFICIENT } })
  const factions = useMapStore((state) => state.factions)
  const unitTypes = useMapStore((state) => state.unitTypes)
  const heroes = useMapStore((state) => state.heroes)
  const captains = useMapStore((state) => state.captains)
  const armies = useMapStore((state) => state.armies)
  const regions = useMapStore((state) => state.regions)
  const locations = useMapStore((state) => state.locations)
  const grid = useMapStore((state) => state.grid)
  const updateFaction = useMapStore((state) => state.updateFaction)
  const addFaction = useMapStore((state) => state.addFaction)
  const removeFaction = useMapStore((state) => state.removeFaction)
  const updateUnitType = useMapStore((state) => state.updateUnitType)
  const addUnitType = useMapStore((state) => state.addUnitType)
  const removeUnitType = useMapStore((state) => state.removeUnitType)
  const updateHero = useMapStore((state) => state.updateHero)
  const addHero = useMapStore((state) => state.addHero)
  const removeHero = useMapStore((state) => state.removeHero)
  const updateCaptain = useMapStore((state) => state.updateCaptain)
  const updateArmy = useMapStore((state) => state.updateArmy)
  const addArmy = useMapStore((state) => state.addArmy)
  const removeArmy = useMapStore((state) => state.removeArmy)
  const selectArmy = useMapStore((state) => state.selectArmy)
  const economicTypes = useMapStore((state) => state.economicTypes)
  const updateEconomicType = useMapStore((state) => state.updateEconomicType)
  const buildingTypes = useMapStore((state) => state.buildingTypes)
  const addBuildingType = useMapStore((state) => state.addBuildingType)
  const removeBuildingType = useMapStore((state) => state.removeBuildingType)
  const updateBuildingType = useMapStore((state) => state.updateBuildingType)
  const ringForging = useMapStore((state) => state.ringForging)
  const updateRingForging = useMapStore((state) => state.updateRingForging)
  const palantirSettings = useMapStore((state) => state.palantirSettings)
  const updatePalantirSettings = useMapStore((state) => state.updatePalantirSettings)
  const updateOwnerModifier = (item: EconomicTypeDefinition, key: keyof OwnerBattleModifiers, value: number | boolean) => {
    const owner = { ...(item.battleModifiers?.owner ?? {}), [key]: value }
    updateEconomicType(item.id, { battleModifiers: { owner } })
  }
  const updateRegion = useMapStore((state) => state.updateRegion)
  const addRegion = useMapStore((state) => state.addRegion)
  const removeRegion = useMapStore((state) => state.removeRegion)
  const selectHexes = useMapStore((state) => state.selectHexes)
  const setHexEdit = useMapStore((state) => state.setHexEdit)
  const setViewMode = useMapStore((state) => state.setViewMode)

  const orderedFactions = sortByText(factions, (item) => item.label)
  const orderedUnits = sortByText(unitTypes, (item) => item.name)
  const orderedHeroes = sortByText(heroes, (item) => item.name)
  const orderedCaptains = sortByText(captains, (item) => item.name)
  const orderedArmies = sortByText(armies, (item) => item.name)
  const orderedRegions = sortByText(regions, (item) => item.name)
  const orderedLocations = sortByText(locations, (item) => item.name)
  const playableFactions = orderedFactions.filter((item) => item.playable)
  const usedStartingHeroIds = new Set(armies.flatMap((army) => [...(army.commander?.kind === 'hero' ? [army.commander.entityId] : []), ...army.heroSlots.map((slot) => slot.entityId)]))
  const selectedArmyFaction = playableFactions.find((faction) => faction.id === armyFactionId) ?? playableFactions[0] ?? null
  const armyCreationLocations = selectedArmyFaction ? orderedLocations.filter((location) => location.side === selectedArmyFaction.id) : []
  const armyCreationHeroes = selectedArmyFaction ? orderedHeroes.filter((hero) => hero.factionId === selectedArmyFaction.id && hero.alive && hero.unlockType === 'starting' && !usedStartingHeroIds.has(hero.id)) : []
  const armyCreationUnits = selectedArmyFaction ? orderedUnits.filter((unit) => unit.factionId === selectedArmyFaction.id) : []
  const armyCreationCaptain = selectedArmyFaction ? captains.find((captain) => captain.factionId === selectedArmyFaction.id) ?? null : null
  const armyCreationCount = selectedArmyFaction ? armies.filter((army) => army.factionId === selectedArmyFaction.id).length : 0
  const armyCreationLimit = selectedArmyFaction ? factionArmyLimit(selectedArmyFaction, locations) : 0
  const effectiveArmyLocationId = armyCreationLocations.some((location) => location.id === armyLocationId) ? armyLocationId : armyCreationLocations[0]?.id ?? ''
  const effectiveArmyCommanderChoice = armyCommanderChoice === 'captain' || armyCreationHeroes.some((hero) => `hero:${hero.id}` === armyCommanderChoice) ? armyCommanderChoice : 'captain'
  const effectiveArmyUnitId = armyCreationUnits.some((unit) => unit.id === armyInitialUnitId) ? armyInitialUnitId : armyCreationUnits[0]?.id ?? ''
  const openArmyCreator = () => {
    const faction = playableFactions.find((item) => item.id === factionFilter) ?? playableFactions[0]
    if (!faction) return
    const factionLocations = orderedLocations.filter((location) => location.side === faction.id)
    const factionUnits = orderedUnits.filter((unit) => unit.factionId === faction.id)
    setArmyFactionId(faction.id)
    setArmyLocationId(factionLocations[0]?.id ?? '')
    setArmyCommanderChoice('captain')
    setArmyInitialUnitId(factionUnits[0]?.id ?? '')
    setArmyCreating(true)
  }
  const changeArmyCreationFaction = (id: string) => {
    setArmyFactionId(id)
    setArmyLocationId(orderedLocations.find((location) => location.side === id)?.id ?? '')
    setArmyInitialUnitId(orderedUnits.find((unit) => unit.factionId === id)?.id ?? '')
    setArmyCommanderChoice('captain')
  }

  const updateRts = (patch: Partial<ModDefinition['rts']>) => onModChange({ ...activeMod, updatedAt: new Date().toISOString(), rts: { ...activeMod.rts, ...patch } })
  const importSystemAsset = async (scope:'module'|'maps', file?:File) => {
    setRtsBusy(true);setRtsError(null)
    try {
      const id=scope==='module'?createAssetId('module'):'maps'
      const imported=file?await uploadRtsAsset(activeMod.id,scope,id,file,file.name):await pickAndImportRtsAsset(activeMod.id,scope,id)
      if(!imported)return
      const stored:RtsStoredFile={id,originalFileName:imported.originalFileName,targetFileName:imported.targetFileName,storageName:imported.storageName,size:imported.size}
      if(scope==='module')updateRts({moduleFiles:[...activeMod.rts.moduleFiles,stored]});else updateRts({mapsFile:stored})
    } catch(error){setRtsError(error instanceof Error?error.message:String(error))} finally {setRtsBusy(false)}
  }
  const removeSystemAsset = async (scope:'module'|'maps',id:string) => {
    setRtsBusy(true);setRtsError(null)
    try {await deleteRtsAsset(activeMod.id,scope,id);if(scope==='module')updateRts({moduleFiles:activeMod.rts.moduleFiles.filter((file)=>file.id!==id)});else updateRts({mapsFile:null})} catch(error){setRtsError(error instanceof Error?error.message:String(error))} finally {setRtsBusy(false)}
  }
  const moveRtsFaction = (id:string,direction:-1|1) => {const order=[...activeMod.rts.factionOrder];const index=order.indexOf(id);const target=index+direction;if(index<0||target<0||target>=order.length)return;[order[index],order[target]]=[order[target],order[index]];updateRts({factionOrder:order})}
  const supportedLocales = activeMod.supportedLocales?.length ? activeMod.supportedLocales : ['en']
  const addSupportedLocale = (locale: string) => { const normalized = locale.trim().toLowerCase(); if (!normalized || supportedLocales.includes(normalized)) return; onModChange({ ...activeMod, updatedAt: new Date().toISOString(), supportedLocales: [...new Set(['en', ...supportedLocales, normalized])], defaultLocale: activeMod.defaultLocale ?? 'en' }) }
  const translationTotals = [factions, locations, unitTypes, heroes, captains, regions, economicTypes ?? getActiveEconomicTypes()].flat().filter((item:any) => (item.name ?? item.label ?? '').trim())
  const translationStats = supportedLocales.filter((locale) => locale === language && locale !== 'en').map((locale) => { const translated = translationTotals.filter((item:any) => (item.nameTranslations ?? item.labelTranslations)?.[locale]?.trim()).length; return { locale, translated, total: translationTotals.length, percent: translationTotals.length ? Math.round(translated * 100 / translationTotals.length) : 100 } })

  const filterBar = (count: number, add: () => void, label: string) => <div className="database-toolbar"><select value={factionFilter} onChange={(event) => setFactionFilter(event.target.value)}><option value="all">Все фракции</option>{orderedFactions.filter((item) => item.id !== 'civilian').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><span>Объектов: {count}</span><button type="button" onClick={add}>＋ {label}</button></div>

  return (
    <div className="database-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="database-drawer">
        <header><div><span className="eyebrow">Редактор игровых данных</span><h2>Мир и кампания</h2>{language !== 'en' && translationStats.length > 0 && <p className="translation-stats">{language}: {translationStats.map((item) => <span key={item.locale}>{item.percent}% ({item.translated}/{item.total})</span>)}</p>}</div><button type="button" className="database-close" onClick={onClose} aria-label="Закрыть редактор данных"></button></header>
        <nav>{TABS.map((item) => <button type="button" key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => { setTab(item.id); setFactionFilter('all') }}><span>{item.icon}</span>{item.label}</button>)}</nav>
        <main>
          {tab === 'factions' && <>
            <div className="database-toolbar"><span>Игровых фракций: {orderedFactions.filter((item) => item.playable).length}</span><button type="button" onClick={addFaction}>＋ Добавить фракцию</button></div><p className="database-help">«Лимит полевых армий» ограничивает количество отдельных армий фракции на глобальной карте, чтобы не было спама мелких стеков. К этому числу добавляются бонусы контролируемых крупных городов. Например: база 2 + столица 1 = максимум 3 армии.</p>
            <div className="faction-editor-grid">{orderedFactions.map((faction) => {
              const dependencies = { locations: locations.filter((item) => item.side === faction.id).length, armies: armies.filter((item) => item.factionId === faction.id).length, units: unitTypes.filter((item) => item.factionId === faction.id).length, heroes: heroes.filter((item) => item.factionId === faction.id).length, captains: captains.filter((item) => item.factionId === faction.id).length }
              const removeWithConfirmation = () => {
                const details = [`объектов карты станет нейтральными: ${dependencies.locations}`, `армий будет удалено: ${dependencies.armies}`, `типов отрядов: ${dependencies.units}`, `героев: ${dependencies.heroes}`, `типов капитанов: ${dependencies.captains}`].join('\n')
                if (window.confirm(`Удалить фракцию «${faction.label}»?\n\n${details}\n\nВсе связи будут очищены автоматически. Это действие можно отменить через Ctrl+Z.`)) { removeFaction(faction.id); updateRts({ factionOrder: activeMod.rts.factionOrder.filter((id) => id !== faction.id) }) }
              }
              return <article key={faction.id} className="faction-editor-card" style={{ '--faction-color': faction.color } as CSSProperties}><div className="faction-identity-editor"><span className="faction-emblem-preview" style={faction.emblem ? { backgroundImage: `url(${faction.emblem})` } : undefined}></span><label title="Загрузить эмблему">✎<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={async (event) => { const file = event.target.files?.[0]; if (file) updateFaction(faction.id, { emblem: await imageFileToDataUrl(file) }); event.target.value = '' }} /></label>{faction.emblem && <button type="button" title="Сбросить эмблему" onClick={() => updateFaction(faction.id, { emblem: '' })}>×</button>}<div className="faction-map-color"><input type="color" value={/^#[0-9a-f]{6}$/i.test(faction.color)?faction.color:'#888888'} title="Цвет фракции на глобальной карте; должен быть уникальным — при совпадении подбирается ближайший свободный оттенок" onChange={(event) => { updateFaction(faction.id, { color: ensureUniqueFactionColor(event.target.value, factions.filter((item) => item.id !== faction.id).map((item) => item.color)) }) }} /><div className="map-color-palette" role="group" aria-label="Палитра цветов карты">{MAP_COLOR_PALETTE.map((preset) => { const taken = factions.some((item) => item.id !== faction.id && item.color.toLowerCase() === preset.toLowerCase()); return <button key={preset} type="button" className={taken ? 'taken' : ''} style={{ background: preset }} title={taken ? 'Занят другой фракцией — будет подобран ближайший свободный оттенок' : 'Задать цветом карты'} onClick={() => updateFaction(faction.id, { color: ensureUniqueFactionColor(preset, factions.filter((item) => item.id !== faction.id).map((item) => item.color)) })} /> })}</div></div>
<select className="rts-color-select" title="Цвет BFME для RTS-боёв; может совпадать у разных фракций" value={faction.rtsColor} onChange={(event) => { const selected=RTS_COLORS.find((color)=>color.id===event.target.value)!;updateFaction(faction.id,{rtsColor:selected.id}) }}>{RTS_COLORS.map((color)=><option key={color.id} value={color.id}>{color.label}</option>)}</select></div><LocalizedNameFields label="Название" canonical={faction.label} translations={faction.labelTranslations} language={language} supportedLocales={supportedLocales} onAddLocale={addSupportedLocale} onChange={(label, labelTranslations) => updateFaction(faction.id, { label, labelTranslations })} /><div className="faction-card-row"><select value={faction.alignment} onChange={(event) => updateFaction(faction.id, { alignment: event.target.value as typeof faction.alignment })}><option value="good">Свет</option><option value="evil">Тьма</option><option value="neutral">Нейтральная</option></select><label className="army-limit-field"><span>Лимит полевых армий</span><input type="number" min="0" max="20" value={faction.baseArmyLimit} onChange={(event) => updateFaction(faction.id, { baseArmyLimit: Number(event.target.value) })} /></label><label className="inline-check"><input type="checkbox" checked={faction.playable} onChange={(event) => updateFaction(faction.id, { playable: event.target.checked })} />Участвует в ходах</label></div><div className="faction-treasury-row"><label><span>Стартовое золото</span><input type="number" min="0" value={faction.startingTreasury.gold} onChange={(event) => updateFaction(faction.id, { startingTreasury: { ...faction.startingTreasury, gold: Number(event.target.value) } })} /></label><label><span>Стартовые материалы</span><input type="number" min="0" value={faction.startingTreasury.materials} onChange={(event) => updateFaction(faction.id, { startingTreasury: { ...faction.startingTreasury, materials: Number(event.target.value) } })} /></label></div><footer><code>{faction.id}</code><span>{dependencies.locations + dependencies.armies + dependencies.units + dependencies.heroes + dependencies.captains} связанных объектов</span><button type="button" disabled={faction.id === 'civilian'} title={faction.id === 'civilian' ? 'Системную нейтральную фракцию удалить нельзя' : 'Связанные данные будут очищены автоматически'} onClick={removeWithConfirmation}>Удалить фракцию</button></footer></article>
            })}</div>
          </>}

          {tab === 'economy' && <>
            <div className="database-toolbar"><span>Экономических типов: {(economicTypes ?? getActiveEconomicTypes()).length}</span></div>
            <p className="database-help">Эти правила задают дефолты при смене типа объекта, радиус обзора владений, бонус обороны в автобое, тип сражения (обычный/осада) и возможность найма капитанов. Доход конкретного объекта можно переопределить в инспекторе.</p>
            <div className="economy-type-list">
              {(economicTypes ?? getActiveEconomicTypes()).map((item) => {
                const count = locations.filter((location) => location.economicType === item.id).length
                return <article key={item.id} className="economy-type-card">
                  <header>
                    <div>
                      <small>ID · {item.id}</small>
                      <b>{localizedValue(item.name, item.nameTranslations, language)}</b>
                    </div>
                    <span>{count} на карте</span>
                  </header>
                  <LocalizedNameFields label="Название" canonical={item.name} translations={item.nameTranslations} language={language} supportedLocales={supportedLocales} onAddLocale={addSupportedLocale} onChange={(name, nameTranslations) => updateEconomicType(item.id, { name, nameTranslations })} />
                  <div className="economy-type-grid">
                    <label><span>Золото / ход</span><input type="number" min="0" value={item.gold} onChange={(event) => updateEconomicType(item.id, { gold: Number(event.target.value) })} /></label>
                    <label><span>Материалы / ход</span><input type="number" min="0" value={item.materials} onChange={(event) => updateEconomicType(item.id, { materials: Number(event.target.value) })} /></label>
                    <label><span>Слоты очереди</span><input type="number" min="0" max="20" value={item.recruitmentSlots} onChange={(event) => updateEconomicType(item.id, { recruitmentSlots: Number(event.target.value) })} /></label>
                    <label><span>Лимит ОК резерва</span><input type="number" min="0" max="10000" value={item.commandPointLimit} onChange={(event) => updateEconomicType(item.id, { commandPointLimit: Number(event.target.value) })} /></label>
                    <label><span>Обзор (гексов)</span><input type="number" min="0" max="12" value={item.visionRadius} onChange={(event) => updateEconomicType(item.id, { visionRadius: Number(event.target.value) })} /></label>
                    <label><span>Бонус обороны, %</span><input type="number" min="0" max="100" value={Math.round(item.defenseBonus * 100)} onChange={(event) => updateEconomicType(item.id, { defenseBonus: Number(event.target.value) / 100 })} /></label>
                    <label><span>Тип боя</span><select value={item.battleType} onChange={(event) => updateEconomicType(item.id, { battleType: event.target.value as 'settlement' | 'siege' })}><option value="settlement">Обычный / settlement</option><option value="siege">Осада / siege</option></select></label>
                  </div>
                  <div className="economy-type-flags">
                    <label className="inline-check"><input type="checkbox" checked={item.allowsCaptainHire} onChange={(event) => updateEconomicType(item.id, { allowsCaptainHire: event.target.checked })} />Найм капитанов</label>
                    <label className="inline-check"><input type="checkbox" checked={item.isCapital} onChange={(event) => updateEconomicType(item.id, { isCapital: event.target.checked })} />Считать столицей</label>
                    <label className="inline-check"><input type="checkbox" checked={item.allowedForDomain} onChange={(event) => updateEconomicType(item.id, { allowedForDomain: event.target.checked })} />Для владений</label>
                    <label className="inline-check"><input type="checkbox" checked={item.allowedForStronghold} onChange={(event) => updateEconomicType(item.id, { allowedForStronghold: event.target.checked })} />Для оплотов</label>
                  </div>
                  <details className="economy-battle-modifiers">
                    <summary>Слоты построек и боевые бонусы владельца</summary>
                    <div className="economy-type-grid">
                      <label><span>Слоты построек</span><input type="number" min="0" max="8" value={item.buildingSlots ?? 0} onChange={(event) => updateEconomicType(item.id, { buildingSlots: Number(event.target.value) })} /></label>
                      <label><span>Стартовые ресурсы (BFME)</span><input type="number" min="0" step="50" value={item.battleModifiers?.owner.startingResources ?? 0} onChange={(event) => updateOwnerModifier(item, 'startingResources', Number(event.target.value))} /></label>
                      <label><span>Командные очки</span><input type="number" min="0" step="10" value={item.battleModifiers?.owner.commandPointBonus ?? 0} onChange={(event) => updateOwnerModifier(item, 'commandPointBonus', Number(event.target.value))} /></label>
                      <label><span>Стартовые PP палантира</span><input type="number" min="0" max={palantirSettings.maxStartingPointsFromModifiers} value={item.battleModifiers?.owner.palantirStartingPoints ?? 0} onChange={(event) => updateOwnerModifier(item, 'palantirStartingPoints', Number(event.target.value))} /></label>
                      <label><span>PP за интервал</span><input type="number" min="0" max={palantirSettings.maxIncomePerIntervalFromModifiers} value={item.battleModifiers?.owner.palantirIncomePerInterval ?? 0} onChange={(event) => updateOwnerModifier(item, 'palantirIncomePerInterval', Number(event.target.value))} /></label>
                      <label><span>Бонус обороны в автобое, %</span><input type="number" min="0" max="100" value={Math.round((item.battleModifiers?.owner.defenseBonus ?? 0) * 100)} onChange={(event) => updateOwnerModifier(item, 'defenseBonus', Number(event.target.value) / 100)} /></label>
                      <label><span>Бонус засады, %</span><input type="number" min="0" max="100" value={Math.round((item.battleModifiers?.owner.ambushBonus ?? 0) * 100)} onChange={(event) => updateOwnerModifier(item, 'ambushBonus', Number(event.target.value) / 100)} /></label>
                      <label><span>Штраф местности, %</span><input type="number" min="0" max="100" value={Math.round((item.battleModifiers?.owner.terrainDebuff ?? 0) * 100)} onChange={(event) => updateOwnerModifier(item, 'terrainDebuff', Number(event.target.value) / 100)} /></label>
                    </div>
                    <label className="inline-check"><input type="checkbox" checked={Boolean(item.battleModifiers?.owner.signalFire)} onChange={(event) => updateOwnerModifier(item, 'signalFire', event.target.checked)} />Сигнальный огонь в бою</label>
                  </details>
                </article>
              })}
            </div>
          </>}

          {tab === 'buildings' && <>
            <div className="database-toolbar"><span>Типов построек: {buildingTypes.length}</span><button type="button" onClick={addBuildingType}>＋ Добавить постройку</button></div>
            <p className="database-help">Постройки занимают слоты локации (их число задаётся в экономических типах). Апгрейды выдаются армиям владельца в начале хода и остаются навсегда. Кольцекузня даёт бесплатный прогресс ковки Кольца.</p>
            <div className="economy-type-list">{buildingTypes.map((item) => <article key={item.id} className="economy-type-card">
              <header><div><small>ID · {item.id}</small><b>{item.icon} {localizedValue(item.name, item.nameTranslations, language)}</b></div><button type="button" onClick={() => removeBuildingType(item.id)}>Удалить</button></header>
              <LocalizedNameFields label="Название" canonical={item.name} translations={item.nameTranslations} language={language} supportedLocales={supportedLocales} onAddLocale={addSupportedLocale} onChange={(name, nameTranslations) => updateBuildingType(item.id, { name, nameTranslations })} />
              <label className="field"><span>Описание (подсказка при наведении)</span><textarea value={localizedValue(item.description, item.descriptionTranslations, language)} onChange={(event) => { const localized = localizedTranslationsPatch(language, item.description, item.descriptionTranslations, event.target.value); updateBuildingType(item.id, { description: localized.canonical, descriptionTranslations: localized.translations }) }} /></label>
              <div className="economy-type-grid">
                <label><span>Иконка</span><input value={item.icon} onChange={(event) => updateBuildingType(item.id, { icon: event.target.value })} /></label>
                <label><span>Стоимость, золото</span><input type="number" min="0" step="25" value={item.cost} onChange={(event) => updateBuildingType(item.id, { cost: Number(event.target.value) })} /></label>
                <label><span>Время постройки, ходов</span><input type="number" min="0" max="10" value={item.buildTime} onChange={(event) => updateBuildingType(item.id, { buildTime: Number(event.target.value) })} /></label>
                <label><span>Максимум в локации</span><input type="number" min="1" max="4" value={item.maxPerLocation} onChange={(event) => updateBuildingType(item.id, { maxPerLocation: Number(event.target.value) })} /></label>
                <label><span>Максимум у фракции (0 = без лимита)</span><input type="number" min="0" max="20" value={item.maxPerFaction} onChange={(event) => updateBuildingType(item.id, { maxPerFaction: Number(event.target.value) })} /></label>
                <label><span>Бонус уровня найма</span><input type="number" min="0" max="5" value={item.effects.recruitLevelBonus} onChange={(event) => updateBuildingType(item.id, { effects: { ...item.effects, recruitLevelBonus: Number(event.target.value) } })} /></label>
                <label><span>Прогресс ковки Кольца / ход</span><input type="number" min="0" max="10" value={item.effects.ringForgeBonus} onChange={(event) => updateBuildingType(item.id, { effects: { ...item.effects, ringForgeBonus: Number(event.target.value) } })} /></label>
              </div>
              <div className="economy-type-flags">
                {ARMY_UPGRADE_IDS.map((upgrade) => <label className="inline-check" key={upgrade}><input type="checkbox" checked={item.effects.armyUpgrades.includes(upgrade)} onChange={(event) => updateBuildingType(item.id, { effects: { ...item.effects, armyUpgrades: event.target.checked ? [...item.effects.armyUpgrades, upgrade] : item.effects.armyUpgrades.filter((id) => id !== upgrade) } })} />{UPGRADE_TITLES[upgrade]}</label>)}
                <label className="inline-check"><input type="checkbox" checked={item.destroyedOnCapture} onChange={(event) => updateBuildingType(item.id, { destroyedOnCapture: event.target.checked })} />Разрушается при захвате</label>
              </div>
              <div className="economy-type-grid">
                <label><span>Ресурсы в бою</span><input type="number" min="0" step="50" value={item.effects.battleModifiers.owner.startingResources ?? 0} onChange={(event) => updateBuildingType(item.id, { effects: { ...item.effects, battleModifiers: { owner: { ...item.effects.battleModifiers.owner, startingResources: Number(event.target.value) } } } })} /></label>
                <label><span>Командные очки</span><input type="number" min="0" step="10" value={item.effects.battleModifiers.owner.commandPointBonus ?? 0} onChange={(event) => updateBuildingType(item.id, { effects: { ...item.effects, battleModifiers: { owner: { ...item.effects.battleModifiers.owner, commandPointBonus: Number(event.target.value) } } } })} /></label>
                <label><span>Стартовые PP</span><input type="number" min="0" value={item.effects.battleModifiers.owner.palantirStartingPoints ?? 0} onChange={(event) => updateBuildingType(item.id, { effects: { ...item.effects, battleModifiers: { owner: { ...item.effects.battleModifiers.owner, palantirStartingPoints: Number(event.target.value) } } } })} /></label>
                <label><span>PP за интервал</span><input type="number" min="0" value={item.effects.battleModifiers.owner.palantirIncomePerInterval ?? 0} onChange={(event) => updateBuildingType(item.id, { effects: { ...item.effects, battleModifiers: { owner: { ...item.effects.battleModifiers.owner, palantirIncomePerInterval: Number(event.target.value) } } } })} /></label>
              </div>
              <label className="inline-check"><input type="checkbox" checked={Boolean(item.effects.battleModifiers.owner.signalFire)} onChange={(event) => updateBuildingType(item.id, { effects: { ...item.effects, battleModifiers: { owner: { ...item.effects.battleModifiers.owner, signalFire: event.target.checked } } } })} />Сигнальный огонь</label>
            </article>)}</div>
          </>}

          {tab === 'ring' && <>
            <div className="database-toolbar"><span>Ковка Кольца Всевластья</span></div>
            <p className="database-help">Каждая фракция может вкладывать золото в ковку; первая достигшая нужного прогресса получает Кольцо. Кольцо носит конкретная армия и переходит победителю, если носитель уничтожен.</p>
            <div className="economy-type-grid">
              <label className="inline-check"><input type="checkbox" checked={ringForging.enabled} onChange={(event) => updateRingForging({ enabled: event.target.checked })} />Ковка включена</label>
              <label><span>Нужный прогресс</span><input type="number" min="1" max="200" value={ringForging.requiredProgress} onChange={(event) => updateRingForging({ requiredProgress: Number(event.target.value) })} /></label>
              <label><span>Максимум вложений за ход</span><input type="number" min="1" max="10" value={ringForging.maxInvestmentPerTurn} onChange={(event) => updateRingForging({ maxInvestmentPerTurn: Number(event.target.value) })} /></label>
              <label><span>Стоимости вложений (через запятую)</span><input value={ringForging.investmentCosts.join(', ')} onChange={(event) => updateRingForging({ investmentCosts: event.target.value.split(',').map((part) => Number(part.trim())).filter((value) => Number.isFinite(value) && value > 0) })} /></label>
              <label><span>Бонус автобоя владельцу, %</span><input type="number" min="0" max="100" value={Math.round(ringForging.effects.autoBattleBonus * 100)} onChange={(event) => updateRingForging({ effects: { ...ringForging.effects, autoBattleBonus: Number(event.target.value) / 100 } })} /></label>
              <label><span>Фора всем врагам, %</span><input type="number" min="0" max="95" value={Math.round(ringForging.effects.handicapToAllEnemies * 100)} onChange={(event) => updateRingForging({ effects: { ...ringForging.effects, handicapToAllEnemies: Number(event.target.value) / 100 } })} /></label>
            </div>
            <h4 className="database-subhead">Палантир</h4>
            <p className="database-help">Базовые стартовые очки палантира и интервал их прироста (2 минуты) зашиты в саму BFME и не редактируются. Здесь задаётся только потолок для бонусов, которые стратегический слой может добавить сверху.</p>
            <div className="economy-type-grid">
              <label><span>Максимум стартовых PP</span><input type="number" min="0" max="10" value={palantirSettings.maxStartingPointsFromModifiers} onChange={(event) => updatePalantirSettings({ maxStartingPointsFromModifiers: Number(event.target.value) })} /></label>
              <label><span>Максимум прироста PP</span><input type="number" min="0" max="10" value={palantirSettings.maxIncomePerIntervalFromModifiers} onChange={(event) => updatePalantirSettings({ maxIncomePerIntervalFromModifiers: Number(event.target.value) })} /></label>
            </div>
          </>}

          {tab === 'units' && <>
            {filterBar(unitTypes.length, addUnitType, 'Добавить отряд')}
            <div className="auto-balance-toolbar"><span>Коэффициент авторасчёта силы</span><input type="number" min="0.01" max="2" step="0.01" value={autoBalanceCoefficient} onChange={(event) => { const value = Math.max(0.01, Math.min(2, Number(event.target.value))); setAutoBalanceCoefficient(value); try { window.localStorage.setItem('wotr.auto-balance-coefficient', String(value)) } catch {} }} /><small>Сила = BuildCost × коэффициент; остальные параметры рассчитываются автоматически.</small></div>
            <div className="data-table unit-table-v2">
              <div className="data-head"><span>Портрет</span><span>Название</span><span>BFME Object ID</span><span>BuildCost</span><span>ОК</span><span>Фракция</span><span>Класс</span><span>Сила</span><span>ОД</span><span>Золото</span><span>Мат.</span><span>Время</span><span>Содержание</span><span>Осадная сила</span><span>Авто</span><span /></div>
              {orderedUnits.filter((item) => factionFilter === 'all' || item.factionId === factionFilter).map((unit) => <div key={unit.id} className="unit-data-entry"><div className="data-row">
                <div className="unit-portrait-editor"><span style={unit.portrait ? { backgroundImage: `url(${unit.portrait})` } : undefined}></span><label title="Изменить портрет">✎<input type="file" accept="image/png,image/jpeg,image/webp" onChange={async (event) => { const file = event.target.files?.[0]; if (file) updateUnitType(unit.id, { portrait: await imageFileToDataUrl(file) }); event.target.value = '' }} /></label>{unit.portrait && <button type="button" onClick={() => updateUnitType(unit.id, { portrait: '' })}>×</button>}</div>
                <LocalizedNameFields label="Название" canonical={unit.name} translations={unit.nameTranslations} language={language} supportedLocales={supportedLocales} onAddLocale={addSupportedLocale} onChange={(name, nameTranslations) => updateUnitType(unit.id, { name, nameTranslations })} />
                <label><input className="object-id-input" value={unit.objectId} onChange={(event) => updateUnitType(unit.id, { objectId: event.target.value })} /><small>Unit_ID для BFME</small></label>
                <label className="bfme-reference-field"><input type="number" min="0" value={unit.buildCost ?? 0} onChange={(event) => updateUnitType(unit.id, { buildCost: Math.max(0, Number(event.target.value)) })} /><small>BuildCost BFME</small></label>
                <label className="bfme-reference-field"><input type="number" min="0" value={unit.commandPoints ?? 0} onChange={(event) => updateUnitType(unit.id, { commandPoints: Math.max(0, Number(event.target.value)) })} /><small>ОК BFME</small></label>
                <button type="button" className="auto-balance-button" title="Автоматически рассчитать силу, цену найма, время и содержание" onClick={() => updateUnitType(unit.id, autoBalanceUnit(unit, autoBalanceCoefficient))}>Авто</button>
                <select value={unit.factionId} onChange={(event) => updateUnitType(unit.id, { factionId: event.target.value, transformationSourceUnitId: null })}>{orderedFactions.filter((item) => item.playable).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
                <select value={unit.category} onChange={(event) => updateUnitType(unit.id, { category: event.target.value as UnitCategory })}>{CATEGORIES.map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select>
                <input type="number" min="1" max="9999" value={unit.battlePower} title="Влияет на автоматический бой" onChange={(event) => updateUnitType(unit.id, { battlePower: Number(event.target.value) })} />
                <input type="number" min="1" max="12" value={unit.movementPoints} title="Стратегические очки движения. Скорость армии равна скорости самого медленного отряда." onChange={(event) => updateUnitType(unit.id, { movementPoints: Number(event.target.value) })} />
                <input type="number" min="0" value={unit.recruitCost.gold} title="Цена найма в золоте" onChange={(event) => updateUnitType(unit.id, { recruitCost: { ...unit.recruitCost, gold: Number(event.target.value) } })} />
                <input type="number" min="0" value={unit.recruitCost.materials} title="Цена найма в материалах" onChange={(event) => updateUnitType(unit.id, { recruitCost: { ...unit.recruitCost, materials: Number(event.target.value) } })} />
                <input type="number" min="1" max="10" value={unit.recruitTime} title="Количество ходов найма" onChange={(event) => updateUnitType(unit.id, { recruitTime: Number(event.target.value) })} />
                <input type="number" min="0" value={unit.upkeep} title="Содержание в золоте за ход" onChange={(event) => updateUnitType(unit.id, { upkeep: Number(event.target.value) })} />
                <input type="number" min="0" max="999" value={unit.siegePower} title="Помогает атакующей армии преодолеть штраф при осаде крепости. Для обычных войск обычно 0." onChange={(event) => updateUnitType(unit.id, { siegePower: Number(event.target.value) })} />
                <button type="button" onClick={() => removeUnitType(unit.id)}>×</button>
              </div><div className="unit-recruitment-rules"><fieldset><legend>Допустимые типы локаций</legend>{ALL_SETTLEMENT_TYPES.map((type) => <label key={type}><input type="checkbox" checked={unit.requiredLocationTypes.includes(type)} onChange={(event) => updateUnitType(unit.id, { requiredLocationTypes: event.target.checked ? [...unit.requiredLocationTypes, type] : unit.requiredLocationTypes.filter((item) => item !== type) })} />{economicTypeLabel(type, language)}</label>)}</fieldset><label className="unit-transformation-source"><span>Способ получения</span><select value={unit.transformationSourceUnitId ?? ''} onChange={(event) => updateUnitType(unit.id, { transformationSourceUnitId: event.target.value || null })}><option value="">Прямой найм</option>{orderedUnits.filter((candidate) => candidate.factionId === unit.factionId && candidate.id !== unit.id && !candidate.transformationSourceUnitId).map((candidate) => <option key={candidate.id} value={candidate.id}>Преобразование: {candidate.name}</option>)}</select><small>{unit.transformationSourceUnitId ? 'Цена выше считается доплатой за преобразование исходного объекта.' : 'Отряд доступен в обычном списке найма.'}</small></label><label className="unit-required-tags"><span>Обязательные теги локации</span><input value={unit.requiredLocationTags.join(', ')} placeholder="коневодческий регион, промышленный центр…" onChange={(event) => updateUnitType(unit.id, { requiredLocationTags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean) })} /></label><label className="unit-max-level"><span>Максимальный уровень</span><input type="number" max="10" min="0" value={unit.maxLevel ?? rotwkUnitLevelCap(unit.objectId)} title="Потолок ветеранства из ROTWK 2.01: 0 - без уровней (осада, энты), 5 - обычные отряды, 10 - героические" onChange={(event) => updateUnitType(unit.id, { maxLevel: Math.max(0, Math.min(10, Number(event.target.value))) })} /></label><fieldset><legend>Доступные апгрейды</legend>{ARMY_UPGRADE_IDS.map((upgrade) => <label key={upgrade}><input type="checkbox" checked={(unit.availableUpgrades ?? [...ARMY_UPGRADE_IDS]).includes(upgrade)} onChange={(event) => { const current = unit.availableUpgrades ?? [...ARMY_UPGRADE_IDS]; updateUnitType(unit.id, { availableUpgrades: event.target.checked ? [...current, upgrade] : current.filter((id) => id !== upgrade) }) }} />{UPGRADE_TITLES[upgrade]}</label>)}</fieldset><label className="unit-occupation-toggle"><input type="checkbox" checked={unit.recruitDuringOccupation} onChange={(event) => updateUnitType(unit.id, { recruitDuringOccupation: event.target.checked })} /><span><b>Найм во время оккупации</b><small>Разрешить этот отряд до полного подчинения локации</small></span></label></div></div>)}
            </div>
            <p className="database-help">Object ID можно заменить точным идентификатором из вашего мода BFME. «Сила» используется в автоматическом бою. «ОД» задаёт стратегическую скорость отряда; армия движется со скоростью самого медленного. «Осадная сила» уменьшает штраф атакующей армии при штурме крепости; для обычных отрядов можно оставить 0. В RTS объект будет создан по Object ID.</p>
          </>}
          {tab === 'heroes' && <>
            {filterBar(heroes.length, addHero, 'Добавить героя')}
            <p className="database-help">Стартовые герои участвуют с первого раунда. Остальные открываются по раунду, контролю локации или обоим условиям и затем призываются за золото. Тип «Особое событие» подготовлен для будущих сюжетных правил.</p>
            <div className="hero-editor-grid hero-catalog-grid">{orderedHeroes.filter((item) => factionFilter === 'all' || item.factionId === factionFilter).map((hero) => {
              const faction = getFaction(factions, hero.factionId)
              return <article key={hero.id} className="hero-editor-card hero-editor-v3 hero-catalog-card">
                <div className="hero-portrait-editor"><span className="fake-portrait" style={{ '--portrait-color': faction.color, ...(hero.portrait ? { backgroundImage: `url(${hero.portrait})` } : {}) } as CSSProperties}></span><label>Изменить<input type="file" accept="image/png,image/jpeg,image/webp" onChange={async (event) => { const file = event.target.files?.[0]; if (file) updateHero(hero.id, { portrait: await imageFileToDataUrl(file) }); event.target.value = '' }} /></label>{hero.portrait && <button type="button" onClick={() => updateHero(hero.id, { portrait: '' })}>Сбросить</button>}</div>
                <div className="hero-main-fields">
                  <LocalizedNameFields label="Имя" canonical={hero.name} translations={hero.nameTranslations} language={language} supportedLocales={supportedLocales} onAddLocale={addSupportedLocale} onChange={(name, nameTranslations) => updateHero(hero.id, { name, nameTranslations })} />
                  <label className="hero-faction-field"><span>Фракция</span><select value={hero.factionId} onChange={(event) => updateHero(hero.id, { factionId: event.target.value })}>{orderedFactions.filter((item) => item.playable).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
                  <label className="hero-wide-field"><span>Титул</span><input value={localizedValue(hero.title,hero.titleTranslations,language)} onChange={(event) => {const localized=localizedTranslationsPatch(language,hero.title,hero.titleTranslations,event.target.value);updateHero(hero.id,{title:localized.canonical,titleTranslations:localized.translations})}} /></label>
                  <label className="hero-wide-field"><span>BFME Object ID</span><input className="object-id-input" value={hero.objectId} placeholder="GondorAragorn" onChange={(event) => updateHero(hero.id, { objectId: event.target.value })} /></label>
                </div>
                <div className="hero-used-stats hero-reference-stats">
                  <label><span>BuildCost BFME</span><input type="number" min="0" value={hero.buildCost ?? 0} onChange={(event) => updateHero(hero.id, { buildCost: Math.max(0, Number(event.target.value)) })} /><small>Справочная цена</small></label><label><span>Очки командования</span><input type="number" min="0" value={hero.commandPoints ?? 0} onChange={(event) => updateHero(hero.id, { commandPoints: Math.max(0, Number(event.target.value)) })} /><small>Занимает ОК в армии</small></label><button type="button" className="auto-balance-button" onClick={() => updateHero(hero.id, autoBalanceHero(hero, autoBalanceCoefficient))}>Авторасчёт</button>
                  <label><span>Лимит ОК армии</span><input type="number" min="1" max="10000" value={hero.commandPointLimit ?? 600} onChange={(event) => updateHero(hero.id, { commandPointLimit: Math.max(1, Number(event.target.value)) })} /><small>Вместимость армии</small></label><label><span>Базовая сила</span><input type="number" min="1" max="9999" value={hero.battlePower} onChange={(event) => updateHero(hero.id, { battlePower: Number(event.target.value) })} /><small>Личная сила в автобое</small></label>
                  <label><span>Командование, %</span><input type="number" min="0" max="30" value={hero.command} onChange={(event) => updateHero(hero.id, { command: Number(event.target.value) })} /><small>Бонус ко всей армии</small></label>
                  <label><span>Бонус движения, ОД</span><input type="number" min="0" max="3" value={hero.movementBonus} onChange={(event) => updateHero(hero.id, { movementBonus: Number(event.target.value) })} /><small>Добавляется к максимуму ОД</small></label>
                </div>
                <div className="hero-unlock-editor">
                  <label className="hero-unlock-type"><span>Способ появления</span><select value={hero.unlockType} onChange={(event) => updateHero(hero.id, { unlockType: event.target.value as HeroUnlockType })}><option value="starting">Доступен со старта</option><option value="turn">После указанного раунда</option><option value="location">При контроле локации</option><option value="turn_location">Раунд и контроль локации</option><option value="special">Особое событие — в будущем</option></select></label>
                  <label><span>Минимальный раунд</span><input type="number" min="1" max="999" value={hero.requiredTurn} disabled={!['turn','turn_location'].includes(hero.unlockType)} onChange={(event) => updateHero(hero.id, { requiredTurn: Math.max(1, Number(event.target.value)) })} /></label>
                  <label className="hero-unlock-location"><span>{['location','turn_location'].includes(hero.unlockType) ? 'Обязательная локация' : 'Локация появления'}</span><select value={hero.requiredLocationId ?? ''} onChange={(event) => updateHero(hero.id, { requiredLocationId: event.target.value || null })}><option value="">Не выбрана — использовать столицу фракции</option>{orderedLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select><small>{hero.unlockType === 'starting' ? 'Стартовый герой появится здесь, если он не добавлен в стартовую армию.' : 'Для типов с контролем эта локация также является условием разблокировки.'}</small></label>
                  <label><span>Стоимость призыва, золото</span><input type="number" min="0" max="99999" value={hero.summonCostGold} disabled={hero.unlockType === 'starting'} onChange={(event) => updateHero(hero.id, { summonCostGold: Math.max(0, Number(event.target.value)) })} /></label>
                </div>
                <footer className="hero-card-footer"><button type="button" onClick={() => { if (window.confirm(`Удалить героя «${hero.name}»? Он также будет удалён из всех армий.`)) removeHero(hero.id) }}>Удалить героя</button></footer>
              </article>
            })}</div>
          </>}
          {tab === 'captains' && <>
            <div className="database-toolbar"><select value={factionFilter} onChange={(event) => setFactionFilter(event.target.value)}><option value="all">Все фракции</option>{orderedFactions.filter((item) => item.playable).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><span>Типов капитанов: {captains.length}</span></div>
            <div className="captain-rules-card"><b>Для каждой фракции существует один неизменяемый тип капитана.</b> Новые типы вручную не создаются. Здесь настраиваются общий портрет, параметры командования и список случайных имён всех капитанов этой фракции.</div>
            <div className="hero-editor-grid captain-editor-grid">{orderedCaptains.filter((item) => factionFilter === 'all' || item.factionId === factionFilter).map((captain) => {
              const faction = getFaction(factions, captain.factionId)
              return <article key={captain.id} className="hero-editor-card hero-editor-v3 captain-editor-card"><div className="hero-portrait-editor"><span className="fake-portrait" style={{ '--portrait-color': faction.color, ...(captain.portrait ? { backgroundImage: `url(${captain.portrait})` } : {}) } as CSSProperties}></span><label>Изменить<input type="file" accept="image/png,image/jpeg,image/webp" onChange={async (event) => { const file = event.target.files?.[0]; if (file) updateCaptain(captain.id, { portrait: await imageFileToDataUrl(file) }); event.target.value = '' }} /></label>{captain.portrait && <button type="button" onClick={() => updateCaptain(captain.id, { portrait: '' })}>Сбросить</button>}</div><div className="hero-main-fields"><LocalizedNameFields label="Название типа" canonical={captain.name} translations={captain.nameTranslations} language={language} supportedLocales={supportedLocales} onAddLocale={addSupportedLocale} onChange={(name, nameTranslations) => updateCaptain(captain.id, { name, nameTranslations })} /><label className="hero-wide-field"><span>Фракция</span><select value={captain.factionId} disabled><option value={captain.factionId}>{faction.label}</option></select></label></div><div className="hero-used-stats"><label><span>Символическая сила</span><input type="number" min="1" max="50" value={captain.battlePower} onChange={(event) => updateCaptain(captain.id, { battlePower: Math.max(1, Math.min(50, Number(event.target.value))) })} /><small>Рекомендуется 30–50</small></label><label><span>Лимит ОК армии</span><input type="number" min="1" max="10000" value={captain.commandPointLimit ?? 300} onChange={(event) => updateCaptain(captain.id, { commandPointLimit: Math.max(1, Number(event.target.value)) })} /><small>Вместимость армии</small></label><label><span>Командование, %</span><input type="number" min="0" max="5" value={captain.command} onChange={(event) => updateCaptain(captain.id, { command: Math.max(0, Math.min(5, Number(event.target.value))) })} /><small>Рекомендуется 3–5%</small></label><label><span>Бонус движения</span><input type="number" min="0" max="1" value={captain.movementBonus} onChange={(event) => updateCaptain(captain.id, { movementBonus: Math.max(0, Math.min(1, Number(event.target.value))) })} /><small>Обычно 0 ОД</small></label></div><label className="captain-name-pool"><span>Список случайных имён капитанов</span><textarea value={(language==='en'?captain.namePool:captain.namePoolTranslations[language]??captain.namePool).join('\n')} placeholder="Одно имя на строку" onChange={(event) => {const names=event.target.value.split(/[\n,]+/).map((name)=>name.trim()).filter(Boolean);if(language==='en')updateCaptain(captain.id,{namePool:names});else updateCaptain(captain.id,{namePoolTranslations:{...captain.namePoolTranslations,[language]:names}})}} /><small>Все новые капитаны фракции используют этот портрет и получают случайное имя из списка.</small></label></article>
            })}</div>
          </>}
          {tab === 'armies' && <>
            <div className="database-toolbar"><select value={factionFilter} onChange={(event) => setFactionFilter(event.target.value)}><option value="all">Все фракции</option>{orderedFactions.filter((item) => item.playable).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><span>Стартовых армий: {armies.length}</span><button type="button" onClick={openArmyCreator}>＋ Стартовая армия</button></div><p className="database-help">При создании заранее выбираются фракция, собственная стартовая локация, уникальный командир и первый боевой отряд. Число стартовых армий можно задавать независимо от полевого лимита; если оно выше лимита, новые армии во время кампании нельзя будет формировать до его увеличения.</p>
            <div className="army-editor-list">{orderedArmies.filter((item) => factionFilter === 'all' || item.factionId === factionFilter).map((army) => {
              const faction = getFaction(factions, army.factionId)
              const used = orderedArmies.filter((item) => item.factionId === army.factionId).length
              const limit = factionArmyLimit(faction, locations)
              const unitCap = armyUnitSlotCap(army)
              const commandPointTotal = armyCommandPoints(army, unitTypes, heroes)
              const commandPointLimit = armyCommandPointLimit(army, heroes, captains)
              const factionLocations = orderedLocations.filter((location) => location.side === army.factionId)
              const armyLocation = factionLocations.find((location) => locationHexId(location, grid.config) === army.hexId) ?? null
              return <article key={army.id} style={{ '--faction-color': faction.color } as CSSProperties}>
                <span className="army-editor-flag">⚔</span>
                <div className="army-template-name"><b>{army.name}</b></div>
                <label><span>Фракция · старт {used}, полевой лимит {limit}</span><select value={army.factionId} onChange={(event) => { const factionId = event.target.value; const location = orderedLocations.find((item) => item.side === factionId); updateArmy(army.id, { factionId, ...(location ? { hexId: locationHexId(location, grid.config) } : {}) }) }}>{playableFactions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>{used > limit && <small className="army-limit-overflow">Стартовых армий больше полевого лимита</small>}</label>
                <label><span>Стартовый объект</span><select value={armyLocation?.id ?? ''} onChange={(event) => { const location = locations.find((item) => item.id === event.target.value); if (location) updateArmy(army.id, { hexId: locationHexId(location, grid.config) }) }}><option value="" disabled>Выберите свой объект</option>{factionLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select>{!armyLocation && <small className="army-limit-overflow">Армия находится вне своего объекта</small>}</label>
                <div className={`army-template-commander ${army.commander ? 'ready' : 'missing'}`}><span>{army.commander ? 'Командир назначен' : 'Нет командира'}</span><small>ОК {commandPointTotal}/{commandPointLimit} · Герои {army.heroSlots.length}/{army.heroSlotLimit}</small></div>
                <div className="army-editor-actions"><button type="button" onClick={() => { selectArmy(army.id); onClose() }}>Настроить состав</button><button type="button" onClick={() => removeArmy(army.id)}>Удалить</button></div>
              </article>
            })}</div>
          </>}
          {tab === 'regions' && <>
            <div className="database-toolbar"><span>Регионов: {regions.length}</span><button type="button" onClick={addRegion}>＋ Новый регион</button></div>
            <p className="database-help">Регион — верхний уровень карты: именованный набор гексов суши. Владения и оплоты обязаны лежать внутри региона. Гексы владения генерируются автоматически внутри границ региона; оплот занимает один гекс и не входит ни в одно владение. Полный контроль региона даёт фракция, владеющая всеми объектами внутри него.</p>
            <div className="region-editor-list">{orderedRegions.map((region) => {
              const objects = orderedLocations.filter((location) => location.regionId === region.id)
              const domains = objects.filter((location) => location.structuralType === 'domain')
              const strongholds = objects.filter((location) => location.structuralType === 'stronghold')
              const owner = region.ownerFactionId ? getFaction(factions, region.ownerFactionId) : null
              return <article key={region.id} style={{ '--region-color': region.color || owner?.color || '#69747a' } as CSSProperties}>
                <span className="region-editor-symbol" style={{ background: region.color }}>⬡</span>
                <LocalizedNameFields label="Название" canonical={region.name} translations={region.nameTranslations} language={language} supportedLocales={supportedLocales} onAddLocale={addSupportedLocale} onChange={(name, nameTranslations) => updateRegion(region.id, { name, nameTranslations })} />
                <label><span>Цвет региона</span><input type="color" value={/^#[0-9a-f]{6}$/i.test(region.color) ? region.color : '#7A8B99'} onChange={(event) => updateRegion(region.id, { color: event.target.value })} /></label>
                <div className="region-readonly-field"><span>Гексов</span><b>{region.hexes.length}</b></div>
                <div className="region-readonly-field"><span>Владений / оплотов</span><b>{domains.length} / {strongholds.length}</b></div>
                <div className="region-readonly-field"><span>Полный контроль</span><b style={{ color: owner?.color }}>{owner?.label ?? 'Нет'}</b></div>
                <label className="region-description"><span>Описание</span><textarea value={localizedValue(region.description, region.descriptionTranslations, language)} onChange={(event) => { const localized = localizedTranslationsPatch(language, region.description, region.descriptionTranslations, event.target.value); updateRegion(region.id, { description: localized.canonical, descriptionTranslations: localized.translations }) }} /></label>
                <details className="region-full-control">
                  <summary>Бонусы полного контроля</summary>
                  <div className="economy-type-grid">
                    <label><span>Бонус автобоя, %</span><input type="number" min="0" max="100" value={Math.round((region.fullControlBonus?.autoBattleBonus ?? 0) * 100)} onChange={(event) => updateRegion(region.id, { fullControlBonus: { battleModifiers: region.fullControlBonus?.battleModifiers ?? { owner: {} }, autoBattleBonus: Number(event.target.value) / 100 } })} /></label>
                    <label><span>Ресурсы в бою</span><input type="number" min="0" step="50" value={region.fullControlBonus?.battleModifiers.owner.startingResources ?? 0} onChange={(event) => updateRegion(region.id, { fullControlBonus: { autoBattleBonus: region.fullControlBonus?.autoBattleBonus ?? 0, battleModifiers: { owner: { ...(region.fullControlBonus?.battleModifiers.owner ?? {}), startingResources: Number(event.target.value) } } } })} /></label>
                    <label><span>Командные очки</span><input type="number" min="0" step="10" value={region.fullControlBonus?.battleModifiers.owner.commandPointBonus ?? 0} onChange={(event) => updateRegion(region.id, { fullControlBonus: { autoBattleBonus: region.fullControlBonus?.autoBattleBonus ?? 0, battleModifiers: { owner: { ...(region.fullControlBonus?.battleModifiers.owner ?? {}), commandPointBonus: Number(event.target.value) } } } })} /></label>
                  </div>
                </details>
                <div className="region-object-list"><small>Объекты внутри региона</small>{objects.length ? objects.map((location) => <span key={location.id}>{location.structuralType === 'stronghold' ? '♜' : '●'} {location.name}</span>) : <i>Пусто</i>}</div>
                <div className="army-editor-actions">
                  <button type="button" onClick={() => { setHexEdit(true); setViewMode('strategic'); selectHexes(region.hexes); onClose() }}>Редактировать гексы</button>
                  <button type="button" disabled={objects.length > 0} title={objects.length ? 'Сначала переместите или удалите объекты внутри региона' : 'Удалить пустой регион'} onClick={() => { if (window.confirm(`Удалить регион «${region.name}»?`)) removeRegion(region.id) }}>Удалить</button>
                </div>
              </article>
            })}</div>
          </>}
          {tab === 'rts' && <div className="rts-settings-page">{rtsError&&<div className="mod-manager-error">{rtsError}</div>}<section className="rts-settings-card"><header><div><small>Системные настройки мода</small><h3>Порядок фракций BFME</h3></div><label className="inline-check"><input type="checkbox" checked={activeMod.rts.enabled} onChange={(event)=>updateRts({enabled:event.target.checked})}/>Интеграция включена</label><b>{activeMod.rts.factionOrder.length} фракций</b></header><p>Порядок должен полностью совпадать со списком фракций в комнате BFME. Индекс используется автоматизацией при выборе фракции.</p><div className="rts-faction-order">{activeMod.rts.factionOrder.map((id,index)=>{const faction=factions.find((item)=>item.id===id);if(!faction)return null;return <article key={id}><strong>{index+1}</strong><span style={{background:faction.color}}/><b>{faction.label}</b><small>{RTS_COLORS.find((color)=>color.id===faction.rtsColor)?.label}</small><button disabled={index===0} onClick={()=>moveRtsFaction(id,-1)}>↑</button><button disabled={index===activeMod.rts.factionOrder.length-1} onClick={()=>moveRtsFaction(id,1)}>↓</button><button className="danger" onClick={()=>updateRts({factionOrder:activeMod.rts.factionOrder.filter((item)=>item!==id)})}>×</button></article>})}</div>{playableFactions.some((faction)=>!activeMod.rts.factionOrder.includes(faction.id))&&<label className="rts-add-faction"><span>Добавить в список BFME</span><select defaultValue="" onChange={(event)=>{if(event.target.value){updateRts({factionOrder:[...activeMod.rts.factionOrder,event.target.value]});event.target.value=''}}}><option value="">Выберите фракцию…</option>{playableFactions.filter((faction)=>!activeMod.rts.factionOrder.includes(faction.id)).map((faction)=><option key={faction.id} value={faction.id}>{faction.label}</option>)}</select></label>}</section><section className="rts-settings-card"><header><div><small>Копируются в папку игры перед боем</small><h3>Файлы мода</h3></div><button type="button" disabled={rtsBusy} onClick={()=>void importSystemAsset('module')}>＋ Добавить BIG</button></header><div className="rts-file-list">{activeMod.rts.moduleFiles.map((file)=><article key={file.id}><span>◫</span><div><b>{file.originalFileName}</b><small>{(file.size/1024).toFixed(1)} КБ</small></div><label><small>Имя в папке игры</small><input className={!validBigFileName(file.targetFileName)?'invalid':''} value={file.targetFileName} onChange={(event)=>updateRts({moduleFiles:activeMod.rts.moduleFiles.map((item)=>item.id===file.id?{...item,targetFileName:event.target.value}:item)})}/></label><button className="danger" onClick={()=>void removeSystemAsset('module',file.id)}>Удалить</button></article>)}{!activeMod.rts.moduleFiles.length&&<p>Дополнительные INI/данные мода ещё не добавлены.</p>}</div><label className="rts-browser-upload">Загрузить BIG в browser-dev<input type="file" accept=".big" onChange={(event)=>{const file=event.target.files?.[0];if(file)void importSystemAsset('module',file);event.target.value=''}}/></label></section><section className="rts-settings-card"><header><div><small>Единственный архив со всеми RTS-картами</small><h3>Архив карт</h3></div><button type="button" disabled={rtsBusy} onClick={()=>void importSystemAsset('maps')}>{activeMod.rts.mapsFile?'Заменить':'Выбрать BIG'}</button></header>{activeMod.rts.mapsFile?<div className="rts-single-file"><span>▧</span><div><b>{activeMod.rts.mapsFile.originalFileName}</b><small>{(activeMod.rts.mapsFile.size/1024/1024).toFixed(2)} МБ</small></div><label><small>Имя в папке игры</small><input className={!validBigFileName(activeMod.rts.mapsFile.targetFileName)?'invalid':''} value={activeMod.rts.mapsFile.targetFileName} onChange={(event)=>updateRts({mapsFile:{...activeMod.rts.mapsFile!,targetFileName:event.target.value}})}/></label><button className="danger" onClick={()=>void removeSystemAsset('maps','maps')}>Удалить</button></div>:<p>Без общего архива карт RTS-сражения запускать нельзя.</p>}<label className="rts-browser-upload">Загрузить архив карт в browser-dev<input type="file" accept=".big" onChange={(event)=>{const file=event.target.files?.[0];if(file)void importSystemAsset('maps',file);event.target.value=''}}/></label><label className="rts-wide-field"><span>Имя активного кэша карты в папке игры</span><input className={!validBigFileName(activeMod.rts.mapCacheTargetFileName)?'invalid':''} value={activeMod.rts.mapCacheTargetFileName} onChange={(event)=>updateRts({mapCacheTargetFileName:event.target.value})}/><small>Перед каждым боем файл перезаписывается кэшем выбранного объекта карты.</small></label><fieldset className="rts-network-rules"><legend>Rts:Rules для NetworkPref.ini</legend><p>Доступны только стандартные значения NetworkPref.ini.</p><div><label><span>Максимум ОК</span><select value={networkRuleParts(activeMod.rts.networkRules).command} onChange={(event)=>updateRts({networkRules:withNetworkRulePart(activeMod.rts.networkRules,3,Number(event.target.value))})}>{NETWORK_COMMAND_VALUES.map((value)=><option key={value} value={value}>{value} ({value * 10} ОК)</option>)}</select></label><label><span>Стартовые ресурсы</span><select value={networkRuleParts(activeMod.rts.networkRules).resources} onChange={(event)=>updateRts({networkRules:withNetworkRulePart(activeMod.rts.networkRules,4,Number(event.target.value))})}>{NETWORK_RESOURCE_VALUES.map((value)=><option key={value} value={value}>{value}</option>)}</select></label></div><code>{activeMod.rts.networkRules}</code></fieldset></section><section className="rts-settings-card rts-map-cache-note"><b>Кэши отдельных карт загружаются у владений и оплотов.</b><p>Каждый объект карты (владение или оплот) хранит собственный небольшой BIG с Maps\MapCache.ini. Перед сражением он копируется под указанным выше именем.</p></section></div>}
        </main>
      </section>
      {armyCreating && <div className="mod-create-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) setArmyCreating(false) }}><section className="mod-create-dialog starting-army-dialog"><header><div><small>Стартовый шаблон</small><h2>Новая армия</h2></div><button type="button" onClick={() => setArmyCreating(false)}>×</button></header><label><span>Фракция</span><select value={selectedArmyFaction?.id ?? ''} onChange={(event) => changeArmyCreationFaction(event.target.value)}>{playableFactions.map((faction) => <option key={faction.id} value={faction.id}>{faction.label}</option>)}</select></label><label><span>Стартовый объект</span><select value={effectiveArmyLocationId} onChange={(event) => setArmyLocationId(event.target.value)}><option value="" disabled>У фракции нет своего объекта карты</option>{armyCreationLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select><small>Армия будет размещена точно на якорном гексе выбранного объекта.</small></label><label><span>Командир</span><select value={effectiveArmyCommanderChoice} onChange={(event) => setArmyCommanderChoice(event.target.value)}><option value="captain" disabled={!armyCreationCaptain}>Новый капитан с уникальным именем</option>{armyCreationHeroes.map((hero) => <option key={hero.id} value={`hero:${hero.id}`}>Герой: {hero.name}</option>)}</select><small>В списке героев показываются только доступные со старта и ещё не назначенные командиры.</small></label><label><span>Первый боевой отряд</span><select value={effectiveArmyUnitId} onChange={(event) => setArmyInitialUnitId(event.target.value)}><option value="" disabled>У фракции нет отрядов</option>{armyCreationUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}{unit.transformationSourceUnitId ? ' · результат преобразования' : ''}</option>)}</select><small>Пустая стартовая армия не создаётся. Остальной состав можно добавить после создания.</small></label><div className={`starting-army-limit-summary ${armyCreationCount >= armyCreationLimit ? 'reached' : ''}`}><span>Стартовых армий после создания</span><b>{armyCreationCount + 1}</b><small>Полевой лимит: {armyCreationLimit}. Превышение допустимо для стартового сценария, но заблокирует формирование новых армий в кампании.</small></div><footer><button type="button" onClick={() => setArmyCreating(false)}>Отмена</button><button type="button" className="primary" disabled={!selectedArmyFaction || !effectiveArmyLocationId || !effectiveArmyUnitId || effectiveArmyCommanderChoice === 'captain' && !armyCreationCaptain} onClick={() => { if (!selectedArmyFaction) return; addArmy(selectedArmyFaction.id, effectiveArmyLocationId, effectiveArmyCommanderChoice, effectiveArmyUnitId); setFactionFilter(selectedArmyFaction.id); setArmyCreating(false) }}>Создать армию</button></footer></section></div>}
    </div>
  )
}
