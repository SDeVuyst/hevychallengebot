import {
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { userLinks } from "../db/schema.js";
import { HevyApiError, HevyClient } from "../hevy/client.js";
import { encrypt } from "../hevy/crypto.js";
import { nowIso } from "../util/time.js";
import { requireGuild } from "../util/permissions.js";

export const hevyCommand = new SlashCommandBuilder()
  .setName("hevy")
  .setDescription("Link your Hevy account")
  .addSubcommand((s) =>
    s
      .setName("link")
      .setDescription("Link your Hevy Pro API key (ephemeral)")
      .addStringOption((o) =>
        o.setName("api_key").setDescription("API key from hevy.com/settings?developer").setRequired(true),
      ),
  )
  .addSubcommand((s) => s.setName("unlink").setDescription("Remove your linked Hevy API key"))
  .addSubcommand((s) => s.setName("status").setDescription("Show your Hevy link status"));

export async function handleHevy(interaction: ChatInputCommandInteraction) {
  const guildId = await requireGuild(interaction);
  if (!guildId) return;

  const sub = interaction.options.getSubcommand();

  if (sub === "link") {
    const apiKey = interaction.options.getString("api_key", true).trim();
    await interaction.deferReply({ ephemeral: true });
    try {
      const client = new HevyClient(apiKey);
      const info = await client.getUserInfo();
      const now = nowIso();
      const enc = encrypt(apiKey);
      await db
        .insert(userLinks)
        .values({
          guildId,
          discordUserId: interaction.user.id,
          hevyApiKeyEnc: enc,
          hevyUserId: info.id,
          hevyUsername: info.username,
          hevyName: info.name ?? null,
          weightUnit: info.weight_unit ?? "kg",
          lastPolledAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [userLinks.guildId, userLinks.discordUserId],
          set: {
            hevyApiKeyEnc: enc,
            hevyUserId: info.id,
            hevyUsername: info.username,
            hevyName: info.name ?? null,
            weightUnit: info.weight_unit ?? "kg",
            updatedAt: now,
          },
        });
      await interaction.editReply(
        `Linked as **${info.username}**${info.is_pro === false ? " (warning: Hevy Pro is required for the API)" : ""}.`,
      );
    } catch (err) {
      const msg =
        err instanceof HevyApiError
          ? `Hevy rejected the key (${err.status}). Get a Pro API key at https://hevy.com/settings?developer`
          : "Failed to verify API key.";
      await interaction.editReply(msg);
    }
    return;
  }

  if (sub === "unlink") {
    await db
      .delete(userLinks)
      .where(and(eq(userLinks.guildId, guildId), eq(userLinks.discordUserId, interaction.user.id)));
    await interaction.reply({ content: "Hevy link removed.", ephemeral: true });
    return;
  }

  if (sub === "status") {
    const rows = await db
      .select()
      .from(userLinks)
      .where(and(eq(userLinks.guildId, guildId), eq(userLinks.discordUserId, interaction.user.id)));
    const link = rows[0];
    if (!link) {
      await interaction.reply({
        content: "Not linked. Use `/hevy link` with your API key from https://hevy.com/settings?developer",
        ephemeral: true,
      });
      return;
    }
    await interaction.reply({
      content: `Linked as **${link.hevyUsername ?? "unknown"}** · last polled: ${link.lastPolledAt ?? "never"}`,
      ephemeral: true,
    });
  }
}

export async function handleHevyAutocomplete(_interaction: AutocompleteInteraction) {
  // no autocomplete on hevy
}
