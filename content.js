function parsePageContext() {
  const matched = location.pathname.match(/\/video\/(BV[0-9A-Za-z]{10})/i)?.[1] || "";
  const bvid = matched ? `BV${matched.slice(2)}` : "";
  const page = Math.max(1, Number.parseInt(new URL(location.href).searchParams.get("p") || "1", 10) || 1);
  return { bvid, page, url: location.href };
}

function seekTo(seconds) {
  const video = document.querySelector("video");
  if (!video) return false;
  video.currentTime = Math.max(0, Number(seconds) || 0);
  video.scrollIntoView({ behavior: "smooth", block: "center" });
  return true;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action === "getPageContext") {
    sendResponse({ success: true, ...parsePageContext() });
    return false;
  }
  if (message?.action === "seekTo") {
    sendResponse({ success: seekTo(message.seconds) });
    return false;
  }
  return false;
});
