const fs = require("fs");
const path = require("path");

const SKILLS = [
  "Overall", "Attack", "Defence", "Strength", "Hitpoints", "Ranged",
  "Prayer", "Magic", "Cooking", "Woodcutting", "Fletching", "Fishing",
  "Firemaking", "Crafting", "Smithing", "Mining", "Herblore", "Agility",
  "Thieving", "Slayer", "Farming", "Runecrafting", "Hunter", "Construction",
  "Sailing"
];

// Exact order per the official hiscores index_lite.ws response (OSRS).
// Each of these lines is "rank,score" (2 values), unlike skills which are "rank,level,xp".
const ACTIVITIES = [
  "Grid Points", "League Points", "Deadman Points",
  "Bounty Hunter - Hunter", "Bounty Hunter - Rogue",
  "Bounty Hunter (Legacy) - Hunter", "Bounty Hunter (Legacy) - Rogue",
  "Clue Scrolls (all)", "Clue Scrolls (beginner)", "Clue Scrolls (easy)",
  "Clue Scrolls (medium)", "Clue Scrolls (hard)", "Clue Scrolls (elite)",
  "Clue Scrolls (master)",
  "LMS - Rank", "PvP Arena - Rank", "Soul Wars Zeal", "Rifts closed",
  "Colosseum Glory", "Collections Logged",
  "Abyssal Sire", "Alchemical Hydra", "Amoxliatl", "Araxxor", "Artio",
  "Barrows Chests", "Brutus", "Bryophyta", "Callisto", "Cal'varion",
  "Cerberus", "Chambers of Xeric", "Chambers of Xeric: Challenge Mode",
  "Chaos Elemental", "Chaos Fanatic", "Commander Zilyana", "Corporeal Beast",
  "Crazy Archaeologist", "Dagannoth Prime", "Dagannoth Rex", "Dagannoth Supreme",
  "Deranged Archaeologist", "Doom of Mokhaiotl", "Duke Sucellus",
  "General Graardor", "Giant Mole", "Grotesque Guardians", "Hespori",
  "Kalphite Queen", "King Black Dragon", "Kraken", "Kree'Arra", "K'ril Tsutsaroth",
  "Lunar Chests", "Mimic", "Nex", "Nightmare", "Phosani's Nightmare", "Obor",
  "Phantom Muspah", "Sarachnis", "Scorpia", "Scurrius", "Shellbane Gryphon",
  "Skotizo", "Sol Heredit", "Spindel", "Tempoross", "The Gauntlet",
  "The Corrupted Gauntlet", "The Hueycoatl", "The Leviathan", "The Royal Titans",
  "The Whisperer", "Theatre of Blood", "Theatre of Blood: Hard Mode",
  "Thermonuclear Smoke Devil", "Tombs of Amascut", "Tombs of Amascut: Expert Mode",
  "TzKal-Zuk", "TzTok-Jad", "Vardorvis", "Venenatis", "Vet'ion", "Vorkath",
  "Wintertodt", "Yama", "Zalcano", "Zulrah"
];

// Curated subset actually surfaced in the dashboard (clues + boss/raid killcounts).
const NOTABLE_ACTIVITIES = ACTIVITIES.filter(a =>
  a.startsWith("Clue Scrolls") ||
  !["Grid Points", "League Points", "Deadman Points", "Bounty Hunter - Hunter",
    "Bounty Hunter - Rogue", "Bounty Hunter (Legacy) - Hunter", "Bounty Hunter (Legacy) - Rogue",
    "LMS - Rank", "PvP Arena - Rank", "Soul Wars Zeal", "Rifts closed",
    "Colosseum Glory", "Collections Logged"].includes(a)
);

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

function ensureSnapshotDir() {
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
}

function snapshotPath(username) {
  const safeName = username.toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return path.join(SNAPSHOT_DIR, `${safeName}.json`);
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

  const activities = {};
  ACTIVITIES.forEach((name, i) => {
    const line = lines[SKILLS.length + i] || "-1,-1";
    const [rank, score] = line.split(",").map(Number);
    activities[name] = { rank, score: score < 0 ? 0 : score };
  });

  return { stats, activities };
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

function diffActivities(prevActivities, currActivities) {
  const gains = {};
  for (const name of ACTIVITIES) {
    const prevScore = prevActivities?.[name]?.score ?? currActivities[name].score;
    const delta = currActivities[name].score - prevScore;
    if (delta > 0) gains[name] = delta;
  }
  return gains;
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
  ensureSnapshotDir();
  const players = loadPlayers();
  const timestamp = new Date().toISOString();
  const latest = { updated: timestamp, players: [] };

  for (const { username, mode } of players) {
    try {
      const { stats: currStats, activities: currActivities } = await fetchStats(username, mode);
      const prevEntry = loadPreviousSnapshot(username);
      const { gains, totalGain } = diffXp(prevEntry?.stats, currStats);
      const activityGains = diffActivities(prevEntry?.activities, currActivities);

      const entry = {
        timestamp,
        stats: currStats,
        activities: currActivities,
        gains,
        totalGain,
        activityGains
      };
      appendSnapshot(username, entry);

      // Only include non-zero notable activities in latest.json to keep payload small.
      const notable = {};
      NOTABLE_ACTIVITIES.forEach(name => {
        if (currActivities[name].score > 0) notable[name] = currActivities[name];
      });

      latest.players.push({
        username,
        totalLevel: currStats.Overall.level,
        totalXp: currStats.Overall.xp,
        stats: currStats,
        gains,
        totalGain,
        activities: notable,
        activityGains
      });

      console.log(`${username}: +${totalGain.toLocaleString()} xp this run, ${Object.keys(activityGains).length} activity gain(s)`);
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
