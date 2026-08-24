# Drill-down (double-click): спецификация

Версия: текущая реализация `pixi-viewer` (инкрементальный rebuild).

URL (оба хоста, одна сборка):

- https://grishulagmail.github.io/DMTECH_BW_graph/pixi/
- http://v135892.hosted-by-vdsina.com/DMTECH_BW_graph/pixi/

---

## Триггер

| Событие | Действие |
|---------|----------|
| Double-click по узлу | `focusNode(id)` → инкрементальный drill-down |
| Кнопка **Layout** | Полный rebuild + тот же алгоритм раскладки (эталон финальных координат) |

Drill-down **не** пересоздаёт все спрайты. Полный rebuild — только если seed не попал в новый `visible`.

---

## Входные параметры drill-down

Из UI и модели:

- `seedId` — узел двойного клика
- `egoDepth`, `egoParents`, `egoChildren` — глубина и направление обхода
- Фильтры типов, DTP, FROZEN и т.д.

Модель (`GraphModel.rebuild`) строит:

- `visible` — множество узлов на экране
- `bundle` — подмножество lineage вокруг seed (при пучке)
- `edges`, `vias` — рёбра и via-сегменты

---

## Фазы (строго по порядку)

### 0. Подготовка (`focusNode`)

1. Debounce: повторный клик по тому же узлу < 600 ms игнорируется.
2. Breadcrumb: seed добавляется в цепочку (или обрезается при возврате).
3. Поисковая строка и панель «Объект» обновляются сразу.
4. `apply(false, seedId, incremental=true)` — **без** мгновенного fit камеры.
5. UI блокируется до `whenIncrementalReady()`.
6. После завершения: `selectNode`, подсветка в списке узлов.

### 1. Diff visible (`rebuildIncremental`, синхронно)

```
prevVisible = текущие спрайты на сцене
nextVisible = frame.visible после rebuild модели
toRemove    = prevVisible − nextVisible
toAdd       = nextVisible − prevVisible
staying     = prevVisible ∩ nextVisible   // спрайты не удаляются
```

- **toRemove**: спрайт снимается со сцены, fade-out 0.22 s (`startNodeExit`).
- **staying** (включая seed): **остаются на текущих world-координатах**, не пересоздаются.
- `anchor` = текущая позиция seed (для fallback).
- Рёбра-flow очищаются; `onFrame` — в следующем rAF.

### 2. Ожидание exit-анимаций

Пока `fx.hasExits === true`, фаза 3 не стартует (`scheduleIncrementalContinue` / `flushPendingLayoutTween`).

### 3. Расчёт layout (один раз)

```ts
layoutNodes(nodes, links, { fresh: frame.bundle.size > 0 })
```

- **Тот же вызов**, что у кнопки Layout (`rebuildFull`).
- `fresh: true` при непустом `bundle` — полный пересчёт кольцевой раскладки по группам типов + repulse/link-силы.
- Результат: `targets: Map<id, {x,y}>` — **единственный эталон финальных координат**.

Снимок `boundsFrom` = bounding box **только staying-узлов** (до добавления новых).

### 4. Добавление новых узлов (чанками по 14, rAF)

Для каждого `id ∈ toAdd`:

1. Спрайт создаётся сразу в **`targets.get(id)`** (финальная позиция layout).
2. `rememberPosition(id, x, y)`.
3. Fade-in 0.22 s (`startNodeEnter`, без scale).
4. **Tween для новых узлов не запускается** (`skipMoveIds = toAdd`).

### 5. Отрисовка рёбер

`drawEdges` + `rebuildFlows`. Если `viaPending` — via дорисовываются отложенно (+20 ms).

### 6. Плавная раскладка staying-узлов + камера (`startLayoutTween`)

Длительность: **0.85 s**, easing: ease-in-out cubic.

| Узел | Поведение |
|------|-----------|
| `id ∈ toAdd` | Уже на месте, движение **пропускается** |
| `id ∈ staying`, \|Δpos\| < 1 px | Мгновенный snap |
| `id ∈ staying`, \|Δpos\| ≥ 1 px | `startNodeMove` → финальная `targets(id)` |

Параллельно:

- **Камера**: lerp от **текущего** `{x,y,scale}` (не snap к fit в t=0) к `fitFill( bounds(targets), fill=0.92 )`.
- **Рёбра**: геометрия обновляется по ходу движения (`refreshCurvePositions`, throttled redraw).

По завершении tween: финальный `drawEdges`, `resolveIncrementalReady()`, снятие busy.

---

## Инварианты (гарантии)

1. **Финальные координаты drill-down = координаты кнопки Layout** (один `layoutNodes`, те же аргументы).
2. **Новые узлы не «вылетают» из seed** — появляются на финальных местах с fade-in.
3. **Seed не телепортируется до tween** — до фазы 6 остаётся на месте клика; камера не прыгает в первый кадр.
4. **Повторный Layout после drill-down не должен сдвигать узлы** (если фильтры и visible те же).

---

## Отличие от полного rebuild (Layout)

| | Drill-down | Layout |
|---|------------|--------|
| Спрайты staying | Сохраняются | Все пересоздаются |
| Спрайты removed | Fade-out | Удаляются сразу |
| Спрайты new | Fade-in на target | Сразу на target |
| Движение | Tween 0.85 s (только staying) | Нет (мгновенно) |
| Камера | Плавный lerp | Мгновенный fit |

---

## Ключевые файлы

| Файл | Роль |
|------|------|
| `src/main.ts` | `focusNode`, `apply(incremental)` |
| `src/scene/graphView.ts` | `rebuildIncremental`, tween, камера |
| `src/graph/layout.ts` | `layoutNodes`, `rememberPosition` |
| `src/scene/effects.ts` | fade/move анимации |
| `src/scene/camera.ts` | `computeFitFill`, `fitFillLerp` |

---

## Деплой

Публикация всегда на **оба** хоста одной сборкой. Не выкладывать только Pages. Подробности — `README.md` (раздел «Публикация»).

```powershell
cd pixi-viewer
npm run build:pages
# 1) dist/ → grishulagmail/DMTECH_BW_graph/pixi/ → push main
# 2) тот же dist/ → VDS:/var/www/pixi/DMTECH_BW_graph/pixi/
```
