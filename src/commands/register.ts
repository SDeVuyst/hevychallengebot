import { REST, Routes } from "discord.js";
import { config } from "../config.js";
import { challengeCommand } from "./challenge.js";
import { hevyCommand } from "./hevy.js";
import { compareCommand, prCommand, statsCommand, workoutCommand } from "./search.js";
import { setupCommand } from "./setup.js";

const commands = [
  hevyCommand,
  setupCommand,
  challengeCommand,
  workoutCommand,
  statsCommand,
  compareCommand,
  prCommand,
].map((c) => c.toJSON());

const rest = new REST({ version: "10" }).setToken(config.DISCORD_TOKEN);

async function main() {
  if (config.GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, config.GUILD_ID), {
      body: commands,
    });
    console.log(`Registered ${commands.length} guild commands to ${config.GUILD_ID}`);
  } else {
    await rest.put(Routes.applicationCommands(config.DISCORD_CLIENT_ID), { body: commands });
    console.log(`Registered ${commands.length} global commands`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
