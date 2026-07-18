import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_TEMPLATE_DIRECTORY = fileURLToPath(
  new URL("../assets/templates/", import.meta.url),
);
const THEMES = ["dark", "light"];
const FALLBACK_REPOSITORIES = ["making-something-new", "reading-the-docs"];

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

async function fetchRepositories(username) {
  const response = await fetch(
    `https://api.github.com/users/${encodeURIComponent(username)}/repos?type=owner&sort=pushed&direction=desc&per_page=100`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "SyedBaqarAbbas-profile-hero",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (!response.ok) {
    throw new Error(`GitHub repositories request failed with ${response.status}`);
  }

  return response.json();
}

function repositoryTimestamp(repository) {
  const timestamp = Date.parse(
    repository.pushed_at ?? repository.updated_at ?? repository.created_at ?? 0,
  );
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function displayRepositoryName(name, maxLength = 42) {
  if (name.length <= maxLength) return name;
  return `${name.slice(0, maxLength - 1)}…`;
}

function selectRecentRepositories(repositories, username, limit = 2) {
  return [...repositories]
    .filter(
      (repository) =>
        !repository.fork &&
        !repository.archived &&
        repository.name?.toLowerCase() !== username.toLowerCase(),
    )
    .sort((left, right) => repositoryTimestamp(right) - repositoryTimestamp(left))
    .slice(0, limit)
    .map((repository) => displayRepositoryName(repository.name));
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function renderHeroTemplate(template, repositories) {
  const names = [...repositories, ...FALLBACK_REPOSITORIES].slice(0, 2);
  return template
    .replaceAll("{{RECENT_REPO_1}}", escapeXml(names[0]))
    .replaceAll("{{RECENT_REPO_2}}", escapeXml(names[1]));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const username = args.username ?? process.env.GITHUB_REPOSITORY_OWNER;
  const outputDirectory = args.output ?? "dist";
  const templateDirectory = args.templates ?? DEFAULT_TEMPLATE_DIRECTORY;

  if (!username) {
    throw new Error("Pass --username or set GITHUB_REPOSITORY_OWNER");
  }

  const repositories = args.fixture
    ? JSON.parse(await readFile(args.fixture, "utf8"))
    : await fetchRepositories(username);
  const recentRepositories = selectRecentRepositories(repositories, username);

  await mkdir(outputDirectory, { recursive: true });
  await Promise.all(
    THEMES.map(async (theme) => {
      const template = await readFile(
        path.join(templateDirectory, `hero-${theme}.svg`),
        "utf8",
      );
      await writeFile(
        path.join(outputDirectory, `hero-${theme}.svg`),
        renderHeroTemplate(template, recentRepositories),
        "utf8",
      );
    }),
  );

  console.log(
    `Generated ${THEMES.length} hero cards for ${username} using ${recentRepositories.join(", ")}`,
  );
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

export { displayRepositoryName, renderHeroTemplate, selectRecentRepositories };
