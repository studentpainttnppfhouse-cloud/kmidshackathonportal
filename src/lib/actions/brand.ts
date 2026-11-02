"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { assertCan, isAdmin, requireViewer } from "@/lib/authorize";
import { RULES, rateLimit, retryMessage } from "@/lib/rate-limit";
import { SETTING_KEYS, setSetting } from "@/lib/settings";
import type { FormState } from "@/lib/actions/auth";

/**
 * The brand kit, and the two portal-wide switches that live next to it.
 *
 * Colours and fonts used to be a constant array in the source: adding a shade
 * meant a pull request. They are rows now, which is why every one of these has
 * a permission check — "it is only a colour" is exactly the reasoning that ends
 * with an unauthenticated write endpoint.
 */

const HEX = /^#[0-9A-Fa-f]{6}$/;

const colorSchema = z.object({
  name: z.string().trim().min(1, "Name the colour.").max(60),
  value: z.string().trim().regex(HEX, "Use a six-digit hex colour like #EC4899."),
  groupName: z.string().trim().max(60).optional().or(z.literal("")),
  note: z.string().trim().max(200).optional().or(z.literal("")),
});

const fontSchema = z.object({
  name: z.string().trim().min(1, "Name the font role, e.g. Headings.").max(60),
  // A CSS font stack, not arbitrary CSS: it is rendered into a `style`
  // attribute, so quotes, semicolons and braces would let it escape the
  // property it belongs to and set others.
  value: z
    .string()
    .trim()
    .min(1, "Give the font stack.")
    .max(160)
    .regex(
      /^[A-Za-z0-9 ,._-]+$/,
      "Font names may use letters, numbers, spaces, commas, dots, hyphens and underscores only.",
    ),
  groupName: z.string().trim().max(60).optional().or(z.literal("")),
  note: z.string().trim().max(200).optional().or(z.literal("")),
});

async function requireBrandEditor() {
  const viewer = await requireViewer();
  // The brand kit is portal-wide, so it is a T3 responsibility rather than a
  // departmental one — a head editing "the" primary pink is not a department
  // decision.
  assertCan(viewer, "manage_departments", { kind: "system" });
  return viewer;
}

export async function addBrandColor(_prev: FormState, formData: FormData): Promise<FormState> {
  const viewer = await requireBrandEditor();
  const limit = rateLimit(`write:${viewer.id}`, RULES.write);
  if (!limit.ok) return { error: retryMessage(limit.retryAfter) };

  const parsed = colorSchema.safeParse({
    name: formData.get("name") ?? "",
    value: formData.get("value") ?? "",
    groupName: formData.get("groupName") ?? "",
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const count = await db.brandToken.count({ where: { kind: "color" } });
  if (count >= 200) return { error: "That is a lot of colours. Remove some before adding more." };

  await db.brandToken.create({
    data: {
      kind: "color",
      name: d.name,
      value: d.value.toUpperCase(),
      groupName: d.groupName || null,
      note: d.note || null,
      sortOrder: count,
      createdById: viewer.id,
    },
  });

  await audit(viewer.id, "brand.color.added", { type: "brand", detail: `${d.name} ${d.value}` });
  revalidatePath("/brand");
  return { ok: `${d.name} added to the palette.` };
}

export async function addBrandFont(_prev: FormState, formData: FormData): Promise<FormState> {
  const viewer = await requireBrandEditor();
  const limit = rateLimit(`write:${viewer.id}`, RULES.write);
  if (!limit.ok) return { error: retryMessage(limit.retryAfter) };

  const parsed = fontSchema.safeParse({
    name: formData.get("name") ?? "",
    value: formData.get("value") ?? "",
    groupName: formData.get("groupName") ?? "",
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const count = await db.brandToken.count({ where: { kind: "font" } });
  if (count >= 40) return { error: "Forty fonts is already more than a brand needs." };

  await db.brandToken.create({
    data: {
      kind: "font",
      name: d.name,
      value: d.value,
      groupName: d.groupName || null,
      note: d.note || null,
      sortOrder: count,
      createdById: viewer.id,
    },
  });

  await audit(viewer.id, "brand.font.added", { type: "brand", detail: d.name });
  revalidatePath("/brand");
  return { ok: `${d.name} added.` };
}

export async function updateBrandColor(_prev: FormState, formData: FormData): Promise<FormState> {
  const viewer = await requireBrandEditor();
  const limit = rateLimit(`write:${viewer.id}`, RULES.write);
  if (!limit.ok) return { error: retryMessage(limit.retryAfter) };

  const id = String(formData.get("id") ?? "");
  const parsed = colorSchema.safeParse({
    name: formData.get("name") ?? "",
    value: formData.get("value") ?? "",
    groupName: formData.get("groupName") ?? "",
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const token = await db.brandToken.findUnique({ where: { id }, select: { kind: true } });
  if (!token || token.kind !== "color") return { error: "That colour is gone." };

  await db.brandToken.update({
    where: { id },
    data: { name: d.name, value: d.value.toUpperCase(), groupName: d.groupName || null, note: d.note || null },
  });
  await audit(viewer.id, "brand.color.updated", { type: "brand", detail: `${d.name} ${d.value}` });
  revalidatePath("/brand");
  return { ok: "Saved." };
}

export async function deleteBrandToken(id: string): Promise<void> {
  const viewer = await requireBrandEditor();

  const token = await db.brandToken.findUnique({ where: { id }, select: { name: true } });
  if (!token) return;

  await db.brandToken.delete({ where: { id } });
  await audit(viewer.id, "brand.token.removed", { type: "brand", detail: token.name });
  revalidatePath("/brand");
}

/**
 * Adds a full tint ramp from one colour.
 *
 * The ask was "twenty shades of the scheme" — done by hand that is twenty forms
 * and twenty chances to fat-finger a hex. The ramp is generated by mixing
 * towards white and towards black in even steps, which is what a designer would
 * do with a colour picker, only reproducibly.
 */
export async function addBrandRamp(_prev: FormState, formData: FormData): Promise<FormState> {
  const viewer = await requireBrandEditor();
  const limit = rateLimit(`write:${viewer.id}`, RULES.write);
  if (!limit.ok) return { error: retryMessage(limit.retryAfter) };

  const base = String(formData.get("value") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const stepsRaw = Number(formData.get("steps") ?? 10);

  if (!HEX.test(base)) return { error: "Use a six-digit hex colour like #EC4899." };
  if (name.length < 1 || name.length > 40) return { error: "Name the ramp, e.g. Pink." };
  if (!Number.isInteger(stepsRaw) || stepsRaw < 3 || stepsRaw > 24) {
    return { error: "Pick between 3 and 24 shades." };
  }

  const existing = await db.brandToken.count({ where: { kind: "color" } });
  if (existing + stepsRaw > 200) return { error: "That would push the palette over 200 colours." };

  const shades = buildRamp(base, stepsRaw);

  await db.brandToken.createMany({
    data: shades.map((shade, index) => ({
      kind: "color",
      name: `${name} ${shade.step}`,
      value: shade.hex,
      groupName: name,
      note: index === shades.findIndex((s) => s.hex === base.toUpperCase()) ? "Base colour" : null,
      sortOrder: existing + index,
      createdById: viewer.id,
    })),
  });

  await audit(viewer.id, "brand.ramp.added", { type: "brand", detail: `${name} x${stepsRaw}` });
  revalidatePath("/brand");
  return { ok: `${stepsRaw} shades of ${name} added.` };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/** Tailwind-style step numbers: 50, 100, 200 … 900, 950. */
function buildRamp(base: string, steps: number): { step: number; hex: string }[] {
  const r = parseInt(base.slice(1, 3), 16);
  const g = parseInt(base.slice(3, 5), 16);
  const b = parseInt(base.slice(5, 7), 16);

  const out: { step: number; hex: string }[] = [];
  const middle = Math.floor(steps / 2);

  for (let i = 0; i < steps; i += 1) {
    // -1 at the light end, 0 at the base, +1 at the dark end.
    const position = (i - middle) / Math.max(1, steps - 1 - middle === 0 ? 1 : middle);
    const step = Math.round((i / Math.max(1, steps - 1)) * 900) + 50;

    if (position < 0) {
      const t = Math.min(1, -position) * 0.92;
      out.push({ step, hex: toHex(r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t) });
    } else if (position > 0) {
      const t = Math.min(1, position) * 0.75;
      out.push({ step, hex: toHex(r * (1 - t), g * (1 - t), b * (1 - t)) });
    } else {
      out.push({ step, hex: toHex(r, g, b) });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Portal switches
// ---------------------------------------------------------------------------

export async function setEventPanelVisible(visible: boolean): Promise<void> {
  const viewer = await requireViewer();
  if (!isAdmin(viewer)) return;
  if (typeof visible !== "boolean") return;

  await setSetting(SETTING_KEYS.eventPanel, visible ? "1" : "0");
  await audit(viewer.id, visible ? "event.panel.shown" : "event.panel.hidden");

  revalidatePath("/", "layout");
  revalidatePath("/admin");
  revalidatePath("/event");
}
