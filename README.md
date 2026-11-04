# missile-swarm-kit

追尾ミサイルの群れの軌道計算と、有機的な機体をコードで組むための道具。three.js 向け、依存なしの ES モジュール。

Swarm choreography for curving homing missiles, plus a small kit for building organic aircraft from tables of numbers. Plain ES modules for three.js.

- 母ミサイルが割れて数十本に。扇に開く・回り込む・ぐにゃぐにゃ巻く・まっすぐ突っ込む弾が混ざり、狙った機体の 9〜18m 脇を紙一重ですり抜け、1 本ずつ爆発する
- 段数（1〜4）と軌道の割合（直進／扇→直進／回り込み／ぐにゃぐにゃ）と本数を選べる
- 全部を先に固定の刻み（120Hz）で解いて配列に入れる。どの時刻にも飛べて、同じ乱数なら何度でも同じ結果（node でもブラウザでも動く）
- 機体：断面を並べて張る胴（`loft`）、前縁・後縁が曲がった翼とひれ（`foil`）、左右反転・結合・塗り分け。デルフィナス・F-22・F-16・Su-37・MiG-29・F-2A の 6 機を収録

**Demo: https://missile-swarm.pages.dev/** — pick the aircraft, the number of stages and the trajectory mix; the swarm is re-solved on the spot.

デモ：機体・段数・軌道の割合を選ぶと、その場で計算し直して飛ばします。

## 使い方 / Usage

```js
import { simulateFlight, valleyEscapeProgram, jetState } from './src/flight.js';
import { simulateSwarm, missileState } from './src/missiles.js';
import { sphereWorld } from './src/world.js';

const world = sphereWorld({ radius: 60000 });           // 60 km の小さな星。heightAt(x, z) を渡せば地形も
const jet = simulateFlight({ program: valleyEscapeProgram(), duration: 56, world });
const swarm = simulateSwarm({
  target: jet, world,
  count: 50,                                             // 1 波の本数
  stages: 3,                                             // 母ミサイル → 5 本 → 50 本
  mix: { C: 20, E: 20, S: 40, W: 20 },                   // 直進・扇→直進・回り込み・ぐにゃぐにゃ（重みは自由）
  seed: 1234,
});

// 描く時は時刻で引くだけ
const t = 12.5;
const j = jetState(jet, t);                              // { p, q, v, speed, g, thr, ... }
for (const m of swarm.missiles) {
  const s = missileState(m, t);                          // { p, d } か null（飛んでいない）
}
// swarm.explosions: { t, pos, type: 'split' | 'overshoot' | 'fuel' | 'ground' | 'collide', size }
// swarm.passes:     { t, id, dist }  戦闘機とのすれ違い（160m 以内の最接近）
```

機体（three.js）:

```js
import { AIRCRAFT, buildAircraft } from './src/aircraft/index.js';
const craft = buildAircraft('f22', envMap);             // 'delphinus' | 'f22' | 'f16' | 'su37' | 'mig29' | 'f2a'
scene.add(craft.root);
craft.setGlow(throttle);                                 // ノズルの光
// craft.eye（操縦席の目）、craft.nozzles、craft.tips（翼端）、craft.wingVapor（翼の上の雲の範囲）
// craft.panoramic … true なら全周表示の操縦席。craft.setPOV(true) で機体ごと隠れる（デルフィナス）
```

最小の動く例は `examples/minimal.html`（ローカルの http サーバーで開く）。

## 段数と軌道 / Stages and styles

| 段数 | 分かれ方 |
|---|---|
| 1 | 発射点から全部を一度に撃つ |
| 2 | 母ミサイル 1 本 → 手前 1150m で count 本 |
| 3 | 母 → 2300m で 5 本 → 1150m で count 本 |
| 4 | 母 → 2700m で 3 本 → 1900m で 9 本 → 1150m で count 本 |

| 記号 | 軌道 | 中身 |
|---|---|---|
| C | 直進 | 狭く開いて、まっすぐ狙う |
| E | 扇 → 直進 | 40〜110° に大きく開いて 1〜5 秒そのまま飛び、別々の向きから一直線に |
| S | 回り込み | 狙いの線のまわりを巻く（スワール）。時間と距離で締まる（A/B/D の 3 つの癖を順に） |
| W | ぐにゃぐにゃ | 巻く速さと大きさが揺れ続け、締まり切らない |

当たらない仕組み：狙いは機体そのものから 9〜18m ずらした点。0.7 秒先までの最接近が 13m を切りそうなら横へそれる（回り込みの弾は並走中も）。それでも 9m 以内に入ったら押し出す（`stats.grazes` で数える。0 が目標）。

振り付け（任意）：`script.tail`（1 本が尾に張り付いて振り切られる）、`script.finale`（生き残りが遠い順に 0.16 秒おきに自爆）。

## 確認 / Checks

```bash
node tools/preview.mjs out.png                 # 全機を上・横・正面・斜めから描いて PNG に（ブラウザ不要）
node tools/regress_film.mjs <元の計算のフォルダ>  # 元の映像の計算と完全一致するか（作者の環境用）
```

## スキル / Skills

`skills/` に、AI エージェント（Claude Code など）がこの技法を使うための手順書を 2 本入れています。

- `homing-missile-swarm` … 群れの軌道：段数、軌道の混ぜ方、紙一重、旋回、確かめ方
- `procedural-airframes` … 数表から有機的な機体を組む：断面、曲がった翼、面の向き、目の位置、ブラウザなしの確認

## 機体について / About the aircraft

- **DELPHINUS** … イルカのような有機流線型の機体。作者自身の DELPHINUS D-02 の寸法をもとに、機首を伸ばし、翼とひれを後ろへ流した
- **F-22A / F-16C / Su-37 / MiG-29 / F-2A** … 実在の戦闘機を、公開されている外形（寸法・翼と尾翼の配置）をもとに手で組んだもの。Su-37 と MiG-29 は 1 つの組み立て関数（`flankers.js`）から寸法を変えて作る

## License

MIT © 2026 studio veco
