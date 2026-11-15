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
  // page starts at the top; the visitor scrolls it.
  var HEIGHTS = { overview: 2015, internet: 3624, eeros: 2229, devices: 2880, profiles: 2189, activity: 5192, guest: 1611,
    wifi: 1968, advanced: 5043, ports: 2536, updates: 2231, troubleshooting: 3623, account: 2438 };
  var nav = $("#app-nav"), head = $("#app-head"), page = $("#app-page"), body = $("#app-body");
  var buttons = $$(".hotspots button"), pick = 0;
  function load(src) { var i = new Image(); i.src = src; return i.decode ? i.decode().catch(function () {}) : Promise.resolve(); }
  function show(id, button) {
    var n = ++pick, p = "img/pages/" + id;
    buttons.forEach(function (b) { b.setAttribute("aria-pressed", String(b === button)); });
    nav.src = p + "-nav.webp"; head.src = p + "-head.webp";
    body.classList.add("loading");
    load(p + "-body.webp").then(function () {
      if (n !== pick) return;
      page.src = p + "-body.webp"; page.height = HEIGHTS[id];
      page.alt = "Mesh UI's " + button.getAttribute("aria-label") + " page, in demo mode.";
      body.classList.remove("loading"); body.scrollTop = 0;
    });
  }
  buttons.forEach(function (b) {
    b.style.top = (Number(b.dataset.y) - 15.5) / 860 * 100 + "%";
    b.addEventListener("click", function () { show(b.dataset.page, b); });
    b.addEventListener("pointerenter", function () { load("img/pages/" + b.dataset.page + "-body.webp"); });
  });
  // The sidebar and header pictures are small: fetch them all after load, so a pick never blinks.
  addEventListener("load", function () {
    buttons.forEach(function (b) { load("img/pages/" + b.dataset.page + "-nav.webp"); load("img/pages/" + b.dataset.page + "-head.webp"); });
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
