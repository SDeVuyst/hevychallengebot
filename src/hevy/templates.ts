import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { userLinks } from "../db/schema.js";
import { HevyClient } from "./client.js";
import { decrypt } from "./crypto.js";
import type { HevyExerciseTemplate } from "./types.js";

const cache = new Map<string, { at: number; templates: HevyExerciseTemplate[] }>();
const TTL_MS = 30 * 60_000;

export async function getTemplatesForGuild(guildId: string): Promise<HevyExerciseTemplate[]> {
  const cached = cache.get(guildId);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.templates;

  const links = await db.select().from(userLinks).where(eq(userLinks.guildId, guildId));
  if (!links.length) return cached?.templates ?? [];

  // Prefer any linked user (admin usually links first)
  for (const link of links) {
    try {
      const key = decrypt(link.hevyApiKeyEnc);
      const client = new HevyClient(key);
      const templates = await client.getAllExerciseTemplates();
      cache.set(guildId, { at: Date.now(), templates });
      return templates;
    } catch {
      continue;
    }
  }
  return cached?.templates ?? [];
}

export async function searchTemplates(
  guildId: string,
  query: string,
  limit = 25,
): Promise<HevyExerciseTemplate[]> {
  const templates = await getTemplatesForGuild(guildId);
  const q = query.trim().toLowerCase();
  if (!q) return templates.slice(0, limit);
  return templates.filter((t) => t.title.toLowerCase().includes(q)).slice(0, limit);
}

export async function findTemplateByTitle(
  guildId: string,
  title: string,
): Promise<HevyExerciseTemplate | null> {
  const templates = await getTemplatesForGuild(guildId);
  const exact = templates.find((t) => t.title.toLowerCase() === title.toLowerCase());
  if (exact) return exact;
  const partial = templates.find((t) => t.title.toLowerCase().includes(title.toLowerCase()));
  return partial ?? null;
}
