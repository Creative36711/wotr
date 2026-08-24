import { getFaction } from '../constants'
import { useMapStore } from '../store/useMapStore'

export default function CampaignResultModal({ onMenu }: { onMenu: () => void }) {
  const campaign = useMapStore((state) => state.campaign)
  const latestBattleId = useMapStore((state) => state.latestBattleId)
  const factions = useMapStore((state) => state.factions)
  const heroes = useMapStore((state) => state.heroes)
  const dismissGameResult = useMapStore((state) => state.dismissGameResult)
  if (latestBattleId || campaign.gameStatus === 'active' || campaign.gameResultDismissed || !campaign.playerFactionId) return null
  const playerFaction = getFaction(factions, campaign.playerFactionId)
  const factionState = campaign.factionStates[campaign.playerFactionId]
  const statistics = factionState?.statistics ?? { battlesWon: 0, battlesLost: 0, locationsCaptured: 0, heroesLost: 0 }
  const deadHeroes = heroes.filter((hero) => hero.factionId === campaign.playerFactionId && campaign.heroStates[hero.id]?.status === 'dead')
  const victorySide = campaign.gameStatus === 'victory_good' ? 'Света' : campaign.gameStatus === 'victory_evil' ? 'Тьмы' : null
  const playerWon = victorySide && ((campaign.gameStatus === 'victory_good' && playerFaction.alignment === 'good') || (campaign.gameStatus === 'victory_evil' && playerFaction.alignment === 'evil'))
  const title = playerWon ? `Победа ${victorySide}` : 'Кампания проиграна'
  return <div className="campaign-result-backdrop">
    <section className={`campaign-result-modal ${playerWon ? 'victory' : 'defeat'}`}>
      <header><span>{playerWon ? '⚔' : '☠'}</span><small>{playerWon ? 'Война завершена' : 'Фракция уничтожена'}</small><h1>{title}</h1><p>Раунд {campaign.round} · ваша фракция: {playerFaction.label}</p></header>
      <div className="campaign-result-stats"><h2>Итоги кампании</h2><div><span><i>◆</i><small>Локаций захвачено</small><b>{statistics.locationsCaptured}</b></span><span><i>⚔</i><small>Сражений выиграно</small><b>{statistics.battlesWon}</b></span><span><i>↩</i><small>Сражений проиграно</small><b>{statistics.battlesLost}</b></span><span><i>★</i><small>Героев потеряно</small><b>{statistics.heroesLost}</b></span></div>{deadHeroes.length > 0 && <p>Погибли: {deadHeroes.map((hero) => hero.name).join(', ')}</p>}</div>
      <footer><button type="button" onClick={onMenu}>Главное меню</button><button type="button" className="continue" onClick={dismissGameResult}>Продолжить игру</button></footer>
    </section>
  </div>
}
