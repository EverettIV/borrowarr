/**
 * Prove every vendored Cardigann YAML can build a search.
 * Public definitions with no credentials are also fetched live.
 *
 *   node scripts/testCardigannDefinitions.js
 *   node scripts/testCardigannDefinitions.js --live
 */

const path = require("path");
const { getCardigannEngine } = require("../cardigann");

const live = process.argv.includes("--live");
const engine = getCardigannEngine(path.join(__dirname, "../cardigann-indexer-yamls"));
const definitions = engine.getAllIndexers();

function needsCredentials(definition) {
  const scraper = engine.getScraper(definition.id);
  scraper.applySettings({});
  return scraper.missingCredentials();
}

async function dryRun() {
  const failures = [];
  let planned = 0;
  let credentialGate = 0;

  for (const definition of definitions) {
    const scraper = engine.getScraper(definition.id);
    try {
      const plans = scraper.planSearch("Inception 2010", { categoryIds: [2000, 5000] });
      if (!plans.length || !plans[0].url || !/^https?:\/\//.test(plans[0].url)) {
        failures.push({ id: definition.id, error: `No URL planned (${plans[0] && plans[0].url})` });
        continue;
      }
      planned += 1;
    } catch (error) {
      failures.push({ id: definition.id, error: `plan: ${error.message}` });
      continue;
    }

      if (needsCredentials(definition)) {
        const blocked = await scraper.search("Inception 2010");
      if (blocked.success || !/requires/i.test(blocked.error || "")) {
        failures.push({
          id: definition.id,
          error: `credential gate: ${blocked.error || "search ran without credentials"}`,
        });
      } else {
        credentialGate += 1;
      }
    }
  }

  return { planned, credentialGate, failures };
}

async function liveRun() {
  const publicOnes = definitions.filter((definition) => !needsCredentials(definition));
  const results = [];
  let cursor = 0;
  const concurrency = 4;

  async function worker() {
    while (cursor < publicOnes.length) {
      const definition = publicOnes[cursor];
      cursor += 1;
      const started = Date.now();
      const scraper = engine.getScraper(definition.id);
      try {
        const outcome = await scraper.search("ubuntu", {});
        results.push({
          id: definition.id,
          name: definition.name,
          ok: outcome.success && outcome.results.length > 0,
          count: outcome.results.length,
          error: outcome.error || (outcome.results.length ? "" : "no releases parsed"),
          ms: Date.now() - started,
        });
      } catch (error) {
        results.push({
          id: definition.id,
          name: definition.name,
          ok: false,
          count: 0,
          error: error.message,
          ms: Date.now() - started,
        });
      }
      process.stdout.write(`\rLive ${results.length}/${publicOnes.length}`);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  process.stdout.write("\n");
  return results;
}

(async () => {
  console.log(`Definitions: ${definitions.length}`);
  const dry = await dryRun();
  console.log(`Planned searches: ${dry.planned}`);
  console.log(`Credential gate held: ${dry.credentialGate}`);
  console.log(`Dry-run failures: ${dry.failures.length}`);
  dry.failures.slice(0, 30).forEach((failure) => {
    console.log(`  ${failure.id}: ${failure.error}`);
  });

  if (!live) {
    process.exit(dry.failures.length ? 1 : 0);
  }

  const liveResults = await liveRun();
  const passed = liveResults.filter((result) => result.ok);
  const failed = liveResults.filter((result) => !result.ok);
  console.log(`Live public indexers: ${liveResults.length}`);
  console.log(`Returned releases: ${passed.length}`);
  console.log(`No releases or error: ${failed.length}`);
  failed
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((result) => {
      console.log(`  ${result.id}: ${result.error} (${result.ms}ms)`);
    });
  process.exit(dry.failures.length ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
