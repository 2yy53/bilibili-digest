# 隐私说明

## 本地保存的数据

- 用户填写的 DeepSeek API Key。
- B站课程元数据、已规范化的字幕片段、分P摘要、课程地图和任务恢复状态。
- 缓存默认有效30天，可在设置中清除当前视频或全部课程数据。

所有内容保存在当前 Chrome 个人资料的 `chrome.storage.local`。扩展没有开发者服务器、账号系统或分析服务。

## 发送给B站的数据

扩展向 `www.bilibili.com` 和 `api.bilibili.com` 请求视频、分P和字幕元数据，并从 `aisubtitle.hdslb.com` 下载字幕正文。浏览器可能自动携带当前B站网页登录凭据。扩展不申请 `cookies` 权限，也不读取、显示、记录或保存 Cookie。

## 发送给 DeepSeek 的数据

生成摘要时，扩展把所选分P的字幕或明确标注的B站 AI conclusion、视频标题和分P标题发送给 `api.deepseek.com`。DeepSeek API Key仅作为该请求的授权头发送。请自行查阅 DeepSeek 的服务条款、隐私政策和价格。

## 不收集的数据

扩展不下载视频或音频，不上传媒体，不调用 ASR，不保存带短期签名的字幕 URL，也不收集浏览历史、分析事件或遥测数据。
