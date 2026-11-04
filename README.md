# MISSILE SWARM / missile-swarm-kit

追尾ミサイルの群れを、戦闘機が操縦だけで振り切るブラウザの映像と、その中身（群れの軌道計算・機体をコードで組む道具）一式。
このリポジトリをそのまま静的サイトとして置けば、デモと同じものが公開できます。

A browser piece where a fighter dodges a homing missile swarm, and everything behind it: the swarm solver and a kit for building aircraft from tables of numbers. The repository root **is** the site — host it as-is and you get the same thing as the demo.

**Demo: https://missile-swarm.pages.dev/**

- 機体を選ぶ：デルフィナス・F-22・F-16・Su-37・MiG-29・F-2A（操縦席の照準器とレーダーは機種ごとに別物）
- ミサイルを選ぶ：段数（1〜4）・軌道の割合（直進／扇→直進／回り込み／ぐにゃぐにゃ）・本数・乱数。押すとその場で計算し直す
- 見せ方：88 秒のカット割りの「映像」と、指で回す「自由視点」（機体・操縦席・ミサイルのカメラ）
- 設定は URL に入るので、そのまま共有できる

## そのまま公開する / Publish as-is

ビルドは要りません。リポジトリの一番上がサイトです（`index.html` から相対パスで読むだけ）。

- **Cloudflare Pages**（Git 連携）：このリポジトリをつなぐ → Build command は空、Build output directory は `/`。`_headers` でキャッシュも設定済み
- **Cloudflare Pages**（手元から）：`npm run build` → `npx wrangler pages deploy dist --project-name <name>`
- **GitHub Pages**：Settings → Pages → Deploy from a branch → `main` / `/(root)`
- **ほかの静的ホスティング**（Netlify・Vercel・S3 など）：リポジトリの中身をそのまま置く

## 手元で動かす / Run locally

```bash
npm install          # 確認用の道具（three・playwright-core）だけ。サイト自体は依存なし
npm start            # http://127.0.0.1:8177 で配る（ES モジュールは file:// では開けない）
```

`python3 -m http.server` など、どの静的サーバーでも動きます。

## 中身 / Layout

| 場所 | 中身 |
|---|---|
| `index.html` | 画面（設定パネル・再生バー・CSS） |
| `app/` | サイトのコード：カット割り（`director.js`）、地形と星（`world.js`・`terrain.js`）、煙（`smoke.js`）、爆発と噴射（`fx.js`）、光のにじみ（`post.js`）、HUD（`hud.js`）、機種ごとの操縦席の表示とレーダー（`cockpit_hud.js`）、音（`audio.js`）、まとめ役（`main.js`） |
| `src/` | キット：群れの軌道計算（`missiles.js`）、操縦表で飛ぶ戦闘機（`flight.js`）、星と地形の窓口（`world.js`）、機体（`aircraft/`） |
| `vendor/` | three.js r170（MIT） |
| `data/` | 音楽（自作の合成曲）と機体のサムネイル |
| `skills/` | AI エージェント向けの手順書 2 本 |
| `examples/minimal.html` | キットだけを使った最小の例 |
| `tools/` | 確認用：静的サーバー、1 コマずつの書き出し、画面の操作、機体の確認画像 |

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
node tools/preview.mjs out.png                        # 全機を上・横・正面・斜めから描いて PNG に（ブラウザ不要）
node tools/shot.mjs out/a.jpg "t=12" "free=30&cam=cockpit"   # サイトを 1 コマずつ書き出す（Chrome と ffmpeg が要る）
CFG='{"craft":"su37","stages":3}' node tools/shot.mjs out/b.jpg "t=38"
node tools/ui.mjs out/ui                              # 再生・設定の変更・自由視点まで操作して画面を撮る
node tools/regress_film.mjs <元の計算のフォルダ>         # 元の映像の計算と完全一致するか（作者の環境用）
```

Chrome の場所は `CHROME=/path/to/chrome` で変えられます。

## スキル / Skills

`skills/` に、AI エージェント（Claude Code など）がこの技法を使うための手順書を 2 本入れています。

- `homing-missile-swarm` … 群れの軌道：段数、軌道の混ぜ方、紙一重、旋回、確かめ方
- `procedural-airframes` … 数表から有機的な機体を組む：断面、曲がった翼、面の向き、目の位置、ブラウザなしの確認

## 機体について / About the aircraft

- **DELPHINUS** … イルカのような有機流線型の機体。作者自身の DELPHINUS D-02 の寸法をもとに、機首を伸ばし、翼とひれを後ろへ流した
- **F-22A / F-16C / Su-37 / MiG-29 / F-2A** … 実在の戦闘機を、公開されている外形（寸法・翼と尾翼の配置）をもとに手で組んだもの。Su-37 と MiG-29 は 1 つの組み立て関数（`flankers.js`）から寸法を変えて作る

## License

MIT © 2026 studio veco — コード・音楽（`data/music.m4a`、自作の合成曲）・画像を含むこのリポジトリのすべて。

同梱・読み込みしているもの：three.js r170（MIT、`vendor/three.module.js` に著作権表示あり）、Google Fonts の Noto Serif JP・Zen Kaku Gothic New・JetBrains Mono（SIL Open Font License、CDN から読み込み）。
