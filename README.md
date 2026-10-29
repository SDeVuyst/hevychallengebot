# HevyBot

Discord bot for [Hevy](https://www.hevyapp.com/) workout notifications, gym challenges with tier bonuses, and Hevy-backed search/compare stats. Designed to run on a VPS with Docker Compose.

## Features

- **Workout notifications** — polls each linked user's Hevy account and posts key details to a channel
- **Challenges** — admin picks exercises and 5 targets per exercise (metric chosen per target); auto-detect from Hevy or manual submit; bonus points when you complete a full "row" across all exercises
- **Leaderboards** — overall (total/bonus), per-exercise board, personal progress matrix, compact standings; live announcements; final podium on close
- **Search / compare** — recent workouts, exercise stats, PRs, user and exercise compare

## Requirements

- Node 20+ (or Docker)
- A Discord application + bot token
- Each member who wants auto-sync needs **Hevy Pro** and an API key from [hevy.com/settings?developer](https://hevy.com/settings?developer)

Hevy has no public webhooks or multi-user OAuth — the bot stores encrypted per-user API keys and polls `GET /v1/workouts/events`.

## Quick start (VPS / Docker)

1. Create a Discord application at [Discord Developer Portal](https://discord.com/developers/applications). Enable the bot, copy the token and application ID. Invite the bot with `bot` + `applications.commands` scopes and permission to send messages in your notify channel.

2. Clone this repo on the VPS and configure env:

```bash
cp .env.example .env
# edit .env
openssl rand -hex 32   # paste into ENCRYPTION_KEY
```

3. Start the bot:

```bash
docker compose up -d --build
docker compose logs -f
```

4. Register slash commands (from the running container):

```bash
docker compose exec bot node dist/commands/register.js
```

Set `GUILD_ID` in `.env` for instant guild sync; omit it for global commands (can take up to ~1 hour).

SQLite lives in the `hevybot-data` volume (`DATABASE_PATH=/app/data/hevybot.db`). Back it up periodically.

## Local development

```bash
cp .env.example .env
npm ci
npx drizzle-kit generate   # if schema changed
npm run db:migrate
npx tsx src/commands/register.ts
npm run dev
```

## Discord setup commands

| Command | Who | Purpose |
|---|---|---|
| `/setup notify-channel` | Admin | Workout notification channel |
| `/setup challenge-channel` | Admin | Challenge progress announcements (optional; falls back to notify) |
| `/setup poll` | Admin | Enable/disable polling |
| `/hevy link` | Everyone | Link Hevy Pro API key (ephemeral) |
| `/challenge create` / `add-exercise` / `set-target` / `activate` / `close` | Admin | Challenge lifecycle |
| `/challenge submit` / `progress` / `leaderboard` / `board` / `standings` | Everyone | Play & boards |
| `/workout` `/stats` `/compare` `/pr` | Everyone | Hevy-backed search |

## Challenge scoring

- 1 point per tier hit per exercise (tiers 1–5)
- **Bonus:** if you have at least *k* tiers on **every** exercise, you get +1 bonus for that *k*
- Total = tier points + bonus

### Target metrics (admin picks per tier)

- `weight_reps` — e.g. ≥100 kg × ≥5 reps in one working set (`value` + `reps`)
- `e1rm` — estimated 1RM via Epley: `weight * (1 + reps/30)`
- `session_volume` — sum of weight×reps for that exercise in one workout
- `reps` — single-set or session total reps
- `duration` — seconds

## Environment

| Variable | Required | Description |
|---|---|---|
| `DISCORD_TOKEN` | yes | Bot token |
| `DISCORD_CLIENT_ID` | yes | Application ID |
| `ENCRYPTION_KEY` | yes | 64 hex chars (`openssl rand -hex 32`) |
| `GUILD_ID` | no | Instant slash-command sync while developing |
| `POLL_INTERVAL_MS` | no | Default `180000` (3 min) + jitter |
| `DATABASE_PATH` | no | Default `./data/hevybot.db` |

## License

MIT
