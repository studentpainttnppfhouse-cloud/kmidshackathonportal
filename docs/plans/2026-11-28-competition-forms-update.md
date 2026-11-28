# Competition forms update (28 November 2026)

Paint's decisions on the open items from the first version, and the work they turn into.

## Decisions

| Item | Decision |
| --- | --- |
| Opening time | 11 December 2026, 09:09:00 Bangkok, both tracks |
| Closing time | 14 February 2027, 23:59:59 Bangkok, both tracks (registration and Round 1) |
| Internal deadline | Same as external, exactly |
| Rules & Information | Shown inside the site: a pop-up on the form and its own page teams can return to. The link and content come from Paint later. |
| Privacy notice (PDPA) | Drafted for Paint to confirm. Not published until confirmed. |
| Reviewer access | No longer needed to publish. Replaced by a judging system for both tracks together. |
| External cap | 150 teams. Strictly first come, first served in the database. The 151st gets "Registration is full". |
| Refund and withdrawal | No refunds and no withdrawals. Shown as a pop-up. |
| Payment | Payee to be confirmed (likely the school). Payment details are editable text plus images. Teams attach the slip. |
| Consent forms | Two parts. Round 1 consent opens once staff confirm the team's registration and documents. Round 2 consent opens for finalists. Links are emailed to every member's registered email. Teams can return any time before the event to fill in and sign. |
| Email | Send and resend from the portal. Sender and reply-to (help@ on the event domain) are set by Paint through `MAIL_FROM` and `MAIL_REPLY_TO`. |

## Work

1. **Settings, cap and pop-ups** (agent A): fill in the agreed defaults once, enforce the 150 cap in the registration transaction, add the rules / privacy / refund pop-ups and the rules page, editable payment details with images, and update the publish checklist.
2. **Judging** (agent B): judges (portal accounts added by admins) score Round 1 entries from both tracks on one page against an editable rubric. Admins see results per track and export them.
3. **Consent and email** (agent C): two-part consent with per-member guardian and student signatures, unlocked by staff acceptance (Round 1) and finalist selection (Round 2). Email to all members, a resend button, and `MAIL_REPLY_TO`.
4. **Drafts** (agent D): privacy notice draft for confirmation, plus refund policy and consent wording.

Shared groundwork (new settings fields in `src/lib/competition/schema.ts`) lands first, so the agents work on separate files.
