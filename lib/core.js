var BILI_DIGEST_CORE = (() => {
  const SOURCE_CONFIDENCE = Object.freeze({
    human_subtitle: "high",
    ai_subtitle: "medium",
    protobuf_subtitle: "medium",
    bilibili_ai_conclusion: "low",
    missing: "none",
  });

  function parseVideoUrl(input) {
    const text = String(input || "");
    const match = text.match(/(?:^|\/)(BV[0-9A-Za-z]{10})(?:[/?#]|$)/i) ||
      text.match(/^(BV[0-9A-Za-z]{10})$/i);
    if (!match) return null;
    let page = 1;
    try {
      const url = new URL(text.includes("://") ? text : `https://www.bilibili.com/video/${match[1]}`);
      const parsed = Number.parseInt(url.searchParams.get("p") || "1", 10);
      if (Number.isInteger(parsed) && parsed > 0) page = parsed;
    } catch (_error) {
      // A bare BV id is valid and simply refers to P1.
    }
    return { bvid: `BV${match[1].slice(2)}`, page };
  }

  function normalizeText(value) {
    return String(value || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeSegments(entries) {
    if (!Array.isArray(entries)) return [];
    return entries
      .map((entry, index) => {
        const text = normalizeText(entry?.content ?? entry?.text ?? entry?.subtitle);
        const start = Number(entry?.from ?? entry?.start ?? entry?.start_time ?? entry?.start_timestamp ?? entry?.timestamp ?? 0);
        const rawEnd = Number(entry?.to ?? entry?.end ?? entry?.end_time ?? entry?.end_timestamp ?? start);
        const end = Number.isFinite(rawEnd) ? Math.max(start, rawEnd) : start;
        return {
          id: `segment-${index}-${Math.round((Number.isFinite(start) ? start : 0) * 1000)}`,
          start: Number.isFinite(start) ? Math.max(0, start) : 0,
          end: Number.isFinite(end) ? end : 0,
          text,
        };
      })
      .filter((entry) => entry.text);
  }

  function isChineseTrack(track) {
    const value = `${track?.lan || ""} ${track?.lan_doc || track?.name || ""}`.toLowerCase();
    return /(^|[-_\s])(zh|chi|cn)([-_\s]|$)|中文|汉语|漢語/.test(value);
  }

  function isAiTrack(track) {
    const value = `${track?.lan || ""} ${track?.lan_doc || track?.name || ""}`.toLowerCase();
    return value.includes("ai") || Number(track?.ai_type || track?.aiType || 0) > 0;
  }

  function chooseSubtitleTrack(tracks) {
    if (!Array.isArray(tracks)) return null;
    return [...tracks]
      .filter((track) => track && (track.subtitle_url || track.url))
      .sort((left, right) => {
        const score = (track) => {
          const chinese = isChineseTrack(track);
          const ai = isAiTrack(track);
          if (chinese && !ai) return 0;
          if (chinese && ai) return 1;
          if (!ai) return 2;
          return 3;
        };
        return score(left) - score(right);
      })[0] || null;
  }

  function stableHash(value) {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function transcriptFingerprint(transcript) {
    return stableHash({
      source: transcript?.source,
      language: transcript?.language,
      segments: (transcript?.segments || []).map(({ start, end, text }) => [start, end, text]),
    });
  }

  function splitTranscript(segments, { maxChars = 18000, maxSeconds = 1500 } = {}) {
    const chunks = [];
    let current = [];
    let characters = 0;
    let startedAt = 0;
    const flush = () => {
      if (!current.length) return;
      chunks.push(current);
      current = [];
      characters = 0;
    };
    for (const segment of segments || []) {
      if (!current.length) startedAt = segment.start || 0;
      const nextSize = characters + String(segment.text || "").length;
      if (current.length && (nextSize > maxChars || (segment.start || 0) - startedAt > maxSeconds)) {
        flush();
        startedAt = segment.start || 0;
      }
      current.push(segment);
      characters += String(segment.text || "").length;
    }
    flush();
    return chunks;
  }

  function parseLooseJson(text) {
    if (text && typeof text === "object") return text;
    const source = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    try {
      return JSON.parse(source);
    } catch (_error) {
      const start = source.indexOf("{");
      const end = source.lastIndexOf("}");
      if (start < 0 || end <= start) throw new Error("模型没有返回 JSON 对象");
      return JSON.parse(source.slice(start, end + 1).replace(/,\s*([}\]])/g, "$1"));
    }
  }

  function cleanStringArray(value, limit = 30) {
    return (Array.isArray(value) ? value : [])
      .map(normalizeText)
      .filter(Boolean)
      .slice(0, limit);
  }

  function validatePartDigest(input, part, transcript) {
    if (!input || typeof input !== "object") throw new Error("分P摘要不是对象");
    const oneSentence = normalizeText(input.oneSentence || input.summary);
    if (!oneSentence) throw new Error("分P摘要缺少一句话概述");
    const keyMoments = (Array.isArray(input.keyMoments) ? input.keyMoments : [])
      .map((moment) => ({
        seconds: Math.max(0, Number(moment?.seconds ?? moment?.start ?? 0) || 0),
        title: normalizeText(moment?.title || moment?.label),
        detail: normalizeText(moment?.detail || moment?.description),
      }))
      .filter((moment) => moment.title)
      .slice(0, 12);
    return {
      cid: String(part.cid),
      page: Number(part.page),
      title: String(part.title || `P${part.page}`),
      oneSentence,
      topics: cleanStringArray(input.topics),
      prerequisites: cleanStringArray(input.prerequisites),
      outcomes: cleanStringArray(input.outcomes),
      keyMoments,
      source: transcript.source,
      confidence: transcript.confidence,
    };
  }

  function validateCourseMap(input, { bvid, selectedCids, digests, missingParts }) {
    if (!input || typeof input !== "object") throw new Error("课程地图不是对象");
    const overview = normalizeText(input.overview);
    if (!overview) throw new Error("课程地图缺少整体概述");
    const byCid = new Map(digests.map((digest) => [String(digest.cid), digest]));
    const modules = (Array.isArray(input.modules) ? input.modules : [])
      .map((module) => {
        const cid = String(module?.cid || "");
        const original = byCid.get(cid);
        if (!original) return null;
        return {
          ...original,
          moduleTitle: normalizeText(module.moduleTitle || module.title || original.title),
          role: normalizeText(module.role),
          dependencies: cleanStringArray(module.dependencies),
        };
      })
      .filter(Boolean);
    for (const digest of digests) {
      if (!modules.some((module) => String(module.cid) === String(digest.cid))) {
        modules.push({ ...digest, moduleTitle: digest.title, role: "", dependencies: [] });
      }
    }
    return {
      bvid,
      selectedCids: selectedCids.map(String),
      overview,
      learningPath: cleanStringArray(input.learningPath, 50),
      modules,
      missingParts: missingParts.map((part) => ({
        cid: String(part.cid), page: Number(part.page), title: part.title, errorCode: part.errorCode || "NO_TEXT",
      })),
    };
  }

  return {
    SOURCE_CONFIDENCE,
    parseVideoUrl,
    normalizeText,
    normalizeSegments,
    isChineseTrack,
    isAiTrack,
    chooseSubtitleTrack,
    stableHash,
    transcriptFingerprint,
    splitTranscript,
    parseLooseJson,
    validatePartDigest,
    validateCourseMap,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = BILI_DIGEST_CORE;
