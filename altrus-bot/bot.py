import os
import json
import asyncio
from datetime import datetime, timezone, timedelta
from pathlib import Path

import discord
from discord import app_commands
from discord.ext import tasks
from dotenv import load_dotenv

load_dotenv()

TOKEN = os.getenv("DISCORD_TOKEN")
GUILD_ID = int(os.getenv("GUILD_ID", "0"))
STAFF_ROLE_NAME = os.getenv("STAFF_ROLE_NAME", "MoTZ Staff")

HIDEN_REMINDER_USER_ID = 336858611827474442
HIDEN_PANEL_URL = "https://freepanel.hidencloud.com/server/c000dbe4"
HIDEN_REMINDER_HOUR_PH = 9  # 9 AM PH time

DATA_FILE = Path(__file__).parent / "data.json"
PH_TZ = timezone(timedelta(hours=8))

SHARD_EMOJI = "✨"
SHARD_NAME = "MoTZ Shard of Altruism"
EMBED_TITLE = f"\U0001F3C6 Top Holders of MoTZ Shards"
SCROLL_HEADER = "**The Altrus's Scroll:**"

FLAVOR_TEXT = (
    "**Altrus stands as the eternal Sentinel of MoTZ,**\n"
    "observing every act of mankind within the realm. "
    "Those who serve with heart are bestowed with the "
    "**MoTZ Shard of Altruism**.\n\n"
    "*Holders of shards shall be rewarded soon. "
    "The time is unknown, but the reward is certain.*"
)

intents = discord.Intents.default()
intents.members = True
client = discord.Client(intents=intents)
tree = app_commands.CommandTree(client)


def load_data():
    if not DATA_FILE.exists():
        return {
            "shards": {},
            "leaderboard": {"channel_id": None, "message_id": None},
            "hiden_last_sent": None,
        }
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    data.setdefault("hiden_last_sent", None)
    return data


def save_data(data):
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def has_staff_role(interaction: discord.Interaction) -> bool:
    if not isinstance(interaction.user, discord.Member):
        return False
    return any(r.name == STAFF_ROLE_NAME for r in interaction.user.roles)


async def staff_only(interaction: discord.Interaction) -> bool:
    if has_staff_role(interaction):
        return True
    await interaction.response.send_message(
        f"Staff Only: requires the **{STAFF_ROLE_NAME}** role.", ephemeral=True
    )
    return False


def build_leaderboard_embed(guild: discord.Guild) -> discord.Embed:
    data = load_data()
    shards = data["shards"]

    holders = sorted(shards.items(), key=lambda kv: kv[1], reverse=True)
    holders = [(uid, n) for uid, n in holders if n > 0][:10]

    lines = [SCROLL_HEADER]
    if not holders:
        lines.append("*No shards have been bestowed yet.*")
    else:
        for i, (uid, n) in enumerate(holders, start=1):
            lines.append(f"**{i}.** <@{uid}> — {n} {SHARD_EMOJI}")

    embed = discord.Embed(
        title=EMBED_TITLE,
        description="\n".join(lines),
        color=0x2B2D31,
    )
    now_ph = datetime.now(PH_TZ).strftime("%-m/%-d/%Y %-I:%M %p") if os.name != "nt" \
        else datetime.now(PH_TZ).strftime("%#m/%#d/%Y %#I:%M %p")
    embed.set_footer(text=f"Altrus's Scroll • Auto-updates every minute • {now_ph}")
    return embed


async def refresh_leaderboard():
    data = load_data()
    lb = data["leaderboard"]
    if not lb["channel_id"]:
        return
    guild = client.get_guild(GUILD_ID)
    if not guild:
        return
    channel = guild.get_channel(lb["channel_id"])
    if not channel:
        return

    embed = build_leaderboard_embed(guild)

    msg = None
    if lb["message_id"]:
        try:
            msg = await channel.fetch_message(lb["message_id"])
        except (discord.NotFound, discord.Forbidden):
            msg = None

    needs_repost = msg is None
    if msg is not None:
        recent_ids = [m.id async for m in channel.history(limit=3)]
        if msg.id not in recent_ids:
            needs_repost = True

    if needs_repost:
        if msg is not None:
            try:
                await msg.delete()
            except (discord.NotFound, discord.Forbidden):
                pass
        sent = await channel.send(content=FLAVOR_TEXT, embed=embed)
        data["leaderboard"]["message_id"] = sent.id
        save_data(data)
    else:
        await msg.edit(content=FLAVOR_TEXT, embed=embed)


@tasks.loop(minutes=1)
async def leaderboard_loop():
    try:
        await refresh_leaderboard()
    except Exception as e:
        print(f"[leaderboard_loop] {e}")


HIDEN_REMINDER_START = datetime(2026, 6, 5, tzinfo=PH_TZ).date()


async def maybe_send_hiden_reminder():
    now_ph = datetime.now(PH_TZ)
    today = now_ph.date()
    if today < HIDEN_REMINDER_START:
        return
    if now_ph.weekday() != 4:  # 4 = Friday
        return
    if now_ph.hour < HIDEN_REMINDER_HOUR_PH:
        return

    data = load_data()
    if data.get("hiden_last_sent") == today.isoformat():
        return

    try:
        user = await client.fetch_user(HIDEN_REMINDER_USER_ID)
        await user.send(
            f"⏰ Weekly reminder: visit your HidenCloud panel so the server doesn't expire.\n"
            f"{HIDEN_PANEL_URL}"
        )
        data["hiden_last_sent"] = today.isoformat()
        save_data(data)
    except Exception as e:
        print(f"[hiden_reminder] {e}")


@tasks.loop(minutes=15)
async def hiden_reminder_loop():
    try:
        await maybe_send_hiden_reminder()
    except Exception as e:
        print(f"[hiden_reminder_loop] {e}")


@client.event
async def on_ready():
    guild = discord.Object(id=GUILD_ID)
    tree.copy_global_to(guild=guild)
    await tree.sync(guild=guild)
    if not leaderboard_loop.is_running():
        leaderboard_loop.start()
    if not hiden_reminder_loop.is_running():
        hiden_reminder_loop.start()
    print(f"Logged in as {client.user} | guild={GUILD_ID}")


@tree.command(name="giveshard", description=f"Staff Only: Award a {SHARD_NAME}")
@app_commands.describe(user="Recipient", amount="How many shards (default 1)")
async def giveshard(interaction: discord.Interaction, user: discord.Member, amount: int = 1):
    if not await staff_only(interaction):
        return
    if amount <= 0:
        await interaction.response.send_message("Amount must be positive.", ephemeral=True)
        return
    data = load_data()
    uid = str(user.id)
    data["shards"][uid] = data["shards"].get(uid, 0) + amount
    save_data(data)
    await interaction.response.send_message(
        f"Awarded **{amount}** {SHARD_EMOJI} to {user.mention}. "
        f"They now hold **{data['shards'][uid]}**.",
        ephemeral=False,
    )
    await refresh_leaderboard()


@tree.command(name="takeshard", description=f"Staff Only: Remove a {SHARD_NAME}")
@app_commands.describe(user="Target", amount="How many shards (default 1)")
async def takeshard(interaction: discord.Interaction, user: discord.Member, amount: int = 1):
    if not await staff_only(interaction):
        return
    if amount <= 0:
        await interaction.response.send_message("Amount must be positive.", ephemeral=True)
        return
    data = load_data()
    uid = str(user.id)
    current = data["shards"].get(uid, 0)
    new_val = max(0, current - amount)
    removed = current - new_val
    data["shards"][uid] = new_val
    if new_val == 0:
        data["shards"].pop(uid, None)
    save_data(data)
    await interaction.response.send_message(
        f"Removed **{removed}** {SHARD_EMOJI} from {user.mention}. "
        f"They now hold **{new_val}**.",
        ephemeral=False,
    )
    await refresh_leaderboard()


@tree.command(name="update", description="Staff Only: Manually refresh the leaderboard scroll")
async def update_cmd(interaction: discord.Interaction):
    if not await staff_only(interaction):
        return
    await interaction.response.defer(ephemeral=True)
    await refresh_leaderboard()
    await interaction.followup.send("Scroll refreshed.", ephemeral=True)


@tree.command(name="setleaderboard", description="Staff Only: Bind the leaderboard to this channel")
async def setleaderboard(interaction: discord.Interaction):
    if not await staff_only(interaction):
        return
    data = load_data()
    data["leaderboard"]["channel_id"] = interaction.channel_id
    data["leaderboard"]["message_id"] = None
    save_data(data)
    await interaction.response.send_message(
        f"Leaderboard bound to {interaction.channel.mention}. Posting now…",
        ephemeral=True,
    )
    await refresh_leaderboard()


if __name__ == "__main__":
    if not TOKEN or not GUILD_ID:
        raise SystemExit("Missing DISCORD_TOKEN or GUILD_ID in environment / .env")
    client.run(TOKEN)
