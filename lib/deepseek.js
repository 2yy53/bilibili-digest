var BILI_DIGEST_DEEPSEEK = (() => {
  class AiError extends Error {
    constructor(code, message) { super(message); this.name = "AiError"; this.code = code; }
  }

  function createClient({ fetchImpl = fetch, getSettings, loadPrompt, core }) {
    async function readBoundedResponse(response, onActivity) {
      const reader = response.body?.getReader?.();
      if (!reader) {
        const text = await response.text();
        onActivity();
        if (new TextEncoder().encode(text).byteLength > 2 * 1024 * 1024) {
          throw new AiError("DEEPSEEK_ERROR", "DeepSeek 响应超过 2 MiB 大小限制。");
        }
        return text;
      }
      const decoder = new TextDecoder();
      let text = "";
      let bytes = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        onActivity();
        bytes += chunk.value?.byteLength || 0;
        if (bytes > 2 * 1024 * 1024) {
          await reader.cancel().catch(() => {});
          throw new AiError("DEEPSEEK_ERROR", "DeepSeek 响应超过 2 MiB 大小限制。");
        }
        text += decoder.decode(chunk.value, { stream: true });
      }
      return text + decoder.decode();
    }

    async function request(messages, { maxTokens = 4096, signal } = {}) {
      const settings = await getSettings();
      if (!settings.aiApiKey) throw new AiError("DEEPSEEK_ERROR", "请先在设置中填写 DeepSeek API Key。");
      const controller = new AbortController();
      let timeoutKind = "";
      let idleTimeout;
      const abortForTimeout = (kind) => {
        if (controller.signal.aborted) return;
        timeoutKind = kind;
        controller.abort();
      };
      const resetIdleTimeout = () => {
        clearTimeout(idleTimeout);
        idleTimeout = setTimeout(() => abortForTimeout("idle"), 50000);
      };
      const hardTimeout = setTimeout(() => abortForTimeout("hard"), 120000);
      resetIdleTimeout();
      const abortFromParent = () => controller.abort();
      signal?.addEventListener?.("abort", abortFromParent, { once: true });
      try {
        const response = await fetchImpl("https://api.deepseek.com/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.aiApiKey}` },
          body: JSON.stringify({
            model: "deepseek-v4-flash", messages, max_tokens: maxTokens,
            temperature: 0.2, response_format: { type: "json_object" }, thinking: { type: "disabled" },
          }),
          signal: controller.signal,
        });
        resetIdleTimeout();
        const raw = await readBoundedResponse(response, resetIdleTimeout);
        let data;
        try { data = JSON.parse(raw); }
        catch (_error) { throw new AiError("DEEPSEEK_ERROR", "DeepSeek 返回了无效响应。"); }
        if (!response.ok) throw new AiError("DEEPSEEK_ERROR", data.error?.message || `DeepSeek 请求失败（HTTP ${response.status}）`);
        const content = data.choices?.[0]?.message?.content;
        if (typeof content !== "string" || !content.trim()) throw new AiError("INVALID_MODEL_OUTPUT", "DeepSeek 没有返回内容。");
        return content;
      } catch (error) {
        if (error.name === "AbortError") {
          if (signal?.aborted) throw new AiError("CANCELLED", "任务已取消。");
          const timeoutMessage = timeoutKind === "idle" ? "DeepSeek 请求连续50秒没有数据。" : "DeepSeek 请求超过120秒。";
          throw new AiError("DEEPSEEK_ERROR", timeoutMessage);
        }
        if (error instanceof AiError) throw error;
        throw new AiError("DEEPSEEK_ERROR", `DeepSeek 请求失败：${error.message}`);
      } finally {
        clearTimeout(idleTimeout);
        clearTimeout(hardTimeout);
        signal?.removeEventListener?.("abort", abortFromParent);
      }
    }

    async function requestValidated(messages, validator, context, signal, maxTokens = 4096) {
      let lastError;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const retry = attempt ? "\n上一次输出未通过结构校验。只返回完整、合法、符合字段要求的 JSON 对象。" : "";
          const adjusted = messages.map((message, index) => index === 0 ? { ...message, content: message.content + retry } : message);
          const text = await request(adjusted, { signal, maxTokens });
          return validator(core.parseLooseJson(text), context);
        } catch (error) {
          lastError = error;
          if (["DEEPSEEK_ERROR", "CANCELLED"].includes(error.code)) throw error;
        }
      }
      throw new AiError("INVALID_MODEL_OUTPUT", lastError?.message || "DeepSeek 输出格式无效。");
    }

    function timestampedText(segments) {
      return segments.map((segment) => `[${Math.floor(segment.start / 60)}:${String(Math.floor(segment.start % 60)).padStart(2, "0")}] ${segment.text}`).join("\n");
    }

    async function summarizeChunk(course, part, transcript, chunk, signal) {
      const system = await loadPrompt("part-summary.md", "System prompt", {
        source: transcript.source, confidence: transcript.confidence,
      });
      const user = await loadPrompt("part-summary.md", "User prompt", {
        courseTitle: course.title, partTitle: part.title, page: part.page,
        source: transcript.source, transcript: timestampedText(chunk),
      });
      return requestValidated(
        [{ role: "system", content: system }, { role: "user", content: user }],
        (input) => core.validatePartDigest(input, part, { ...transcript, segments: chunk }), null, signal, 8192,
      );
    }

    async function summarizePart(course, part, transcript, signal) {
      const chunks = core.splitTranscript(transcript.segments);
      if (!chunks.length) throw new AiError("NO_TEXT", "该分P没有可总结的文本。");
      const partials = [];
      for (const chunk of chunks) {
        if (signal?.aborted) throw new AiError("CANCELLED", "任务已取消。");
        partials.push(await summarizeChunk(course, part, transcript, chunk, signal));
      }
      if (partials.length === 1) return partials[0];
      const system = await loadPrompt("part-summary.md", "Reduction system prompt", { source: transcript.source });
      const user = await loadPrompt("part-summary.md", "Reduction user prompt", {
        courseTitle: course.title, partTitle: part.title, partials: JSON.stringify(partials),
      });
      return requestValidated(
        [{ role: "system", content: system }, { role: "user", content: user }],
        (input) => core.validatePartDigest(input, part, transcript), null, signal, 8192,
      );
    }

    async function buildCourseMap(course, selectedCids, digests, missingParts, signal) {
      if (!digests.length) {
        return {
          schemaVersion: core.NOTE_SCHEMA_VERSION,
          bvid: course.bvid, selectedCids: selectedCids.map(String),
          overview: "所选分P均未取得可用字幕，因此暂时无法生成内容概述。",
          learningPath: [], sections: [], missingParts,
        };
      }
      const system = await loadPrompt("course-map.md", "System prompt", {});
      const user = await loadPrompt("course-map.md", "User prompt", {
        courseTitle: course.title, description: course.description,
        digests: JSON.stringify(digests), missingParts: JSON.stringify(missingParts),
      });
      return requestValidated(
        [{ role: "system", content: system }, { role: "user", content: user }],
        (input) => core.validateCourseMap(input, { bvid: course.bvid, selectedCids, digests, missingParts }), null, signal, 8192,
      );
    }

    return { request, summarizePart, buildCourseMap };
  }
  return { AiError, createClient };
})();

if (typeof module !== "undefined" && module.exports) module.exports = BILI_DIGEST_DEEPSEEK;
