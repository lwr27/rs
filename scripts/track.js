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
  "Phantom Muspah", "Gemstone Crab", "Sarachnis", "Scorpia", "Scurrius", "Shellbane Gryphon",
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

// Formats a timestamp as its UK calendar day (YYYY-MM-DD), matching the
// site's own day-bucketing so compacted history lines up with what the
// calendar/session log actually display.
function londonDateKey(d) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(d);
}

function appendSnapshot(username, entry) {
  const file = snapshotPath(username);
  let raw = { username, history: [] };
  if (fs.existsSync(file)) {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  }
  raw.history.push(entry);

  // The session log and calendar only ever read timestamp/gains/totalGain/
  // activityGains from history - never the full stats/activities snapshot.
  // So instead of deleting old entries outright (which silently shrinks how
  // far back the calendar can show), keep full-detail entries for the last
  // few days, then permanently compact anything older into one lightweight
  // summary per UK calendar day. History then grows by ~1 tiny entry/day
  // forever instead of by (entries per day) forever.
  const RAW_RETENTION_MS = 3 * 24 * 60 * 60 * 1000; // 3 days of full detail
  const cutoff = Date.now() - RAW_RETENTION_MS;

  const recent = [];
  const byDay = {};
  raw.history.forEach(e => {
    if (new Date(e.timestamp).getTime() >= cutoff) {
      recent.push(e);
      return;
    }
    const day = londonDateKey(new Date(e.timestamp));
    if (!byDay[day]) {
      byDay[day] = {
        timestamp: day + "T12:00:00.000Z", compact: true,
        gains: {}, totalGain: 0, activityGains: {}
      };
    }
    const bucket = byDay[day];
    bucket.totalGain += e.totalGain || 0;
    Object.entries(e.gains || {}).forEach(([sk, xp]) => {
      bucket.gains[sk] = (bucket.gains[sk] || 0) + xp;
    });
    Object.entries(e.activityGains || {}).forEach(([name, score]) => {
      bucket.activityGains[name] = (bucket.activityGains[name] || 0) + score;
    });
  });

  const compacted = Object.values(byDay).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  raw.history = compacted.concat(recent.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)));

  // Safety net only - compaction should keep this well under control on its
  // own, this just guards against something unexpected blowing the file up.
  const MAX_ENTRIES = 5000;
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
