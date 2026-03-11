# Employee Web UX Risks for Shop-Floor Usage

Scope: employee-facing workflows used in noisy, high-glare, interruption-heavy environments (`/work-orders`, `/inventory`, `/reporting`, `/auth`) and their underlying API/event flows.

## UX risk matrix (avoid these failure modes)

| ID | Risk to avoid | Screens/workflows at risk | Mitigation pattern | Acceptance checks (release gate) | Accessibility + observability implications |
|---|---|---|---|---|---|
| R1 | Touch ergonomics cause mis-taps and accidental state changes | `/work-orders` task/work-order transitions; `/inventory` reserve/release/consume flows | Minimum 48x48 hit targets; 8+ px spacing between destructive and primary actions; sticky bottom action bar for high-frequency actions; undo window for destructive transitions | 100% interactive controls on shop-floor screens meet 48x48; top 5 actions on tablet complete with one-hand thumb reach; destructive transitions require confirm or undo | Controls must be keyboard-focusable with visible focus ring; track rapid back-out/reversal events after tap as mis-tap signal |
| R2 | Glare/noise hides critical state cues | Blocked/shortage/sync indicators on `/work-orders`, `/inventory`, `/reporting` | Use icon + text + shape (never color-only); high-contrast tokens; persistent inline banners for critical issues (not transient toasts) | All critical state chips pass WCAG AA contrast; grayscale check still distinguishes READY/IN_PROGRESS/BLOCKED/FAILED; no audio-only alert path | Screen-reader labels include state text; log critical banner shown/acknowledged events with correlation id |
| R3 | Interrupted workflows lose progress or create duplicate submissions | Technician task updates, rework issue entry, inventory lot mutations, attachment metadata updates | Autosave drafts; explicit “saved locally/queued” status; idempotency key on submit; resume-from-last-step entry point | Refresh/reopen within 30 minutes restores unsent work; double-submit creates one mutation/event; resumed form identifies last edited timestamp | Autosave/restore announcements exposed to assistive tech; monitor draft-restore rate and duplicate-submit prevention count |
| R4 | BLOCKED/FAILED states are ambiguous and non-actionable | `WorkOrderState.BLOCKED`, `TechnicianTaskState.BLOCKED`, `inventory.shortage_detected`, planner/sync failures | Structured reason model: `reason_code`, plain-language explanation, owner, and explicit next action CTA (request part, escalate, retry) | 100% blocked cards include reason + next action + owner; generic “Something went wrong” removed from execution screens; unblock action available without navigation hunt | Reason text announced via live region on state change; emit blocked_reason_code metrics with age-to-resolution |
| R5 | Sync failures are hidden, causing false confidence | `ticket.status_changed -> invoice_sync.*`; `planning.slot_plan_published -> workspace/reporting projections` | Per-record sync badge (PENDING/IN_PROGRESS/SYNCED/FAILED), last-success timestamp, stale-data banner when lag exceeds threshold, role-gated retry | Injected sync failure surfaces FAILED state within 30s; stale banner appears when projection lag breaches target; retry preserves correlation id | State text must be machine-readable and not color-only; monitor sync failure age p95, stale-banner exposure, retry success rate |
| R6 | Connectivity drops silently discard floor actions | All mutating actions on `/work-orders` and `/inventory` | Connectivity indicator, offline queue with visible count, deterministic replay with idempotency, per-item retry/cancel controls | Offline mutation remains queued across refresh; reconnect replays exactly once; user can cancel a queued action before replay | Queue state updates announced for assistive tech; track offline queue depth, replay latency, replay failure reasons |
| R7 | Shared-device session confusion causes wrong-actor mutations | `/auth` + all mutating screens | Persistent active-user badge, quick lock/switch-user action, idle auto-lock, re-auth for irreversible actions | Floor-device sessions auto-lock after idle timeout; every mutation carries actorId matching visible user; switch-user flow completes in <=2 interactions | Lock/switch controls keyboard reachable and screen-reader labeled; alert on actorId/session mismatch events |

## Screen/workflow binding (what to validate where)

- **`/work-orders`**: R1, R2, R3, R4, R5, R6, R7  
  Includes technician task transitions, work-order lifecycle changes, blocked/unblocked handling, and downstream sync visibility.
- **`/inventory`**: R1, R2, R3, R4, R6, R7  
  Includes lot reserve/release/consume, shortage handling, and interruption/offline recovery.
- **`/reporting`**: R2, R5  
  Focus on stale projection visibility, sync health clarity, and readable exception states.
- **`/auth`**: R7  
  Focus on rapid but safe user handoff on shared tablets/kiosks.

## Cross-cutting implementation implications

- **Accessibility:** shop-floor critical paths must remain operable without color, without audio, and without precision tapping; blocked/sync transitions must be announced and focus-managed.
- **Observability:** emit correlation-aware UI telemetry for blocked reasons, sync-state rendering, queue replay outcomes, and mis-tap reversals to detect field friction before it becomes operational downtime.
