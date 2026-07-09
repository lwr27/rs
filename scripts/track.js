const fs = require("fs");
const path = require("path");

const SKILLS = [
  "Overall", "Attack", "Defence", "Strength", "Hitpoints", "Ranged",
  "Prayer", "Magic", "Cooking", "Woodcutting", "Fletching", "Fishing",
  "Firemaking", "Crafting", "Smithing", "Mining", "Herblore", "Agility",
  "Thieving", "Slayer", "Farming", "Runecrafting", "Hunter", "Construction"
];

const MODE_PATH = {
  normal: "hiscore_oldschool",
  ironman: "hiscore_oldschool_ironman",
  hardcore_ironman: "hiscore_oldschool_hardcore_ironman",
  ultimate: "hiscore_oldschool_ultimate"
};

const DATA_DIR = path.join(__dirname, "..", "data");
const SNAPSHOT_DIR = path.join(DATA_DIR, "snapshots");
const PLAYERS_FILE = path.join(DATA_DIR, "players.json");
const LATEST_FILE = path.join(DATA_DIR, "latest.json");

function loadPlayers() {
  return JSON.parse(fs.readFileSync(PLAYERS_FILE, "utf8"));
}

function snapshotPath(username) {
  return path.join(SNAPSHOT_DIR, `${username.toLowerCase()}.json`);
}

async function fetchStats(username, mode) {
  const modePath = MODE_PATH[mode] || MODE_PATH.normal;
  const url = `https://secure.runescape.com/m=${modePath}/index_lite.ws?player=${encodeURIComponent(username)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "osrs-xp-tracker (personal project, github.com)" }
  });
  if (!res.ok) {
    throw new Error(`Hiscores request failed for ${username}: ${res.status}`);
  }
  const text = (await res.text()).trim();
  const lines = text.split("\n");
  const stats = {};
  SKILLS.forEach((skill, i) => {
    const parts = (lines[i] || "-1,-1,-1").split(",").map(Number);
    const [rank, level, xp] = parts;
    stats[skill] = { rank, level: level < 0 ? 0 : level, xp: xp < 0 ? 0 : xp };
  });
  return stats;
}

function loadPreviousSnapshot(username) {
  const file = snapshotPath(username);
  if (!fs.existsSync(file)) return null;
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  return raw.history && raw.history.length
    ? raw.history[raw.history.length - 1]
    : null;
}

function diffXp(prevStats, currStats) {
  const gains = {};
  let totalGain = 0;
  for (const skill of SKILLS) {
    const prevXp = prevStats?.[skill]?.xp ?? currStats[skill].xp;
    const delta = currStats[skill].xp - prevXp;
    if (delta > 0) {
      gains[skill] = delta;
      if (skill !== "Overall") totalGain += delta;
    }
  }
  return { gains, totalGain };
}

function appendSnapshot(username, entry) {
  const file = snapshotPath(username);
  let raw = { username, history: [] };
  if (fs.existsSync(file)) {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  }
  raw.history.push(entry);
  // Keep history bounded so the repo doesn't grow forever.
  const MAX_ENTRIES = 24 * 30; // ~30 days of hourly snapshots
  if (raw.history.length > MAX_ENTRIES) {
    raw.history = raw.history.slice(raw.history.length - MAX_ENTRIES);
  }
  fs.writeFileSync(file, JSON.stringify(raw, null, 2));
}

async function main() {
  const players = loadPlayers();
  const timestamp = new Date().toISOString();
  const latest = { updated: timestamp, players: [] };

  for (const { username, mode } of players) {
    try {
      const currStats = await fetchStats(username, mode);
      const prevEntry = loadPreviousSnapshot(username);
      const { gains, totalGain } = diffXp(prevEntry?.stats, currStats);

      const entry = { timestamp, stats: currStats, gains, totalGain };
      appendSnapshot(username, entry);

      latest.players.push({
        username,
        totalLevel: currStats.Overall.level,
        totalXp: currStats.Overall.xp,
        gains,
        totalGain
      });

      console.log(`${username}: +${totalGain.toLocaleString()} xp this run`);
    } catch (err) {
      console.error(`Failed to update ${username}: ${err.message}`);
      latest.players.push({ username, error: err.message });
    }
  }

  fs.writeFileSync(LATEST_FILE, JSON.stringify(latest, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
