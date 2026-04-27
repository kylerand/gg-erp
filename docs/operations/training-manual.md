# Training Manual

Two audiences in one doc. **Part A** is for trainers and OJT leads authoring and assigning training. **Part B** is for technicians consuming it. Pick your part.

---

## If you only read one thing

- **Trainer / OJT lead**: you work in the main ERP at <https://golfingarage.m4nos.com/training>. You publish SOPs, turn them into modules, and assign modules to specific techs. Skip to **Part A**.
- **Technician**: you work in the dedicated Training app. It has its own URL (ask your admin — e.g. `training.golfingarage.m4nos.com`). Skip to **Part B**.

---

## Concepts shared by both parts

Training is built in layers:

- **SOP (Standard Operating Procedure)** — the written reference, authored once, versioned forever. Lives in the SOP Library. Example: *"How to install a 4-link suspension, Revision 3."*
- **TrainingModule** — a learning unit that wraps an SOP. Adds: pass score, whether supervisor sign-off is needed, estimated time, sort order, required-vs-optional flag.
- **OjtStep** — a single step inside a module: video, instructions, tool list, materials, safety warnings, why-it-matters, key takeaways, common mistakes.
- **OjtKnowledgeCheck** — a quiz question attached to a module. Multi-choice. Explanation shown after submission.
- **TrainingAssignment** — this module, assigned to this employee, with an optional due date.
- **ModuleProgress** / **StepProgress** — state: not-started / in-progress / completed, current step, video watch progress, completion timestamps.
- **Supervisor sign-off** — modules with `requiresSupervisorSignoff: true` aren't complete until a supervisor approves.
- **Inspection Template** — checklists imported from ShopMonkey; read-only reference material in the SOP Library.

---

## Part A — Trainer / OJT Lead

Your home base is the ERP's **Training** section: <https://golfingarage.m4nos.com/training>.

### 1. SOP Library

`/training/sop`

**SOPs tab** (default):

- List of every SOP with its status (`DRAFT` / `PUBLISHED` / `RETIRED`), category, and last-updated date.
- Search by title or document code.
- **+ New SOP** button (top-right) opens a form:
  - **Title** — what the tech will see.
  - **Category** — e.g. "Frame", "Electrical".
  - **Owner** — the employee responsible for keeping it current.
  - **Content** — Markdown. Paste in the work instructions, add headings, lists, images.
- Save as DRAFT, or **Publish** to move to PUBLISHED immediately.

**Lifecycle**:

- `DRAFT` — only authors see it; never shown to techs.
- `PUBLISHED` — visible to techs; can back modules.
- `RETIRED` — hidden from new module creation but preserved for audit.

**Versioning**: each time you publish changes, a new `SopDocumentVersion` row is created. Old versions remain viewable. `currentVersion` is what techs see.

**Inspection Templates tab**:

- Read-only import from ShopMonkey.
- Use these as a reference when authoring an SOP that's functionally an inspection.

### 2. Module Admin

`/training/admin`

Every module, regardless of status. Columns:

- Module code, name, status (`ACTIVE` / `INACTIVE` / `RETIRED`).
- Step count, quiz count (questions).
- Estimated time.
- Required? (flag).
- Pass score (default 80%).
- **Preview** — opens the same module view a tech sees, without tracking progress against your account.

Use this screen to find broken modules (0 steps, no quiz, etc.) or ones you're retiring.

### 3. Assignments

`/training/assignments`

See every assignment across the team. Two groups: **Active** (ASSIGNED / IN_PROGRESS) and **Past** (COMPLETED / FAILED / EXEMPT / CANCELLED).

An **overdue banner** shows at the top if any active assignment has passed its due date.

**Assign Module** (top-right button): opens a form — pick a module, pick one or more employees, set an optional due date. Confirm to create assignments.

> **Note**: today's version of **Assign Module** is a placeholder toast in some builds — if so, ping your admin to create assignments directly in the DB while the UI is being finished.

### 4. Review progress

Click any assignment to see per-employee progress: current step, step-by-step completion, quiz attempts, score history.

### 5. Supervisor sign-off

Modules with `requiresSupervisorSignoff: true` aren't complete when the tech finishes. They go into a **Pending Sign-off** state. You (or another supervisor) review the tech's work and click **Sign Off** to close the assignment.

> **Note**: the sign-off UI is stubbed in the current build — your admin has a manual path until it's finished.

### 6. Publishing workflow, end-to-end

1. Draft an SOP in the SOP Library. Paste in the written instructions.
2. Publish the SOP (DRAFT → PUBLISHED).
3. Create a TrainingModule wrapping that SOP (Module Admin).
4. Add OjtSteps under the module: video URL, instructions, tools, safety, key takeaways.
5. Optionally add OjtKnowledgeCheck questions.
6. Set `isRequired`, `passScore`, `requiresSupervisorSignoff`.
7. Move module status to `ACTIVE`.
8. Go to Assignments → Assign Module → pick employees and due date.
9. Techs see the new assignment in their Training app.
10. Monitor completion from the Assignments page.

---

## Part B — Technician

Your home base is the **Training app** at your training subdomain (ask your admin — typically `training.golfingarage.m4nos.com`).

Sign in is identical to the ERP and Floor Tech app: email-first, Google SSO for `@golfingarage.com` Workspace accounts.

After sign-in you land on `/modules`.

### 1. Module catalog

`/modules`

A grid of every training module available to you. Each card shows:

- Module code and name.
- Estimated time.
- Status badge: **Not started**, **In progress**, **Completed**.
- If the module is required: a red "Required" tag.

**Filter** / sort by name, code, or sort order.

**Bookmark** — tap the 🔖 icon on a card to save it for later. Your bookmarks live under the Bookmarks view.

### 2. Module detail

`/modules/{moduleCode}`

Shows:

- Full description.
- Prerequisites — modules you must complete first.
- Step list with per-step progress.
- Quiz summary (if any): question count, pass score.
- Supervisor sign-off flag if applicable.
- **Start** or **Continue** button.

### 3. Working a step

`/modules/{moduleCode}/step/{stepId}`

Everything about one step:

- **Video** — click to play. Watch progress is tracked (you can pause and resume later).
- **Instructions** — the written how-to.
- **Tools** — what you'll need at your bench.
- **Materials** — parts the step consumes.
- **Safety warnings** — red callout boxes. Read these every time, even if you've done it before.
- **Why it matters** — context for why the step exists.
- **Key takeaways** — what to remember after this step.
- **Common mistakes** — stuff people trip on.

At the bottom:

- **Mark step complete** — checks off this step and advances to the next.
- **Bookmark** 🔖 — save this specific step (comes up in Bookmarks).
- **Add a note** 📝 — your private note on this step. No one else sees it.

Some steps have `requiresConfirmation: true` — the **Mark step complete** button asks "Are you sure?" before logging. These are safety-critical steps.

### 4. The quiz

`/modules/{moduleCode}/quiz`

Shown after the last step. Layout:

- Progress dots at the top (one per question).
- Current question + multiple-choice options.
- **Next** advances. **Previous** goes back.

After the last question, **Submit**. You see:

- Pass / fail (default passing score: 80%).
- Your score (e.g. 7/10).
- Each question's correct answer with the explanation from the author.

**Failed the quiz?** You can retake it — each attempt is logged. Some modules allow unlimited retries; some are limited. Module detail tells you.

### 5. My Progress

`/my-progress`

Your dashboard:

- Every module you've been assigned or started.
- Completion bar per module.
- Step counts.
- Estimated time remaining.
- Completion timestamps.

Great Monday-morning view of what's on your plate.

### 6. Assignments

`/assignments`

Modules someone explicitly assigned to you, separated into **Active** and **Past**.

- **Active**: show due date, current progress, direct link to the module.
- **Past**: show score, pass/fail, completion date.

If a due date is overdue, you see a red **Overdue** badge — expect a nudge from your trainer.

### 7. Bookmarks

Tap 🔖 on any module card or step to bookmark it. Bookmarks live at `/bookmarks` (accessible from the nav).

### 8. Notes

Notes you take on steps live with the step. Revisit `/modules/{moduleCode}/step/{stepId}` to see your notes for that step; they're private.

---

## Troubleshooting

| Symptom | Who | What to check |
|---|---|---|
| Published an SOP but a tech can't see the module | Trainer | Module status is `ACTIVE`? SOP's `currentVersion` is set? SOP status is `PUBLISHED`, not `DRAFT`? |
| "Assign Module" button does nothing / shows a toast | Trainer | UI stub in current build; ask admin to assign in the DB while the flow is being finished. |
| Supervisor sign-off stuck | Trainer | UI stub in current build; admin has a manual path. |
| Tech says "quiz won't submit" | Tech | Retry: tap Submit again. If still failing, check they're online. Offline quiz submission isn't supported. |
| "I completed the step but it didn't save" | Tech | Check network. The Training app is NOT offline-first (unlike Floor Tech). Redo once online. |
| Can't find a module I was told I was assigned | Tech | Check **Assignments** tab — if not there, the assignment wasn't actually created. Ask your trainer. |
| Video won't play | Tech | Browser permissions. On the tablet, check pop-up/autoplay settings. |
| Bookmarks disappeared | Tech | Bookmarks are per-user, per-app-session. If you signed in on a different device, they're still in the DB — hard-refresh the page. |

---

## See also

- **[ERP manual](./erp-manual.md)** — full ERP walkthrough; the Training section cross-links here.
- **[Floor Tech manual](./floor-tech-manual.md)** — what techs use for actual work execution.
- **[README](./README.md)** — index and sign-in reference.
