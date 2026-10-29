import {
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type GuildMember,
} from "discord.js";

export function isGuildAdmin(interaction: ChatInputCommandInteraction): boolean {
  const member = interaction.member as GuildMember | null;
  if (!member) return false;
  return member.permissions.has(PermissionFlagsBits.ManageGuild);
}

export async function requireGuild(
  interaction: ChatInputCommandInteraction,
): Promise<string | null> {
  if (!interaction.guildId) {
    await interaction.reply({ content: "This command only works in a server.", ephemeral: true });
    return null;
  }
  return interaction.guildId;
}
