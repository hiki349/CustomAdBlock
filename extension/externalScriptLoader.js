const url = document.currentScript.getAttribute("data-url");

const script = document.createElement("script");
script.src = url;
document.documentElement.appendChild(script);

document.currentScript.remove();
