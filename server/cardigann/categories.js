/**
 * Map Cardigann category names to Newznab ids, and back to site category ids.
 * A new YAML only needs categorymappings; this table is the shared Newznab vocabulary.
 */

const NEWZNAB_BY_NAME = {
  Movies: 2000,
  "Movies/Foreign": 2010,
  "Movies/Other": 2020,
  "Movies/SD": 2030,
  "Movies/HD": 2040,
  "Movies/UHD": 2045,
  "Movies/BluRay": 2050,
  "Movies/3D": 2060,
  "Movies/DVD": 2070,
  "Movies/WEB-DL": 2080,
  "Movies/WEBDL": 2080,
  TV: 5000,
  "TV/WEB-DL": 5010,
  "TV/Foreign": 5020,
  "TV/SD": 5030,
  "TV/HD": 5040,
  "TV/UHD": 5045,
  "TV/Other": 5050,
  "TV/Sport": 5060,
  "TV/Anime": 5070,
  "TV/Documentary": 5080,
  Audio: 3000,
  "Audio/MP3": 3010,
  "Audio/Video": 3020,
  "Audio/Audiobook": 3030,
  "Audio/Lossless": 3040,
  "Audio/Other": 3050,
  PC: 4000,
  "PC/0day": 4010,
  "PC/ISO": 4020,
  "PC/Mac": 4030,
  "PC/Mobile-Other": 4040,
  "PC/Games": 4050,
  "PC/Mobile-Android": 4060,
  "PC/Mobile-iOS": 4070,
  "PC/Phone-Other": 4080,
  XXX: 6000,
  "XXX/DVD": 6010,
  "XXX/WMV": 6020,
  "XXX/XviD": 6030,
  "XXX/x264": 6040,
  "XXX/Pack": 6050,
  "XXX/ImageSet": 6060,
  "XXX/Other": 6070,
  Books: 7000,
  "Books/Mags": 7010,
  "Books/EBook": 7020,
  "Books/Comics": 7030,
  "Books/Technical": 7040,
  "Books/Other": 7050,
  Other: 8000,
  "Other/Misc": 8010,
  Console: 1000,
};

function newznabIdFor(catName) {
  if (!catName) return 8000;
  if (NEWZNAB_BY_NAME[catName]) return NEWZNAB_BY_NAME[catName];
  const parent = String(catName).split("/")[0];
  return NEWZNAB_BY_NAME[parent] || 8000;
}

function mappingMatchesRequest(mappingId, requestedIds) {
  return requestedIds.some((requested) => {
    if (requested === mappingId) return true;
    const requestedParent = Math.floor(requested / 1000) * 1000;
    if (requested % 1000 === 0 && Math.floor(mappingId / 1000) * 1000 === requested) {
      return true;
    }
    return requestedParent === mappingId && requested !== requestedParent;
  });
}

/**
 * Site category ids to put in .Categories for this search.
 * Empty when the caller did not ask for a category, so definitions search everything.
 */
function siteCategoriesFor(definition, requestedIds = []) {
  const wanted = (requestedIds || []).map((id) => parseInt(id, 10)).filter((id) => !Number.isNaN(id));
  if (!wanted.length) return [];

  const mappings = definition?.caps?.categorymappings || [];
  const ids = [];
  for (const mapping of mappings) {
    const newznabId = newznabIdFor(mapping.cat);
    if (mappingMatchesRequest(newznabId, wanted)) {
      ids.push(String(mapping.id));
    }
  }
  return [...new Set(ids)];
}

module.exports = {
  NEWZNAB_BY_NAME,
  newznabIdFor,
  siteCategoriesFor,
};
