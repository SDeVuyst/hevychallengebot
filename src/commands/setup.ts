import { ChannelType, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { guildSettings } from "../db/schema.js";
import { isGuildAdmin, requireGuild } from "../util/permissions.js";

export const setupCommand = new SlashCommandBuilder()
  .setName("setup")
  .setDescription("Configure HevyBot for this server")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) =>
    s
      .setName("notify-channel")
      .setDescription("Channel for new workout notifications")
      .addChannelOption((o) =>
        o
          .setName("channel")
          .setDescription("Text channel")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("challenge-channel")
      .setDescription("Channel for challenge progress announcements")
      .addChannelOption((o) =>
        o
          .setName("channel")
          .setDescription("Text channel")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("poll")
      .setDescription("Enable or disable Hevy polling for this server")
      .addBooleanOption((o) => o.setName("enabled").setDescription("Poll enabled").setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName("weight-unit")
      .setDescription("Default display unit for weights")
      .addStringOption((o) =>
        o
          .setName("unit")
          .setDescription("kg or lbs")
          .setRequired(true)
          .addChoices({ name: "kg", value: "kg" }, { name: "lbs", value: "lbs" }),
      ),
  );

async function upsertGuild(guildId: string, patch: Partial<typeof guildSettings.$inferInsert>) {
  const existing = await db.select().from(guildSettings).where(eq(guildSettings.guildId, guildId));
  if (!existing.length) {
    await db.insert(guildSettings).values({ guildId, ...patch });
  } else {
    await db.update(guildSettings).set(patch).where(eq(guildSettings.guildId, guildId));
  }
}

export async function handleSetup(interaction: ChatInputCommandInteraction) {
  const guildId = await requireGuild(interaction);
  if (!guildId) return;
  if (!isGuildAdmin(interaction)) {
    await interaction.reply({ content: "Requires Manage Server permission.", ephemeral: true });
    return;
  }

  const sub = interaction.options.getSubcommand();

  if (sub === "notify-channel") {
    const channel = interaction.options.getChannel("channel", true);
    await upsertGuild(guildId, { notifyChannelId: channel.id });
    await interaction.reply({ content: `Workout notifications → <#${channel.id}>`, ephemeral: true });
    return;
  }

  if (sub === "challenge-channel") {
    const channel = interaction.options.getChannel("channel", true);
    await upsertGuild(guildId, { challengeChannelId: channel.id });
    await interaction.reply({ content: `Challenge announcements → <#${channel.id}>`, ephemeral: true });
    return;
  }

  if (sub === "poll") {
    const enabled = interaction.options.getBoolean("enabled", true);
    await upsertGuild(guildId, { pollEnabled: enabled });
    await interaction.reply({ content: `Polling ${enabled ? "enabled" : "disabled"}.`, ephemeral: true });
    return;
  }

  if (sub === "weight-unit") {
    const unit = interaction.options.getString("unit", true) as "kg" | "lbs";
    await upsertGuild(guildId, { weightUnit: unit });
    await interaction.reply({ content: `Default weight unit set to **${unit}**.`, ephemeral: true });
  }
}
