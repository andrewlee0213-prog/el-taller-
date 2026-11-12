
/* Safe schema primitives -> deterministic luminous samples. No renderer, DOM, assets or clock. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HologramRenderer = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const TAU = Math.PI * 2;
  const KINDS = Object.freeze(['block', 'text', 'sphere', 'box', 'cylinder', 'cone', 'torus', 'point']);
  const QUALITIES = Object.freeze({
    low: Object.freeze({ points: 18000, minimum: 96, perPart: 3600, segments: 28, dotSize: 2.1 }),
    medium: Object.freeze({ points: 48000, minimum: 144, perPart: 8200, segments: 48, dotSize: 1.95 }),
    high: Object.freeze({ points: 84000, minimum: 192, perPart: 14000, segments: 72, dotSize: 1.8 })
  });
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const finite = (v, fallback) => typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const smooth = v => { const p = clamp(v, 0, 1); return p * p * (3 - 2 * p); };
  const appearanceProgress = (p, seed) => smooth(1.7 * clamp(finite(p, 1), 0, 1) - 0.7 * clamp(finite(seed, 0), 0, 1));
  function hash(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function random(seed) {
    let s = seed >>> 0;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }
  function vector(value, fallback, lo, hi) {
    if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) return fallback.slice();
    return value.map(n => clamp(n, lo, hi));
  }
  function dimensions(kind, size) {
    return kind === 'text' ? [size[0], size[1] * 0.16, size[2] * 0.14] : size;
  }
  function descriptor(object) {
    if (!object || typeof object.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(object.id) || !KINDS.includes(object.kind)) throw new TypeError('HologramRenderer requires safe schema objects');
    const size = object.size === undefined ? [1, 1, 1] : object.size;
    const position = object.position === undefined ? [0, 0, 0] : object.position;
    if (!Array.isArray(size) || size.length !== 3 || !size.every(n => Number.isFinite(n) && n >= 0.05 && n <= 8) ||
        !Array.isArray(position) || position.length !== 3 || !position.every(n => Number.isFinite(n) && Math.abs(n) <= 8)) throw new TypeError('HologramRenderer geometry is outside schema bounds');
    if (object.color !== undefined && (typeof object.color !== 'string' || !/^#[a-f0-9]{6}$/i.test(object.color))) throw new TypeError('HologramRenderer requires a schema color');
    if (object.opacity !== undefined && (!Number.isFinite(object.opacity) || object.opacity < 0 || object.opacity > 1)) throw new TypeError('HologramRenderer requires a schema opacity');
    if (object.group !== undefined && (typeof object.group !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(object.group))) throw new TypeError('HologramRenderer requires a schema group');
    return { id: object.id, kind: object.kind, size: size.slice(), position: position.slice(), color: object.color || '#75d7e7', opacity: finite(object.opacity, 1), group: object.group };
  }
  function area(object) {
    const s = dimensions(object.kind, object.size), a = s[0], b = s[1], c = s[2];
    if (object.kind === 'sphere' || object.kind === 'point') return Math.PI * (a * b + a * c + b * c) / 3 * (object.kind === 'point' ? 0.06 : 1);
    if (object.kind === 'cylinder' || object.kind === 'cone') return Math.PI * (Math.sqrt(a * c) * b + a * c / 2) * (object.kind === 'cone' ? 0.7 : 1);
    if (object.kind === 'torus') return 4 * Math.PI * Math.PI * 0.42 * 0.075 * Math.sqrt((a * b + a * c + b * c) / 3);
    return 2 * (a * b + a * c + b * c);
  }
  function pointOnShape(kind, size, rand) {
    const s = dimensions(kind, size);
    let x, y, z;
    if (kind === 'sphere' || kind === 'point') {
      const v = rand() * 2 - 1, a = rand() * TAU, r = Math.sqrt(Math.max(0, 1 - v * v)) * 0.5;
      const k = kind === 'point' ? 0.24 : 1;
      return [Math.cos(a) * r * s[0] * k, v * 0.5 * s[1] * k, Math.sin(a) * r * s[2] * k];
    }
    if (kind === 'torus') {
      const a = rand() * TAU;
      // Rejection weights the outer tube by area instead of filling the torus hole.
      let t;
      do { t = rand() * TAU; } while (rand() > (0.42 + 0.075 * Math.cos(t)) / 0.495);
      const r = 0.42 + 0.075 * Math.cos(t);
      return [r * Math.cos(a) * s[0], r * Math.sin(a) * s[1], 0.075 * Math.sin(t) * s[2]];
    }
    if (kind === 'cylinder' || kind === 'cone') {
      const a = rand() * TAU, sideArea = Math.PI * Math.sqrt(s[0] * s[2]) * s[1];
      const capsArea = Math.PI * s[0] * s[2] * (kind === 'cone' ? 0.25 : 0.5);
      if (rand() < sideArea / (sideArea + capsArea)) {
        y = kind === 'cone' ? 0.5 - Math.sqrt(rand()) : rand() - 0.5;
        const r = kind === 'cone' ? (0.5 - y) * 0.5 : 0.5;
        x = Math.cos(a) * r; z = Math.sin(a) * r;
      } else {
        y = kind === 'cone' || rand() < 0.5 ? -0.5 : 0.5;
        const r = Math.sqrt(rand()) * 0.5;
        x = Math.cos(a) * r; z = Math.sin(a) * r;
      }
      return [x * s[0], y * s[1], z * s[2]];
    }
    const weights = [s[1] * s[2], s[0] * s[2], s[0] * s[1]], total = weights[0] + weights[1] + weights[2];
    const pick = rand() * total, axis = pick < weights[0] ? 0 : pick < weights[0] + weights[1] ? 1 : 2;
    const p = [rand() - 0.5, rand() - 0.5, rand() - 0.5];
    p[axis] = rand() < 0.5 ? -0.5 : 0.5;
    return p.map((v, i) => v * s[i]);
  }
  function shellPoint(rand) {
    const z = rand() * 2 - 1, a = rand() * TAU, r = 0.62 + rand() * 0.22, ring = Math.sqrt(Math.max(0, 1 - z * z));
    return [Math.cos(a) * ring * r, z * r * 0.84, Math.sin(a) * ring * r];
  }
  function sampleShape(object, count) {
    const o = descriptor(object), n = Math.floor(count);
    if (!Number.isFinite(n) || n < 1 || n > 84000) throw new RangeError('HologramRenderer point budget exceeded');
    const positions = new Float32Array(n * 3), origins = new Float32Array(n * 3), seeds = new Float32Array(n), glow = new Float32Array(n);
    // Separate streams: changing quality keeps every old point and its assembly seed stable.
    const key = o.id + '|' + o.kind + '|' + o.size.join(',');
    const geometryRandom = random(hash(key + '|surface')), originRandom = random(hash(key + '|shell')), seedRandom = random(hash(key + '|light'));
    for (let i = 0; i < n; i++) {
      positions.set(pointOnShape(o.kind, o.size, geometryRandom), i * 3);
      origins.set(shellPoint(originRandom), i * 3);
      seeds[i] = seedRandom(); glow[i] = 0.28 + 0.72 * seedRandom();
    }
    return { positions, origins, seeds, glow };
  }
  function contours(kind, size, segments) {
    const s = dimensions(kind, size), paths = [];
    const path = (n, fn, closed) => {
      const points = [];
      for (let i = 0; i <= n; i++) points.push(fn(i / n).map((v, j) => v * s[j]));
      paths.push({ points, closed: !!closed });
    };
    const line = (a, b) => path(1, t => a.map((v, i) => v + (b[i] - v) * t));
    if (kind === 'sphere' || kind === 'point') {
      const r = kind === 'point' ? 0.12 : 0.5;
      for (let j = 1; j < 6; j++) {
        const phi = Math.PI * j / 6;
        path(segments, t => [r * Math.sin(phi) * Math.cos(t * TAU), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(t * TAU)], true);
      }
      for (let j = 0; j < 6; j++) {
        const a = j * Math.PI / 6;
        path(segments, t => [r * Math.cos(t * TAU) * Math.cos(a), r * Math.sin(t * TAU), r * Math.cos(t * TAU) * Math.sin(a)], true);
      }
    } else if (kind === 'torus') {
      for (let j = 0; j < 4; j++) {
        const v = j * TAU / 4, r = 0.42 + 0.075 * Math.cos(v);
        path(segments, t => [r * Math.cos(t * TAU), r * Math.sin(t * TAU), 0.075 * Math.sin(v)], true);
      }
      for (let j = 0; j < 8; j++) {
        const a = j * TAU / 8;
        path(Math.max(12, Math.floor(segments / 2)), t => [(0.42 + 0.075 * Math.cos(t * TAU)) * Math.cos(a), (0.42 + 0.075 * Math.cos(t * TAU)) * Math.sin(a), 0.075 * Math.sin(t * TAU)], true);
      }
    } else if (kind === 'cylinder' || kind === 'cone') {
      const levels = kind === 'cone' ? [-0.5, 0, 0.45] : [-0.5, -0.25, 0, 0.25, 0.5];
      for (const y of levels) {
        const r = kind === 'cone' ? (0.5 - y) * 0.5 : 0.5;
        path(segments, t => [r * Math.cos(t * TAU), y, r * Math.sin(t * TAU)], true);
      }
      for (let j = 0; j < 8; j++) {
        const a = j * TAU / 8;
        line([0.5 * Math.cos(a), -0.5, 0.5 * Math.sin(a)], kind === 'cone' ? [0, 0.5, 0] : [0.5 * Math.cos(a), 0.5, 0.5 * Math.sin(a)]);
      }
    } else {
      for (let axis = 0; axis < 3; axis++) for (const a of [-0.5, 0.5]) for (const b of [-0.5, 0.5]) {
        const p = [a, a, a], q = [a, a, a];
        p[(axis + 1) % 3] = q[(axis + 1) % 3] = a;
        p[(axis + 2) % 3] = q[(axis + 2) % 3] = b;
        p[axis] = -0.5; q[axis] = 0.5; line(p, q);
      }
      // Restrained face detail rather than a solid face or triangulation wireframe.
      for (const f of [-0.5, 0.5]) for (const v of [-0.25, 0, 0.25]) line([-0.5, f, v], [0.5, f, v]);
    }
    return paths;
  }
  function sampleEdges(object, segments) {
    const o = descriptor(object), detail = clamp(Math.floor(finite(segments, 48)), 12, 96);
    const positions = [], origins = [], seeds = [], glow = [];
    const paths = contours(o.kind, o.size, detail), rand = random(hash(o.id + '|' + o.kind + '|edges'));
    for (const path of paths) {
      const seed = rand(), phase = rand() * TAU, tilt = rand() * TAU, radius = 0.64 + rand() * 0.18;
      for (let j = 1; j < path.points.length; j++) for (const index of [j - 1, j]) {
        positions.push(...path.points[index]);
        const a = phase + index / (path.points.length - 1) * (path.closed ? TAU : Math.PI * 0.2);
        origins.push(Math.cos(a) * radius, Math.sin(a) * Math.cos(tilt) * radius * 0.84, Math.sin(a) * Math.sin(tilt) * radius);
        seeds.push(seed); glow.push(0.55 + seed * 0.45);
      }
    }
    return { positions: new Float32Array(positions), origins: new Float32Array(origins), seeds: new Float32Array(seeds), glow: new Float32Array(glow) };
  }
  function budgets(objects, quality) {
    const counts = new Map(objects.map(o => [o.id, quality.minimum]));
    let remaining = quality.points - objects.length * quality.minimum;
    const ordered = objects.slice().sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    while (remaining > 0) {
      const active = ordered.filter(o => counts.get(o.id) < quality.perPart);
      if (!active.length) break;
      const weights = active.map(o => Math.sqrt(Math.max(0.005, area(o)))), total = weights.reduce((a, b) => a + b, 0), pass = remaining;
      for (let i = 0; i < active.length && remaining > 0; i++) {
        const id = active[i].id, amount = Math.min(remaining, quality.perPart - counts.get(id), Math.max(1, Math.floor(pass * weights[i] / total)));
        counts.set(id, counts.get(id) + amount); remaining -= amount;
      }
    }
    return counts;
  }
  function explodeVectors(objects) {
    if (!objects.length) return new Map();
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], groups = new Map();
    for (const o of objects) {
      const key = o.group && o.group !== 'detail' ? 'group:' + o.group : 'part:' + o.id;
      if (!groups.has(key)) groups.set(key, { ids: [], center: [0, 0, 0] });
      const g = groups.get(key); g.ids.push(o.id);
      for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], o.position[k]); max[k] = Math.max(max[k], o.position[k]); g.center[k] += o.position[k]; }
    }
    const span = max.map((v, k) => v - min[k]), axis = span.indexOf(Math.max(...span)), center = (min[axis] + max[axis]) / 2;
    const list = [...groups.entries()];
    for (const [, g] of list) g.center = g.center.map(v => v / g.ids.length);
    list.sort((a, b) => a[1].center[axis] - b[1].center[axis] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const result = new Map();
    list.forEach(([, g], i) => {
      let direction;
      if (span[axis] < 0.2) {
        const a = (i + 0.5) * 2.399963229728653;
        direction = [Math.cos(a) * 1.35, ((i % 3) - 1) * 0.45, Math.sin(a) * 1.35];
      } else {
        const delta = g.center[axis] - center, sign = Math.abs(delta) > 0.12 ? Math.sign(delta) : i < list.length / 2 ? -1 : 1;
        direction = [0, 0, 0];
        direction[axis] = sign * (0.85 + Math.abs(i - (list.length - 1) / 2) * 0.28 + Math.abs(delta) * 0.12);
      }
      for (const id of g.ids) result.set(id, direction.slice());
    });
    return result;
  }

  // The inverse local part matrix keeps every starting point on ONE root-space sphere.
  // The normal modelViewMatrix still owns home transforms, so Box3 and external parents work.
  const VERTEX = `
    attribute vec3 aFrom;
    attribute float aSeed;
    attribute float aGlow;
    uniform mat4 uRootToPart;
    uniform float uAppearance;
    uniform float uTime;
    uniform float uMotion;
    uniform float uDotSize;
    varying float vSeed;
    varying float vGlow;
    varying float vAssembly;
    void main() {
      float p = clamp(1.7 * uAppearance - 0.7 * aSeed, 0.0, 1.0);
      p = p * p * (3.0 - 2.0 * p);
      vec3 jitter = vec3(sin(aSeed * 171.3 + uTime * 0.7), cos(aSeed * 263.1 + uTime * 0.6), sin(aSeed * 393.7 - uTime * 0.8));
      vec3 from = (uRootToPart * vec4(aFrom, 1.0)).xyz;
      vec3 noise = (uRootToPart * vec4(jitter * 0.095 * (1.0 - p) * uMotion, 0.0)).xyz;
      vec3 assembled = mix(from, position, p) + noise;
      vec4 mv = modelViewMatrix * vec4(assembled, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = clamp(uDotSize * (0.85 + aGlow * 0.28) * 14.0 / max(3.0, -mv.z), 1.0, 4.5);
      vSeed = aSeed; vGlow = aGlow; vAssembly = p;
    }
  `;
  const POINT_FRAGMENT = `
    uniform vec3 uColor;
    uniform float uOpacity;
    uniform float uDim;
    uniform float uHighlight;
    uniform float uTime;
    uniform float uMotion;
    varying float vSeed;
    varying float vGlow;
    varying float vAssembly;
    void main() {
      vec2 q = gl_PointCoord - 0.5;
      float r2 = dot(q, q);
      if (r2 > 0.25) discard;
      float soft = exp(-r2 * 17.0), core = 1.0 - smoothstep(0.012, 0.075, r2);
      float scintillation = 1.0 + 0.07 * sin(vSeed * 95.0 + uTime * 1.6) * uMotion;
      float a = (soft * 0.42 + core * 0.48) * uOpacity * uDim * (0.22 + 0.65 * vAssembly) * scintillation;
      vec3 tint = mix(uColor, vec3(0.83, 0.98, 1.0), 0.12 + uHighlight * 0.24);
      gl_FragColor = vec4(tint * (0.74 + vGlow * 0.65 + uHighlight * 0.55), a);
    }
  `;
  const LINE_FRAGMENT = `
    uniform vec3 uColor;
    uniform float uOpacity;
    uniform float uDim;
    uniform float uHighlight;
    uniform float uAppearance;
    varying float vSeed;
    varying float vGlow;
    varying float vAssembly;
    void main() {
      float a = smoothstep(0.38, 0.86, uAppearance) * (0.16 + vGlow * 0.15 + uHighlight * 0.13) * uOpacity * uDim;
      gl_FragColor = vec4(mix(uColor, vec3(0.8, 0.98, 1.0), 0.16 + uHighlight * 0.2) * (1.0 + uHighlight * 0.3), a);
    }
  `;
  function create(THREE, options) {
    if (!THREE || !THREE.Group || !THREE.BufferGeometry || !THREE.ShaderMaterial) throw new TypeError('HologramRenderer requires Three.js r160');
    const quality = options && Object.prototype.hasOwnProperty.call(QUALITIES, options.quality) ? options.quality : 'medium';
    const config = QUALITIES[quality], group = new THREE.Group(); group.name = 'schema-hologram';
    let entries = new Map(), moves = new Map(), disposed = false;
    const counters = { quality, sceneId: '', objects: 0, points: 0, lineVertices: 0, vertices: 0, drawCalls: 0, geometries: 0, materials: 0, bufferBytes: 0, appearance: 1, sceneTime: 0, exploded: 0, focusId: null, disposed: false };
    // A read-only live view, not a caller-mutable counter object.
    const liveStats = {};
    for (const key of Object.keys(counters)) Object.defineProperty(liveStats, key, { enumerable: true, get: () => counters[key] });
    Object.freeze(liveStats);
    function makeGeometry(samples) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(samples.positions, 3));
      geo.setAttribute('aFrom', new THREE.Float32BufferAttribute(samples.origins, 3));
      geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(samples.seeds, 1));
      geo.setAttribute('aGlow', new THREE.Float32BufferAttribute(samples.glow, 1));
      geo.computeBoundingBox(); geo.computeBoundingSphere();
      return geo;
    }
    function makeEntry(object, count, key) {
      const body = new THREE.Group(); body.name = object.id;
      const uniforms = { uRootToPart: { value: new THREE.Matrix4() }, uColor: { value: new THREE.Color(object.color) },
        uAppearance: { value: 1 }, uTime: { value: 0 }, uMotion: { value: 1 }, uDotSize: { value: config.dotSize },
        uOpacity: { value: object.opacity }, uDim: { value: 1 }, uHighlight: { value: 0 } };
      const geometries = [], materials = [];
      try {
        geometries.push(makeGeometry(sampleShape(object, count)), makeGeometry(sampleEdges(object, config.segments)));
        for (const fragment of [POINT_FRAGMENT, LINE_FRAGMENT]) materials.push(new THREE.ShaderMaterial({
          uniforms, vertexShader: VERTEX, fragmentShader: fragment, transparent: true, depthWrite: false, depthTest: true,
          blending: THREE.AdditiveBlending, toneMapped: false
        }));
        const points = new THREE.Points(geometries[0], materials[0]), lines = new THREE.LineSegments(geometries[1], materials[1]);
        points.name = object.id + '-points'; lines.name = object.id + '-contours';
        points.frustumCulled = false; lines.frustumCulled = false; body.add(points, lines);
        return { key, object, body, uniforms, geometries, materials, points: count, lineVertices: geometries[1].getAttribute('position').count };
      } catch (error) {
        for (const geo of geometries) geo.dispose(); for (const mat of materials) mat.dispose();
        throw error;
      }
    }
    function release(entry) {
      group.remove(entry.body);
      for (const geo of entry.geometries) geo.dispose();
      for (const mat of entry.materials) mat.dispose();
    }
    function recount() {
      counters.objects = entries.size; counters.points = 0; counters.lineVertices = 0; counters.bufferBytes = 0;
      for (const e of entries.values()) {
        counters.points += e.points; counters.lineVertices += e.lineVertices;
        for (const geo of e.geometries) for (const attr of Object.values(geo.attributes)) counters.bufferBytes += attr.array.byteLength;
      }
      counters.vertices = counters.points + counters.lineVertices;
      counters.drawCalls = entries.size * 2; counters.geometries = entries.size * 2; counters.materials = entries.size * 2;
    }
    function setScene(scene) {
      if (disposed) throw new Error('HologramRenderer has been disposed');
      if (scene === null || scene === undefined) { clear(); return; }
      if (!Array.isArray(scene.objects) || scene.objects.length < 1 || scene.objects.length > 40) throw new RangeError('HologramRenderer requires 1..40 safe schema objects');
      const objects = scene.objects.map(descriptor);
      if (new Set(objects.map(o => o.id)).size !== objects.length) throw new TypeError('HologramRenderer object IDs must be unique');
      const counts = budgets(objects, config), next = new Map(), allocated = [];
      try {
        for (const o of objects) {
          const count = counts.get(o.id), key = o.kind + '|' + o.size.join(',') + '|' + count;
          const old = entries.get(o.id), entry = old && old.key === key ? old : makeEntry(o, count, key);
          if (entry !== old) allocated.push(entry);
          next.set(o.id, entry);
        }
      } catch (error) { for (const entry of allocated) release(entry); throw error; }
      for (const [id, entry] of entries) if (next.get(id) !== entry) release(entry);
      entries = next; moves = explodeVectors(objects);
      for (const o of objects) {
        const entry = entries.get(o.id); entry.object = o; entry.uniforms.uColor.value.set(o.color);
        if (entry.body.parent !== group) group.add(entry.body);
      }
      counters.sceneId = typeof scene.id === 'string' ? scene.id : '';
      recount(); update([], { appearance: 1, sceneTime: 0 });
    }
    function update(states, opts) {
      if (disposed) return;
      opts = opts || {};
      const byId = new Map((Array.isArray(states) ? states : []).filter(s => s && typeof s.id === 'string').map(s => [s.id, s]));
      const p = clamp(finite(opts.appearance, 1), 0, 1), exploded = clamp(finite(opts.exploded, 0), 0, 1);
      const focus = entries.has(opts.focusId) ? opts.focusId : null;
      // sceneTime wins over wall time: seek, pause and replay give the same frame.
      const t = finite(opts.sceneTime, finite(opts.time, 0));
      counters.appearance = p; counters.sceneTime = t; counters.exploded = exploded; counters.focusId = focus;
      for (const [id, entry] of entries) {
        const o = entry.object, state = byId.get(id) || o, delta = moves.get(id) || [0, 0, 0];
        const position = vector(state.position, o.position, -8, 8), rotation = vector(state.rotation, [0, 0, 0], -25.2, 25.2), scale = vector(state.scale, [1, 1, 1], 0.05, 8);
        entry.body.position.set(position[0] + exploded * delta[0], position[1] + exploded * delta[1], position[2] + exploded * delta[2]);
        entry.body.rotation.set(rotation[0], rotation[1], rotation[2]); entry.body.scale.set(scale[0], scale[1], scale[2]);
        entry.body.updateMatrix();
        const u = entry.uniforms;
        u.uRootToPart.value.copy(entry.body.matrix).invert();
        u.uAppearance.value = p; u.uTime.value = opts.reducedMotion ? 0 : t; u.uMotion.value = opts.reducedMotion ? 0 : 1;
        u.uOpacity.value = clamp(finite(state.opacity, o.opacity), 0, 1);
        u.uDim.value = focus && focus !== id ? 0.12 : 1;
        u.uHighlight.value = Math.max(clamp(finite(state.highlight, 0), 0, 1), focus === id ? 0.8 : 0);
        entry.body.visible = u.uOpacity.value > 0;
      }
    }
    function getAnchors() {
      if (disposed) return [];
      group.updateWorldMatrix(true, true);
      // Positions are world-space, including caller-owned root/parent transforms.
      return [...entries].map(([id, entry]) => ({ id, position: entry.body.getWorldPosition(new THREE.Vector3()), local: false }));
    }
    function clear() {
      for (const entry of entries.values()) release(entry);
      entries.clear(); moves.clear(); counters.sceneId = ''; counters.focusId = null;
      counters.appearance = 1; counters.exploded = 0; counters.sceneTime = 0; recount();
    }
    function dispose() {
      if (disposed) return;
      clear(); disposed = true; counters.disposed = true;
      if (group.parent) group.parent.remove(group);
    }
    return Object.freeze({ group, setScene, update, getAnchors, clear, dispose, stats: liveStats });
  }
  return Object.freeze({ create, helpers: Object.freeze({ sampleShape, sampleEdges, appearanceProgress, explodeVectors, qualities: QUALITIES }) });
});

