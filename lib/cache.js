var BILI_DIGEST_CACHE = (() => {
  const PREFIX = "bili_digest:";
  const TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const courseKey = (bvid) => `${PREFIX}course:${bvid}`;
  const partKey = (bvid, cid) => `${PREFIX}part:${bvid}:${cid}`;
  const runKey = (bvid) => `${PREFIX}run:${bvid}`;
  const mapKey = (bvid, signature) => `${PREFIX}map:${bvid}:${signature}`;

  function createCache(storage, core, now = () => Date.now()) {
    async function get(key) {
      const values = await storage.get(key);
      const record = values[key];
      if (!record) return null;
      if (record.expiresAt && record.expiresAt < now()) {
        await storage.remove(key);
        return null;
      }
      return record.value;
    }
    async function set(key, value, ttl = TTL_MS) {
      await storage.set({ [key]: { value, updatedAt: now(), expiresAt: now() + ttl } });
      return value;
    }
    function courseMapSignature(selectedCids, partRecords) {
      const ids = [...selectedCids].map(String).sort();
      const fingerprints = ids.map((cid) => [cid, partRecords.find((record) => String(record?.digest?.cid) === cid)?.fingerprint || "missing"]);
      return core.stableHash({ ids, fingerprints });
    }
    async function removeVideo(bvid) {
      const all = await storage.get(null);
      const prefix = `${PREFIX}`;
      const keys = Object.keys(all).filter((key) => key.startsWith(prefix) && (key.includes(`:${bvid}:`) || key.endsWith(`:${bvid}`)));
      if (keys.length) await storage.remove(keys);
      return keys.length;
    }
    async function clearAll() {
      const all = await storage.get(null);
      const keys = Object.keys(all).filter((key) => key.startsWith(PREFIX));
      if (keys.length) await storage.remove(keys);
      return keys.length;
    }
    return {
      getCourse: (bvid) => get(courseKey(bvid)), setCourse: (course) => set(courseKey(course.bvid), course),
      getPart: (bvid, cid) => get(partKey(bvid, cid)), setPart: (bvid, cid, value) => set(partKey(bvid, cid), value),
      getRun: (bvid) => get(runKey(bvid)), setRun: (bvid, value) => set(runKey(bvid), value, 7 * 24 * 60 * 60 * 1000),
      getMap: (bvid, signature) => get(mapKey(bvid, signature)), setMap: (bvid, signature, value) => set(mapKey(bvid, signature), value),
      courseMapSignature, removeVideo, clearAll,
    };
  }
  return { PREFIX, TTL_MS, courseKey, partKey, runKey, mapKey, createCache };
})();

if (typeof module !== "undefined" && module.exports) module.exports = BILI_DIGEST_CACHE;
