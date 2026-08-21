# B站课程地图

一个独立的 Chrome Manifest V3 扩展：读取普通B站投稿视频已有的人工字幕或 AI 字幕，使用用户自己的 DeepSeek V4 Flash API Key，生成分P摘要和整体课程学习地图。

本项目与哔哩哔哩无官方隶属、授权或合作关系。“B站”仅用于说明兼容的网站。只处理你有权访问和使用的内容。

## 能做什么

- 识别 `bilibili.com/video/BV...` 普通视频和多P列表。
- 默认选择当前P，也可手动多选或全选；点击生成前不会读取字幕或调用AI。
- 优先使用中文人工字幕，其次是中文 AI 字幕、其他人工字幕和其他可用字幕。
- 旧字幕列表为空时，尝试新版 Protobuf 字幕元数据。
- 完整字幕仍不可用时，尝试B站平台已经生成的 AI conclusion，并在结果中明确标注低置信度来源。
- 每个分P完成后立即缓存，单个分P失败不会中断整个课程。
- 生成整体概述、学习路径、知识模块、前后依赖和可点击的关键时间点。

## 明确不做什么

- 不下载视频或音频，不运行 Whisper，不调用云端 ASR。
- 不申请 Chrome `cookies` 权限，不读取、展示或保存 `SESSDATA`。
- 不把B站 AI 字幕或 AI 总结冒充人工逐字稿。
- v1不支持番剧、影视、付费课堂、互动视频、直播或收藏夹批处理。

## 安装

1. 在 Chrome 打开 `chrome://extensions`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择这个 `bilibili-digest` 文件夹，其中应直接包含 `manifest.json`。
5. 在同一个 Chrome 个人资料中登录B站，然后打开普通视频页，点击扩展图标。
6. 在扩展设置中填写自己的 [DeepSeek API Key](https://platform.deepseek.com/usage)，详情点击后查看官网连接。

## 数据流

1. `/x/web-interface/view` 返回视频和分P元数据。
2. `/x/player/wbi/v2` 或 `/x/v2/subtitle/web/view` 返回字幕轨道元数据。
3. 扩展立即下载所选字幕轨道正文，并丢弃带短期签名的字幕地址。
4. 规范化字幕、视频标题和分P标题发送给 DeepSeek，得到结构化摘要。
5. 课程信息、规范化字幕和摘要保存在 `chrome.storage.local`，默认有效30天。

这些 `/x/...` 地址是B站 Web 客户端使用的接口，不是Bilibili正式开放平台承诺的任意公开视频字幕 Open API，可能随时变化。所有端点、WBI签名、登录态判断和错误映射集中在 `lib/bilibili.js`。

## 开发与验证

要求 Node.js 20 或更高版本：

```text
npm test
npm run check
npm run package
```

打包文件生成到 `dist/bilibili-course-map-v<version>.zip`。测试使用合成字幕和 Protobuf 样例，不包含真实视频字幕。

## 错误分类

扩展分别显示 `LOGIN_REQUIRED`、`NO_TEXT`、`RISK_CONTROL`、`RESTRICTED_PART`、`API_CHANGED`、`NETWORK_ERROR`、`DEEPSEEK_ERROR` 和 `INVALID_MODEL_OUTPUT`，避免把登录不足或风控误报为“没有字幕”。

更多信息见 [PRIVACY.md](PRIVACY.md) 和 [SECURITY.md](SECURITY.md)。
