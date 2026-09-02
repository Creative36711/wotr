#!/usr/bin/env python3
"""
Анализ цвета ЛИНИИ графика у иконки победы/поражения.

КОНТЕКСТ ЗАДАЧИ:
  * Мы не отслеживаем каждого игрока по отдельности — нам нужна ТОЛЬКО
    КОМАНДА-ПОБЕДИТЕЛЬ. Цвет линии соответствует цвету фракции игрока
    (задан заранее при старте игры, детерминирован в bridge/room.py).
  * Цвета линий на экране «Счёт» ПРИГЛУШЕНЫ тёмным фоном. Но у нас есть
    надёжный приём: клик по слоту в «Рейтинге» ДЕЛАЕТ ЕГО ЛИНИЮ ЯРКОЙ
    (насыщенной). Мы пользуемся этим — после клика знаем ЦВЕТ линии
    заранее, а не «угадываем» его.

РАБОТА:
  1. `find_highlighted_line_endpoint(frame, color_name, cfg)` — ищет в
     области графика ЯРКУЮ (насыщенную) линию заданного цвета и возвращает
     её правый конец (ближайшую к правому краю точку). Серые сетки/рамки
     отсекаются по низкой насыщенности.
  2. `analyze_line_at_icon(...)` — запасной путь для статичного кадра
     (без кликов): читает цвет линии СЛЕВА от иконки и сравнивает с
     эталонами (dim + vivid).
  3. `classify_pixel` — классификация одиночного пикселя по имени цвета.

Калиброванные эталоны (dim = приглушённый реальный тон нитки на графике,
vivid = яркий тон после клика по слоту). Значения сняты щупами со скриншотов
экрана «Счёт» (1920x1080).
"""

import logging
from typing import List, Optional, Tuple

import numpy as np

from .config import DetectorConfig

log = logging.getLogger("match_detector.color")

# Ниже этой доли высоты кадра не анализируем: нижнюю рамку графика.
FRAME_EXCLUDE_FRAC = 0.737

# --- Приглушённые (dim) эталоны нитки на реальном экране «Счёт» ----------
CHART_COLOR_REFS = {
    "blue":       [(78, 90, 132), (50, 60, 92), (46, 55, 85)],
    "green":      [(45, 68, 57), (42, 70, 56), (40, 68, 54)],
    "yellow":     [(88, 93, 64), (52, 54, 27), (85, 88, 60), (59, 64, 36)],
    "white":      [(127, 124, 122), (170, 170, 170), (85, 85, 85)],
    "red":        [(60, 33, 31), (76, 46, 42), (59, 35, 33)],
    "orange":     [(87, 69, 52), (63, 52, 38), (80, 69, 58)],
    "purple":     [(140, 122, 128), (69, 66, 77), (158, 140, 150)],
    "light_blue": [(90, 110, 160), (110, 135, 190), (70, 85, 120)],
    "pink":       [(160, 120, 140), (180, 140, 160)],
    "black":      [(10, 10, 10), (60, 60, 70)],
}

# --- Яркие (vivid) эталоны ПОСЛЕ клика по слоту --------------------------
# Сняты со скриншотов, где подсвечен соответствующий слот: линия становится
# насыщенной и заметно ярче dim-варианта.
VIVID_COLOR_REFS = {
    "blue":       [(95, 112, 162), (110, 130, 180)],
    "green":      [(56, 84, 70), (70, 100, 84)],
    "yellow":     [(192, 142, 93), (170, 151, 83)],
    "white":      [(200, 200, 200), (230, 230, 230)],
    "red":        [(141, 73, 60), (160, 80, 66)],
    "orange":     [(192, 142, 93), (185, 130, 89)],
    "purple":     [(163, 111, 134), (185, 139, 152)],
    "light_blue": [(110, 135, 190), (130, 155, 210)],
    "pink":       [(180, 140, 160), (200, 160, 180)],
    "black":      [(60, 60, 70)],
}

# Минимальная насыщенность «цветной» линии (по разности max-min канала).
# Серые сетки/рамки/текст имеют sat ~0 — отсекаются.
SAT_THRESHOLD = 25


def chart_refs_for_color(color_name: Optional[str],
                         vivid: bool = False) -> List[Tuple[int, int, int]]:
    """Эталоны цвета нитки по имени цвета (dim или vivid)."""
    if not color_name:
        return []
    table = VIVID_COLOR_REFS if vivid else CHART_COLOR_REFS
    refs = table.get(color_name)
    if not refs:
        return []
    return [tuple(int(v) for v in r) for r in refs]


def _color_distance(rgb, ref):
    return float(np.sqrt(
        (rgb[0] - ref[0]) ** 2 + (rgb[1] - ref[1]) ** 2
        + (rgb[2] - ref[2]) ** 2))


def _hue_ok(color_name: str, rgb) -> bool:
    """Оттенковый фильтр: отбрасывает близкие по RGB, но чужие по тону."""
    if not color_name:
        return True
    r, g, b = (int(v) for v in rgb)
    rg, gb = r - g, g - b
    name = color_name
    if name == "blue":
        return (b - r) >= 25
    if name == "green":
        return rg <= -12
    if name == "yellow":
        return (rg <= 2) & (gb >= 15)
    if name == "white":
        return (abs(rg) <= 16) & (abs(r - b) <= 16)
    if name == "red":
        return (rg >= 16) & (gb <= 10)
    if name == "orange":
        return (rg >= 5) & (gb >= 4)
    if name == "purple":
        # Фиолетовая линия Ангмара на реальном экране — не только пурпурный
        # (r>g, b>g), но и тёмный сине-фиолетовый (b>g, b≈r). Общий признак:
        # ЗЕЛЁНЫЙ — минимальный канал, а синий не слишком доминирует над
        # красным (иначе это чисто синяя линия Людей). Разброс b-r ~
        # -25..+25 считается фиолетовым.
        return (r >= g) & (b >= g) & ((b - r) <= 30)
    return True


def _hue_mask(color_name: str, r, g, b):
    """Векторизованный аналог _hue_ok для целого массива пикселей.

    Сейчас применяется только к фиолетовому: это самый проблемный случай
    (тёмно-фиолетовая линия Ангмара близка по RGB к зелёной/синей, а старые
    эталоны ловили чужую нитку). Для остальных цветов решений не меняем,
    чтобы не сломать живой click-highlight прогон.
    """
    if color_name != "purple":
        return np.ones(r.shape, dtype=bool)
    return (r >= g) & (b >= g) & ((b - r) <= 30)


def classify_pixel(rgb, color_names, cfg) -> Optional[str]:
    """Классифицировать пиксель -> имя цвета или None (dim-эталоны)."""
    best_name = None
    best_dist = float("inf")
    for name in color_names:
        refs = chart_refs_for_color(name)
        if not refs:
            continue
        d = min(_color_distance(rgb, ref) for ref in refs)
        if d < best_dist:
            best_dist = d
            best_name = name
    if best_name is None or best_dist > cfg.color_tolerance:
        return None
    if not _hue_ok(best_name, rgb):
        return None
    return best_name


# ---------------------------------------------------------------------------
# Поиск ЯРКОЙ (vivid) линии заданного цвета — основной путь после клика
# ---------------------------------------------------------------------------
def find_highlighted_line_endpoint(frame, color_name: str, cfg,
                                   exclude_icons=None, bright_only=False,
                                   max_x: Optional[int] = None,
                                   near_icons=None, y_band: float = 80.0):
    """Найти правый конец яркой линии заданного цвета.

    После клика по слоту его линия становится НАСЫЩЕННОЙ и ярче dim-фона.
    Здесь мы:
      1. строим маску пикселей, близких к vivid-эталонам цвета (с допуском),
         И достаточно насыщенных (sat >= SAT_THRESHOLD), чтобы отсечь серые
         сетки/рамки/текст;
      2. ограничиваем область графика (chart_roi), исключая легенду и «Рейтинг»;
      3. исключаем «свечение» вокруг иконок (exclude_icons) — иначе яркая
         заливка монеты/пламени перекрывает сам цвет линии;
      4. находим пиксель с МАКСИМАЛЬНЫМ x (правый конец линии).

    Args:
        frame: (H, W, 3) RGB.
        color_name: имя цвета игрока (из bridge.network_prefs.COLORS).
        cfg: DetectorConfig.
        exclude_icons: список dict {"cx", "cy"} — центры иконок, вокруг
            которых свечение исключается из маски.
        bright_only: True — дополнительно требовать яркости (v>98), чтобы
            отсечь тёмные тени; для dim-линий ставить False.
        max_x: если задан, ограничить поиск только пикселями с x <= max_x
            (полезно, если линия точно левее некого ориентира).
        near_icons: список dict {"cx", "cy"} — иконки победы/поражения.
            Если задан, возвращает конец линии, ближайший к ОДНОЙ из этих
            иконок в полосе ±y_band px по Y (а не глобальный max-x). Это
            ключевое исправление: раньше шумовый пиксель в нижней части
            графика (например y=800 при chart_roi до y=815) перебивал
            настоящий конец линии у иконки сверху (y≈276) — детектор
            помечал игрока как SURRENDER, хотя линия была и дошла до иконки.
        y_band: полоса по Y вокруг иконки при near_icons != None.

    Returns:
        (x_end, y_end, pixels) или (None, None, []).
    """
    h, w = frame.shape[:2]
    # ОБЪЕДИНЯЕМ dim + vivid эталоны: dim-вариант ловит обычную нитку
    # (включая slot 1, который НЕ кликался — у него линия приглушённая,
    # до vivid-эталона далеко: для белого distance=131 > tolerance 58),
    # vivid-вариант ловит подсвеченную (после клика по слоту в «Рейтинге»)
    # яркую нитку. Без объединения детектор пропускает любой из двух
    # типов линий.
    refs = (chart_refs_for_color(color_name, vivid=False)
            + chart_refs_for_color(color_name, vivid=True))
    if not refs:
        return None, None, []

    # Область графика (доли -> пиксели).
    fx0, fy0, fx1, fy1 = cfg.chart_roi
    x0 = max(0, min(w - 1, int(fx0 * w)))
    y0 = max(0, min(h - 1, int(fy0 * h)))
    x1 = max(x0 + 1, min(w, int(fx1 * w)))
    y1 = max(y0 + 1, min(h - 1, int(fy1 * h)))

    sub = frame[y0:y1, x0:x1].astype(np.int32)
    r = sub[:, :, 0]; g = sub[:, :, 1]; b = sub[:, :, 2]
    mx = sub.max(axis=2); mn = sub.min(axis=2)
    sat = (mx - mn).astype(np.int32)

    match = np.zeros(sub.shape[:2], dtype=bool)
    for ref in refs:
        d = np.sqrt((r - ref[0]) ** 2 + (g - ref[1]) ** 2
                    + (b - ref[2]) ** 2)
        match |= (d <= cfg.color_tolerance * 1.3)
    # КРИТИЧНО: отсекаем пиксели ЧУЖОГО оттенка, даже если они близки по
    # RGB. Без этого, например, зелёная линия Эльфов попадала в маску
    # purple (ангмар) — детектор видел её конец у defeat_flame и не
    # доходил до настоящего victory_coin у фиолетовой линии.
    match &= _hue_mask(color_name, r, g, b)
    if bright_only:
        match &= (mx >= 98)
    if not match.any():
        return None, None, []

    # БЕЛЫЕ/СЕРЫЕ линии (Изенгард): vivid-эталон (200,200,200) имеет
    # sat == 0, а реальная нитка (127,127,127)..(170,170,170) — sat 0..5.
    # Фильтр sat>=25 их отсекает полностью, и slot помечается SURRENDER
    # хотя линия есть. ИСПРАВЛЕНИЕ: если ВСЕ эталоны цвета имеют
    # sat < 10 (белый/серый) — НЕ применяем порог sat, берём только
    # яркость (mx >= 80). Иначе (насыщенные цвета) — фильтр как раньше.
    refs_sat = np.array([max(int(ref[0]), int(ref[1]), int(ref[2]))
                         - min(int(ref[0]), int(ref[1]), int(ref[2]))
                         for ref in refs], dtype=np.int32)
    if refs_sat.max() < 10:
        match &= (mx >= 80)
    else:
        match &= (sat >= SAT_THRESHOLD)

    # Исключить свечение вокруг иконок.
    if exclude_icons:
        for ic in exclude_icons:
            icx = ic["cx"] - x0
            icy = ic["cy"] - y0
            rad = int(34.0 * cfg.scale_for(w, h)) + 6
            yy, xx = np.ogrid[:match.shape[0], :match.shape[1]]
            glow = ((xx - icx) ** 2 + (yy - icy) ** 2) <= rad ** 2
            match &= ~glow

    # Отсечь верхнюю полосу шапки графика (заголовок «ВРЕМЕННАЯ ШКАЛА»),
    # где зелёный градиент рамки мог бы дать ложное совпадение.
    head = int(18.0 * cfg.scale_for(w, h))
    match[:head, :] = False

    ys, xs = np.where(match)
    if len(xs) == 0:
        return None, None, []
    if max_x is not None:
        inside = xs <= max_x - x0
        if inside.any():
            xs = xs[inside]; ys = ys[inside]
        if len(xs) == 0:
            return None, None, []

    # Если передали near_icons — для КАЖДОЙ иконки ищем правый конец линии
    # в полосе ±y_band по Y И с x, близким к cx иконки (в пределах
    # x_close = y_band). Это реальная геометрия конца линии: на графике
    # линия приходит к иконке справа, последний «цветной» пиксель —
    # за 1-30 px до центра. ИЗ ИКОНОК выбираем НЕ по «самому правому
    # пикселю», а по ВЕСУ (количеству пикселей маски в полосе):
    #   * СВОЯ линия для иконки — идёт к ней и заканчивается, плотность
    #     пикселей в полосе ВЫСОКАЯ (десятки и сотни);
    #   * ЧУЖАЯ («проходящая») линия — пересекает полосу иконки
    #     транзитом, плотность пикселей НИЗКАЯ (единицы-десятки).
    # Поэтому иконка с НАИБОЛЬШИМ весом = та, к которой реально пришла
    # линия. После выбора иконки берём самый правый пиксель в её полосе
    # — это и есть конец линии у иконки.
    if near_icons:
        best_pt = None
        best_score = -1.0
        END_GAP = 80.0       # max px from cx of icon to x_max of line
        MAX_Y_DIST = 60.0    # max |y_median - icy| for the line to belong to icon
        for ic in near_icons:
            icx = ic["cx"] - x0
            icy = ic["cy"] - y0
            in_band = (
                (np.abs(ys - icy) <= y_band)
                & (xs >= icx - y_band)
                & (xs <= icx + 10)
            )
            if not in_band.any():
                continue
            xs_b = xs[in_band]; ys_b = ys[in_band]
            x_max_in_band = int(xs_b.max())
            # Filter 1: line must have REACHED this icon (not a passing line
            # that stops well before the icon).
            if (icx - x_max_in_band) > END_GAP:
                continue
            # Filter 2: the pixels in this band must be near the icon's y.
            # A 'passing' line crosses another player's band at a y far
            # from that band's icon (e.g. white passing through victory
            # band at y=330, while victory icon is at y=276). The OWN
            # line reaches the icon -> median y in band ≈ icon's y.
            y_median = float(np.median(ys_b))
            y_dist = abs(y_median - icy)
            if y_dist > MAX_Y_DIST:
                continue
            # Score: prefer (a) closer to icon in x AND (b) closer in y.
            score = (END_GAP - (icx - x_max_in_band)) + (MAX_Y_DIST - y_dist)
            if score > best_score:
                best_score = score
                j = int(np.argmax(xs_b))
                best_pt = (int(x0 + xs_b[j]), int(y0 + ys_b[j]))
        if best_pt is None:
            return None, None, []
        x_end, y_end = best_pt
        pixels = list(zip(xs.tolist(), ys.tolist()))
        return x_end, y_end, pixels

    idx = int(np.argmax(xs))
    x_end = int(x0 + xs[idx])
    y_end = int(y0 + ys[idx])
    pixels = list(zip(xs.tolist(), ys.tolist()))
    return x_end, y_end, pixels


def _distance_to_endpoint(x_end, y_end, cx, cy):
    return float(np.hypot(x_end - cx, y_end - cy))


def nearest_icon(x_end, y_end, icons,
                 max_xy_dist: float = 160.0,
                 max_x_gap: float = 80.0):
    """Ближайшая иконка к точке (x_end, y_end).

    Иконки победы/поражения на экране «Счёт» стоят НА КОНЦЕ линии каждого
    игрока, поэтому их (cx, cy) — это конец линии. Но правый конец яркой
    нити, который мы находим поиском по цвету, лежит:
      * по x — за 1-5 пикселей до иконки (линия входит в свечение монеты/
        пламени и теряется на краю её заливки);
      * по y — может быть НИЖЕ/ВЫШЕ центра иконки (линии рисуют как ступеньки,
        а монеты центрируются по радиусу свечения, центр которого ≈ на оси
        таймлайна, а не на линии конкретного игрока. На скриншоте 1x1_score.jpg
        расстояние между двумя иконками ≈ 127px по прямой).

    Поэтому используем 2 независимых порога:
      1) расстояние по прямой (cx-x, cy-y) — <= max_xy_dist (160);
      2) «по x» (|cx - x_end|) — <= max_x_gap (80). Это ключевое: если
         конец линии по x близок к иконке — линия до неё дошла, даже если
         расходится по y (что часто бывает при ступенчатом графике).
    Иконка считается «достигнутой», если выполнено хотя бы одно из них
    ЛОЖНО — иконку берём только когда выполнено ОБА? Нет: иконки могут
    стоять одна над другой с разницей y≈120, поэтому чисто по y отличить
    мы не можем. Поэтому правило:
       icon достигнута, если она БЛИЖАЙШАЯ по (x,y) И расстояние <= max_xy_dist
       ЛИБО |cx - x_end| <= max_x_gap (тогда точно «кончается в этой иконке»
       по горизонтали).

    icons: список dict {"kind", "cx", "cy"}.
    Returns:
        (icon, distance) или (None, None).
    """
    if x_end is None:
        return None, None
    best = None
    best_d = float("inf")
    for ic in icons:
        d = _distance_to_endpoint(x_end, y_end, ic["cx"], ic["cy"])
        if d < best_d:
            best_d = d
            best = ic
    if best is None:
        return None, None
    # По горизонтали до ближайшей: если конец линии по x отстоит от иконки
    # меньше, чем max_x_gap px — значит линия физически закончилась у этой
    # иконки (даже если по y сильно прыгнула). Это и есть основной сигнал.
    if abs(best["cx"] - x_end) <= max_x_gap:
        return best, best_d
    # Иначе — остался зазор по x, но, может быть, очень близко по прямой.
    if best_d <= max_xy_dist:
        return best, best_d
    return None, best_d


# ---------------------------------------------------------------------------
# Трассировка линии от иконки влево (статичный кадр, без кликов)
# ---------------------------------------------------------------------------
def _trace_line(frame, cx, cy, span, gap, dy_band=14, step=2):
    """Пройти линию от иконки влево, следуя её траектории по y.

    Возвращает список (x, y, rgb) пикселей «цветной» линии (не серой).
    """
    h, w = frame.shape[:2]
    x = cx - gap
    y = cy
    out = []
    while x > span and x < w - 2:
        xl = max(0, x - step)
        band_top = max(0, y - dy_band)
        band = frame[band_top:y + dy_band, xl:x + 1]
        if band.size == 0:
            break
        sat = (band.max(axis=2) - band.min(axis=2))
        lum = band.sum(axis=2)
        colored = np.where(sat >= SAT_THRESHOLD, lum, -1)
        colored = np.where(colored > 60, colored, -1)
        flat_colored = colored.ravel()
        flat_idx = int(np.argmax(flat_colored))
        yy = flat_idx // band.shape[1]
        if flat_colored[flat_idx] < 0:
            # цветных нет — пробуем чуть шире по y (ступенька/разрыв)
            dy_band += 3
            if dy_band > 34:
                break
            continue
        dy_band = 14
        yy_abs = band_top + yy
        rgb = (int(band[yy, 0, 0]), int(band[yy, 0, 1]), int(band[yy, 0, 2]))
        out.append((xl, yy_abs, rgb))
        y = yy_abs
        x = xl
    return out


def _trace_mean_color(pixels):
    if not pixels:
        return None
    arr = np.array([p[2] for p in pixels], dtype=np.float32)
    return tuple(int(v) for v in np.mean(arr, axis=0))


def _has_line_color_in_tail(frame, cx, cy, players, cfg,
                              min_tight_pixels: int = 12):
    """Найти «настоящий» цвет линии под victory/defeat-иконкой.

    Тонкая tight-зона (cy+HALO..cy+250, x=cx-220..cx-HALO) — без halo.
    В ней строим маску dim+vivid эталона каждого цвета игрока. Для
    «плоских» эталонов (refs_sat_max < 10, типичный white Изенгарда) —
    НЕ применяем фильтр sat >= 18 (отрежет белую линию), вместо этого
    сравниваем сумму яркости mx. Для насыщенных — sat >= 18.
    Победитель — маска с МАКСИМАЛЬНЫМ количеством пикселей (длинный хвост
    линии), при leader >= 1.5x runner-up (или leader >= 200 px).
    """
    h, w = frame.shape[:2]
    s = float(cfg.scale_for(w, h))
    HALO = int(42.0 * s)
    fx0, fy0, fx1, fy1 = cfg.chart_roi
    gx0 = int(fx0 * w); gy0 = int(fy0 * h); gx1 = int(fx1 * w); gy1 = int(fy1 * h)
    x_left_in_zone = max(gx0, int(cx) - int(220.0 * s))
    x_right_in_zone = max(gx0, int(cx) - HALO)
    y_start = int(cy) + HALO
    if x_right_in_zone <= x_left_in_zone or y_start >= gy1:
        return False, None, None, {}

    region = frame[y_start:gy1, x_left_in_zone:x_right_in_zone, :].astype(np.int32)
    mx = region.max(axis=2)
    sat = region.max(axis=2) - region.min(axis=2)
    r = region[..., 0]; g = region[..., 1]; b = region[..., 2]

    names = [p.get("color") for p in players]
    counts = {}
    samples = {}
    for idx, name in enumerate(names):
        if not name:
            continue
        refs = chart_refs_for_color(name) + chart_refs_for_color(name, vivid=True)
        if not refs:
            continue
        ref_arr = np.array(refs, dtype=np.int32)
        d = np.sqrt(((r[..., None] - ref_arr[:, 0]) ** 2
                     + (g[..., None] - ref_arr[:, 1]) ** 2
                     + (b[..., None] - ref_arr[:, 2]) ** 2
                     ).min(axis=-1))
        # Выбор sat-фильтра: «плоский» эталон (белый/серый, refs sat < 10)
        # — НЕ ставим жёсткий sat-фильтр; иначе белая нитка Изенгарда
        # (sat~5..15) полностью теряется. Используем только mx для них.
        refs_sat = np.array([max(int(rr[0]), int(rr[1]), int(rr[2]))
                              - min(int(rr[0]), int(rr[1]), int(rr[2]))
                              for rr in refs], dtype=np.int32)
        if refs_sat.max() < 10:
            ok = (d <= 22) & (mx >= 80)
        else:
            ok = (d <= 18) & (sat >= 18)
        n = int(ok.sum())
        counts[name] = n
        if ok.any():
            ys_u, xs_u = np.where(ok)
            top_y_local = int(ys_u.min())
            top_y_global = top_y_local + y_start
            sample = tuple(int(v) for v in region[top_y_local, int(xs_u[ys_u == top_y_local].mean())])
            samples[name] = sample
    if not counts:
        return False, None, None, counts
    max_count = max(counts.values())
    if max_count < min_tight_pixels:
        return False, None, None, counts

    sorted_c = sorted(counts.items(), key=lambda kv: -kv[1])
    leader_name, leader_count = sorted_c[0]
    # Лидер должен ЗНАЧИТЕЛЬНО превосходить второго.
    if len(sorted_c) > 1:
        runner_count = sorted_c[1][1]
        if leader_count < 200 and runner_count * 1.5 > leader_count:
            return False, None, None, counts
    leader_idx = next((i for i, p in enumerate(players) if p.get("color") == leader_name), None)
    return True, leader_idx, samples.get(leader_name), counts




def _line_color_near_icon(frame, cx, cy, players, cfg, scale=1.0):
    """Определить цвет ЛИНИИ победителя в tight-зоне под victory/defeat-иконкой.

    Используется как fallback при выборе из нескольких victory-кандидатов.
    Возвращает dict с тем же форматом, что analyze_line_at_icon, либо None.
    """
    found, idx, sample, _ = _has_line_color_in_tail(
        frame, cx, cy, players, cfg)
    if not found:
        return None
    return {
        "player": int(idx), "side": "left",
        "best": {"sample_rgb": sample},
        "mean_rgb": sample,
    }




def analyze_line_at_icon(frame, cx, cy, players, cfg, scale=1.0):
    """Определить владельца линии у иконки (статичный кадр, без кликов).

    Возвращает dict: {"player": индекс или None, "side": "left"/None,
                      "best": {...}, "mean_rgb": ...}.
    """
    h, w = frame.shape[:2]
    s = float(scale) * float(cfg.scale_for(w, h))
    gap = max(float(cfg.line_scan.get("gap", 40.0)) * s, 24.0 * s)
    span = min(float(cfg.line_scan.get("trace_len", 260.0)) * s, 190.0 * s)

    pixels = _trace_line(frame, cx, cy, max(int(span), 40), int(gap))
    mean_rgb = _trace_mean_color(pixels)

    best_idx = None
    best_dist = float("inf")
    names = [p.get("color") for p in players]
    if mean_rgb is not None:
        for idx, name in enumerate(names):
            if not name:
                continue
            refs = chart_refs_for_color(name)
            if not refs:
                continue
            d = min(_color_distance(mean_rgb, ref) for ref in refs)
            if d < best_dist and _hue_ok(name, mean_rgb):
                best_dist = d
                best_idx = idx

    if best_idx is None or best_dist > cfg.color_tolerance * 1.6:
        return {"player": None, "side": "left", "best": None,
                "mean_rgb": mean_rgb}

    return {"player": best_idx, "side": "left",
            "best": {"mean_rgb": mean_rgb, "dist": best_dist,
                     "pixels": len(pixels)},
            "mean_rgb": mean_rgb}