#!/usr/bin/env python3
"""
Главный класс MatchResultDetector — определение команды-победителя по
экрану статистики BFME2:RotWK.

Поток работы:
    1. В фоне ждём экран статистики (оба маркера: крепость + шапка «Счёт»).
    2. Кликаем «Пропустить» и вкладку «Счёт» (график с полным набором иконок).
    3. Для КАЖДОГО игрока 1..N кликаем его слот в «Рейтинге»: его линия
       становится ЯРКОЙ (насыщенной). Мы ЗНАЕМ цвет этого слота заранее,
       поэтому не «угадываем» его, а просто ищем яркую линию этого цвета и
       смотрим, к какой иконке (монета/вспышка) она приходит.
    4. Собираем результат: у кого монета -> победитель, у кого вспышка ->
       проигравший. Команда-победитель = команда любого победителя.

Формат результата (config/match_result.json):
    {
      "match_status": "COMPLETED" | "SURRENDER" | "UNKNOWN",
      "winning_team": "good" | "evil" | null,
      "losing_team": "evil" | "good" | null,
      "winning_team_label": "Добро" | "Зло" | null,
      "losing_team_label": "Зло" | "Добро" | null,
      "winners": [...], "losers": [...], "unmatched_players": [...],
      "raw_data": {...}
    }

Команды: "good" = Свет (добро), "evil" = Тьма (зло).
"""

import json
import logging
import os
import sys
import threading
import time
from typing import Any, Callable, Dict, List, Optional

import numpy as np

# Корень проекта нужен для импорта bridge.log (он не под Windows-only).
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

# Импорты модулей match_result_detector (не Windows-only, можно везде).
from . import color_analyzer
from . import icon_finder
from . import player_matcher
from .config import DetectorConfig, TEMPLATE_FILES, TEMPLATES_DIR
from .screen_monitor import ScoreScreenMonitor

# Модульный LOGGER (а не функция!). Все вызовы в коде ниже — это
# стандартный Python API: log.info(...), log.warning(...), log.exception(...).
# Чтобы вывод попадал в stdout/stderr как `[match] ...` строки (как делает
# main.py), прицепим handler, который маршрутизирует через bridge.log.log().
log = logging.getLogger("match_detector.detector")

_BRIDGE_LOG = None
try:
    from bridge.log import log as _bridge_log_func  # noqa: F811
    _BRIDGE_LOG = _bridge_log_func
except Exception:  # noqa: BLE001
    _BRIDGE_LOG = None


class _BridgeLogHandler(logging.Handler):
    def emit(self, record):  # noqa: D401
        try:
            msg = self.format(record)
        except Exception:  # noqa: BLE001
            return
        stream = sys.stderr if record.levelno >= logging.WARNING else sys.stdout
        if _BRIDGE_LOG is None:
            try:
                print(msg, file=stream)
            except Exception:  # noqa: BLE001
                pass
            return
        try:
            _BRIDGE_LOG(msg, file=stream)
        except Exception:  # noqa: BLE001
            pass


if not any(isinstance(h, _BridgeLogHandler) for h in log.handlers):
    _h = _BridgeLogHandler(level=logging.INFO)
    _h.setFormatter(logging.Formatter("%(message)s"))
    log.addHandler(_h)
log.propagate = False


BLACK_FRAME_MEAN = 6.0
BLACK_FRAME_BRIGHT_RATIO = 0.0005
BLACK_FRAME_BRIGHT_MEAN = 20.0

STATUS_COMPLETED = "COMPLETED"
STATUS_SURRENDER = "SURRENDER"
STATUS_UNKNOWN = "UNKNOWN"
STATUS_TIMEOUT = "TIMEOUT"


def _is_black_frame(frame):
    mean = float(frame.mean())
    if mean < BLACK_FRAME_MEAN:
        return True
    bright = float((frame.max(axis=2) > 60).mean())
    if mean < BLACK_FRAME_BRIGHT_MEAN and bright < BLACK_FRAME_BRIGHT_RATIO:
        return True
    return False


def _default_capture():
    try:
        from bridge import navigate as nav
    except Exception:  # noqa: BLE001
        return lambda: None

    def capture():
        try:
            return nav.capture_window()
        except Exception:  # noqa: BLE001
            return None

    return capture


def _default_game_alive():
    try:
        from bridge import navigate as nav
    except Exception:  # noqa: BLE001
        return None

    def alive():
        hwnd, _how = nav.find_game_window(require_visible=False)
        return hwnd is not None

    return alive


def _default_click():
    try:
        from bridge import navigate as nav
        return nav.click
    except Exception:  # noqa: BLE001
        return lambda x, y: None


class MatchResultDetector:
    """Детектор команды-победителя по экрану статистики BFME2."""

    def __init__(self, players: List[Dict[str, Any]],
                 screen_resolution: Optional[tuple] = None,
                 capture: Optional[Callable] = None,
                 config: Optional[Dict[str, Any]] = None,
                 game_alive: Optional[Callable] = None,
                 click: Optional[Callable] = None):
        """Создать детектор.

        Args:
            players: список dict: name, color (blue/red/...), team
                ("good"/"evil"), is_local_player, slot.
            screen_resolution: (w, h); если неизвестно, берётся из кадра.
            capture: callable -> (H, W, 3) numpy RGB.
            config: dict переопределений DetectorConfig.
            game_alive: callable -> bool (жива ли игра).
            click: callable (x_px, y_px) — клик мышью.
        """
        if not players:
            raise ValueError("players list must not be empty")
        self.players = list(players)
        # Slot 1 is the local player in the rating column and is selected by
        # the game automatically.  Keep the metadata consistent even when a
        # caller supplies only the slot/team/color fields.
        if self.players and "is_local_player" not in self.players[0]:
            self.players[0]["is_local_player"] = True
        self._screen_resolution = tuple(screen_resolution) \
            if screen_resolution else None
        self._cfg = DetectorConfig.from_dict(config)
        self._capture = capture or _default_capture()
        self._game_alive = game_alive or _default_game_alive()
        self._click = click or _default_click()

        self._templates: Dict[str, np.ndarray] = {}
        self._monitor: Optional[ScoreScreenMonitor] = None
        self._timeout_timer: Optional[threading.Timer] = None
        self._result: Optional[Dict[str, Any]] = None
        self._result_event = threading.Event()
        self._analysis_lock = threading.Lock()

        self._capture_fail_reason = None

        # Маркер экрана «Статистика» (кэш; None = не загрузился).
        self._stats_marker_cache = None

        # Каллбэки жизненного цикла.
        self.on_score_screen_detected: Optional[Callable] = None
        self.on_analysis_finished: Optional[Callable] = None

    # ------------------------------------------------------------------
    # Публичный API
    # ------------------------------------------------------------------
    def start_monitoring(self, on_result_callback: Optional[Callable] = None,
                         timeout: Optional[float] = None) -> None:
        self.stop_monitoring()
        self._result = None
        self._result_event.clear()
        self._on_result_callback = on_result_callback
        self._monitor = ScoreScreenMonitor(
            is_score_screen=self.is_score_screen,
            poll=self._cfg.monitor_poll,
            confirm_streak=self._cfg.confirm_streak,
            on_score_screen=self._on_score_screen_cb,
            on_timeout=self._on_monitor_timeout_cb,
            game_alive=self._game_alive,
        )
        self._monitor.start()
        if timeout:
            timer = threading.Timer(timeout, self.stop_monitoring)
            # The timeout is only a safety net. It must never keep the whole
            # application alive after the result has already been produced.
            timer.daemon = True
            self._timeout_timer = timer
            timer.start()

    def stop_monitoring(self) -> None:
        if self._monitor:
            self._monitor.stop()
            self._monitor = None
        if self._timeout_timer is not None:
            self._timeout_timer.cancel()
            self._timeout_timer = None

    def is_monitoring(self) -> bool:
        return bool(self._monitor and self._monitor.is_alive())

    def wait_for_result(self, timeout: Optional[float] = None) -> Optional[Dict]:
        if not self.is_monitoring():
            self.start_monitoring(timeout=self._cfg.monitor_timeout)
        self._result_event.wait(timeout=timeout)
        # The analysis callback sets the event before the monitor is returned.
        # Stop/cancel all helper threads before handing control back to main;
        # this makes a completed result the terminal operation of the app.
        result = self._result
        self.stop_monitoring()
        if result is None:
            return self._unknown("no result (monitor stopped or timeout)")
        return result

    def analyze_current_screen(self) -> Dict[str, Any]:
        frame = self._capture_frame()
        if frame is None:
            return self._unknown("capture failed")
        return self.analyze_image(frame)

    def analyze_image(self, frame: np.ndarray) -> Dict[str, Any]:
        frame = np.asarray(frame)
        if frame.ndim != 3 or frame.shape[2] < 3:
            raise ValueError("frame must be (H, W, 3) RGB array")
        frame = frame[:, :, :3].astype(np.uint8, copy=False)
        with self._analysis_lock:
            return self._analyze_locked(frame)

    def analyze_file(self, path: str) -> Dict[str, Any]:
        frame = icon_finder.load_png(path)
        if frame is None:
            raise ValueError(f"cannot load image: {path}")
        return self.analyze_image(frame)

    def is_score_screen(self, frame: Optional[np.ndarray] = None) -> bool:
        if frame is None:
            frame = self._capture_frame()
            if frame is None:
                return False
        h, w = frame.shape[:2]
        for name in self._cfg.required_screen_templates:
            tpl = self._template(name, scale=self._cfg.scale_for(w, h))
            if tpl is None:
                continue
            roi = self._screen_template_roi(name, w, h)
            threshold = self._cfg.screen_template_thresholds.get(name, 0.65)
            hits = icon_finder.find_template(
                frame, tpl, roi, threshold,
                nms_distance=max(4, tpl.shape[1] / 2))
            if not hits:
                return False
        return True

    # ------------------------------------------------------------------
    # Внутренности
    # ------------------------------------------------------------------
    def _screen_template_roi(self, name, w, h):
        if name == "fortress":
            return self._cfg.roi_pixels(self._cfg.fortress_roi, w, h)
        if name == "score_marker":
            return self._cfg.roi_pixels(self._cfg.score_marker_roi, w, h)
        return None

    def _template(self, name, scale=1.0):
        if name in self._templates:
            return self._templates[name]
        fname = TEMPLATE_FILES.get(name)
        if not fname:
            return None
        path = TEMPLATES_DIR / fname
        tpl = icon_finder.load_png(str(path))
        if tpl is None:
            return None
        if scale != 1.0:
            box = max(6, int(min(tpl.shape[:2]) * scale))
            tpl = icon_finder.resize_image(
                tpl, box, int(box * tpl.shape[1] / tpl.shape[0]))
        self._templates[name] = tpl
        return tpl

    def _analyze_locked(self, frame):
        """Анализ одного готового кадра (статичный путь, без кликов)."""
        icons = self._detect_all_icons(frame)
        result = self._match_icons_to_players(frame, icons)
        result["raw_data"]["score_screen_detected"] = self.is_score_screen(frame)
        return result

    def _capture_frame(self):
        try:
            frame = self._capture()
        except Exception as exc:  # noqa: BLE001
            frame = None
            self._capture_fail_reason = str(exc)
        if frame is None:
            return None
        frame = np.asarray(frame)
        if frame.ndim == 2:
            frame = np.stack([frame] * 3, axis=-1)
        if frame.shape[2] < 3:
            return None
        frame = frame[:, :, :3].astype(np.uint8, copy=False)
        if self._screen_resolution is None:
            self._screen_resolution = (frame.shape[1], frame.shape[0])
        return frame

    def _on_score_screen_cb(self):
        log.info("score screen detected — analysing")
        # Дать внешнему коду (main.py) возможность заблокировать физический
        # ввод на время кликов по вкладкам/слотам.
        cb = self.on_score_screen_detected
        if cb:
            try:
                cb()
            except Exception:  # noqa: BLE001
                log.exception("on_score_screen_detected callback failed")
        try:
            self._analyze_score_screen()
        except Exception as exc:  # noqa: BLE001
            log.exception("analysis failed")
            self._result = self._unknown(f"analysis exception: {exc}")
            self._result_event.set()
            fb = self.on_analysis_finished
            if fb:
                try:
                    fb()
                except Exception:  # noqa: BLE001
                    log.exception("on_analysis_finished callback failed")

    def _on_monitor_timeout_cb(self):
        log.warning("score screen not detected before timeout — TIMEOUT")
        self._result = self._unknown("score screen not detected (timeout)")
        self._result_event.set()

    def _analyze_score_screen(self):
        """Анализ экрана статистики со СТОРОЖЕВЫМ ЦИКЛОМ (проблема 3).

        Проблема: пользователь может успеть нажать «Пропустить» ДО блокировки
        ввода (окно ~0.3–1.5с после появления статистики). Тогда анимация
        заканчивается, и НАШ клик «Пропустить» в ту же точку попадает по
        «Далее» — мы улетаем на экран «Статистика», а анализировать нужно
        график.

        Решение (A+B):
          * «Пропустить» жмём, но СРАЗУ после клика проверяем маркер
            «Статистики» (_tools/Маркер статистики.jpg); если мы там — жмём
            «Назад» (back_button_frac) и возвращаемся на график;
          * перед каждым анализом и на каждой итерации ожидания кадра
            сверяемся с маркером «Статистики» и повторяем возврат, пока не
            окажемся на графике (подтверждение графика — is_score_screen:
            fortress_icon + score_screen_marker).
        """
        try:
            # «Пропустить» ускоряет отрисовку вкладок (иначе ~15с).
            if self._cfg.click_skip:
                self._click_skip()

            # Страховка: если после клика мы на «Статистике» — «Назад».
            recovered = self._recover_if_on_stats_screen()
            if self._cfg.click_score_tab:
                if recovered:
                    time.sleep(self._cfg.tab_settle)
                self._click_score_tab()

            # Ждём стабильный кадр ГРАФИКА (не «Статистику», не чёрный кадр).
            frame = None
            deadline = time.monotonic() + self._cfg.analysis_timeout
            while time.monotonic() < deadline:
                # 1) сторожевой маркер: мы на «Статистике» -> «Назад», повтор.
                if self._on_stats_screen():
                    log.info("на экране «Статистика» — жму «Назад», возврат на график")
                    self._click_back()
                    continue
                # 2) ждём не-чёрный кадр графика статистики.
                f = self._capture_frame()
                if f is None or _is_black_frame(f):
                    time.sleep(self._cfg.analysis_retry_delay)
                    continue
                if not self.is_score_screen(f):
                    time.sleep(self._cfg.analysis_retry_delay)
                    continue
                frame = f
                break
            if frame is None:
                self._result = self._unknown("no valid frame (chart screen)")
                self._result_event.set()
                return

            icons = self._detect_all_icons(frame)
            result = self._match_icons_to_players(frame, icons)
            result["raw_data"]["score_screen_detected"] = True
            self._result = result
            self._result_event.set()

            cb = getattr(self, "_on_result_callback", None)
            if cb:
                try:
                    cb(result)
                except Exception:  # noqa: BLE001
                    log.exception("on_result_callback failed")
        finally:
            # Разблокировать ввод после анализа (внешний код залочил его в
            # on_score_screen_detected). Гарантированно и на успехе, и при
            # «no valid frame».
            fb = self.on_analysis_finished
            if fb:
                try:
                    fb()
                except Exception:  # noqa: BLE001
                    log.exception("on_analysis_finished callback failed")

    def _stats_marker_template(self):
        """Загрузить маркер «Статистики» (кэшируется). None, если не задан."""
        if self._stats_marker_cache is not None:
            return self._stats_marker_cache
        path = self._cfg.stats_marker_path
        tpl = None
        if path and os.path.exists(path):
            tpl = icon_finder.load_png(path)
        self._stats_marker_cache = tpl
        return tpl

    def _on_stats_screen(self, frame=None):
        """True, если текущий кадр — экран «Статистика» (а не график).

        Определяется по маркеру «Статистики» (_tools/Маркер статистики.jpg):
        NCC ~0.999 на «Статистике», <=0.73 на графике/лобби, порог 0.85.
        """
        if frame is None:
            frame = self._capture_frame()
            if frame is None:
                return False
        h, w = frame.shape[:2]
        tpl = self._stats_marker_template()
        if tpl is None:
            return False
        scale = self._cfg.scale_for(w, h)
        th = max(4, int(round(tpl.shape[0] * scale)))
        tw = max(4, int(round(tpl.shape[1] * scale)))
        t = icon_finder.resize_image(tpl, tw, th)
        roi = self._cfg.roi_pixels(self._cfg.stats_marker_roi, w, h)
        hits = icon_finder.find_template(
            frame, t, roi, self._cfg.stats_marker_threshold,
            nms_distance=max(4, t.shape[1] / 2))
        return bool(hits)

    def _click_back(self):
        """Клик по кнопке «Назад» на экране «Статистика» (возврат на график)."""
        try:
            vp = self._viewport()
            if not vp:
                self._log_no_viewport("back")
                return
            left, top, W, H = vp
            fx, fy = self._cfg.back_button_frac
            self._click(left + int(fx * W), top + int(fy * H))
            log.info("clicked 'Назад'")
            time.sleep(self._cfg.tab_settle)
        except Exception:  # noqa: BLE001
            log.exception("_click_back failed")

    def _recover_if_on_stats_screen(self):
        """Если мы на «Статистике» (клик ушёл в «Далее») — вернуться «Назад».

        Возвращает True, если пришлось восстанавливаться.
        """
        if not self._on_stats_screen():
            return False
        log.info("обнаружен экран «Статистика» (клик «Пропустить» ушёл в "
                 "«Далее») — жму «Назад»")
        self._click_back()
        return True

    def _detect_all_icons(self, frame):
        """Найти все иконки победы/поражения в области графика."""
        h, w = frame.shape[:2]
        scale = self._cfg.scale_for(w, h)
        coin = self._template("victory", scale)
        flame = self._template("defeat", scale)
        roi = self._cfg.roi_pixels(self._cfg.chart_roi, w, h)

        icons = []
        for kind, tpl in (("victory", coin), ("defeat", flame)):
            if tpl is None:
                continue
            for cx, cy, score in icon_finder.find_template(
                    frame, tpl, roi, self._cfg.icon_threshold,
                    self._cfg.icon_nms_distance * scale):
                icons.append({"kind": kind, "cx": cx, "cy": cy,
                              "score": round(float(score), 3),
                              "player": None, "color_side": None})

        # Fallback: если в chart_roi пусто — искать шире.
        if (self._cfg.full_screen_icon_fallback and not icons):
            roi2 = self._cfg.roi_pixels(self._cfg.icon_fallback_roi, w, h)
            for kind, tpl in (("victory", coin), ("defeat", flame)):
                if tpl is None:
                    continue
                for cx, cy, score in icon_finder.find_template(
                        frame, tpl, roi2, self._cfg.icon_threshold,
                        self._cfg.icon_nms_distance * scale):
                    icons.append({"kind": kind, "cx": cx, "cy": cy,
                                  "score": round(float(score), 3),
                                  "player": None, "color_side": None})

        # Дедупликация по близости (coin/flame в одной точке — берём выше score).
        icons.sort(key=lambda i: -i["score"])
        dedup = []
        for ic in icons:
            if all((ic["cx"] - d["cx"]) ** 2 + (ic["cy"] - d["cy"]) ** 2
                   > (self._cfg.icon_nms_distance) ** 2 for d in dedup):
                dedup.append(ic)
        return dedup

    def _match_icons_to_players(self, frame, icons):
        """Сопоставить иконки с игроками.

        Два пути:
          1. click-highlight (живой прогон): кликаем по каждому слоту, его
             линия становится яркой; ищем ЯРКУЮ линию ЗАДАННОГО цвета (цвета
             игрока) и смотрим, к какой иконке она приходит — это самый
             надёжный способ (цвет известен заранее).
          2. static fallback (офлайн/настройка): пишем цвет линии слева от
             каждой иконки и сопоставляем с известными цветами игроков.
        """
        base_frame = frame
        assignments = []
        log_vivid = []

        # --- Путь 1: клик по слотам для подсветки ----------------------
        if (self._cfg.click_slots and self._click is not None
                and self._viewport() is not None):
            assignments, surrendered = self._match_by_highlight(
                frame, icons, log_vivid)
            result = player_matcher.build_result(self.players, assignments,
                                                 raw={},
                                                 surrendered=surrendered)
            result["raw_data"]["icons"] = assignments
            result["raw_data"]["highlight_assignments"] = log_vivid
            result["raw_data"]["surrendered_slots"] = surrendered
            result["raw_data"]["click_slots"] = True
            if self._cfg.debug:
                self._save_debug(base_frame, assignments, result)
            return result

        # --- Путь 2: статичный кадр (без кликов) -----------------------
        assignments, log_static = self._match_by_static_lines(base_frame, icons)

        result = player_matcher.build_result(self.players, assignments, raw={})
        result["raw_data"]["icons"] = assignments
        result["raw_data"]["highlight_assignments"] = log_vivid
        result["raw_data"]["static_assignments"] = log_static
        result["raw_data"]["click_slots"] = False
        if self._cfg.debug:
            self._save_debug(base_frame, assignments, result)
        return result

    def _match_by_static_lines(self, frame, icons):
        """Путь 2: статичный кадр БЕЗ кликов по слотам.

        Для каждого игрока ищем правый конец его линии (по известному цвету)
        и сопоставляем его с ближайшей иконкой. Это тот же приём, что и
        click-highlight, но без переключения слота: при обычном экране
        «Счёт» линии остаются приглушёнными, поэтому bright_only=False.

        Returns:
            (assignments, log_entries).
        """
        resolved = {}       # index иконки (по (cx,cy)) -> player idx
        log_static = []
        max_x_gap = 80.0
        max_y_gap = 60.0

        findings = []       # (player_idx, icon, dist)
        for idx, p in enumerate(self.players):
            color = p.get("color")
            if not color:
                continue
            x_end, y_end, _ = color_analyzer.find_highlighted_line_endpoint(
                frame, color, self._cfg, exclude_icons=icons,
                near_icons=icons, y_band=55.0, bright_only=False)
            if x_end is None:
                continue
            for ic in icons:
                dx = abs(float(ic["cx"]) - x_end)
                dy = abs(float(ic["cy"]) - y_end)
                if dx <= max_x_gap and dy <= max_y_gap:
                    dist = float(np.hypot(x_end - ic["cx"], y_end - ic["cy"]))
                    findings.append((dist, idx, ic))
                    log_static.append((color, p.get("slot"),
                                       ic["kind"], x_end, y_end,
                                       round(dist, 1)))

        # Каждую иконку берёт самый близкий к ней игрок.
        findings.sort(key=lambda f: f[0])
        for dist, idx, ic in findings:
            key = (ic["cx"], ic["cy"])
            if key in resolved:
                continue
            resolved[key] = idx

        assignments = []
        for ic in icons:
            key = (ic["cx"], ic["cy"])
            idx = resolved.get(key)
            assignments.append({
                "kind": ic["kind"], "cx": ic["cx"], "cy": ic["cy"],
                "score": ic["score"], "player": idx,
                "color_side": self.players[idx].get("color")
                if idx is not None else None,
            })
        return assignments, log_static

    def _match_by_highlight(self, frame, icons, log_vivid):
        """Путь 1: клики по слотам «Рейтинга» + яркая линия.

        Регламент пользователя (железно):
          * слот 1 активирован по умолчанию — его НЕ кликаем;
            точка = конец его яркой линии;
          * victory-иконка  -> этот игрок победил (нашли команду-победителя);
          * defeat-иконка   -> кликаем СЛЕДУЮЩИЙ слот 2..8, повторяем;
          * ни victory, ни defeat (линия не дошла до иконки / нет яркой
            линии) -> игрок сдался: побеждает игрок на стороне соперника,
            команда сдавшегося проигрывает.

        Returns:
            (icon_assignments, surrendered_idx).
        """
        base_frame = frame
        resolved = {}             # slot -> {"kind", "icon", "dist", "color"}
        surrendered_slots = set() # слоты: линия не дошла до marker
        winner_slot = None        # слот, чья линия дошла до victory
        max_x_gap = 80.0
        # A highlighted line may be hidden under the marker halo by up to
        # this many pixels; do not accept a distant crossing as a marker.
        max_y_gap = 60.0

        slots = [1] + sorted({p.get("slot", 1) for p in self.players
                              if p.get("slot", 1) > 1})
        stop_scanning = False
        for slot in slots:
            if winner_slot is not None or stop_scanning:
                # Победитель уже найден (или зафиксирована сдача) — больше
                # НИ ОДИН слот не опрашиваем и НЕ кликаем.
                break
            color = None
            p_slot = self._player_by_slot(slot)
            if p_slot is not None:
                color = p_slot.get("color")
            if not color:
                log.warning("slot %d has no color — skip", slot)
                continue
            if slot != 1:
                clicked = self._click_slot(slot)
                if not clicked:
                    log.warning("click for slot %d (%s) FAILED — line "
                                "stays dim, will likely be SURRENDER",
                                slot, color)
            f = self._capture_frame()
            if f is None:
                f = base_frame

            # Obtain the endpoint from the saturated-line mask.  The
            # selected slot is expected to remain bright after the click;
            # dim references are not used by this live path.
            x_end, y_end, _pixels = color_analyzer.find_highlighted_line_endpoint(
                f, color, self._cfg, exclude_icons=icons, near_icons=icons,
                max_x=None,
                y_band=55.0, bright_only=True)
            # The endpoint finder is a saturated-line probe.  Resolve only
            # an icon physically close to its endpoint in both axes.
            if x_end is not None:
                candidates = []
                for ic in icons:
                    dx = abs(float(ic["cx"]) - x_end)
                    dy = abs(float(ic["cy"]) - y_end)
                    if dx <= max_x_gap and dy <= max_y_gap:
                        candidates.append((dx + 0.35 * dy, dx, dy, ic))
                if candidates:
                    _score, _dx, _dy, ic = min(candidates, key=lambda v: v[:3])
                    dist = float(np.hypot(x_end - ic["cx"], y_end - ic["cy"]))
                    resolved[slot] = {"kind": ic["kind"], "icon": ic,
                                      "dist": dist, "color": color}
                    log_vivid.append(
                        (color, slot, ic["kind"], x_end, y_end, round(dist, 1)))
                    if ic["kind"] == "victory":
                        winner_slot = slot
                        # Победитель найден — останавливаемся сразу, слоты
                        # 2..8 НЕ кликаем и даже не добавляем как surrendered.
                        stop_scanning = True
                        break
                    # defeat-иконка: по регламенту кликаем следующий слот.
                else:
                    surrendered_slots.add(slot)
                    log_vivid.append(
                        (color, slot, "SURRENDER", x_end, y_end, None))
                    # No marker: this is the explicit surrender signal.
                    # Do not probe later slots after it.
                    stop_scanning = True
                if stop_scanning:
                    break
            else:
                # Яркой линии не нашли вообще — считаем сдачей.
                surrendered_slots.add(slot)
                log.warning("could not find bright %s line at slot %d — "
                            "SURRENDER", color, slot)
                break

        # Собираем assignments: каждая иконка -> слот, который к ней привязан.
        assignments = []
        for ic in icons:
            slot_owner = None
            for slot, info in resolved.items():
                if (info["icon"]["cx"] == ic["cx"]
                        and info["icon"]["cy"] == ic["cy"]):
                    slot_owner = slot
                    break
            if slot_owner is not None:
                p = self._player_by_slot(slot_owner)
                assignments.append({
                    "kind": ic["kind"], "cx": ic["cx"], "cy": ic["cy"],
                    "score": ic["score"], "player": self.players.index(p),
                    "color_side": p.get("color"),
                })
            else:
                assignments.append({
                    "kind": ic["kind"], "cx": ic["cx"], "cy": ic["cy"],
                    "score": ic["score"], "player": None, "color_side": None,
                })

        # Слоты-«сдавшиеся» превращаем в индексы игроков (для build_result).
        surrendered_idx = []
        for s in sorted(surrendered_slots):
            p = self._player_by_slot(s)
            if p is not None and p in self.players:
                surrendered_idx.append(self.players.index(p))
        return assignments, surrendered_idx

    def _icon_to_player_index(self, frame, icon):
        """Статичный путь: определить цвет линии у иконки -> индекс игрока."""
        cx = int(icon["cx"])
        cy = int(icon["cy"])
        res = color_analyzer.analyze_line_at_icon(
            frame, cx, cy, self.players, self._cfg,
            scale=self._cfg.scale_for(frame.shape[1], frame.shape[0]))
        return res.get("player")

    def _player_by_slot(self, slot):
        for p in self.players:
            if p.get("slot") == slot:
                return p
        return self._player_by_index(0)

    def _player_by_index(self, idx):
        return self.players[idx] if 0 <= idx < len(self.players) else self.players[0]

    # --- клики ---------------------------------------------------------
    def _click_slot(self, slot):
        """Кликнуть по слоту в «Рейтинге», чтобы подсветить его линию.

        Возвращает True, если клик был выполнен (даже если viewport == None
        — это будет видно из warnings, но без падения). Возвращает False,
        если клик НЕ МОГ быть выполнен (нет viewport/нет координат).
        """
        try:
            vp = self._viewport()
            if not vp:
                self._log_no_viewport(f"slot {slot}")
                return False
            left, top, W, H = vp
            pos = self._cfg.rating_slot_frac.get(slot)
            if not pos:
                log.warning("slot %d has no rating_slot_frac coord", slot)
                return False
            x = left + int(pos[0] * W)
            y = top + int(pos[1] * H)
            if self._click is None:
                log.warning("slot %d: no click callable", slot)
                return False
            self._click(x, y)
            time.sleep(self._cfg.slot_settle)
            log.info("clicked rating slot %d @(%d,%d)", slot, x, y)
            return True
        except Exception:  # noqa: BLE001
            log.exception("_click_slot(%d) failed", slot)
            return False

    def _click_skip(self):
        """Клик по «Пропустить» на экране заставки."""
        try:
            vp = self._viewport()
            if not vp:
                self._log_no_viewport("skip")
                return
            left, top, W, H = vp
            fx, fy = self._cfg.skip_button_frac
            self._click(left + int(fx * W), top + int(fy * H))
            log.info("clicked 'Пропустить'")
            time.sleep(self._cfg.tab_settle)
        except Exception:  # noqa: BLE001
            log.exception("_click_skip failed")

    def _click_score_tab(self):
        """Клик по вкладке «Счёт»."""
        try:
            vp = self._viewport()
            if not vp:
                self._log_no_viewport("score tab")
                return
            left, top, W, H = vp
            fx0, fy0, fx1, fy1 = self._cfg.score_tab_roi
            x = left + int((fx0 + fx1) / 2 * W)
            y = top + int((fy0 + fy1) / 2 * H)
            for i in range(2):
                self._click(x, y)
                if i == 0 and self._cfg.tab_settle:
                    time.sleep(self._cfg.tab_settle)
            log.info("clicked 'Счёт' tab")
            time.sleep(self._cfg.tab_settle)
        except Exception:  # noqa: BLE001
            log.exception("_click_score_tab failed")

    def _viewport(self):
        try:
            from bridge import navigate as nav
            return nav.viewport()
        except Exception:  # noqa: BLE001
            return None

    def _log_no_viewport(self, what):
        log.warning("cannot click '%s': no viewport", what)

    def _unknown(self, error):
        return {
            "match_status": STATUS_UNKNOWN,
            "winning_team": None, "losing_team": None,
            "winning_team_label": None, "losing_team_label": None,
            "winners": [], "losers": [], "unmatched_players": [],
            "raw_data": {"error": error},
        }

    # --- отладка -------------------------------------------------------
    def _save_debug(self, frame, assignments, result):
        os.makedirs(self._cfg.debug_dir, exist_ok=True)
        ts = time.strftime("%Y%m%d_%H%M%S")
        path = os.path.join(self._cfg.debug_dir, f"frame_{ts}.png")
        vis = frame.copy()
        for ic in assignments:
            cx, cy = int(ic["cx"]), int(ic["cy"])
            color = (0, 255, 0) if ic["kind"] == "victory" else (0, 0, 255)
            _draw_rect(vis, cx - 20, cy - 20, cx + 20, cy + 20, color)
        icon_finder.save_png(vis, path)
        with open(path.replace(".png", ".json"), "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)


def _draw_rect(img, x0, y0, x1, y1, color, thickness=2):
    h, w = img.shape[:2]
    x0 = max(0, x0); y0 = max(0, y0)
    x1 = min(w - 1, x1); y1 = min(h - 1, y1)
    if x1 <= x0 or y1 <= y0:
        return
    c = np.asarray(color, dtype=np.uint8)
    img[y0:y0 + thickness, x0:x1 + 1] = c
    img[y1 - thickness + 1:y1 + 1, x0:x1 + 1] = c
    img[y0:y1 + 1, x0:x0 + thickness] = c
    img[y0:y1 + 1, x1 - thickness + 1:x1 + 1] = c
