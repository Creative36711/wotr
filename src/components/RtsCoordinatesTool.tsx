import { useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { useMapStore } from '../store/useMapStore'
import { prepareAndStartRtsBattle, startRtsCalibration, stopRtsCalibration } from '../dataService'
import { RTS_COLORS } from '../rts'
import { translateText } from '../i18n'
import type { AppSettings, MapLocation, ModDefinition, RtsPositionSet } from '../types'

interface CalibrationStep { index: number; role: 'defense' | 'attack'; main: boolean }
interface CalibrationEvent {
  type: 'started' | 'point' | 'finished' | 'stopped' | 'error'
  isFortress?: boolean
  steps?: CalibrationStep[]
  resolution?: string
  index?: number
  x?: number
  y?: number
  role?: 'defense' | 'attack'
  main?: boolean
  next?: CalibrationStep
  defense?: Array<{ x: number; y: number }>
  attack?: Array<{ x: number; y: number }>
  points?: Array<{ x: number; y: number }>
  message?: string
}

const stepHint = (step: CalibrationStep | null, isFortress: boolean) => {
  if (!step) return null
  if (step.role === 'defense') {
    if (step.main && isFortress) return `Точка ${step.index + 1}/8 · ГЛАВНАЯ позиция защиты (владелец крепости)`
    return `Точка ${step.index + 1}/8 · защитная позиция`
  }
  return `Точка ${step.index + 1}/8 · атакующая позиция`
}

function shuffled<T>(items: T[]): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1))
    ;[result[index], result[other]] = [result[other], result[index]]
  }
  return result
}

/**
 * Editor tool (п.7/п.8): calibrate the 8 minimap start points of a location
 * and test them by launching BFME in a small window with 8 recruit bots.
 */
export default function RtsCoordinatesTool({ location, activeMod, appSettings }: { location: MapLocation; activeMod: ModDefinition | null; appSettings: AppSettings | null }) {
  const factions = useMapStore((state) => state.factions)
  const updateLocation = useMapStore((state) => state.updateLocation)
  const [calibrating, setCalibrating] = useState(false)
  const [currentStep, setCurrentStep] = useState<CalibrationStep | null>(null)
  const [isFortress, setIsFortress] = useState(location.structuralType === 'stronghold')
  const [message, setMessage] = useState<string | null>(null)
  const [testBusy, setTestBusy] = useState(false)
  const unlistenRef = useRef<(() => void) | null>(null)

  const desktopRuntime = '__TAURI_INTERNALS__' in window
  const executablePath = appSettings?.rtsExecutablePath ?? ''
  const isStronghold = location.structuralType === 'stronghold'
  const positions = location.rtsPositions ?? null
  const positionsReady = Boolean(positions && positions.defense?.length === 4 && positions.attack?.length === 4)

  useEffect(() => {
    setIsFortress(location.structuralType === 'stronghold')
  }, [location.structuralType])

  useEffect(() => () => { unlistenRef.current?.(); unlistenRef.current = null }, [])

  const handleEvent = (event: CalibrationEvent) => {
    if (event.type === 'started') {
      setCalibrating(true)
      setCurrentStep(event.steps?.[0] ?? { index: 0, role: 'defense', main: Boolean(event.isFortress) })
      setMessage('Наведите курсор на точку миникарты комнаты BFME и нажмите F9. F10 — выход.')
    } else if (event.type === 'point') {
      setCurrentStep(event.next ?? null)
    } else if (event.type === 'finished') {
      const next: RtsPositionSet = { defense: event.defense ?? [], attack: event.attack ?? [] }
      updateLocation(location.id, { rtsPositions: next })
      setCalibrating(false)
      setCurrentStep(null)
      setMessage(`Координаты сохранены: защита ${next.defense.length}, атака ${next.attack.length}. Проверьте их кнопкой «Тест координат».`)
    } else if (event.type === 'stopped') {
      setCalibrating(false)
      setCurrentStep(null)
      setMessage('Калибровка остановлена.')
    } else if (event.type === 'error') {
      setCalibrating(false)
      setCurrentStep(null)
      setMessage(`Ошибка калибровки: ${translateText(event.message ?? '', appSettings?.language ?? 'ru')}`)
    }
  }

  const startCalibration = async () => {
    if (!desktopRuntime) { setMessage('Калибровка доступна только в Tauri-приложении.'); return }
    if (!executablePath) { setMessage('Сначала выберите lotrbfme2ep1.exe в главном меню.'); return }
    setMessage('Запуск игры в оконном режиме 1280×720…')
    unlistenRef.current?.()
    try {
      const unlisten = await listen<CalibrationEvent>('wotr://calibration', (event) => handleEvent(event.payload))
      unlistenRef.current = unlisten
      await startRtsCalibration(executablePath, { isFortress: isStronghold, attach: false })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const stopCalibration = async () => {
    await stopRtsCalibration().catch(() => undefined)
  }

  const resetPositions = () => {
    updateLocation(location.id, { rtsPositions: null })
    setMessage('Координаты сброшены.')
  }

  const testCoordinates = async () => {
    if (!desktopRuntime || !activeMod || !appSettings || !location.rtsMapCache || !positions) return
    setTestBusy(true)
    setMessage('Запуск теста: игра откроется в окне 1280×720, 8 игроков (Новобранец). После расстановки точек тест завершится, игра останется открытой.')
    try {
      const factionIds = activeMod.rts.factionOrder.slice(0, 8)
      const pool = factionIds.length ? factionIds : ['men-of-the-west']
      const defensePool = shuffled(positions.defense)
      const attackPool = shuffled(positions.attack)
      const startPositions: Record<string, { x: number; y: number }> = {}
      const participants = Array.from({ length: 8 }, (_, slotIndex) => {
        const factionId = pool[slotIndex % pool.length]
        const faction = factions.find((item) => item.id === factionId)
        const side = faction?.alignment === 'evil' ? 'evil' : 'good'
        const slot = slotIndex + 1
        const point = side === 'good' ? defensePool[(slot - 1) % 4] : attackPool[(slot - 1) % 4]
        if (point) startPositions[slot] = { x: point.x, y: point.y }
        return {
          slot,
          factionId,
          listIndex: activeMod.rts.factionOrder.indexOf(factionId),
          color: RTS_COLORS[slotIndex % RTS_COLORS.length].id,
          side,
          gateAngleDeg: 45,
          units: [],
          heroes: [],
        }
      })
      if (isStronghold && positions.defense[0]) startPositions[1] = { ...positions.defense[0] }
      const battleConfig = {
        version: 1,
        language: appSettings.language ?? 'ru',
        modId: activeMod.id,
        conflictId: `coordinates-test-${location.id}`,
        playerFactionId: pool[0],
        networkRules: activeMod.rts.networkRules,
        map: {
          source: 'location',
          entityId: location.id,
          mapPath: location.rtsMapCache.mapPath,
          expectedSize: location.rtsMapCache.size,
          startPositions,
          fortressOwnerSlot: isStronghold ? 1 : null,
        },
        launch: { windowed: true, resolution: '1280 720' },
        monitor: { enabled: false },
        testCoordinates: true,
        difficulty: { id: 'recruit', label: 'Recruit', bfmeIndex: 0 },
        factionOrder: activeMod.rts.factionOrder,
        participants,
      }
      const report = await prepareAndStartRtsBattle(activeMod.id, executablePath, 'location-cache', location.id, battleConfig)
      if (!report.ok) setMessage(translateText(report.errors.join('\n'), appSettings.language ?? 'ru'))
      else setMessage(`Тест запущен на карте «${location.rtsMapCache.mapName}». Точки расставлены — сравните их расположение с планом и закройте игру.`)
    } catch (error) {
      setMessage(translateText(error instanceof Error ? error.message : String(error), appSettings.language ?? 'ru'))
    } finally {
      setTestBusy(false)
    }
  }

  const testBlockedReason = !desktopRuntime ? 'Тест доступен только в Tauri-приложении.'
    : !executablePath ? 'Не выбран lotrbfme2ep1.exe.'
      : !activeMod?.rts.enabled ? 'RTS-интеграция отключена в настройках мода.'
        : !activeMod?.rts.mapsFile ? 'В моде не задан общий архив карт.'
          : !location.rtsMapCache ? 'Для объекта не загружен MapCache BIG.'
            : !positionsReady ? 'Сначала откалибруйте координаты (8 точек).'
              : null

  return (
    <section className="rts-coordinates-tool">
      <header><div><span>BFME-координаты объекта</span><b>{positionsReady ? '8 точек готовы' : positions ? `неполные: защита ${positions.defense?.length ?? 0}/4, атака ${positions.attack?.length ?? 0}/4` : 'не заданы'}</b></div></header>
      <p>Спавн-точки миникарты: первые 4 — защитники, вторые 4 — атакующие{isStronghold ? '; первая точка защиты — главная позиция владельца оплота' : ''}.</p>
      {positions && <div className="rts-coordinates-summary">
        <div><b>Защита</b>{positions.defense?.map((point, index) => <small key={index}>{index + 1}: {point.x.toFixed(4)} · {point.y.toFixed(4)}</small>)}</div>
        <div><b>Атака</b>{positions.attack?.map((point, index) => <small key={index}>{index + 1}: {point.x.toFixed(4)} · {point.y.toFixed(4)}</small>)}</div>
      </div>}
      <footer>
        {calibrating
          ? <button type="button" className="danger" onClick={() => void stopCalibration()}>■ Стоп (F10)</button>
          : <button type="button" onClick={() => void startCalibration()} title="Запустить игру в окне 1280×720 и снять 8 точек">◎ Калибровать координаты</button>}
        <button type="button" disabled={testBlockedReason !== null || testBusy} title={testBlockedReason ?? 'Проверить расстановку точек в комнате BFME'} onClick={() => void testCoordinates()}>▶ Тест координат</button>
        {positions && <button type="button" className="danger" onClick={resetPositions}>Сбросить</button>}
      </footer>
      {calibrating && currentStep && <div className="rts-calibration-hint"><b>{stepHint(currentStep, isFortress)}</b><span>Наведите курсор на точку и нажмите <kbd>F9</kbd>. <kbd>F10</kbd> — выход.</span></div>}
      {message && <small className="rts-tool-message">{message}</small>}
    </section>
  )
}
