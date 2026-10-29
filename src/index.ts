import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
} from "discord.js";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { config } from "./config.js";
import { db } from "./db/client.js";
import { handleChallenge, handleChallengeAutocomplete, handleLeaderboardButton } from "./commands/challenge.js";
import { handleHevy } from "./commands/hevy.js";
import {
  handleCompare,
  handlePr,
  handleSearchAutocomplete,
  handleStats,
  handleWorkout,
} from "./commands/search.js";
import { handleSetup } from "./commands/setup.js";
import { startPoller } from "./hevy/poller.js";

// Apply migrations on boot
try {
  migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Database migrations OK");
} catch (err) {
  console.error("Migration failed:", err);
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel],
});

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  startPoller(client);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isAutocomplete()) {
      const name = interaction.commandName;
      if (name === "challenge") await handleChallengeAutocomplete(interaction);
      else if (name === "stats" || name === "compare" || name === "workout") {
        await handleSearchAutocomplete(interaction);
      }
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId.startsWith("lb:")) {
        await handleLeaderboardButton(interaction);
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    switch (interaction.commandName) {
      case "hevy":
        await handleHevy(interaction);
        break;
      case "setup":
        await handleSetup(interaction);
        break;
      case "challenge":
        await handleChallenge(interaction);
        break;
      case "workout":
        await handleWorkout(interaction);
        break;
      case "stats":
        await handleStats(interaction);
        break;
      case "compare":
        await handleCompare(interaction);
        break;
      case "pr":
        await handlePr(interaction);
        break;
      default:
        break;
    }
  } catch (err) {
    console.error("Interaction error:", err);
    const msg = "Something went wrong running that command.";
    if (interaction.isRepliable()) {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: msg, ephemeral: true }).catch(() => undefined);
      } else {
        await interaction.reply({ content: msg, ephemeral: true }).catch(() => undefined);
      }
    }
  }
});

client.login(config.DISCORD_TOKEN);
