export function installMobileControls(closeMenus) {
  const $ = (id) => document.getElementById(id),
    nav = $("nlinks"),
    sidebar = $("csb");
  const navigation = matchMedia("(max-width: 1360px)"),
    history = matchMedia("(max-width: 760px)");
  const backdrop = document.createElement("button");
  backdrop.type = "button";
  backdrop.className = "menu-backdrop";
  backdrop.hidden = true;
  backdrop.tabIndex = -1;
  backdrop.setAttribute("aria-label", "Мәзірді жабу");
  document.body.append(backdrop);
  const summary = document.createElement("div");
  summary.className = "nav-account-summary";
  summary.hidden = true;
  const name = document.createElement("strong"),
    quota = document.createElement("span");
  summary.append(name, quota);
  nav.append(summary);
  const update = () => {
    const navOpen = nav.classList.contains("open") && navigation.matches;
    const historyOpen = sidebar.classList.contains("open") && history.matches;
    const parent = navOpen ? document.body : $("pg-chat");
    if (backdrop.parentElement !== parent) parent.append(backdrop);
    backdrop.dataset.surface = navOpen ? "navigation" : "history";
    backdrop.hidden = !navOpen && !historyOpen;
    document.body.classList.toggle("menu-is-open", !backdrop.hidden);
    const signedIn = $("unav").style.display !== "none";
    summary.hidden = !signedIn;
    name.textContent = signedIn ? $("ubadge").textContent : "";
    quota.textContent = signedIn ? $("quotaStatus").textContent : "";
  };
  backdrop.onclick = () => {
    const opener = nav.classList.contains("open") ? $("burger") : $("mobbtn");
    closeMenus();
    opener.focus();
  };
  const observer = new MutationObserver(update);
  for (const el of [nav, sidebar])
    observer.observe(el, { attributes: true, attributeFilter: ["class"] });
  observer.observe($("unav"), { attributes: true, attributeFilter: ["style"] });
  for (const el of [$("ubadge"), $("quotaStatus")])
    observer.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  navigation.addEventListener?.("change", () => {
    closeMenus();
    update();
  });
  history.addEventListener?.("change", () => {
    closeMenus();
    update();
  });
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && !backdrop.hidden)
        (nav.classList.contains("open") ? $("burger") : $("mobbtn")).focus();
    },
    true,
  );
  update();
}
