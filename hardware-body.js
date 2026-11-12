import * as THREE from "./assets/vendor/three-r180/three.module.js";
import { GLTFLoader } from "./assets/vendor/three-r180/GLTFLoader.js";
import { OrbitControls } from "./assets/vendor/three-r180/OrbitControls.js";

const MODEL_URL = new URL("./assets/models/wearable-female-233ddd7a.glb", import.meta.url).href;
export const BODY_WEARS = ["头部", "眼部", "耳部", "颈部", "胸口", "上臂", "手腕", "手指", "腰部", "腿脚"];
const PARTS = [
  { wear: "头部", point: [0, 1.91, 0], side: "left", row: 0 },
  { wear: "眼部", point: [0, 1.79, .14], side: "right", row: 0 },
  { wear: "耳部", point: [-.11, 1.78, .01], side: "left", row: 1 },
  { wear: "颈部", point: [0, 1.66, .06], side: "right", row: 1 },
  { wear: "胸口", point: [0, 1.46, .15], side: "left", row: 2 },
  { wear: "上臂", bone: "L_UpperarmTwist02", side: "right", row: 2 },
  { wear: "手腕", bone: "R_Hand", side: "left", row: 3 },
  { wear: "手指", bone: "L_Hand", offset: [.07, -.06, .01], side: "right", row: 3 },
  { wear: "腰部", point: [0, 1.30, .12], side: "left", row: 4 },
  { wear: "腿脚", bone: "R_Foot", side: "right", row: 4 },
];
const svgNS = "http://www.w3.org/2000/svg";
let modelBytes;

async function getModel() {
  if (!modelBytes) modelBytes = fetch(MODEL_URL, { credentials: "same-origin" }).then(async r => {
    if (!r.ok) throw new Error("模型文件读取失败（HTTP " + r.status + "）");
    const bytes = await r.arrayBuffer();
    if (bytes.byteLength < 20 || new DataView(bytes).getUint32(0, true) !== 0x46546c67) throw new Error("模型文件格式无效");
    return bytes;
  }).catch(error => { modelBytes = null; throw error; });
  return modelBytes;
}

function disposeScene(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set(), skeletons = new Set();
  root.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.skeleton) skeletons.add(object.skeleton);
    for (const material of [object.material].flat().filter(Boolean)) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) { texture.source?.data?.close?.(); texture.dispose(); }
  for (const skeleton of skeletons) skeleton.dispose();
}

function poseArm(root, name, angle) {
  const arm = root.getObjectByName(name);
  if (!arm) return;
  root.updateMatrixWorld(true);
  const parent = arm.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  const world = arm.getWorldQuaternion(new THREE.Quaternion());
  const delta = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle);
  arm.quaternion.copy(parent.multiply(delta.multiply(world)));
  root.updateMatrixWorld(true);
}

function makeBodyMaterial(accent) {
  const uniforms = { accent: { value: new THREE.Color(accent) }, focus: { value: new THREE.Vector3(0, -10, 0) }, focusEnabled: { value: 0 } };
  const material = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: true, side: THREE.FrontSide,
    vertexShader: `varying vec3 vBody; varying vec3 vNormal; varying vec3 vView;
      void main(){vBody=position; vNormal=normalize(normalMatrix*normal);
      vec4 p=modelViewMatrix*vec4(position,1.0); vView=normalize(-p.xyz); gl_Position=projectionMatrix*p;}`,
    fragmentShader: `uniform vec3 accent; uniform vec3 focus; uniform float focusEnabled;
      varying vec3 vBody; varying vec3 vNormal; varying vec3 vView;
      void main(){vec3 N=normalize(vNormal); float facing=abs(dot(N,normalize(vView)));
      float rim=pow(1.0-facing,2.0); float light=0.42+0.58*max(0.0,dot(N,normalize(vec3(-0.8,1.4,1.5))));
      float scan=pow(0.5+0.5*cos(vBody.y*235.0),18.0)*0.10;
      float local=exp(-dot(vBody-focus,vBody-focus)*105.0)*focusEnabled;
      vec3 base=mix(vec3(0.17,0.21,0.24),accent,0.16)*light;
      gl_FragColor=vec4(base+accent*(rim*0.76+scan+local*1.1),0.94);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
  });
  return { material, uniforms };
}

export async function createBodyAtlas(host, { counts = {}, selected = null, onSelect = () => {}, onError = () => {}, signal } = {}) {
  let destroyed = false, frame = 0, dragging = null, activeDevice = null;
  let current = selected, currentCounts = counts, hovered = null;
  const listeners = [], resourceRoot = new THREE.Group();
  const listen = (element, event, handler, options) => {
    element.addEventListener(event, handler, options);
    listeners.push(() => element.removeEventListener(event, handler, options));
  };
  const stage = document.createElement("div");
  stage.className = "atl-model-stage";
  stage.innerHTML = '<div class="atl-model-kicker"><span>CUERPO CONECTADO</span><b>身体 · 设备地图</b></div>' +
    '<div class="atl-model-canvas" role="img" aria-label="可旋转的三维人体，设备按佩戴部位关联"></div>' +
    '<svg class="atl-model-links" aria-hidden="true"></svg><div class="atl-model-labels"></div>' +
    '<div class="atl-model-status" role="status">正在加载三维人体…</div>' +
    '<div class="atl-model-tools"><button type="button" data-body-action="left" aria-label="向左旋转人体">↶</button>' +
    '<button type="button" data-body-action="reset">正面</button><button type="button" data-body-action="right" aria-label="向右旋转人体">↷</button>' +
    '<button type="button" data-body-action="zoom" aria-pressed="false">局部放大</button></div>' +
    '<div class="atl-model-hint">拖动旋转 · 点部位看设备 · 点设备定位</div>';
  host.replaceChildren(stage);
  const canvasHost = stage.querySelector(".atl-model-canvas"), links = stage.querySelector(".atl-model-links");
  const labels = stage.querySelector(".atl-model-labels"), status = stage.querySelector(".atl-model-status");
  const tools = stage.querySelector(".atl-model-tools");
  const zoomButton = tools.querySelector('[data-body-action="zoom"]');
  const buttons = [], paths = [];
  for (const part of PARTS) {
    const button = document.createElement("button");
    button.type = "button"; button.className = "atl-body-label"; button.dataset.wear = part.wear;
    button.innerHTML = '<span></span><b></b>'; button.querySelector("span").textContent = part.wear;
    labels.append(button); buttons.push(button);
    const path = document.createElementNS(svgNS, "path");
    links.append(path); paths.push(path);
    listen(button, "click", () => onSelect(current === part.wear ? null : part.wear));
    listen(button, "pointerenter", () => { hovered = part.wear; syncVisual(); });
    listen(button, "pointerleave", () => { hovered = null; syncVisual(); });
    listen(button, "focus", () => { hovered = part.wear; syncVisual(); });
    listen(button, "blur", () => { hovered = null; syncVisual(); });
  }
  let renderer, controls, observer, themeObserver, gltfRoot;
  const scene = new THREE.Scene();
  scene.add(resourceRoot);
  const camera = new THREE.PerspectiveCamera(31, 1, .01, 30);
  const point = new THREE.Vector3(), projected = new THREE.Vector3();
  const anchors = new Map(), hitObjects = [], haloObjects = [];
  let bodyUniforms, pointMaterial, ringMaterial;
  let width = 1, height = 1, zoomed = false;
  const themeColor = () => getComputedStyle(host).getPropertyValue("--g-accent").trim() || "#d9a44e";

  function invalidate() {
    if (destroyed || frame || document.hidden) return;
    frame = requestAnimationFrame(() => { frame = 0; render(); });
  }
  function layoutLabels() {
    const labelWidth = width < 440 ? 69 : 84;
    const margin = width < 440 ? 9 : 18;
    links.setAttribute("viewBox", "0 0 " + width + " " + height);
    for (let i = 0; i < PARTS.length; i++) {
      const part = PARTS[i], button = buttons[i], anchor = anchors.get(part.wear);
      const top = 85 + part.row * Math.min(86, Math.max(40, (height - 245) / 4));
      const left = part.side === "left" ? margin : width - margin - labelWidth;
      button.style.left = left + "px"; button.style.top = top + "px"; button.style.width = labelWidth + "px";
      if (!anchor) { paths[i].setAttribute("d", ""); continue; }
      projected.copy(anchor).project(camera);
      const x = (projected.x * .5 + .5) * width, y = (-projected.y * .5 + .5) * height;
      const startX = part.side === "left" ? left + labelWidth : left;
      const bendX = part.side === "left" ? startX + 12 : startX - 12;
      paths[i].setAttribute("d", "M" + startX + "," + (top + 16) + " H" + bendX + " L" + x.toFixed(1) + "," + y.toFixed(1));
      paths[i].classList.toggle("on", (hovered || current) === part.wear);
    }
  }
  function render() {
    if (destroyed || !renderer || document.hidden) return;
    controls?.update();
    renderer.render(scene, camera); layoutLabels();
  }
  function fitCamera() {
    const aspect = width / height;
    const distance = Math.max(5.35, 1.45 / Math.max(.4, aspect));
    camera.position.set(0, .80, distance);
    controls.target.set(0, .78, 0);
    camera.lookAt(controls.target);
    controls.update();
  }
  function resize() {
    if (destroyed || !renderer) return;
    width = stage.clientWidth; height = stage.clientHeight;
    if (!width || !height) return;
    camera.aspect = width / height; camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    if (!zoomed) fitCamera();
    invalidate();
  }
  function syncVisual() {
    if (destroyed) return;
    const focus = hovered || current;
    for (let i = 0; i < PARTS.length; i++) {
      const part = PARTS[i], button = buttons[i], count = currentCounts[part.wear] || 0;
      button.querySelector("b").textContent = count;
      button.setAttribute("aria-label", part.wear + "，" + count + " 件设备");
      button.setAttribute("aria-pressed", String(current === part.wear));
      button.classList.toggle("on", current === part.wear);
      button.classList.toggle("empty", !count);
    }
    if (bodyUniforms) {
      bodyUniforms.focusEnabled.value = anchors.has(focus) ? 1 : 0;
      if (anchors.has(focus)) bodyUniforms.focus.value.copy(anchors.get(focus));
    }
    for (const object of hitObjects) {
      const focusEnabled = object.userData.wear === focus;
      object.visible = true;
      object.scale.setScalar(focusEnabled ? 1.7 : 1);
      object.material.opacity = focusEnabled ? 1 : (currentCounts[object.userData.wear] ? .65 : .22);
    }
    for (const object of haloObjects) object.visible = object.userData.wear === focus;
    stage.dataset.selectedWear = current || "";
    if (stage.dataset.loaded === "true") {
      status.textContent = activeDevice ? activeDevice + " · " + current : current ? current + " · " + (currentCounts[current] || 0) + " 件设备" : "三维人体已就绪 · 选择部位浏览";
    }
    invalidate();
  }
  function update({ counts: nextCounts = currentCounts, selected: nextSelected = current, deviceName = null } = {}) {
    currentCounts = nextCounts; current = nextSelected; activeDevice = deviceName;
    if (zoomed) {
      const anchor = anchors.get(current);
      if (!anchor) reset();
      else {
        const offset = camera.position.clone().sub(controls.target);
        controls.target.copy(anchor); camera.position.copy(anchor).add(offset); controls.update();
      }
    }
    syncVisual();
  }
  function reset() {
    zoomed = false; zoomButton.setAttribute("aria-pressed", "false"); zoomButton.textContent = "局部放大";
    if (controls) fitCamera();
    invalidate();
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true; cancelAnimationFrame(frame); frame = 0;
    for (const remove of listeners) remove();
    observer?.disconnect(); themeObserver?.disconnect(); controls?.dispose();
    disposeScene(scene);
    if (gltfRoot) { disposeScene(gltfRoot); gltfRoot = null; }
    renderer?.dispose(); renderer?.forceContextLoss();
    host.replaceChildren();
  }
  if (signal?.aborted) { destroy(); return { update, destroy }; }
  if (signal) listen(signal, "abort", destroy, { once: true });
  syncVisual();
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setClearColor(0x000000, 0); renderer.outputColorSpace = THREE.SRGBColorSpace;
    canvasHost.append(renderer.domElement);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false; controls.enablePan = false; controls.enableZoom = false;
    controls.minPolarAngle = Math.PI * .29; controls.maxPolarAngle = Math.PI * .71;
    listen(controls, "change", invalidate);
    listen(renderer.domElement, "webglcontextlost", event => {
      event.preventDefault(); if (!destroyed) { status.textContent = "三维显示已暂停，请切换表格后重试"; onError(new Error("WebGL context lost")); }
    });
    listen(renderer.domElement, "pointerdown", event => { dragging = { x: event.clientX, y: event.clientY }; });
    listen(renderer.domElement, "pointerup", event => {
      if (!dragging || Math.hypot(event.clientX - dragging.x, event.clientY - dragging.y) > 7) { dragging = null; return; }
      dragging = null;
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      const ray = new THREE.Raycaster(); ray.setFromCamera(mouse, camera);
      const target = ray.intersectObjects(hitObjects, false)[0];
      if (target) onSelect(current === target.object.userData.wear ? null : target.object.userData.wear);
    });
    listen(tools, "click", event => {
      const action = event.target.closest("[data-body-action]")?.dataset.bodyAction;
      if (!action) return;
      if (action === "reset") return reset();
      if (action === "zoom") {
        if (zoomed) return reset();
        const anchor = anchors.get(current);
        if (!anchor) { status.textContent = "先选择一个人体部位，再局部放大"; return; }
        zoomed = true; zoomButton.setAttribute("aria-pressed", "true"); zoomButton.textContent = "恢复全身";
        const direction = camera.position.clone().sub(controls.target).normalize();
        controls.target.copy(anchor); camera.position.copy(anchor).addScaledVector(direction, 1.4); controls.update();
      } else {
        const offset = camera.position.clone().sub(controls.target);
        offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), action === "left" ? Math.PI / 6 : -Math.PI / 6);
        camera.position.copy(controls.target).add(offset); controls.update();
      }
      invalidate();
    });
    listen(document, "visibilitychange", () => { if (!document.hidden) invalidate(); });
    observer = new ResizeObserver(resize); observer.observe(stage); resize();
    themeObserver = new MutationObserver(() => {
      const accent = themeColor();
      bodyUniforms?.accent.value.set(accent);
      pointMaterial?.color.set(accent); ringMaterial?.color.set(accent);
      for (const object of hitObjects) object.material.color.set(accent);
      invalidate();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const bytes = await getModel();
    if (destroyed) return { update, destroy };
    const manager = new THREE.LoadingManager();
    manager.setURLModifier(url => {
      if (!url.startsWith("blob:") && !url.startsWith("data:")) throw new Error("模型包含外部资源，已停止读取");
      return url;
    });
    const loader = new GLTFLoader(manager);
    const gltf = await loader.parseAsync(bytes.slice(0), "");
    gltfRoot = gltf.scene;
    if (destroyed) { disposeScene(gltfRoot); gltfRoot = null; return { update, destroy }; }
    poseArm(gltfRoot, "L_Upperarm", -.82); poseArm(gltfRoot, "R_Upperarm", .82);
    gltfRoot.rotation.y = -Math.PI / 2;
    gltfRoot.updateMatrixWorld(true);
    gltfRoot.traverse(object => { if (object.isSkinnedMesh) object.skeleton.update(); });
    const meshes = [];
    gltfRoot.traverse(object => { if (object.isMesh) meshes.push(object); });
    const posed = [], bounds = new THREE.Box3();
    for (const mesh of meshes) {
      const positions = new Float32Array(mesh.geometry.attributes.position.count * 3);
      for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
        mesh.getVertexPosition(i, point); point.applyMatrix4(mesh.matrixWorld); bounds.expandByPoint(point);
        point.toArray(positions, i * 3);
      }
      posed.push({ mesh, positions });
    }
    const scale = 2 / bounds.getSize(new THREE.Vector3()).y;
    const center = bounds.getCenter(new THREE.Vector3());
    const normalize = p => p.sub(new THREE.Vector3(center.x, bounds.min.y, center.z)).multiplyScalar(scale);
    for (const part of PARTS) {
      const bone = part.bone && gltfRoot.getObjectByName(part.bone);
      const anchor = bone ? normalize(bone.getWorldPosition(new THREE.Vector3())) : new THREE.Vector3(...part.point);
      if (part.offset) anchor.add(new THREE.Vector3(...part.offset));
      anchors.set(part.wear, anchor);
    }
    const body = makeBodyMaterial(themeColor()); bodyUniforms = body.uniforms;
    for (const { mesh, positions } of posed) {
      for (let i = 0; i < positions.length; i += 3) {
        point.fromArray(positions, i); normalize(point).toArray(positions, i);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      if (mesh.geometry.index) geometry.setIndex(mesh.geometry.index.clone());
      geometry.computeVertexNormals();
      resourceRoot.add(new THREE.Mesh(geometry, body.material));
      const points = [];
      for (let i = 0; i < positions.length; i += 18) points.push(positions[i], positions[i + 1], positions[i + 2]);
      const pointsGeometry = new THREE.BufferGeometry(); pointsGeometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
      pointMaterial = new THREE.PointsMaterial({ color: themeColor(), size: .006, transparent: true, opacity: .28, depthWrite: false });
      resourceRoot.add(new THREE.Points(pointsGeometry, pointMaterial));
    }
    disposeScene(gltfRoot); gltfRoot = null;
    ringMaterial = new THREE.MeshBasicMaterial({ color: themeColor(), transparent: true, opacity: .85, depthTest: false, depthWrite: false });
    for (const part of PARTS) {
      const anchor = anchors.get(part.wear);
      const dot = new THREE.Mesh(new THREE.SphereGeometry(.014, 12, 8), new THREE.MeshBasicMaterial({ color: themeColor(), transparent: true, depthTest: false }));
      dot.position.copy(anchor); dot.userData.wear = part.wear; dot.renderOrder = 5;
      resourceRoot.add(dot); hitObjects.push(dot);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(part.wear === "腰部" ? .12 : .043, .003, 8, 48), ringMaterial);
      ring.position.copy(anchor); ring.userData.wear = part.wear; ring.renderOrder = 4;
      resourceRoot.add(ring); haloObjects.push(ring);
    }
    const floor = new THREE.Mesh(new THREE.RingGeometry(.28, .283, 72), new THREE.MeshBasicMaterial({ color: themeColor(), transparent: true, opacity: .3, side: THREE.DoubleSide }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -.025; resourceRoot.add(floor);
    const anchorBounds = [...anchors].map(([wear, anchor]) => ({ wear, position: anchor.toArray().map(n => Number(n.toFixed(4))) }));
    stage.dataset.anchors = JSON.stringify(anchorBounds);
    stage.dataset.loaded = "true";
    syncVisual(); resize();
  } catch (error) {
    if (!destroyed) {
      status.textContent = "三维人体暂不可用，可用部位按钮或表格继续浏览";
      stage.dataset.failed = "true";
      onError(error);
    }
  }
  return { update, destroy };
}
