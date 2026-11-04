---
name: procedural-airframes
description: Build smooth, organic aircraft or spacecraft in three.js from small tables of numbers — superellipse body sections lofted with Catmull-Rom, wings and fins with curved leading/trailing edges and an airfoil section, mirrored, merged and painted with vertex colours — and check them without a browser. Use when you need an original vehicle model in code (no asset files), when a model must expose cockpit/nozzle/wingtip points to a renderer, or when shapes come out inside-out, faceted or blocking the cockpit view.
---

# Procedural airframes / 数表から機体を組む

数表（断面と翼の前縁・後縁）から、滑らかな機体をコードで組む。ファイル不要・three.js だけ。

Reference implementation: `src/aircraft/kit.js` and the three models in `src/aircraft/`.

## 1. Axes and units

Nose +Z, up +Y, left wing +X, metres. Keep real sizes (a fighter is 13–18 m): cameras, smoke, wingtip vortices and lighting all assume them.

## 2. Body: `loft(stations, M, sub)`

Each station is a superellipse cross-section `{ z, w, top, bot, n, cy, cx }`:
- `w` half width, `top`/`bot` heights above/below the centre `cy`, `n` = 2 ellipse, 2.3–3 fuller/boxier.
- Stations are interpolated with Catmull-Rom (`sub` steps per gap) — 10–18 stations give G1-smooth bodies.
- Start and end with a near-zero section for pointed ends.
- Bodies made from several lofts (pod + canopy + intake pods + a gun barrel) overlap; that is fine — no booleans needed.

## 3. Wings and fins: `foil(stations, { axis, chord, sub })`

Each station is `{ le: [x,y,z], te: [x,y,z], t }` from root to tip; `axis` is the thickness direction (wings `[0,1,0]`, fins `[1,0,0]`, canted fins tilted). Edges are Catmull-Rom curves, so a few stations make crescents, sickles and swept blades. The section is NACA-like with cosine spacing; a tip with ~zero chord makes a pointed tip. `surface()` is the straight-edged special case for conventional wings.

Put the root station a little inside the body so there is no gap.

## 4. Faces point out

Compute the signed volume and flip the winding if it is negative (`orientOutward`). Then the order you list stations in (nose→tail or tail→nose) never matters, and `mirrorX` (scale -1 + swap winding) stays correct.

## 5. Paint with vertex colours

`paint(geo, (P, N) => [r,g,b])` after merging: two-tone waterlines (`smooth` on `P.y + k*N.y`), dark tips by span, pinstripes by distance to a line, bands by `P.z`. Stripes need enough vertices across them — raise `sub`/`chord` where a stripe looks jagged, and fade the stripe with `smooth` instead of a hard threshold. Shader-painted materials (camouflage) should carry `userData.previewColor` for offline previews.

## 6. What the renderer needs

Return one interface for every model (`assemble`): `root, body, canopy, pilot, cockpit, seat, nozzles[], nozzleR, tips[2], stabTips[2], eye, wingVapor, length, setPOV(on, back), setGlow(throttle)`.
- `eye` drives the cockpit camera and places the pilot and the instrument coaming (`makePilot`, `makeCockpit`).
- `nozzles` place afterburners and lights; `tips` emit wingtip vortices; `wingVapor` is the area where the high-G vapour sheet appears.

## 7. Cockpit view check

Put the eye well above the top of the nose in front of it (≥ 0.15–0.3 m) and slightly forward under the canopy's highest point; otherwise the nose hump fills the lower half of the first-person view. Raise the canopy with the eye so the helmet does not poke through.

## 8. Check without a browser

`tools/preview.mjs` builds each model in node, rasterises it (z-buffer, Lambert + specular, vertex colours, translucent glass) from top / side / front / 3-4 and writes a PNG; it also prints length, span, height, triangle count, non-finite vertices and the body's signed volume. Look at the four views before putting a model in a scene.

## Pitfalls

- Inside-out lofts (black or missing in the render) → always orient by signed volume.
- Thin features vanish at distance: a gun barrel or bill under ~0.12 m radius reads as a hairline from 30 m.
- Different models have different lengths; scale effects (vapour cone, afterburner radius) from `length` and `nozzleR`, not from one model's numbers.
- Do not trace an existing copyrighted design. Start from a concept and your own proportions (or your own earlier models).
