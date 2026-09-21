# Northside HQ section layouts

All five primary sections use the foundation's page header, primary action, summary, focused work area, and secondary details. No database schemas, API mutation handlers, authentication, or production records are changed by this pass.

## Work

My Tasks, Due Today, Upcoming, Overdue, and Completed group saved assignments. All Tasks retains access to unscheduled, unassigned, and closed-campaign records. Rows expose campaign context, owner, due date, status, and an action. Search and helpful empty states replace a dense default list. Incoming editorial handoffs remain in an expandable secondary area. Dates use Central time; closed campaigns are excluded from open-task groups.

## Calendar

Week, Month, Today, previous/next, and category filters introduce a visual schedule above a selected-day agenda. Categories are labeled Content, Auction, Release, Event, and Operations with restrained color. Existing date editing, recurring series, and legacy entries remain accessible below. Overview date-range links still open their exact filtered agenda.

## Campaigns

Cards show campaign type, saved status, owner, recorded dates, progress, and next action. Consignment stages are Open, Midweek, 48 Hours, Closing Day, and Results; missing stages are explicit and cannot count as complete. Campaign details lead with the next action. Briefs, permissions, allocations, budget approvals, actual spend, deliverables, and discussion remain intact. Tracking and launch utilities are secondary.

## Content

The Content page defaults to the five-step studio: Upload, Review, Edit, Approve, Schedule. Step markers distinguish current, completed, and unfinished work. Only the active step's controls appear. Asset upload, original-file mode, transcript import and scanning, manual clips, timing/caption edits, saved jobs, and editing recipe export remain available. Editing a clip clears its export approval. Scheduling is explicitly manual, and clip export approval is separate from campaign owner approval. Existing posts and review tools remain under Posts & Reviews, including direct post links.

## Results

Ad Spend, Tracked Revenue, Orders, and Leads lead the page, followed by actual source summaries. Reporting scope remains visible. Filters, JSON export, attribution definitions, raw rows, and entry/import remain accessible below. Add Results opens the entry area. Empty reporting shows unavailable values rather than invented totals. Online and POS revenue use the existing reconciliation rules.

## Verification

90 tests cover existing data integrity plus task grouping, unfinished publication dates, five-stage completion, next-action selection, date boundaries, and reporting aggregation. Typecheck, lint, and production build pass; lint retains three pre-existing warnings. Responsive and interaction verification uses isolated intercepted sample responses, never production writes.
