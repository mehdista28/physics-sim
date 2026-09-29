(function () {
  "use strict";

  var SVGNS = "http://www.w3.org/2000/svg";

  var G = 9.81;
  var RHO_FLUID = 1260;
  var ETA_ACCEPTED = 1.41;
  var TUBE_R = 0.040;
  var WALL_K = 2.4;
  var INTERVAL_M = 0.100;
  var PX_PER_MM = 0.9;
  var RELEASE_Y = 140;
  var TUBE_TOP = 62;
  var TUBE_BOTTOM = 646;
  var LIQ_TOP = 110;
  var LIQ_BOTTOM = 640;
  var BENCH_Y = 650;

  var MATERIALS = {
    steel: { label: "Steel", rho: 7800, diam: [2.4, 3.3, 4.2, 5.1, 6.4], ball: ["#dfe4e9", "#8d979f"] },
    glass: { label: "Glass", rho: 2500, diam: [4.0, 5.2, 6.4, 7.3, 8.1], ball: ["#d6ecf1", "#87bccb"] },
    pvc: { label: "PVC", rho: 1450, diam: [8.0, 9.4, 10.2, 11.3, 12.1], ball: ["#f2efe6", "#c9c2ad"] }
  };
  var LETTERS = "ABCDE";

  var state = {
    material: "steel",
    sphere: 0,
    wall: false,
    speed: 1,
    drop: null,
    measured: null,
    trials: [],
    teacher: false,
    focusInput: null,
    onBalance: false,
    trace: [],
    traceT: 0,
    page: 1,
    caliper: { gap: 2.2, value: 0 },
    values: {}
  };

  var $ = function (id) { return document.getElementById(id); };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };

  function svgEl(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    if (attrs) { for (var k in attrs) { n.setAttribute(k, attrs[k]); } }
    return n;
  }

  function clear(node) { while (node.firstChild) { node.removeChild(node.firstChild); } }

  function csvCell(v) { return '"' + String(v).replace(/"/g, '""') + '"'; }

  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 2400);
  }

  function speak(text) {
    if (!("speechSynthesis" in window)) { toast(text); return; }
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
  }

  /* ---------- physics ---------- */

  function sphereD() { return MATERIALS[state.material].diam[state.sphere]; }
  function sphereRho() { return MATERIALS[state.material].rho; }

  function stokesVel(r, rho) {
    return (2 * r * r * G * (rho - RHO_FLUID)) / (9 * ETA_ACCEPTED);
  }
  function wallFactor(r) { return 1 + (WALL_K * r) / TUBE_R; }
  function simVel(r, rho) {
    var v = stokesVel(r, rho);
    return state.wall ? v / wallFactor(r) : v;
  }
  function volumeOf(r) { return (4 / 3) * Math.PI * r * r * r; }

  function currentExpected() {
    var d = sphereD();
    var rho = sphereRho();
    var r = d / 2000;
    var V = volumeOf(r);
    var vSim = simVel(r, rho);
    var m = state.measured;
    var ts = m ? m.dts.slice() : [INTERVAL_M / vSim, INTERVAL_M / vSim, INTERVAL_M / vSim];
    var vs = ts.map(function (t) { return INTERVAL_M / t; });
    var vmean = (vs[0] + vs[1] + vs[2]) / 3;
    var diff = rho - RHO_FLUID;
    var eta = (2 * r * r * G * diff) / (9 * vmean);
    return {
      d: d, r: r, rho: rho, V: V, vSim: vSim, vTrue: stokesVel(r, rho),
      ts: ts, vs: vs, vmean: vmean, diff: diff, eta: eta,
      percent: Math.abs(eta - ETA_ACCEPTED) / ETA_ACCEPTED * 100,
      massKg: rho * V, massG: rho * V * 1000
    };
  }

  /* ---------- formatting & evaluation ---------- */

  function fmt(kind, v) {
    switch (kind) {
      case "len_mm": return v.toFixed(2);
      case "len_m": return v.toFixed(6);
      case "volume": return v.toExponential(3);
      case "mass_g": return v.toFixed(4);
      case "mass_kg": return v.toExponential(3);
      case "density": return String(Math.round(v));
      case "time": return v.toFixed(2);
      case "velocity": return v.toFixed(5);
      case "diff": return String(Math.round(v));
      case "eta": return v.toFixed(3);
      case "percent": return v.toFixed(1);
      default: return String(v);
    }
  }

  function tolerance(kind, expected) {
    switch (kind) {
      case "len_mm": return { type: "abs", v: 0.05 };
      case "len_m": return { type: "rel", v: 0.02 };
      case "volume": return { type: "rel", v: 0.03 };
      case "mass_g":
      case "mass_kg": return { type: "rel", v: 0.012 };
      case "density": return { type: "rel", v: 0.02 };
      case "time": return { type: "abs", v: Math.max(0.15, 0.06 * expected) };
      case "velocity": return { type: "rel", v: 0.03 };
      case "diff": return { type: "rel", v: 0.012 };
      case "eta": return { type: "rel", v: 0.05 };
      case "percent": return { type: "abs", v: 1.5 };
      default: return { type: "rel", v: 0.03 };
    }
  }

  function near(ratio, target, tol) { return Math.abs(ratio - target) / target <= tol; }

  function diagnose(kind, entered, expected) {
    var ratio = entered / expected;
    if (!isFinite(entered)) { return "Enter a number."; }
    if (near(ratio, 1000, 0.02)) { return "Unit slip: you look to be ×1000 out (g &harr; kg, or mm &harr; m)."; }
    if (near(ratio, 0.001, 0.02)) { return "Unit slip: you look to be ÷1000 out (g &harr; kg, or mm &harr; m)."; }
    if (near(ratio, 100, 0.02)) { return "Unit slip: you look to be ×100 out (cm &harr; m)."; }
    if (near(ratio, 0.01, 0.02)) { return "Unit slip: you look to be ÷100 out (cm &harr; m)."; }
    if (kind === "volume" && near(ratio, 8, 0.06)) { return "Volume goes as r&sup3;. Using the diameter in place of the radius makes it 8× too big."; }
    if (kind === "volume" && near(ratio, 0.125, 0.06)) { return "Volume goes as r&sup3;. Using the radius where the diameter belongs makes it 8× too small."; }
    if (kind === "density" && near(ratio, 8, 0.06)) { return "If your volume is 8× too big, your density comes out 8× too small &mdash; check the radius."; }
    if (kind === "density" && near(ratio, 0.125, 0.06)) { return "Density looks 8× too big &mdash; check whether you used the diameter as the radius."; }
    if ((kind === "len_m" || kind === "len_mm") && near(ratio, 2, 0.08)) { return "That is the diameter, not the radius (or the other way round)."; }
    if (kind === "len_mm") {
      var dd = Math.abs(entered - expected);
      if (Math.abs(dd % 0.1) < 0.01 || Math.abs((dd % 0.1) - 0.1) < 0.01) {
        return "Close, but one vernier division (0.1 mm) out. Recheck the line that lines up exactly.";
      }
    }
    if (kind === "time") { return "Timing looks off. Press the key exactly as the ball&rsquo;s centre crosses each line."; }
    if (kind === "velocity") { return "Velocity = 0.100 m &divide; interval time. Check the division, not the subtraction."; }
    if (kind === "eta") {
      if (state.wall) {
        var rWall = sphereD() / 2000;
        if (near(ratio, 1 / wallFactor(rWall), 0.04)) {
          return "That is the uncorrected accepted value. With the tube-wall effect on, your measured speed is slowed, so &eta; from your own timings comes out higher &mdash; record that, then apply the correction in the bench note.";
        }
      }
      return "Check the substitution: &eta; = 2r&sup2;g(&rho;<sub>s</sub> &minus; &rho;<sub>f</sub>) &divide; 9v.";
    }
    if (kind === "diff") { return "This is &rho;<sub>s</sub> &minus; 1260 kg/m&sup3; &mdash; check the fluid density you subtracted."; }
    if (kind === "percent") {
      var etaCell = $("in_D_eta");
      var etaEntered = etaCell ? readNumber(etaCell) : null;
      if (etaEntered !== null) {
        var honest = Math.abs(etaEntered - ETA_ACCEPTED) / ETA_ACCEPTED * 100;
        if (Math.abs(entered - honest) <= 0.2) {
          return "Your percentage matches the &eta; you entered &mdash; the problem is upstream. Recheck how you worked out &eta;.";
        }
      }
      return "Use |&eta; &minus; 1.41| &divide; 1.41 &times; 100, as a percentage.";
    }
    return "Not quite. Check your arithmetic and the units.";
  }

  function evaluate(kind, entered, expected) {
    if (entered === null || !isFinite(entered)) { return { ok: false, empty: true, message: "Enter a value." }; }
    var tol = tolerance(kind, expected);
    var diff = Math.abs(entered - expected);
    var ok = tol.type === "abs" ? diff <= tol.v : diff / Math.abs(expected) <= tol.v;
    if (ok) { return { ok: true }; }
    return { ok: false, message: diagnose(kind, entered, expected) };
  }

  /* ---------- theme ---------- */

  function applyTheme(mode, save) {
    document.documentElement.setAttribute("data-theme", mode);
    var btn = $("themeBtn");
    btn.setAttribute("aria-label", mode === "dark" ? "Switch to light theme" : "Switch to dark theme");
    if (save) { try { localStorage.setItem("tvlab-theme", mode); } catch (e) {} }
  }

  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem("tvlab-theme"); } catch (e) {}
    var sys = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    applyTheme(saved || sys, false);
    $("themeBtn").addEventListener("click", function () {
      var next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      applyTheme(next, true);
      redrawCharts();
    });
  }

  /* ---------- lab scene ---------- */

  function buildScene() {
    var svg = $("scene");
    clear(svg);
    svg.setAttribute("viewBox", "0 0 460 720");
    var defs = svgEl("defs");
    svg.appendChild(defs);

    function gradient(id, attrs, stops) {
      var g = svgEl("linearGradient", Object.assign({ id: id }, attrs));
      stops.forEach(function (s) { g.appendChild(svgEl("stop", { offset: s[0], "stop-color": s[1] })); });
      defs.appendChild(g);
      return g;
    }
    function add(node) { svg.appendChild(node); }
    function rect(a) { add(svgEl("rect", a)); }
    function line(a) { add(svgEl("line", a)); }
    function shadow(cx, cy, rx, ry, o) { add(svgEl("ellipse", { cx: cx, cy: cy, rx: rx, ry: ry, fill: "rgba(0,0,0," + o + ")" })); }

    gradient("liquidGrad", { x1: "0", y1: "0", x2: "0", y2: "1" }, [["0", "var(--liquid-hi)"], ["1", "var(--liquid-lo)"]]);
    gradient("liquidShade", { x1: "0", y1: "0", x2: "1", y2: "0" }, [["0", "rgba(0,0,0,0.34)"], ["0.38", "rgba(0,0,0,0)"], ["1", "rgba(0,0,0,0.26)"]]);
    gradient("glassGloss", { x1: "0", y1: "0", x2: "1", y2: "0" }, [["0", "rgba(255,255,255,0.6)"], ["0.45", "rgba(255,255,255,0.05)"], ["1", "rgba(255,255,255,0.42)"]]);
    gradient("wallGrad", { x1: "0", y1: "0", x2: "0", y2: "1" }, [["0", "var(--surface-2)"], ["1", "var(--surface)"]]);
    gradient("benchTopGrad", { x1: "0", y1: "0", x2: "0", y2: "1" }, [["0", "color-mix(in srgb, var(--bench) 62%, #ffffff)"], ["1", "var(--bench)"]]);
    gradient("benchFrontGrad", { x1: "0", y1: "0", x2: "0", y2: "1" }, [["0", "var(--bench-edge)"], ["1", "color-mix(in srgb, var(--bench-edge) 70%, #000000)"]]);
    gradient("rodGrad", { x1: "0", y1: "0", x2: "1", y2: "0" }, [["0", "#cdd3d9"], ["0.4", "#98a1a9"], ["0.68", "#b8bfc6"], ["1", "#7d868e"]]);
    gradient("ironGrad", { x1: "0", y1: "0", x2: "0", y2: "1" }, [["0", "#5d646b"], ["1", "#363c42"]]);
    gradient("steelFlat", { x1: "0", y1: "0", x2: "1", y2: "0" }, [["0", "#dde2e7"], ["0.5", "#aeb6bd"], ["1", "#8f979f"]]);

    var lamp = svgEl("radialGradient", { id: "lampGrad", cx: "0.5", cy: "0.04", r: "0.8" });
    lamp.appendChild(svgEl("stop", { offset: "0", "stop-color": "rgba(255,255,255,0.18)" }));
    lamp.appendChild(svgEl("stop", { offset: "1", "stop-color": "rgba(255,255,255,0)" }));
    defs.appendChild(lamp);

    var bgrad = svgEl("radialGradient", { id: "ballGrad", cx: "0.35", cy: "0.3", r: "0.8" });
    var bs1 = svgEl("stop", { offset: "0", "stop-color": "#dfe4e9" });
    var bs2 = svgEl("stop", { offset: "1", "stop-color": "#8d979f" });
    bgrad.appendChild(bs1); bgrad.appendChild(bs2);
    defs.appendChild(bgrad);
    state._ballStops = [bs1, bs2];

    add(svgEl("rect", { x: 0, y: 0, width: 460, height: BENCH_Y, fill: "url(#wallGrad)" }));
    var tiles = svgEl("g", { class: "scene-tile" });
    for (var wy = 70; wy < BENCH_Y; wy += 96) { tiles.appendChild(svgEl("line", { x1: 0, y1: wy, x2: 460, y2: wy })); }
    add(tiles);
    add(svgEl("rect", { x: 0, y: 0, width: 460, height: BENCH_Y, fill: "url(#lampGrad)" }));
    add(svgEl("rect", { x: 0, y: BENCH_Y - 18, width: 460, height: 18, fill: "rgba(0,0,0,0.05)" }));

    rect({ x: 0, y: BENCH_Y, width: 460, height: 22, fill: "url(#benchTopGrad)" });
    rect({ x: 0, y: BENCH_Y, width: 460, height: 2.5, fill: "rgba(255,255,255,0.45)" });
    rect({ x: 0, y: BENCH_Y + 22, width: 460, height: 720 - BENCH_Y - 22, fill: "url(#benchFrontGrad)" });
    rect({ x: 0, y: BENCH_Y + 22, width: 460, height: 3, fill: "rgba(0,0,0,0.28)" });

    shadow(128, BENCH_Y + 3, 76, 7, 0.16);
    shadow(250, BENCH_Y + 3, 58, 7, 0.2);
    shadow(386, BENCH_Y + 2, 52, 5, 0.13);

    var rule = svgEl("g");
    rule.appendChild(svgEl("rect", { x: 300, y: 118, width: 18, height: BENCH_Y - 118, rx: 2, fill: "url(#steelFlat)", stroke: "#8a929a" }));
    var rt = svgEl("text", { x: 309, y: 130, "text-anchor": "middle", fill: "#4a525a", "font-size": "8", "font-family": "var(--mono)" });
    rt.textContent = "mm";
    rule.appendChild(rt);
    for (var mm = 0; mm <= 440; mm += 10) {
      var ry = RELEASE_Y + mm * PX_PER_MM;
      var rmajor = mm % 100 === 0;
      rule.appendChild(svgEl("line", { x1: 300, y1: ry, x2: 300 + (rmajor ? 13 : 7), y2: ry, stroke: "#4a525a", "stroke-width": rmajor ? 1.3 : 0.8 }));
      if (rmajor) {
        var rlab = svgEl("text", { x: 316, y: ry + 3.2, "text-anchor": "end", fill: "#3c444b", "font-size": "9", "font-family": "var(--mono)" });
        rlab.textContent = mm === 0 ? "0" : String(mm);
        rule.appendChild(rlab);
      }
    }
    add(rule);

    rect({ x: 62, y: BENCH_Y - 22, width: 140, height: 22, rx: 7, fill: "url(#ironGrad)", stroke: "#2f343a" });
    rect({ x: 74, y: BENCH_Y - 26, width: 116, height: 6, rx: 3, fill: "#606870" });
    rect({ x: 86, y: BENCH_Y - 40, width: 32, height: 22, rx: 5, fill: "url(#ironGrad)", stroke: "#2f343a" });
    rect({ x: 94, y: 150, width: 14, height: BENCH_Y - 190, rx: 5, fill: "url(#rodGrad)", stroke: "#7f888f" });
    rect({ x: 97, y: 156, width: 3, height: BENCH_Y - 210, fill: "rgba(255,255,255,0.35)" });

    var CL = 210, CR = 290, LIQ_L = 217, LIQ_R = 283;

    rect({ x: 190, y: BENCH_Y - 18, width: 120, height: 18, rx: 9, fill: "url(#glassGloss)", stroke: "var(--glass-line)" });
    add(svgEl("ellipse", { cx: 250, cy: BENCH_Y - 18, rx: 60, ry: 6, fill: "rgba(255,255,255,0.32)", stroke: "var(--glass-line)" }));

    rect({ x: CL, y: TUBE_TOP, width: CR - CL, height: TUBE_BOTTOM - TUBE_TOP, rx: 7, class: "glass-body" });
    rect({ x: LIQ_L, y: LIQ_TOP, width: LIQ_R - LIQ_L, height: LIQ_BOTTOM - LIQ_TOP, rx: 6, fill: "url(#liquidGrad)" });
    rect({ x: LIQ_L, y: LIQ_TOP, width: LIQ_R - LIQ_L, height: LIQ_BOTTOM - LIQ_TOP, rx: 6, fill: "url(#liquidShade)" });
    add(svgEl("path", {
      d: "M" + LIQ_L + " " + LIQ_TOP + " Q250 " + (LIQ_TOP - 8) + " " + LIQ_R + " " + LIQ_TOP,
      fill: "none", stroke: "var(--accent-strong)", "stroke-width": 2, opacity: 0.85
    }));

    var strip = svgEl("g");
    strip.appendChild(svgEl("rect", { x: CR - 20, y: TUBE_TOP + 22, width: 18, height: TUBE_BOTTOM - TUBE_TOP - 46, fill: "rgba(255,255,255,0.85)" }));
    for (var gi = 0; gi <= 10; gi++) {
      var gy = TUBE_TOP + 34 + gi * ((TUBE_BOTTOM - TUBE_TOP - 80) / 10);
      var gmaj = gi % 2 === 0;
      strip.appendChild(svgEl("line", { x1: CR - 4, y1: gy, x2: CR - 4 - (gmaj ? 14 : 8), y2: gy, stroke: "#465059", "stroke-width": gmaj ? 1 : 0.7 }));
      if (gmaj) {
        var glab = svgEl("text", { x: CR - 5, y: gy - 3, "text-anchor": "end", fill: "#465059", "font-size": "8", "font-family": "var(--mono)" });
        glab.textContent = String(500 - gi * 50);
        strip.appendChild(glab);
      }
    }
    add(strip);

    rect({ x: CL + 5, y: TUBE_TOP + 14, width: 6, height: TUBE_BOTTOM - TUBE_TOP - 40, rx: 3, fill: "#ffffff", opacity: 0.34 });
    rect({ x: CR - 12, y: TUBE_TOP + 26, width: 4, height: TUBE_BOTTOM - TUBE_TOP - 62, rx: 2, fill: "#ffffff", opacity: 0.22 });
    rect({ x: CL, y: TUBE_TOP, width: CR - CL, height: TUBE_BOTTOM - TUBE_TOP, rx: 7, fill: "none", stroke: "var(--glass-line)", "stroke-width": 1.6 });
    add(svgEl("ellipse", { cx: 250, cy: TUBE_TOP + 2, rx: (CR - CL) / 2, ry: 5, fill: "rgba(255,255,255,0.28)", stroke: "var(--glass-line)" }));

    [214, 434].forEach(function (cy) {
      rect({ x: 98, y: cy - 11, width: 28, height: 24, rx: 4, fill: "url(#ironGrad)", stroke: "#2f343a" });
      add(svgEl("circle", { cx: 136, cy: cy + 1, r: 7, fill: "#b7bec5", stroke: "#7f888f" }));
      add(svgEl("circle", { cx: 136, cy: cy + 1, r: 2.4, fill: "#7f888f" }));
      rect({ x: 124, y: cy - 5, width: 82, height: 10, rx: 3, fill: "url(#rodGrad)", stroke: "#7f888f" });
      rect({ x: 198, y: cy - 16, width: 13, height: 32, rx: 6, fill: "url(#ironGrad)", stroke: "#2f343a" });
    });

    var TH_X = 66, TH_W = 15, TH_TOP = 246;
    var bulbY = BENCH_Y - 15;
    var bulbR = 15;
    var th = svgEl("g");
    th.appendChild(svgEl("rect", { x: TH_X, y: TH_TOP, width: TH_W, height: bulbY - TH_TOP, rx: TH_W / 2, fill: "url(#glassGloss)", stroke: "var(--glass-line)", "stroke-width": 1.2 }));
    th.appendChild(svgEl("circle", { cx: TH_X + TH_W / 2, cy: bulbY, r: bulbR, fill: "url(#glassGloss)", stroke: "var(--glass-line)", "stroke-width": 1.2 }));
    th.appendChild(svgEl("rect", { x: TH_X + 4, y: 336, width: TH_W - 8, height: bulbY - 336, fill: "#c2402a" }));
    th.appendChild(svgEl("circle", { cx: TH_X + TH_W / 2, cy: bulbY, r: bulbR - 3.5, fill: "#c2402a" }));
    th.appendChild(svgEl("rect", { x: TH_X + 2, y: TH_TOP + 6, width: 4, height: bulbY - TH_TOP - 12, rx: 2, fill: "#ffffff", opacity: 0.35 }));
    th.appendChild(svgEl("ellipse", { cx: TH_X + TH_W / 2 - 4, cy: bulbY - 5, rx: 4, ry: 3, fill: "#ffffff", opacity: 0.45 }));
    th.appendChild(svgEl("circle", { cx: TH_X + TH_W / 2, cy: bulbY, r: bulbR, fill: "none", stroke: "var(--glass-line)", "stroke-width": 1.2 }));
    for (var ty = 258; ty <= bulbY - 18; ty += 26) {
      th.appendChild(svgEl("line", { x1: TH_X + TH_W + 2, y1: ty, x2: TH_X + TH_W + 9, y2: ty, stroke: "var(--line-strong)", "stroke-width": 1 }));
    }
    th.appendChild(svgEl("text", { x: TH_X + TH_W / 2, y: 236, "text-anchor": "middle", class: "scene-label" }));
    th.lastChild.textContent = "20.0 \u00b0C";
    th.appendChild(svgEl("rect", { x: TH_X + TH_W + 2, y: 324, width: 28, height: 18, rx: 4, fill: "url(#ironGrad)", stroke: "#2f343a" }));
    add(th);

    var props = svgEl("g");
    props.appendChild(svgEl("polygon", { points: "340,657 438,657 432,645 346,645", fill: "#f1f1ea", stroke: "#cfcfc4" }));
    props.appendChild(svgEl("circle", { cx: 372, cy: 651, r: 5, fill: "url(#ballGrad)", stroke: "#7d858d" }));
    props.appendChild(svgEl("circle", { cx: 401, cy: 650, r: 4, fill: "url(#ballGrad)", stroke: "#7d858d" }));
    add(props);

    var rel = svgEl("g");
    rel.appendChild(svgEl("line", { x1: 206, y1: RELEASE_Y, x2: 294, y2: RELEASE_Y, class: "scene-ruler" }));
    var relt = svgEl("text", { x: 204, y: RELEASE_Y + 3.5, class: "scene-label", "text-anchor": "end" });
    relt.textContent = "release";
    rel.appendChild(relt);
    add(rel);

    var markers = svgEl("g", { id: "sceneMarkers" });
    [100, 200, 300, 400].forEach(function (mm, i) {
      var y = RELEASE_Y + mm * PX_PER_MM;
      markers.appendChild(svgEl("path", { id: "markerLine" + i, d: "M208 " + y + " Q250 " + (y + 3) + " 292 " + y, fill: "none", class: "marker-band" }));
      var tag = svgEl("text", { x: 204, y: y + 4, class: "marker-tag", "text-anchor": "end" });
      tag.textContent = String(i + 1);
      markers.appendChild(tag);
    });
    add(markers);

    var liqLabel = svgEl("text", { x: 204, y: LIQ_TOP - 8, "text-anchor": "end", class: "scene-label" });
    liqLabel.textContent = "glycerine";
    add(liqLabel);

    var trail = svgEl("g", { id: "sceneTrail" });
    for (var k = 1; k <= 4; k++) { trail.appendChild(svgEl("circle", { r: 0, cx: 250, cy: 0, class: "trail" })); }
    add(trail);

    add(svgEl("circle", { id: "sceneBall", cx: 250, cy: RELEASE_Y, r: 8, fill: "url(#ballGrad)", stroke: "var(--line-strong)", "stroke-width": 1 }));
    add(svgEl("circle", { id: "sceneBallHl", cx: 0, cy: 0, r: 3, fill: "#ffffff", opacity: 0.75 }));

    updateScene();
  }

  function ballVisualR() {
    var rmm = sphereD() / 2;
    return clamp(8 + rmm * 3.2, 11, 30);
  }

  function updateScene() {
    var ball = $("sceneBall");
    if (!ball) { return; }
    var d = state.drop ? state.drop.distance : 0;
    var cy = RELEASE_Y + d * 1000 * PX_PER_MM;
    var r = ballVisualR();
    ball.setAttribute("cy", cy);
    ball.setAttribute("r", r);
    var hl = $("sceneBallHl");
    hl.setAttribute("cx", 250 - r * 0.35);
    hl.setAttribute("cy", cy - r * 0.35);
    hl.setAttribute("r", Math.max(2, r * 0.32));
    var stops = state._ballStops;
    if (stops) {
      var col = MATERIALS[state.material].ball;
      stops[0].setAttribute("stop-color", col[0]);
      stops[1].setAttribute("stop-color", col[1]);
    }
    var trail = $("sceneTrail");
    if (trail) {
      var kids = trail.children;
      for (var i = 0; i < kids.length; i++) {
        var off = (i + 1) * 7;
        kids[i].setAttribute("cx", 250);
        kids[i].setAttribute("cy", cy - off);
        kids[i].setAttribute("r", r * (0.8 - i * 0.15));
        kids[i].style.opacity = state.drop && !state.drop.done ? String(0.16 - i * 0.03) : "0";
      }
    }
  }

  /* ---------- instruments ---------- */

  function svgPoint(svg, evt) {
    var pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }

  function makeSvg(container, viewBox, label) {
    clear(container);
    var s = svgEl("svg", { viewBox: viewBox, role: "img", "aria-label": label, tabindex: "0" });
    var defs = svgEl("defs");
    s.appendChild(defs);
    container.appendChild(s);
    return s;
  }

  var CAL = { scale: 26, x0: 60, max: 13, beamTop: 46, mainTop: 52, mainLen: 18, verBase: 100, ballY: 322 };

  function buildCaliper() {
    var svg = makeSvg($("caliperMount"), "0 0 760 520", "Vernier caliper");
    var defs = svg.querySelector("defs");
    var metal = svgEl("linearGradient", { id: "calMetal", x1: "0", y1: "0", x2: "0", y2: "1" });
    metal.appendChild(svgEl("stop", { offset: "0", "stop-color": "#d5dbe1" }));
    metal.appendChild(svgEl("stop", { offset: "1", "stop-color": "#9aa3ac" }));
    defs.appendChild(metal);
    var sliderMetal = svgEl("linearGradient", { id: "calSlider", x1: "0", y1: "0", x2: "0", y2: "1" });
    sliderMetal.appendChild(svgEl("stop", { offset: "0", "stop-color": "#c2c8ce" }));
    sliderMetal.appendChild(svgEl("stop", { offset: "1", "stop-color": "#838c94" }));
    defs.appendChild(sliderMetal);

    var base = svgEl("g", { id: "caliperBase" });
    svg.appendChild(base);

    base.appendChild(svgEl("rect", { x: 40, y: CAL.beamTop, width: 660, height: 44, rx: 6, fill: "url(#calMetal)", stroke: "#79828b" }));

    var mainG = svgEl("g");
    for (var mm = 0; mm <= CAL.max; mm++) {
      var x = CAL.x0 + mm * CAL.scale;
      var major = mm % 5 === 0;
      mainG.appendChild(svgEl("line", { x1: x, y1: CAL.mainTop, x2: x, y2: CAL.mainTop + (major ? CAL.mainLen : 11), stroke: "#3c444b", "stroke-width": major ? 1.7 : 1 }));
      if (major) {
        mainG.appendChild(svgText(x, CAL.mainTop - 14, String(mm), { "text-anchor": "middle", fill: "#3c444b", "font-size": "15", "font-family": "var(--mono)" }));
      }
    }
    base.appendChild(mainG);
    base.appendChild(svgText(42, 22, "main scale / mm", { fill: "#5c6670", "font-size": "13" }));

    var d = sphereD();
    var br = (d / 2) * CAL.scale;
    var prongY = 90;
    var prongBottom = CAL.ballY + br + 22;

    base.appendChild(svgEl("rect", { x: 44, y: prongY, width: 16, height: prongBottom - prongY, rx: 3, fill: "url(#calSlider)", stroke: "#6c757d" }));
    base.appendChild(svgEl("circle", { id: "calBall", cx: CAL.x0 + br, cy: CAL.ballY, r: br, fill: "url(#ballGrad)", stroke: "#7d858d" }));

    var sliderG = svgEl("g", { id: "caliperSlider" });
    sliderG.appendChild(svgEl("rect", { x: -16, y: 76, width: 16, height: prongBottom - 76, rx: 3, fill: "url(#calSlider)", stroke: "#6c757d" }));
    sliderG.appendChild(svgEl("rect", { x: 0, y: 76, width: 234, height: 58, rx: 3, fill: "url(#calSlider)", stroke: "#6c757d" }));
    sliderG.appendChild(svgEl("circle", { cx: 30, cy: 105, r: 8, fill: "#a7aeb5", stroke: "#6c757d", "stroke-width": 0.8 }));
    var vernierG = svgEl("g");
    for (var j = 0; j <= 10; j++) {
      var vx = j * 0.9 * CAL.scale;
      var vmajor = j % 2 === 0;
      vernierG.appendChild(svgEl("line", { x1: vx, y1: CAL.verBase, x2: vx, y2: CAL.verBase - (vmajor ? CAL.mainLen : 11), stroke: "#22282e", "stroke-width": vmajor ? 1.7 : 1 }));
      vernierG.appendChild(svgText(vx, CAL.verBase + 26, String(j), { "text-anchor": "middle", fill: "#22282e", "font-size": "13", "font-family": "var(--mono)" }));
    }
    sliderG.appendChild(vernierG);
    sliderG.appendChild(svgText(6, CAL.verBase + 50, "vernier scale", { fill: "#5c6670", "font-size": "11" }));
    base.appendChild(sliderG);

    var dragging = false;
    function setFromPointer(evt) {
      var p = svgPoint(svg, evt);
      var gap = (p.x - CAL.x0) / CAL.scale - sphereD();
      state.caliper.gap = clamp(gap, 0, 3.5);
      drawCaliper();
    }
    svg.addEventListener("pointerdown", function (e) { dragging = true; svg.setPointerCapture(e.pointerId); setFromPointer(e); });
    svg.addEventListener("pointermove", function (e) { if (dragging) { setFromPointer(e); } });
    svg.addEventListener("pointerup", function (e) { dragging = false; try { svg.releasePointerCapture(e.pointerId); } catch (x) {} });
    svg.addEventListener("keydown", function (e) {
      var step = e.shiftKey ? 0.5 : 0.1;
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") { state.caliper.gap = clamp(state.caliper.gap - step, 0, 3.5); drawCaliper(); e.preventDefault(); }
      if (e.key === "ArrowRight" || e.key === "ArrowUp") { state.caliper.gap = clamp(state.caliper.gap + step, 0, 3.5); drawCaliper(); e.preventDefault(); }
    });

    state._caliper = { svg: svg };
    drawCaliper();
  }

  function drawCaliper() {
    var svg = state._caliper.svg;
    var d = sphereD();
    var reading = d + state.caliper.gap;
    state.caliper.value = reading;
    var sliderX = CAL.x0 + reading * CAL.scale;
    svg.querySelector("#caliperSlider").setAttribute("transform", "translate(" + sliderX + ",0)");
    var br = (d / 2) * CAL.scale;
    var ball = svg.querySelector("#calBall");
    ball.setAttribute("cx", CAL.x0 + br);
    ball.setAttribute("r", br);
  }

  function caliperReading() {
    var reading = state.caliper.value;
    var main = Math.floor(reading + 1e-9);
    var idx = Math.round((reading - main) / 0.1);
    if (idx === 10) { main += 1; idx = 0; }
    return { reading: reading, main: main, idx: idx };
  }

  function buildBalance() {
    var svg = makeSvg($("balanceMount"), "0 0 460 230", "Digital balance");
    svg.appendChild(svgEl("polygon", { points: "190,58 270,58 282,86 178,86", fill: "#c8ced5", stroke: "#8f989f" }));
    svg.appendChild(svgEl("ellipse", { id: "balRing", cx: 230, cy: 63, rx: 34, ry: 8, fill: "none", stroke: "#9fb78c", "stroke-width": 1.5, "stroke-dasharray": "5 4" }));
    var ball = svgEl("circle", { id: "balBall", cx: 230, cy: 54, r: 16, fill: "url(#ballGrad)", stroke: "#7d858d" });
    ball.style.display = "none";
    svg.appendChild(ball);
    svg.appendChild(svgEl("rect", { x: 60, y: 86, width: 340, height: 96, rx: 14, fill: "#3a424a", stroke: "#262d34" }));
    svg.appendChild(svgEl("rect", { x: 84, y: 104, width: 292, height: 58, rx: 6, fill: "#cfe3bd", stroke: "#9fb78c" }));
    var val = svgEl("text", { id: "balValue", x: 356, y: 146, "text-anchor": "end", fill: "#26331b", "font-size": "34", "font-family": "var(--mono)" });
    val.textContent = "0.0000";
    svg.appendChild(val);
    var unit = svgEl("text", { x: 364, y: 146, fill: "#26331b", "font-size": "18", "font-family": "var(--mono)" });
    unit.textContent = "g";
    svg.appendChild(unit);
    var stable = svgEl("text", { id: "balStable", x: 356, y: 176, "text-anchor": "end", fill: "#8a9a7a", "font-size": "11", "font-family": "var(--mono)" });
    stable.textContent = "NO LOAD";
    svg.appendChild(stable);
    var brand = svgEl("text", { x: 84, y: 196, fill: "#9aa3ac", "font-size": "11", "font-family": "var(--mono)" });
    brand.textContent = "PRECISION 0.0001 g";
    svg.appendChild(brand);
    state._balance = { value: val, stable: stable, ball: ball, ring: svg.querySelector("#balRing") };
    svg.addEventListener("click", toggleBalance);
    svg.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " " || e.code === "Space") {
        e.preventDefault();
        e.stopPropagation();
        toggleBalance();
      }
    });
    settleBalance(true);
  }

  function toggleBalance() {
    state.onBalance = !state.onBalance;
    var b = state._balance;
    if (b) {
      b.ball.style.display = state.onBalance ? "" : "none";
      b.ring.style.display = state.onBalance ? "none" : "";
    }
    var btn = $("panBtn");
    if (btn) { btn.textContent = state.onBalance ? "Lift the sphere off" : "Place the sphere on the pan"; }
    settleBalance(false);
  }

  function settleBalance(instant) {
    var b = state._balance;
    if (!b) { return; }
    var br = clamp(10 + sphereD() * 1.1, 12, 26);
    b.ball.setAttribute("r", br.toFixed(1));
    b.ball.setAttribute("cy", (63 - br + 6).toFixed(1));
    var target = state.onBalance ? currentExpected().massG : 0;
    if (state._balanceTimer) { clearInterval(state._balanceTimer); state._balanceTimer = null; }
    var label = state.onBalance ? "STABLE" : "NO LOAD";
    var labelFill = state.onBalance ? "#4b7a34" : "#8a9a7a";
    if (instant) {
      b.value.textContent = target.toFixed(4);
      b.stable.textContent = label;
      b.stable.setAttribute("fill", labelFill);
      return;
    }
    var from = parseFloat(b.value.textContent) || 0;
    var t0 = performance.now();
    b.stable.textContent = "STABILISING";
    b.stable.setAttribute("fill", "#8a9a7a");
    state._balanceTimer = setInterval(function () {
      var el = performance.now() - t0;
      if (el < 900) {
        var k = el / 900;
        var shown = from + (target - from) * k + (target - from) * (Math.random() - 0.5) * 0.06;
        b.value.textContent = Math.max(0, shown).toFixed(4);
      } else {
        b.value.textContent = target.toFixed(4);
        b.stable.textContent = label;
        b.stable.setAttribute("fill", labelFill);
        clearInterval(state._balanceTimer);
        state._balanceTimer = null;
      }
    }, 70);
  }

  function resetBalance() {
    state.onBalance = false;
    var b = state._balance;
    if (b) { b.ball.style.display = "none"; b.ring.style.display = ""; }
    var btn = $("panBtn");
    if (btn) { btn.textContent = "Place the sphere on the pan"; }
    settleBalance(true);
  }

  /* ---------- timing ---------- */

  var rafId = null, lastTs = 0;

  function startDrop() {
    var r = sphereD() / 2000;
    var v = simVel(r, sphereRho());
    var maxFall = (LIQ_BOTTOM - 4 - ballVisualR() - RELEASE_Y) / (1000 * PX_PER_MM);
    state.drop = { v: v, time: 0, distance: 0, marks: [], done: false, stopped: false, maxFall: maxFall, tMax: maxFall / v };
    state.measured = null;
    state.trace = [];
    state.traceT = 0;
    $("stopwatch").textContent = "0.00";
    $("stopwatch").classList.remove("is-stopped");
    var face = document.querySelector(".stopwatch-face");
    if (face) { face.classList.remove("is-stopped"); }
    resetMarkList();
    $("intervalOut").innerHTML = '<span class="muted">Interval times appear here after four crossings.</span>';
    $("recordBtn").disabled = true;
    setTimingStatus("The sphere is falling. Press Space at lines 1\u20134.", false);
    updateScene();
    lastTs = performance.now();
    var scene = $("scene");
    var ripple = svgEl("ellipse", { cx: 250, cy: LIQ_TOP, rx: 24, ry: 5, class: "ripple", "pointer-events": "none" });
    var trailNode = $("sceneTrail");
    if (trailNode && trailNode.parentNode === scene) { scene.insertBefore(ripple, trailNode); } else { scene.appendChild(ripple); }
    ripple.addEventListener("animationend", function () { if (ripple.parentNode) { ripple.remove(); } });
    setTimeout(function () { if (ripple.parentNode) { ripple.remove(); } }, 1600);
    if (rafId) { cancelAnimationFrame(rafId); }
    rafId = requestAnimationFrame(frame);
    updateStepper();
  }

  function frame(ts) {
    if (!state.drop) { rafId = null; return; }
    var dt = Math.min(0.05, (ts - lastTs) / 1000) || 0;
    lastTs = ts;
    var simDt = dt * state.speed;
    state.drop.time += simDt;
    state.drop.distance += state.drop.v * simDt;
    var atBottom = state.drop.distance >= state.drop.maxFall;
    if (atBottom) {
      state.drop.distance = state.drop.maxFall;
      state.drop.done = true;
    }
    updateScene();
    updateReadouts();
    if (!state.drop.stopped) { updateStopwatch(); }
    logTrace();
    updateLiveCharts();
    if (atBottom) {
      stopStopwatch();
      if (state.drop.marks.length < 4) {
        setTimingStatus("The sphere reached the bottom before four crossings were logged. Drop it again.", true);
      }
      rafId = null;
      return;
    }
    rafId = requestAnimationFrame(frame);
  }

  function logTrace() {
    if (!state.drop) { return; }
    if (state.drop.time - state.traceT < 0.08 && state.traceT !== 0) { return; }
    state.traceT = state.drop.time;
    state.trace.push({ t: state.drop.time, d: state.drop.distance });
  }

  function stopStopwatch() {
    if (!state.drop || state.drop.stopped) { return; }
    state.drop.stopped = true;
    var t = state.drop.marks.length ? state.drop.time - state.drop.marks[0] : state.drop.time;
    $("stopwatch").textContent = t.toFixed(2);
    $("stopwatch").classList.add("is-stopped");
    var face = document.querySelector(".stopwatch-face");
    if (face) { face.classList.add("is-stopped"); }
  }

  function updateStopwatch() {
    if (!state.drop) { return; }
    var t = state.drop.marks.length ? state.drop.time - state.drop.marks[0] : state.drop.time;
    $("stopwatch").textContent = t.toFixed(2);
  }

  function updateReadouts() {
    if (!state.drop) { return; }
    $("roDistance").textContent = state.drop.distance.toFixed(3) + " m";
    $("roSpeed").textContent = (state.drop.v * 100).toFixed(2) + " cm/s";
    $("roElapsed").textContent = state.drop.time.toFixed(2) + " s";
  }

  function resetMarkList() {
    var items = $("markList").children;
    for (var i = 0; i < items.length; i++) {
      items[i].classList.remove("is-set", "flash");
      items[i].querySelector("b").innerHTML = "&mdash;";
    }
  }

  function recordMark() {
    if (!state.drop || state.drop.marks.length >= 4) { return; }
    var idx = state.drop.marks.length;
    state.drop.marks.push(state.drop.time);
    var ml = $("markerLine" + idx);
    if (ml) { ml.classList.add("flash"); setTimeout(function () { ml.classList.remove("flash"); }, 500); }
    var item = $("markList").children[idx];
    var display = state.drop.time - state.drop.marks[0];
    item.querySelector("b").textContent = display.toFixed(2);
    item.classList.add("is-set", "flash");
    setTimeout(function () { item.classList.remove("flash"); }, 500);
    updateStopwatch();
    updateLiveCharts(true);
    if (state.drop.marks.length === 4) { finaliseMeasurement(); }
  }

  function measuredFromMarks() {
    var m = state.drop ? state.drop.marks : null;
    if (!m || m.length < 4) { return null; }
    var dts = [m[1] - m[0], m[2] - m[1], m[3] - m[2]];
    var vs = dts.map(function (t) { return INTERVAL_M / t; });
    return { dts: dts, vs: vs, vmean: (vs[0] + vs[1] + vs[2]) / 3 };
  }

  function partialIntervalVelocities() {
    var m = state.drop ? state.drop.marks : null;
    if (!m || m.length < 2) { return null; }
    var vs = [];
    for (var i = 0; i < 3; i++) {
      vs.push(m[i + 1] !== undefined ? INTERVAL_M / (m[i + 1] - m[i]) : null);
    }
    return vs;
  }

  function finaliseMeasurement() {
    var meas = measuredFromMarks();
    if (!meas) { return; }
    state.measured = meas;
    var dts = meas.dts;
    var vmean = meas.vmean;
    var box = $("intervalOut");
    box.innerHTML = "";
    dts.forEach(function (t, i) {
      var row = document.createElement("div");
      row.className = "iv";
      row.innerHTML = "<span>Interval " + (i + 1) + "</span><span>" + t.toFixed(2) + " s</span>";
      box.appendChild(row);
    });
    var mean = document.createElement("div");
    mean.className = "iv";
    mean.innerHTML = "<span>Mean speed</span><span>" + (vmean * 100).toFixed(2) + " cm/s</span>";
    box.appendChild(mean);
    $("recordBtn").disabled = false;
    var straight = state.drop.v;
    var off = dts.some(function (t) { return Math.abs(t - INTERVAL_M / straight) > Math.max(0.3, 0.25 * (INTERVAL_M / straight)); });
    setTimingStatus(off ? "One or more timings look inconsistent \u2014 check you pressed exactly at each line." : "Nicely timed. The three intervals agree, so this is the terminal velocity.", off);
    redrawCharts();
    updateStepper();
  }

  function setTimingStatus(msg, warn) {
    var el = $("timingStatus");
    el.textContent = msg;
    el.style.color = warn ? "var(--bad)" : "";
  }

  /* ---------- trials ---------- */

  function recordTrial() {
    if (!state.measured) { return; }
    state.trials.push({ dts: state.measured.dts.slice(), vs: state.measured.vs.slice(), vmean: state.measured.vmean });
    renderTrials();
    $("recordBtn").disabled = true;
    toast("Trial " + state.trials.length + " recorded");
  }

  function renderTrials() {
    var list = $("trialList");
    clear(list);
    $("trialCount").textContent = String(state.trials.length);
    var out = $("uncertaintyOut");
    if (state.trials.length === 0) {
      out.innerHTML = '<p class="muted">Repeat the drop a few times to average out your reaction time.</p>';
    } else {
      var means = state.trials.map(function (t) { return t.vmean; });
      var avg = means.reduce(function (a, b) { return a + b; }, 0) / means.length;
      var sd = 0;
      if (means.length > 1) {
        var ss = means.reduce(function (a, b) { return a + (b - avg) * (b - avg); }, 0);
        sd = Math.sqrt(ss / (means.length - 1));
      }
      out.innerHTML = '<p>Mean of trials</p><p class="big">' + (avg * 100).toFixed(2) + ' cm/s</p>' +
        '<p class="muted">' + (means.length > 1 ? "Spread \u00b1 " + (sd * 100).toFixed(3) + " cm/s (" + means.length + " trials)" : "one trial so far") + '</p>';
    }
    state.trials.forEach(function (t, i) {
      var li = document.createElement("li");
      li.innerHTML = "<span>Trial " + (i + 1) + "</span><span>" + (t.dts[0].toFixed(2)) + " / " + (t.dts[1].toFixed(2)) + " / " + (t.dts[2].toFixed(2)) + " s</span>";
      list.appendChild(li);
    });
  }

  /* ---------- report ---------- */

  var ROWS = [
    { step: 1, title: "Measuring the sphere" },
    { id: "A_caliper", label: "Diameter by vernier caliper", sym: "d", unit: "mm", kind: "len_mm", work: "" },
    { id: "A_mean", label: "Mean diameter", sym: "d\u0304", unit: "mm", kind: "len_mm", work: "(d\u2081 + d\u2082) \u00f7 2" },
    { id: "A_radius", label: "Radius", sym: "r", unit: "m", kind: "len_m", work: "d\u0304 \u00f7 2" },
    { id: "A_volume", label: "Volume", sym: "V", unit: "m\u00b3", kind: "volume", work: "4/3 \u00b7 \u03c0r\u00b3" },
    { step: 2, title: "Mass and density" },
    { id: "B_mass_g", label: "Mass", sym: "m", unit: "g", kind: "mass_g", work: "" },
    { id: "B_mass_kg", label: "Mass", sym: "m", unit: "kg", kind: "mass_kg", work: "g \u00f7 1000" },
    { id: "B_density", label: "Density of the sphere", sym: "\u03c1\u209b", unit: "kg/m\u00b3", kind: "density", work: "m \u00f7 V" },
    { step: 3, title: "Timing the fall" },
    { id: "C_t1", label: "Time, interval 1 (100 mm)", sym: "t\u2081", unit: "s", kind: "time", work: "" },
    { id: "C_t2", label: "Time, interval 2 (100 mm)", sym: "t\u2082", unit: "s", kind: "time", work: "" },
    { id: "C_t3", label: "Time, interval 3 (100 mm)", sym: "t\u2083", unit: "s", kind: "time", work: "" },
    { id: "C_v1", label: "Velocity, interval 1", sym: "v\u2081", unit: "m/s", kind: "velocity", work: "0.100 \u00f7 t\u2081" },
    { id: "C_v2", label: "Velocity, interval 2", sym: "v\u2082", unit: "m/s", kind: "velocity", work: "0.100 \u00f7 t\u2082" },
    { id: "C_v3", label: "Velocity, interval 3", sym: "v\u2083", unit: "m/s", kind: "velocity", work: "0.100 \u00f7 t\u2083" },
    { id: "C_vmean", label: "Mean terminal velocity", sym: "v\u0304", unit: "m/s", kind: "velocity", work: "(v\u2081+v\u2082+v\u2083) \u00f7 3" },
    { step: 4, title: "Viscosity" },
    { id: "D_diff", label: "Density difference (\u03c1\u209b \u2212 \u03c1\ua730)", sym: "\u0394\u03c1", unit: "kg/m\u00b3", kind: "diff", work: "\u03c1\u209b \u2212 1260" },
    { id: "D_eta", label: "Viscosity of glycerine", sym: "\u03b7", unit: "Pa\u00b7s", kind: "eta", work: "2r\u00b2g\u00b7\u0394\u03c1 \u00f7 (9 \u00d7 v)" },
    { id: "D_percent", label: "Percentage difference from 1.41", sym: "%", unit: "%", kind: "percent", work: "|\u03b7 \u2212 1.41| \u00f7 1.41 \u00d7 100" }
  ];

  function toolForRow(id) {
    if (id === "A_caliper") { return "caliper"; }
    if (id.charAt(0) === "B") { return "balance"; }
    if (id.charAt(0) === "C") { return "stopwatch"; }
    return null;
  }

  function focusTool(name) {
    var tools = document.querySelectorAll("#toolSurface .tool");
    for (var i = 0; i < tools.length; i++) {
      var t = tools[i];
      var active = t.dataset.tool === name;
      t.classList.toggle("is-active", active);
      var pick = t.querySelector(".tool__pick");
      if (pick) { pick.setAttribute("aria-pressed", active ? "true" : "false"); }
      var svg = t.querySelector("svg");
      if (svg) { svg.setAttribute("tabindex", active ? "0" : "-1"); }
    }
  }

  function buildReport() {
    var mount = $("reportBody");
    clear(mount);
    var rowsWrap = null;
    ROWS.forEach(function (row) {
      if (row.step) {
        var section = document.createElement("section");
        section.className = "nb-page";
        section.id = "step-" + row.step;
        section.dataset.page = String(row.step);
        section.innerHTML = '<h3 class="nb-step__title"><span class="nb-step__no">' + row.step + "</span>" + row.title + "</h3>";
        rowsWrap = document.createElement("div");
        rowsWrap.className = "nb-step__rows";
        section.appendChild(rowsWrap);
        mount.appendChild(section);
        return;
      }
      var r = document.createElement("div");
      r.className = "nb-row";
      r.dataset.id = row.id;
      r.innerHTML =
        '<span class="nb-row__label">' + row.label + "</span>" +
        '<span class="nb-row__sym">' + row.sym + "</span>" +
        '<span class="nb-row__value"><input type="text" inputmode="decimal" class="nb-input" id="in_' + row.id + '" aria-label="' + row.label + ' in ' + row.unit + '"><span class="nb-row__unit">' + row.unit + '</span><span class="expected" hidden></span></span>' +
        '<span class="nb-row__work">' + (row.work || "") + "</span>" +
        '<span class="status" id="st_' + row.id + '" aria-live="polite"></span>';
      rowsWrap.appendChild(r);
      var input = r.querySelector("input");
      input.addEventListener("focus", function () { state.focusInput = input; });
      input.addEventListener("input", function () {
        input.classList.remove("is-ok", "is-bad");
        var st = $("st_" + row.id);
        st.className = "status";
        st.innerHTML = "";
        updateStepper();
      });
      input.addEventListener("blur", function () { checkRow(row.id, false); });
      var linked = toolForRow(row.id);
      if (linked) {
        var lab = r.querySelector(".nb-row__label");
        lab.classList.add("is-linked");
        lab.addEventListener("click", function () { focusTool(linked); });
      }
    });
  }

  function resetReports() {
    ROWS.forEach(function (row) {
      if (row.group) { return; }
      var input = $("in_" + row.id);
      if (input) {
        input.value = "";
        input.classList.remove("is-ok", "is-bad");
        input.title = "";
      }
      var st = $("st_" + row.id);
      if (st) { st.className = "status"; st.innerHTML = ""; }
    });
    $("scoreOut").textContent = "0 of " + countRows() + " correct";
    $("verdict").innerHTML = '<p class="muted">Your verdict will appear here once the notebook is complete.</p>';
    updateStepper();
  }

  function countRows() { return ROWS.filter(function (r) { return r.id; }).length; }

  function readNumber(input) {
    var raw = input.value.trim();
    if (raw === "") { return null; }
    var n = Number(raw.replace(",", "."));
    return isFinite(n) ? n : null;
  }

  function checkRow(id, quiet) {
    var exp = currentExpected();
    var row = ROWS.filter(function (r) { return r.id === id; })[0];
    if (!row) { return null; }
    var input = $("in_" + id);
    var st = $("st_" + id);
    var expected = expValue(id, exp);
    var entered = readNumber(input);
    input.classList.remove("is-ok", "is-bad");
    st.className = "status";
    st.innerHTML = "";
    if (entered === null) {
      if (!quiet) { return { ok: false, empty: true, message: "Enter a value.", row: row }; }
      return { ok: false, empty: true, row: row };
    }
    var res = evaluate(row.kind, entered, expected);
    if (res.ok) {
      input.classList.add("is-ok");
      st.className = "status is-ok";
      st.innerHTML = "\u2713<span class=\"sr\">correct</span>";
    } else {
      input.classList.add("is-bad");
      st.className = "status is-bad";
      st.innerHTML = "\u2717<span class=\"sr\">incorrect</span>";
      input.title = res.message;
    }
    return { ok: res.ok, message: res.message, row: row };
  }

  function expValue(id, exp) {
    switch (id) {
      case "A_caliper":
      case "A_mean": return exp.d;
      case "A_radius": return exp.r;
      case "A_volume": return exp.V;
      case "B_mass_g": return exp.massG;
      case "B_mass_kg": return exp.massKg;
      case "B_density": return exp.rho;
      case "C_t1": return exp.ts[0];
      case "C_t2": return exp.ts[1];
      case "C_t3": return exp.ts[2];
      case "C_v1": return exp.vs[0];
      case "C_v2": return exp.vs[1];
      case "C_v3": return exp.vs[2];
      case "C_vmean": return exp.vmean;
      case "D_diff": return exp.diff;
      case "D_eta": return exp.eta;
      case "D_percent": return exp.percent;
      default: return 0;
    }
  }

  function autofill() {
    var exp = currentExpected();
    ROWS.forEach(function (row) {
      if (!row.id) { return; }
      var input = $("in_" + row.id);
      input.value = fmt(row.kind, expValue(row.id, exp));
      input.classList.remove("is-ok", "is-bad");
      var st = $("st_" + row.id);
      st.className = "status";
      st.innerHTML = "";
    });
    updateExpectedSpans(exp);
    toast("Filled with the correct values");
  }

  function updateExpectedSpans(exp) {
    ROWS.forEach(function (row) {
      if (!row.id) { return; }
      var cell = $("in_" + row.id).parentNode.querySelector(".expected");
      if (!cell) { return; }
      cell.innerHTML = fmt(row.kind, expValue(row.id, exp));
      cell.hidden = !state.teacher;
    });
  }

  function markWork() {
    var bad = [];
    var correct = 0;
    ROWS.forEach(function (row) {
      if (!row.id) { return; }
      var res = checkRow(row.id, true);
      if (res && res.ok) { correct++; }
      else if (res && !res.empty) { bad.push(res); }
      else if (res && res.empty) { bad.push({ row: row, message: "Nothing entered." }); }
    });
    $("scoreOut").textContent = correct + " of " + countRows() + " correct";
    var exp = currentExpected();
    var list = "";
    if (bad.length) {
      list = '<ul class="notes-list">' + bad.slice(0, 6).map(function (b) {
        return "<li><b>" + b.row.label + ":</b> " + (b.message || "check this value.") + "</li>";
      }).join("") + "</ul>";
    }
    var etaInput = readNumber($("in_D_eta"));
    var eta = etaInput === null ? exp.eta : etaInput;
    var pct = Math.abs(eta - ETA_ACCEPTED) / ETA_ACCEPTED * 100;
    var grade = pct < 3 ? "Excellent" : pct < 7 ? "Good" : pct < 15 ? "Fair" : "Needs work";
    var wallNote = state.wall ? " Your value runs high because you have the tube-wall effect switched on \u2014 apply the correction in the bench note to bring it back to 1.41." : "";
    $("verdict").innerHTML =
      "<p>Measured viscosity <b>" + eta.toFixed(3) + " Pa\u00b7s</b>, <b>" + pct.toFixed(1) + "%</b> from the accepted value \u2014 <span class=\"grade\">" + grade + "</span>." + wallNote + "</p>" +
      (bad.length ? "<p>Fix these first:</p>" + list
        : state.wall ? "<p class=\"muted\">Your working is correct \u2014 the high value is the tube-wall effect, not a mistake. Apply the correction to reach 1.41.</p>"
        : "<p class=\"muted\">Every entry is correct. Well done.</p>");
    updateStepper();
    toast(bad.length ? "Marked \u2014 see the notes below the report" : "All correct!");
  }

  function isRowCorrect(id) {
    var exp = currentExpected();
    var row = ROWS.filter(function (r) { return r.id === id; })[0];
    var input = $("in_" + id);
    if (!row || !input) { return false; }
    var entered = readNumber(input);
    if (entered === null) { return false; }
    return evaluate(row.kind, entered, expValue(id, exp)).ok;
  }

  function allCorrectFor(ids) {
    return ids.every(isRowCorrect);
  }

  function updateStepper() {
    var s1 = allCorrectFor(["A_caliper", "A_mean", "A_radius", "A_volume"]);
    var s2 = allCorrectFor(["B_mass_g", "B_mass_kg", "B_density"]);
    var s3 = allCorrectFor(["C_t1", "C_t2", "C_t3", "C_v1", "C_v2", "C_v3", "C_vmean"]);
    var s4 = allCorrectFor(["D_diff", "D_eta", "D_percent"]);
    var done = { 1: s1, 2: s2, 3: s3, 4: s4, 5: !!state.measured };
    var items = document.querySelectorAll(".stepper__item");
    for (var i = 0; i < items.length; i++) {
      var n = items[i].dataset.step;
      items[i].classList.toggle("is-done", !!done[n]);
    }
  }

  function showPage(n) {
    var pages = document.querySelectorAll(".nb-page");
    var total = pages.length || 5;
    n = clamp(n, 1, total);
    state.page = n;
    for (var i = 0; i < pages.length; i++) {
      pages[i].classList.toggle("is-current", Number(pages[i].dataset.page) === n);
    }
    var items = document.querySelectorAll(".stepper__item");
    for (var j = 0; j < items.length; j++) {
      items[j].classList.toggle("is-active", Number(items[j].dataset.step) === n);
    }
    var lbl = $("pageLabel");
    if (lbl) { lbl.textContent = "Page " + n + " of " + total; }
    var prev = $("pagePrev"), next = $("pageNext");
    if (prev) { prev.disabled = n <= 1; }
    if (next) { next.disabled = n >= total; }
    if (n === 5) { redrawCharts(); }
  }

  /* ---------- charts ---------- */

  function svgText(x, y, text, attrs) {
    var t = svgEl("text", Object.assign({ x: x, y: y }, attrs || {}));
    t.textContent = text;
    return t;
  }

  function chartFrame(svg, xMax, yMax, xLabel, yLabel) {
    clear(svg);
    var W = 420, H = 260, L = 48, R = 14, T = 14, B = 36;
    svg.appendChild(svgText((L + W - R) / 2, H - 4, xLabel, { "text-anchor": "middle", class: "label" }));
    var yMid = (T + H - B) / 2;
    svg.appendChild(svgText(12, yMid, yLabel, { "text-anchor": "middle", class: "label", transform: "rotate(-90 12 " + yMid + ")" }));
    for (var g = 0; g <= 5; g++) {
      var gy = T + (H - T - B) * g / 5;
      svg.appendChild(svgEl("line", { x1: L, y1: gy, x2: W - R, y2: gy, class: "grid" }));
      svg.appendChild(svgText(L - 6, gy + 3.5, fmtAxis(yMax * (1 - g / 5)), { "text-anchor": "end" }));
    }
    svg.appendChild(svgEl("line", { x1: L, y1: T, x2: L, y2: H - B, class: "axis" }));
    svg.appendChild(svgEl("line", { x1: L, y1: H - B, x2: W - R, y2: H - B, class: "axis" }));
    for (var gx = 0; gx <= 4; gx++) {
      var xx = L + (W - R - L) * gx / 4;
      svg.appendChild(svgEl("line", { x1: xx, y1: H - B, x2: xx, y2: H - B + 4, class: "axis" }));
      svg.appendChild(svgText(xx, H - B + 16, fmtAxis(xMax * gx / 4), { "text-anchor": "middle" }));
    }
    return {
      x: function (v) { return L + (clamp(v, 0, xMax) / xMax) * (W - R - L); },
      y: function (v) { return H - B - (clamp(v, 0, yMax) / yMax) * (H - T - B); },
      L: L, R: R, T: T, B: B, W: W, H: H
    };
  }

  function fmtAxis(v) {
    if (v === 0) { return "0"; }
    if (Math.abs(v) < 0.001) { return v.toExponential(0); }
    if (Math.abs(v) >= 100) { return v.toFixed(0); }
    return String(Number(v.toPrecision(2)));
  }

  function emptyNote(svg, text) {
    var t = svgEl("text", { x: 214, y: 130, "text-anchor": "middle", class: "label", "font-size": "13" });
    t.textContent = text;
    svg.appendChild(t);
  }

  function axisBounds() {
    var yMax = 0.6;
    var xMax = 12;
    if (state.drop) {
      xMax = Math.max(1, state.drop.tMax * 1.06);
    } else if (state.trace.length) {
      xMax = Math.max(1, state.trace[state.trace.length - 1].t * 1.06);
    } else if (state.measured) {
      xMax = Math.max(1, (state.measured.dts[0] + state.measured.dts[1] + state.measured.dts[2]) * 1.15);
    }
    return { xMax: xMax, yMax: yMax };
  }

  var lastLive = 0;
  function updateLiveCharts(force) {
    if (state.page !== 5) { return; }
    var now = performance.now();
    if (!force && now - lastLive < 110) { return; }
    lastLive = now;
    drawDistanceChart();
    drawSegmentsChart();
  }

  function drawDistanceChart() {
    var svg = $("chartDistance");
    var bounds = axisBounds();
    var f = chartFrame(svg, bounds.xMax, bounds.yMax, "time / s", "distance / m");

    var marks = state.drop ? state.drop.marks : [];
    var hasTrace = state.trace.length > 1;
    if (!hasTrace && !marks.length && !state.measured) {
      emptyNote(svg, "Drop the sphere to plot");
      return;
    }

    if (hasTrace) {
      var d = "M" + state.trace.map(function (p) { return f.x(p.t) + "," + f.y(p.d); }).join(" L");
      svg.appendChild(svgEl("path", { d: d, class: "trace" }));
      var lastP = state.trace[state.trace.length - 1];
      svg.appendChild(svgEl("circle", { cx: f.x(lastP.t), cy: f.y(lastP.d), r: 4, class: "dot live" }));
    } else if (state.measured) {
      var dts = state.measured.dts;
      var tt = 0;
      var dd = "M" + f.x(0) + "," + f.y(0);
      for (var k = 0; k < 3; k++) { tt += dts[k]; dd += " L" + f.x(tt) + "," + f.y((k + 1) * 0.1); }
      svg.appendChild(svgEl("path", { d: dd, class: "series" }));
    }

    if (marks.length >= 2) {
      var n = marks.length, sx = 0, sy = 0, sxx = 0, sxy = 0, pts = [];
      for (var i = 0; i < n; i++) {
        var p = { t: marks[i], d: 0.1 * (i + 1) };
        pts.push(p);
        sx += p.t; sy += p.d; sxx += p.t * p.t; sxy += p.t * p.d;
      }
      var den = n * sxx - sx * sx;
      var grad = den ? (n * sxy - sx * sy) / den : state.drop.v;
      var inter = (sy - grad * sx) / n;
      svg.appendChild(svgEl("line", {
        x1: f.x(0), y1: f.y(clamp(inter, 0, bounds.yMax)),
        x2: f.x(bounds.xMax), y2: f.y(clamp(grad * bounds.xMax + inter, 0, bounds.yMax)),
        class: "fit"
      }));
      pts.forEach(function (pt, idx) {
        svg.appendChild(svgEl("circle", { cx: f.x(pt.t), cy: f.y(pt.d), r: 4, class: "dot" }));
        svg.appendChild(svgText(f.x(pt.t) + 5, f.y(pt.d) - 6, "line " + (idx + 1), { class: "label", "font-size": "10" }));
      });
      svg.appendChild(svgText(f.L + 10, f.T + 16, "gradient = " + (grad * 100).toFixed(2) + " cm/s", { class: "label", fill: "var(--chrome)" }));
    }
  }

  function drawVelocityChart() {
    var svg = $("chartVelocity");
    var exp = currentExpected();
    var r = exp.r, rho = exp.rho;
    var mass = rho * exp.V;
    var tau = mass / (6 * Math.PI * ETA_ACCEPTED * r);
    var vmax = exp.vSim;
    var tauMs = tau * 1000;
    var tMax = tauMs * 6;
    var f = chartFrame(svg, tMax, vmax * 1.15, "time / ms", "speed / m/s");
    var path = "";
    var N = 140;
    for (var i = 0; i <= N; i++) {
      var t = tMax * i / N;
      var v = vmax * (1 - Math.exp(-(t / 1000) / tau));
      path += (i === 0 ? "M" : " L") + f.x(t) + "," + f.y(v);
    }
    svg.appendChild(svgEl("line", { x1: f.x(0), y1: f.y(vmax), x2: f.x(tMax), y2: f.y(vmax), class: "fit" }));
    svg.appendChild(svgEl("path", { d: path, class: "series" }));
    var lbl = svgEl("text", { x: f.x(tMax * 0.35), y: f.y(vmax) - 7, class: "label", fill: "var(--chrome)" });
    lbl.textContent = "terminal velocity";
    svg.appendChild(lbl);
    var tauLabel = svgEl("text", { x: f.L + 6, y: f.H - f.B - 8, class: "label", "font-size": "10" });
    tauLabel.textContent = "\u03c4 = " + (tau * 1000).toFixed(2) + " ms";
    svg.appendChild(tauLabel);
    var note = svgEl("text", { x: f.L + 6, y: f.H - f.B - 20, class: "muted", "font-size": "10" });
    note.textContent = "settles in about " + (tau * 5 * 1000).toFixed(1) + " ms";
    svg.appendChild(note);
    var meas = measuredFromMarks();
    if (meas && meas.vmean <= vmax * 1.15) {
      var my = f.y(meas.vmean);
      svg.appendChild(svgEl("line", { x1: f.x(0), y1: my, x2: f.x(tMax), y2: my, class: "meanline" }));
      svg.appendChild(svgText(f.x(tMax * 0.05), my + 12, "measured " + (meas.vmean * 100).toFixed(2) + " cm/s", { class: "label", "font-size": "10", fill: "var(--chrome)" }));
    }
  }

  function drawSegmentsChart() {
    var svg = $("chartSegments");
    var exp = currentExpected();
    var maxV = Math.max(exp.vs[0], exp.vs[1], exp.vs[2]) * 1.35 || 1;
    var f = chartFrame(svg, 4, maxV, "interval", "speed / m/s");
    var vs = partialIntervalVelocities();
    if (!vs) { emptyNote(svg, "Time the fall to plot"); return; }
    var bw = (f.W - f.R - f.L) / 4 * 0.5;
    var sds = [0, 0, 0];
    if (state.trials.length > 1) {
      for (var k = 0; k < 3; k++) {
        var vals = state.trials.map(function (t) { return t.vs[k]; });
        var m0 = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
        var ss = vals.reduce(function (a, b) { return a + (b - m0) * (b - m0); }, 0);
        sds[k] = Math.sqrt(ss / (vals.length - 1));
      }
    }
    var known = [];
    for (var q = 0; q < 3; q++) { if (vs[q] !== null) { known.push(vs[q]); } }
    for (var i = 0; i < 3; i++) {
      var cx = f.x(i + 1);
      if (vs[i] === null) {
        svg.appendChild(svgEl("rect", { x: cx - bw / 2, y: f.y(0) - 24, width: bw, height: 24, rx: 3, class: "bar ghost" }));
      } else {
        var v = vs[i];
        var y = f.y(v);
        var base = f.y(0);
        svg.appendChild(svgEl("rect", { x: cx - bw / 2, y: y, width: bw, height: base - y, rx: 3, class: "bar" }));
        svg.appendChild(svgText(cx, y - 6, (v * 100).toFixed(2), { "text-anchor": "middle", class: "label", "font-size": "10" }));
        if (sds[i] > 0) {
          var top = f.y(v + sds[i]);
          var bot = f.y(Math.max(0, v - sds[i]));
          svg.appendChild(svgEl("line", { x1: cx, y1: top, x2: cx, y2: bot, class: "cap" }));
          svg.appendChild(svgEl("line", { x1: cx - 7, y1: top, x2: cx + 7, y2: top, class: "cap" }));
          svg.appendChild(svgEl("line", { x1: cx - 7, y1: bot, x2: cx + 7, y2: bot, class: "cap" }));
        }
      }
      svg.appendChild(svgText(cx, f.H - f.B + 14, String(i + 1), { "text-anchor": "middle" }));
    }
    if (known.length) {
      var mean = known.reduce(function (a, b) { return a + b; }, 0) / known.length;
      var my = f.y(mean);
      svg.appendChild(svgEl("line", { x1: f.L, y1: my, x2: f.W - f.R, y2: my, class: "meanline" }));
      svg.appendChild(svgText(f.W - f.R, my - 5, "mean", { "text-anchor": "end", class: "label", fill: "var(--chrome)", "font-size": "10" }));
    }
  }

  function redrawCharts() {
    drawDistanceChart();
    drawVelocityChart();
    drawSegmentsChart();
  }

  /* ---------- calculator ---------- */

  function tokenize(expr) {
    var out = [], i = 0;
    var s = expr.replace(/\u00d7/g, "*").replace(/\u00f7/g, "/").replace(/\u2212/g, "-").replace(/\u03c0/g, String(Math.PI)).replace(/\u221a/g, "sqrt");
    while (i < s.length) {
      var c = s[i];
      if (c === " ") { i++; continue; }
      if (/[0-9.]/.test(c)) {
        var num = "";
        while (i < s.length && /[0-9.]/.test(s[i])) { num += s[i++]; }
        if (s[i] === "e" || s[i] === "E") {
          num += s[i++];
          if (s[i] === "+" || s[i] === "-") { num += s[i++]; }
          while (i < s.length && /[0-9]/.test(s[i])) { num += s[i++]; }
        }
        out.push({ t: "num", v: parseFloat(num) });
        continue;
      }
      if (/[a-zA-Z]/.test(c)) {
        var id = "";
        while (i < s.length && /[a-zA-Z]/.test(s[i])) { id += s[i++]; }
        out.push({ t: "fn", v: id });
        continue;
      }
      if ("+-*/^()".indexOf(c) >= 0) { out.push({ t: "op", v: c }); i++; continue; }
      throw new Error("bad char");
    }
    return out;
  }

  function evalExpr(expr) {
    var toks = tokenize(expr);
    var out = [], ops = [];
    var prec = { "+": 1, "-": 1, "*": 2, "/": 2, "^": 4 };
    var right = { "^": true };
    var prev = null;
    for (var i = 0; i < toks.length; i++) {
      var tk = toks[i];
      if (tk.t === "num") { out.push(tk.v); }
      else if (tk.t === "fn") {
        if (tk.v !== "sqrt" && tk.v !== "pi") { throw new Error("unknown"); }
        ops.push(tk.v === "sqrt" ? "sqrt" : String(Math.PI));
        if (tk.v === "pi") { ops.pop(); out.push(Math.PI); }
        else {
          toks.splice(i + 1, 0, { t: "op", v: "(" });
        }
      } else if (tk.v === "(") { ops.push("("); }
      else if (tk.v === ")") {
        while (ops.length && ops[ops.length - 1] !== "(") { out.push(ops.pop()); }
        ops.pop();
        if (ops[ops.length - 1] === "sqrt") { out.push("sqrt"); ops.pop(); }
      } else {
        var op = tk.v;
        var unary = (op === "-" || op === "+") && (prev === null || prev.t === "op" && prev.v !== ")");
        if (unary) { out.push(0); }
        while (ops.length) {
          var top = ops[ops.length - 1];
          if (top === "(" || top === "sqrt") { break; }
          if (prec[top] > prec[op] || (prec[top] === prec[op] && !right[op])) { out.push(ops.pop()); }
          else { break; }
        }
        ops.push(op);
      }
      prev = tk;
    }
    while (ops.length) { out.push(ops.pop()); }
    var st = [];
    out.forEach(function (o) {
      if (typeof o === "number") { st.push(o); return; }
      if (o === "sqrt") { st.push(Math.sqrt(st.pop())); return; }
      var b = st.pop(), a = st.pop();
      if (o === "+") { st.push(a + b); }
      else if (o === "-") { st.push(a - b); }
      else if (o === "*") { st.push(a * b); }
      else if (o === "/") { st.push(a / b); }
      else if (o === "^") { st.push(Math.pow(a, b)); }
    });
    if (st.length !== 1) { throw new Error("bad"); }
    return st[0];
  }

  function initCalculator() {
    var keys = ["7", "8", "9", "\u00f7", "4", "5", "6", "\u00d7", "1", "2", "3", "\u2212", "0", ".", "\u03c0", "+", "(", ")", "^", "\u221a", "C", "\u232b", "="];
    var wrap = $("calcKeys");
    keys.forEach(function (k) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = k;
      if ("\u00f7\u00d7\u2212+\u03c0^\u221a".indexOf(k) >= 0) { b.className = "op"; }
      if (k === "=") { b.className = "eq"; }
      b.addEventListener("click", function () { calcKey(k); });
      wrap.appendChild(b);
    });
    $("calcDisplay").addEventListener("keydown", function (e) { if (e.key === "Enter") { calcKey("="); } });
    $("calcFab").addEventListener("click", function () {
      var panel = $("calcPanel");
      panel.hidden = !panel.hidden;
      $("calcFab").setAttribute("aria-expanded", String(!panel.hidden));
      if (!panel.hidden) { $("calcDisplay").focus(); }
    });
    $("calcClose").addEventListener("click", function () { $("calcPanel").hidden = true; $("calcFab").setAttribute("aria-expanded", "false"); });
  }

  function calcKey(k) {
    var d = $("calcDisplay");
    if (k === "=") {
      try {
        var v = evalExpr(d.value);
        d.value = String(Number(v.toPrecision(8)));
        $("calcNote").textContent = "Answer " + d.value + (state.focusInput ? " \u2014 inserted into the last field." : "");
        $("calcNote").classList.add("is-ok");
        if (state.focusInput) { state.focusInput.value = d.value; state.focusInput.dispatchEvent(new Event("input")); }
      } catch (e) {
        $("calcNote").textContent = "Could not read that expression.";
        $("calcNote").classList.remove("is-ok");
      }
      return;
    }
    if (k === "C") { d.value = ""; return; }
    if (k === "\u232b") { d.value = d.value.slice(0, -1); return; }
    d.value += k;
    $("calcNote").classList.remove("is-ok");
  }

  /* ---------- presets & teacher ---------- */

  function applyPreset() {
    var h = location.hash.replace(/^#/, "");
    if (!h) { return; }
    var params = {};
    h.split("&").forEach(function (kv) {
      var p = kv.split("=");
      params[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || "");
    });
    if (params.mat && MATERIALS[params.mat]) { state.material = params.mat; }
    var sphereMax = MATERIALS[state.material].diam.length - 1;
    if (params.s !== undefined) { state.sphere = clamp(parseInt(params.s, 10) || 0, 0, sphereMax); }
    if (params.wall === "on") { state.wall = true; }
    if (params.mode === "teacher") { state.teacher = true; }
  }

  function writePreset() {
    var parts = ["mat=" + state.material, "s=" + state.sphere];
    if (state.wall) { parts.push("wall=on"); }
    if (state.teacher) { parts.push("mode=teacher"); }
    var str = "#" + parts.join("&");
    if (history.replaceState) { history.replaceState(null, "", str); }
    $("footPreset").textContent = "preset " + str;
  }

  function setTeacher(on) {
    state.teacher = on;
    $("teacherBadge").hidden = !on;
    updateExpectedSpans(currentExpected());
    writePreset();
    toast(on ? "Teacher mode on" : "Teacher mode off");
  }

  /* ---------- sphere / material ---------- */

  function updateReBadge() {
    var el = $("reBadge");
    if (!el) { return; }
    var r = sphereD() / 2000;
    var v = simVel(r, sphereRho());
    var re = (2 * r * v * RHO_FLUID) / ETA_ACCEPTED;
    var ok = re < 1;
    el.innerHTML = "Re = " + re.toFixed(2) + (ok ? " \u2014 laminar flow, Stokes\u2019 law valid" : " \u2014 flow too fast, Stokes\u2019 law breaks down");
    el.classList.toggle("is-warn", !ok);
  }

  function updateSphereLabel() {
    $("sphereOut").textContent = MATERIALS[state.material].label + " \u00b7 " + LETTERS[state.sphere];
    updateReBadge();
  }

  function selectMaterial(name) {
    state.material = name;
    state.sphere = 0;
    var range = $("sphereRange");
    range.max = String(MATERIALS[name].diam.length - 1);
    range.value = "0";
    state.caliper.gap = 2.2;
    state.trials = [];
    renderTrials();
    updateSphereLabel();
    buildAll();
    updateScene();
    writePreset();
  }

  function selectSphere(i) {
    state.sphere = clamp(i, 0, MATERIALS[state.material].diam.length - 1);
    $("sphereRange").value = String(state.sphere);
    updateSphereLabel();
    state.caliper.gap = 2.2;
    state.trials = [];
    renderTrials();
    clearRun();
    drawCaliper();
    settleBalance(false);
    redrawCharts();
    updateScene();
    resetReports();
    writePreset();
  }

  function buildAll() {
    buildCaliper();
    clearRun();
    settleBalance(false);
    redrawCharts();
    resetReports();
  }

  /* ---------- reset ---------- */

  function clearRun() {
    state.drop = null;
    state.measured = null;
    state.trace = [];
    state.traceT = 0;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  }

  function resetEverything() {
    state.drop = null;
    state.measured = null;
    state.trials = [];
    state.trace = [];
    state.traceT = 0;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    state.caliper.gap = 2.2;
    $("stopwatch").textContent = "0.00";
    $("stopwatch").classList.remove("is-stopped");
    var face = document.querySelector(".stopwatch-face");
    if (face) { face.classList.remove("is-stopped"); }
    resetMarkList();
    $("intervalOut").innerHTML = '<span class="muted">Interval times appear here after four crossings.</span>';
    $("recordBtn").disabled = true;
    setTimingStatus("Ready when you are.", false);
    $("roDistance").textContent = "0.000 m";
    $("roSpeed").textContent = "0.00 cm/s";
    $("roElapsed").textContent = "0.00 s";
    renderTrials();
    drawCaliper();
    resetBalance();
    redrawCharts();
    resetReports();
    updateScene();
    showPage(1);
    toast("Bench reset");
  }

  /* ---------- wiring ---------- */

  function init() {
    initTheme();
    applyPreset();
    buildScene();
    buildReport();
    initCalculator();

    $("materialSelect").value = state.material;
    var range = $("sphereRange");
    range.max = String(MATERIALS[state.material].diam.length - 1);
    range.value = String(state.sphere);
    updateSphereLabel();
    $("studentDate").value = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

    buildCaliper();
    buildBalance();
    renderTrials();
    redrawCharts();
    resetReports();

    if (state.teacher) { setTeacher(true); } else { updateExpectedSpans(currentExpected()); }
    writePreset();

    $("materialSelect").addEventListener("change", function () { selectMaterial(this.value); });
    $("sphereRange").addEventListener("input", function () { selectSphere(parseInt(this.value, 10)); });

    $("wallToggle").checked = state.wall;
    $("wallNote").hidden = !state.wall;
    $("wallToggle").addEventListener("change", function () {
      state.wall = this.checked;
      $("wallNote").hidden = !this.checked;
      writePreset();
      redrawCharts();
      updateReBadge();
      updateStepper();
    });

    document.querySelectorAll(".segmented button").forEach(function (b) {
      b.addEventListener("click", function () {
        document.querySelectorAll(".segmented button").forEach(function (x) { x.classList.remove("is-active"); });
        b.classList.add("is-active");
        state.speed = parseInt(b.dataset.speed, 10);
      });
    });

    $("dropBtn").addEventListener("click", startDrop);
    $("recordBtn").addEventListener("click", recordTrial);
    $("autofillBtn").addEventListener("click", autofill);
    $("autofillBtn2").addEventListener("click", autofill);
    $("markBtn").addEventListener("click", markWork);
    $("markBtn2").addEventListener("click", markWork);
    $("resetBtn").addEventListener("click", resetEverything);
    $("printBtn").addEventListener("click", function () { window.print(); });

    $("csvBtn").addEventListener("click", function () {
      var exp = currentExpected();
      var lines = ["Terminal Velocity Lab \u2014 Stokes' law report"];
      lines.push(["Name", $("studentName").value || "", "Class", $("studentClass").value || "", "Date", $("studentDate").value || ""].map(csvCell).join(","));
      lines.push(["Sphere", MATERIALS[state.material].label + " " + LETTERS[state.sphere], "Wall correction", state.wall ? "on" : "off"].map(csvCell).join(","));
      lines.push("Quantity,Symbol,Value,Unit,Expected");
      ROWS.forEach(function (row) {
        if (!row.id) { return; }
        var v = $("in_" + row.id).value;
        lines.push([row.label, row.sym, v, row.unit, fmt(row.kind, expValue(row.id, exp))].map(csvCell).join(","));
      });
      var blob = new Blob([lines.join("\n")], { type: "text/csv" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "terminal-velocity-report.csv";
      a.click();
      URL.revokeObjectURL(a.href);
    });

    document.querySelectorAll("#toolSurface .tool").forEach(function (tool) {
      tool.addEventListener("click", function (e) {
        if (tool.classList.contains("is-active")) { return; }
        if (e.target.closest("button, a, input, select")) { return; }
        focusTool(tool.dataset.tool);
      });
    });
    document.querySelectorAll("#toolSurface .tool__pick").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var tool = btn.closest(".tool");
        if (tool && !tool.classList.contains("is-active")) { focusTool(tool.dataset.tool); }
      });
    });
    focusTool("caliper");

    document.querySelectorAll("[data-announce]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (btn.dataset.announce === "caliper") {
          var c = caliperReading();
          speak("Vernier caliper. Main scale " + c.main + " millimetres. Vernier division " + c.idx + ". Reading " + c.reading.toFixed(2) + " millimetres.");
        }
      });
    });

    document.querySelectorAll(".stepper__item").forEach(function (a) {
      a.addEventListener("click", function () {
        showPage(Number(a.dataset.step));
        updateStepper();
      });
    });
    if ($("pagePrev")) { $("pagePrev").addEventListener("click", function () { showPage(state.page - 1); }); }
    if ($("pageNext")) { $("pageNext").addEventListener("click", function () { showPage(state.page + 1); }); }
    if ($("panBtn")) { $("panBtn").addEventListener("click", toggleBalance); }
    showPage(state.page);

    document.addEventListener("keydown", function (e) {
      if (e.ctrlKey && e.shiftKey && (e.key === "T" || e.key === "t")) {
        e.preventDefault();
        setTeacher(!state.teacher);
        return;
      }
      if (e.code === "Space" && document.activeElement && document.activeElement.tagName === "INPUT") { return; }
      if (e.code === "Space") {
        e.preventDefault();
        if (!state.drop || state.drop.marks.length >= 4) {
          if (!state.drop) { startDrop(); }
          return;
        }
        recordMark();
      }
    });

    window.addEventListener("hashchange", function () {
      var h = location.hash.replace(/^#/, "");
      if (h.indexOf("=") !== -1) { location.reload(); }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
