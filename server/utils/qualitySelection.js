const STANDARD_QUALITIES = ["480p", "720p", "1080p", "2160p"];

function getQualityRank(quality) {
  const q = String(quality || "").toLowerCase();
  if (q.includes("2160") || q.includes("4k") || q.includes("uhd")) return 4;
  if (q.includes("1080")) return 3;
  if (q.includes("720p")) return 2;
  if (q.includes("480") || q === "sd") return 1;
  return 0;
}

function detectQualityFromReleaseTitle(title) {
  const lower = String(title || "").toLowerCase();
  if (lower.includes("2160p") || lower.includes("4k") || lower.includes("uhd")) {
    return "2160p";
  }
  if (lower.includes("1080p")) return "1080p";
  if (lower.includes("720p")) return "720p";
  if (lower.includes("480p")) return "480p";
  return "SD";
}

function torrentMeetsQualityRange(title, minQuality, maxQuality) {
  const rank = getQualityRank(detectQualityFromReleaseTitle(title));
  const minRank = getQualityRank(minQuality);
  const maxRank = getQualityRank(maxQuality);
  if (rank === 0) {
    return minRank <= 1;
  }
  return rank >= minRank && rank <= maxRank;
}

function torrentMatchesPreferred(title, preferredQuality) {
  if (!preferredQuality || preferredQuality === "any") return true;
  const detected = detectQualityFromReleaseTitle(title);
  return getQualityRank(detected) === getQualityRank(preferredQuality);
}

/**
 * Keep releases within min/max only. Preferred quality is applied at pick time with seeders.
 */
function filterTorrentsForQualityPrefs(torrents, {
  minQuality = "720p",
  maxQuality = "1080p",
  preferredQuality = "720p",
  itemQualityProfile,
}) {
  void itemQualityProfile;
  void preferredQuality;
  const inRange = torrents.filter((torrent) =>
    torrentMeetsQualityRange(torrent.title, minQuality, maxQuality),
  );
  return inRange;
}

function resolvePreferredQuality(preferredQuality, itemQualityProfile) {
  if (itemQualityProfile && itemQualityProfile !== "any") {
    return itemQualityProfile;
  }
  return preferredQuality;
}

/**
 * Prefer preferred quality when swarms are similar; otherwise favor healthier torrents in-range.
 */
function downloadPickScore(torrent, preferredQuality) {
  const seeders = Math.max(0, Number(torrent.seeders) || 0);
  let score = Math.log10(seeders + 1) * 1000;

  if (torrentMatchesPreferred(torrent.title, preferredQuality)) {
    score += 120;
  }

  if (seeders === 0) {
    score -= 400;
  } else if (seeders < 3) {
    score -= 150;
  }

  const priority = torrent.indexerPriority ?? 25;
  score += 50 - Math.min(priority, 50);

  return score;
}

function pickBestTorrentBySeeders(torrents) {
  if (!torrents.length) return null;
  return torrents.reduce((best, current) => {
    const bestSeeders = Math.max(0, Number(best.seeders) || 0);
    const currentSeeders = Math.max(0, Number(current.seeders) || 0);
    if (currentSeeders !== bestSeeders) {
      return currentSeeders > bestSeeders ? current : best;
    }
    const bestPriority = best.indexerPriority ?? 25;
    const currentPriority = current.indexerPriority ?? 25;
    if (currentPriority !== bestPriority) {
      return currentPriority < bestPriority ? current : best;
    }
    return best;
  });
}

function pickBestTorrentForDownload(torrents, {
  preferredQuality = "720p",
  itemQualityProfile,
  preferSeedersInQualityRange = true,
} = {}) {
  if (!torrents.length) return null;
  if (preferSeedersInQualityRange) {
    return pickBestTorrentBySeeders(torrents);
  }
  const preferred = resolvePreferredQuality(preferredQuality, itemQualityProfile);
  return torrents.reduce((best, current) => {
    const bestScore = downloadPickScore(best, preferred);
    const currentScore = downloadPickScore(current, preferred);
    return currentScore > bestScore ? current : best;
  });
}

function compareTorrentsForDownload(a, b, options = {}) {
  const preferSeedersInQualityRange = options.preferSeedersInQualityRange !== false;
  if (preferSeedersInQualityRange) {
    const bestSeeders = Math.max(0, Number(a.seeders) || 0);
    const currentSeeders = Math.max(0, Number(b.seeders) || 0);
    if (bestSeeders !== currentSeeders) {
      return currentSeeders - bestSeeders;
    }
    return (a.indexerPriority ?? 25) - (b.indexerPriority ?? 25);
  }
  const preferred = resolvePreferredQuality(
    options.preferredQuality,
    options.itemQualityProfile,
  );
  return downloadPickScore(b, preferred) - downloadPickScore(a, preferred);
}

function clampQualityPair(minQuality, maxQuality) {
  const clamped = clampQualityTrio(minQuality, minQuality, maxQuality);
  return {
    minQuality: clamped.minQuality,
    maxQuality: clamped.maxQuality,
    preferredQuality: clamped.minQuality,
  };
}

function clampQualityTrio(minQuality, preferredQuality, maxQuality) {
  const rankOf = (q) => {
    const idx = STANDARD_QUALITIES.indexOf(q);
    return idx >= 0 ? idx : getQualityRank(q);
  };
  const toLabel = (r) => STANDARD_QUALITIES[r] || "720p";

  let minR = rankOf(minQuality);
  let prefR = rankOf(preferredQuality);
  let maxR = rankOf(maxQuality);

  if (minR > maxR) maxR = minR;
  if (prefR < minR) prefR = minR;
  if (prefR > maxR) prefR = maxR;

  return {
    minQuality: toLabel(minR),
    preferredQuality: toLabel(prefR),
    maxQuality: toLabel(maxR),
  };
}

function pickBestTorrentByPriorityAndSeeders(torrents) {
  if (!torrents.length) return null;
  return torrents.reduce((best, current) => {
    const bestPriority = best.indexerPriority ?? 25;
    const currentPriority = current.indexerPriority ?? 25;
    if (currentPriority < bestPriority) return current;
    if (currentPriority > bestPriority) return best;
    return (current.seeders || 0) > (best.seeders || 0) ? current : best;
  });
}

module.exports = {
  getQualityRank,
  detectQualityFromReleaseTitle,
  filterTorrentsForQualityPrefs,
  clampQualityTrio,
  clampQualityPair,
  pickBestTorrentByPriorityAndSeeders,
  pickBestTorrentForDownload,
  pickBestTorrentBySeeders,
  compareTorrentsForDownload,
  downloadPickScore,
  STANDARD_QUALITIES,
};