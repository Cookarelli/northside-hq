# Executive Overview

The default `/today` page is the Northside HQ executive command center. It uses the visual foundation's shell, responsive navigation, theme, and shared components.

## Page hierarchy

1. **Northside HQ:** smaller time-aware Central-time greeting using the signed-in staff name from the existing HQ context, followed by “Here's what's happening at Northside.”
2. **Today / This Week / Needs Attention / Upcoming:** four linked status cards.
3. **Needs Attention:** prioritized actionable records with reason, assignee, recorded date, status, and one action. The first five are visible, with an expandable full list.
4. **Today / This Week:** seven dates, item counts, and short previews. Each day opens a matching Calendar date range.
5. **Active Campaigns:** saved active projects and unfinished calendar campaigns, task or stage completion, owner, dates, and next step. Consignment campaigns display all five defined stages, with absent stages labeled “Not added.”
6. **Quick Actions and Recent Activity:** four working creation/upload links, plus up to five recorded task/campaign changes.

## Count and data rules

- Existing authorized `/api/records` pages, `/api/hq` staff context, and `/api/content-radar/editorial` supply data. No backend/schema/permission changes or production seed records are introduced.
- Today is the current Central-time calendar day. This Week is today through six days later. Upcoming is the following seven-to-29-day window, within 30 days of today.
- The Overview and its filtered Calendar view call the same agenda function. Posts are counted once per recorded time, even if multiple platforms share it. Separate production deadlines and campaign milestones are separate commitments.
- Planned, scheduled, and published times remain distinct. A changed confirmed time takes precedence for its platform. Recurring Tuesday templates expand within the requested range; they are not treated as newly published posts.
- Adopted posts/campaigns are excluded from legacy totals and displayed from their current HQ records. Completed/archived projects do not enter active-work counts.
- A publishing task requires all intended platforms to be confirmed published before contributing completion, unless the existing workflow explicitly marks the task Done. An absent stage is never complete.
- Missing launch requirements appear only when a saved launch plan exists. The default budget/plan is not imported into the Overview.
- A failed workspace read shows an error, not zero counts. Failed or capped Content review reads label the attention count as incomplete.
- Recent Activity uses actual task/campaign creation/update and review timestamps. Unknown updaters are not attributed to the record creator. Invalid or future timestamps are omitted. This is a latest-changes view, not a reconstructed audit trail.

## Navigation

- Overview summary/day links: `/calendar?view=overview&from=YYYY-MM-DD&to=YYYY-MM-DD`.
- Calendar preserves its detailed publication/production views and existing editors.
- Add Task: `/work#new-task`; New Campaign: `/projects#new-campaign`.
- Create Post: `/content#new-post`; editorial review: `/content#post-<id>`.
- Upload Asset: `/assets#upload-asset`, focusing the existing upload control.
- Legacy campaign links open existing campaign tools; legacy post links open the existing calendar editor.

## Verification

- 83 tests pass, including 13 Overview-specific tests covering empty data, adoption deduplication, exact calendar boundaries/DST, confirmed publishing times, incomplete stage/platform completion, review attention, saved launch data, activity provenance, and date-range validation.
- Typecheck and production build pass.
- Lint passes with three pre-existing warnings: an asset image and two authentication navigation calls.
- Browser checks pass at 1440 × 1100, 1024 × 1000, and 390 × 844; no horizontal overflow or unexpected browser errors.
- Verified KPI/day links and matching Calendar counts; all four quick actions; editorial save/cancel behavior; review and legacy links; dark mode; mobile navigation; empty, loading, partial failure, retry, and workspace failure states.
- Browser screenshots use isolated intercepted test responses, visibly labeled “LOCAL VERIFICATION.” They do not show production records, and no production data was created or changed.
