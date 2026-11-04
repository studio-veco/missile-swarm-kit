// 後段：HDR で描く → （書き出し時は 1 コマを数回描いて平均＝動きのブレ）→ 光のにじみ → 色・粒・閃光・HUD を重ねる
import * as THREE from '../vendor/three.module.js';

const FS_VERT = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export function makePost(renderer, W, H) {
  const rt = (w, h, opt = {}) => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, ...opt });
  const scene = rt(W, H, { depthBuffer: true, samples: 4 });
  const accum = rt(W, H);
  const mips = [];
  let w = W >> 1, h = H >> 1;
  for (let i = 0; i < 7 && w > 8 && h > 8; i++) { mips.push(rt(w, h, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter })); w >>= 1; h >>= 1; }

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  const qs = new THREE.Scene(); qs.add(quad);
  const qc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const pass = (mat, target, clear = true) => {
    quad.material = mat;
    renderer.setRenderTarget(target);
    const ac = renderer.autoClear; renderer.autoClear = clear;
    renderer.render(qs, qc);
    renderer.autoClear = ac;
  };

  const copyMat = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null }, uW: { value: 1 } }, vertexShader: FS_VERT, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, transparent: true,
    fragmentShader: /* glsl */`uniform sampler2D tSrc; uniform float uW; varying vec2 vUv; void main(){ vec3 c = texture2D(tSrc, vUv).rgb; if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0); gl_FragColor = vec4(min(c, vec3(3.0e4))*uW, 1.0); }`,
  });
  // 13 タップの縮小（最初だけ明るい所を抜き出す）
  const downMat = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uFirst: { value: 0 }, uThresh: { value: 1.0 } },
    vertexShader: FS_VERT, depthTest: false, depthWrite: false,
    fragmentShader: /* glsl */`
      uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uFirst, uThresh; varying vec2 vUv;
      vec3 S(vec2 o){ return texture2D(tSrc, vUv + o*uTexel).rgb; }
      vec3 pick(vec3 c){ float l = max(c.r, max(c.g, c.b)); float k = clamp(l - uThresh + 0.6, 0.0, 1.2); k = k*k/(4.0*0.6 + 1e-4); return c*max(k, l - uThresh)/max(l, 1e-4); }
      void main(){
        vec3 a = S(vec2(-2,-2)), b = S(vec2(0,-2)), c = S(vec2(2,-2)), d = S(vec2(-1,-1)), e = S(vec2(1,-1)), f = S(vec2(-2,0)), g = S(vec2(0,0)), h = S(vec2(2,0)), i = S(vec2(-1,1)), j = S(vec2(1,1)), k = S(vec2(-2,2)), l = S(vec2(0,2)), m = S(vec2(2,2));
        vec3 o = (d+e+i+j)*0.125 + (a+b+f+g)*0.03125 + (b+c+g+h)*0.03125 + (f+g+k+l)*0.03125 + (g+h+l+m)*0.03125;
        if (uFirst > 0.5) o = pick(min(o, vec3(60.0)));
        gl_FragColor = vec4(o, 1.0);
      }`,
  });
  const upMat = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uR: { value: 1 } },
    vertexShader: FS_VERT, depthTest: false, depthWrite: false, transparent: true,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    fragmentShader: /* glsl */`
      uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uR; varying vec2 vUv;
      vec3 S(vec2 o){ return texture2D(tSrc, vUv + o*uTexel*uR).rgb; }
      void main(){
        vec3 o = S(vec2(0))*4.0 + (S(vec2(-1,0))+S(vec2(1,0))+S(vec2(0,-1))+S(vec2(0,1)))*2.0 + S(vec2(-1,-1))+S(vec2(1,-1))+S(vec2(-1,1))+S(vec2(1,1));
        gl_FragColor = vec4(o/16.0, 1.0);
      }`,
  });

  const finalMat = new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: null }, tBloom: { value: null }, tHud: { value: null },
      uExposure: { value: 1.0 }, uBloom: { value: 0.09 }, uCA: { value: 0.0025 }, uVig: { value: 0.35 }, uGrain: { value: 0.045 },
      uTime: { value: 0 }, uFlash: { value: 0 }, uInvert: { value: 0 }, uMono: { value: 0 }, uLetter: { value: 0 },
      uTint: { value: new THREE.Vector3(1, 1, 1) }, uLift: { value: new THREE.Vector3(0.0, 0.004, 0.012) }, uSat: { value: 1.0 },
      uAspect: { value: W / H }, uHudOn: { value: 1 }, uBlack: { value: 0 },
    },
    vertexShader: FS_VERT, depthTest: false, depthWrite: false,
    fragmentShader: /* glsl */`
      uniform sampler2D tScene, tBloom, tHud;
      uniform float uExposure, uBloom, uCA, uVig, uGrain, uTime, uFlash, uInvert, uMono, uLetter, uAspect, uHudOn, uSat, uBlack;
      uniform vec3 uTint, uLift;
      varying vec2 vUv;
      vec3 aces(vec3 x){ const float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0); }
      float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y)*p3.z); }
      vec3 toSRGB(vec3 c){ return mix(c*12.92, 1.055*pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
      void main(){
        vec2 uv = vUv;
        vec2 cc = uv - 0.5;
        float r2 = dot(cc*vec2(uAspect, 1.0), cc*vec2(uAspect, 1.0));
        // 色ずれ（周辺ほど）
        vec2 ca = cc*uCA*(0.5 + r2*2.0);
        vec3 col;
        col.r = texture2D(tScene, uv - ca).r;
        col.g = texture2D(tScene, uv).g;
        col.b = texture2D(tScene, uv + ca).b;
        vec3 bl = texture2D(tBloom, uv).rgb;
        col += bl*uBloom;
        col *= uExposure*uTint;
        // ミサイルの目（赤外線ふう）
        if (uMono > 0.0) {
          float l = dot(col, vec3(0.3, 0.55, 0.15));
          // 白が熱い：ふつうに照らされた面は暗い灰、噴射と爆発だけ白く抜ける
          float v = 0.05 + 0.22*l/(1.0 + l) + 1.1*smoothstep(1.3, 4.5, l);
          vec3 ir = vec3(v*0.92, v, v*0.95);
          col = mix(col, ir, uMono);
        }
        col = aces(col);
        col = col + uLift*(1.0 - col);
        float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(vec3(lum), col, uSat);
        // 周辺減光
        col *= 1.0 - uVig*smoothstep(0.15, 1.1, r2);
        col = toSRGB(col);
        // 粒
        float g = h12(gl_FragCoord.xy + fract(uTime*7.13)*1000.0) - 0.5;
        col += g*uGrain*(1.0 - lum*0.6);
        if (uMono > 0.0) col += (h12(vec2(floor(gl_FragCoord.y*0.5), floor(uTime*60.0))) - 0.5)*0.05*uMono + 0.03*sin(gl_FragCoord.y*1.7)*uMono;
        // 閃光と反転のコマ
        col = mix(col, vec3(1.0), uFlash);
        col = mix(col, 1.0 - col, uInvert);
        col = mix(col, vec3(0.0), uBlack);
        // HUD・字幕
        if (uHudOn > 0.5) { vec4 hd = texture2D(tHud, uv); col = col*(1.0 - hd.a) + hd.rgb; }
        // 上下の黒帯
        float lb = uLetter*0.5;
        if (uv.y < lb || uv.y > 1.0 - lb) col = vec3(0.0);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });

  return {
    scene, accum, finalMat,
    // シーンを描く（render 関数を渡す）→ 平均へ足す
    beginAccum() { renderer.setRenderTarget(accum); renderer.setClearColor(0x000000, 1); renderer.clear(); },
    renderSub(drawScene, weight) {
      renderer.setRenderTarget(scene);
      renderer.setClearColor(0x000000, 1);
      renderer.clear();
      drawScene(scene);
      copyMat.uniforms.tSrc.value = scene.texture; copyMat.uniforms.uW.value = weight;
      pass(copyMat, accum, false);
    },
    finish(hudTex, P) {
      // 光のにじみ
      let src = accum.texture, sw = W, sh = H;
      for (let i = 0; i < mips.length; i++) {
        downMat.uniforms.tSrc.value = src; downMat.uniforms.uTexel.value.set(1 / sw, 1 / sh); downMat.uniforms.uFirst.value = i === 0 ? 1 : 0;
        downMat.uniforms.uThresh.value = P.thresh ?? 1.0;
        pass(downMat, mips[i]);
        src = mips[i].texture; sw = mips[i].width; sh = mips[i].height;
      }
      for (let i = mips.length - 1; i > 0; i--) {
        upMat.uniforms.tSrc.value = mips[i].texture; upMat.uniforms.uTexel.value.set(1 / mips[i].width, 1 / mips[i].height);
        pass(upMat, mips[i - 1], false);
      }
      const u = finalMat.uniforms;
      u.tScene.value = accum.texture; u.tBloom.value = mips[0].texture; u.tHud.value = hudTex;
      for (const k of ['uExposure', 'uBloom', 'uCA', 'uVig', 'uGrain', 'uTime', 'uFlash', 'uInvert', 'uMono', 'uLetter', 'uSat', 'uBlack', 'uHudOn']) if (P[k] !== undefined) u[k].value = P[k];
      if (P.uTint) u.uTint.value.set(...P.uTint);
      if (P.uLift) u.uLift.value.set(...P.uLift);
      pass(finalMat, null);
    },
  };
}
