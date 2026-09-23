# Background reminders

The live Supabase job `hq-deadline-reminders` runs every five minutes. It calls the existing project/deliverable reminder rules using server time; no browser session is required. All scheduling uses America/Chicago, including legacy timestamps with explicit offsets.

Email notifications are OFF by request. This generates staff inbox notifications; it does not send email or desktop/browser push alerts. Staff see them when they return to HQ, and an open HQ session continues to refresh the inbox.

The worker only processes active, verified staff who have accepted the current NDA. Existing event keys prevent duplicates. Completed, deleted, reassigned, archived, or rescheduled work is reconciled on each check. The worker cannot be called by browser or anonymous roles. The notification UI shows whether automatic checks are current; the status endpoint retains the staff/NDA gate and exposes no other staff details.

## Deployment

Applied to production, with schema history matching these repository files:
- `20260923184209_hq_background_reminders.sql`
- `20260923184345_hq_reminder_status_boundary.sql`

No migration command is needed for the existing production project. Other environments should apply these through the normal Supabase migration workflow after all earlier migrations; do not replay setup SQL.

## Verification and recovery

Inspect `cron.job` for the named job and `cron.job_run_details` for scheduled executions. `private.hq_reminder_runs` records the most recent check and failure count per organization. Database administrators can run `select private.hq_refresh_reminders();` to recover immediately; it uses the same duplicate prevention and a transaction lock. Do not grant this function to client roles.

The first production run checked seven eligible staff with zero failures. Production records and seven signed agreements were preserved. Tests cover execution without a signed-in user, retries, rescheduling, completion, deletion, staff/NDA exclusions, expired scheduler status, denied worker access and legacy Chicago dates.
