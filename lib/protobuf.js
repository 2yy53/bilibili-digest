var BILI_DIGEST_PROTOBUF = (() => {
  function readVarint(bytes, offset) {
    let value = 0;
    let shift = 0;
    let cursor = offset;
    while (cursor < bytes.length && shift <= 49) {
      const byte = bytes[cursor++];
      value += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return { value, offset: cursor };
      shift += 7;
    }
    throw new Error("Invalid protobuf varint");
  }

  function readFields(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || []);
    const fields = [];
    let offset = 0;
    while (offset < bytes.length) {
      const tag = readVarint(bytes, offset);
      offset = tag.offset;
      const field = Math.floor(tag.value / 8);
      const wire = tag.value & 7;
      if (!field) throw new Error("Invalid protobuf field number");
      if (wire === 0) {
        const item = readVarint(bytes, offset);
        offset = item.offset;
        fields.push({ field, wire, value: item.value });
      } else if (wire === 1) {
        if (offset + 8 > bytes.length) throw new Error("Truncated protobuf fixed64");
        fields.push({ field, wire, value: bytes.slice(offset, offset + 8) });
        offset += 8;
      } else if (wire === 2) {
        const length = readVarint(bytes, offset);
        offset = length.offset;
        const end = offset + length.value;
        if (end > bytes.length) throw new Error("Truncated protobuf bytes");
        fields.push({ field, wire, value: bytes.slice(offset, end) });
        offset = end;
      } else if (wire === 5) {
        if (offset + 4 > bytes.length) throw new Error("Truncated protobuf fixed32");
        fields.push({ field, wire, value: bytes.slice(offset, offset + 4) });
        offset += 4;
      } else {
        throw new Error(`Unsupported protobuf wire type: ${wire}`);
      }
    }
    return fields;
  }

  const decoder = new TextDecoder("utf-8", { fatal: false });
  const textField = (fields, number) => {
    const match = fields.find((item) => item.field === number && item.wire === 2);
    return match ? decoder.decode(match.value) : "";
  };

  /** `/x/v2/subtitle/web/view`: repeated field 3 holds subtitle tracks. */
  function decodeSubtitleTracks(input) {
    const tracks = [];
    for (const outer of readFields(input)) {
      if (outer.field !== 3 || outer.wire !== 2) continue;
      try {
        const fields = readFields(outer.value);
        const lan = textField(fields, 3);
        const lanDoc = textField(fields, 4);
        const subtitleUrl = textField(fields, 5);
        if (subtitleUrl) tracks.push({ lan, lan_doc: lanDoc, subtitle_url: subtitleUrl, ai_type: /ai/i.test(lan) ? 1 : 0 });
      } catch (_error) {
        // Ignore unknown field-3 messages rather than rejecting the whole reply.
      }
    }
    return tracks;
  }

  return { readVarint, readFields, decodeSubtitleTracks };
})();

if (typeof module !== "undefined" && module.exports) module.exports = BILI_DIGEST_PROTOBUF;
