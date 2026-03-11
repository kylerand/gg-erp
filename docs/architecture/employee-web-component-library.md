# Employee Web Component Library Structure

## Goal

Define an MVP component library that is:
- aligned to `packages/ui` (shared building blocks) and `apps/web` (feature composition),
- modular and easy to grow,
- TypeScript-first, with explicit contracts and minimal framework lock-in.

## MVP design rules

1. **Shared only when reusable**: move components into `packages/ui` after proven use in at least 2 features.
2. **Business logic stays in `apps/web`**: `packages/ui` contains presentation models, state helpers, and interaction contracts.
3. **Typed states over booleans**: use unions/enums for workflow status (e.g., `queued | in_progress | blocked | done`).
4. **A11y + telemetry built in**: each component class has standard hooks and event shape.

## Folder/module taxonomy

### `packages/ui` (shared, reusable)

```text
packages/ui/src/
  index.ts
  theme/
    tokens.ts
  primitives/
    button/
      Button.ts
      types.ts
    field/
      FormField.ts
      types.ts
    badge/
      StatusBadge.ts
      types.ts
  composites/
    data-table/
      DataTable.ts
      types.ts
    filter-bar/
      FilterBar.ts
      types.ts
    panel/
      Panel.ts
      types.ts
  workflows/
    queue/
      QueueList.ts
      QueueCard.ts
      types.ts
    checklist-runner/
      ChecklistRunner.ts
      ChecklistStep.ts
      types.ts
    time-logger/
      TimeLogger.ts
      TimeEntryRow.ts
      types.ts
    planner-board/
      PlannerBoard.ts
      PlannerSlotCard.ts
      types.ts
    po-receiving-table/
      POReceivingTable.ts
      types.ts
    sync-status/
      SyncStatusBadge.ts
      SyncStatusTimeline.ts
      types.ts
  a11y/
    useKeyboardListNav.ts
    useRovingTabIndex.ts
    useLiveRegion.ts
  telemetry/
    types.ts
    useComponentTelemetry.ts
    useWorkflowTelemetry.ts
```

### `apps/web` (feature-owned composition + data wiring)

```text
apps/web/src/
  app/
    router.ts
    providers.ts
  lib/
    telemetry.ts
  features/
    work-orders/
      components/
        WorkQueueSection.ts
        ChecklistExecutionPanel.ts
        TimeLoggerPanel.ts
      adapters/
        queue-adapter.ts
        checklist-adapter.ts
        time-adapter.ts
    inventory/
      components/
        POReceivingSection.ts
      adapters/
        po-receiving-adapter.ts
    planning/
      components/
        PlannerBoardSection.ts
      adapters/
        planner-adapter.ts
    accounting/
      components/
        SyncStatusSection.ts
      adapters/
        sync-status-adapter.ts
```

## Primitive vs composite vs workflow components

| Class | Purpose | Where | Examples | Allowed dependencies |
|---|---|---|---|---|
| Primitive | Small, style/token-driven controls | `packages/ui/primitives` | `Button`, `FormField`, `StatusBadge` | Theme tokens, a11y hooks, telemetry hooks |
| Composite | Multi-control layout/patterns | `packages/ui/composites` | `DataTable`, `FilterBar`, `Panel` | Primitives + a11y/telemetry |
| Workflow | Domain-shaped interaction blocks reused across screens | `packages/ui/workflows` | `QueueList`, `ChecklistRunner`, `TimeLogger`, `PlannerBoard`, `POReceivingTable`, `SyncStatusTimeline` | Primitives + composites + a11y/telemetry; **no API clients** |

## Workflow-specific component modules (MVP)

| Workflow area | Shared module (UI package) | Feature composition owner (`apps/web`) | MVP notes |
|---|---|---|---|
| Queues | `workflows/queue` | `features/work-orders/components/WorkQueueSection.ts` | Focus on list/card/sort/filter rendering and state chips. |
| Checklist runner | `workflows/checklist-runner` | `features/work-orders/components/ChecklistExecutionPanel.ts` | Support step states, required evidence slots, and blocker reasons. |
| Time logger | `workflows/time-logger` | `features/work-orders/components/TimeLoggerPanel.ts` | Support start/stop/manual entry and conflict display. |
| Planner board | `workflows/planner-board` | `features/planning/components/PlannerBoardSection.ts` | Support slot cards, drag targets, capacity warnings. |
| PO/receiving table | `workflows/po-receiving-table` | `features/inventory/components/POReceivingSection.ts` | Support line variance, partial receives, and status transitions. |
| Sync status | `workflows/sync-status` | `features/accounting/components/SyncStatusSection.ts` | Support pending/in-progress/synced/failed and retry affordances. |

## Accessibility and telemetry hooks by component class

| Component class | Accessibility hooks/patterns | Telemetry hooks/events |
|---|---|---|
| Primitive | `useRovingTabIndex`, focus-visible handling, `aria-*` helpers, minimum hit target checks | `useComponentTelemetry` with events like `ui.button.clicked`, `ui.field.changed` |
| Composite | Keyboard traversal (`useKeyboardListNav`), table semantics, empty/loading/error announcements (`useLiveRegion`) | Events like `ui.table.sorted`, `ui.filter.changed`, `ui.panel.expanded` |
| Workflow | Explicit state change announcements (blocked/failed/recovered), role/action labels, non-color-only status encoding | `useWorkflowTelemetry` with `workflow.queue.item_moved`, `workflow.checklist.step_completed`, `workflow.time.entry_saved`, `workflow.planner.slot_reassigned`, `workflow.po.line_received`, `workflow.sync.retry_clicked` |

### Telemetry contract (TypeScript-first)

- Reuse `apps/web/src/lib/telemetry.ts` emitter shape (`name`, `payload`).
- Require typed payloads per event family:
  - `route`, `feature`, `component`,
  - `entityId`/`recordId` when relevant,
  - `result` (`success | failure`),
  - `failureReasonCode` when failed.

## Extension points (intended)

1. **Renderer slots**: row/cell/action render functions for tables and queue cards.
2. **State badge registry**: map workflow state codes to icon/text/tone without changing component internals.
3. **Feature adapters**: `apps/web` adapters map API/domain models into stable UI models.
4. **Subpath exports** (later): `@gg-erp/ui/workflows/queue` for selective imports once package exports are formalized.
5. **Feature flags**: enable workflow variants (e.g., planner mode) at composition layer, not in primitives.

## Anti-patterns (avoid)

1. Putting API calls, route navigation, or auth checks inside `packages/ui`.
2. Duplicating primitives per feature (`WorkOrdersButton`, `InventoryButton`) instead of using variants/tokens.
3. Using `any` or ad-hoc string statuses instead of typed unions.
4. Embedding telemetry names inline in screens without typed event helpers.
5. Shipping workflow-specific components as one monolith instead of per-workflow modules.

## Implementation posture for MVP

- Keep existing `packages/ui/src/components/*` exports working while introducing the new taxonomy.
- Start with queue + checklist + sync-status modules first (highest operational risk visibility).
- Promote feature components to `packages/ui/workflows/*` only after second use case confirms reuse.
