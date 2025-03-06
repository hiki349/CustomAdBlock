document.querySelector(
  "body > div.main_wrapper > div.wrapper > div > div > div.inner_wrapper.bc_flex.bc_flex_nowrap.js-inner_wrapper > div"
).style.maxWidth = "100%";

const stylePopups = document.createElement("style");
const style = document.createElement("style");
style.textContent = `
  jsx:has(#member_join_popup),
  jsx:has(.bc_scroll_compensation.chatbox_green) {
    display: none !important;
  }

  body > div.main_wrapper > div.wrapper > div > div > div.inner_wrapper.bc_flex.bc_flex_nowrap.js-inner_wrapper > div.menu_container.js-fl_menu {
    display: none !important;
  }
`;
stylePopups.textContent = `
  html {
    overflow: auto !important;
    margin: 0 !important;
  }

  body {
    overflow: auto !important;
    margin: 0 !important;
  }
  
  jsx:has(.bc_scroll_compensation.push_notification_alert) {
    display: none !important;
  }
`;
document.head.appendChild(style);
document.head.appendChild(stylePopups);

document.getElementById("btn_signup").addEventListener("click", () => {
  style.remove();
});
