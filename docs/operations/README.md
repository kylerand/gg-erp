# Golfin Garage Operator Manuals

Three apps, three audiences. Pick the one that matches your role.

## If you only read one thing

- **Shop manager, sales, parts, accounting, front office, admin, trainer** → open **[the ERP manual](./erp-manual.md)** and sign in at <https://golfingarage.m4nos.com>.
- **Floor technician** → open **[the Floor Tech manual](./floor-tech-manual.md)** and sign in on the bay tablet at <https://floor.golfingarage.m4nos.com>.
- **Trainer or OJT lead setting up training, or technician completing training** → open **[the Training manual](./training-manual.md)**.

## Who uses which app

| Your role | App | Why |
|---|---|---|
| Shop manager | ERP | Dispatch board, reporting, open/blocked triage, planning |
| Sales / front office | ERP | Pipeline, quotes, forecast, customer directory |
| Parts manager | ERP | Inventory, reservations, receiving, manufacturers |
| Accounting | ERP | QuickBooks sync, reconciliation, audit trail |
| Admin | ERP | User access, audit, integrations |
| Trainer / OJT lead | ERP (authoring) + Training app (preview) | Publish SOPs, assign modules to techs, sign off on completions |
| Floor technician | Floor Tech (primary) + Training app (for OJT) | Work queue, time, shift, offline-capable checklist execution; consume assigned training modules |
| Executive | ERP (read-only) | Reporting only |

## Signing in — same for all three apps

All three apps authenticate through Amazon Cognito and support two paths:

1. **Google SSO (recommended)** — any `@golfingarage.com` Google Workspace account. Type your email on the sign-in screen and click **Continue**; you'll be redirected to Google, authenticate once, and land back in the app. No password to remember. You must be an active member of the Workspace org — outside accounts are refused.
2. **Email + password** — for service accounts and anyone not yet on Workspace. Type the email on the sign-in screen, click **Continue**, then enter the password.

A first-time password change may be required; the app will prompt.

## When something breaks

| Symptom | First check | Then |
|---|---|---|
| "Checking authentication…" spinner stays forever after Google sign-in | Hard-refresh the tab | Escalate to your admin if still stuck |
| "Can't sign in — not authorized" from Google | You're signed into a personal Gmail instead of your `@golfingarage.com` account | Switch accounts in the Google chooser |
| Floor tech tablet shows a red offline banner | Check the bay Wi-Fi | Work continues offline — the Sync tab will replay when you're back on Wi-Fi |
| Connect QuickBooks button errors | Intuit session expired — not your problem | Ping the admin; they rotate credentials and retry |
| ⌘K search returns nothing | Search only covers work orders, inventory, and customers today | Use the relevant section's own filter instead |

Deeper troubleshooting lives at the end of each app-specific manual.

## What's in each doc

- **[erp-manual.md](./erp-manual.md)** — 10 nav sections, 8 roles, full workflow walkthroughs, admin surfaces, Copilot chat, offline queue, troubleshooting.
- **[floor-tech-manual.md](./floor-tech-manual.md)** — shift start, working the queue, executing a work order, offline mode, time logging, blocking, handoff, troubleshooting.
- **[training-manual.md](./training-manual.md)** — two parts: trainers/OJT leads working in the ERP to author SOPs and assign modules; technicians working in the standalone Training app to complete them.

## Support / escalation

- Tool breakage, user access requests, integration reconnects: **admin** (`krand40@gmail.com`).
- Bad data in a work order, missing part, wrong dispatch: **shop manager**.
- Training content errors: **trainer / OJT lead**.

## For developers

This folder is end-user documentation. Architecture, deploy flows, and code-level docs live in `docs/architecture/`, `docs/deployment.md`, `docs/dns-setup-golfingarage.md`, and `docs/google-sso-setup.md`.
