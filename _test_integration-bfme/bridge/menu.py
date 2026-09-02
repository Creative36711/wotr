#!/usr/bin/env python3
"""
BFME2: RotWK integration — menu navigation steps.

Main menu -> hover «Сеть» -> click «Лок. сеть» -> click «Создать игру».

LANGUAGE-AGNOSTIC: navigation is by POSITION (fractions of the window), not by
reading labels — so Russian/English/German and any mod's renamed strings all
work identically. Coordinates are FRACTIONS of the viewport, so they stay
correct at any resolution.

Positions are stored in menu_positions.json (written by calibrate.py); the
MENU dict below is only a fallback default.
"""

import sys
import time

from bridge import config
from bridge.log import log
from bridge import navigate as nav
from bridge import timings

T = timings.TIMINGS

# Default fallback (fraction of window width, height) — used until you
# calibrate with calibrate.py, which writes menu_positions.json.
MENU = {
    "main.network":      (0.3019, 0.9244),  # «Сеть» в главном меню
    "main.lan":          (0.3000, 0.7811),  # «Лок. сеть» в выпадающем меню
    "lobby.create_game": (0.8337, 0.4611),  # «Создать игру» в лобби
}

def load_positions():
    """Merge calibrated positions (config/menu_positions.json) over the defaults."""
    data = config.load_positions()
    if isinstance(data, dict):
        return {**MENU, **data}
    return dict(MENU)


def _viewport():
    """(l, t, W, H) of the game viewport, or None if the window is gone."""
    hwnd, how = nav.find_window()
    if not hwnd:
        log("ERROR: game window not found", file=sys.stderr)
        return None
    l, t, r, b = nav.get_client_rect(hwnd)   # game viewport, no title bar
    W, H = r - l, b - t
    log(f"[window] found via {how}  viewport=({l},{t})-({r},{b})  size={W}x{H}")
    return l, t, W, H


def goto_lan(network=None, lan=None, hover_delay=None):
    """Hover Network, wait for the dropdown, click Local Network."""
    pos = load_positions()
    vp = _viewport()
    if not vp:
        return False
    l, t, W, H = vp

    net = network or pos.get("main.network") or MENU["main.network"]
    lan = lan or pos.get("main.lan") or MENU["main.lan"]
    hover = hover_delay if hover_delay is not None else T["hover_network"]

    def pt(f):
        return l + int(f[0] * W), t + int(f[1] * H)

    x, y = pt(net)
    log(f"[hover] Network @ ({x},{y})")
    nav.move(x, y)
    time.sleep(hover)          # SAGE expands the dropdown on hover

    x, y = pt(lan)
    log(f"[click] Local Network @ ({x},{y})")
    nav.click(x, y)
    return True


def goto_create_game(create_pos=None):
    """On the LAN lobby screen, click the «Создать игру» (Create Game) button."""
    pos = load_positions()
    vp = _viewport()
    if not vp:
        return False
    l, t, W, H = vp

    p = create_pos or pos.get("lobby.create_game")
    if not p:
        log("ERROR: 'lobby.create_game' not calibrated yet. Run calibrate.py, "
              "reach the LAN lobby, hover the «Создать игру» button and press F3.",
              file=sys.stderr)
        return False
    x = l + int(p[0] * W)
    y = t + int(p[1] * H)
    log(f"[click] Create Game @ ({x},{y})")
    nav.click(x, y)
    return True


if __name__ == "__main__":
    # Nothing to run standalone — the flow is driven by main.py.
    log("This module is driven by main.py. Run `python main.py`.")
