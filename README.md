# Terminal Velocity Lab

A hands-on physics practical for the classroom. Students measure a sphere, work out
its density, time it falling through glycerine, and use Stokes' law to determine the
viscosity of the liquid. Everything runs in the browser with no build step and no
dependencies.

## What's inside

| File | Purpose |
| --- | --- |
| `index.html` | The lab: clipboard brief, the bench with tools, the notebook |
| `styles.css` | Bench, clipboard, tool and notebook styling; light and dark themes |
| `app.js` | Physics engine, instruments, timing, checks, tool picking, charts |
| `fonts/` | Self-hosted Atkinson Hyperlegible + Patrick Hand (works offline) |
| `favicon.svg` | Site icon |

## How it is laid out

- **Clipboard** — the experiment brief (aim, theory, apparatus, method).
- **Bench** — the measuring cylinder in its retort stand, plus the tools laid out on
  the surface. **Click a tool to pick it up**; it enlarges in place while the others
  tuck into a row. Clicking a notebook reading (e.g. "Diameter by vernier caliper")
  picks up the matching tool for you.
- **Notebook** — a graph-paper lab book with **one page per section** (Measuring the
  sphere, Mass and density, Timing the fall, Viscosity) plus a **Graphs** page. Pages
  are switched with the ribbon tabs or the Previous/Next controls. Every reading, the
  working and the trial table go on the pages; entries are typed in a handwriting face
  and the verdict is marked as a red-pen comment.
- **Live graphs** on the Graphs page: Fig. 1 plots the sphere's actual fall in real
  time and overlays the four crossing points and a best-fit line; Fig. 3 grows a bar as
  each interval is timed; Fig. 2 gains a measured terminal-velocity reference line.
- **Balance** — the sphere starts off the pan. Click the pan (or the button) to put it
  on and read its mass; changing sphere keeps it on the pan and re-settles the reading.
- **Stopwatch** — runs while the sphere falls and stops itself once the sphere reaches
  the bottom of the cylinder.

## Run it locally

Open `index.html` directly, or serve the folder:

```
python -m http.server 8000
```

Then visit `http://localhost:8000`.

## Publish to GitHub Pages

1. Create a new repository on GitHub and push this folder's contents to it.
   The three site files must sit at the repository root (or in a `/docs` folder).
2. On GitHub, open **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a branch**.
4. Pick the `main` branch and the `/ (root)` folder, then **Save**.
5. Wait a minute; your lab will be live at
   `https://<your-username>.github.io/<repo-name>/`.

There is no build step, so any push updates the site.

## Teaching notes

- **Sphere shown enlarged.** The ball is drawn bigger than scale so you can see it;
  the readings come from the instruments.
- **Tube-wall correction.** Switch it on in the bench controls to show a systematic
  error: a real tube slows the sphere, so the measured viscosity runs high until the
  Ladenburg correction is applied. This is the difference between random and
  systematic error.
- **Teacher mode.** Add `#mode=teacher` to the URL, or press `Ctrl+Shift+T`, to reveal
  the expected value beside every entry and add name/class fields to the report.
- **Presets.** The URL hash stores the setup, e.g. `#mat=glass&s=2&wall=on`, so you
  can share a specific experiment.
- **Marking.** Students enter their own readings and press **Mark work**; the app marks
  each cell and explains the common mistakes (unit slips, misread vernier divisions,
  diameter used instead of radius, arithmetic).

## Physics used

Terminal velocity from the force balance:

```
(4/3)πr³ρs g = (4/3)πr³ρf g + 6πηrv      →      v = 2r²g(ρs − ρf) / 9η
```

with glycerine at 20 °C: ρf = 1260 kg/m³, η = 1.41 Pa·s, and g = 9.81 m/s².
The tube-wall correction is v_corrected = v_measured (1 + 2.4 r / R), R = 40 mm.
