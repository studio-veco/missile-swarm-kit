---
name: homing-missile-swarm
description: Choreograph a swarm of curving homing missiles that split from pods, fan out, swirl, wobble or run straight in, skim past a manoeuvring target by a hair and explode one by one — deterministic, solved ahead of time so any moment can be scrubbed. Use when building missile swarms for a flight/space game or a motion piece, when tuning how "threatening" missiles look, when mixing trajectory styles or adding multi-stage (MIRV) splits, or when missiles look like they are just flying around instead of hunting.
---

# Homing missile swarm / 追尾ミサイルの群れ

割れて広がり、弧を描き、紙一重ですり抜けて爆発する追尾ミサイルの群れ。先に全部解いて、時刻で引く。

Reference implementation: `src/missiles.js` (`simulateSwarm`, `steer`, `swirlDir`, `missileState`).

## 1. Solve first, draw later

Integrate everything at a fixed step (120 Hz) up front and store each missile's path (`hist`), birth/death step, death type, and all explosions and close passes. The renderer only looks things up by time.

- Any frame can be drawn in any order (scrubbing, slow motion, multiple sub-frames for motion blur, offline rendering).
- Same seed → same swarm on every machine. Use your own PRNG (mulberry32), never `Math.random`.
- Keep the call order of the PRNG stable. A regression test that compares a new solver against the old one bit-for-bit catches accidental changes (`tools/regress_film.mjs`).
- Float differences between node and browsers exist in the last digits of trig functions; if a camera script depends on a specific missile, either bake the solve once and ship it, or pick the missile from the results at runtime (better: see §7).

## 2. Stages (MIRV)

A pod flies fast and straight (proportional lead, 820 m/s), then splits. More stages = branching fireworks.

| stages | split plan |
|---|---|
| 1 | the whole wave leaves the launcher at once (add a launch flash) |
| 2 | pod → `count` at 1150 m |
| 3 | pod → 5 sub-pods at 2300 m → `count` at 1150 m |
| 4 | pod → 3 at 2700 m → 9 at 1900 m → `count` at 1150 m |

Always add a time-out split (`m.t > 4..9 s`) so a pod never flies forever. Sub-pods fan out 14–30° around the line of sight and keep homing. Give each final pod an interleaved share of the wave's slots (`k % pods`) so every pod releases a mix of styles.

## 3. Trajectory styles — mix them

All-arcs saturates the screen and nothing ever arrives; all-straight is boring. Mix by weight:

- **C straight**: narrow 4–22° fan, aims directly.
- **E fan-out then straight**: opens 40–110°, keeps that heading for 1–5 s (`fan`), then turns and runs straight in — attacks arrive staggered from many directions. Level off if it opened downward.
- **S swirl** (the classic look): desired = `toT * (fwd0 + (1-fwd0)*conv) + swirl * amp * (1 - conv*keep)`, where `swirl` rotates around the line of sight at `curl` rad/s and `conv` rises with time since the last pass and when close. Use 3 flavours (fast/tight, slow/wide, high/wide).
- **W wobble**: curl speed and radius keep changing (sum of sines), convergence capped at ~0.6 — never fully settles. Around 1/5 of the swarm reads as "chaotic" without becoming noise.

The perpendicular basis for the swirl must not degenerate: cross the line of sight with the axis of its smallest component.

## 4. Turning (the bug that makes missiles look harmless)

Rotate the velocity toward the desired direction with an angular-rate limit `a / speed` (lateral acceleration `a`), then set the speed. Do **not** add `(desired*speed - v)` scaled by an acceleration: when the aim is behind (> 120°) that barely turns, and missiles that overshoot fly straight away for seconds — "they're just flying around".

## 5. Lethal but never a hit

- Aim at the target itself plus a small offset (9–18 m) perpendicular to the line of sight that grows only within ~650 m. Every missile commits; every missile misses by a hair.
- Lead: aim `min(dist/speed, 0.6 s)` ahead. Far away, aim at where the target *was* (`-tail * v`) so missiles ride its tail through turns.
- Sidestep: predict the closest approach within 0.7 s using relative velocity; if it is under 13 m, add a strong sideways component. Swirlers can come alongside with almost no closing speed — apply the sidestep to them even when not closing (1.6× radius).
- Safety net: if a missile still ends up inside 9 m, push it out to 9 m and count it (`stats.grazes`). Tune until it is 0 for every configuration you ship.
- Count passes (local minima of distance under 160 m). After `maxPasses` passes, schedule a self-destruct a little later ("overshoot"). Nobody dies before a hold time (`firstDeath`), so the swarm is complete when the camera first shows it.
- Make the aircraft *look* like it dodges: right before each pass under 22 m, offset the drawn aircraft up to 4 m away and roll it, then return. The solved path is untouched.

## 6. Ground and terrain

- Heavy missiles (all straight ones + ~45% of the rest) turn sluggishly in a low dive and plough into the ground — great impacts.
- Light missiles look 0.4 and 0.9 s ahead and pull up early; they never aim below ~30 m above terrain.
- Missile–missile collisions: swept segment distance < 3.2 m, but not within 90 m of the target (keeps the hero shot readable).

## 7. Choreography that survives any settings

- `tail`: at a set time, the nearest **agile** missile glues itself a few metres behind the target, then gets shaken off. Choose agile ones — sluggish ones overshoot and ram.
- `finale`: survivors self-destruct far to near, 0.16 s apart; the last one is the closest.
- Camera scripts must pick their missiles from the results, never by hard-coded id: "alive through the whole shot and passing closest in the window", "nose on the target most of the time", "last to die". Time the shot so the chosen missile's death lands at the shot's end; otherwise the camera sits inside the fireball.

## 8. Checks (numbers before pictures)

For every stage count × several mixes, print: passes, passes under 15 m, minimum distance, grazes (must be 0), alive at the hold time, last death time, the tail missile id, death types. Only then render frames.

## Pitfalls

- Fan-out missiles that opened downward dive into the ground before turning → level them off during the fan.
- A stage-1 launch spawned before the step's update gets processed in the same step → its path is one sample ahead. Record the first point in the update, like a pod.
- Hard-coded split times in camera scripts break as soon as the stage count changes.
