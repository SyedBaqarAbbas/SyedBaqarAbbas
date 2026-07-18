import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { normalizeActivity, renderActivitySvg } from "../scripts/generate-activity.mjs";

const fixtureUrl = new URL("./fixtures/activity.json", import.meta.url);
const payload = JSON.parse(await readFile(fixtureUrl, "utf8"));
const asOf = new Date("2026-07-19T00:00:00Z");

test("normalizes contribution and authored release totals", () => {
  const activity = normalizeActivity(payload, "SyedBaqarAbbas", asOf);

  assert.equal(activity.totals.contributions, 19);
  assert.equal(activity.totals.commits, 12);
  assert.equal(activity.totals.pullRequests, 4);
  assert.equal(activity.totals.reviews, 2);
  assert.equal(activity.totals.releases, 1);
  assert.equal(activity.weeks[0].contributionDays[4].level, 4);
});

test("renders an accessible dark activity card without executable scripts", () => {
  const activity = normalizeActivity(payload, "SyedBaqarAbbas", asOf);
  const svg = renderActivitySvg(activity, "dark");

  assert.match(svg, /role="img"/);
  assert.match(svg, /<title id="title">SyedBaqarAbbas&apos;s GitHub activity<\/title>/);
  assert.match(svg, /PULL REQUESTS/);
  assert.match(svg, /2026-07-02: 11 contributions/);
  assert.match(svg, /prefers-reduced-motion/);
  assert.doesNotMatch(svg, /<script/i);
});

test("renders a distinct light theme and escapes user-provided text", () => {
  const activity = normalizeActivity(payload, "Baqar & friends", asOf);
  const light = renderActivitySvg(activity, "light");
  const dark = renderActivitySvg(activity, "dark");

  assert.match(light, /Baqar &amp; friends&apos;s GitHub activity/);
  assert.match(light, /#f8fafc/);
  assert.match(dark, /#10141d/);
  assert.notEqual(light, dark);
});

test("rejects payloads without a contribution calendar", () => {
  assert.throws(
    () => normalizeActivity({ data: { user: {} } }, "SyedBaqarAbbas", asOf),
    /missing a contribution calendar/,
  );
});
