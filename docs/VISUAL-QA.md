# Northside HQ visual QA

## Scope and method

Inspected the running local application in Chrome at 1440px desktop, 1024px tablet, and 390px mobile. Reviewed full-page captures and first-screen views for Overview, Work, Calendar, Campaigns, Content, Results, Assets, Team, Settings, and Login. Browser checks used isolated sample and empty responses, clearly labeled in the preview. No production records, authentication policies, or API mutation handlers were changed.

Every page was assessed for identity, first-screen priority, next action, copy length, crowding, card alignment, spacing, button hierarchy, plain labels, empty states, form grouping, desktop composition, and navigation consistency. Not every page needed a code change.

## Page findings and corrections

| Page | Findings and outcome |
| --- | --- |
| Overview | Identity and attention hierarchy clear. Tightened attention-row spacing, stopped Quick Actions stretching to match the taller activity panel, and aligned lifecycle wording with Campaigns. |
| Work | Priority views, populated task rows, and empty states readable. Preserved existing layout and checked desktop/tablet/mobile reflow. |
| Calendar | Missing separation between the visual agenda and advanced date tools; small category/count text. Restored spacing and increased metadata size. Week controls and selected-day details remain clear. |
| Campaigns | Card heights and next-action alignment retained. Increased lifecycle metadata legibility and checked stage wrapping on tablet/mobile. |
| Content | Source selector width did not align with the surrounding fields. Standardized field widths and increased small-screen step labels. Existing five-step workflow preserved. |
| Results | Summary cards, actual source bars, and secondary entry controls already had a clear hierarchy. Checked reporting scope, empty state, card alignment, and responsive wrapping. |
| Assets | Upload action absent from page header. Added a header shortcut to the existing upload control; verified media-card alignment and filenames. Retained the existing shared studio. |
| Team | Full-width staff cards wasted space; long access guidance led the page. Introduced aligned responsive cards, plain role labels, expandable access requirements, and an actionable empty state. Existing access editor and permissions retained. |
| Settings | Three broad vertical panels created long text lines. Arranged export and appearance in equal columns, with a bounded guide below. Browser reinspection caught and fixed a notification container occupying a grid cell. |
| Login | Form sizing and button color diverged from the shared system. Standardized typography, border radius, colors, and mobile margins while retaining clear identity and recovery/access links. |

## Validation

- `pnpm test`: 90 passing tests.
- `pnpm run typecheck`: passed.
- `pnpm run lint`: passed with the same three existing warnings (asset image, login navigation, sign-out navigation).
- `pnpm run build`: passed.
- Browser: all ten pages at all three widths, no horizontal overflow or uncaught page errors.
- Additional visual/interaction checks: mobile navigation, staff access editor and cancel, theme switching, populated media cards, and empty states. Settings and workflow label changes were reinspected after the final correction.

## Later UX work

- Assets and Content still share the same editing studio. A dedicated browsing-first media library would be a separate product change.
- Larger real task queues and busy calendars may benefit from further list navigation and density tuning after observing staff use.
- This review validates local presentation and navigation with controlled data. Real authenticated roles, live integrations, and production-scale data remain deployment checks; no live login or production mutation was attempted.

## Delivery

The preceding section-layout work is published as draft PR #5: https://github.com/Cookarelli/northside-hq/pull/5. This presentation-only QA pass is saved separately on `codex/hq-visual-qa`. It has not been merged or deployed.
