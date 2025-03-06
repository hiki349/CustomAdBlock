chrome.runtime.onMessage.addListener((message) => {
  if (message.scriptURL) {
    const script = document.createElement("script");
    script.setAttribute("data-url", message.scriptURL);
    script.src = chrome.runtime.getURL("externalScriptLoader.js");
    document.documentElement.appendChild(script);
  }
});
