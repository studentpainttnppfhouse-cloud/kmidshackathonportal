import type { PrismaClient } from "@prisma/client";
import { TRACKS, type Track } from "./schema";
import { TEMPLATE_KEY, TEMPLATE_YEAR, buildTemplate } from "./templates";

/**
 * Puts the two 2027 competition forms on the Forms page, as private drafts.
 *
 * Safe to run on every boot. Each installed copy carries an `installKey`
 * (year, track, template), so a second run finds it and does nothing: it never
 * overwrites an edited form, never reopens a closed one and never touches a
 * registration. Deleting the installed copy is the only way to get a fresh one.
 *
 * No `server-only` import here: `scripts/db-bootstrap.ts` runs this outside
 * Next.js with its own Prisma client.
 */
export function installKeyFor(track: Track): string {
  return `${TEMPLATE_YEAR}:${track}:${TEMPLATE_KEY}`;
}

export async function installCompetitionTemplates(
  db: PrismaClient,
  ownerId?: string,
): Promise<{ created: Track[]; ownerFound: boolean }> {
  const owner = ownerId
    ? { id: ownerId }
    : await db.user.findFirst({
        where: { tier: "T4_OWNER", deletedAt: null },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
  if (!owner) return { created: [], ownerFound: false };

  const created: Track[] = [];
  for (const track of TRACKS) {
    const installKey = installKeyFor(track);
    const existing = await db.competitionWorkflow.findUnique({ where: { installKey }, select: { id: true } });
    if (existing) continue;

    const definition = buildTemplate(track);
    const slug = await freeSlug(db, `hackathon-2027-${track}-registration`);

    try {
      await db.$transaction(async (tx) => {
        const form = await tx.form.create({
          data: {
            title: definition.title,
            description:
              track === "internal"
                ? "Round 1 registration and submission for KMIDS-only teams. Draft until the owner publishes it."
                : "Round 1 registration, payment and submission for teams outside KMIDS. Draft until the owner publishes it.",
            // "internal" here means built in the portal, not the KMIDS track.
            type: "internal",
            slug,
            ownerId: owner.id,
            departmentId: null,
            isOpen: false,
            year: TEMPLATE_YEAR,
            schema: undefined,
          },
          select: { id: true },
        });
        await tx.competitionWorkflow.create({
          data: {
            formId: form.id,
            year: TEMPLATE_YEAR,
            track,
            templateKey: TEMPLATE_KEY,
            installKey,
            status: "draft",
            settings: {},
            definition,
            version: 1,
          },
        });
      });
      created.push(track);
    } catch (error) {
      // Two boots racing: the other one won the unique installKey. Fine.
      const code = (error as { code?: string }).code;
      if (code !== "P2002") throw error;
    }
  }

  return { created, ownerFound: true };
}

async function freeSlug(db: PrismaClient, base: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const clash = await db.form.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!clash) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}
