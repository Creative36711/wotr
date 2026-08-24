import { getFaction, TERRAIN_BY_ID } from '../constants'
import { useMapStore } from '../store/useMapStore'

export default function BattleReportModal() {
  const latestBattleId = useMapStore((state) => state.latestBattleId)
  const battles = useMapStore((state) => state.battles)
  const factions = useMapStore((state) => state.factions)
  const unitTypes = useMapStore((state) => state.unitTypes)
  const heroes = useMapStore((state) => state.heroes)
  const captains = useMapStore((state) => state.captains)
  const locations = useMapStore((state) => state.locations)
  const dismissBattle = useMapStore((state) => state.dismissBattle)
  const report = battles.find((battle) => battle.id === latestBattleId)
  if (!report) return null
  const attacker = getFaction(factions, report.attackerFactionId)
  const defender = getFaction(factions, report.defenderFactionId)
  const winner = report.winnerArmyId === report.attackerArmyId ? attacker : defender
  const location = locations.find((item) => item.id === report.locationId)
  const terrain = TERRAIN_BY_ID[report.terrain]

  const losses = (items: typeof report.attackerLosses) => items.map((loss) => {
    const entity = loss.kind === 'hero'
      ? heroes.find((item) => item.objectId === loss.objectId)
      : loss.kind === 'captain'
        ? captains.find((item) => `strategic:${item.id}` === loss.objectId)
        : unitTypes.find((item) => item.objectId === loss.objectId)
    const portrait = entity && 'portrait' in entity ? entity.portrait : ''
    const resultLabel = loss.kind === 'hero'
      ? loss.outcome === 'dead' ? 'Погиб' : loss.outcome === 'wounded' ? 'Ранен' : loss.outcome === 'survived' ? 'Выжил' : loss.destroyed ? 'Выведен из боя' : 'Выжил в бою'
      : loss.destroyed ? 'Уничтожен' : 'Выжил'
    return <div key={loss.slotId}><i className={`battle-loss-portrait ${loss.kind}`} style={portrait ? { backgroundImage: `url(${portrait})` } : undefined}></i><span>{entity?.name ?? loss.objectId}</span><b>{resultLabel}</b><small>базовая сила: {entity?.battlePower ?? 0}</small></div>
  })

  return (
    <div className="battle-modal-backdrop">
      <section className="battle-report-modal">
        <header><span>⚔</span><div><small>Автоматический расчёт · раунд {report.round}</small><h2>{report.battleType === 'siege' ? 'Осада' : report.battleType === 'settlement' ? 'Бой за поселение' : 'Полевое сражение'}</h2></div></header>
        <div className="battle-context"><span>{terrain.icon} {terrain.label}</span><span>⌖ {location?.name ?? 'Открытая местность'}</span></div>
        <div className="battle-versus">
          <article style={{ '--side-color': attacker.color } as React.CSSProperties}><span className="battle-side-flag">⚑</span><small>Атакующий</small><b>{attacker.label}</b><strong>{report.attackerPower}</strong></article>
          <div><i>против</i><b>VS</b></div>
          <article style={{ '--side-color': defender.color } as React.CSSProperties}><span className="battle-side-flag">⚐</span><small>Защитник</small><b>{defender.label}</b><strong>{report.defenderPower}</strong></article>
        </div>
        <div className="battle-winner" style={{ '--winner-color': winner.color } as React.CSSProperties}><small>Победитель</small><b>{winner.label}</b><p>{report.summary}</p>{report.capturedLocationId && <span>◆ Локация захвачена</span>}</div>
        <div className="battle-loss-columns"><section><h3>Потери атакующего</h3>{losses(report.attackerLosses)}</section><section><h3>Потери защитника и гарнизона</h3>{losses([...report.defenderLosses, ...(report.garrisonLosses ?? [])])}</section></div>
        <footer><span>Результат записан в историю кампании и savegame.json</span><button type="button" onClick={dismissBattle}>Продолжить кампанию</button></footer>
      </section>
    </div>
  )
}
