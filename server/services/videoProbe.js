const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;

const execFileAsync = promisify(execFile);

let ffprobeAvailable;
let probeFailureLogCount = 0;
const PROBE_FAILURE_LOG_LIMIT = 5;
const PROBE_TIMEOUT_MS = 12000;
const MIN_PROBE_BYTES = 64 * 1024;

function namingFormatUsesToken(format, tokenName) {
  if (!format || typeof format !== 'string') return false;
  const escaped = tokenName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (
    new RegExp(`\\{${escaped}\\}`, 'i').test(format) ||
    new RegExp(`\\{\\[${escaped}\\]\\}`, 'i').test(format)
  );
}

function namingFormatUsesQuality(format) {
  return namingFormatUsesToken(format, 'Quality');
}

function namingFormatUsesCodec(format) {
  return namingFormatUsesToken(format, 'Codec');
}

function namingFormatUsesAudio(format) {
  return namingFormatUsesToken(format, 'Audio');
}

/** True only when format asks for a probed field still missing from the release name. */
function formatNeedsFfprobe(format, sceneMeta = {}) {
  return (
    (namingFormatUsesQuality(format) && !sceneMeta.quality) ||
    (namingFormatUsesCodec(format) && !sceneMeta.codec) ||
    (namingFormatUsesAudio(format) && !sceneMeta.audio)
  );
}

function heightToQualityLabel(height, width) {
  const h = Number(height) || 0;
  const w = Number(width) || 0;
  const lines = h > 0 ? h : Math.round((w * 9) / 16);
  if (lines >= 2000) return '2160p';
  if (lines >= 950) return '1080p';
  if (lines >= 650) return '720p';
  if (lines >= 400) return '480p';
  if (lines > 0) return 'SD';
  return '';
}

function videoCodecNameToLabel(codecName) {
  const c = String(codecName || '').toLowerCase();
  if (!c) return '';
  if (c === 'hevc' || c === 'h265') return 'x265';
  if (c === 'h264' || c === 'avc') return 'x264';
  if (c === 'av1') return 'AV1';
  if (c === 'vp9') return 'VP9';
  if (c === 'mpeg4' || c === 'xvid') return 'XviD';
  if (c === 'mpeg2video') return 'MPEG-2';
  if (c === 'prores') return 'ProRes';
  if (c === 'vc1') return 'VC-1';
  return c.toUpperCase();
}

function audioCodecNameToLabel(codecName) {
  const c = String(codecName || '').toLowerCase();
  if (!c) return '';
  if (c === 'aac') return 'AAC';
  if (c === 'ac3') return 'AC3';
  if (c === 'eac3') return 'EAC3';
  if (c === 'dts') return 'DTS';
  if (c === 'truehd') return 'TrueHD';
  if (c === 'flac') return 'FLAC';
  if (c === 'opus') return 'Opus';
  if (c === 'mp3') return 'MP3';
  if (c === 'mp2') return 'MP2';
  if (c === 'vorbis') return 'Vorbis';
  return c.toUpperCase();
}

async function isFfprobeAvailable() {
  if (ffprobeAvailable !== undefined) return ffprobeAvailable;
  try {
    await execFileAsync('ffprobe', ['-version'], { timeout: 5000 });
    ffprobeAvailable = true;
  } catch {
    ffprobeAvailable = false;
    console.warn(
      '[videoProbe] ffprobe not found on PATH — install ffmpeg to detect quality/codec/audio from streams',
    );
  }
  return ffprobeAvailable;
}

const EMPTY_PROBE = { quality: '', codec: '', audio: '' };

/**
 * One ffprobe pass per file (cached). Not called unless formatNeedsFfprobe is true.
 * @param {Map<string, {quality: string, codec: string, audio: string}>} [cache]
 */
async function probeVideoStreamMetadata(filePath, cache) {
  if (!filePath) return { ...EMPTY_PROBE };

  if (cache?.has(filePath)) {
    return cache.get(filePath);
  }

  if (!(await isFfprobeAvailable())) {
    cache?.set(filePath, { ...EMPTY_PROBE });
    return { ...EMPTY_PROBE };
  }

  try {
    const st = await fs.stat(filePath);
    if (!st.isFile() || st.size < MIN_PROBE_BYTES) {
      cache?.set(filePath, { ...EMPTY_PROBE });
      return { ...EMPTY_PROBE };
    }
  } catch {
    cache?.set(filePath, { ...EMPTY_PROBE });
    return { ...EMPTY_PROBE };
  }

  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-probesize',
        '5M',
        '-analyzeduration',
        '5M',
        '-show_entries',
        'stream=codec_type,codec_name,width,height',
        '-of',
        'json',
        filePath,
      ],
      { timeout: PROBE_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
    );
    const data = JSON.parse(stdout);
    const streams = data.streams || [];
    const video = streams.find((s) => s.codec_type === 'video');
    const audio = streams.find((s) => s.codec_type === 'audio');

    const result = {
      quality: heightToQualityLabel(video?.height, video?.width),
      codec: videoCodecNameToLabel(video?.codec_name),
      audio: audioCodecNameToLabel(audio?.codec_name),
    };
    cache?.set(filePath, result);
    return result;
  } catch (err) {
    if (probeFailureLogCount < PROBE_FAILURE_LOG_LIMIT) {
      probeFailureLogCount++;
      const tail = err.message?.split('\n').pop() || err.message;
      console.warn(`[videoProbe] ffprobe failed for ${filePath}: ${tail}`);
      if (probeFailureLogCount === PROBE_FAILURE_LOG_LIMIT) {
        console.warn('[videoProbe] Further ffprobe failures will not be logged individually');
      }
    }
    cache?.set(filePath, { ...EMPTY_PROBE });
    return { ...EMPTY_PROBE };
  }
}

/** @deprecated use probeVideoStreamMetadata */
async function probeVideoQuality(filePath, cache) {
  return probeVideoStreamMetadata(filePath, cache);
}

/**
 * ffprobe only when format includes {Quality}/{Codec}/{Audio} (or {[…]}) and scene name lacks them.
 */
async function enrichMetadataForFormat(format, filePath, sceneMeta, probeCache) {
  const meta = { ...(sceneMeta || {}) };

  if (!formatNeedsFfprobe(format, meta) || !filePath) {
    return meta;
  }

  const wantQuality = namingFormatUsesQuality(format) && !meta.quality;
  const wantCodec = namingFormatUsesCodec(format) && !meta.codec;
  const wantAudio = namingFormatUsesAudio(format) && !meta.audio;

  const probed = await probeVideoStreamMetadata(filePath, probeCache);
  if (wantQuality && probed.quality) meta.quality = probed.quality;
  if (wantCodec && probed.codec) meta.codec = probed.codec;
  if (wantAudio && probed.audio) meta.audio = probed.audio;

  return meta;
}

function resetProbeFailureLogLimit() {
  probeFailureLogCount = 0;
}

const INTEGRITY_PROBE_TIMEOUT_MS = 45000;

/**
 * Lightweight integrity check: ffprobe must read container + at least one video stream with duration.
 * @returns {{ healthy: boolean | null, reason?: string, detail?: string }}
 */
async function probeMediaIntegrity(filePath) {
  if (!filePath) {
    return { healthy: false, reason: 'missing_path' };
  }

  if (!(await isFfprobeAvailable())) {
    return { healthy: null, reason: 'ffprobe_unavailable' };
  }

  try {
    const st = await fs.stat(filePath);
    if (!st.isFile() || st.size < MIN_PROBE_BYTES) {
      return { healthy: false, reason: 'file_too_small' };
    }
  } catch {
    return { healthy: false, reason: 'unreadable' };
  }

  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-probesize',
        '32M',
        '-analyzeduration',
        '32M',
        '-show_entries',
        'stream=codec_type',
        '-show_entries',
        'format=duration',
        '-of',
        'json',
        filePath,
      ],
      { timeout: INTEGRITY_PROBE_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
    );
    const data = JSON.parse(stdout);
    const streams = data.streams || [];
    const hasVideo = streams.some((s) => s.codec_type === 'video');
    if (!hasVideo) {
      return { healthy: false, reason: 'no_video_stream' };
    }
    const duration = parseFloat(data.format?.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
      return { healthy: false, reason: 'invalid_duration' };
    }
    return { healthy: true };
  } catch (err) {
    const detail = [err.stderr, err.stdout, err.message]
      .filter(Boolean)
      .join('\n')
      .trim()
      .slice(0, 500);
    return { healthy: false, reason: 'ffprobe_error', detail: detail || undefined };
  }
}

function formatDurationSeconds(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'unknown duration';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function filenameEncodingHints(fileName) {
  const lower = String(fileName || '').toLowerCase();
  const hints = { quality: null, codec: null, source: null, remux: false };
  if (/\b2160p\b|\b4k\b|\buhd\b/.test(lower)) hints.quality = '2160p';
  else if (/\b1080p\b/.test(lower)) hints.quality = '1080p';
  else if (/\b720p\b/.test(lower)) hints.quality = '720p';
  if (/\bx265\b|\bhevc\b|\bh\.?265\b/.test(lower)) hints.codec = 'x265';
  else if (/\bx264\b|\bh\.?264\b|\bavc\b/.test(lower)) hints.codec = 'x264';
  if (/\bremux\b/.test(lower)) hints.remux = true;
  if (/\bweb-?dl\b/.test(lower)) hints.source = 'WEB-DL';
  else if (/\bbluray\b|\bbdrip\b|\bbrrip\b/.test(lower)) hints.source = 'Blu-ray';
  return hints;
}

function codecsRoughlyMatch(hint, actual) {
  if (!hint || !actual) return true;
  const h = String(hint).toLowerCase();
  const a = String(actual).toLowerCase();
  if (h.includes('265') || h.includes('hevc')) {
    return a.includes('265') || a.includes('hevc');
  }
  if (h.includes('264')) {
    return a.includes('264') || a.includes('avc');
  }
  return a.includes(h);
}

function buildLargeFileExplanations(fileName, meta) {
  const hints = filenameEncodingHints(fileName);
  const lines = [];

  if (!meta.probeOk) {
    lines.push('File is over 10 GB on disk but ffprobe could not read video streams.');
    if (meta.probeError) lines.push(meta.probeError);
    return lines;
  }

  const bitrate =
    Number.isFinite(meta.bitrateMbps) ? `~${meta.bitrateMbps.toFixed(1)} Mbps` : 'unknown bitrate';

  lines.push(
    `${meta.durationFormatted} · ${bitrate} average · ${meta.quality || 'unknown'} (${meta.width}×${meta.height}) · video ${meta.videoCodec}${meta.audioSummary ? ` · audio: ${meta.audioSummary}` : ''}`,
  );

  if (meta.bitrateMbps >= 18) {
    lines.push(
      'Bitrate matches a Blu-ray remux or very high-quality encode (often 20–40 Mbps at 1080p) — that is the main reason for the size.',
    );
  } else if (meta.bitrateMbps >= 12) {
    lines.push('Bitrate is high for a typical web rip; combined with runtime it produces a very large file.');
  }

  if (meta.bitrateMbps >= 18 && !hints.remux) {
    lines.push('Container behaves like a full disc remux even though the filename does not say "Remux".');
  }

  if (hints.quality && meta.quality && hints.quality !== meta.quality) {
    lines.push(`Filename says ${hints.quality} but the video stream is ${meta.quality} — the name may be wrong.`);
  }

  if (hints.codec && meta.videoCodec && !codecsRoughlyMatch(hints.codec, meta.videoCodec)) {
    lines.push(
      `Filename says ${hints.codec} but ffprobe reports ${meta.videoCodec} — often a mislabeled rename, not malware.`,
    );
  }

  if (hints.source === 'WEB-DL' && meta.bitrateMbps >= 15) {
    lines.push('Filename says WEB-DL but bitrate looks like a disc remux — source label may be inaccurate.');
  }

  if (meta.audioTrackCount > 2) {
    lines.push(`${meta.audioTrackCount} audio tracks (multi-language remux) add significant size.`);
  }

  if (meta.subtitleTrackCount >= 8) {
    lines.push(`${meta.subtitleTrackCount} subtitle streams — typical of untouched Blu-ray muxes.`);
  }

  if (meta.streamCount > 15) {
    lines.push(`${meta.streamCount} streams in the file — full disc-style mux, not a lean encode.`);
  }

  return lines;
}

/**
 * ffprobe analysis for oversized files — explain size via bitrate, resolution, and tracks.
 */
async function probeLargeFileAnalysis(filePath, fileName, sizeBytes) {
  const hints = filenameEncodingHints(fileName);
  const unavailable = {
    probeOk: false,
    probeError: null,
    filenameHints: hints,
    explanations: [
      'File exceeds 10 GB. Install ffmpeg/ffprobe on the server to inspect codec, bitrate, and tracks.',
    ],
  };

  if (!filePath) {
    return {
      ...unavailable,
      explanations: ['Invalid file path.'],
    };
  }

  if (!(await isFfprobeAvailable())) {
    return unavailable;
  }

  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-probesize',
        '32M',
        '-analyzeduration',
        '32M',
        '-show_entries',
        'format=duration,bit_rate,format_name',
        '-show_entries',
        'stream=codec_type,codec_name,width,height',
        '-of',
        'json',
        filePath,
      ],
      { timeout: INTEGRITY_PROBE_TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024 },
    );
    const data = JSON.parse(stdout);
    const format = data.format || {};
    const streams = data.streams || [];
    const video = streams.find((s) => s.codec_type === 'video');
    const audioStreams = streams.filter((s) => s.codec_type === 'audio');
    const subtitleStreams = streams.filter((s) => s.codec_type === 'subtitle');

    const durationSeconds = parseFloat(format.duration);
    let bitrateMbps = parseFloat(format.bit_rate) / 1e6;
    if (
      !Number.isFinite(bitrateMbps) &&
      Number.isFinite(durationSeconds) &&
      durationSeconds > 0 &&
      Number.isFinite(sizeBytes)
    ) {
      bitrateMbps = (sizeBytes * 8) / durationSeconds / 1e6;
    }

    const meta = {
      probeOk: Boolean(video),
      probeError: video ? null : 'No video stream',
      durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
      durationFormatted: formatDurationSeconds(durationSeconds),
      bitrateMbps: Number.isFinite(bitrateMbps) ? bitrateMbps : null,
      formatName: format.format_name || null,
      width: video?.width ?? null,
      height: video?.height ?? null,
      quality: video ? heightToQualityLabel(video.height, video.width) : '',
      videoCodec: video ? videoCodecNameToLabel(video.codec_name) : '',
      audioTrackCount: audioStreams.length,
      audioSummary:
        audioStreams
          .slice(0, 5)
          .map((s) => audioCodecNameToLabel(s.codec_name))
          .filter(Boolean)
          .join(', ') || null,
      subtitleTrackCount: subtitleStreams.length,
      streamCount: streams.length,
      filenameHints: hints,
    };

    meta.explanations = buildLargeFileExplanations(fileName, meta);
    return meta;
  } catch (err) {
    const probeError = [err.stderr, err.message]
      .filter(Boolean)
      .join('\n')
      .trim()
      .slice(0, 300);
    return {
      probeOk: false,
      probeError: probeError || 'ffprobe failed',
      filenameHints: hints,
      explanations: buildLargeFileExplanations(fileName, {
        probeOk: false,
        probeError: probeError || 'ffprobe failed',
      }),
    };
  }
}

module.exports = {
  namingFormatUsesToken,
  namingFormatUsesQuality,
  namingFormatUsesCodec,
  namingFormatUsesAudio,
  formatNeedsFfprobe,
  resetProbeFailureLogLimit,
  probeVideoStreamMetadata,
  probeVideoQuality,
  enrichMetadataForFormat,
  heightToQualityLabel,
  videoCodecNameToLabel,
  audioCodecNameToLabel,
  isFfprobeAvailable,
  probeMediaIntegrity,
  probeLargeFileAnalysis,
  /** @deprecated */ codecNameToLabel: videoCodecNameToLabel,
};