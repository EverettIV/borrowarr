/**
 * Run async mapper over items with a concurrency limit.
 */
async function mapPool(items, concurrency, mapper) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let nextIndex = 0;
  const limit = Math.max(1, Math.min(concurrency, items.length));

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await mapper(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

module.exports = { mapPool };