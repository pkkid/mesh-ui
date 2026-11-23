/* Mesh UI website: the headline's arrival, the header's hairline, the app's
   clickable pages, and the download button that names the visitor's system. No third-party code. */
(function () {
  document.documentElement.classList.add("js");
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  // Headline words arrive one after another, quickly.
  $$("h1 .w").forEach(function (w, i) { w.style.setProperty("--n", i); });

  // Header: a hairline once the page moves.
  var top = $(".top");
  function onScroll() { top.classList.toggle("stuck", scrollY > 8); }
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // The app in the hero: a page button swaps the sidebar, header and page pictures, then the
  // page starts at the top; the visitor scrolls it. The header's light / dark button swaps every
  // picture to the other theme (Gruvbox Hard dark, Classic light) and keeps the page and scroll.
  var HEIGHTS = {
    dark: { overview: 2110, internet: 2898, eeros: 2608, devices: 3675, profiles: 2155, signal: 4930, activity: 5020, wifi: 2089,
      guest: 1848, advanced: 3871, ports: 2817, updates: 2010, troubleshooting: 3419, settings: 2805, account: 1501 },
    light: { overview: 2110, internet: 2899, eeros: 2608, devices: 3633, profiles: 2155, signal: 4930, activity: 5020, wifi: 2089,
      guest: 1849, advanced: 3871, ports: 2818, updates: 2011, troubleshooting: 3419, settings: 2805, account: 1501 }
  };
  var app = $("#app"), nav = $("#app-nav"), head = $("#app-head"), page = $("#app-page"), body = $("#app-body"), toggle = $("#app-theme");
  var buttons = $$(".hotspots button"), pick = 0, theme = "dark", current = buttons[0];
  function src(id, part, t) { return "img/pages/" + id + "-" + (t || theme) + "-" + part + ".webp"; }
  function load(url) { var i = new Image(); i.src = url; return i.decode ? i.decode().catch(function () {}) : Promise.resolve(); }
  function show(button, keepScroll) {
    var n = ++pick, id = button.dataset.page, t = theme, top = keepScroll ? body.scrollTop : 0;
    current = button;
    buttons.forEach(function (b) { b.setAttribute("aria-pressed", String(b === button)); });
    body.classList.add("loading");
    Promise.all([load(src(id, "nav", t)), load(src(id, "head", t)), load(src(id, "body", t))]).then(function () {
      if (n !== pick) return;
      app.classList.toggle("light", t === "light");
      nav.src = src(id, "nav", t); head.src = src(id, "head", t);
      page.src = src(id, "body", t); page.height = HEIGHTS[t][id];
      page.alt = "Mesh UI's " + button.getAttribute("aria-label") + " page, in demo mode, " + t + " theme.";
      body.classList.remove("loading"); body.scrollTop = top;
    });
  }
  buttons.forEach(function (b) {
    // Rows are 31 px tall; the two-line account row in the footer is 44 px.
    b.style.top = (Number(b.dataset.y) - (b.classList.contains("account") ? 22 : 15.5)) / 860 * 100 + "%";
    b.addEventListener("click", function () { show(b, false); });
    b.addEventListener("pointerenter", function () { load(src(b.dataset.page, "body")); });
  });
  toggle.addEventListener("click", function () {
    theme = theme === "dark" ? "light" : "dark";
    toggle.setAttribute("aria-label", theme === "dark" ? "Show the light theme" : "Show the dark theme");
    show(current, true);
  });
  toggle.addEventListener("pointerenter", function () { load(src(current.dataset.page, "body", theme === "dark" ? "light" : "dark")); });
  // The sidebar and header pictures are small: fetch them all after load, so a pick never blinks.
  addEventListener("load", function () {
    buttons.forEach(function (b) { load(src(b.dataset.page, "nav")); load(src(b.dataset.page, "head")); });
  });

  // Download: name the visitor's system and lift its card. Phones and tablets get a note instead.
  var ua = navigator.userAgent;
  var mobile = /Android|iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var os = mobile ? null : /Mac/.test(ua) ? "mac" : /Win/.test(ua) ? "win" : /Linux|X11/.test(ua) ? "linux" : null;
  var main = $("#dl-main"), card = os && $('.os[data-os="' + os + '"]');
  if (main && card) {
    card.classList.add("mine");
    main.href = card.querySelector(".button").href;
    main.querySelector("span").textContent = "Download for " + { linux: "Linux", win: "Windows", mac: "macOS" }[os];
  } else if (mobile) {
    $("#phone-note").hidden = false;
  }
})();
