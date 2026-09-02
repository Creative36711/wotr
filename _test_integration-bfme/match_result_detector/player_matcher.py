#!/usr/bin/env python3
"""
Сопоставление цветов линий с игроками и формирование итогового результата.

Вход — список игроков, у каждого:
    name, color (имя цвета: blue/red/...), team ("good" = добро,
    "evil" = зло), is_local_player, slot (номер слота 1..8).

ЦВЕТА и КОМАНДЫ известны заранее (детерминированное распределение в
bridge/room.py): цвет каждой фракции задан при старте боя, союз
(добро/зло) — из FACTION_ALLIANCES. Поэтому нам НЕ нужно «угадывать» цвета —
мы сопоставляем цвет линии с известным цветом игрока, затем берём его команду.

ЗАДАЧА — КОМАНДА-ПОБЕДИТЕЛЬ:
  * Иконка «Победа» (монета) -> игрок в winners, его команда — победитель.
  * Иконка «Поражение» (вспышка) -> игрок в losers.
  * Если есть хоть одна победа -> COMPLETED; команда-победитель = команда
    любого победителя (в матче всегда ровно 2 команды: добро/зло).
  * Если побед НЕТ (все проиграли / сдались) -> SURRENDER; команда-победитель
    = команда, где НЕТ проигравших (выжившие). Если проигравших тоже нет —
    UNKNOWN (нужна калибровка / не удалось распознать ни одного слота).
"""

import logging
from typing import Dict, List, Optional

log = logging.getLogger("match_detector.matcher")

# Человекочитаемые названия сторон для JSON/лог-а.
TEAM_LABELS = {
    "good": "Добро",
    "evil": "Зло",
}


def _normalize_team(team):
    """Нормализовать команду: старые числа 1/2 -> \"good\"/\"evil\"."""
    if team in (1, "1"):
        return "good"
    if team in (2, "2"):
        return "evil"
    return team


def _player_summary(players, index):
    p = players[index]
    return {
        "name": p.get("name", f"player-{index}"),
        "slot": p.get("slot"),
        "team": _normalize_team(p.get("team")),
        "color": p.get("color"),
        "is_local_player": bool(p.get("is_local_player", False)),
    }


def determine_winning_team(winners, losers, players, surrendered=None):
    """Определить КОМАНДУ-ПОБЕДИТЕЛЯ.

    В матче всегда ровно 2 команды: добро ("good") и зло ("evil").
    Побеждает та команда, у которой есть хотя бы один победитель. Если
    победителей нет — победителем считается команда без проигравших
    (выжившие).

    `surrendered` — индексы игроков, чья линия НЕ дошла ни до одной иконки
    (сдался/вышел). Сдавшийся проигрывает, поэтому считается «проигравшим».

    Returns:
        (winning_team, losing_team, status).
        status: "COMPLETED" / "SURRENDER" / "UNKNOWN".
    """
    teams = {_normalize_team(p.get("team")) for p in players}
    teams.discard(None)

    winner_teams = {_normalize_team(w["team"]) for w in winners
                    if w.get("team") is not None}
    # Проигравшие = те, у кого вспышка поражения + сдавшиеся (линия без иконки).
    loser_teams = {_normalize_team(l["team"]) for l in losers
                   if l.get("team") is not None}
    for idx in (surrendered or []):
        if 0 <= idx < len(players):
            t = _normalize_team(players[idx].get("team"))
            if t is not None:
                loser_teams.add(t)

    # Хотя бы одна победа -> команда победителя.
    if winner_teams:
        # В матче РОВНО 2 команды (добро/зло), поэтому победить может только
        # одна. Если монетки найдены у игроков ОБЕИХ команд — это ошибка
        # цветового матчинга (ложные привязки). Побеждает команда, у которой
        # монеток БОЛЬШЕ; при равенстве — результат неоднозначен (UNKNOWN),
        # чтобы не выдавать ложный вердикт.
        counts = {t: sum(1 for w in winners
                         if _normalize_team(w["team"]) == t)
                  for t in winner_teams}
        max_count = max(counts.values())
        tops = [t for t, c in counts.items() if c == max_count]
        if len(tops) != 1:
            log.warning("ambiguous winner teams %s (counts=%s) — UNKNOWN",
                        tops, counts)
            return None, None, "UNKNOWN"
        winning_team = tops[0]
        remaining = [t for t in teams if t != winning_team]
        losing_team = remaining[0] if len(remaining) == 1 else None
        return winning_team, losing_team, "COMPLETED"

    # Побед нет: только поражения (или ничего). Это сдача/выход.
    # Выжившие = команда без проигравших (если проигравших нет вообще —
    # неоднозначно).
    if loser_teams and len(teams) == 2:
        maybe_survivor = [t for t in teams if t not in loser_teams]
        if len(maybe_survivor) == 1:
            winning_team = maybe_survivor[0]
            losing_team = next(iter(loser_teams))
            return winning_team, losing_team, "SURRENDER"
    # Неоднозначно / нечего классифицировать.
    return None, None, "UNKNOWN"


def build_result(players, icon_assignments, raw=None, surrendered=None):
    """Собрать итоговый результат матча из привязок иконок к игрокам.

    Args:
        players: список игроков (порядок фиксирован; slot 1 = игрок).
        icon_assignments: список dict по иконкам:
            {"kind": "victory"/"defeat", "cx":..., "cy":..., "score":...,
             "player": индекс игрока или None}.
        raw: дополнительные данные raw_data.
        surrendered: список индексов игроков, чья линия НЕ дошла до иконки
            (сдался/вышел). Такие игроки считаются проигравшими.

    Returns:
        dict в формате match_result.json.
    """
    raw = dict(raw or {})
    icons = [dict(i) for i in icon_assignments]

    winner_idx = set()
    loser_idx = set()
    surrender_idx = set(surrendered or [])
    for icon in icons:
        p = icon.get("player")
        if p is None:
            continue
        if icon["kind"] == "victory":
            winner_idx.add(p)
        elif icon["kind"] == "defeat":
            loser_idx.add(p)
    # Защита от конфликта: один игрок не может быть и победителем, и
    # проигравшим (ложная иконка). Снимаем с обеих сторон.
    conflicts = winner_idx & loser_idx
    if conflicts:
        log.warning("conflicting icon assignments for players %s — removed",
                    [players[i].get("name") for i in sorted(conflicts)])
        winner_idx -= conflicts
        loser_idx -= conflicts
        raw.setdefault("conflicts", []).extend(
            {"player_index": i, "name": players[i].get("name")}
            for i in sorted(conflicts))

    # Сдавшиеся — проигравшие. Не должны одновременно числиться победителями.
    surrender_idx -= winner_idx
    loser_idx |= surrender_idx

    winners = [_player_summary(players, i) for i in sorted(winner_idx)]
    losers = [_player_summary(players, i) for i in sorted(loser_idx)]

    winning_team, losing_team, status = determine_winning_team(
        winners, losers, players, surrendered=sorted(surrender_idx))

    matched = winner_idx | loser_idx
    unmatched = [i for i in range(len(players)) if i not in matched]

    # Отметить сдавшихся в списке проигравших.
    loser_summaries = []
    for i in sorted(loser_idx):
        s = _player_summary(players, i)
        s["surrendered"] = i in surrender_idx
        loser_summaries.append(s)

    result = {
        "match_status": status,
        "winning_team": winning_team,
        "losing_team": losing_team,
        "winning_team_label": TEAM_LABELS.get(winning_team or ""),
        "losing_team_label": TEAM_LABELS.get(losing_team or ""),
        "winners": winners,
        "losers": loser_summaries,
        "unmatched_players": [_player_summary(players, i) for i in unmatched],
        "raw_data": {
            "victory_icons_found": len(winner_idx),
            "defeat_icons_found": len(loser_idx) - len(surrender_idx),
            "surrendered_found": len(surrender_idx),
            "icons": [
                {
                    "kind": i.get("kind"),
                    "cx": i.get("cx"),
                    "cy": i.get("cy"),
                    "score": round(float(i.get("score", 0.0)), 3),
                    "player_index": i.get("player"),
                    "player": (players[i["player"]].get("name")
                               if i.get("player") is not None else None),
                    "color_side": i.get("color_side"),
                }
                for i in icons
            ],
        },
    }
    result["raw_data"].update(raw)
    return result