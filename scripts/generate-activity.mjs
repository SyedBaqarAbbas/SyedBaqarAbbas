import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const GRAPHQL_ENDPOINT = "https://api.github.com/graphql";

const QUERY = `
  query ProfileActivity($login: String!) {
    user(login: $login) {
      contributionsCollection {
        totalCommitContributions
        totalPullRequestContributions
        totalPullRequestReviewContributions
        restrictedContributionsCount
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              date
              contributionCount
              contributionLevel
              weekday
            }
          }
        }
      }
    }
  }
`;

const THEMES = {
  dark: {
    background: "#10141d",
    panel: "#111a27",
    border: "#344154",
    text: "#f8fafc",
    muted: "#b9c3d5",
    cyan: "#54c7ff",
    coral: "#ff7a4d",
    cells: ["#1d2735", "#5d3028", "#91442f", "#ce5c3d", "#ff7a4d"],
  },
  light: {
    background: "#f8fafc",
    panel: "#ffffff",
    border: "#cbd7e3",
    text: "#10141d",
    muted: "#526072",
    cyan: "#159bc9",
    coral: "#ed5d35",
    cells: ["#e7edf4", "#ffd9cb", "#ffb99f", "#ff9472", "#ff6f47"],
  },
};

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = value;
    index += 1;
  }
  return args;
}

async function fetchRecentReleaseCount(username) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "SyedBaqarAbbas-profile-activity",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const eventsResponse = await fetch(
    `https://api.github.com/users/${encodeURIComponent(username)}/events/public?per_page=100`,
    { headers },
  );
  if (!eventsResponse.ok) {
    throw new Error(`GitHub public events request failed with ${eventsResponse.status}`);
  }

  return (await eventsResponse.json()).filter(
    (event) =>
      event.type === "ReleaseEvent" &&
      event.actor?.login?.toLowerCase() === username.toLowerCase(),
  ).length;
}

async function fetchActivity(username, token) {
  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "SyedBaqarAbbas-profile-activity",
    },
    body: JSON.stringify({ query: QUERY, variables: { login: username } }),
  });

  if (!response.ok) {
    throw new Error(`GitHub GraphQL request failed with ${response.status}`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join("; "));
  }
  if (!payload.data?.user) {
    throw new Error(`GitHub user ${username} was not found`);
  }

  payload.releaseCount = await fetchRecentReleaseCount(username);

  return payload;
}

function contributionLevel(day) {
  const levels = {
    NONE: 0,
    FIRST_QUARTILE: 1,
    SECOND_QUARTILE: 2,
    THIRD_QUARTILE: 3,
    FOURTH_QUARTILE: 4,
  };

  if (day.contributionLevel in levels) return levels[day.contributionLevel];
  if (!day.contributionCount) return 0;
  if (day.contributionCount < 3) return 1;
  if (day.contributionCount < 6) return 2;
  if (day.contributionCount < 10) return 3;
  return 4;
}

function normalizeActivity(payload, username, asOf = new Date()) {
  const user = payload.data?.user ?? payload.user;
  if (!user?.contributionsCollection?.contributionCalendar) {
    throw new Error("Activity payload is missing a contribution calendar");
  }

  const collection = user.contributionsCollection;
  const calendar = collection.contributionCalendar;
  const weeks = calendar.weeks.slice(-53).map((week) => ({
    contributionDays: week.contributionDays.map((day) => ({
      ...day,
      contributionCount: Number(day.contributionCount) || 0,
      weekday: Number(day.weekday),
      level: contributionLevel(day),
    })),
  }));

  const releases = Number(payload.releaseCount) || 0;

  return {
    username,
    asOf,
    weeks,
    totals: {
      contributions: Number(calendar.totalContributions) || 0,
      commits: Number(collection.totalCommitContributions) || 0,
      pullRequests: Number(collection.totalPullRequestContributions) || 0,
      reviews: Number(collection.totalPullRequestReviewContributions) || 0,
      releases,
    },
  };
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatUpdatedAt(date) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function monthLabels(weeks) {
  let previousMonth = null;
  const labels = [];

  weeks.forEach((week, index) => {
    const firstDay = week.contributionDays[0];
    if (!firstDay?.date) return;
    const date = new Date(`${firstDay.date}T00:00:00Z`);
    const month = date.getUTCMonth();
    if (month === previousMonth) return;
    previousMonth = month;
    labels.push({
      index,
      label: new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(date),
    });
  });

  return labels;
}

function renderActivitySvg(activity, themeName) {
  const theme = THEMES[themeName];
  if (!theme) throw new Error(`Unknown theme: ${themeName}`);

  const width = 1120;
  const height = 330;
  const gridX = 60;
  const gridY = 135;
  const cellSize = 11;
  const cellGap = 4;
  const cellStep = cellSize + cellGap;
  const title = escapeXml(`${activity.username}'s GitHub activity`);

  const statItems = [
    ["CONTRIBUTIONS", activity.totals.contributions],
    ["COMMITS", activity.totals.commits],
    ["PULL REQUESTS", activity.totals.pullRequests],
    ["REVIEWS", activity.totals.reviews],
    ["RECENT RELEASES", activity.totals.releases],
  ];

  const stats = statItems.map(([label, value], index) => {
    const x = gridX + index * 207;
    return `
      <g transform="translate(${x} 82)">
        <text class="mono label" x="0" y="0">${label}</text>
        <text class="sans value" x="0" y="28">${formatNumber(value)}</text>
      </g>`;
  }).join("");

  const cells = activity.weeks.flatMap((week, weekIndex) =>
    week.contributionDays.map((day) => {
      const x = gridX + weekIndex * cellStep;
      const y = gridY + day.weekday * cellStep;
      const fill = theme.cells[day.level] ?? theme.cells[0];
      const countLabel = day.contributionCount === 1 ? "1 contribution" : `${day.contributionCount} contributions`;
      return `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="2.5" fill="${fill}"><title>${escapeXml(day.date)}: ${countLabel}</title></rect>`;
    }),
  ).join("");

  const months = monthLabels(activity.weeks).map(({ index, label }) =>
    `<text class="mono month" x="${gridX + index * cellStep}" y="125">${label}</text>`,
  ).join("");

  const legend = theme.cells.map((color, index) =>
    `<rect x="${152 + index * 19}" y="276" width="11" height="11" rx="2.5" fill="${color}"/>`,
  ).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">${title}</title>
  <desc id="desc">A rolling 53-week contribution calendar with commit, pull request, and review totals, plus recent public releases.</desc>
  <style>
    .sans{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}
    .heading{font-size:22px;font-weight:720;fill:${theme.text}}
    .subtle,.month,.label{fill:${theme.muted}}
    .subtle{font-size:13px}.month{font-size:11px}.label{font-size:10px;letter-spacing:1.2px}
    .value{font-size:24px;font-weight:720;fill:${theme.text}}
    .flow{stroke-dasharray:6 12;animation:flow 8s linear infinite}
    .scan{animation:scan 10s ease-in-out infinite}
    .live{transform-box:fill-box;transform-origin:center;animation:pulse 3s ease-in-out infinite}
    @keyframes flow{to{stroke-dashoffset:-108}}
    @keyframes scan{0%,12%{transform:translateX(-45px);opacity:0}25%,72%{opacity:.16}90%,100%{transform:translateX(845px);opacity:0}}
    @keyframes pulse{0%,100%{opacity:.45;transform:scale(.9)}50%{opacity:1;transform:scale(1.18)}}
    @media (prefers-reduced-motion:reduce){.flow,.scan,.live{animation:none}.scan{display:none}.live{opacity:.85}}
  </style>
  <defs>
    <clipPath id="panel"><rect x="1" y="1" width="1118" height="328" rx="20"/></clipPath>
  </defs>
  <rect x="1" y="1" width="1118" height="328" rx="20" fill="${theme.background}" stroke="${theme.border}" stroke-width="2"/>
  <path class="flow" d="M772 39H1070" fill="none" stroke="${theme.cyan}" stroke-opacity=".28" stroke-width="1.5"/>
  <circle class="live" cx="1070" cy="39" r="5" fill="${theme.cyan}"/>
  <text class="sans heading" x="60" y="43">proof of life</text>
  <text class="mono subtle" x="60" y="64">last 12 months · refreshed ${escapeXml(formatUpdatedAt(activity.asOf))}</text>
  ${stats}
  ${months}
  <g clip-path="url(#panel)">${cells}<rect class="scan" x="20" y="130" width="30" height="112" fill="${theme.cyan}" opacity="0"/></g>
  <text class="mono subtle" x="60" y="286">less</text>
  ${legend}
  <text class="mono subtle" x="254" y="286">more</text>
  <text class="mono subtle" x="860" y="286">source: github · no badge farm</text>
  <circle cx="838" cy="281" r="4" fill="${theme.coral}"/>
</svg>
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const username = args.username ?? process.env.GITHUB_REPOSITORY_OWNER;
  const outputDir = args.output ?? "dist";
  const asOf = args["as-of"] ? new Date(`${args["as-of"]}T23:59:59Z`) : new Date();

  if (!username) {
    throw new Error("Pass --username or set GITHUB_REPOSITORY_OWNER");
  }
  if (!Number.isFinite(asOf.getTime())) {
    throw new Error("--as-of must use YYYY-MM-DD format");
  }

  let payload;
  if (args.fixture) {
    payload = JSON.parse(await readFile(args.fixture, "utf8"));
  } else {
    const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
    if (!token) throw new Error("Set GITHUB_TOKEN or pass --fixture");
    payload = await fetchActivity(username, token);
  }

  const activity = normalizeActivity(payload, username, asOf);
  await mkdir(outputDir, { recursive: true });

  await Promise.all(
    Object.keys(THEMES).map((themeName) =>
      writeFile(
        path.join(outputDir, `activity-${themeName}.svg`),
        renderActivitySvg(activity, themeName),
        "utf8",
      ),
    ),
  );

  console.log(`Generated ${Object.keys(THEMES).length} activity cards for ${username}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

export { normalizeActivity, renderActivitySvg };
