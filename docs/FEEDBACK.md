# Player feedback workflow

Open **Village menu → Settings & help → Bugs & ideas**. Choose Bug report or Update idea, add a short title and details, and submit. Reports, review notes and status survive game restarts. Players see only their own submissions. Local drafts and pending receipts survive closing the menu; retrying an uncertain submission uses the same receipt so it is not duplicated.

The existing trusted administrator account also sees **Review inbox** in this panel. Review by status or type, add a note, and choose New, Needs info, Confirmed, Planned, Resolved, Not reproduced or Duplicate. Notes are visible to the reporter; do not put credentials or unrelated private information in them. Every changed status/note has an audit entry.

At ten open reports the inbox displays **Ready for review batch**. New, Needs info, Confirmed and Planned count as open. This indicator is a reminder to review, not an automatic release trigger. Group duplicates, reproduce reported problems, choose the next update's scope and validate the changes before publishing.

**Export this page** downloads the current filtered page as JSON. Each page includes `nextCursor`; use Older/Newer to review the rest. Authenticated admin tooling may also use `/api/feedback/export?format=markdown` or `format=json`, with `status`, `kind`, `limit` (1–50) and `before` filters. Exports contain reporter account IDs and submitted text; keep them within the review workflow.

Reports accept a 3–100-character title and 10–3,000-character description. The server permits five new submissions per minute and twenty per day per account; retrying the same saved submission does not consume an extra slot. The build number and current village/day are recorded by the server. The game stores these reports in its existing persistent database; no external messaging or background AI review is configured.
