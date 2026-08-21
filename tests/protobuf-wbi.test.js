const test = require("node:test");
const assert = require("node:assert/strict");
const protobuf = require("../lib/protobuf");
const bili = require("../lib/bilibili");

function varint(value) {
  const bytes = [];
  let current = value;
  while (current > 127) { bytes.push((current & 127) | 128); current = Math.floor(current / 128); }
  bytes.push(current);
  return Uint8Array.from(bytes);
}
function bytesField(field, value) {
  const body = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return Uint8Array.from([...varint(field * 8 + 2), ...varint(body.length), ...body]);
}

test("最小Protobuf解码器读取重复字段3中的语言、名称和URL", () => {
  const track = Uint8Array.from([
    ...bytesField(3, "ai-zh"), ...bytesField(4, "中文 AI"), ...bytesField(5, "//aisubtitle.hdslb.com/test.json"),
  ]);
  const reply = Uint8Array.from([...bytesField(1, "ignored"), ...bytesField(3, track)]);
  assert.deepEqual(protobuf.decodeSubtitleTracks(reply), [{
    lan: "ai-zh", lan_doc: "中文 AI", subtitle_url: "//aisubtitle.hdslb.com/test.json", ai_type: 1,
  }]);
});

test("MD5和WBI签名在固定输入下确定且过滤保留字符", () => {
  assert.equal(bili.md5(""), "d41d8cd98f00b204e9800998ecf8427e");
  const signed = bili.signWbi(
    { foo: "114", bar: "a!'()*b" },
    "7cd084941338484aae1ad9425b84077c",
    "4932caff0ff746eab6f01bf08b70ac45",
    1702204169,
  );
  assert.deepEqual(signed, { foo: "114", bar: "a!'()*b", wts: 1702204169, w_rid: "dac23573adfc8a97ceb2595e81d8acc7" });
});

test("B站API错误被分类而不是统一报无字幕", () => {
  assert.equal(bili.mapApiError(-101).code, "LOGIN_REQUIRED");
  assert.equal(bili.mapApiError(-412).code, "RISK_CONTROL");
  assert.equal(bili.mapApiError(-404).code, "RESTRICTED_PART");
  assert.equal(bili.mapApiError(-999).code, "API_CHANGED");
});
