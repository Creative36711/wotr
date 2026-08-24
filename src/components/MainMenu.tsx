import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { useMapStore } from '../store/useMapStore'
import { sortByText } from '../utils/sort'
import { GAME_VERSION } from '../version'
import { RTS_DIFFICULTIES } from '../rts'
import type { AiDifficulty } from '../types'

interface MainMenuProps {
  view: 'menu' | 'faction'
  canContinue: boolean
  continueReason: string | null
  mapImageUrl: string
  activeModName: string
  onNewCampaign: () => void
  onMods: () => void
  onRtsSettings: () => void
  onLanguage: () => void
  onContinue: () => void
  onEditor: () => void
  onBack: () => void
  onStart: (factionId: string, fogEnabled: boolean, activeFactionIds: string[], strategicDifficulty: AiDifficulty, rtsDifficulty: AiDifficulty) => void
}

export default function MainMenu({ view, canContinue, continueReason, mapImageUrl, activeModName, onNewCampaign, onMods, onRtsSettings, onLanguage, onContinue, onEditor, onBack, onStart }: MainMenuProps) {
  const factions = useMapStore((state) => state.factions)
  const locations = useMapStore((state) => state.locations)
  const armies = useMapStore((state) => state.armies)
  const editorTemplate = useMapStore((state) => state.editorTemplate)
  const templateLocations = editorTemplate?.locations ?? locations
  const templateArmies = editorTemplate?.armies ?? armies
  const gameSave = useMapStore((state) => state.gameSave)
  const campaign = useMapStore((state) => state.campaign)
  const mode = useMapStore((state) => state.mode)
  const menuCampaign = mode === 'game' ? campaign : gameSave?.campaign
  const playable = useMemo(() => sortByText(factions.filter((faction) => faction.playable && (faction.alignment === 'good' || faction.alignment === 'evil')), (faction) => faction.label), [factions])
  const [selectedFactionId, setSelectedFactionId] = useState(() => menuCampaign?.playerFactionId ?? playable[0]?.id ?? '')
  const [activeFactionIds, setActiveFactionIds] = useState<string[]>(() => playable.map((faction) => faction.id))
  const [fogEnabled, setFogEnabled] = useState(true)
  const [strategicDifficulty, setStrategicDifficulty] = useState<AiDifficulty>(() => menuCampaign?.aiDifficulty?.strategic ?? 'warrior')
  const [rtsDifficulty, setRtsDifficulty] = useState<AiDifficulty>(() => menuCampaign?.aiDifficulty?.rts ?? 'warrior')
  const selected = playable.find((faction) => faction.id === selectedFactionId) ?? playable[0]
  const activeFactionSet = new Set(activeFactionIds)
  const good = playable.filter((faction) => faction.alignment === 'good')
  const evil = playable.filter((faction) => faction.alignment === 'evil')
  const activeGoodCount = good.filter((faction) => activeFactionSet.has(faction.id)).length
  const activeEvilCount = evil.filter((faction) => activeFactionSet.has(faction.id)).length
  const setupValid = Boolean(selected && activeGoodCount > 0 && activeEvilCount > 0)
  const choosePlayerFaction = (id: string) => { setSelectedFactionId(id); setActiveFactionIds((current) => current.includes(id) ? current : [...current, id]) }
  const toggleFaction = (id: string) => {
    if (id === selected?.id) return
    setActiveFactionIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }
  const saveFaction = factions.find((faction) => faction.id === menuCampaign?.playerFactionId)

  if (view === 'menu') return <main className="main-menu-screen" style={mapImageUrl ? { backgroundImage: `url(${mapImageUrl})` } : undefined}>
    <div className="menu-vignette" />
    <section className="main-menu-card">
      <header><span className="menu-ring"><i /></span><small>Глобальная стратегическая кампания</small><h1>Война за Кольцо</h1><p>Ремастер режима для The Battle for Middle-earth II</p></header>
      <div className="main-menu-actions">
        <button type="button" className="primary" onClick={onNewCampaign}><span>⚔</span><b>Новая кампания</b><small>Выбрать фракцию и начать с шаблона мира</small></button>
        <button type="button" onClick={onContinue} disabled={!canContinue} title={!canContinue ? continueReason ?? 'Нет совместимого сохранения' : undefined}><span>▶</span><b>Продолжить</b><small>{canContinue && saveFaction ? `${saveFaction.label} · раунд ${menuCampaign?.round ?? 1}` : continueReason ?? 'Нет совместимого сохранения'}</small></button>
        <button type="button" onClick={onEditor}><span>✦</span><b>Редактор</b><small>Карта, фракции, армии и игровые данные активного мода</small></button>
        <button type="button" onClick={onMods}><span>◈</span><b>Управление модами</b><small>Активен: {activeModName}</small></button>
        <button type="button" onClick={onRtsSettings}><span>▣</span><b>Подключение BFME</b><small>Выбрать lotrbfme2ep1.exe на этом компьютере</small></button>
        <button type="button" onClick={onLanguage}><span>◎</span><b>Язык</b><small>Изменить язык интерфейса</small></button>
      </div>
      <footer><span>Версия {GAME_VERSION} · {activeModName}</span></footer>
    </section>
  </main>

  const factionOption = (faction: typeof playable[number]) => {
    const playerSelected = selected?.id === faction.id
    const participates = activeFactionSet.has(faction.id)
    const toggle = (event: { stopPropagation: () => void }) => { event.stopPropagation(); toggleFaction(faction.id) }
    return <button type="button" key={faction.id} className={`${playerSelected ? 'active' : ''} ${participates ? '' : 'inactive'}`} style={{ '--choice-color': faction.color } as CSSProperties} onClick={() => choosePlayerFaction(faction.id)}><span className="faction-choice-emblem" style={faction.emblem ? { backgroundImage: `url(${faction.emblem})` } : undefined}><i /></span><div><b>{faction.label}</b><small>{templateLocations.filter((location) => location.side === faction.id).length} локаций · {templateArmies.filter((army) => army.factionId === faction.id).length} стартовых армий</small></div><span className={`faction-participation-toggle ${participates ? 'included' : ''} ${playerSelected ? 'locked' : ''}`} role="checkbox" aria-checked={participates} tabIndex={0} title={playerSelected ? 'Фракция игрока всегда участвует' : participates ? 'Исключить из кампании' : 'Добавить в кампанию'} onClick={toggle} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') toggle(event) }}><i>{participates ? '✓' : '×'}</i>{playerSelected ? 'Игрок' : participates ? 'Участвует' : 'Не участвует'}</span></button>
  }

  return <main className="main-menu-screen faction-selection-screen" style={mapImageUrl ? { backgroundImage: `url(${mapImageUrl})` } : undefined}>
    <div className="menu-vignette" />
    <section className="faction-selection-card">
      <header><button type="button" onClick={onBack}>← Назад</button><div><small>Новая кампания</small><h1>Фракция игрока и участники</h1><p>Выберите свою фракцию и отключите тех, кто не должен участвовать. Владения неактивных фракций станут нейтральными.</p></div></header>
      <div className="faction-choice-columns">
        <section><h2><span>☀</span> Свет</h2><div>{good.map(factionOption)}</div></section>
        <section><h2><span>◆</span> Тьма</h2><div>{evil.map(factionOption)}</div></section>
      </div>
      <section className="campaign-difficulty-panel"><header><b>Сложность кампании</b><small>Настройки сохраняются в кампании отдельно</small></header><label><span>ИИ глобальной карты</span><select value={strategicDifficulty} onChange={(event) => setStrategicDifficulty(event.target.value as AiDifficulty)}>{RTS_DIFFICULTIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><small>Задел на будущее: поведение стратегического ИИ пока одинаково.</small></label><label><span>ИИ в BFME-сражениях</span><select value={rtsDifficulty} onChange={(event) => setRtsDifficulty(event.target.value as AiDifficulty)}>{RTS_DIFFICULTIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><small>Передаётся в конфигурацию комнаты RTS уже сейчас.</small></label></section>
      <footer>
        <div style={{ '--selected-color': selected?.color ?? '#c4aa6b' } as CSSProperties}><span>Фракция игрока</span><b>{selected?.label ?? 'Нет доступных фракций'}</b><small>{selected ? `Участники: ${activeFactionIds.length} · Свет: ${activeGoodCount} · Тьма: ${activeEvilCount}` : ''}</small></div>
        <div className="faction-selection-presets"><button type="button" onClick={() => setActiveFactionIds(playable.map((faction) => faction.id))}>Выбрать всех</button><button type="button" onClick={() => selected && setActiveFactionIds([selected.id, ...(selected.alignment === 'good' ? evil.slice(0, 1) : good.slice(0, 1)).map((faction) => faction.id)])}>Только игрок и противник</button></div>
        <label className="fog-start-toggle"><input type="checkbox" checked={fogEnabled} onChange={(event) => setFogEnabled(event.target.checked)} /><span><b>Туман войны</b><small>{fogEnabled ? 'Включён: разведка и последняя известная информация' : 'Выключен: вся карта полностью видна'}</small></span></label>
        <button type="button" disabled={!setupValid} title={!setupValid ? 'Нужна хотя бы одна активная фракция Света и Тьмы' : undefined} onClick={() => selected && onStart(selected.id, fogEnabled, activeFactionIds, strategicDifficulty, rtsDifficulty)}>Начать кампанию →</button>
      </footer>
    </section>
  </main>
}
