import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { getFaction } from '../constants'
import { commanderDefinition } from '../game/army'
import { previewConflict } from '../game/conflicts'
import { resolveGrid } from '../hex/hexGrid'
import { useMapStore } from '../store/useMapStore'
import { prepareAndStartRtsBattle, readRtsBattleResult } from '../dataService'
import { RTS_DIFFICULTIES } from '../rts'
import { translateText } from '../i18n'
import type { AppSettings, ModDefinition } from '../types'

function shuffle<T>(items: T[]): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1))
    ;[result[index], result[other]] = [result[other], result[index]]
  }
  return result
}

export default function ConflictModal({ activeMod, appSettings }: { activeMod:ModDefinition|null; appSettings:AppSettings|null }) {
  const [rtsBusy,setRtsBusy]=useState(false)
  const [rtsMessage,setRtsMessage]=useState<string|null>(null)
  const [rtsWatching,setRtsWatching]=useState(false)
  const rtsWatchToken=useRef(0)
  const campaign = useMapStore((state) => state.campaign)
  const armies = useMapStore((state) => state.armies)
  const locations = useMapStore((state) => state.locations)
  const locationStates = useMapStore((state) => state.campaign.locationStates)
  const factions = useMapStore((state) => state.factions)
  const units = useMapStore((state) => state.unitTypes)
  const heroes = useMapStore((state) => state.heroes)
  const captains = useMapStore((state) => state.captains)
  const grid = useMapStore((state) => state.grid)
  const regions = useMapStore((state) => state.regions)
  const selectConflict = useMapStore((state) => state.selectConflict)
  const setReinforcementParticipation = useMapStore((state) => state.setReinforcementParticipation)
  const resolveConflict = useMapStore((state) => state.resolveConflict)
  const retreatConflictDefender = useMapStore((state) => state.retreatConflictDefender)
  const resolveConflictRts = useMapStore((state) => state.resolveConflictRts)
  useEffect(() => () => { rtsWatchToken.current += 1 }, [])
  if (campaign.phase !== 'conflicts' || !campaign.currentConflictId) return null
  const conflict = campaign.conflicts.find((candidate) => candidate.id === campaign.currentConflictId)
  if (!conflict) return null
  const cell = resolveGrid(grid, locations, regions).byId.get(conflict.hexId)
  if (!cell) return null
  const location = conflict.locationId ? locations.find((candidate) => candidate.id === conflict.locationId) ?? null : null
  const attackers = conflict.attackerArmyIds.map((id) => armies.find((army) => army.id === id)).filter(Boolean) as typeof armies
  const defenders = conflict.defenderArmyIds.map((id) => armies.find((army) => army.id === id)).filter(Boolean) as typeof armies
  const attackerReinforcements = conflict.attackerReinforcementArmyIds.map((id) => armies.find((army) => army.id === id)).filter(Boolean) as typeof armies
  const defenderReinforcements = conflict.defenderReinforcementArmyIds.map((id) => armies.find((army) => army.id === id)).filter(Boolean) as typeof armies
  const playerReinforcementOptions = conflict.optionalPlayerReinforcements.map((option) => ({ option, army: armies.find((army) => army.id === option.armyId) })).filter((item) => item.army) as Array<{ option: typeof conflict.optionalPlayerReinforcements[number]; army: typeof armies[number] }>
  const preview = previewConflict(conflict, armies, locations, locationStates, units, heroes, captains, cell.terrain)
  const attackerEnemy = conflict.attackerSide !== campaign.playerSide
  const defenderEnemy = conflict.defenderSide !== campaign.playerSide
  const approximatePower = (power: number) => `${Math.max(0, Math.floor(power * .8 / 100) * 100)}–${Math.ceil(power * 1.2 / 100) * 100}`
  const pending = conflict.status === 'pending'
  const pendingConflicts = campaign.conflicts.filter((candidate) => candidate.status === 'pending')
  const nextPending = pendingConflicts.find((candidate) => candidate.id !== conflict.id)
  const sideColor = (side: 'good' | 'evil') => side === 'good' ? '#d1bd82' : '#b26056'
  const sideName = (side: 'good' | 'evil') => side === 'good' ? 'Свет' : 'Тьма'
  const armyPower = (army: typeof armies[number]) => {
    const commander = commanderDefinition(army, heroes, captains)
    return (commander?.battlePower ?? 0)
      + army.unitSlots.reduce((total, slot) => total + (units.find((unit) => unit.id === slot.entityId)?.battlePower ?? 0), 0)
      + army.heroSlots.reduce((total, slot) => total + (heroes.find((hero) => hero.id === slot.entityId)?.battlePower ?? 0), 0)
  }
  const armyCard = (army: typeof armies[number], reinforcement = false, enemy = false, distant = false) => {
    const faction = getFaction(factions, army.factionId)
    const commander = commanderDefinition(army, heroes, captains)
    const commanderName = army.commander?.kind === 'captain' ? army.commander.displayName ?? commander?.name : commander?.name
    const heroNames = [...(army.commander?.kind === 'hero' && commander ? [commander.name] : []), ...army.heroSlots.map((slot) => heroes.find((hero) => hero.id === slot.entityId)?.name).filter(Boolean)]
    const power = Math.round(armyPower(army))
    const shownPower = enemy ? `≈${Math.max(100, Math.round(power / 100) * 100)}` : String(power)
    return <article key={army.id} className={reinforcement ? 'reinforcement' : ''} style={{ '--conflict-faction': faction.color } as CSSProperties}><span>{reinforcement ? '➜' : '⚑'}</span><div><b>{enemy ? `${faction.label}: ${army.unitSlots.length} отрядов` : army.name}</b><small>{reinforcement ? distant ? 'Дальнее подкрепление · 2 гекса' : 'Немедленное подкрепление · соседний гекс' : `${faction.label} · ${army.unitSlots.length} отрядов`}</small><i>{enemy ? heroNames.length ? `Замечены: ${heroNames.join(', ')}` : 'Герои не замечены' : commanderName ?? 'Без командира'}</i></div><strong>{shownPower}</strong></article>
  }
  const reserve = conflict.garrisonLocationId ? locationStates[conflict.garrisonLocationId]?.reserve ?? [] : []
  const garrisonPower = reserve.reduce((total, slot) => total + (slot.kind === 'hero' ? heroes.find((hero) => hero.id === slot.entityId)?.battlePower ?? 0 : units.find((unit) => unit.id === slot.entityId)?.battlePower ?? 0), 0)
  const playerDefendsWithArmy = conflict.defenderArmyIds.some((id) => armies.find((army) => army.id === id)?.factionId === campaign.playerFactionId)
  const playerDefendsLocation = Boolean(location && location.side === campaign.playerFactionId)
  const canRetreat = conflict.defenderArmyIds.length > 0 && (playerDefendsWithArmy || playerDefendsLocation)
  const rtsFactionIds=[...new Set([...attackers,...defenders,...attackerReinforcements,...defenderReinforcements].map((army)=>army.factionId))]
  if(location&&conflict.garrisonLocationId&&!rtsFactionIds.includes(location.side))rtsFactionIds.push(location.side)
  const factionOrderReady=Boolean(activeMod&&rtsFactionIds.every((id)=>activeMod.rts.factionOrder.includes(id)))
  const orderedRtsFactionIds=activeMod?[...rtsFactionIds].sort((left,right)=>left===campaign.playerFactionId?-1:right===campaign.playerFactionId?1:activeMod.rts.factionOrder.indexOf(left)-activeMod.rts.factionOrder.indexOf(right)):rtsFactionIds
  const fortressDefenderFactionId=location?.side??defenders[0]?.factionId??null
  const fortressDefenderSlot=fortressDefenderFactionId?orderedRtsFactionIds.indexOf(fortressDefenderFactionId)+1:0
  const cacheEntityId=conflict.rtsLocationId
  const selectedMapAsset=cacheEntityId?locations.find((item)=>item.id===cacheEntityId)?.rtsMapCache:null
  const desktopRuntime='__TAURI_INTERNALS__' in window
  const rtsBlockReason=!desktopRuntime?'Запуск BFME доступен только в Tauri-приложении.'
    :!activeMod?'Активный мод не загружен.'
      :!activeMod.rts.enabled?'RTS-интеграция отключена в системных настройках мода.'
        :!appSettings?.rtsExecutablePath?'Не выбран lotrbfme2ep1.exe. Откройте главное меню → «Подключение BFME».'
          :!activeMod.rts.mapsFile?'В системных настройках мода отсутствует общий BIG-архив карт.'
            :!cacheEntityId||!selectedMapAsset||!conflict.rtsMapId?'Для места этого боя не загружен MapCache BIG.'
              :!factionOrderReady?'Одна из участвующих фракций отсутствует в порядке фракций BFME.'
                :!conflict.rtsCompatible?'Состав сторон не совместим с RTS: проверьте число фракций и слотов.'
                  :null
  const rtsReady=rtsBlockReason===null
  const rtsArmyPool=[...new Map([...attackers,...defenders,...attackerReinforcements,...defenderReinforcements].map((army)=>[army.id,army])).values()]
  const rtsComposition=(factionId:string)=>{const factionArmies=rtsArmyPool.filter((army)=>army.factionId===factionId);const unitObjects=factionArmies.flatMap((army)=>army.unitSlots.map((slot)=>slot.objectId));const heroObjects=factionArmies.flatMap((army)=>[...(army.commander?.kind==='hero'&&army.commander.objectId?[army.commander.objectId]:[]),...army.heroSlots.map((slot)=>slot.objectId)]);if(location?.side===factionId&&conflict.garrisonLocationId){for(const slot of reserve){if(slot.kind==='hero')heroObjects.push(slot.objectId);else unitObjects.push(slot.objectId)}}return{units:unitObjects.map((objectId)=>({objectId,level:1,upgrades:[]})),heroes:[...new Set(heroObjects)].map((objectId)=>({objectId,level:1}))}}
  const battleLocation=cacheEntityId?locations.find((item)=>item.id===cacheEntityId)??null:null
  const rtsPositions=battleLocation?.rtsPositions??null
  const isFortressBattle=conflict.battleType==='siege'
  // Спавн-точки всегда расставляются случайно (п.3); у оплота владелец
  // всегда занимает первую (главную) позицию защиты (п.6).
  const buildStartPositions=(participants:Array<{factionId:string;side:'good'|'evil'|'neutral'}>)=>{
    // Прототип (maps.calculate_slot_positions): пулы перетасовываются случайно;
    // у оплота владелец закрепляется на defense[0], а остальные защитники
    // получают точки из defense[1..] — главная точка не повторяется.
    let defensePool=rtsPositions?.defense?.length?shuffle(rtsPositions.defense):[]
    const attackPool=rtsPositions?.attack?.length?shuffle(rtsPositions.attack):[]
    const startPositions:Record<string,{x:number;y: number}>=
      {}
    let fortressOwnerSlot:number|null=null
    // Владелец оплота закрепляется за точкой ТОЛЬКО если главная позиция
    // защиты назначена в BFME-координатах объекта; иначе всё случайно.
    const mainIndex=isFortressBattle&&rtsPositions?.defense?.length
      ?rtsPositions.fortressDefenseIndex??null
      :null
    if(mainIndex!=null&&mainIndex>=0&&mainIndex<rtsPositions!.defense.length){
      const ownerIndex=participants.findIndex((participant)=>participant.factionId===fortressDefenderFactionId)
      if(ownerIndex>=0){
        fortressOwnerSlot=ownerIndex+1
        const main=rtsPositions!.defense[mainIndex]
        startPositions[ownerIndex+1]={...main}
        defensePool=defensePool.filter((point)=>point!==main)
      }
    }
    let defenseIndex=0
    let attackIndex=0
    participants.forEach((participant,slotIndex)=>{
      const slot=slotIndex+1
      if(startPositions[slot])return
      const pool=participant.side===conflict.defenderSide?defensePool:attackPool
      const index=participant.side===conflict.defenderSide?defenseIndex++:attackIndex++
      const point=pool[index%Math.max(1,pool.length)]
      if(point)startPositions[slot]={x:point.x,y:point.y}
    })
    return {startPositions,fortressOwnerSlot}
  }
  const watchBattleResult=async(token:number)=>{
    const deadline=Date.now()+5400_000
    while(token===rtsWatchToken.current&&Date.now()<deadline){
      await new Promise((resolve)=>setTimeout(resolve,5000))
      if(token!==rtsWatchToken.current)return
      const current=useMapStore.getState().campaign.conflicts.find((candidate)=>candidate.id===conflict.id)
      if(!current||current.status!=='pending')break
      const result=await readRtsBattleResult(conflict.id).catch(()=>null)
      if(token!==rtsWatchToken.current)return
      if(result?.finishedAt){
        if(result.winningTeam==='good'||result.winningTeam==='evil'){
          const outcomeDetail=result.status==='COMPLETED'&&result.winningSlot?`победил слот ${result.winningSlot}`:result.status==='SURRENDER'?'противник сдался':''
          resolveConflictRts(conflict.id,result.winningTeam,outcomeDetail)
          setRtsMessage(`Бой завершён: победа стороны «${result.winningTeam==='good'?'Свет':'Тьма'}». BFME закрыт автоматически.`)
        }else{
          setRtsMessage(`Победитель не определён (${result.status}). BFME закрыт; проведите автобой или повторите BFME-сражение.`)
        }
        break
      }
    }
    if(token===rtsWatchToken.current)setRtsWatching(false)
  }
  const runRts=async()=>{
    if(!activeMod||!appSettings||!cacheEntityId)return
    rtsWatchToken.current+=1
    setRtsWatching(false)
    setRtsBusy(true)
    setRtsMessage('Подготовка файлов и автоматический запуск BFME. Подтвердите запрос Windows UAC, если он появится. После этого физический ввод временно блокируется до начала загрузки боя; аварийный выход — Ctrl+Alt+Del.')
    try{
      const difficulty=RTS_DIFFICULTIES.find((item)=>item.id===campaign.aiDifficulty.rts)!
      const participants=orderedRtsFactionIds.map((id,slotIndex)=>({slot:slotIndex+1,factionId:id,listIndex:activeMod.rts.factionOrder.indexOf(id),color:factions.find((faction)=>faction.id===id)?.rtsColor,side:factions.find((faction)=>faction.id===id)?.alignment??'good',gateAngleDeg:45,...rtsComposition(id)}))
      const {startPositions,fortressOwnerSlot}=buildStartPositions(participants)
      const battleConfig={version:1,language:appSettings.language??'ru',modId:activeMod.id,conflictId:conflict.id,playerFactionId:campaign.playerFactionId,networkRules:activeMod.rts.networkRules,map:{source:conflict.rtsMapSource,entityId:cacheEntityId,mapPath:conflict.rtsMapId,expectedSize:selectedMapAsset?.size??0,defenderStartPosition:conflict.rtsDefenderStartPosition,defenderSlot:fortressDefenderSlot||null,startPositions,fortressOwnerSlot},launch:{windowed:false},monitor:{enabled:true,timeoutSec:5400},difficulty:{id:difficulty.id,label:difficulty.label,bfmeIndex:difficulty.bfmeIndex},factionOrder:activeMod.rts.factionOrder,participants,attackerArmyIds:conflict.attackerArmyIds,defenderArmyIds:conflict.defenderArmyIds,attackerReinforcementArmyIds:conflict.attackerReinforcementArmyIds,defenderReinforcementArmyIds:conflict.defenderReinforcementArmyIds}
      const report=await prepareAndStartRtsBattle(activeMod.id,appSettings.rtsExecutablePath,'location-cache',cacheEntityId,battleConfig)
      if(!report.ok){setRtsMessage(translateText(report.errors.join('\n'),appSettings.language??'ru'));return}
      const token=rtsWatchToken.current
      setRtsWatching(true)
      setRtsMessage(`BFME настроен автоматически, запущена карта «${selectedMapAsset?.mapName??conflict.rtsMapId}». Конфигурация: ${report.battleConfigPath}. После боя исход определится автоматически и игра закроется.`)
      void watchBattleResult(token)
    }catch(error){setRtsMessage(translateText(error instanceof Error?error.message:String(error),appSettings.language??'ru'))}
    finally{setRtsBusy(false)}
  }

  return (
    <div className="conflict-modal-layer" onPointerDown={(event) => event.stopPropagation()}>
      <section className="conflict-card">
        <header><span>⚔</span><div><small>{conflict.battleType === 'siege' ? 'Осада' : conflict.battleType === 'settlement' ? 'Оборона поселения' : 'Полевой бой'} · раунд {campaign.round}</small><h2>{location?.name ?? 'Полевое сражение'}</h2></div><b className={pending ? 'pending' : 'resolved'}>{pending ? 'Ожидает решения' : 'Разрешено'}</b></header>
        <div className="conflict-columns">
          <section style={{ '--conflict-side': sideColor(conflict.attackerSide) } as CSSProperties}>
            <h3><span>Атакующие</span><b>{sideName(conflict.attackerSide)}</b></h3>
            <div className="conflict-army-stack">{attackers.map((army) => armyCard(army, false, attackerEnemy))}{attackerReinforcements.length > 0 && <div className="reinforcement-heading">Подкрепления</div>}{attackerReinforcements.map((army) => armyCard(army, true, attackerEnemy, conflict.attackerDistantReinforcementArmyIds.includes(army.id)))}</div>
            <footer><span>Итого атака</span><strong>{attackerEnemy && pending ? approximatePower(preview.attackerPower) : conflict.attackerPower ?? preview.attackerPower}</strong><small>{preview.attackerUnits} боевых отрядов{attackerEnemy && pending ? ' · оценка силы ±20%' : ''}</small></footer>
          </section>
          <div className="conflict-versus">VS</div>
          <section style={{ '--conflict-side': sideColor(conflict.defenderSide) } as CSSProperties}>
            <h3><span>Защитники</span><b>{sideName(conflict.defenderSide)}</b></h3>
            <div className="conflict-army-stack">{defenders.map((army) => armyCard(army, false, defenderEnemy))}{reserve.length > 0 && <article className="garrison"><span>♜</span><div><b>Гарнизон: {location?.name}</b><small>{reserve.filter((slot) => slot.kind === 'unit').length} отрядов в резерве</small><i>{reserve.some((slot) => slot.kind === 'hero') ? 'Герой возглавляет оборону' : 'Без командира: −15% к силе'}</i></div><strong>{defenderEnemy ? `≈${Math.max(100, Math.round(garrisonPower / 100) * 100)}` : garrisonPower}</strong></article>}{defenderReinforcements.length > 0 && <div className="reinforcement-heading">Подкрепления</div>}{defenderReinforcements.map((army) => armyCard(army, true, defenderEnemy, conflict.defenderDistantReinforcementArmyIds.includes(army.id)))}{!defenders.length && !reserve.length && !defenderReinforcements.length && <p className="conflict-empty-side">Полевых армий нет</p>}</div>
            <footer><span>Итого оборона</span><strong>{defenderEnemy && pending ? approximatePower(preview.defenderPower) : conflict.defenderPower ?? preview.defenderPower}</strong><small>{preview.defenderUnits} отрядов · укрепления +{Math.round(preview.defenseBonus * 100)}%{defenderEnemy && pending ? ' · оценка ±20%' : ''}</small></footer>
          </section>
        </div>
        {pending && playerReinforcementOptions.length > 0 && <section className="reinforcement-choice-panel"><header><div><b>Ваши армии доступны как подкрепления</b><small>Решение принимает игрок. Не участвующая армия сохранит свои ОД.</small></div><span>{playerReinforcementOptions.filter(({ option }) => (option.side === conflict.attackerSide ? conflict.attackerReinforcementArmyIds : conflict.defenderReinforcementArmyIds).includes(option.armyId)).length}/{playerReinforcementOptions.length}</span></header><div>{playerReinforcementOptions.map(({ option, army }) => { const selected = (option.side === conflict.attackerSide ? conflict.attackerReinforcementArmyIds : conflict.defenderReinforcementArmyIds).includes(army.id); return <article key={army.id} className={selected ? 'selected' : ''}><span className="reinforcement-choice-flag" style={{ '--choice-color': getFaction(factions, army.factionId).color } as CSSProperties}>⚑</span><div><b>{army.name}</b><small>{option.tier === 'immediate' ? 'Соседний гекс · вступает немедленно' : `Два гекса · стоимость подхода ${option.pathCost} ОД`} · {army.unitSlots.length} отрядов</small></div><button type="button" className={selected ? 'decline' : 'join'} onClick={() => setReinforcementParticipation(conflict.id, army.id, !selected)}>{selected ? 'Не вмешиваться' : 'Присоединиться'}</button></article> })}</div></section>}
        {pending&&rtsBlockReason&&<div className="rts-readiness-warning"><b>BFME-сражение пока недоступно</b><span>{rtsBlockReason}</span>{!appSettings?.rtsExecutablePath&&desktopRuntime&&<small>После выбора EXE вернитесь к этому конфликту — начинать кампанию заново не нужно.</small>}</div>}
        {pending ? <div className="conflict-actions"><button type="button" className="auto" onClick={() => resolveConflict(conflict.id)}>⚔ Провести автобой</button><button type="button" className="rts" disabled={!rtsReady||rtsBusy} title={rtsBlockReason??'Проверить BIG-файлы и запустить BFME'} onClick={()=>void runRts()}>BFME · {rtsBusy?'подготовка…':rtsWatching?'идёт бой…':`${conflict.rtsAttackerSlots}×${conflict.rtsDefenderSlots}`}</button><button type="button" className="retreat" disabled={!canRetreat} onClick={() => retreatConflictDefender(conflict.id)}>↩ Отступить защитником</button></div> : <div className="conflict-result-strip"><span>{conflict.winnerSide === conflict.attackerSide ? 'Атакующие победили' : 'Защитники победили'}</span><b>Потери: {conflict.attackerLosses} / {conflict.defenderLosses}</b>{nextPending && <button type="button" onClick={() => selectConflict(nextPending.id)}>Следующий бой →</button>}</div>}
        {rtsMessage&&<div className="rts-launch-message">{rtsMessage}</div>}<footer className="conflict-note">Армии первого кольца вступают без проверки ОД; армии второго кольца должны оплатить реальную стоимость пути. Оба типа участвуют с полной силой и остаются на своих стратегических гексах.</footer>
      </section>
    </div>
  )
}
