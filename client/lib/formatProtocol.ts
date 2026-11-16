/** User-facing protocol labels (Servarr-style: BitTorrent / Usenet). */
export function formatProtocolLabel(protocol?: string | null): string {
  if (!protocol) return "";
  const p = protocol.toLowerCase();
  if (p === "torrent") return "BitTorrent";
  if (p === "nzb" || p === "usenet") return "Usenet";
  return protocol.toUpperCase();
}