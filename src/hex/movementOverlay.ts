import { cellMovementCost, findReachable } from './hexGrid'
import type { FactionId, LogicalHex } from '../types'

/**
 * Визуальная подсветка проходимости для выделенной своей армии.
 *
 * Чистая геометрия поверх существующей стоимости движения (`hexGrid.ts`):
 * ничего не меняет в модели данных и в сохранениях, только отвечает на вопрос
 * «как выглядит каждый видимый гекс, когда игрок планирует движение».
 *
 * Категории гекса (по стоимости входа `cellMovementCost`):
 * - `impassable` — войти нельзя (непроходимый рельеф или запретительная
 *   стоимость) → красная подсветка;
 * - `slow` — войти можно, но дороже стандартного хода → жёлтая подсветка;
 * - `standard` — обычная стоимость, подсветки нет.
 *
 * Отдельно считается «недостижимость в этот ход»: BFS с бюджетом из оставшихся
 * очков движения (переиспользует `findReachable` вместе с логикой маршрутов).
 * Гексы вне досягаемости затемняются; непроходимым затемнение не нужно —
 * красный уже читается как «нельзя вообще».
 */

/** Порог стоимости входа: гексы дороже считаются непроходимыми для подсветки. */
export const IMPASSABLE_COST_CUTOFF = 99

export type EntryCostKind = 'impassable' | 'slow' | 'standard'

export function classifyEntryCost(entryCost: number): EntryCostKind {
  if (!Number.isFinite(entryCost) || entryCost >= IMPASSABLE_COST_CUTOFF) return 'impassable'
  if (entryCost > 1) return 'slow'
  return 'standard'
}

export function cellEntryCostKind(cell: LogicalHex, movingFaction: FactionId | null): EntryCostKind {
  return classifyEntryCost(cellMovementCost(cell, movingFaction))
}

export interface MovementTerrainOverlay {
  /** Куда армия не может войти вовсе: красная подсветка. */
  impassableIds: string[]
  /** Куда можно войти дороже стандартного хода: жёлтая подсветка. */
  slowIds: string[]
  /**
   * Проходимые гексы вне досягаемости в этот ход: тёмное наложение.
   * Непроходимые и гекс самой армии сюда не попадают — им затемнение не нужно.
   */
  unreachableIds: string[]
}

export interface MovementTerrainOverlayOptions {
  /** Гекс, на котором стоит выделенная армия (никогда не подсвечивается). */
  originHexId: string
  /** Оставшиеся очки движения армии; при 0 затемнение не считается. */
  movementBudget: number
  movingFaction: FactionId | null
  /** Гексы вне тумана войны; null — вся карта видна. */
  visibleHexIds: Set<string> | null
  /** Гексы, через которые поиск не распространяется (вражеские армии). */
  stopAt?: Set<string>
}

export function computeMovementTerrainOverlay(
  cells: Map<string, LogicalHex>,
  options: MovementTerrainOverlayOptions,
): MovementTerrainOverlay {
  const { originHexId, movementBudget, movingFaction, visibleHexIds, stopAt } = options
  const overlay: MovementTerrainOverlay = { impassableIds: [], slowIds: [], unreachableIds: [] }
  // Армия без оставшегося движения никуда не дотянется — затемнять нечего,
  // категории рельефа всё равно показываем.
  const reachable = movementBudget > 0
    ? findReachable(cells, originHexId, movementBudget, movingFaction, stopAt ?? new Set())
    : null

  for (const cell of cells.values()) {
    if (cell.id === originHexId) continue
    if (visibleHexIds && !visibleHexIds.has(cell.id)) continue
    const kind = cellEntryCostKind(cell, movingFaction)
    if (kind === 'impassable') {
      overlay.impassableIds.push(cell.id)
      continue
    }
    if (kind === 'slow') overlay.slowIds.push(cell.id)
    if (reachable && !reachable.has(cell.id)) overlay.unreachableIds.push(cell.id)
  }
  return overlay
}
