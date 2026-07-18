import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  displayRepositoryName,
  renderHeroTemplate,
  selectRecentRepositories,
} from "../scripts/generate-hero.mjs";

const fixtureUrl = new URL("./fixtures/repositories.json", import.meta.url);
const repositories = JSON.parse(await readFile(fixtureUrl, "utf8"));

test("selects recently pushed public source repositories", () => {
  assert.deepEqual(selectRecentRepositories(repositories, "SyedBaqarAbbas"), [
    "touch-traversal",
    "fish-survival-network",
  ]);
});

test("renders escaped repository names into both template slots", () => {
  const template = "<text>{{RECENT_REPO_1}}</text><text>{{RECENT_REPO_2}}</text>";
  const rendered = renderHeroTemplate(template, ["one&two", "three<four"]);

  assert.equal(rendered, "<text>one&amp;two</text><text>three&lt;four</text>");
});

test("uses stable fallback labels when fewer than two repositories exist", () => {
  const template = "{{RECENT_REPO_1}}|{{RECENT_REPO_2}}";
  assert.equal(
    renderHeroTemplate(template, ["one-repo"]),
    "one-repo|making-something-new",
  );
});

test("keeps long repository names inside the terminal width", () => {
  const shortened = displayRepositoryName("a".repeat(60));
  assert.equal(shortened.length, 42);
  assert.match(shortened, /…$/);
});
