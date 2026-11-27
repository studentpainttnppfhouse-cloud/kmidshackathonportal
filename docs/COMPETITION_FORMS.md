# Competition forms (2027 Round 1)

The internal and external Round 1 registration forms are built into the portal's Forms module. They follow `KMIDS_2027_Website_Forms_Plan_and_AI_Instructions.md` (27 November 2026). Per Paint's later request, the external form also asks every member for a national ID card (or passport) and a ปพ.7. The internal form does not (both questions start switched off there; an admin can switch them on under Edit wording).

## Where things are

| Piece | File |
| --- | --- |
| Question wording (the templates) | `src/lib/competition/templates.ts` |
| Shape, validator, Drive link and team ID rules | `src/lib/competition/schema.ts` |
| Install as drafts (runs on every boot, idempotent) | `src/lib/competition/install.ts`, `scripts/db-bootstrap.ts` |
| Registration, Round 1, finalist and lost-link actions | `src/lib/actions/competition-public.ts` |
| Staff actions (settings, publish, review, reopen) | `src/lib/actions/competition-admin.ts` |
| Who may do what | `canCompetition()` in `src/lib/policy.ts` |
| CSV layout | `src/lib/competition/export.ts` |
| Tables | `competition_workflows`, `competition_teams`, `competition_submissions`, `competition_counters` |

## Flow

1. Both forms install as **private drafts**. A draft has no working public link (`/f/...` returns 404).
2. An admin fills in **Organizer settings**. Publishing stays disabled until every item marked "needed to publish" is set: opening and closing times, the closing time confirmed, the rules and privacy links, and the reviewer access method. Internal also needs the deadline confirmed. External also needs the payee, a bank account, PromptPay ID or QR, the refund policy, and the cap decision.
3. The owner presses **Publish**. The form takes registrations only between the opening and closing times (Bangkok time).
4. A team registers (internal A → C → D, external A → B → C → D → E). The server gives it the next ID for its track (`internal01`, `external01`, and so on) inside a transaction, so two registrations at the same moment never share a number. A retried submit returns the same team.
5. The receipt shows a **private team link** (a 256-bit secret, stored only as a hash). It is also emailed to Member 1 when Resend is set up. Lost links are re-sent to Member 1's inbox from `/f/<form>/recover`, and are never shown on screen there.
6. Through that link the team submits **Part F**: one Google Drive folder link plus the declarations. After a review step it is final and locked on the server.
7. Staff record that they made an organizer copy of the folder ("Record archive"). A saved link does not freeze Drive files.
8. **Stage H** (finalist confirmation) stays off until the owner turns it on. That needs the guardian consent text first. Even then, only teams marked as finalists can open it.

## Access

| | Owner | Admin | Head | Member, Advisor, signed out |
| --- | --- | --- | --- | --- |
| See forms, teams, export registrations and Round 1 | yes | yes | yes | no |
| Change review statuses (payment, access checked, notes) | yes | yes | yes | no |
| Edit wording and settings, choose finalists, export H | yes | yes | no | no |
| Open national ID and ปพ.7 files | yes | yes | no | no |
| Publish or take down | yes | if the owner delegates | no | no |
| Turn on stage H, reopen a locked entry (logged, with a reason) | yes | no | no | no |

## Still to decide

These are listed on each form's page and are never guessed: payee and QR, refund policy, the cap and how it is counted, the closing time, the internal deadline, the rules and privacy links, the reviewer access method, the guardian consent text, and the final prompt and AI rules.
