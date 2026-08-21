var BILI_DIGEST_CORE = (() => {
  const NOTE_SCHEMA_VERSION = 2;
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

  function cleanSteps(value, limit = 8) {
    const entries = Array.isArray(value) ? value : value ? [value] : [];
    return cleanStringArray(entries, limit);
  }

  function nearestTimestamp(seconds, transcript) {
    const starts = (transcript?.segments || []).map((segment) => Number(segment.start)).filter(Number.isFinite);
    if (!starts.length) return Math.max(0, Number(seconds) || 0);
    const target = Math.max(0, Number(seconds) || 0);
    return starts.reduce((nearest, candidate) =>
      Math.abs(candidate - target) < Math.abs(nearest - target) ? candidate : nearest, starts[0]);
  }

  function validateKnowledgePoint(input, part, transcript, index) {
    const title = normalizeText(input?.title);
    const what = normalizeText(input?.what);
    const why = normalizeText(input?.why);
    const when = normalizeText(input?.when);
    const how = cleanSteps(input?.how);
    if (!title || !what || !why || !when || !how.length) {
      throw new Error("知识点必须包含标题、是什么、为什么、什么时候用和怎么用");
    }
    const keyMoments = (Array.isArray(input?.keyMoments) ? input.keyMoments : [])
      .map((moment) => ({
        seconds: nearestTimestamp(moment?.seconds ?? moment?.start, transcript),
        title: normalizeText(moment?.title || title),
      }))
      .filter((moment) => moment.title)
      .slice(0, 3);
    return {
      id: `${part.cid}:kp:${index + 1}`,
      title,
      what,
      why,
      when,
      how,
      keyMoments,
    };
  }

  function validatePartDigest(input, part, transcript) {
    if (!input || typeof input !== "object") throw new Error("分P摘要不是对象");
    const oneSentence = normalizeText(input.oneSentence || input.summary);
    if (!oneSentence) throw new Error("分P摘要缺少一句话概述");
    let pointIndex = 0;
    const sections = (Array.isArray(input.sections) ? input.sections : [])
      .map((section) => {
        const title = normalizeText(section?.title);
        const takeaway = normalizeText(section?.takeaway);
        const subtopics = (Array.isArray(section?.subtopics) ? section.subtopics : [])
          .map((subtopic) => {
            const subtopicTitle = normalizeText(subtopic?.title);
            const subtopicTakeaway = normalizeText(subtopic?.takeaway);
            const knowledgePoints = (Array.isArray(subtopic?.knowledgePoints) ? subtopic.knowledgePoints : [])
              .map((point) => validateKnowledgePoint(point, part, transcript, pointIndex++));
            if (!subtopicTitle || !subtopicTakeaway || !knowledgePoints.length) return null;
            return { title: subtopicTitle, takeaway: subtopicTakeaway, knowledgePoints };
          })
          .filter(Boolean);
        if (!title || !takeaway || !subtopics.length) return null;
        return { title, takeaway, subtopics };
      })
      .filter(Boolean);
    if (!sections.length || pointIndex === 0) throw new Error("分P摘要缺少三级知识结构");
    const keyMoments = sections.flatMap((section) => section.subtopics)
      .flatMap((subtopic) => subtopic.knowledgePoints)
      .flatMap((point) => point.keyMoments)
      .slice(0, 30);
    return {
      schemaVersion: NOTE_SCHEMA_VERSION,
      cid: String(part.cid),
      page: Number(part.page),
      title: String(part.title || `P${part.page}`),
      oneSentence,
      sections,
      topics: sections.map((section) => section.title),
      prerequisites: cleanStringArray(input.prerequisites),
      outcomes: cleanStringArray(input.outcomes),
      keyMoments,
      source: transcript.source,
      confidence: transcript.confidence,
    };
  }

  function isCurrentPartDigest(digest) {
    return Number(digest?.schemaVersion) === NOTE_SCHEMA_VERSION && Array.isArray(digest?.sections) && digest.sections.length > 0;
  }

  function allDigestPoints(digests) {
    return (digests || []).flatMap((digest) =>
      (digest.sections || []).flatMap((section) =>
        (section.subtopics || []).flatMap((subtopic) =>
          (subtopic.knowledgePoints || []).map((point) => ({
            ...point,
            cid: String(digest.cid),
            page: Number(digest.page),
            partTitle: digest.title,
            source: digest.source,
            confidence: digest.confidence,
          })))));
  }

  function validateCourseMap(input, { bvid, selectedCids, digests, missingParts }) {
    if (!input || typeof input !== "object") throw new Error("课程地图不是对象");
    const overview = normalizeText(input.overview);
    if (!overview) throw new Error("课程地图缺少整体概述");
    const points = allDigestPoints(digests);
    const pointById = new Map(points.map((point) => [point.id, point]));
    const usedIds = new Set();
    const sections = (Array.isArray(input.sections) ? input.sections : [])
      .map((section) => {
        const title = normalizeText(section?.title);
        const takeaway = normalizeText(section?.takeaway);
        const subtopics = (Array.isArray(section?.subtopics) ? section.subtopics : [])
          .map((subtopic) => {
            const subtopicTitle = normalizeText(subtopic?.title);
            const subtopicTakeaway = normalizeText(subtopic?.takeaway);
            const knowledgePoints = [];
            for (const id of cleanStringArray(subtopic?.knowledgePointIds, 100)) {
              const point = pointById.get(id);
              if (!point || usedIds.has(point.id)) continue;
              usedIds.add(point.id);
              knowledgePoints.push(point);
            }
            if (!subtopicTitle || !subtopicTakeaway || !knowledgePoints.length) return null;
            return { title: subtopicTitle, takeaway: subtopicTakeaway, knowledgePoints };
          })
          .filter(Boolean);
        if (!title || !takeaway || !subtopics.length) return null;
        return { title, takeaway, subtopics };
      })
      .filter(Boolean);
    if (points.length && !sections.length) throw new Error("课程地图缺少有效的三级知识结构");
    const unused = points.filter((point) => !usedIds.has(point.id));
    if (unused.length) {
      sections.push({
        title: "补充知识点",
        takeaway: "以下内容来自分P摘要，但未被课程结构覆盖。",
        subtopics: [{ title: "未归类内容", takeaway: "保留视频中已提取的知识点。", knowledgePoints: unused }],
      });
    }
    return {
      schemaVersion: NOTE_SCHEMA_VERSION,
      bvid,
      selectedCids: selectedCids.map(String),
      overview,
      learningPath: cleanStringArray(input.learningPath, 50),
      sections,
      missingParts: missingParts.map((part) => ({
        cid: String(part.cid), page: Number(part.page), title: part.title, errorCode: part.errorCode || "NO_TEXT",
      })),
    };
  }


  function toChineseOrdinal(value) {
    const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
    const number = Number(value);
    if (number < 10) return digits[number];
    if (number < 20) return `十${number % 10 ? digits[number % 10] : ""}`;
    if (number < 100) return `${digits[Math.floor(number / 10)]}十${number % 10 ? digits[number % 10] : ""}`;
    return String(number);
  }

  function formatTimestamp(seconds) {
    const value = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const remain = value % 60;
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remain).padStart(2, "0")}` : `${minutes}:${String(remain).padStart(2, "0")}`;
  }

  function escapeMarkdown(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/([`*_[\]<>#])/g, "\\$1");
  }

  function courseMapToMarkdown(course, map) {
    const lines = [`# ${escapeMarkdown(course?.title || "视频总结")}`, "", escapeMarkdown(map?.overview), ""];
    if ((map?.learningPath || []).length) {
      lines.push("## 推荐学习顺序", "", ...map.learningPath.map((step, index) => `${index + 1}. ${escapeMarkdown(step)}`), "");
    }
    if (!Array.isArray(map?.sections)) {
      (map?.modules || []).forEach((module, index) => {
        lines.push(`## ${toChineseOrdinal(index + 1)}、${escapeMarkdown(module.moduleTitle || module.title)}`, "", escapeMarkdown(module.oneSentence), "");
      });
      return `${lines.join("\n").trim()}\n`;
    }
    map.sections.forEach((section, sectionIndex) => {
      lines.push(`## ${toChineseOrdinal(sectionIndex + 1)}、${escapeMarkdown(section.title)}`, "", `> ${escapeMarkdown(section.takeaway)}`, "");
      section.subtopics.forEach((subtopic, subtopicIndex) => {
        lines.push(`### ${subtopicIndex + 1}. ${escapeMarkdown(subtopic.title)}`, "", `> ${escapeMarkdown(subtopic.takeaway)}`, "");
        subtopic.knowledgePoints.forEach((point, pointIndex) => {
          lines.push(`#### ${subtopicIndex + 1}.${pointIndex + 1} ${escapeMarkdown(point.title)}`, "",
            `**是什么：** ${escapeMarkdown(point.what)}`, "",
            `**为什么要有：** ${escapeMarkdown(point.why)}`, "",
            `**什么时候用：** ${escapeMarkdown(point.when)}`, "", "**怎么用：**", "");
          point.how.forEach((step, index) => lines.push(`${index + 1}. ${escapeMarkdown(step)}`));
          if (point.keyMoments.length) {
            const moments = point.keyMoments.map((moment) => {
              const url = `https://www.bilibili.com/video/${course.bvid}?p=${point.page}&t=${Math.floor(moment.seconds)}`;
              return `[${formatTimestamp(moment.seconds)} ${escapeMarkdown(moment.title)}](${url})`;
            });
            lines.push("", `**视频定位：** ${moments.join(" · ")}`);
          }
          lines.push("");
        });
      });
    });
    return `${lines.join("\n").trim()}\n`;
  }

  function transcriptsToMarkdown(course, entries) {
    const sourceNames = { human_subtitle: "人工字幕", ai_subtitle: "B站 AI 字幕", protobuf_subtitle: "新版字幕", bilibili_ai_conclusion: "B站 AI 总结" };
    const lines = [`# ${escapeMarkdown(course?.title || "视频")}｜字幕`, "", `- BV号：${escapeMarkdown(course?.bvid)}`, ""];
    (entries || []).forEach(({ part, transcript }) => {
      lines.push(`## P${part.page} ${escapeMarkdown(part.title)}`, "", `> 来源：${sourceNames[transcript.source] || "未知来源"}；置信度：${escapeMarkdown(transcript.confidence || "未知")}`, "");
      transcript.segments.forEach((segment) => lines.push(`- **${formatTimestamp(segment.start)}** ${escapeMarkdown(segment.text)}`));
      lines.push("");
    });
    return `${lines.join("\n").trim()}\n`;
  }

  function mermaidLabel(value) {
    return normalizeText(value).replace(/["[\]{}()]/g, " ").slice(0, 80) || "未命名";
  }

  function courseMapToMindmapMarkdown(course, map) {
    const lines = [`# ${escapeMarkdown(course?.title || "视频总结")}｜思维导图`, "", "```mermaid", "mindmap", `  root((${mermaidLabel(course?.title || "视频总结")}))`];
    (map?.sections || []).forEach((section, sectionIndex) => {
      lines.push(`    s${sectionIndex + 1}[${toChineseOrdinal(sectionIndex + 1)}、${mermaidLabel(section.title)}]`);
      section.subtopics.forEach((subtopic, subtopicIndex) => {
        lines.push(`      s${sectionIndex + 1}t${subtopicIndex + 1}[${subtopicIndex + 1}. ${mermaidLabel(subtopic.title)}]`);
        subtopic.knowledgePoints.forEach((point, pointIndex) => {
          lines.push(`        s${sectionIndex + 1}t${subtopicIndex + 1}p${pointIndex + 1}[${subtopicIndex + 1}.${pointIndex + 1} ${mermaidLabel(point.title)}]`);
        });
      });
    });
    lines.push("```", "");
    return lines.join("\n");
  }

  return {
    NOTE_SCHEMA_VERSION,
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
    isCurrentPartDigest,
    validateCourseMap,
    toChineseOrdinal,
    formatTimestamp,
    escapeMarkdown,
    courseMapToMarkdown,
    transcriptsToMarkdown,
    courseMapToMindmapMarkdown,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = BILI_DIGEST_CORE;
