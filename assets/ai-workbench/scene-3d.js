
/* V2 renderer bridge: one camera, fiber core, holographic parts and final bloom output. */
(function (root, factory) {
  'use strict'; const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Studio3D = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  function create(host) {
    const T=root.THREE;
    if(!T||!T.WebGLRenderer||!root.JarvisCore||!root.HologramRenderer||!root.StudioPostFX||!root.JarvisEnvironment) throw new Error('Jarvis visual modules unavailable');
    const doc=host.ownerDocument;
    const small=(host.clientWidth||root.innerWidth||1440)<700;
    const quality=small?'low':'medium';
    const renderer=new T.WebGLRenderer({alpha:true,premultipliedAlpha:true,antialias:false,preserveDrawingBuffer:true,powerPreference:'high-performance'});
    renderer.setPixelRatio(Math.min(root.devicePixelRatio||1,small?1.5:1.75));
    renderer.outputColorSpace=T.LinearSRGBColorSpace; renderer.toneMapping=T.NoToneMapping; renderer.setClearColor(0x000000,0);
    const canvas=renderer.domElement;canvas.className='studio-webgl-canvas';canvas.setAttribute('aria-hidden','true');
    canvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0';host.append(canvas);
    const scene=new T.Scene(),camera=new T.PerspectiveCamera(38,1,.1,120);
    const core=root.JarvisCore.create(T,{quality});scene.add(core.group);
    const environment=root.JarvisEnvironment.create(T,{quality,dpr:renderer.getPixelRatio(),transparent:true});scene.add(environment.group);
    const holo=root.HologramRenderer.create(T,{quality});scene.add(holo.group);
    const post=root.StudioPostFX.create(T,renderer,{quality,transparent:true});
    let width=0,height=0,currentId='',currentFingerprint='',lastTime=null,coreState='idle',disposed=false;
    let yaw=-.48,pitch=-.56,lastAnchors=[],lastStates=[],appearanceClock=0,coreGain=1,viewTarget=7.2;
    let resizeObserver=null,lastRenderAt=null,frameCount=0,frameTotal=0;
    const diagnostics={quality,core:core.stats,hologram:holo.stats,post:post.stats,frames:0,averageFrameMs:0};
    host.__jarvisRenderStats=diagnostics;
    const projected=new T.Vector3();
    function resize(){if(disposed)return;const rect=host.getBoundingClientRect();const w=Math.max(1,Math.round(rect.width)),h=Math.max(1,Math.round(rect.height));
      if(w===width&&h===height)return;width=w;height=h;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false);
      const size=new T.Vector2();renderer.getDrawingBufferSize(size);post.resize(size.x,size.y);}
    function sceneSignature(data){return data.id+':'+data.objects.map(o=>o.id+o.kind+o.size.join(',')).join('|');}
    function render(data,states,options){
      if(disposed)return[];options=options||{};resize();
      const time=Number.isFinite(options.time)?options.time:0;
      const clock=typeof performance==='object'?performance.now():Date.now();
      const dt=options.exporting?(lastTime===null?1/60:clamp(Math.abs(time-lastTime),0,.05)):
        lastRenderAt===null?1/60:clamp((clock-lastRenderAt)/1000,.001,.05);
      if(lastRenderAt!==null){frameTotal+=clock-lastRenderAt;frameCount++;}
      lastRenderAt=clock;lastTime=time;diagnostics.frames++;diagnostics.averageFrameMs=frameCount?frameTotal/frameCount:0;
      const display=doc.body&&doc.body.dataset?doc.body.dataset.display:null;
      const coreOnly=!!options.coreOnly||(!options.exporting&&display&&display!=='demo');
      const ease=options.reducedMotion?1:1-Math.pow(.035,dt);
      coreGain+=((coreOnly?1:0)-coreGain)*ease;
      core.group.visible=coreGain>.005;
      core.group.position.set(0,0,0);core.group.scale.setScalar(coreOnly?1:1.0);
      core.group.rotation.set(pitch*.35,yaw*.25,0);
      core.update({time,dt,state:coreState,reducedMotion:!!options.reducedMotion,gain:coreGain});
      environment.update({time,reducedMotion:!!options.reducedMotion,coreOnly});
      if(!coreOnly&&data&&data.objects.length){
        const fingerprint=sceneSignature(data);
        if(currentId!==data.id||currentFingerprint!==fingerprint){currentId=data.id;currentFingerprint=fingerprint;holo.setScene(data);appearanceClock=0;}
        const sceneTime=Number.isFinite(options.sceneTime)?options.sceneTime:time;
        appearanceClock+=dt;
        const appearance=options.exporting?Math.min(1,sceneTime/2.4):options.reducedMotion?1:Math.min(1,appearanceClock/2.4);
        holo.group.visible=true;holo.group.rotation.set(pitch,yaw,0);
        holo.update(states,{time,sceneTime,appearance,exploded:options.exploded||0,focusId:options.focusId||null,reducedMotion:!!options.reducedMotion});
        lastStates=states;
        let bound=3.3;
        for(const state of states){const extent=Math.max(...state.size)*.5;bound=Math.max(bound,Math.hypot(...state.position)+extent+((options.exploded||0)*1.8));}
        const fov=Math.PI*38/360;viewTarget=Math.max(7.8,bound/Math.sin(fov)*.92, bound/(Math.sin(fov)*camera.aspect)*.95);
      }else{holo.group.visible=false;lastStates=[];lastAnchors=[];viewTarget=(camera.aspect<.8?10.7:7.8)*(Number.isFinite(options.coreZoom)?clamp(options.coreZoom,.65,1):1);}
      camera.position.set(0,.08,camera.position.z?camera.position.z+(viewTarget-camera.position.z)*(options.exporting||options.reducedMotion?1:ease):viewTarget);
      camera.lookAt(0,0,0);camera.updateMatrixWorld();
      post.render(scene,camera);
      if(holo.group.visible){lastAnchors=holo.getAnchors().map(a=>{projected.copy(a.position);if(a.local!==false)holo.group.localToWorld(projected);projected.project(camera);
        return{id:a.id,x:(projected.x+1)*width/2,y:(1-projected.y)*height/2,depth:projected.z};});}
      return lastAnchors.map(a=>({...a}));
    }
    function hitTest(x,y,radius){let best=null,distance=radius||38;for(const a of lastAnchors){const d=Math.hypot(a.x-x,a.y-y);if(d<distance){best=a.id;distance=d;}}return best;}
    function setCoreState(value){if(['idle','thinking','speaking','error'].includes(value))coreState=value;}
    function rotateBy(dx,dy){yaw+=dx*.006;pitch=clamp(pitch+dy*.004,-.85,.85);}
    function resetView(){yaw=-.48;pitch=-.56;}
    function dispose(){if(disposed)return;disposed=true;if(resizeObserver)resizeObserver.disconnect();core.dispose();holo.dispose();environment.dispose();post.dispose();
      renderer.dispose();renderer.forceContextLoss();if(canvas.parentNode===host)host.removeChild(canvas);lastAnchors=[];lastStates=[];}
    if(typeof root.ResizeObserver==='function'){resizeObserver=new root.ResizeObserver(resize);resizeObserver.observe(host);}
    resize();camera.position.set(0,.08,7.8);camera.lookAt(0,0,0);
    return Object.freeze({canvas,render,hitTest,setCoreState,rotateBy,resetView,dispose,get coreState(){return coreState;},
      get stats(){return{quality,core:core.stats,hologram:holo.stats,post:post.stats,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles};}});
  }
  return Object.freeze({create});
});

