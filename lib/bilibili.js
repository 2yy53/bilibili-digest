var BILI_DIGEST_BILIBILI = (() => {
  const MIXIN_KEY_ENC_TAB = [
    46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,
    37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52,
  ];

  class DigestError extends Error {
    constructor(code, message, details = {}) {
      super(message);
      this.name = "DigestError";
      this.code = code;
      this.details = details;
    }
  }

  function mapApiError(code, message = "") {
    const numeric = Number(code);
    if (numeric === -101 || numeric === -111) return new DigestError("LOGIN_REQUIRED", "请先在当前浏览器登录哔哩哔哩后重试。");
    if (numeric === -412 || numeric === -352) return new DigestError("RISK_CONTROL", "B站暂时限制了请求，请稍后重试并降低处理频率。");
    if (numeric === -403 || numeric === 6001001) return new DigestError("RESTRICTED_PART", "当前分P受访问限制，无法读取文本。");
    if (numeric === -404 || numeric === 10004) return new DigestError("RESTRICTED_PART", "视频或分P不存在，或者当前账号无权访问。");
    return new DigestError("API_CHANGED", message || `B站接口返回异常（${numeric}）`, { apiCode: numeric });
  }

  function md5(input) {
    function add32(a, b) { return (a + b) & 0xffffffff; }
    function cmn(q, a, b, x, s, t) { return add32((add32(add32(a, q), add32(x, t)) << s) | (add32(add32(a, q), add32(x, t)) >>> (32 - s)), b); }
    function ff(a,b,c,d,x,s,t){return cmn((b&c)|((~b)&d),a,b,x,s,t)}
    function gg(a,b,c,d,x,s,t){return cmn((b&d)|(c&(~d)),a,b,x,s,t)}
    function hh(a,b,c,d,x,s,t){return cmn(b^c^d,a,b,x,s,t)}
    function ii(a,b,c,d,x,s,t){return cmn(c^(b|(~d)),a,b,x,s,t)}
    const text = unescape(encodeURIComponent(String(input)));
    const length = text.length;
    const words = [];
    for (let i = 0; i < length; i++) words[i >> 2] = (words[i >> 2] || 0) | text.charCodeAt(i) << ((i % 4) * 8);
    words[length >> 2] = (words[length >> 2] || 0) | 0x80 << ((length % 4) * 8);
    words[(((length + 8) >>> 6) << 4) + 14] = length * 8;
    let a=1732584193,b=-271733879,c=-1732584194,d=271733878;
    for(let i=0;i<words.length;i+=16){const oa=a,ob=b,oc=c,od=d;
      a=ff(a,b,c,d,words[i]||0,7,-680876936);d=ff(d,a,b,c,words[i+1]||0,12,-389564586);c=ff(c,d,a,b,words[i+2]||0,17,606105819);b=ff(b,c,d,a,words[i+3]||0,22,-1044525330);
      a=ff(a,b,c,d,words[i+4]||0,7,-176418897);d=ff(d,a,b,c,words[i+5]||0,12,1200080426);c=ff(c,d,a,b,words[i+6]||0,17,-1473231341);b=ff(b,c,d,a,words[i+7]||0,22,-45705983);
      a=ff(a,b,c,d,words[i+8]||0,7,1770035416);d=ff(d,a,b,c,words[i+9]||0,12,-1958414417);c=ff(c,d,a,b,words[i+10]||0,17,-42063);b=ff(b,c,d,a,words[i+11]||0,22,-1990404162);
      a=ff(a,b,c,d,words[i+12]||0,7,1804603682);d=ff(d,a,b,c,words[i+13]||0,12,-40341101);c=ff(c,d,a,b,words[i+14]||0,17,-1502002290);b=ff(b,c,d,a,words[i+15]||0,22,1236535329);
      a=gg(a,b,c,d,words[i+1]||0,5,-165796510);d=gg(d,a,b,c,words[i+6]||0,9,-1069501632);c=gg(c,d,a,b,words[i+11]||0,14,643717713);b=gg(b,c,d,a,words[i]||0,20,-373897302);
      a=gg(a,b,c,d,words[i+5]||0,5,-701558691);d=gg(d,a,b,c,words[i+10]||0,9,38016083);c=gg(c,d,a,b,words[i+15]||0,14,-660478335);b=gg(b,c,d,a,words[i+4]||0,20,-405537848);
      a=gg(a,b,c,d,words[i+9]||0,5,568446438);d=gg(d,a,b,c,words[i+14]||0,9,-1019803690);c=gg(c,d,a,b,words[i+3]||0,14,-187363961);b=gg(b,c,d,a,words[i+8]||0,20,1163531501);
      a=gg(a,b,c,d,words[i+13]||0,5,-1444681467);d=gg(d,a,b,c,words[i+2]||0,9,-51403784);c=gg(c,d,a,b,words[i+7]||0,14,1735328473);b=gg(b,c,d,a,words[i+12]||0,20,-1926607734);
      a=hh(a,b,c,d,words[i+5]||0,4,-378558);d=hh(d,a,b,c,words[i+8]||0,11,-2022574463);c=hh(c,d,a,b,words[i+11]||0,16,1839030562);b=hh(b,c,d,a,words[i+14]||0,23,-35309556);
      a=hh(a,b,c,d,words[i+1]||0,4,-1530992060);d=hh(d,a,b,c,words[i+4]||0,11,1272893353);c=hh(c,d,a,b,words[i+7]||0,16,-155497632);b=hh(b,c,d,a,words[i+10]||0,23,-1094730640);
      a=hh(a,b,c,d,words[i+13]||0,4,681279174);d=hh(d,a,b,c,words[i]||0,11,-358537222);c=hh(c,d,a,b,words[i+3]||0,16,-722521979);b=hh(b,c,d,a,words[i+6]||0,23,76029189);
      a=hh(a,b,c,d,words[i+9]||0,4,-640364487);d=hh(d,a,b,c,words[i+12]||0,11,-421815835);c=hh(c,d,a,b,words[i+15]||0,16,530742520);b=hh(b,c,d,a,words[i+2]||0,23,-995338651);
      a=ii(a,b,c,d,words[i]||0,6,-198630844);d=ii(d,a,b,c,words[i+7]||0,10,1126891415);c=ii(c,d,a,b,words[i+14]||0,15,-1416354905);b=ii(b,c,d,a,words[i+5]||0,21,-57434055);
      a=ii(a,b,c,d,words[i+12]||0,6,1700485571);d=ii(d,a,b,c,words[i+3]||0,10,-1894986606);c=ii(c,d,a,b,words[i+10]||0,15,-1051523);b=ii(b,c,d,a,words[i+1]||0,21,-2054922799);
      a=ii(a,b,c,d,words[i+8]||0,6,1873313359);d=ii(d,a,b,c,words[i+15]||0,10,-30611744);c=ii(c,d,a,b,words[i+6]||0,15,-1560198380);b=ii(b,c,d,a,words[i+13]||0,21,1309151649);
      a=ii(a,b,c,d,words[i+4]||0,6,-145523070);d=ii(d,a,b,c,words[i+11]||0,10,-1120210379);c=ii(c,d,a,b,words[i+2]||0,15,718787259);b=ii(b,c,d,a,words[i+9]||0,21,-343485551);
      a=add32(a,oa);b=add32(b,ob);c=add32(c,oc);d=add32(d,od);
    }
    return [a,b,c,d].map((word)=>[0,8,16,24].map((shift)=>((word>>>shift)&255).toString(16).padStart(2,"0")).join("")).join("");
  }

  function extractWbiKey(url) {
    const name = String(url || "").split("/").pop()?.split(".")[0];
    if (!name) throw new DigestError("API_CHANGED", "无法解析B站 WBI key");
    return name;
  }

  function signWbi(params, imgKey, subKey, timestamp = Math.floor(Date.now() / 1000)) {
    const mixin = MIXIN_KEY_ENC_TAB.map((index) => `${imgKey}${subKey}`[index]).join("").slice(0, 32);
    const signed = { ...params, wts: timestamp };
    const query = Object.keys(signed).sort().map((key) => {
      const value = String(signed[key] ?? "").replace(/[!'()*]/g, "");
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    }).join("&");
    return { ...signed, w_rid: md5(query + mixin) };
  }

  function queryString(params) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
    });
    return query.toString();
  }

  function normalizeSubtitleUrl(value) {
    const url = String(value || "");
    if (url.startsWith("//")) return `https:${url}`;
    if (url.startsWith("https://")) return url;
    throw new DigestError("API_CHANGED", "字幕地址格式发生变化");
  }

  function createAdapter({ fetchImpl = fetch, now = () => Date.now(), protobuf, core }) {
    let navCache = null;
    async function fetchResponse(url, options = {}) {
      let response;
      try {
        response = await fetchImpl(url, { credentials: "include", cache: "no-store", ...options });
      } catch (error) {
        throw new DigestError("NETWORK_ERROR", `网络请求失败：${error.message}`);
      }
      if (response.status === 412 || response.status === 429) throw mapApiError(-412);
      if (!response.ok) throw new DigestError("NETWORK_ERROR", `B站请求失败（HTTP ${response.status}）`);
      return response;
    }

    async function fetchJson(url, options) {
      const response = await fetchResponse(url, options);
      try { return await response.json(); }
      catch (_error) { throw new DigestError("API_CHANGED", "B站接口没有返回预期的 JSON"); }
    }

    async function getNav(force = false) {
      if (!force && navCache && now() - navCache.fetchedAt < 10 * 60 * 1000) return navCache;
      const json = await fetchJson("https://api.bilibili.com/x/web-interface/nav");
      if (json.code !== 0) throw mapApiError(json.code, json.message);
      const imgKey = extractWbiKey(json.data?.wbi_img?.img_url);
      const subKey = extractWbiKey(json.data?.wbi_img?.sub_url);
      navCache = { imgKey, subKey, isLogin: Boolean(json.data?.isLogin), fetchedAt: now() };
      return navCache;
    }

    async function signedJson(path, params, retry = true) {
      const nav = await getNav(!retry);
      const signed = signWbi(params, nav.imgKey, nav.subKey, Math.floor(now() / 1000));
      const json = await fetchJson(`https://api.bilibili.com${path}?${queryString(signed)}`);
      if (json.code === 0) return json;
      if (retry && [-403, -352].includes(Number(json.code))) {
        navCache = null;
        return signedJson(path, params, false);
      }
      throw mapApiError(json.code, json.message);
    }

    async function loadCourse(bvid) {
      const json = await fetchJson(`https://api.bilibili.com/x/web-interface/view?${queryString({ bvid })}`);
      if (json.code !== 0) throw mapApiError(json.code, json.message);
      const data = json.data || {};
      const pages = (data.pages || []).map((page) => ({
        page: Number(page.page), cid: String(page.cid), title: page.part || `P${page.page}`, duration: Number(page.duration || 0),
      }));
      if (!pages.length) throw new DigestError("API_CHANGED", "视频没有返回可处理的分P信息");
      return {
        bvid: data.bvid || bvid, aid: String(data.aid || ""), title: data.title || bvid,
        owner: data.owner?.name || "", ownerMid: String(data.owner?.mid || ""), description: data.desc || "", pages,
      };
    }

    async function legacyTracks(course, part) {
      const json = await signedJson("/x/player/wbi/v2", { bvid: course.bvid, cid: part.cid });
      const tracks = json.data?.subtitle?.subtitles || [];
      return { tracks, needLogin: Boolean(json.data?.need_login_subtitle) };
    }

    async function protobufTracks(course, part) {
      const url = `https://api.bilibili.com/x/v2/subtitle/web/view?${queryString({ type: 1, oid: part.cid, pid: course.aid })}`;
      const response = await fetchResponse(url, { headers: { Accept: "application/x-protobuf" } });
      const bytes = new Uint8Array(await response.arrayBuffer());
      try { return protobuf.decodeSubtitleTracks(bytes); }
      catch (_error) { throw new DigestError("API_CHANGED", "新版字幕元数据解析失败"); }
    }

    async function downloadTrack(track, sourceOverride) {
      const url = normalizeSubtitleUrl(track.subtitle_url || track.url);
      const json = await fetchJson(url);
      const segments = core.normalizeSegments(json.body || json.data?.body || []);
      if (!segments.length) throw new DigestError("NO_TEXT", "字幕轨道存在，但正文为空");
      const ai = core.isAiTrack(track);
      return {
        source: sourceOverride || (ai ? "ai_subtitle" : "human_subtitle"),
        confidence: sourceOverride === "protobuf_subtitle" || ai ? "medium" : "high",
        language: track.lan || track.language || "unknown",
        segments,
      };
    }

    function collectConclusionSegments(modelResult) {
      const candidates = [];
      const visit = (value) => {
        if (!value) return;
        if (Array.isArray(value)) { value.forEach(visit); return; }
        if (typeof value !== "object") return;
        if ((value.content || value.subtitle || value.text) && (
          value.from !== undefined || value.start !== undefined || value.start_time !== undefined ||
          value.start_timestamp !== undefined || value.timestamp !== undefined
        )) candidates.push(value);
        Object.values(value).forEach(visit);
      };
      visit(modelResult?.subtitle || modelResult?.part_subtitle);
      return core.normalizeSegments(candidates);
    }

    async function conclusion(course, part) {
      let json;
      try {
        json = await signedJson("/x/web-interface/view/conclusion/get", { bvid: course.bvid, cid: part.cid, up_mid: course.ownerMid });
      } catch (error) {
        if (["RESTRICTED_PART", "NO_TEXT"].includes(error.code)) return null;
        throw error;
      }
      const result = json.data?.model_result || json.data?.modelResult || json.data;
      const segments = collectConclusionSegments(result);
      if (segments.length) return { source: "bilibili_ai_conclusion", confidence: "low", language: "zh-CN", segments };
      const summary = core.normalizeText(result?.summary || json.data?.summary);
      const outline = result?.outline || json.data?.outline;
      const outlineText = Array.isArray(outline) ? outline.map((item) => {
        const details = (Array.isArray(item?.part_outline) ? item.part_outline : [])
          .map((detail) => core.normalizeText(detail?.content || detail)).filter(Boolean).join("；");
        return [core.normalizeText(item?.title || item?.content || item), details].filter(Boolean).join("：");
      }).filter(Boolean).join("\n") : core.normalizeText(outline);
      const text = [summary, outlineText].filter(Boolean).join("\n");
      if (!text) return null;
      return { source: "bilibili_ai_conclusion", confidence: "low", language: "zh-CN", segments: [{ id: "conclusion-0", start: 0, end: part.duration || 0, text }] };
    }

    async function fetchPartTranscript(course, part) {
      let needLogin = false;
      try {
        const legacy = await legacyTracks(course, part);
        needLogin = legacy.needLogin;
        const selected = core.chooseSubtitleTrack(legacy.tracks);
        if (selected) return await downloadTrack(selected);
      } catch (error) {
        if (!["LOGIN_REQUIRED", "NO_TEXT", "API_CHANGED"].includes(error.code)) throw error;
        if (error.code === "LOGIN_REQUIRED") needLogin = true;
      }
      try {
        const selected = core.chooseSubtitleTrack(await protobufTracks(course, part));
        if (selected) return await downloadTrack(selected, "protobuf_subtitle");
      } catch (error) {
        if (!["LOGIN_REQUIRED", "NO_TEXT", "API_CHANGED", "NETWORK_ERROR"].includes(error.code)) throw error;
        if (error.code === "LOGIN_REQUIRED") needLogin = true;
      }
      let fallback = null;
      try {
        fallback = await conclusion(course, part);
      } catch (error) {
        if (error.code === "LOGIN_REQUIRED") needLogin = true;
        else throw error;
      }
      if (fallback) return fallback;
      const nav = await getNav().catch(() => null);
      if (needLogin || nav?.isLogin === false) throw new DigestError("LOGIN_REQUIRED", "当前登录态没有返回字幕，请先登录B站并刷新视频页面。");
      throw new DigestError("NO_TEXT", "该分P没有可用字幕或B站 AI 总结。");
    }

    async function checkLogin() {
      const nav = await getNav(true);
      return { isLogin: nav.isLogin };
    }

    return { loadCourse, fetchPartTranscript, checkLogin, getNav, signedJson };
  }

  return { DigestError, mapApiError, md5, extractWbiKey, signWbi, normalizeSubtitleUrl, createAdapter };
})();

if (typeof module !== "undefined" && module.exports) module.exports = BILI_DIGEST_BILIBILI;
