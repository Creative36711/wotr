#!/usr/bin/env python3
"""
Визуальный детект готовности по МАРКЕРУ (маленькому стабильному элементу UI).

ЗАДАЧА:
  Точно понять, что нужный экран уже отрисован (главное меню и т.д.),
  независимо от холодного/тёплого запуска. Таймеры и CPU/диск ненадёжны.

ИДЕЯ (язык- и мод-независимо):
  У кнопок с выпадающим списком есть маленький ТРЕУГОЛЬНИК-индикатор.
  Картинки и названия каждый мод меняет, а этот элемент остаётся неизменным.
  Мы запоминаем этот треугольник как МАРКЕР: маленький кусочек экрана + его
  позиция (в долях окна). Пока маркер не найден на кадре — экран грузится;
  найден — экран готов.

МАРКЕР задаётся через tools/calibrate.py (горячая клавиша F8): курсор наводится
на треугольник, сохраняется:
  * config/menu_marker.npy  — кусочек картинки (numpy);
  * config/menu_marker.json — {"fx":…, "fy":…, "size_frac":…} позиция в долях.

Чтобы маркер работал на ЛЮБОМ разрешении, хранится его размер в долях окна;
при проверке маркер автомасштабируется под текущее разрешение.

МАРКЕРЫ-КАРТИНКИ (JPG/PNG):
  Кроме «квадратного» маркера (calibrate F8) поддерживаются маркеры-картинки —
  обычные файлы .jpg, вырезанные из скриншота нужного экрана (например
  _tools/Маркер локальной сети.jpg). Они ищутся НОРМАЛИЗОВАННОЙ
  кросс-корреляцией (NCC, как в match_result_detector) по всему кадру или в
  заданной зоне (доли окна), что не требует знать точную позицию элемента.

Требует numpy.
"""

import json
import os
import time

import numpy as np

from bridge import navigate as nav

DEFAULT_MATCH = 0.85     # доля совпавших пикселей для признания «готово»
DEFAULT_TOLERANCE = 30   # допуск по каналу (0..255)

# Разрешение, в котором вырезаны маркеры-картинки (_tools/*.jpg).
REFERENCE_RESOLUTION = (1920, 1080)

# Зоны поиска маркеров-картинок на кадре (доли окна x0,y0,x1,y1).
# Маркер «Лок. сеть» снят в ~ (0.059, 0.199) от верхнего левого угла.
LAN_SCREEN_MARKER_ROI = (0.0, 0.12, 0.14, 0.30)
# Маркер «Статистика» снят в ~ (0.080, 0.194).
STATS_SCREEN_MARKER_ROI = (0.02, 0.12, 0.16, 0.30)

# Порог NCC для маркеров-картинок (на своём экране ~0.999, на чужих <=0.73).
IMAGE_MARKER_THRESHOLD = 0.85


def _resize(arr, new_w, new_h):
    """Ресайз nearest-neighbor (для подгонки маркера под разрешение)."""
    if arr.shape[0] == new_h and arr.shape[1] == new_w:
        return arr
    ys = np.round(np.linspace(0, arr.shape[0] - 1, new_h)).astype(int)
    xs = np.round(np.linspace(0, arr.shape[1] - 1, new_w)).astype(int)
    return arr[ys][:, xs]


def _match_ratio(frame, template, tolerance):
    """Доля пикселей, где кадр и шаблон совпадают (в пределах tolerance)."""
    if frame.shape != template.shape:
        return 0.0
    diff = np.abs(frame.astype(np.int16) - template.astype(np.int16))
    close = (diff <= tolerance).all(axis=2)
    return float(close.mean())


def load_marker(npy_path, json_path):
    """Загрузить маркер: (template, meta). Возвращает (None, None) если нет."""
    if not os.path.exists(npy_path) or not os.path.exists(json_path):
        return None, None
    template = np.load(npy_path)
    with open(json_path, encoding="utf-8") as f:
        meta = json.load(f)
    return template, meta


def is_ready(template, meta, match=DEFAULT_MATCH, tolerance=DEFAULT_TOLERANCE):
    """True, если маркер найден на текущем кадре игры."""
    frame = nav.capture_window()
    if frame is None:
        return False
    h, w = frame.shape[:2]

    # Размер области маркера в текущем разрешении (из доли окна).
    box = max(4, int(meta["size_frac"] * min(h, w)))
    t = _resize(template, box, box)

    # Центр области по долям окна.
    cx = int(meta["fx"] * w)
    cy = int(meta["fy"] * h)
    x0 = max(0, cx - box // 2)
    y0 = max(0, cy - box // 2)
    region = frame[y0:y0 + box, x0:x0 + box]

    return _match_ratio(region, t, tolerance) >= match


def wait_ready(template, meta, match=DEFAULT_MATCH, tolerance=DEFAULT_TOLERANCE,
               poll=1.0, timeout=300.0):
    """Ждать, пока маркер не появится на кадре. True = готово, False = таймаут."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if is_ready(template, meta, match, tolerance):
            return True
        time.sleep(poll)
    return False


# ---------------------------------------------------------------------------
# Маркеры-картинки (JPG/PNG) — поиск по NCC (как в match_result_detector).
# ---------------------------------------------------------------------------
def load_marker_image(path):
    """Загрузить маркер-картинку (JPG/PNG) как RGB numpy (H, W, 3).

    Использует загрузчик match_result_detector.icon_finder (cv2 или PIL);
    если оба недоступны — fallback на PIL. Возвращает None, если файла нет
    или он не читается (тогда код просто ждёт по таймеру).
    """
    if not path or not os.path.exists(path):
        return None
    finder = _icon_finder()
    if finder is not None:
        img = finder.load_png(path)
        if img is not None:
            return img
    try:
        from PIL import Image
        with Image.open(path) as im:
            return np.asarray(im.convert("RGB"), dtype=np.uint8)
    except Exception:  # noqa: BLE001 - любой сбой загрузки = маркера нет
        return None


def _icon_finder():
    """match_result_detector.icon_finder (есть numpy-фолбэк) или None."""
    try:
        from match_result_detector import icon_finder
        return icon_finder
    except Exception:  # noqa: BLE001
        return None


def is_image_marker_visible(template, roi_frac=None,
                            threshold=IMAGE_MARKER_THRESHOLD):
    """True, если маркер-картинка найдена на текущем кадре игры.

    Поиск — нормализованная кросс-корреляция (NCC) шаблона по кадру
    (или по зоне roi_frac, доли окна). Шаблон автомасштабируется под
    текущее разрешение (маркеры сняты при REFERENCE_RESOLUTION).
    """
    frame = nav.capture_window()
    if frame is None or template is None:
        return False
    finder = _icon_finder()
    if finder is None:
        return False
    h, w = frame.shape[:2]
    ref_w, ref_h = REFERENCE_RESOLUTION
    scale = min(w / ref_w, h / ref_h)
    th = max(4, int(round(template.shape[0] * scale)))
    tw = max(4, int(round(template.shape[1] * scale)))
    tpl = finder.resize_image(template, tw, th)

    if roi_frac is not None:
        fx0, fy0, fx1, fy1 = roi_frac
        x0 = max(0, int(fx0 * w))
        y0 = max(0, int(fy0 * h))
        x1 = min(w, int(fx1 * w))
        y1 = min(h, int(fy1 * h))
        if x1 - x0 < tw or y1 - y0 < th:
            return False
        region = frame[y0:y1, x0:x1]
    else:
        region = frame
    hits = finder.match_template(region, tpl, threshold)
    return bool(hits)


def wait_image_marker(template, roi_frac=None, threshold=IMAGE_MARKER_THRESHOLD,
                      poll=0.5, timeout=3.0):
    """Ждать появления маркера-картинки на кадре. True = найден, False = таймаут."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if is_image_marker_visible(template, roi_frac, threshold):
            return True
        time.sleep(poll)
    return False
