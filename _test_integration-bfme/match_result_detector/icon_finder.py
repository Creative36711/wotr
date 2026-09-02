#!/usr/bin/env python3
"""
Поиск иконок и шаблонов на кадре: template matching + Non-Maximum Suppression.

Основной бэкенд — OpenCV (cv2.matchTemplate, TM_CCOEFF_NORMED). Если OpenCV
не установлен, используется встроенный fallback на NumPy (нормализованная
кросс-корреляция через FFT), чтобы модуль работал и в минимальном окружении
(проект требует только numpy).

Результаты обоих бэкендов сведены к одинаковому формату:
    (x, y, score)   — x, y = ЦЕНТР совпадения, score 0..1
"""

import os

import numpy as np

try:  # pragma: no cover - наличие OpenCV зависит от окружения
    import cv2
except Exception:  # noqa: BLE001 - любой сбой импорта = нет OpenCV
    cv2 = None

# Принудительно отключить OpenCV (для теста numpy-fallback).
FORCE_NUMPY = os.environ.get("MATCH_DETECTOR_FORCE_NUMPY", "") == "1"

_USE_CV2 = cv2 is not None and not FORCE_NUMPY


# ---------------------------------------------------------------------------
# Вспомогательные изображения
# ---------------------------------------------------------------------------
def resize_image(image, new_w, new_h):
    """Масштабировать изображение (H, W[, C]) uint8 → (new_h, new_w[, C])."""
    if image.shape[1] == new_w and image.shape[0] == new_h:
        return image
    if _USE_CV2:
        interp = cv2.INTER_AREA if new_h < image.shape[0] else cv2.INTER_LINEAR
        return cv2.resize(image, (new_w, new_h), interpolation=interp)
    # Nearest-neighbor — достаточно для масштабирования шаблонов (±15%).
    ys = np.round(np.linspace(0, image.shape[0] - 1, new_h)).astype(int)
    xs = np.round(np.linspace(0, image.shape[1] - 1, new_w)).astype(int)
    return image[ys][:, xs]


def load_png(path):
    """Загрузить PNG/JPEG как RGB numpy (H, W, 3) без обязательного PIL."""
    if _USE_CV2:
        bgr = cv2.imread(str(path), cv2.IMREAD_COLOR)
        if bgr is None:
            return None
        return bgr[:, :, ::-1].copy()
    try:
        from PIL import Image
        with Image.open(path) as im:
            return np.asarray(im.convert("RGB"), dtype=np.uint8)
    except Exception:  # noqa: BLE001
        return None


# ---------------------------------------------------------------------------
# Template matching
# ---------------------------------------------------------------------------
def _corr_fft(image, kernel):
    """Полная перекрёстная корреляция image с kernel через FFT (numpy fallback)."""
    h, w = image.shape
    kh, kw = kernel.shape
    fh, fw = h + kh - 1, w + kw - 1
    image = np.asarray(image, dtype=np.float32)
    kernel = np.asarray(kernel, dtype=np.float32)
    i_f = np.fft.rfft2(image, s=(fh, fw))
    k_f = np.fft.rfft2(kernel[::-1, ::-1], s=(fh, fw))
    conv = np.fft.irfft2(i_f * k_f, s=(fh, fw))
    return conv[kh - 1:kh - 1 + (h - kh + 1),
                kw - 1:kw - 1 + (w - kw + 1)]


def _is_gray_template(templ):
    """True, если шаблон практически серый (каналы близки)."""
    if templ.ndim == 2:
        return True
    mean_c = templ.reshape(-1, 3).mean(axis=0)
    return float(mean_c.max() - mean_c.min()) < 20.0


def _luma(image):
    if image.ndim == 2:
        return image
    return image.astype(np.float32).mean(axis=2).astype(np.uint8)


def _ncc_2d(image, templ, threshold):
    """Нормализованная кросс-корреляция для ОДНОГО канала (float32)."""
    ih, iw = image.shape
    th, tw = templ.shape
    oh, ow = ih - th + 1, iw - tw + 1
    n = float(th * tw)
    ones = np.ones((th, tw), dtype=np.float32)
    t_hat = templ - templ.mean()
    num = _corr_fft(image, t_hat)
    var_t = float((t_hat ** 2).sum())
    s1 = _corr_fft(image, ones)
    s2 = _corr_fft(image * image, ones)
    var_i = np.maximum(s2 - (s1 * s1) / n, 0.0)
    denom = np.sqrt(var_i * var_t)
    with np.errstate(divide="ignore", invalid="ignore"):
        scores = np.where(denom > 1e-9, num / denom, 0.0)
    hits = np.argwhere(scores >= threshold)
    return [(int(x), int(y), float(scores[y, x])) for y, x in hits]


def match_template_numpy(image, templ, threshold):
    """Numpy-fallback cv2.matchTemplate(TM_CCOEFF_NORMED)."""
    ih, iw = image.shape[:2]
    th, tw = templ.shape[:2]
    if ih < th or iw < tw:
        return []

    if _is_gray_template(templ):
        return _ncc_2d(_luma(image).astype(np.float32),
                       _luma(templ).astype(np.float32), threshold)

    if image.ndim == 2:
        image = np.stack([image] * 3, axis=-1)
    if templ.ndim == 2:
        templ = np.stack([templ] * 3, axis=-1)

    t = templ.astype(np.float32)
    n = float(th * tw)
    ones = np.ones((th, tw), dtype=np.float32)
    oh, ow = ih - th + 1, iw - tw + 1

    num = np.zeros((oh, ow), dtype=np.float32)
    var_t = 0.0
    var_i = np.zeros((oh, ow), dtype=np.float32)
    for c in range(3):
        im_c = image[:, :, c].astype(np.float32)
        t_c = t[:, :, c]
        t_hat = t_c - t_c.mean()
        num += _corr_fft(im_c, t_hat)
        var_t += float((t_hat ** 2).sum())
        s1 = _corr_fft(im_c, ones)
        s2 = _corr_fft(im_c * im_c, ones)
        var_i += np.maximum(s2 - (s1 * s1) / n, 0.0)

    denom = np.sqrt(var_i * var_t)
    with np.errstate(divide="ignore", invalid="ignore"):
        scores = np.where(denom > 1e-9, num / denom, 0.0)

    hits = np.argwhere(scores >= threshold)
    return [(int(x), int(y), float(scores[y, x])) for y, x in hits]


def match_template(image, templ, threshold):
    """Найти совпадения шаблона на кадре. Возвращает (x, y, score) углы."""
    if _USE_CV2:
        if image.ndim == 2 or templ.ndim == 2:
            res = cv2.matchTemplate(image, templ, cv2.TM_CCOEFF_NORMED)
        else:
            res = cv2.matchTemplate(
                image[:, :, ::-1], templ[:, :, ::-1], cv2.TM_CCOEFF_NORMED)
        loc = np.where(res >= threshold)
        return [(int(x), int(y), float(res[y, x])) for y, x in zip(*loc)]
    return match_template_numpy(image, templ, threshold)


def apply_nms(points, min_distance):
    """Non-Maximum Suppression по точкам (x, y, score)."""
    if not points:
        return []
    ordered = sorted(points, key=lambda p: -p[2])
    kept = []
    for p in ordered:
        x, y = p[0], p[1]
        if all((x - kx) ** 2 + (y - ky) ** 2 >= min_distance ** 2
               for kx, ky, _ in kept):
            kept.append(p)
    return kept


def save_png(img, path):
    """Сохранить изображение в PNG (cv2 -> PIL -> npy fallback)."""
    if _USE_CV2:
        import cv2
        cv2.imwrite(str(path), img[:, :, ::-1])
        return
    try:
        from PIL import Image
        Image.fromarray(img).save(path)
        return
    except Exception:  # noqa: BLE001
        pass
    np.save(str(path) + ".npy", img)


def find_template(frame, templ, roi, threshold, nms_distance):
    """Найти шаблон в прямоугольной области кадра с NMS.

    Args:
        frame: (H, W, 3) uint8 RGB.
        templ: (Kh, Kw, 3) uint8 RGB.
        roi: (x0, y0, x1, y1) в пикселях (None = весь кадр).
        threshold: порог совпадения 0..1.
        nms_distance: мин. дистанция между совпадениями.

    Returns:
        Список (cx, cy, score) — ЦЕНТРЫ совпадений.
    """
    h, w = frame.shape[:2]
    if roi is None:
        x0, y0, x1, y1 = 0, 0, w, h
    else:
        x0, y0, x1, y1 = (int(v) for v in roi)
    x0 = max(0, x0)
    y0 = max(0, y0)
    x1 = min(w, x1)
    y1 = min(h, y1)
    th, tw = templ.shape[:2]
    if x1 - x0 < tw or y1 - y0 < th:
        return []

    region = frame[y0:y1, x0:x1]
    tops = match_template(region, templ, threshold)
    if not tops:
        return []

    # Верхний левый угол -> центр, затем NMS.
    points = [(x + tw / 2.0, y + th / 2.0, s) for x, y, s in tops]
    kept = apply_nms(points, nms_distance)
    return [(round(kx + x0, 1), round(ky + y0, 1), ks)
            for kx, ky, ks in kept]