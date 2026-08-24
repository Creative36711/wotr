import { useEffect, useRef, useState } from 'react'
import { phaseIcon, phaseLabel } from '../game/campaign'
import { useMapStore } from '../store/useMapStore'
import type { SaveState } from '../types'

interface TopbarProps {
  saveState: SaveState
  onSave: () => void
  onOpenData: () => void
  onMenu: () => void
  activeModName: string
}

const saveLabels: Record<SaveState, string> = {
  idle: 'Файл данных',
  saving: 'Сохранение…',
  saved: 'Сохранено',
  error: 'Ошибка сохранения',
}

export default function Topbar({ saveState, onSave, onOpenData, onMenu, activeModName }: TopbarProps) {
  const [addOpen, setAddOpen] = useState(false)
  const addRef = useRef<HTMLDivElement>(null)
  const mode = useMapStore((state) => state.mode)
  const campaign = useMapStore((state) => state.campaign)
  const factions = useMapStore((state) => state.factions)
  const historyLength = useMapStore((state) => state.history.length)
  const futureLength = useMapStore((state) => state.future.length)
  const setAddKind = useMapStore((state) => state.setAddKind)
  const undo = useMapStore((state) => state.undo)
  const redo = useMapStore((state) => state.redo)

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!addRef.current?.contains(event.target as Node)) setAddOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])

  const playerFaction = factions.find((faction) => faction.id === campaign.playerFactionId)
  const campaignTreasury = campaign.playerFactionId ? campaign.treasuries[campaign.playerFactionId] : null
  const campaignGold = campaignTreasury?.gold ?? 0
  const campaignMaterials = campaignTreasury?.materials ?? 0
  const campaignBalance = (campaignTreasury?.lastIncome.gold ?? 0) - (campaignTreasury?.lastUpkeep ?? 0)

  return (
    <header className="topbar">
      <div className="brand">
        <span className="ring-mark" aria-hidden="true"><i /></span>
        <div>
          <b>Война за Кольцо</b>
          <small>{mode === 'edit' ? `Редактор · ${activeModName}` : `Кампания · ${activeModName}`}</small>
        </div>
      </div>

      <div className={`workspace-mode-badge ${mode}`}><span>{mode === 'edit' ? '✦' : '⚔'}</span>{mode === 'edit' ? 'Редактор' : playerFaction?.label ?? 'Кампания'}</div>

      {mode === 'game' && <div className={`campaign-phase-bar phase-${campaign.phase}`}><span>{phaseIcon(campaign.phase)}</span><div><small>Раунд {campaign.round}</small><b>{campaign.phase.startsWith('planning_')?`Ваш ход · ${playerFaction?.label??''}`:campaign.phase==='aftermath'?'Итоги хода':campaign.phase==='conflicts'?'Сражения':phaseLabel(campaign)}</b></div><i /><strong>Золото {campaignGold} <em>{campaignBalance >= 0 ? '+' : ''}{campaignBalance}</em></strong><strong>Материалы {campaignMaterials}</strong></div>}

      <div className="top-actions">
        <button type="button" className="menu-button" onClick={onMenu}><span>☰</span> Главное меню</button>
        {mode==='edit'&&<><div className={`save-status ${saveState}`} title={`Данные активного мода: ${activeModName}`}><i/><span>{saveState==='idle'?'world.json':saveLabels[saveState]}</span></div><span className="action-divider"/><button type="button" className="icon-button" onClick={undo} disabled={!historyLength} title="Отменить (Ctrl+Z)">↶</button><button type="button" className="icon-button" onClick={redo} disabled={!futureLength} title="Повторить (Ctrl+Y)">↷</button></>}

        {mode === 'edit' && <button type="button" className="data-editor-button" onClick={onOpenData} title="Фракции, юниты, герои, армии и регионы"><span>◈</span> Данные мира</button>}

        {mode === 'edit' && (
          <div className="add-menu" ref={addRef}>
            <button type="button" className="primary-button" onClick={() => setAddOpen((value) => !value)}>
              <span>＋</span> Добавить <i>▾</i>
            </button>
            {addOpen && (
              <div className="add-popover">
                <button type="button" onClick={() => { setAddKind('domain'); setAddOpen(false) }}>
                  <span className="choice-icon place">●</span>
                  <span><b>Владение</b><small>Создаёт регион окружающих гексов</small></span>
                </button>
                <button type="button" onClick={() => { setAddKind('stronghold'); setAddOpen(false) }}>
                  <span className="choice-icon keep">♜</span>
                  <span><b>Оплот</b><small>Самостоятельная точка контроля на одном гексе</small></span>
                </button>
              </div>
            )}
          </div>
        )}

        {mode==='edit'&&<button type="button" className="save-button" onClick={onSave} disabled={saveState==='saving'} title="Сохранить world.json (Ctrl+S)">Сохранить</button>}
      </div>
    </header>
  )
}
