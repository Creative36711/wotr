import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { getFaction, TERRAINS, TERRAIN_BY_ID } from '../constants'
import { armyMovementBreakdown, armyMovementCap, armyUnitSlotCap, buildBfmeArmyPayload, commanderDefinition, createCaptainCommander, createHeroCommander, createHeroSlot, createUnitSlot, factionArmyLimit, factionCaptainCount, factionCaptainLimit, generateUniqueCaptainName } from '../game/army'
import { canFactionPlan, isFactionActive, isMovementPhase } from '../game/campaign'
import { armyIntelLabel, calculateVisibleHexes, garrisonIntelCategory, garrisonIntelLabel } from '../game/fogOfWar'
import { recruitableUnitsAtLocation } from '../game/recruitment'
import { locationHexId, resolveGrid } from '../hex/hexGrid'
import { useMapStore } from '../store/useMapStore'
import { imageFileToDataUrl } from '../utils/image'
import { uploadRtsAsset } from '../dataService'
import LocalizedNameFields from './LocalizedNameFields'
import type { ImportedRtsAsset } from '../dataService'
import type { RtsMapAsset } from '../types'
import { sortByText } from '../utils/sort'
import { domainEconomicTypeIds, economicDefaultsPatch, economicTypeLabel, getEconomicType, strongholdEconomicTypeIds } from '../game/economicTypes'
import { useI18n } from '../i18n'
import type { Army, FactionId, HexCellOverride, LastSeenLocationIntel, StructuralType, LogicalHex, MapLocation, ModDefinition, SettlementType } from '../types'


interface SwitchFieldProps {
  label: string
  description?: string
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}

function SwitchField({ label, description, checked, disabled, onChange }: SwitchFieldProps) {
  return (
    <label className={`switch-field ${disabled ? 'disabled' : ''}`}>
      <span><b>{label}</b>{description && <small>{description}</small>}</span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <i />
    </label>
  )
}

function commonValue<T>(cells: LogicalHex[], read: (cell: LogicalHex) => T): T | undefined {
  if (!cells.length) return undefined
  const first = read(cells[0])
  return cells.every((cell) => read(cell) === first) ? first : undefined
}

function BatchChoice({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean | undefined
  onChange: (value: boolean) => void
}) {
  return (
    <div className="batch-choice">
      <span>{label}</span>
      <div>
        <button type="button" className={value === true ? 'active yes' : ''} onClick={() => onChange(true)}>Включить</button>
        <button type="button" className={value === false ? 'active no' : ''} onClick={() => onChange(false)}>Выключить</button>
      </div>
    </div>
  )
}

function MultiHexInspector({ cells }: { cells: LogicalHex[] }) {
  const grid = useMapStore((state) => state.grid)
  const factions = useMapStore((state) => state.factions)
  const regions = useMapStore((state) => state.regions)
  const orderedFactions = sortByText(factions, (item) => item.label)
  const orderedRegions = sortByText(regions, (item) => item.name)
  const updateHexes = useMapStore((state) => state.updateHexes)
  const setHexesTerrain = useMapStore((state) => state.setHexesTerrain)
  const resetHexes = useMapStore((state) => state.resetHexes)
  const ids = cells.map((cell) => cell.id)
  const terrain = commonValue(cells, (cell) => cell.terrain)
  const moveCost = commonValue(cells, (cell) => cell.moveCost)
  const passable = commonValue(cells, (cell) => cell.passable)
  const road = commonValue(cells, (cell) => cell.road)
  const river = commonValue(cells, (cell) => cell.river)
  const owner = commonValue(cells, (cell) => cell.owner)
  const zoneOfControl = commonValue(cells, (cell) => cell.zoneOfControl)
  const regionId = commonValue(cells, (cell) => cell.regionId)
  const editedCount = ids.filter((id) => Boolean(grid.cells[id])).length

  return (
    <aside className="side-panel right-panel">
      <header className="panel-heading inspector-title hex-inspector-title">
        <div><span className="eyebrow">Пакетное редактирование</span><h2>Выбрано гексов: {cells.length}</h2></div>
        <span className="terrain-orb multi">⬢</span>
      </header>
      <div className="inspector-body">
        <section className="batch-selection-summary">
          <span><i>Выделено</i><b>{cells.length}</b></span>
          <span><i>Изменено</i><b>{editedCount}</b></span>
          <span><i>Диапазон</i><b>{cells[0].id}…</b></span>
        </section>

        <section className="inspector-section">
          <h3>Назначить тип местности</h3>
          <div className="terrain-palette">
            {TERRAINS.map((item) => (
              <button
                type="button"
                key={item.id}
                className={terrain === item.id ? 'active' : ''}
                style={{ '--terrain': item.color } as CSSProperties}
                onClick={() => setHexesTerrain(ids, item.id)}
                title={`${item.label}: базовая стоимость ${item.passable ? item.moveCost : 'непроходимо'}`}
              >
                <span>{item.icon}</span><b>{item.label}</b><small>{item.passable ? `${item.moveCost} ОД` : 'Закрыто'}</small>
              </button>
            ))}
          </div>
          <div className="terrain-auto-note"><b>Тип задаёт базовые правила автоматически.</b><span>Например, «Вода» установит цену 99 и запретит проход. При необходимости значения ниже можно переопределить.</span></div>
        </section>

        <section className="inspector-section">
          <h3>Движение и инфраструктура</h3>
          <label className="field">
            <span>Стоимость входа, очков движения</span>
            <input
              type="number"
              min="1"
              max="99"
              value={moveCost ?? ''}
              placeholder="Разные значения"
              onChange={(event) => { if (event.target.value) updateHexes(ids, { moveCost: Math.max(1, Math.min(99, Number(event.target.value))) }) }}
            />
          </label>
          <BatchChoice label="Проходимость" value={passable} onChange={(value) => updateHexes(ids, { passable: value })} />
          <BatchChoice label="Дорога" value={road} onChange={(value) => updateHexes(ids, { road: value })} />
          <BatchChoice label="Река" value={river} onChange={(value) => updateHexes(ids, { river: value, ...(!value ? { ford: false, bridge: false } : {}) })} />
        </section>

        <section className="inspector-section">
          <h3>Контроль территории</h3>
          <label className="field">
            <span>Владелец</span>
            <select value={owner === undefined ? '__mixed__' : owner ?? ''} onChange={(event) => { if (event.target.value !== '__mixed__') updateHexes(ids, { owner: (event.target.value || null) as FactionId | null }) }}>
              {owner === undefined && <option value="__mixed__">Разные владельцы</option>}
              <option value="">Нет владельца</option>
              {orderedFactions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Зона контроля</span>
            <select value={zoneOfControl === undefined ? '__mixed__' : zoneOfControl ?? ''} onChange={(event) => { if (event.target.value !== '__mixed__') updateHexes(ids, { zoneOfControl: (event.target.value || null) as FactionId | null }) }}>
              {zoneOfControl === undefined && <option value="__mixed__">Разные значения</option>}
              <option value="">Нет зоны контроля</option>
              {orderedFactions.filter((item) => item.id !== 'civilian').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Назначить регион</span>
            <select value={regionId === undefined ? '__mixed__' : regionId ?? ''} onChange={(event) => { if (event.target.value !== '__mixed__') updateHexes(ids, { regionId: event.target.value || null }) }}>
              {regionId === undefined && <option value="__mixed__">Разные регионы</option>}
              <option value="">Без региона</option>
              {orderedRegions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
            </select>
          </label>
          <p className="field-help">Массовое назначение добавляет выбранные гексы в регион. Владение гексами пересчитается автоматически внутри границ региона.</p>
        </section>

        <section className="inspector-actions single-action">
          <button type="button" onClick={() => resetHexes(ids)} disabled={!editedCount}>Сбросить выбранные гексы</button>
        </section>
      </div>
    </aside>
  )
}

function HexInspector({ cell, fogged = false }: { cell: LogicalHex; fogged?: boolean }) {
  const grid = useMapStore((state) => state.grid)
  const locations = useMapStore((state) => state.locations)
  const factions = useMapStore((state) => state.factions)
  const regions = useMapStore((state) => state.regions)
  const orderedFactions = sortByText(factions, (item) => item.label)
  const orderedRegions = sortByText(regions, (item) => item.name)
  const mode = useMapStore((state) => state.mode)
  const updateHex = useMapStore((state) => state.updateHex)
  const setHexTerrain = useMapStore((state) => state.setHexTerrain)
  const resetHex = useMapStore((state) => state.resetHex)
  const readonly = mode === 'game'
  const terrain = TERRAIN_BY_ID[cell.terrain]
  const owner = cell.owner ? getFaction(factions, cell.owner) : null
  const region = cell.regionId ? regions.find((item) => item.id === cell.regionId) : null
  const boundLocations = cell.locationIds
    .map((id) => locations.find((location) => location.id === id))
    .filter(Boolean)
  const nearestLocation = locations.find((location) => location.id === cell.nearestLocationId)
  const riverPenalty = cell.river ? (cell.bridge ? 1 : cell.ford ? 2 : 3) : 0
  const effectiveCost = cell.passable
    ? Math.max(1, cell.moveCost - (cell.road ? 1 : 0)) + riverPenalty
    : Number.POSITIVE_INFINITY
  const patch = (value: Partial<HexCellOverride>) => updateHex(cell.id, value)

  return (
    <aside className="side-panel right-panel">
      <header className="panel-heading inspector-title hex-inspector-title">
        <div>
          <span className="eyebrow">Логическая клетка</span>
          <h2>{readonly ? 'Участок карты' : `Гекс ${cell.q}, ${cell.r}`}</h2>
        </div>
        <span className="terrain-orb" style={{ background: terrain.color }}>{terrain.icon}</span>
      </header>

      <div className="inspector-body">
        <section className="hex-summary-card">
          <div><span>Рельеф</span><b>{terrain.label}</b></div>
          <div><span>Цена хода</span><b>{cell.passable ? cell.moveCost : '—'}</b></div>
          <div><span>Владелец</span><b style={{ color: fogged ? '#7b8587' : owner?.color }}>{fogged ? 'Неизвестно' : owner?.label ?? 'Нет'}</b></div>
        </section>

        {region?.description && <section className="region-lore-card hex-region-lore"><span>Регион: {region.name}</span><p>{region.description}</p></section>}

        <section className="inspector-section">
          <h3>Местность и движение</h3>
          <label className="field">
            <span>Тип местности</span>
            <select value={cell.terrain} disabled={readonly} onChange={(event) => setHexTerrain(cell.id, event.target.value as LogicalHex['terrain'])}>
              {TERRAINS.map((item) => <option key={item.id} value={item.id}>{item.icon} {item.label}</option>)}
            </select>
          </label>
          <div className="terrain-auto-note compact">
            <b>{terrain.label}: базовая цена {terrain.passable ? `${terrain.moveCost} ОД` : 'непроходимо'}.</b>
            <span>При смене типа цена и проходимость устанавливаются автоматически. Затем их можно изменить вручную.</span>
          </div>
          <label className="field">
            <span>Базовая стоимость входа, очков движения</span>
            <input
              type="number"
              min="1"
              max="99"
              value={cell.moveCost}
              disabled={readonly}
              onChange={(event) => patch({ moveCost: Math.max(1, Math.min(99, Number(event.target.value) || 1)) })}
            />
          </label>
          <div className="movement-cost-breakdown">
            <span><i>База</i><b>{cell.moveCost}</b></span>
            <em>{cell.road ? '− 1 дорога' : '+ 0 без дороги'}</em>
            <em>{cell.river ? `+ ${riverPenalty} ${cell.bridge ? 'мост' : cell.ford ? 'брод' : 'река'}` : '+ 0 без реки'}</em>
            <strong>= {Number.isFinite(effectiveCost) ? `${effectiveCost} ОД` : 'проход закрыт'}</strong>
          </div>
          <p className="cost-instruction">Цена списывается при входе армии в клетку. При запасе 6 ОД шесть равнин по 1 можно пройти за один ход; лес с ценой 2 расходует две единицы.</p>
          <SwitchField label="Проходимый" description="Армии могут войти в этот гекс" checked={cell.passable} disabled={readonly} onChange={(passable) => patch({ passable })} />
        </section>

        <section className="inspector-section">
          <h3>Инфраструктура</h3>
          <SwitchField label="Дорога" description="Снижает стоимость движения на 1" checked={cell.road} disabled={readonly} onChange={(road) => patch({ road })} />
          <SwitchField label="Река" description="Обычная +3 ОД, брод +2, мост +1" checked={cell.river} disabled={readonly} onChange={(river) => patch({ river, ...(!river ? { ford: false, bridge: false } : {}) })} />
          {cell.river && (
            <div className="nested-switches">
              <SwitchField label="Брод" checked={cell.ford} disabled={readonly || cell.bridge} onChange={(ford) => patch({ ford })} />
              <SwitchField label="Мост" checked={cell.bridge} disabled={readonly || cell.ford} onChange={(bridge) => patch({ bridge })} />
            </div>
          )}
        </section>

        {!fogged && <section className="inspector-section">
          <h3>Контроль</h3>
          <label className="field">
            <span>Владелец</span>
            <select value={cell.owner ?? ''} disabled={readonly} onChange={(event) => patch({ owner: (event.target.value || null) as FactionId | null })}>
              <option value="">Нет владельца</option>
              {orderedFactions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Вражеская зона контроля</span>
            <select value={cell.zoneOfControl ?? ''} disabled={readonly} onChange={(event) => patch({ zoneOfControl: (event.target.value || null) as FactionId | null })}>
              <option value="">Нет зоны контроля</option>
              {orderedFactions.filter((item) => item.id !== 'civilian').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Регион</span>
            <select value={cell.regionId ?? ''} disabled={readonly} onChange={(event) => patch({ regionId: event.target.value || null })}>
              <option value="">Без региона</option>
              {orderedRegions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
            </select>
          </label>
          <p className="field-help">Регион — верхний уровень карты. Гекс принадлежит региону; владение (домен) внутри региона определяется автоматически. Захват идёт через объекты карты, а не через сам регион.</p>
        </section>}

        <section className="inspector-section">
          <h3>Объект карты</h3>
          {boundLocations.length > 0 ? (
            <div className="bound-locations">
              <span>В этом гексе</span>
              {boundLocations.map((location) => <b key={location!.id}>⌖ {location!.name}</b>)}
            </div>
          ) : (
            <div className="nearest-location">
              <span>Ближайший объект</span>
              <b>⌖ {nearestLocation?.name ?? 'Не определён'}</b>
              {!readonly && <small>Используется как контекст боя рядом с объектом карты.</small>}
            </div>
          )}
          {cell.domainId && <p className="field-help">Владение: {locations.find((item) => item.id === cell.domainId)?.name ?? cell.domainId}</p>}
        </section>

        {!readonly && (
          <section className="inspector-actions single-action">
            <button type="button" onClick={() => resetHex(cell.id)} disabled={!grid.cells[cell.id]}>Сбросить гекс к значениям по умолчанию</button>
          </section>
        )}
      </div>
    </aside>
  )
}

function FoggedLocationInspector({ location, intel }: { location: MapLocation; intel: LastSeenLocationIntel | null }) {
  const { language } = useI18n()
  const factions = useMapStore((state) => state.factions)
  const owner = getFaction(factions, intel?.lastKnownOwner ?? location.side)
  return <aside className="side-panel right-panel fogged-inspector">
    <header className="panel-heading inspector-title"><div><span className="eyebrow">Сведения разведки</span><h2>{location.name}</h2></div><span className="faction-orb" style={{ background: owner.color }} /></header>
    <div className="inspector-body"><section className="fogged-intel-card"><span>◌</span><div><small>Сейчас вне зоны обзора</small><b>Информация устарела</b><p>Последнее наблюдение: раунд {intel?.lastSeenRound ?? 1}</p></div></section><section className="hex-summary-card"><div><span>Тип</span><b>{economicTypeLabel(location.economicType, language)}</b></div><div><span>Владелец</span><b style={{ color: owner.color }}>{owner.label}</b></div><div><span>Гарнизон</span><b>{garrisonIntelLabel(intel?.garrisonCategory ?? 'none')}</b></div></section><section className="inspector-section"><h3>Последние известные данные</h3><p className="field-help">Текущий владелец, гарнизон и события в этой локации неизвестны. Получите обзор армией или союзной локацией, чтобы обновить сведения.</p></section></div>
  </aside>
}

function LostArmyContactInspector({ army }: { army: Army }) {
  const factions = useMapStore((state) => state.factions)
  const campaign = useMapStore((state) => state.campaign)
  const faction = getFaction(factions, army.factionId)
  const intel = campaign.fogOfWar.lastSeenArmies.find((item) => item.armyId === army.id)
  return <aside className="side-panel right-panel fogged-inspector"><header className="panel-heading inspector-title army-inspector-title"><div><span className="eyebrow">Контакт потерян</span><h2>{faction.label}</h2></div><span className="army-inspector-flag" style={{ '--flag-color': faction.color } as CSSProperties}>?</span></header><div className="inspector-body"><section className="fogged-intel-card"><span>?</span><div><small>Последняя известная информация</small><b>{intel ? armyIntelLabel(intel.sizeCategory) : 'Вражеская армия'}</b><p>Последний раз замечена: раунд {intel?.lastSeenRound ?? 'неизвестно'}</p></div></section><p className="field-help">Армия больше не находится в зоне обзора. Её текущая позиция и состав неизвестны.</p></div></aside>
}

function ForeignArmyInspector({ army }: { army: Army }) {
  const factions = useMapStore((state) => state.factions)
  const heroes = useMapStore((state) => state.heroes)
  const captains = useMapStore((state) => state.captains)
  const unitTypes = useMapStore((state) => state.unitTypes)
  const campaign = useMapStore((state) => state.campaign)
  const faction = getFaction(factions, army.factionId)
  const commander = commanderDefinition(army, heroes, captains)
  const rawPower = (commander?.battlePower ?? 0) + army.unitSlots.reduce((total, slot) => total + (unitTypes.find((unit) => unit.id === slot.entityId)?.battlePower ?? 0), 0) + army.heroSlots.reduce((total, slot) => total + (heroes.find((hero) => hero.id === slot.entityId)?.battlePower ?? 0), 0)
  const enemy = faction.alignment !== campaign.playerSide
  const relation = enemy ? 'Вражеская армия' : 'Союзная армия'
  const sizeIntel = army.unitSlots.length <= 4 ? 'small' : army.unitSlots.length <= 8 ? 'medium' : army.unitSlots.length <= 12 ? 'large' : 'huge'
  const size = armyIntelLabel(sizeIntel)
  const strength = rawPower < 700 ? 'невысокая' : rawPower < 1400 ? 'значительная' : 'очень высокая'
  const hasHero = army.commander?.kind === 'hero' || army.heroSlots.length > 0
  return <aside className="side-panel right-panel foreign-army-panel">
    <header className="panel-heading inspector-title army-inspector-title"><div><span className="eyebrow">{relation}</span><h2>{enemy ? `${size}: ${faction.label}` : army.name}</h2></div><span className="army-inspector-flag" style={{ '--flag-color': faction.color } as CSSProperties}>⚔</span></header>
    <div className="inspector-body">
      <section className="foreign-army-summary"><span style={{ '--foreign-color': faction.color } as CSSProperties}>⚑</span><div><small>Принадлежность</small><b>{faction.label}</b><p>{relation}. Приказы этой армии отдаёт ИИ.</p></div></section>
      <section className="hex-summary-card army-summary-card"><div><span>Размер</span><b>{size}</b></div><div><span>{enemy ? 'Герой' : 'Сила'}</span><b>{enemy ? hasHero ? 'Замечен' : 'Не замечен' : strength}</b></div><div><span>Состояние</span><b>{army.engaged ? 'В бою' : army.movedRound === campaign.round ? 'Двигалась' : 'Стоит'}</b></div></section>
      <section className="inspector-section"><h3>Разведданные</h3><p className="field-help">{enemy ? 'Точный состав, сила, имя героя и командир скрыты туманом войны.' : 'Союзной армией управляет ИИ; доступна только общая сводка.'}</p></section>
    </div>
  </aside>
}

function ArmyInspector({ army }: { army: Army }) {
  const [unitToAdd, setUnitToAdd] = useState('')
  const [heroToAdd, setHeroToAdd] = useState('')
  const [showJson, setShowJson] = useState(false)
  const mode = useMapStore((state) => state.mode)
  const factions = useMapStore((state) => state.factions)
  const grid = useMapStore((state) => state.grid)
  const orderedFactions = sortByText(factions, (item) => item.label)
  const unitTypes = useMapStore((state) => state.unitTypes)
  const heroes = useMapStore((state) => state.heroes)
  const captains = useMapStore((state) => state.captains)
  const armies = useMapStore((state) => state.armies)
  const locations = useMapStore((state) => state.locations)
  const campaign = useMapStore((state) => state.campaign)
  const updateArmy = useMapStore((state) => state.updateArmy)
  const removeArmy = useMapStore((state) => state.removeArmy)
  const transferArmyToReserve = useMapStore((state) => state.transferArmyToReserve)
  const disbandArmy = useMapStore((state) => state.disbandArmy)
  const retreatEngagedArmy = useMapStore((state) => state.retreatEngagedArmy)
  const faction = getFaction(factions, army.factionId)
  const readonly = mode === 'game'
  const active = campaign.playerFactionId === army.factionId && isFactionActive(campaign, factions, army.factionId)
  const commander = commanderDefinition(army, heroes, captains)
  const commanderHero = army.commander?.kind === 'hero' ? heroes.find((hero) => hero.id === army.commander?.entityId) : null
  const commanderCaptain = army.commander?.kind === 'captain' ? captains.find((captain) => captain.id === army.commander?.entityId) : null
  const commanderPortrait = commanderHero?.portrait ?? commanderCaptain?.portrait ?? ''
  const commanderName = army.commander?.kind === 'captain' ? army.commander.displayName ?? commander?.name : commander?.name
  const unitCap = armyUnitSlotCap(army)
  const movementBreakdown = armyMovementBreakdown(army, heroes, captains, unitTypes)
  const movementCap = movementBreakdown.total
  const availableUnits = sortByText(unitTypes.filter((unit) => unit.factionId === army.factionId), (item) => item.name)
  const heroUsedElsewhere = new Set(armies.flatMap((item) => item.id === army.id ? [] : [
    ...(item.commander?.kind === 'hero' ? [item.commander.entityId] : []),
    ...item.heroSlots.map((slot) => slot.entityId),
  ]))
  const availableHeroes = sortByText(heroes.filter((hero) => hero.factionId === army.factionId && hero.alive && !heroUsedElsewhere.has(hero.id)), (item) => item.name)
  const availableCaptains = sortByText(captains.filter((captain) => captain.factionId === army.factionId), (item) => item.name)
  const power = (commander?.battlePower ?? 0)
    + army.heroSlots.reduce((total, slot) => total + (heroes.find((hero) => hero.id === slot.entityId)?.battlePower ?? 0), 0)
    + army.unitSlots.reduce((total, slot) => total + (unitTypes.find((unit) => unit.id === slot.entityId)?.battlePower ?? 0), 0)
  const limit = factionArmyLimit(faction, locations)
  const factionArmies = armies.filter((item) => item.factionId === faction.id).length
  const stationedLocation = locations.find((location) => location.side === army.factionId && locationHexId(location, grid.config) === army.hexId)
  const canManageReserve = mode === 'game' && canFactionPlan(campaign, factions, army.factionId) && Boolean(stationedLocation)
  const payload = JSON.stringify(buildBfmeArmyPayload(army, unitTypes, heroes, captains), null, 2)

  const changeCommander = (value: string) => {
    if (!value) { updateArmy(army.id, { commander: null }); return }
    const [kind, id] = value.split(':')
    if (kind === 'hero') {
      const hero = heroes.find((item) => item.id === id)
      if (hero) updateArmy(army.id, { commander: createHeroCommander(hero), heroSlots: army.heroSlots.filter((slot) => slot.entityId !== id) })
    } else {
      const captain = captains.find((item) => item.id === id)
      if (captain) {
        const usedNames = [
          ...armies.filter((item) => item.id !== army.id && item.factionId === army.factionId && item.commander?.kind === 'captain').map((item) => item.commander!.displayName ?? ''),
          ...(campaign.freeCaptains[army.factionId] ?? []).map((instance) => instance.displayName),
        ]
        updateArmy(army.id, { commander: createCaptainCommander(captain, generateUniqueCaptainName(army.factionId, captain.namePool, usedNames)) })
      }
    }
  }

  return (
    <aside className="side-panel right-panel">
      <header className="panel-heading inspector-title army-inspector-title">
        <div><span className="eyebrow">Полевая армия · командир обязателен</span><h2>{army.name}</h2></div>
        <span className="army-inspector-flag" style={{ '--flag-color': faction.color } as CSSProperties}>⚔</span>
      </header>
      <div className={`army-turn-notice ${active ? 'active' : ''}`}><span>{active ? '◆' : '◇'}</span>{active ? `Сейчас ходит ${faction.label}` : `Ожидает хода фракции «${faction.label}»`}</div>
      <div className="inspector-body">
        <section className="hex-summary-card army-summary-card">
          <div><span>Войска</span><b>{army.unitSlots.length}/{unitCap}</b></div>
          <div><span>ОД</span><b>{army.movementRemaining}/{movementCap}</b></div>
          <div><span>Сила</span><b>{Math.round(power)}</b></div>
        </section>
        {army.status === 'retreating' && <section className="demoralized-warning"><b>Деморализована</b><span>0 ОД в этом раунде · −20% силы при нападении. Статус снимется в начале следующего хода фракции.</span></section>}

        <section className={`army-leader-card ${commander ? '' : 'missing'}`}>
          <span className="leader-portrait" style={{ '--portrait-color': faction.color, ...(commanderPortrait ? { backgroundImage: `url(${commanderPortrait})` } : {}) } as CSSProperties}></span>
          <div><small>{army.commander?.kind === 'captain' ? 'Временный командир · капитан' : 'Командир армии · герой'}</small><b>{commanderName ?? 'Командир не назначен'}</b><p>{commander ? `${army.commander?.kind === 'hero' ? 'Уникальный герой' : 'Административный командир'} · сила ${commander.battlePower} · командование ${commander.command}% · +${commander.movementBonus} ОД` : 'Без командира армия не может двигаться, атаковать или осаждать.'}</p></div>
        </section>

        <section className="inspector-section">
          <h3>Командование</h3>
          <label className="field"><span>Назначить командира</span><select value={army.commander ? `${army.commander.kind}:${army.commander.entityId}` : ''} disabled={readonly} onChange={(event) => changeCommander(event.target.value)}><option value="">Без командира</option><optgroup label="Капитаны (неуникальные)">{availableCaptains.map((captain) => <option key={captain.id} value={`captain:${captain.id}`}>{captain.name}</option>)}</optgroup><optgroup label="Уникальные герои">{availableHeroes.map((hero) => <option key={hero.id} value={`hero:${hero.id}`}>{hero.name}</option>)}</optgroup></select></label>
          <p className="field-help">Капитан — временный командир. Если в такую армию входит герой, он автоматически принимает командование, а капитан возвращается в свободный пул.</p>
        </section>

        <section className="inspector-section">
          <h3>Основное</h3>
          <label className="field"><span>Фракция</span><select value={army.factionId} disabled={readonly} onChange={(event) => updateArmy(army.id, { factionId: event.target.value })}>{orderedFactions.filter((item) => item.playable).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label className="field"><span>Лимит отрядов</span><input type="number" min="1" max="20" value={army.baseUnitSlotLimit} disabled={readonly} onChange={(event) => updateArmy(army.id, { baseUnitSlotLimit: Number(event.target.value) })} /></label>
          <div className="movement-formula-card"><span><i>Самый медленный</i><b>{movementBreakdown.slowestMovement} ОД</b><small>{movementBreakdown.slowestUnitName}</small></span><em>− {movementBreakdown.logisticsPenalty}<small>логистика</small></em><em>+ {movementBreakdown.commanderBonus}<small>командир</small></em><strong>= {movementBreakdown.total} ОД</strong></div>
          <p className="field-help">За каждые 5 отрядов армия получает −1 ОД. Армий фракции: {factionArmies}/{limit}. Лимит отрядов этой армии: {unitCap}.</p>
        </section>

        <section className="inspector-section army-slots-section">
          <h3>{army.commander?.kind === 'captain' ? 'Герой автоматически заменит капитана' : `Герои поддержки · ${army.heroSlots.length}/${army.heroSlotLimit}`}</h3>
          <div className="army-slot-list">{army.heroSlots.map((slot, index) => { const hero = heroes.find((item) => item.id === slot.entityId); return <div className="army-slot-row hero" key={slot.slotId}><span className="slot-index">{index + 1}</span><span className="slot-portrait hero" style={hero?.portrait ? { backgroundImage: `url(${hero.portrait})` } : undefined}></span><div className="slot-identity"><b>{hero?.name ?? 'Неизвестный герой'}</b>{!readonly && <code>{slot.objectId}</code>}<small>Герой поддержки</small></div><span className="slot-power">Сила <b>{hero?.battlePower ?? 0}</b></span>{!readonly && <button type="button" onClick={() => updateArmy(army.id, { heroSlots: army.heroSlots.filter((_, i) => i !== index) })}>×</button>}{canManageReserve && stationedLocation && <button type="button" className="transfer-slot-button" title="Переместить в резерв объекта" onClick={() => transferArmyToReserve(stationedLocation.id, army.id, slot.slotId)}>←</button>}</div>})}</div>
          {!readonly && army.heroSlots.length < army.heroSlotLimit && <div className="add-army-slot"><select value={heroToAdd} onChange={(event) => setHeroToAdd(event.target.value)}><option value="">{army.commander?.kind === 'captain' ? 'Назначить героя командиром…' : 'Добавить героя поддержки…'}</option>{availableHeroes.filter((hero) => hero.id !== army.commander?.entityId).map((hero) => <option key={hero.id} value={hero.id}>{hero.name}</option>)}</select><button type="button" disabled={!heroToAdd} onClick={() => { const hero = heroes.find((item) => item.id === heroToAdd); if (hero) updateArmy(army.id, { heroSlots: [...army.heroSlots, createHeroSlot(army.id, hero, army.heroSlots.length + 1)] }); setHeroToAdd('') }}>Добавить</button></div>}
        </section>

        <section className="inspector-section army-slots-section">
          <h3>Отряды · {army.unitSlots.length}/{unitCap}</h3>
          <div className="army-slot-list">{army.unitSlots.map((slot, index) => { const unit = unitTypes.find((item) => item.id === slot.entityId); return <div className="army-slot-row unit" key={slot.slotId}><span className="slot-index">{index + 1}</span><span className="slot-portrait unit" style={unit?.portrait ? { backgroundImage: `url(${unit.portrait})` } : undefined}></span><div className="slot-identity"><b>{unit?.name ?? 'Неизвестный отряд'}</b>{!readonly && <code>{slot.objectId}</code>}<small>Боевой отряд</small></div><span className="slot-power">Сила <b>{unit?.battlePower ?? 0}</b></span>{!readonly && <button type="button" onClick={() => updateArmy(army.id, { unitSlots: army.unitSlots.filter((_, i) => i !== index) })}>×</button>}{canManageReserve && stationedLocation && <button type="button" className="transfer-slot-button" title="Переместить в резерв объекта" onClick={() => transferArmyToReserve(stationedLocation.id, army.id, slot.slotId)}>←</button>}</div>})}</div>
          {!readonly && army.unitSlots.length < unitCap && <div className="add-army-slot"><select value={unitToAdd} onChange={(event) => setUnitToAdd(event.target.value)}><option value="">Добавить отряд…</option>{availableUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name} — {unit.objectId}</option>)}</select><button type="button" disabled={!unitToAdd} onClick={() => { const unit = unitTypes.find((item) => item.id === unitToAdd); if (unit) updateArmy(army.id, { unitSlots: [...army.unitSlots, createUnitSlot(army.id, unit, army.unitSlots.length + 1)] }); setUnitToAdd('') }}>Добавить</button></div>}
        </section>

        {mode === 'edit' && <section className="bfme-payload-card"><button type="button" onClick={() => setShowJson((value) => !value)}><span>◈</span><div><b>BFME Battle Payload</b><small>Командир, герои и отряды</small></div><i>{showJson ? '▴' : '▾'}</i></button>{showJson && <pre>{payload}</pre>}</section>}

        {mode === 'game' ? canFactionPlan(campaign, factions, army.factionId) ? <section className="army-game-help planning"><b>Управление в фазе планирования</b><p>{stationedLocation ? `Армия находится во владении/оплоте «${stationedLocation.name}». Стрелка ← переносит отряд в резерв.` : 'Для пополнения и расформирования армия должна находиться на гексе своего объекта карты.'}</p>{stationedLocation && <button type="button" className="disband-army-button" onClick={() => { if (window.confirm(`Расформировать «${army.name}»? Войска перейдут в резерв, лишние будут распущены.`)) disbandArmy(stationedLocation.id, army.id) }}>Расформировать армию</button>}</section> : isMovementPhase(campaign.phase) ? <section className={`army-game-help ${army.engaged ? 'engagement' : ''}`}><b>{army.engaged ? 'Армия связана боем' : army.commander ? 'Приказ движения' : 'Армия без командира'}</b><p>{army.engaged ? 'Обычное движение заблокировано. Армия может отойти сразу в ближайшую свою локацию. Потери зависят от расстояния, а на следующий ход армия будет деморализована.' : army.commander ? 'Выберите доступный гекс или вражескую армию. При входе во вражеский гекс все оставшиеся ОД будут потрачены.' : 'Армия без командира остаётся неподвижной.'}</p>{army.engaged && active && <button type="button" className="engagement-retreat-button" onClick={() => retreatEngagedArmy(army.id)}>Отступить из боя</button>}</section> : <section className="army-game-help"><b>Армия ожидает приказов</b><p>В фазах конфликтов и последствий движение и управление составом недоступны.</p></section> : <section className="inspector-actions single-action"><button type="button" className="danger-button" onClick={() => { if (window.confirm(`Удалить армию «${army.name}»?`)) removeArmy(army.id) }}>Удалить армию</button></section>}
      </div>
    </aside>
  )
}

export default function Inspector({ activeModId, activeMod, onModChange }: { activeModId:string; activeMod: ModDefinition | null; onModChange: (definition: ModDefinition) => void }) {
  const {language}=useI18n()
  const [reserveTargetArmyId, setReserveTargetArmyId] = useState('')
  const [formationCommander, setFormationCommander] = useState('')
  const [recruitmentPreviewFaction, setRecruitmentPreviewFaction] = useState('')
  const [rtsAssetBusy, setRtsAssetBusy] = useState(false)
  const [rtsAssetError, setRtsAssetError] = useState<string|null>(null)
  const locations = useMapStore((state) => state.locations)
  const grid = useMapStore((state) => state.grid)
  const factions = useMapStore((state) => state.factions)
  const regions = useMapStore((state) => state.regions)
  const unitTypes = useMapStore((state) => state.unitTypes)
  const heroes = useMapStore((state) => state.heroes)
  const captains = useMapStore((state) => state.captains)
  const campaign = useMapStore((state) => state.campaign)
  const orderedFactions = sortByText(factions, (item) => item.label)
  const orderedRegions = sortByText(regions, (item) => item.name)
  const armies = useMapStore((state) => state.armies)
  const selectedId = useMapStore((state) => state.selectedId)
  const selectedArmyId = useMapStore((state) => state.selectedArmyId)
  const selectedHexId = useMapStore((state) => state.selectedHexId)
  const selectedHexIds = useMapStore((state) => state.selectedHexIds)
  const mode = useMapStore((state) => state.mode)
  const hexEdit = useMapStore((state) => state.hexEdit)
  const updateLocation = useMapStore((state) => state.updateLocation)
  const updateRegion = useMapStore((state) => state.updateRegion)
  const summonHero = useMapStore((state) => state.summonHero)
  const queueRecruitment = useMapStore((state) => state.queueRecruitment)
  const transformReserveUnit = useMapStore((state) => state.transformReserveUnit)
  const cancelRecruitment = useMapStore((state) => state.cancelRecruitment)
  const transferReserveToArmy = useMapStore((state) => state.transferReserveToArmy)
  const formArmy = useMapStore((state) => state.formArmy)
  const duplicateLocation = useMapStore((state) => state.duplicateLocation)
  const removeLocation = useMapStore((state) => state.removeLocation)
  const selectHex = useMapStore((state) => state.selectHex)
  const setViewMode = useMapStore((state) => state.setViewMode)
  const setMovementBudget = useMapStore((state) => state.setMovementBudget)

  const supportedLocales = activeMod?.supportedLocales?.length ? activeMod.supportedLocales : ['en']
  const addSupportedLocale = (locale: string) => {
    if (!activeMod) return
    const normalized = locale.trim().toLowerCase()
    if (!normalized || activeMod.supportedLocales?.includes(normalized)) return
    onModChange({ ...activeMod, supportedLocales: [...new Set(['en', ...(activeMod.supportedLocales ?? []), normalized])], defaultLocale: activeMod.defaultLocale ?? 'en' })
  }

  const logicalGrid = useMemo(() => resolveGrid(grid, locations, regions), [grid, locations, regions])
  const visibleHexes = useMemo(() => mode === 'game' ? calculateVisibleHexes(campaign, armies, locations, factions, grid, regions) : new Set(logicalGrid.cells.map((cell) => cell.id)), [armies, campaign, factions, grid, locations, logicalGrid, mode, regions])
  const selectedArmy = armies.find((army) => army.id === selectedArmyId)
  if (selectedArmy) {
    const enemy = getFaction(factions, selectedArmy.factionId).alignment !== campaign.playerSide
    if (mode === 'game' && campaign.fogOfWar.enabled && enemy && !visibleHexes.has(selectedArmy.hexId)) return <LostArmyContactInspector army={selectedArmy} />
    return mode === 'game' && selectedArmy.factionId !== campaign.playerFactionId ? <ForeignArmyInspector army={selectedArmy} /> : <ArmyInspector army={selectedArmy} />
  }
  const selectedCells = selectedHexIds.map((id) => logicalGrid.byId.get(id)).filter(Boolean) as LogicalHex[]
  if (selectedCells.length > 1) return <MultiHexInspector cells={selectedCells} />
  const selectedCell = selectedCells[0] ?? (selectedHexId ? logicalGrid.byId.get(selectedHexId) ?? null : null)
  if (selectedCell) return <HexInspector cell={selectedCell} fogged={mode === 'game' && campaign.fogOfWar.enabled && !visibleHexes.has(selectedCell.id)} />

  const location = locations.find((item) => item.id === selectedId)
  if (location && mode === 'game' && campaign.fogOfWar.enabled && !visibleHexes.has(locationHexId(location, grid.config))) {
    const intel = campaign.fogOfWar.lastSeenLocations.find((item) => item.locationId === location.id) ?? null
    return <FoggedLocationInspector location={location} intel={intel} />
  }
  if (!location) {
    return (
      <aside className="side-panel right-panel">
        <header className="panel-heading">
          <div><span className="eyebrow">Инспектор</span><h2>{hexEdit ? 'Редактор гексов' : 'Свойства'}</h2></div>
        </header>
        {hexEdit ? (
          <div className="hex-editor-empty">
            <div className="empty-sigil hex-sigil">⬡</div>
            <b>Выберите гекс</b>
            <p>Нажмите на клетку, чтобы настроить рельеф, цену движения, дорогу, реку, владельца и поле битвы.</p>
            <div className="grid-facts">
              <span><i>Размер</i><b>{grid.config.size} px</b></span>
              <span><i>Логических гексов</i><b>{logicalGrid.cells.length}</b></span>
              <label>
                <i>Запас хода по умолчанию</i>
                <input type="number" min="1" max="30" value={grid.config.movementBudget} onChange={(event) => setMovementBudget(Number(event.target.value))} />
              </label>
            </div>
          </div>
        ) : (
          <div className="inspector-empty">
            <div className="empty-sigil">⌖</div>
            <b>Выберите объект</b>
            <p>Нажмите на владение или оплот, либо включите тактический режим, чтобы исследовать логические гексы.</p>
          </div>
        )}
      </aside>
    )
  }

  const faction = getFaction(factions, location.side)
  const locationRegion = regions.find((region) => region.id === location.regionId) ?? null
  const regionOwner = locationRegion?.ownerFactionId ? getFaction(factions, locationRegion.ownerFactionId) : null
  const domainHexCount = location.structuralType === 'domain' ? (location.hexes?.length ?? 0) : 1
  const readonly = mode === 'game'
  const locationCellId = locationHexId(location, grid.config)
  const locationCell = logicalGrid.byId.get(locationCellId)
  const locationState = campaign.locationStates[location.id] ?? { locationId: location.id, recruitmentQueue: [], reserve: [], occupationTurnsLeft: 0 }
  const treasury = campaign.treasuries[location.side]
  const visibleGarrisonCategory = garrisonIntelCategory(locationState.reserve.filter((slot) => slot.kind === 'unit').length)
  const recruitableUnits = sortByText(recruitableUnitsAtLocation(location, locationState, unitTypes), (unit) => unit.name)
  const previewFactionId = factions.some((candidate) => candidate.id === recruitmentPreviewFaction && candidate.playable) ? recruitmentPreviewFaction : location.side
  const previewLocation = { ...location, side: previewFactionId }
  const previewRecruitables = sortByText(recruitableUnitsAtLocation(previewLocation, { ...locationState, occupationTurnsLeft: 0 }, unitTypes), (unit) => unit.name)
  const previewFactionUnits = sortByText(unitTypes.filter((unit) => unit.factionId === previewFactionId), (unit) => unit.name)
  const stationedArmies = sortByText(armies.filter((army) => army.factionId === location.side && army.hexId === locationCellId), (army) => army.name)
  const targetArmyId = stationedArmies.some((army) => army.id === reserveTargetArmyId) ? reserveTargetArmyId : stationedArmies[0]?.id ?? ''
  const reserveHeroes = locationState.reserve.filter((slot) => slot.kind === 'hero').map((slot) => ({ slot, hero: heroes.find((hero) => hero.id === slot.entityId && hero.alive && campaign.heroStates[hero.id]?.status === 'active') })).filter((item) => item.hero)
  const summonableHeroes = sortByText(heroes.filter((hero) => hero.factionId === location.side && campaign.heroStates[hero.id]?.status === 'available' && !campaign.heroStates[hero.id]?.summoned && campaign.heroStates[hero.id]?.summonLocationId === location.id), (hero) => hero.name)
  const factionHeroStates = heroes.filter((hero) => hero.factionId === location.side).map((hero) => campaign.heroStates[hero.id]).filter(Boolean)
  const availableCaptainTypes = sortByText(captains.filter((captain) => captain.factionId === location.side), (captain) => captain.name)
  const freeCaptains = campaign.freeCaptains[location.side] ?? []
  const canFormByArmyLimit = armies.filter((army) => army.factionId === location.side).length < factionArmyLimit(faction, locations)
  const captainLimit = factionCaptainLimit(location.side, locations)
  const captainCount = factionCaptainCount(location.side, armies, campaign.freeCaptains)

  const importedMapAsset = (result:ImportedRtsAsset):RtsMapAsset => ({assetId:result.id,originalFileName:result.originalFileName,storageName:result.storageName,size:result.size,cacheKey:result.cacheKey??'',mapPath:result.mapPath??'',mapName:result.mapName??'',numPlayers:result.numPlayers??0,playerStarts:result.playerStarts??[]})
  const importMapCache=async(file:File)=>{setRtsAssetBusy(true);setRtsAssetError(null);try{const imported=await uploadRtsAsset(activeModId,'location-cache',location.id,file,file.name);const asset=importedMapAsset(imported);updateLocation(location.id,{rtsMapCache:asset,rtsMapId:asset.mapPath})}catch(error){setRtsAssetError(error instanceof Error?error.message:String(error))}finally{setRtsAssetBusy(false)}}

  return (
    <aside className="side-panel right-panel">
      <header className="panel-heading inspector-title">
        <div><span className="eyebrow">{location.structuralType==='stronghold'?'Оплот':'Владение'}</span><h2>{location.name}</h2></div>
        <span className="faction-orb" style={{ background: faction.color }} title={faction.label} />
      </header>

      <div className="inspector-body">
        <section className="location-image-card">
          <div style={location.image ? { backgroundImage: `url(${location.image})` } : undefined}><span>{location.structuralType==='stronghold'?'Оплот':'Владение'}</span></div>
          {!readonly && <footer><label>Изменить изображение<input type="file" accept="image/png,image/jpeg,image/webp" onChange={async (event) => { const file = event.target.files?.[0]; if (file) updateLocation(location.id, { image: await imageFileToDataUrl(file, 640, 360) }); event.target.value = '' }} /></label>{location.image && <button type="button" onClick={() => updateLocation(location.id, { image: '' })}>Сбросить</button>}</footer>}
        </section>
        <section className="inspector-section">
          <h3>Основное</h3>
          <LocalizedNameFields label="Название" canonical={location.name} translations={location.nameTranslations} language={language} supportedLocales={supportedLocales} disabled={readonly} onAddLocale={addSupportedLocale} onChange={(name, nameTranslations) => updateLocation(location.id, { name, nameTranslations })} />
        </section>

        <section className="inspector-section">
          <h3>Принадлежность</h3>
          <label className="field">
            <span>Фракция</span>
            <select value={location.side} disabled={readonly} onChange={(event) => updateLocation(location.id, { side: event.target.value as FactionId })}>
              {orderedFactions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Тип объекта</span>
            <select value={location.structuralType} disabled={readonly} onChange={(event)=>updateLocation(location.id,{structuralType:event.target.value as StructuralType})}>
              <option value="domain">Владение</option><option value="stronghold">Оплот</option>
            </select>
          </label>
          {location.side === 'civilian' && <p className="field-help">Нейтральные — территории, которые не принадлежат ни одной фракции.</p>}
        </section>

        {!readonly ? <section className="inspector-section">
          <h3>Экономика и найм</h3>
          <label className="field"><span>Экономический тип</span><select value={location.economicType} onChange={(event) => { const economicType = event.target.value as SettlementType; updateLocation(location.id, economicDefaultsPatch(economicType)) }}>{(location.structuralType==='domain'?domainEconomicTypeIds():strongholdEconomicTypeIds()).map((id)=><option key={id} value={id}>{economicTypeLabel(id, language)}</option>)}</select></label>
          <div className="coordinate-grid"><label className="field"><span>Золото / ход</span><input type="number" min="0" value={location.income.gold} onChange={(event) => updateLocation(location.id, { income: { ...location.income, gold: Number(event.target.value) } })} /></label><label className="field"><span>Материалы / ход</span><input type="number" min="0" value={location.income.materials} onChange={(event) => updateLocation(location.id, { income: { ...location.income, materials: Number(event.target.value) } })} /></label></div>
          <div className="coordinate-grid"><label className="field"><span>Слоты очереди</span><input type="number" min="0" max="10" value={location.recruitmentSlots} onChange={(event) => updateLocation(location.id, { recruitmentSlots: Number(event.target.value) })} /></label><label className="field"><span>Лимит резерва</span><input type="number" min="0" max="100" value={location.reserveLimit} onChange={(event) => updateLocation(location.id, { reserveLimit: Number(event.target.value) })} /></label></div>
          {rtsAssetError&&<div className="rts-asset-error">{rtsAssetError}</div>}
          <section className={`rts-map-asset-card ${location.rtsMapCache?'ready':''}`}><header><div><span>BFME-карта объекта</span><b>{location.rtsMapCache?.mapName??'Кэш не загружен'}</b></div><i>{location.rtsMapCache?'Готово':'Нет файла'}</i></header>{location.rtsMapCache&&<><p>{location.rtsMapCache.originalFileName} · {location.rtsMapCache.size} байт · игроков: {location.rtsMapCache.numPlayers||'?'}</p><code>{location.rtsMapCache.mapPath}</code></>}<footer><label className={rtsAssetBusy?'disabled':''}>{location.rtsMapCache?'Заменить MapCache BIG':'Загрузить MapCache BIG'}<input type="file" accept=".big" disabled={rtsAssetBusy} onChange={(event)=>{const file=event.target.files?.[0];if(file)void importMapCache(file);event.target.value=''}}/></label></footer></section>
          {(location.structuralType==='stronghold'||getEconomicType(location.economicType).battleType==='siege'||getEconomicType(location.economicType).isCapital)&&<section className="rts-fortress-settings"><h4>Стартовая точка защитника крепости</h4><p>Доли окна комнаты BFME от 0 до 1. Без обеих координат осадный RTS-бой заблокирован.</p>{Number.isFinite(location.rtsFortress?.defenderStartPosition?.x)&&Number.isFinite(location.rtsFortress?.defenderStartPosition?.y)?<div className="rts-fortress-ready">Готово: X {Number(location.rtsFortress!.defenderStartPosition!.x).toFixed(4)} · Y {Number(location.rtsFortress!.defenderStartPosition!.y).toFixed(4)}</div>:<div className="rts-fortress-missing">Координаты не заполнены</div>}<div className="coordinate-grid"><label className="field"><span>Позиция X</span><input type="number" min="0" max="1" step="0.0001" value={location.rtsFortress?.defenderStartPosition?.x??''} onChange={(event)=>{const x=Number(event.target.value);const y=location.rtsFortress?.defenderStartPosition?.y??null;updateLocation(location.id,{rtsFortress:{defenderStartPosition:{x:event.target.value===''?null:Math.max(0,Math.min(1,x)),y}}})}}/></label><label className="field"><span>Позиция Y</span><input type="number" min="0" max="1" step="0.0001" value={location.rtsFortress?.defenderStartPosition?.y??''} onChange={(event)=>{const y=Number(event.target.value);const x=location.rtsFortress?.defenderStartPosition?.x??null;updateLocation(location.id,{rtsFortress:{defenderStartPosition:{x,y:event.target.value===''?null:Math.max(0,Math.min(1,y))}}})}}/></label></div></section>}
          <label className="field"><span>Теги специализации</span><input value={location.locationTags.join(', ')} placeholder="коневодческий край, промышленный центр, побережье…" onChange={(event) => updateLocation(location.id, { locationTags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean) })} /></label>
          <div className="recruitment-preview"><header><div><span>Расчётный найм для владельца</span><select value={previewFactionId} onChange={(event) => setRecruitmentPreviewFaction(event.target.value)}>{orderedFactions.filter((item) => item.playable).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div><b>{previewRecruitables.length} отрядов</b></header><div>{previewRecruitables.map((unit) => <span key={unit.id}>{unit.name}</span>)}{!previewRecruitables.length && <p>Нет отрядов, подходящих по типу объекта и тегам.</p>}</div></div>
          <details className="recruitment-overrides"><summary>Уникальные разрешения и запреты</summary><p>Базовый список рассчитывается автоматически. Override всегда действует только для юнитов текущего владельца.</p><div>{previewFactionUnits.map((unit) => <article key={unit.id}><b>{unit.name}</b><label><input type="checkbox" checked={location.extraRecruitables.includes(unit.id)} onChange={(event) => updateLocation(location.id, { extraRecruitables: event.target.checked ? [...location.extraRecruitables, unit.id] : location.extraRecruitables.filter((id) => id !== unit.id) })} />Разрешить дополнительно</label><label><input type="checkbox" checked={location.blockedRecruitables.includes(unit.id)} onChange={(event) => updateLocation(location.id, { blockedRecruitables: event.target.checked ? [...location.blockedRecruitables, unit.id] : location.blockedRecruitables.filter((id) => id !== unit.id) })} />Запретить</label></article>)}</div></details>
        </section> : <section className="location-economy-panel">
          <header><div><small>{economicTypeLabel(location.economicType, language)}</small><b>Экономика объекта</b></div><span>+{location.income.gold} зол. · +{location.income.materials} мат.</span></header>
          {canFactionPlan(campaign, factions, location.side) ? <>
            <div className="location-treasury"><span>Казна: <b>{treasury?.gold ?? 0}</b></span><span>Материалы: <b>{treasury?.materials ?? 0}</b></span></div>
            {locationState.occupationTurnsLeft > 0 && <div className="occupation-warning"><b>Объект оккупирован</b><span>Полноценный найм и призыв героев будут доступны через {locationState.occupationTurnsLeft} ход{locationState.occupationTurnsLeft === 1 ? '' : 'а'} фракции. Сейчас доступны только отряды с разрешением на найм во время оккупации.</span></div>}
            {summonableHeroes.length > 0 && locationState.occupationTurnsLeft === 0 && <section className="hero-summon-panel"><header><b>Призвать героя</b><small>Герой появится в резерве объекта</small></header><div className="summonable-hero-list">{summonableHeroes.map((hero) => { const affordable = (treasury?.gold ?? 0) >= hero.summonCostGold; return <article key={hero.id}><span className="hero-summon-portrait" style={hero.portrait ? { backgroundImage: `url(${hero.portrait})` } : undefined}></span><div><b>{hero.name}</b><small>{hero.title || 'Герой фракции'} · сила {hero.battlePower}<br />Призыв: {hero.summonCostGold} золота</small></div><button type="button" disabled={!affordable} title={affordable ? `Призвать героя за ${hero.summonCostGold} золота` : 'Недостаточно золота'} onClick={() => summonHero(location.id, hero.id)}>Призвать</button></article> })}</div></section>}
            <div className="hero-unlock-summary"><span><small>Героев активно</small><b>{factionHeroStates.filter((state) => state.status === 'active').length}</b></span><span><small>Можно призвать</small><b>{factionHeroStates.filter((state) => state.status === 'available').length}</b></span><span><small>Закрыто</small><b>{factionHeroStates.filter((state) => state.status === 'locked').length}</b></span></div>
            <h4>Очередь найма · {locationState.recruitmentQueue.length}/{location.recruitmentSlots}</h4>
            <div className="recruitment-queue-list">{locationState.recruitmentQueue.map((item) => { const unit = unitTypes.find((candidate) => candidate.id === item.entityId); return <div key={item.id}><span className="mini-unit-portrait" style={unit?.portrait ? { backgroundImage: `url(${unit.portrait})` } : undefined}></span><span className="recruitment-item-copy"><b>{unit?.name ?? 'Неизвестный отряд'}</b><small>{item.turnsLeft === 0 ? 'Ожидает место в резерве' : `Готов через: ${item.turnsLeft} ход.`}</small></span><button type="button" aria-label="Отменить найм" title="Отменить найм и вернуть ресурсы" onClick={() => cancelRecruitment(location.id, item.id)}>×</button></div>})}{!locationState.recruitmentQueue.length && <p>Очередь пуста</p>}</div>
            <h4>Нанять</h4>
            <div className="recruitable-unit-list">{recruitableUnits.map((unit) => { const affordable = (treasury?.gold ?? 0) >= unit.recruitCost.gold && (treasury?.materials ?? 0) >= unit.recruitCost.materials && locationState.recruitmentQueue.length < location.recruitmentSlots; return <div key={unit.id}><span className="mini-unit-portrait" style={unit.portrait ? { backgroundImage: `url(${unit.portrait})` } : undefined}></span><span><b>{unit.name}</b><small>{unit.recruitCost.gold} зол. · {unit.recruitCost.materials} мат. · {unit.recruitTime} ход.</small></span><button type="button" aria-label={`Нанять: ${unit.name}`} title={`Добавить «${unit.name}» в очередь`} disabled={!affordable} onClick={() => queueRecruitment(location.id, unit.id)}>＋</button></div>})}{!recruitableUnits.length && <p>В этом объекте нет доступных отрядов</p>}</div>
            <h4>Резерв · {locationState.reserve.length}/{location.reserveLimit}</h4>
            {stationedArmies.length > 0 && <label className="reserve-target-select"><span>Пополнить армию</span><select value={targetArmyId} onChange={(event) => setReserveTargetArmyId(event.target.value)}>{stationedArmies.map((army) => <option key={army.id} value={army.id}>{army.name}</option>)}</select></label>}
            <div className="reserve-unit-list">{locationState.reserve.map((slot) => { const unit = slot.kind === 'unit' ? unitTypes.find((candidate) => candidate.id === slot.entityId) : null; const hero = slot.kind === 'hero' ? heroes.find((candidate) => candidate.id === slot.entityId) : null; const entity = unit ?? hero; const transformations = unit ? sortByText(unitTypes.filter((candidate) => candidate.transformationSourceUnitId === unit.id), (candidate) => candidate.name) : []; return <div key={slot.slotId} className={transformations.length ? 'has-transformations' : ''}><span className={`mini-unit-portrait ${slot.kind}`} style={entity?.portrait ? { backgroundImage: `url(${entity.portrait})` } : undefined}></span><span><b>{entity?.name ?? (slot.kind === 'hero' ? 'Неизвестный герой' : 'Неизвестный отряд')}</b><small>{slot.kind === 'hero' ? 'Герой' : `Содержание: ${unit?.upkeep ?? 0}`}</small></span>{targetArmyId && <button type="button" title="Передать в выбранную армию" onClick={() => transferReserveToArmy(location.id, targetArmyId, slot.slotId)}>→</button>}{transformations.length > 0 && <div className="reserve-transform-actions"><small>Преобразовать в боевой отряд</small>{transformations.map((target) => { const affordable = (treasury?.gold ?? 0) >= target.recruitCost.gold && (treasury?.materials ?? 0) >= target.recruitCost.materials; return <button type="button" key={target.id} disabled={!affordable} onClick={() => transformReserveUnit(location.id, slot.slotId, target.id)}><span>{target.name}</span><b>{target.recruitCost.gold ? `${target.recruitCost.gold} зол.` : 'Бесплатно'}</b></button> })}</div>}</div>})}{!locationState.reserve.length && <p>Резерв пуст</p>}</div>
            <h4>Сформировать новую армию</h4>
            <div className="formation-controls"><select value={formationCommander} onChange={(event) => setFormationCommander(event.target.value)}><option value="">Выберите командира…</option>{reserveHeroes.map(({slot,hero}) => <option key={slot.slotId} value={`hero:${slot.slotId}`}>Герой: {hero!.name}</option>)}{freeCaptains.map((captain) => <option key={captain.instanceId} value={`free-captain:${captain.instanceId}`} disabled={reserveHeroes.length > 0}>Свободный капитан: {captain.displayName}</option>)}{availableCaptainTypes.map((captain) => <option key={captain.id} value={`new-captain:${captain.id}`} disabled={reserveHeroes.length > 0 || locationState.occupationTurnsLeft > 0 || captainCount >= captainLimit || !getEconomicType(location.economicType).allowsCaptainHire}>Нанять нового: {captain.name} — 100 зол.</option>)}</select><button type="button" disabled={!formationCommander || !locationState.reserve.some((slot) => slot.kind === 'unit') || !canFormByArmyLimit || ((formationCommander.startsWith('new-captain:') || formationCommander.startsWith('captain:') || formationCommander.startsWith('free-captain:')) && reserveHeroes.length > 0) || ((formationCommander.startsWith('new-captain:') || formationCommander.startsWith('captain:')) && ((treasury?.gold ?? 0) < 100 || locationState.occupationTurnsLeft > 0 || captainCount >= captainLimit || !getEconomicType(location.economicType).allowsCaptainHire))} onClick={() => { formArmy(location.id, formationCommander); setFormationCommander('') }}>Сформировать</button></div>
            <p className={`captain-limit-note ${captainCount >= captainLimit ? 'reached' : ''}`}>{reserveHeroes.length > 0 ? 'В резерве есть герой: новую армию должен возглавить он.' : `Капитаны: ${captainCount}/${captainLimit} · свободно в пуле: ${freeCaptains.length}${captainCount >= captainLimit ? ' · лимит достигнут, доступно только повторное назначение свободного капитана' : ''}`}</p>
            {!canFormByArmyLimit && <p className="field-help">Достигнут лимит полевых армий фракции.</p>}
          </> : <><div className="visible-garrison-intel"><span>Разведка гарнизона</span><b>{garrisonIntelLabel(visibleGarrisonCategory)}</b><small>{visibleGarrisonCategory === 'none' ? 'Организованного резерва не замечено' : 'Точный состав гарнизона неизвестен'}</small></div><p className="field-help">{!isFactionActive(campaign, factions, location.side) ? 'Сейчас действует другая сторона.' : 'Найм и управление резервом доступны только в фазе планирования.'}</p></>}
        </section>}

        <section className="inspector-section">
          <h3>Стратегическая геометрия</h3>
          <label className="field">
            <span>Бонус к глобальному лимиту армий</span>
            <input type="number" min="0" max="10" value={location.armyLimitBonus ?? 0} disabled={readonly} onChange={(event) => updateLocation(location.id, { armyLimitBonus: Number(event.target.value) })} />
          </label>
          <div className="location-hex-card">
            <span className="hex-card-symbol">⬡</span>
            <div><small>Якорный гекс</small><b>{locationCellId}</b><i>{locationCell ? TERRAIN_BY_ID[locationCell.terrain].label : 'За пределами сетки'}</i></div>
            {!readonly && <button type="button" onClick={() => { selectHex(locationCellId); setViewMode('strategic') }}>Открыть</button>}
          </div>
          <div className="region-capture-card" style={{'--region-owner': (regionOwner?.color ?? locationRegion?.color ?? faction.color)} as CSSProperties}>
            <span>{location.structuralType === 'domain' ? '▧' : '⬢'}</span>
            <div>
              <small>Регион</small>
              <b>{locationRegion?.name ?? 'Вне региона'} · {regionOwner?.label ?? 'частичный / нет контроля'}</b>
              <p>
                {location.structuralType === 'domain'
                  ? `Владение занимает ${domainHexCount} гекс${domainHexCount === 1 ? '' : domainHexCount < 5 ? 'а' : 'ов'} внутри региона. Захват передаёт эти гексы и доход.`
                  : 'Оплот занимает один гекс региона и не входит ни в одно владение. Захват передаёт только этот гекс.'}
              </p>
            </div>
          </div>
          {locationRegion?.description && <div className="region-lore-card"><span>Описание региона</span><p>{locationRegion.description}</p></div>}
        </section>

        {!readonly&&<section className="inspector-section"><h3>Привязка к гексу</h3><div className="location-hex-card"><span className="hex-card-symbol">⬡</span><div><small>Положение объекта</small><b>{location.hex}</b><i>Координаты вычисляются из центра гекса</i></div><button type="button" onClick={()=>{selectHex(location.hex);setViewMode('strategic')}}>Открыть</button></div><p className="field-help">Перетащите объект на свободный гекс. Размещение двух объектов на одном гексе запрещено.</p></section>}

        {mode !== 'game' && (
          <section className="inspector-actions">
            <button type="button" onClick={() => duplicateLocation(location.id)}>Дублировать</button>
            <button type="button" className="danger-button" onClick={() => { if (window.confirm(`Удалить «${location.name}»?`)) removeLocation(location.id) }}>Удалить</button>
          </section>
        )}
      </div>
    </aside>
  )
}
