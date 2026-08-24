# Откат версий pixi-viewer

## Текущие ветки и теги

| Метка | Что это |
|-------|---------|
| **`v-optimizations`** (git tag) | Текущая версия **с** P0–P2 |
| **`e93ab8e`** (GitHub Pages) | Предыдущая стабильная **без** оптимизаций (только `dist` в репо) |

## Откат локальных исходников

Репозиторий `pixi-viewer/` инициализирован с одним коммитом оптимизаций. Откат исходников до drill-down-only:

```powershell
# если сохранили копию до оптимизаций — восстановите её
# иначе откат Pages (см. ниже) или git revert после появления второго коммита
git tag -l
git show v-optimizations --stat
```

## Откат на GitHub Pages (рекомендуется)

| Версия | Коммит |
|--------|--------|
| **До оптимизаций** | `e93ab8e` |
| **С оптимизациями** | последний push в `pixi/` |

```powershell
cd $env:TEMP\DMTECH_BW_graph_deploy
git checkout e93ab8e -- pixi
git commit -m "Rollback Pixi to pre-optimizations."
git push origin main
```

## Что добавлено в `v-optimizations`

### P0 — Layout
- `layoutCore.ts` — spatial grid O(N·k) вместо O(N²)
- `layoutWorker.ts` + `layoutNodesAsync()` — расчёт в Web Worker при ≥350 узлах
- Fallback на main thread если Worker недоступен

### P1 — UX
- Hover: затемнение узлов/рёбер вне seed + прямых соседей
- Semantic zoom: подписи скрываются при `scale < 0.42`

### P2
- Кнопка **«Повторить»** при ошибке загрузки (`#bootRetry`)

## Файлы

```
src/graph/layoutCore.ts      — алгоритм (Worker-safe)
src/graph/layoutWorker.ts    — Web Worker entry
src/graph/layoutAsync.ts     — async API
src/graph/layout.ts          — sync API + saved positions
DRILLDOWN.md                 — спецификация drill-down
```
