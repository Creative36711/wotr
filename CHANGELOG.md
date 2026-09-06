# История версий — War of the Ring Remaster

Полная история изменений. Актуальная версия приложения — в `README.md` и в
`package.json`; совместимость сохранений определяется версиями данных в
`src/version.ts`.

Коммиты помечены так: `War of the Ring Remaster: <версия> — <кратко>`.

## Обновление 0.51.7

- **Документация переписана.** `README.md` больше не журнал изменений: теперь это описание проекта — идея (стратегия в TypeScript, бой внутри BFME2, мир как данные), устройство хода, модель мира с реальными числами встроенного мода (186 локаций, 24 региона, 8 фракций, 51 локация с поддержкой RTS), пошаговое описание моста в BFME, данные и моды, карта репозитория, сборка и проверка, диагностика, известные ограничения. История версий вынесена в отдельный `CHANGELOG.md`, добавлен `docs/ARCHITECTURE.md` — карта модулей, потоки данных, инварианты, таблица «что править, если нужно изменить X» и список подводных камней.
- **Из документации убраны устаревшие утверждения**, которые противоречили коду: уровни юнитов и героев давно передаются в сгенерированный `zzz_spawn.ini` (не «всегда уровень 1»), сложность стратегического ИИ влияет на поведение (с 0.51.6), BIG-архивы и MapCache встроенного мода вшиты в исполняемый файл, а начало новой кампании удаляет диагностику всех прошлых партий (а не «оставляет три последние папки и всё старше 14 дней»).

## Обновление 0.51.8

- **Порядок в редакторе игровых данных.** Вкладка «Кольцо» держала три несвязанные группы правил; теперь название соответствует содержимому: в «Кольце» осталась только ковка Кольца Всевластья, снабжение армий получило собственную вкладку «Снабжение», а потолки бонусов палантира переехали во вкладку «Интеграция BFME» — рядом с сетевыми правилами про ресурсы и очки командования, потому что это ограничение на то, что получает игра. Заодно переименованы две вкладки, название которых было уже содержимого: «Экономика» → «Экономические типы» (это тип локации: доход, очередь, резерв, обзор, слоты построек и боевые бонусы) и «BFME» → «Интеграция BFME». Поле «Слоты построек» вынесено из раскрывающегося блока «Слоты построек и боевые бонусы владельца» в основную сетку экономического типа — это структурное свойство типа, а не боевой бонус; блок теперь называется «Боевые бонусы владельца».
- **Английский интерфейс больше не наполовину русский.** Локализатор подставляет перевод по точному совпадению строки, а 87 строк редактора, инспектора, модалки конфликта и инструмента координат не имели записи в словаре — в английском интерфейсе они оставались русскими или переводились наполовину («Потеря for hex», «Ring forging Всевластья»). Все добавлены.
- **Новая проверка `node verify/i18n.mjs`** — собирает все статические русские строки из компонентов и прогоняет их через настоящую `translateText()`; падает, если хоть одна остаётся с кириллицей. Сейчас: 308 строк, 0 без перевода.

## Обновление 0.51.9

- **Светлые контролы на тёмном интерфейсе устранены.** В редакторе данных кнопка «Удалить» в шапке карточки (вкладки «Постройки», а также любой другой тип с карточками) не имела своего CSS-правила и рисовалась браузерной — светлой. То же касалось чекбоксов: у `.inline-check` не было `accent-color`, поэтому галочка «Сигнальный огонь» и ещё семь таких же в разделах «Фракции», «Экономические типы», «Постройки», «Кольцо» и «Интеграция BFME» выглядели белыми. Плюс поле «Максимальный уровень» во вкладке «Юниты» оставалось без стиля вовсе. Галочки и радио теперь красятся глобальным правилом `accent-color` — новая галочка нигде не останется белой; кнопка в шапке карточки и поле уровня получили правила в общей палитре.
- **Новая проверка `node verify/styles.mjs`** — рендерит настоящие экраны в jsdom с настоящими таблицами стилей и сравнивает вычисленный стиль каждого контрола с «голым» контролом: совпадение означает, что CSS-правило до него не дошло. Проверяются все 11 вкладок редактора данных и игровые панели с выбранной локацией и армией. Сейчас: 15 экранов, 5335 контролов, 0 без стиля.

## 0.50 — 0.51

## Обновление 0.51.6

- **ИИ учитывает снабжение.** При выборе цели ИИ оценивает, с какими припасами армия придёт: расстояние до цели умножается на потерю за гекс и вычитается из текущего состояния обоза. На **средней** сложности армия не отправляется туда, где придёт с пустыми руками; на **сложной** — предпочитает короткий бросок, после которого останется не меньше половины обоза, и по возможности атакует из подготовленной базы. На **лёгкой** сложности припасы игнорируются — ИИ воюет как раньше. Если целей «с запасом» нет вовсе, ИИ не замирает: на сложной он берёт ту, где припасов останется больше, на средней — ближайшую. Настройки берутся из мира (`supplySettings`), так что моды влияют и на поведение ИИ.


## Обновление 0.51.5

- **Снабжение настраивается в редакторе.** В редакторе мира появился раздел «Снабжение армий»: включение системы, потеря за гекс и за ход, минимальная доля, `supplyRatio`, а также переключатели правил — выдача при формировании, пополнение в начале хода, пополнение на транзите, требование своей точки отправления и учёт захваченной в этом же ходу локации. У построек добавлены поля «Ресурсы / КО / Палантир атакующему отсюда» — это фиксированный бонус выступающей армии (осадный лагерь, разведпост), который не тратится в дороге. Руками в JSON лезть не нужно.


## Обновление 0.51.4

- **Инспектор локации показывает бонусы обеих сторон.** В панели экономики появился блок «Бонусы в битве BFME» с двумя столбцами: **при обороне** (экономический тип, постройки, полный контроль региона, сигнальный огонь, оборона стен, засада) и **при атаке отсюда** — что получит армия, выступившая из этой локации: экономическая часть бонусов, умноженная на `supplyRatio`, плюс полный бонус построек-плацдармов. Локация теперь оценивается и как крепость, и как плацдарм.


## Обновление 0.51.3

- **Снабжение видно на карте.** У каждой своей армии на стратегической карте появилась цветная полоска на маркере: зелёная — 75–100 % припасов, жёлтая — 25–75 %, оранжевая — 1–25 %, серая — армия без снабжения. В подсказке маркера добавлена строка «Снабжение N % из «Ривенделл»». Лезть в инспектор каждой армии больше не нужно: какие армии готовы к дальнему походу, а какие истощены, видно одним взглядом.


## Обновление 0.51.2

- **Снабжение видно в инспекторе армии.** Новый блок «Снабжение» показывает точку отправления и ход, полоску остатка припасов с процентом, пройденные гексы и ходы, а также итоговый бонус, с которым армия пойдёт в атаку (+ресурсы, +КО, +палантир). Без снабжения блок говорит об этом прямо: «Без снабжения — атака без бонусов» с подсказкой, как взять припасы. Цвет рамки и полоски меняется по остатку: зелёный 75–100 %, жёлтый 25–75 %, оранжевый 1–25 %.


## Обновление 0.51.1

- **Снабжение работает и в настоящих битвах BFME.** Раньше контекстные бонусы (стартовые ресурсы, командные очки, палантир, сигнальный огонь) уходили в RTS только владельцу локации: атакующая сторона получала пустой блок и начинала бой без припасов. Теперь атакующей стороне передаются её `attackerModifiers` — то, что армия привезла из точки отправления. Механизм выдачи не менялся: `rts_spawn.rs` уже читает `bonuses` у каждого участника и спавнит ресурсы, командные очки, палантир и сигнальный огонь по сторонам, поэтому защитник и атакующий получают разные суммы в одном бою. Сигнального огня у атакующего не бывает — локационные бонусы в снабжение не входят.


## Обновление 0.51.0

### Снабжение армии и разделение боевых модификаторов

Раньше все контекстные бонусы боя получал только владелец локации: атакующий приходил с голыми руками, и штурм укреплённой позиции требовал подавляющего численного превосходства. Теперь у сторон разные источники бонусов.

- **Защитник** получает бонусы от локации боя, как и раньше: экономический тип, постройки, полный контроль региона, сигнальный огонь, оборона стен, засада.
- **Атакующий** получает бонусы от точки отправления — он принёс подготовку и припасы с собой, и часть их потерял в дороге. Локационные бонусы (сигнальный огонь, оборона стен, засада) ему недоступны: их нельзя принести на чужой гекс.

**Снабжение — свойство армии, а не расчёт в момент битвы.** Армия берёт припасы при формировании и пополняет их на своей локации; дальше они тратятся и на марше, и просто со временем:

```
decayFactor = 1 − hexesTravelled × 0.05 − turnsElapsed × 0.15   (не ниже minRatio)
бонус       = floor(начальные припасы × decayFactor × 0.5)
```

Гексы — расход на марше, ходы — календарное время: даже стоящая под стенами армия съедает запасы. За четыре хода дальнего похода снабжение исчерпывается, поэтому «вывел армию из столицы и двадцать ходов шёл через пустыню» больше не приходит со всеми бонусами родной столицы.

**Когда снабжение пополняется** (полностью, счётчики обнуляются): формирование армии на своей локации, начало хода на своей локации, транзит через свою локацию по исполненному маршруту. Не пополняет: нейтральные и вражеские гексы, а также захваченная в этом же ходу локация — город ещё в хаосе.

**Важно про перехваты:** снабжение считается по исполненному пути, а не по заказанному. Армию перехватили на третьем гексе — припасы потрачены на три гекса.

**Новые постройки** дают фиксированный бонус выступающей армии — без деградации и без потерь при перевозке:

- **Осадный лагерь** (150 золота, 2 хода): +100 стартовых ресурсов и +20 командных очков армии, выступающей отсюда.
- **Разведпост** (100 золота, 1 ход): +2 стартовых очка палантира.

**Разделение и слияние армий.** Подготовка к походу — не мешок зерна, который можно поделить: при переносе отряда принимающая армия получает снабжение, а при слиянии берутся более свежие припасы, но худшие счётчики пути и времени из двух. Разделение армии не обнуляет пройденный путь.

**Вес в автобое:** каждые 100 ресурсов +3 %, каждые 50 командных очков +2 %, каждые 5 очков палантира +2 %, каждый пункт прироста палантира +3 %.

**Настройка моддером** — блок `supplySettings` в world.json: `enabled` (по умолчанию включено), `decayPerHex`, `decayPerTurn`, `minRatio`, `supplyRatio`, `requiresOwnedOrigin`, `captureCountsAsOwned`, `refillOnTransit`, `refillOnTurnStart`, `refillOnFormation`. В старых модах без этого блока действуют значения по умолчанию.

**Диагностика:** в окне конфликта перед боем видно точку отправления, пройденные гексы и ходы, остаток снабжения и итоговый бонус атаки; в `battle.json` уходит полный разбор — `initialAmount`, `afterDecayAndRatio`, `fixedFromBuildings`, `finalAttackerModifiers` и контекст снабжения. События снабжения («пополняет снабжение в …», «припасы исчерпаны») пишутся в `campaign.log`.

**Совместимость:** версия данных мира 45, версия сохранения 62. Старые сохранения несовместимы — как и во всех предыдущих обновлениях, кампанию нужно начинать заново.


## Обновление 0.50.2

- **Заголовок окна — просто «Война за Кольцо»** (`War of the Ring` в английском). Прежний «Война за Кольцо — редактор карты» показывался всегда, даже в кампании, и не менялся; раз он не несёт информации, осталось только название игры.
- **Диагностика боя стала подробной.** Папка боя пополняется тремя новыми источниками:
  - `environment.json` — обстановка игрока: разрешение основного и виртуального экрана, число мониторов, геометрия окна игры (позиция и размер клиентской области), версия приложения, путь к BFME, мод, язык, оконный/полноэкранный режим. Пишется дважды: при старте автоматизации и перед снимком комнаты, когда окно игры уже найдено.
  - `analysis.json` — что именно увидел детектор: размер кадра, масштаб, пороги, состав слотов и все найденные иконки победы/поражения с координатами и оценкой совпадения.
  - `automation.log` — координаты каждого клика по слоту рейтинга (пиксели окна, доля окна, размер окна), конец найденной линии для каждого слота и три ближайших кандидата-иконки с оценками. Случай «вместо цвета нажалась фора» теперь разбирается по числам, а не на глаз.
- **«Ступор» на экране статистики больше не молчит.** Если экран статистики не подтвердился за 30 секунд, в журнал пишется разбор: лучшее совпадение шаблона крепости и маркера с их оценками против порогов и масштаб кадра — сразу видно, чего не хватило детектору на разрешении игрока. В папку боя сохраняется `score-chart-timeout-<разрешение>.png` в полном разрешении. Так же полный кадр пишется, когда иконки не найдены вовсе (`score-chart-no-icons-...png`) и при сдаче или неопределённом исходе (`score-chart-full-...png`) — то есть ровно в тех случаях, когда итог и нужно разбирать по снимку. Обычный уменьшенный снимок остаётся: место экономится, но спорные исходы теперь всегда видны в исходном разрешении.


## Обновление 0.50.1

- **Разрешение экрана в имени каждого скриншота.** Файлы диагностики называются `room-before-start-1920x1080.png` и `score-chart-1920x1080.png`; если разрешение экрана отличается от снятого кадра (игра в окне, несколько мониторов, масштабирование), в имени появляются оба значения — `score-chart-1280x720@2560x1440.png`. Проблемы с кликами и распознаванием почти всегда вызваны конкретным разрешением, поэтому теперь оно видно сразу, без открытия снимка. Те же числа пишутся в `automation.log` (`кадр 1920×1080, экран 2560×1440, в файле 960×540`) и в первую запись `campaign.log` (`screen 2560x1440@1`), так что разрешение видно и когда присылают один журнал без снимков.


## Обновление 0.50.0

- **Армия идёт по любому клику.** Пока армия выделена, клик по карте всегда отдаёт приказ движения: и по пустому гексу, и по локации, своей или чужой. Раньше клик по собственному городу выделял его вместо движения, и армию приходилось вести только по пустым гексам. После приказа выделение снимается, `Esc` снимает выделение, если нужно именно открыть локацию, — подсказки инспектора обновлены.
- **Аварийный выход по `Ctrl` заработал.** Низкоуровневый хук клавиатуры передаёт не общий код `VK_CONTROL`, а код конкретной клавиши — `VK_LCONTROL`/`VK_RCONTROL` (`0xA2`/`0xA3`), поэтому сравнение с `0x11` никогда не совпадало и нажатие просто проглатывалось. Теперь принимаются все три кода, `Ctrl` пропускается дальше по цепочке, и рядом работает второй, независимый от хука путь: пока ввод заблокирован, сторожевой поток опрашивает физическое состояние `Ctrl` каждые 80 мс. Как и раньше, выход срабатывает только при заблокированном вводе: игра закрывается тем же путём, что при отмене боя из окна конфликта, и в приложении появляется строка «Аварийный выход по `Ctrl`». Первая клавиша, пришедшая в хук за блокировку, записывается в лог боя — если выход снова не сработает, по её коду будет видно, что приходит.
- **Снимок экрана делается в момент решения.** `score-chart.png` больше не снимается при появлении экрана статистики: кадр берётся ровно перед выводом о победителе, после того как детектор прошёл по слотам рейтинга — на нём виден подсвеченный слот и линия, по которой сделан вывод. Снимок пишется и при победе, и при сдаче, и при неопределённом исходе. `score-screen.png` удалён — это был тот же экран, снятый на мгновение раньше.
- **Ничего не перезаписывается, диск не забивается.** Одна кампания — одна папка `portable_data/diagnostics/campaign-<дата создания сохранения>-<фракция>`: имя строится от `createdAt` сохранения, поэтому «Продолжить» пишет в ту же папку, а не создаёт новую. Каждый бой получает свою подпапку `battles/<раунд>-<конфликт>-<время>/` с конфигурацией боя, логом автоматизации и снимками — сколько бы боёв ни было за партию, ни один файл не затирается. Старт новой кампании удаляет диагностику предыдущих партий, так что папка не растёт бесконечно. Снимки крупнее 1280×720 уменьшаются вдвое: текст интерфейса остаётся читаемым, а кадр занимает около 1.5 МБ вместо 5.9 МБ.


A portable desktop remaster of **War of the Ring** for *The Battle for Middle-earth II: The Rise of the Witch-king 2.01*.

The project combines:

- a global turn-based strategy;
- a complete world and roster editor;
- isolated user mods;
- portable Tauri desktop packaging;
- a native Windows bridge that prepares and launches real ROTWK battles.

## 0.45 — 0.49

Записи ниже перенесены из старого README дословно, включая формулировки того
времени. Номера версий местами повторяются: в ранних сборках в README
добавлялся абзац без подъёма номера.

0.49.3 fixes the Windows build. Two log calls passed a string literal through `.into()` while the receiver is generic (`AutomationLog::write(impl AsRef<str>)`), which rustc rejects as an ambiguous type (E0283); the literals are passed directly now.

0.49.2 adds an emergency exit from BFME. The automation blocks physical keyboard and mouse input while it drives the game (room setup and reading the score screen), and until now the only way out was Ctrl+Alt+Del plus killing the process by hand. While - and only while - that lock is held, a single `Ctrl` press now terminates every `game.dat` process, releases the input lock immediately and stops the automation: the conflict is reported as `ABORTED` instead of a winner being guessed, and the interface says so. The key is detected inside the low-level keyboard hook itself, so it works precisely in the window where nothing else reaches the system; the actual termination runs in a separate thread, because a low-level hook callback has a hard timeout and would be removed by Windows if it blocked. The lock message is written to the session's `automation.log`, and the conflict dialog states the shortcut before the launch.

0.49.0 adds a play journal for reproducing sessions, screenshots of the two RTS moments that decide a battle, and a predictable mouse model for movement orders - now both cancellable and free of accidental re-orders.

0.48.3 unblocks sieges that were wrongly reported as RTS-incompatible. A siege additionally required the location to carry an `rtsFortress.defenderStartPosition`, but that point is only an optional refinement - it pins the defender onto the fortress spawn instead of a random defence point, and the launcher already falls back to the generic defence pool when it is absent. Requiring it silently rejected perfectly playable maps: of the 21 strongholds that ship with a BFME map, only 7 satisfied the check, so **14 of them - including Cair Andros, Osgiliath, Morannon, Carn Dum and Fornost - could never be fought in the RTS** and fell back to auto-resolve. The check now only demands a map and a legal number of factions per side. The rejection message was also generic ("check the number of factions and slots"), which is why the cause was impossible to guess; it now names the actual problem, e.g. that the attacking side has too many factions for BFME's four-slot limit, or that no map is assigned to the location.

0.48.2 fixes hero revival in generated battles. Each fortress hero button is unlocked by a fixed `Upgrade_AllFactionHeroUpgrade<N>` defined by the mod's CommandButton set - Eowyn is 1, Eomer 2, Boromir 3, Theoden 4, and so on per faction. The generator was instead numbering heroes by their position in the marching army, so a lone Theoden was emitted as Upgrade1 and the fortress revived **Eowyn** in his place; the same slip turned a solo Saruman into Grima Wormtongue. The number is now looked up per hero object from a table transcribed from the button definitions, covering all 39 buttons across the eight factions, and it is verified against the roster so every hero resolves and no two heroes of one faction share a number. Ring heroes (Galadriel and Sauron) correctly get no block at all, since they are gated by `Upgrade_FortressRingHero` and are always level 10. Rust unit tests lock the mapping in place.

0.48.1 fixes the issues found in the first 0.48.0 playtest. **Handicap is now relative**: previously every army that had spent its movement got a "forced march" penalty, so both sides of an ordinary battle received an identical -10 %, which is meaningless because the BFME handicap only ever expresses a *relative* advantage. The forced-march penalty is gone and the remaining penalties (demoralization after a lost battle, an enemy Ring) are normalised so the strongest side always sits at 0 % and only a genuinely weaker side is handicapped. The handicap dropdown also clicked the wrong row: unlike the faction and color lists it has no leading «Случайно» entry and uses a taller row step, so row selection is now driven by an explicit `has_random_row`/`step` pair taken from the reference automation. **Heroes now always get an explicit `Object <Hero>` block** with `GrantUpgradeCreate` and `ExperienceLevelCreate`, level 1 included, exactly like the reference `build_hero_mod` - without it BFME kept the map default instead of the campaign level. **Unit level caps come from the game data**, not from a global setting: the per-object table in `_test_integration-bfme/docs/units_rotwk_2.01.md` is embedded as `ROTWK_UNIT_LEVEL_CAPS` (5 regular / 10 heroic / 0 for siege engines and ents) and used as the default for every roster entry, while the editor still allows a per-unit override. The non-editable palantir fields (base starting points, base income, the hard-coded 2-minute tick) and the world-wide default level fields were removed from the Ring tab, since BFME hard-codes them. Buildings now show a **localized name and a hover description in both languages** everywhere (turn panel, location inspector, editor), and the editor gained a description field. Chokepoint economic types (pass, ford, ruins, forest, mountains) previously granted auto-battle-only bonuses, so a real battle at e.g. the Gap of Rohan showed no trace of ownership - they now also grant modest starting resources and command points. The window title next to the icon follows the selected UI language (HTML title plus the native Tauri caption, with the required `core:window:allow-set-title` permission). Finally, the app version is synchronized across `package.json`, `tauri.conf.json`, `Cargo.toml` and `Cargo.lock`, and a new `scripts/check-version.mjs` guard runs as part of `npm run build` so a compiled build can never again report a stale version.

0.48.0 adds the permanent army layer, contextual battle modifiers, strategic buildings and the Ring-forging race. Units and heroes now keep a level (`maxLevel` in roster.json, +1 per battle for every survivor, no decay) and three ratchet upgrades — weapons, armor and banner — gated per unit by `availableUpgrades`; both feed the auto-battle power multiplicatively and are exported to BFME as level auras and upgrade auras. Economic types gained `buildingSlots` and an owner-side `battleModifiers` block (starting resources, command points, palantír points and income, signal fire, defense/ambush bonuses, terrain debuff), regions gained a `fullControlBonus`, and `world.json` gained `buildingTypes`, `palantirSettings`, `ringForging`, `defaultUnitMaxLevel` and `defaultHeroMaxLevel`. Locations can host buildings (forge, armory, banner workshop, beacon, training camp, storehouse, barracks annex, palantír tower, ring forge) that build over several turns, grant permanent upgrades to armies stationed at the location, raise the recruitment start level, and are destroyed or captured with the location. The Ring-forging race lets every faction invest gold each turn (ring forges add free progress); the first faction to finish receives the One Ring, which is carried by a specific army, can be handed to another army in the same hex, and passes to the victor when its bearer is annihilated. All of this reaches real BFME battles through the spawn bridge (starting-gold crates, command-point bonuses, signal fires, palantír start/rate objects, the faction Ring hero) and through the room handicap: demoralization, forced marches and an enemy Ring are summed into a single penalty and snapped to the BFME −5 % grid. The editor gained Buildings and Ring tabs plus per-unit level/upgrade fields and full-control bonus fields for regions, and the turn panel gained building and Ring-forging sections. These data revisions are intentionally incompatible with previous campaign saves.

0.46.0 integrates the real RTS battle flow end to end: 51 imported BFME MapCaches with calibrated minimap coordinates, randomized start positions (the fortress owner always takes the main defense point of a stronghold), a coordinate-calibration tool and a coordinate-test tool in the editor, automatic score-screen winner detection, and automatic BFME shutdown after the winner is determined. The default «Vanilla 2.01» mod now ships its `_patch201ini.big` and `__wotr_maps.big` archives plus every default MapCache embedded in the executable and restores them into `portable_data` on the first launch, so BIG files no longer need to be installed manually.

0.46.1 fixes the first 0.46.0 build: the generated `templates.rs` now joins its hex chunks with `concat!` (Rust has no implicit adjacent string-literal concatenation), the calibration hotkey channel is kept in a static `Mutex` (`mpsc::Receiver` is `!Sync`), and borrow-checker conflicts in the battle-launch command are resolved.

0.46.2 fixes the start-position pools and the RTS aftermath. The coordinate test now maps slots strictly by range (slots 1-4 take defense points, slots 5-8 take attack points) instead of by faction alignment, and the stronghold main point is excluded from the shuffled pool so it can never be assigned twice (the 8th click used to repeat the first position). A real RTS battle now resolves exactly like an auto-battle with a known winner: `resolveConflictRts` runs the standard conflict simulation (losses, hero fates, retreats, capture) with only `winnerSide` forced from the BFME detector.

0.46.3 hardens the launch flow. The Options.ini resolution is restored at a deeper milestone (after the LAN room is created, or when the main menu is detected during calibration) instead of a fixed 5-second timer that raced the cold start. Cold-start input warmup from the Python prototype is ported: the game window is activated (ShowWindow/SetForegroundWindow/BringWindowToTop/SetActiveWindow/SetFocus) with a settle pause, and «Сеть» -> «Лок. сеть» is retried when the main-menu marker proves the clicks went nowhere. Every launch path (battles, coordinate tests, calibration) now closes a running game first — BIG files in the game folder are locked while game.dat is alive — and relaunches fresh. Calibration launches the game through the elevated helper (lotrbfme2ep1.exe requires elevation, os error 740). The fortress defender start point moved from a standalone inspector menu into the BFME-coordinates card as a selectable defense point (`fortressDefenseIndex`); when no point is designated, all start positions randomize like a regular location. Weathertop (Amon Sûl) now uses the `map mp weathertop` cache and its calibrated coordinates. The fortress defender start point is designated (first defense point) for Helm's Deep, Minas Tirith, Rivendell, Erebor, Isengard, Dol Guldur and Minas Morgul.

0.46.4 restores the timing constants accidentally removed from `match_detector.rs` together with the dead code cleanup (broke the build), and designates the main defense point for the seven strongholds.

0.46.8 ships eight gameplay and usability fixes. The window title is now always English («War of the Ring» in `tauri.conf.json` and in the dynamic `document.title`), no matter which UI language is picked. Calibration closes the game automatically after the eighth point, exactly like F10 (resolution is restored first). Belfalas ships with calibrated RTS coordinates (4 defense + 4 attack slots). Treebeard's Hill is now a stronghold (economic type «camp») instead of a domain, so it no longer claims surrounding hexes. Recruitment now shows the command points each unit occupies (hire list, queue and reserve rows), the hire button is disabled when the location's CP limit is exhausted, and the «←»/«→» transfer buttons between army, reserve and stationed armies are disabled per-slot when the CP limit would be exceeded. Disbanding an army no longer overflows the location reserve: heroes always transfer, units fill the reserve up to the location's CP limit and the rest are disbanded permanently (logged in the chronicle). A new in-place transfer lets you move units between two armies of the same faction standing in the same hex (selector in the army inspector, per-slot «→» button). Isengard's RTS line color changed from black to white everywhere (as in the prototype) because black was unreadable on the dark chart.

0.46.5 reworks the calibration session to run entirely inside the elevated helper, mirroring `tools/calibrate.py` (which elevated itself via `ensure_admin`): system hotkeys (`RegisterHotKey` F9/F10 with a message loop, as in `tools/hotkey.py`) are used instead of a low-level keyboard hook — an LL hook in the non-elevated app never receives keys while the elevated game window has focus (UIPI), which made F9 dead. Progress is published to `rts_calibration_status.json` and polled by the UI; the editor Stop button and F10 both close the game. The windowed resolution is restored by a fixed 30-second timer (the game has read Options.ini by then even on a cold start). After closing an already-running game every flow waits 5 seconds before relaunching so RotWK does not report «game already running». Calibration now deploys the same files as the coordinate test (mod BIGs + the location MapCache) before launching the game, so the calibrated map is the one actually loaded; the deployment plan comes from a shared planner used by both flows, and calibration requires an uploaded MapCache. 0.46.7 fixes three compile errors introduced by that change (unused Mutex import, a closure double-mutable-borrow of the resolution restore, and a missing `mut` on the deployment error list).

0.45.9 rebalanced the economy and recruitment parameters for all 186 locations after the geography revision. Economic types now match the location context, per-location income and recruitment limits follow their type, specialization tags remain empty, and major capitals contribute to the global army limit. This balance revision is intentionally incompatible with previous campaign saves.

0.45.27 applies the latest location update from _tools/edit_world.json. Economic types were reviewed against structural types, all per-location economy and recruitment values were recalculated from those types, and specialization tags remain empty. This data revision is intentionally incompatible with previous campaign saves.

0.45.27 prevents opposing armies from passing through each other on a head-on route swap: movement endpoints are retained and direct cross-movements are consolidated into a conflict before scanning hot spots. The latest location update from `_tools/edit_world.json` is also applied. This revision is intentionally incompatible with previous campaign saves.

0.45.27 recalculates location and economic-type reserve capacity as CommandPoints rather than legacy unit counts: from zero at wilderness/landmarks to 1200 at capitals. The reserve UI and recruitment flow now use the sum of unit and hero CommandPoints.

0.45.27 keeps long location names readable in the hover tooltip by expanding its available width, wrapping names safely, and repositioning it away from the map edge. Existing English and Russian names were preserved. This interface revision is intentionally incompatible with previous campaign saves.

## Совместимость сохранений

Сохранение кампании совместимо только с той же версией приложения, той же
версией формата сохранения и тем же ID мода. Новая версия приложения
намеренно начинает новую кампанию: старые сохранения помечаются
несовместимыми и не мигрируются.

