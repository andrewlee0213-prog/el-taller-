
/* Atmospheric depth behind the fiber core; no independent animation loop. */
(function (root, factory) {
  'use strict'; const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JarvisEnvironment = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function create(THREE, options) {
    options = options || {}; const group = new THREE.Group(), resources = [];
    let state = 177013, disposed = false;
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    const keep = resource => { resources.push(resource); return resource; };
    const sky = new THREE.Mesh(keep(new THREE.PlaneGeometry(60, 40)), keep(new THREE.ShaderMaterial({
      depthWrite:false, depthTest:false, uniforms:{uTime:{value:0}}, vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader:`precision highp float; varying vec2 vUv;uniform float uTime;
      void main(){vec2 p=vUv-.5;float haze=exp(-dot(p*vec2(2.0,5.5),p*vec2(2.0,5.5))*2.4);
      float cloud=.5+.5*sin(p.x*13.0+sin(p.y*14.0+uTime*.012));
      vec3 c=vec3(.0005,.0012,.0024)+vec3(.001,.005,.009)*haze*(.65+.35*cloud);
      float warm=exp(-dot((p-vec2(.22,-.12))*vec2(8.,10.),(p-vec2(.22,-.12))*vec2(8.,10.)));
      c+=vec3(.012,.005,.001)*warm;gl_FragColor=vec4(c,1.);}`,
      toneMapped:false
    })));
    sky.position.z = -22; sky.renderOrder = -10; sky.visible = !options.transparent; group.add(sky);
    const count = options.quality === 'low' ? 450 : 1200;
    const positions = new Float32Array(count * 3), seeds = new Float32Array(count);
    for (let i=0;i<count;i++) { positions.set([(random()-.5)*34,(random()-.5)*22,-5-random()*16],i*3); seeds[i]=random(); }
    const geo = keep(new THREE.BufferGeometry()); geo.setAttribute('position',new THREE.BufferAttribute(positions,3)); geo.setAttribute('aSeed',new THREE.BufferAttribute(seeds,1));
    const mat = keep(new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false,
      uniforms:{uTime:{value:0},uPixel:{value:Math.min(options.dpr||1,2)}},
      vertexShader:`attribute float aSeed; varying float vA; uniform float uTime;uniform float uPixel;
        void main(){vec3 p=position;p.x+=sin(uTime*.018+aSeed*31.)*.06;vec4 v=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*v;
        gl_PointSize=(.7+aSeed*1.3)*uPixel;vA=.035+.14*pow(.5+.5*sin(aSeed*71.+uTime*(.1+aSeed*.15)),3.);}`,
      fragmentShader:`precision highp float;varying float vA;void main(){float d=length(gl_PointCoord-.5)*2.;if(d>1.)discard;gl_FragColor=vec4(vec3(.3,.66,.91)*(1.-d),vA);}`
    }));
    const stars = new THREE.Points(geo,mat); stars.frustumCulled=false; group.add(stars);
    const lines=[];
    for(let i=-12;i<=12;i++){ lines.push(i*.65,-3.2,-12,i*.65,-3.2,7); }
    for(let i=-12;i<=7;i++){ lines.push(-8,-3.2,i,8,-3.2,i); }
    const gridGeo=keep(new THREE.BufferGeometry()); gridGeo.setAttribute('position',new THREE.Float32BufferAttribute(lines,3));
    const gridMat=keep(new THREE.LineBasicMaterial({color:0x194c61,transparent:true,opacity:.045,depthWrite:false,blending:THREE.AdditiveBlending}));
    const grid=new THREE.LineSegments(gridGeo,gridMat); group.add(grid);
    function update(options) { if(disposed)return; const time=options.reducedMotion?0:options.time||0; sky.material.uniforms.uTime.value=time;mat.uniforms.uTime.value=time;
      gridMat.opacity=options.coreOnly?.045:.025; }
    function dispose(){if(disposed)return;disposed=true; resources.forEach(r=>r.dispose());group.clear();}
    return Object.freeze({group,update,dispose,stats:{stars:count}});
  }
  return Object.freeze({create});
});

