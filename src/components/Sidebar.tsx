import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { getFaction, KIND_LABELS } from '../constants'
import { armyMovementCap, armyUnitSlotCap, commanderDefinition } from '../game/army'
import { activeSide, factionSide, phaseIcon, phaseLabel } from '../game/campaign'
import { armyIntelLabel, calculateVisibleHexes } from '../game/fogOfWar'
import { useMapStore } from '../store/useMapStore'
import { translateText } from '../i18n'
import { sortByText } from '../utils/sort'
import type { FactionId, StructuralType } from '../types'

interface SidebarProps { onFocus: (id: string) => void }
type KindFilter = 'all' | StructuralType

function CampaignSidebar({onFocus}:SidebarProps) {
  const [tab, setTab] = useState<'armies' | 'chronicle'>('armies')
  const factions = useMapStore((state) => state.factions)
  const armies = useMapStore((state) => state.armies)
  const heroes = useMapStore((state) => state.heroes)
  const captains = useMapStore((state) => state.captains)
  const unitTypes = useMapStore((state) => state.unitTypes)
  const locations = useMapStore((state) => state.locations)
  const grid = useMapStore((state) => state.grid)
  const regions = useMapStore((state) => state.regions)
  const campaign = useMapStore((state) => state.campaign)
  const selectedArmyId = useMapStore((state) => state.selectedArmyId)
  const selectArmy = useMapStore((state) => state.selectArmy)
  const cancelArmyOrder=useMapStore((state)=>state.cancelArmyOrder)
  const selectConflict = useMapStore((state) => state.selectConflict)
  const advancePhase = useMapStore((state) => state.advancePhase)
  const setFogOverlayVisible = useMapStore((state) => state.setFogOverlayVisible)
  const playerFaction = getFaction(factions, campaign.playerFactionId)
  const side = activeSide(campaign) ?? campaign.playerSide
  const sideName = side === 'good' ? 'Свет' : 'Тьма'
  const treasury = campaign.playerFactionId ? campaign.treasuries[campaign.playerFactionId] : null
  const balance = (treasury?.lastIncome.gold ?? 0) - (treasury?.lastUpkeep ?? 0)
  const ownArmies = sortByText(armies.filter((army) => army.factionId === campaign.playerFactionId), (army) => army.name)
  const woundedHeroes=sortByText(heroes.filter((hero)=>hero.factionId===campaign.playerFactionId&&campaign.heroStates[hero.id]?.status==='wounded'),(hero)=>hero.name)
  const alliedFactions = sortByText(factions.filter((faction) => faction.playable && faction.alignment === campaign.playerSide && faction.id !== campaign.playerFactionId && campaign.factionStates[faction.id]?.status !== 'inactive'), (faction) => faction.label)
  const enemyFactions = sortByText(factions.filter((faction) => faction.playable && faction.alignment !== campaign.playerSide && faction.alignment !== 'neutral' && campaign.factionStates[faction.id]?.status !== 'inactive'), (faction) => faction.label)
  const visibleHexes = useMemo(() => calculateVisibleHexes(campaign, armies, locations, factions, grid, regions), [armies, campaign, factions, grid, locations, regions])
  const visibleEnemyArmies = armies.filter((army) => enemyFactions.some((faction) => faction.id === army.factionId) && (!campaign.fogOfWar.enabled || visibleHexes.has(army.hexId)))
  const playerConflict = (conflict: typeof campaign.conflicts[number]) => {
    const ids = [...conflict.attackerArmyIds, ...conflict.defenderArmyIds, ...conflict.attackerReinforcementArmyIds, ...conflict.defenderReinforcementArmyIds]
    return ids.some((id) => armies.find((army) => army.id === id)?.factionId === campaign.playerFactionId) || Boolean(conflict.locationId && locations.find((location) => location.id === conflict.locationId)?.side === campaign.playerFactionId)
  }
  const visibleConflicts = campaign.conflicts.filter(playerConflict)
  const pendingConflicts = visibleConflicts.filter((conflict) => conflict.status === 'pending').length
  const actionLabel = campaign.phase.startsWith('planning_') ? '⚔ Завершить ход →'
    : campaign.phase === 'movement_first' || campaign.phase === 'movement_second' ? '⚔ Завершить ход →'
      : campaign.phase === 'conflicts' ? `Разрешите оставшиеся бои: ${pendingConflicts}`
        : 'Продолжить →'
  const phaseTitle = campaign.phase.startsWith('planning_') ? `Ход ${campaign.round} · ${playerFaction.label}` : campaign.phase==='aftermath'?`Итоги хода ${campaign.round}`:`${phaseIcon(campaign.phase)} ${phaseLabel(campaign)}`
  const roundLogEntries = campaign.log.filter((entry) => entry.round === campaign.round && ['battle', 'capture', 'retreat', 'hero', 'army_destroyed'].includes(entry.kind)).slice(0, 6)

  const armyPower = (army: typeof armies[number]) => {
    const commander = commanderDefinition(army, heroes, captains)
    return (commander?.battlePower ?? 0)
      + army.heroSlots.reduce((total, slot) => total + (heroes.find((hero) => hero.id === slot.entityId)?.battlePower ?? 0), 0)
      + army.unitSlots.reduce((total, slot) => total + (unitTypes.find((unit) => unit.id === slot.entityId)?.battlePower ?? 0), 0)
  }
  const strengthLabel = (power: number) => power < 700 ? 'невысокая' : power < 1400 ? 'значительная' : 'очень высокая'
  const ownArmyRow = (army: typeof armies[number]) => {
    const commander = commanderDefinition(army, heroes, captains)
    const movementCap = armyMovementCap(army, heroes, captains, unitTypes)
    const slotCount = army.heroSlots.length + army.unitSlots.length + (army.commander?.kind === 'hero' ? 1 : 0)
    const slotLimit = army.heroSlotLimit + armyUnitSlotCap(army) + 1
    const commanderName = army.commander?.kind === 'captain' ? army.commander.displayName ?? commander?.name : commander?.name
    const order=campaign.pendingOrders.find((item)=>item.armyId===army.id)
    return <button type="button" key={army.id} className={`campaign-army-row ${selectedArmyId === army.id ? 'active' : ''} ${army.engaged ? 'engaged' : ''}`} onClick={() => {selectArmy(army.id);onFocus(army.id)}} onContextMenu={(event)=>{if(order){event.preventDefault();cancelArmyOrder(army.id)}}}><span className="campaign-army-flag" style={{ '--army-color': playerFaction.color } as CSSProperties}>{army.engaged ? '⚡' : '⚔'}</span><span><b>{army.name}</b><small>{slotCount}/{slotLimit} боевых слотов · сила {Math.round(armyPower(army))}</small><i>{order?`Приказ движения · ${order.cost} ОД (ПКМ для отмены)`:army.engaged?'Связана боем':army.status==='retreating'?'Деморализована · сила −20%':commanderName??'Нет командира'}</i></span><strong>{army.movementRemaining}/{movementCap}</strong></button>
  }
  const foreignArmyRow = (army: typeof armies[number]) => {
    const faction = getFaction(factions, army.factionId)
    const size = army.unitSlots.length <= 4 ? 'small' : army.unitSlots.length <= 8 ? 'medium' : army.unitSlots.length <= 12 ? 'large' : 'huge'
    const hasHero = army.commander?.kind === 'hero' || army.heroSlots.length > 0
    return <button type="button" key={army.id} className={`campaign-army-row foreign ${selectedArmyId === army.id ? 'active' : ''}`} onClick={() => {selectArmy(army.id);onFocus(army.id)}}><span className="campaign-army-flag" style={{ '--army-color': faction.color } as CSSProperties}>⚑</span><span><b>{armyIntelLabel(size)}: {faction.label}</b><small>{hasHero ? 'Замечен герой' : 'Герои не замечены'}{army.movedRound === campaign.round ? ' · перемещалась' : ''}</small><i>Точный состав и сила неизвестны</i></span><strong>?</strong></button>
  }

  return <aside className="side-panel left-panel campaign-panel">
    <header className="panel-heading"><div><span className="eyebrow">Раунд {campaign.round}</span><h2>{phaseTitle}</h2></div><span className="turn-orb" style={{ background: playerFaction.color }} /></header>
    <div className="active-turn-card" style={{ '--faction-color': playerFaction.color } as CSSProperties}><span>Фракция игрока</span><b>{playerFaction.label}</b><small>{campaign.phase.startsWith('planning_') ? 'Нанимайте войска, управляйте резервом и перемещайте армии в любом порядке. После завершения хода ИИ выполнит свои действия.' : campaign.phase.startsWith('movement_') ? `Завершение приказов движения. Сейчас действует сторона «${sideName}».` : campaign.phase === 'conflicts' ? `Ваших нерешённых сражений: ${pendingConflicts}` : 'Все сражения, захваты, ранения и экономические изменения этого хода применены.'}</small><button type="button" onClick={advancePhase} disabled={campaign.phase === 'conflicts'}>{actionLabel}</button><label className="fog-sidebar-toggle"><input type="checkbox" checked={campaign.fogOfWar.overlayVisible} disabled={!campaign.fogOfWar.enabled} onChange={(event) => setFogOverlayVisible(event.target.checked)} /><span>{campaign.fogOfWar.enabled ? 'Показывать затемнение' : 'Туман войны отключён'}</span><b>{campaign.fogOfWar.enabled ? campaign.fogOfWar.overlayVisible ? 'Видно' : 'Скрыто' : 'Нет'}</b></label></div>
    <div className="campaign-economy"><div><span>Золото</span><b>{treasury?.gold ?? 0}</b></div><div><span>Материалы</span><b>{treasury?.materials ?? 0}</b></div><div><span>Доход</span><b>+{treasury?.lastIncome.gold ?? 0}</b></div><div><span>Содержание</span><b>−{treasury?.lastUpkeep ?? 0}</b></div><strong className={balance >= 0 ? 'positive' : 'negative'}>{balance >= 0 ? '+' : ''}{balance}</strong></div>
    {woundedHeroes.length>0&&<section className="wounded-heroes-panel"><header><span>✚</span><div><b>Раненые герои</b><small>Недоступны до полного восстановления</small></div><strong>{woundedHeroes.length}</strong></header>{woundedHeroes.map((hero)=>{const state=campaign.heroStates[hero.id];const recovery=locations.find((location)=>location.id===state?.recoveryLocationId);return <article key={hero.id} onClick={()=>recovery&&onFocus(recovery.id)}><span className="wounded-hero-portrait" style={hero.portrait?{backgroundImage:`url(${hero.portrait})`}:undefined}/><div><b>{hero.name}</b><small>Ранен · осталось ходов: {state?.healTurnsLeft??0}</small>{recovery&&<i>Восстановление: {recovery.name}</i>}</div></article>})}</section>}
    {campaign.phase==='aftermath'&&<section className="turn-summary-panel"><header><b>{translateText('Итоги хода')} {campaign.round}</b><small>{translateText('Передвижения всех фракций')}</small></header>
      {(() => {
        const hexWord=(count:number)=>count===1?'гекс':count<5?'гекса':'гексов'
        const roundEntries=campaign.turnMovements.filter((entry)=>entry.round===campaign.round)
        const groups=[
          {title:translateText('Ваши армии'),entries:roundEntries.filter((entry)=>entry.factionId===campaign.playerFactionId)},
          {title:translateText('Союзники'),entries:roundEntries.filter((entry)=>entry.factionId!==campaign.playerFactionId&&factionSide(factions,entry.factionId)===campaign.playerSide)},
          {title:translateText('Враги'),entries:roundEntries.filter((entry)=>factionSide(factions,entry.factionId)!==campaign.playerSide&&factionSide(factions,entry.factionId)!==null)},
        ]
        const actionGlyph:Record<typeof campaign.turnMovements[number]['action'],string>={moved:'➜',stayed:'⌂',retreated:'↩',besieged:'⚔'}
        return groups.filter((group)=>group.entries.length>0).map((group)=>(
          <div key={group.title}>
            <h4 className="summary-group">{group.title}</h4>
            {group.entries.map((entry)=>{
              const faction=getFaction(factions,entry.factionId)
              const subject=translateText(entry.commanderName??entry.armyName)
              const target=entry.targetLabel?`«${translateText(entry.targetLabel)}»`:null
              const distance=entry.distance>0?` (${entry.distance} ${hexWord(entry.distance)})`:''
              const text=entry.action==='moved'?`переход к ${target??'новой позиции'}${distance}`
                :entry.action==='retreated'?`отход к ${target??'своим землям'}${distance}`
                :entry.action==='besieged'?`осада ${target??'позиций противника'}`
                :`остается ${target?`в ${target}`:'на месте'}`
              return <p key={entry.id}><span style={{color:faction.color}}>{actionGlyph[entry.action]}</span><span><b className="summary-faction" style={{color:faction.color}}>{translateText(faction.label)}</b>{`: ${subject} — ${text}`}</span></p>
            })}
          </div>
        ))
      })()}
      {roundLogEntries.length>0&&<><h4 className="summary-group">{translateText('Прочие события')}</h4>{roundLogEntries.map((entry)=><p key={entry.id}><span>{entry.kind==='battle'?'⚔':entry.kind==='capture'?'◆':entry.kind==='retreat'?'↩':entry.kind==='hero'?'★':entry.kind==='army_destroyed'?'×':'·'}</span><span>{entry.text}</span></p>)}</>}
    </section>}
    <div className="campaign-tabs"><button type="button" className={tab === 'armies' ? 'active' : ''} onClick={() => setTab('armies')}>Армии</button><button type="button" className={tab === 'chronicle' ? 'active' : ''} onClick={() => setTab('chronicle')}>Хроника</button></div>
    {tab === 'armies' ? <div className="campaign-army-list">
      {campaign.phase === 'conflicts' && <div className="conflict-sidebar-list"><div className="campaign-list-title"><span>Ваши сражения</span><b>{visibleConflicts.length}</b></div>{visibleConflicts.map((conflict) => { const location = conflict.locationId ? locations.find((candidate) => candidate.id === conflict.locationId) : null; return <button type="button" key={conflict.id} className={`${conflict.status} ${campaign.currentConflictId === conflict.id ? 'active' : ''}`} onClick={() => selectConflict(conflict.id)}><span>{conflict.status === 'resolved' ? '✓' : '⚔'}</span><b>{location?.name ?? 'Полевое сражение'}</b><small>{conflict.battleType === 'siege' ? 'Осада' : conflict.battleType === 'settlement' ? 'Бой за поселение' : 'Полевой бой'}</small></button> })}</div>}
      <div className="campaign-list-title"><span>Ваши армии</span><b>{ownArmies.length}</b></div>{ownArmies.length ? ownArmies.map(ownArmyRow) : <div className="empty-list"><b>Нет армий</b><small>Формируйте армии из резервов своих локаций</small></div>}
      <div className="campaign-list-title secondary"><span>Союзники</span><b>{alliedFactions.length}</b></div><div className="allied-faction-summary">{alliedFactions.map((faction) => { const factionArmies = armies.filter((army) => army.factionId === faction.id); const total = factionArmies.reduce((sum, army) => sum + armyPower(army), 0); const eliminated = campaign.factionStates[faction.id]?.status === 'eliminated'; return <article key={faction.id} className={eliminated ? 'eliminated' : ''} style={{ '--ally-color': faction.color } as CSSProperties}><span /><div><b>{faction.label}</b><small>{eliminated ? 'Фракция уничтожена' : `${factionArmies.length} арм. · сила ${strengthLabel(total)}`}</small></div><i>ИИ</i></article> })}</div>
      <div className="campaign-list-title secondary"><span>Вражеские армии</span><b>{visibleEnemyArmies.length}</b></div>{sortByText(visibleEnemyArmies, (army) => getFaction(factions, army.factionId).label).map(foreignArmyRow)}
      {campaign.fogOfWar.enabled && <><div className="campaign-list-title secondary"><span>Последние сведения</span><b>{campaign.fogOfWar.lastSeenArmies.filter((intel) => !visibleHexes.has(intel.hexId)).length}</b></div><div className="fog-intel-list">{campaign.fogOfWar.lastSeenArmies.filter((intel) => !visibleHexes.has(intel.hexId)).slice(0,8).map((intel) => <article key={intel.armyId}><span>?</span><div><b>{armyIntelLabel(intel.sizeCategory)}: {getFaction(factions,intel.factionId).label}</b><small>Замечена в раунде {intel.lastSeenRound}</small></div></article>)}</div></>}
    </div> : <div className="campaign-log full"><h3>Хроника кампании</h3>{campaign.log.slice(0, 50).map((entry) => <div key={entry.id} className={`log-${entry.kind}`}><span>{entry.kind === 'battle' ? '⚔' : entry.kind === 'capture' ? '◆' : entry.kind === 'retreat' ? '↩' : entry.kind === 'hero' ? '★' : entry.kind === 'army_destroyed' ? '×' : '·'}</span><p>{entry.text}<small>Раунд {entry.round}</small></p></div>)}</div>}
  </aside>
}

function LocationEditorSidebar({ onFocus }: SidebarProps) {
  const [query, setQuery] = useState('')
  const [faction, setFaction] = useState<'all' | FactionId>('all')
  const [kind, setKind] = useState<KindFilter>('all')
  const locations = useMapStore((state) => state.locations)
  const factions = useMapStore((state) => state.factions)
  const selectedId = useMapStore((state) => state.selectedId)
  const addKind = useMapStore((state) => state.addKind)
  const select = useMapStore((state) => state.select)
  const setAddKind = useMapStore((state) => state.setAddKind)
  const orderedFactions = sortByText(factions, (item) => item.label)

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('ru')
    return locations.filter((location) => faction === 'all' || location.side === faction)
      .filter((location) => kind === 'all' || location.structuralType === kind)
      .filter((location) => !normalizedQuery || [location.name,...Object.values(location.nameTranslations??{})].some((name)=>name.toLocaleLowerCase().includes(normalizedQuery)) || location.id.includes(normalizedQuery))
      .sort((left, right) => left.name.localeCompare(right.name, 'ru'))
  }, [locations, faction, kind, query])

  const strongholdCount = locations.filter((location)=>location.structuralType==='stronghold').length
  return (
    <aside className="side-panel left-panel">
      <header className="panel-heading"><div><span className="eyebrow">Картография</span><h2>Локации</h2></div><span className="count-badge">{locations.length}</span></header>
      <div className="stats-row"><div><strong>{strongholdCount}</strong><span>Оплотов</span></div><div><strong>{locations.length-strongholdCount}</strong><span>Владений</span></div></div>
      <div className="location-create-tools"><button type="button" className={addKind === 'domain' ? 'active' : ''} onClick={() => setAddKind(addKind === 'domain' ? null : 'domain')}><span>●</span>Новое владение</button><button type="button" className={addKind === 'stronghold' ? 'active' : ''} onClick={() => setAddKind(addKind === 'stronghold' ? null : 'stronghold')}><span>♜</span>Новый оплот</button></div>
      {addKind&&<p className="location-create-help">{addKind==='domain'?'Выберите свободный гекс. Регион создастся автоматически.':'Выберите свободный гекс. Оплот займёт только эту клетку.'}</p>}
      <div className="sidebar-tools">
        <label className="search-box"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти локацию…" />{query && <button type="button" onClick={() => setQuery('')}>×</button>}</label>
        <select className="filter-select" value={faction} onChange={(event) => setFaction(event.target.value)}><option value="all">Все фракции</option>{orderedFactions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
        <div className="kind-tabs">{([['all', 'Все'], ['domain', 'Владения'], ['stronghold', 'Оплоты']] as const).map(([value, label]) => <button type="button" key={value} className={kind === value ? 'active' : ''} onClick={() => setKind(value)}>{label}</button>)}</div>
      </div>
      <div className="location-list" role="list">
        {filtered.map((location) => { const factionInfo = getFaction(factions, location.side); return <button type="button" key={location.id} className={`location-row ${selectedId === location.id ? 'active' : ''}`} onClick={() => select(location.id)} onDoubleClick={() => onFocus(location.id)}><span className={`row-symbol ${location.structuralType}`} style={{ '--row-color': factionInfo.color } as CSSProperties}>{location.structuralType === 'stronghold' ? '♜' : ''}</span><span className="row-copy"><b>{location.name}</b><small>{factionInfo.label}</small></span><span className="row-kind">{KIND_LABELS[location.structuralType]}</span></button> })}
        {!filtered.length && <div className="empty-list"><span>⌕</span><b>Ничего не найдено</b><small>Измените запрос или фильтры</small></div>}
      </div>
      <footer className="panel-footnote">Двойной щелчок — перейти на карте</footer>
    </aside>
  )
}

export default function Sidebar(props: SidebarProps) {
  const mode = useMapStore((state) => state.mode)
  return mode === 'game' ? <CampaignSidebar {...props}/> : <LocationEditorSidebar {...props} />
}
