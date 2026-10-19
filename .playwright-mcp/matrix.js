async page => {
  const BASE = "http://localhost:4322";
  const PAGES = [
    "/",
    "/blog",
    "/blog/aurora",
    "/blog/zero-to-launch",
    "/blog/tag/aws",
    "/work",
    "/404",
    "/blog/redis-lua-race-conditions"
  ];
  const WIDTHS = [375, 768, 1280];
  const THEMES = ["dark", "light"];
  const results = [];
  for (const path of PAGES) {
    for (const width of WIDTHS) {
      for (const theme of THEMES) {
        const errors = [];
        const bad = [];
        const onConsole = m => {
          if (m.type() === "error") errors.push(`${m.text()} @ ${m.location().url}`);
        };
        const onResp = r => {
          if (r.status() >= 400 && !(r.url().endsWith("/404") && r.status() === 404)) bad.push(`${r.status()} ${r.url()}`);
        };
        page.on("console", onConsole);
        page.on("response", onResp);
        await page.setViewportSize({width, height: 900});
        await page.addInitScript(t => localStorage.setItem("theme", t), theme);
        await page.goto(BASE + path, {waitUntil: "networkidle"});
        const checks = await page.evaluate(() => {
          const w = window.innerWidth;
          const sw = document.documentElement.scrollWidth;
          const wide = [...document.querySelectorAll("*")]
            .filter(e => !e.closest("pre, table, figure.diagram"))
            .filter(e => e.getBoundingClientRect().right > w + 1)
            .map(
              e =>
                `${e.tagName.toLowerCase()}${e.className ? "." + String(e.className).split(" ")[0] : ""}:${Math.round(e.getBoundingClientRect().right)}`
            );
          const toc = [...document.querySelectorAll(".post-toc a")].map(a =>
            a.getAttribute("href")
          );
          const tocMissing = toc.filter(h => !document.getElementById(decodeURIComponent(h.slice(1))));
          const hs = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map(h =>
            Number(h.tagName[1])
          );
          const h1Count = hs.filter(d => d === 1).length;
          let skip = false;
          let prev = 0;
          for (const d of hs) {
            if (d > prev + 1) skip = true;
            prev = d;
          }
          const imgs = [...document.querySelectorAll("img")];
          const imgNoDims = imgs
            .filter(i => !i.getAttribute("width") || !i.getAttribute("height"))
            .map(i => i.getAttribute("src"));
          const pre = document.querySelector("pre.astro-code, .astro-code");
          let codeContrast = "n/a";
          if (pre) {
            const span = pre.querySelector("span[style], span");
            const preBg = getComputedStyle(pre).backgroundColor;
            const spanColor = span ? getComputedStyle(span).color : null;
            codeContrast = spanColor && spanColor !== preBg ? "ok" : `FAIL ${spanColor} on ${preBg}`;
          }
          return {
            theme: document.documentElement.getAttribute("data-theme"),
            innerWidth: w,
            scrollWidth: sw,
            wide,
            tocCount: toc.length,
            tocMissing,
            h1Count,
            headingSkip: skip,
            headings: hs.join(""),
            imgNoDims,
            codeContrast
          };
        });
        const name = path === "/" ? "home" : path.replace(/^\//, "").replace(/\//g, "-");
        const file = `/tmp/portfolio-shots/shot-${name}-${width}-${theme}.png`;
        await page.screenshot({path: file, fullPage: true});
        page.off("console", onConsole);
        page.off("response", onResp);
        results.push({
          path,
          width,
          theme,
          ...checks,
          consoleErrors: errors.filter(e => !e.includes("@vite/client") && !e.endsWith("localhost:4322/404")),
          badResponses: bad.filter(u => !u.includes("@vite/client"))
        });
      }
    }
  }
  const fails = results.filter(
    r =>
      r.scrollWidth > r.innerWidth ||
      r.wide.length ||
      r.tocMissing.length ||
      r.h1Count !== 1 ||
      r.headingSkip ||
      r.imgNoDims.length ||
      r.consoleErrors.length ||
      r.badResponses.length ||
      String(r.codeContrast).startsWith("FAIL")
  );
  return JSON.stringify({cells: results.length, failCount: fails.length, fails}, null, 1);
}
