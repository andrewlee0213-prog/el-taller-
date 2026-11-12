
/* Local bloom pipeline: scene-linear render, bounded blur targets, one final display transform. */
(function (root, factory) {
  'use strict'; const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StudioPostFX = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function create(THREE, renderer, options) {
    options = options || {};
    const floating = renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float');
    const type = floating ? THREE.HalfFloatType : THREE.UnsignedByteType;
    const target = () => new THREE.WebGLRenderTarget(1, 1, { type, depthBuffer:false, stencilBuffer:false, minFilter:THREE.LinearFilter, magFilter:THREE.LinearFilter });
    const base = target(); base.depthBuffer = true;
    const bright = target(), ping = target(), soft = target(), broad = target();
    const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geometry = new THREE.PlaneGeometry(2, 2);
    const vertexShader = 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}';
    function material(fragmentShader, uniforms) { return new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms,
      depthTest:false, depthWrite:false, toneMapped:false }); }
    const threshold = material('precision highp float; varying vec2 vUv; uniform sampler2D uImage; void main(){vec3 c=texture2D(uImage,vUv).rgb;float b=max(c.r,max(c.g,c.b));float w=smoothstep(.42,1.2,b);gl_FragColor=vec4(c*w,1.0);}', { uImage:{ value:null } });
    const blur = material('precision highp float; varying vec2 vUv; uniform sampler2D uImage; uniform vec2 uStep; void main(){vec3 c=texture2D(uImage,vUv).rgb*.227027; c+=(texture2D(uImage,vUv+uStep*1.384615).rgb+texture2D(uImage,vUv-uStep*1.384615).rgb)*.316216; c+=(texture2D(uImage,vUv+uStep*3.230769).rgb+texture2D(uImage,vUv-uStep*3.230769).rgb)*.070270;gl_FragColor=vec4(c,1.0);}', { uImage:{value:null}, uStep:{value:new THREE.Vector2()} });
    const composite = material(`precision highp float;
      varying vec2 vUv; uniform sampler2D uBase; uniform sampler2D uSoft; uniform sampler2D uBroad;
      uniform float uBloom; uniform float uExposure; uniform float uTransparent;
      vec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.0,1.0);}
      vec3 displayColor(vec3 x){return mix(12.92*x,1.055*pow(max(x,vec3(0.0)),vec3(1.0/2.4))-.055,step(vec3(.0031308),x));}
      void main(){vec3 c=texture2D(uBase,vUv).rgb;vec3 glow=texture2D(uSoft,vUv).rgb*.74+texture2D(uBroad,vUv).rgb*.26;
      c=displayColor(aces((c+glow*uBloom)*uExposure));float vignette=1.0-.32*smoothstep(.28,.78,length((vUv-.5)*vec2(1.0,.85)));
      vec3 color=c*vignette;float alpha=mix(1.0,max(color.r,max(color.g,color.b)),uTransparent);
      gl_FragColor=vec4(color,alpha);}`, { uBase:{value:base.texture}, uSoft:{value:soft.texture}, uBroad:{value:broad.texture},
        uBloom:{value:options.quality === 'low' ? .24 : .42}, uExposure:{value:.95}, uTransparent:{value:options.transparent ? 1 : 0} });
    // The canvas uses premultiplied alpha; emitting display RGB directly preserves the additive glow.
    composite.blending = THREE.NoBlending;
    const quad = new THREE.Mesh(geometry, composite); quad.frustumCulled = false; scene.add(quad);
    let width = 0, height = 0, disposed = false;
    function resize(w, h) {
      if (w === width && h === height || disposed) return;
      width = Math.max(1, Math.round(w)); height = Math.max(1, Math.round(h)); base.setSize(width, height);
      const ratio = options.quality === 'low' ? .25 : .5;
      const bw = Math.max(1, Math.round(width * ratio)), bh = Math.max(1, Math.round(height * ratio));
      bright.setSize(bw, bh); ping.setSize(bw, bh); soft.setSize(bw, bh); broad.setSize(Math.max(1, bw >> 1), Math.max(1, bh >> 1));
    }
    function pass(mat, output) { quad.material = mat; renderer.setRenderTarget(output); renderer.clear(); renderer.render(scene, camera); }
    function render(world, view) {
      if (disposed) return;
      renderer.setRenderTarget(base); renderer.clear(); renderer.render(world, view);
      threshold.uniforms.uImage.value = base.texture; pass(threshold, bright);
      blur.uniforms.uImage.value = bright.texture; blur.uniforms.uStep.value.set(1 / bright.width, 0); pass(blur, ping);
      blur.uniforms.uImage.value = ping.texture; blur.uniforms.uStep.value.set(0, 1 / ping.height); pass(blur, soft);
      blur.uniforms.uImage.value = soft.texture; blur.uniforms.uStep.value.set(3 / soft.width, 3 / soft.height); pass(blur, broad);
      pass(composite, null);
    }
    function dispose() { if (disposed) return; disposed = true; for (const t of [base, bright, ping, soft, broad]) t.dispose();
      threshold.dispose(); blur.dispose(); composite.dispose(); geometry.dispose(); scene.remove(quad); }
    return Object.freeze({ resize, render, dispose, stats:{ floatingPoint:!!floating, targets:5 } });
  }
  return Object.freeze({ create });
});

