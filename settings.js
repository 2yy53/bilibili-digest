/** Public, non-secret defaults shared by the service worker and tests. */
var BILI_DIGEST_SETTINGS = (() => {
  const STORAGE_KEY = "bili_digest_settings";
  const DEFAULTS = Object.freeze({
    provider: "deepseek",
    aiApiKey: "",
    aiBaseUrl: "https://api.deepseek.com",
    aiModel: "deepseek-v4-flash",
  });

  function normalize(input = {}) {
    return {
      provider: DEFAULTS.provider,
      aiApiKey:
        typeof input.aiApiKey === "string" ? input.aiApiKey.trim() : "",
      aiBaseUrl: DEFAULTS.aiBaseUrl,
      aiModel: DEFAULTS.aiModel,
    };
  }

  function chatCompletionsUrl() {
    return `${DEFAULTS.aiBaseUrl}/chat/completions`;
  }

  return { STORAGE_KEY, DEFAULTS, normalize, chatCompletionsUrl };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = BILI_DIGEST_SETTINGS;
}
