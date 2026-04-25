# Floor Tech App Operator Manual

For technicians executing work on the shop floor.

Live URL: <https://floor.golfingarage.m4nos.com> — open it on the bay tablet or your phone.

---

## If you only read one thing

Clock in on the **Shift** tab. Pull the top card on **Queue**. Check off tasks as you do them; tap **Time** to start the timer. If you're stuck, tap **Mark blocked** and pick a reason. Everything works offline — the **Sync** tab catches you up when Wi-Fi comes back.

---

## What this app is for

You're a floor tech. You work in gloves, often away from Wi-Fi, often on a shared tablet at the bay. This app is built for that:

- Big buttons (56+ pixels tall) so you can tap with gloves or thumbs.
- Four tabs at the bottom — no menus to dig through.
- **Offline-first**: the app keeps working when Wi-Fi drops. Your updates stack up in a queue and replay automatically when you reconnect.
- Shared-device friendly — clock-in marks the device as "yours" so the next tech can see who touched what last.

Anything beyond execution (creating work orders, assigning techs, parts ordering, reporting) lives in the main ERP — that's your shop manager's world.

---

## Starting your shift

1. **Open the app**: <https://floor.golfingarage.m4nos.com>
2. **Sign in**: type your `@golfingarage.com` email, tap **Continue**. You're sent to Google, authenticate once, and you're back.
3. **Shift tab** (bottom nav, second from left): tap **Clock In**. Your name now shows on this tablet.
4. **Set availability**:
   - 🟢 **Available** — ready to pick up tasks.
   - 🟡 **On break** — out for a bit; dispatch sees you're unavailable.
   - 🔴 **Needs help** — flags the shop manager.

If someone else is already clocked in on the tablet, tap **Switch Device User** to swap — this clocks them out.

---

## The four tabs

![placeholder: bottom nav with Queue, Shift, Time, Sync](./screenshots/TBD-floor-tech-nav.png)

| Tab | What you do here |
|---|---|
| **Queue** | See and open your assigned work orders. |
| **Shift** | Clock in/out, availability, switch device user. |
| **Time** | Start/stop the timer, view today's entries. |
| **Sync** | Review and replay offline updates. |

Your current tab is highlighted orange.

Across the top you'll see the **Offline Queue Banner**:

- 🟢 "Online" — all good, updates go through immediately.
- 🟡 "Offline — N updates queued" — you're working without Wi-Fi; nothing is lost.
- 🔴 "Sync failed — N items need retry" — something needs your attention in the Sync tab.

---

## Working the queue

Tap **Queue**. You see cards for each work order assigned to you. Each card shows:

- **WO number and title** (e.g. `#1620 — Pier Motorsports lift kit install`)
- **Material readiness**: 🟢 Ready / 🟡 Partial / 🔴 Not ready
- **Sync status**: SYNCED / PENDING / RETRY / FAILED
- **Next action**: e.g. "Start frame install", "Finish QC"
- **Rework counter**: `0 ↻`, `1 ↻`, `3+ ↻` — how many times this has come back

At the top you also see quick stats: **Ready now**, **Blocked**, **Sync attention**.

Tap any card to open the work order detail.

---

## Executing a work order

This is where you spend most of your day.

### The checklist

The heart of the page. Each line is a task. Tap the checkbox to mark it done — it updates immediately, even offline. A small badge shows the sync status for each toggle.

Tasks you can't do yet are greyed out (prerequisite not met).

### Notes

Scroll to the **Notes** section. Type a note for the next tech, the parts team, or dispatch — whoever will read this WO next. Tap **Save**. Your note appears inline with a PENDING badge until it syncs.

Notes persist across shifts. A later tech picking up the WO sees everything you wrote.

### Evidence photos

Under any task that supports it, tap the **📷 Upload** slot. On mobile this opens the camera directly; on a tablet it offers file-picker. Take/pick a photo → it attaches to the WO with a PENDING badge.

Use for:

- Proof of tricky install steps (insurance / warranty claims).
- Damaged part condition on arrival.
- QC evidence for a safety item.

Photos live offline until you sync — safe to take them away from Wi-Fi.

### Request additional parts

If you open a WO and realize you need a part that isn't reserved, tap **Request Parts** (at the bottom). Pick the part(s) and quantity; parts manager sees it in their queue.

### Mark blocked

Top-right of the WO detail: **Mark Blocked** button. Tap it → a dialog asks for:

- **Reason code**:
  - `PARTS_MISSING` — you need something not on the shelf
  - `WAITING_MANAGER` — need a decision
  - `TOOLING_ISSUE` — missing/broken tool
  - `CUSTOMER_HOLD` — customer asked to pause
  - `SAFETY_CONCERN` — something unsafe
  - `OTHER`
- **Reason text**: a sentence or two.

Tap **Block**. The WO status changes to BLOCKED; it leaves your queue and appears on the shop manager's Open/Blocked screen with your note attached.

### Completing / handoff

Check off the final checklist item. A **Complete** button appears. Tap it to mark the WO done → it leaves your queue and goes to QC or invoicing depending on the workflow.

If this WO needs a handoff to another stage (e.g. you did frame, next is electrical), the checklist's last item is "Handoff to next stage" — checking it sends the WO back to dispatch for reassignment.

---

## Time logging

Tap **Time** (third tab). Two things here:

### Active timer

At the top: one big button. **Start Timer** / **Stop Timer**. Tapping it records wall-clock time against the currently-open work order (or the last one you worked on).

Rule of thumb: **tap Start when you pick up a WO**, tap **Stop** when you put it down (break, lunch, EOD, switching WOs).

### Manual entry

If you forgot to start the timer: tap **+ Add Manual Entry**. Enter start time, end time, WO. Saves as a PENDING time entry — syncs when you're online.

### Today's entries

Scroll down to see every time entry you've logged today: WO, start, end, computed hours. Tap any row to edit.

---

## Offline mode

This is the feature most people don't understand until they see it work. Here's the deal:

**When Wi-Fi is solid**, everything you tap goes through immediately. Sync status badges show SYNCED.

**When Wi-Fi drops** (the banner turns yellow/red):

- Every tap still works — checkboxes still toggle, notes still save, photos still attach.
- Updates stack up in a local queue with PENDING badges.
- You don't need to do anything different.

**When Wi-Fi comes back**:

- The app automatically retries each queued update in order.
- Each one's badge transitions PENDING → SYNCED (green).
- If one fails (e.g. someone else modified the same record), its badge turns RETRY (yellow) or FAILED (red) and you see it on the Sync tab.

### The Sync tab

Tap **Sync** (fourth tab). Three cards at the top:

- **Queued** — updates still waiting to send (you're probably offline).
- **Needs retry** — will retry automatically on the next online moment.
- **Failed** — needs you to look at it.

Below, each queued/failed item shows:

- Kind of update (checklist toggle, note, photo, time entry, blocked).
- The WO it belongs to.
- Error message if failed.

**Replay Now** button — force a retry when you're online. Use this if the auto-retry hasn't caught up.

**Important**: every queued update has an idempotency key. Replaying the same queue twice won't duplicate data.

---

## Shared device etiquette

The bay tablet isn't yours personally — it's shared.

- **Start of your shift**: open Shift tab → Clock In. Your name now shows on the device.
- **End of your shift**: tap **Clock Out**. The next tech can clock in fresh.
- **Switching devices**: tap **Switch Device User** on the Shift tab. This clocks out whoever was on the device and returns to sign-in.
- **Borrowing for a minute**: if another tech is clocked in and you just need to glance at a WO, that's fine — but don't make changes under their name. Switch users or use your phone.

Everything you do is logged against your clocked-in name. The Audit Trail in the ERP captures who did what and when.

---

## Troubleshooting

| Symptom | What to check |
|---|---|
| App won't sign in with Google | Make sure you're on your `@golfingarage.com` account, not personal Gmail. The Google chooser lets you switch. |
| Stuck on "Checking authentication…" | Pull to refresh / hard-reload the page. If it stays stuck, clear the browser's site data for `floor.golfingarage.m4nos.com`. |
| Offline banner says I'm online but updates still PENDING | Go to **Sync** tab, tap **Replay Now**. If that still fails, the server's rejecting your request — screenshot and ping shop manager. |
| My checklist toggle un-toggled itself | Someone else edited the same WO while you were offline. The server's version won. Re-do the toggle; it'll stick now. |
| Timer keeps resetting to zero | The timer lives on the device. If you closed the browser tab, the timer paused; reopening continues. If the tab crashed, you'll need a manual entry for the lost time. |
| Can't find a WO I'm sure was mine | Check the shop manager's Open/Blocked board in the main ERP — it may have been reassigned. Audit Trail shows who and when. |
| Photo upload says FAILED | Photo is probably over 10 MB. Retake at lower resolution. The WO detail page's **Upload** slot accepts up to 10 MB per file. |
| "Session expired" mid-shift | Your Cognito token lapsed (rare — they last 1 hour with auto-refresh). Sign in again; offline queue is preserved. |

---

## See also

- **[ERP manual](./erp-manual.md)** — what shop managers and dispatch see when you mark blocked or complete a WO.
- **[Training manual](./training-manual.md)** — for OJT modules you've been assigned.
- **[README](./README.md)** — index and sign-in reference.
