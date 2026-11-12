
/* Original silk study for Three r160. No renderer, DOM, clock, listeners, or RAF.
 * Browser: JarvisCore.create(THREE, options). CommonJS: require('./jarvis-core.js').
 * Shape evaluation is shared by the GPU fiber/spine/spark layers; CPU sampling is
 * used only at construction and by the pure tests. Positions never upload again.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else if (typeof define === 'function' && define.amd) define([], factory);
  else root.JarvisCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var TAU = Math.PI * 2;
  var RADIUS = 2.2;
  var DEFAULT_SEED = 0x51a7c0de;
  var TIERS = Object.freeze({
    low: Object.freeze({ fibers: 384, samples: 128, particles: 4000, lineEnergy: 0.44 }),
    medium: Object.freeze({ fibers: 936, samples: 192, particles: 10000, lineEnergy: 0.30 }),
    high: Object.freeze({ fibers: 1632, samples: 256, particles: 20000, lineEnergy: 0.23 })
  });
  // radius, lobe amount, lift, phase, half-width, thickness, integral twist,
  // direction, pitch, yaw, roll, warm affinity. These are authored, not recovered.
  var BANDS = [
    [1.28, 0.13, 0.38, 0.24, 0.42, 0.029,  1,  1,  0.54,  0.32,  0.18, 0.05],
    [1.30, 0.10, 0.31, 1.11, 0.34, 0.025, -1, -1, -0.61,  0.49, -0.32, 0.94],
    [1.24, 0.16, 0.42, 2.03, 0.46, 0.034,  2,  1,  0.83, -0.46,  0.67, 0.10],
    [1.38, 0.09, 0.27, 2.84, 0.28, 0.021,  1, -1, -0.39, -0.68,  1.07, 0.26],
    [1.21, 0.15, 0.43, 3.72, 0.49, 0.031, -2,  1,  1.02,  0.26, -0.78, 0.91],
    [1.34, 0.11, 0.34, 4.51, 0.32, 0.025, -1, -1, -0.91,  0.14,  0.37, 0.03],
    [1.27, 0.14, 0.37, 5.29, 0.39, 0.030,  1,  1,  0.28,  0.91, -0.47, 0.13],
    [1.36, 0.08, 0.29, 5.96, 0.30, 0.023,  2, -1, -0.21, -0.86,  0.84, 0.84]
  ].map(function (band) { return Object.freeze(band); });
  Object.freeze(BANDS);

  var STATES = Object.freeze({
    idle: Object.freeze({ speed: 0.27, turbulence: 0.22, expand: 1, bright: 1, warm: 0.36, morph: 0 }),
    thinking: Object.freeze({ speed: 0.48, turbulence: 0.30, expand: 1, bright: 1.16, warm: 0.72, morph: 1 }),
    speaking: Object.freeze({ speed: 0.31, turbulence: 0.18, expand: 1, bright: 1.10, warm: 0.43, morph: 1 }),
    error: Object.freeze({ speed: 0.14, turbulence: 0.13, expand: 0.98, bright: 1.16, warm: 0.98, morph: 0.16 })
  });
  var INITIAL = Object.freeze({ time: 0, phase: 0, roll: 0, morph: 0, turbulence: 0.22, vibration: 0, expand: 1 });
  var MID_SEED = Object.freeze([0.5, 0.5, 0.5, 0.5]);

  function finite(value, fallback) { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }
  function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
  function smooth(value) { value = clamp(value, 0, 1); return value * value * (3 - 2 * value); }
  function resolveQuality(options) {
    options = options || {};
    return options.lowPower === true ? 'low' : (Object.prototype.hasOwnProperty.call(TIERS, options.quality) ? options.quality : 'medium');
  }
  function rng(seed) {
    var state = seed >>> 0;
    return function () {
      state = (state + 0x6d2b79f5) >>> 0;
      var value = Math.imul(state ^ (state >>> 15), state | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }
  function distributeFibers(total) {
    var sum = 0, counts = new Uint16Array(8), assigned = 0;
    for (var i = 0; i < 8; i++) sum += BANDS[i][4];
    for (var j = 0; j < 8; j++) {
      counts[j] = Math.floor(total * BANDS[j][4] / sum);
      assigned += counts[j];
    }
    for (var k = 0; assigned < total; k = (k + 1) % 8, assigned++) counts[k]++;
    return counts;
  }

  // Pure mirror of corePoint below. The out array is reusable (including in init).
  // A double traversal closes an off-center fiber on a genuine half-twisted band.
  // The depth-separated waist gives the thinking band a folded infinity silhouette,
  // rather than substituting a circular tube/torus for the silk knot.
  function sampleCurve(t, lateral, depth, ribbon, seed, controls, out) {
    seed = seed || MID_SEED;
    controls = controls || INITIAL;
    out = out || new Float64Array(3);
    var band = BANDS[clamp(Math.floor(ribbon), 0, 7)];
    var time = finite(controls.time, 0), phase = finite(controls.phase, 0), roll = finite(controls.roll, 0);
    var turbulence = finite(controls.turbulence, 0.22), vibration = finite(controls.vibration, 0);
    var theta = TAU * t + band[3] + phase * band[7] * 0.18;
    var s = Math.sin(theta), c = Math.cos(theta), p = band[3];
    var r = band[0] * (1 + band[1] * Math.sin(3 * theta + p) + 0.055 * Math.cos(2 * theta - p));
    var dr = band[0] * (3 * band[1] * Math.cos(3 * theta + p) - 0.11 * Math.sin(2 * theta - p));
    var tx = dr * c - r * s, ty = 0.82 * (dr * s + r * c);
    var tz = 2 * band[2] * Math.cos(2 * theta + p) - 0.21 * Math.sin(3 * theta - p);
    var inv = 1 / Math.hypot(tx, ty, tz); tx *= inv; ty *= inv; tz *= inv;
    var dot = c * tx + s * ty;
    var nx = c - dot * tx, ny = s - dot * ty, nz = -dot * tz;
    inv = 1 / Math.hypot(nx, ny, nz); nx *= inv; ny *= inv; nz *= inv;
    var bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
    var twist = band[6] * theta + p + 0.16 * roll * band[7];
    var ct = Math.cos(twist), st = Math.sin(twist);
    var ax = nx * ct + bx * st, ay = ny * ct + by * st, az = nz * ct + bz * st;
    var dx = bx * ct - nx * st, dy = by * ct - ny * st, dz = bz * ct - nz * st;
    var seedPhase = TAU * seed[1];
    var width = lateral * band[4] * (0.86 + 0.14 * Math.cos(theta + p) * Math.cos(theta + p));
    width += 0.006 * Math.sin(7 * theta + seedPhase + 0.21 * time);
    var fine = depth * band[5] + 0.010 * turbulence * Math.sin(5 * theta + seedPhase - 0.23 * time);
    fine += vibration * 0.006 * (Math.sin(36 * theta + 11 * time + seedPhase) + 0.4 * Math.sin(71 * theta - 17 * time));
    var x = r * c + ax * width + dx * fine;
    var y = 0.82 * r * s + ay * width + dy * fine;
    var z = band[2] * Math.sin(2 * theta + p) + 0.07 * Math.cos(3 * theta - p) + az * width + dz * fine;
    // A low-frequency coherent field bends the fabric, never a random vertex walk.
    var oldX = x, oldY = y, oldZ = z;
    x += 0.035 * turbulence * Math.sin(2.1 * oldY + 0.31 * time + p);
    y += 0.035 * turbulence * Math.sin(2.3 * oldZ - 0.27 * time + p);
    z += 0.035 * turbulence * Math.sin(2.0 * oldX + 0.29 * time - p);
    ct = Math.cos(band[8]); st = Math.sin(band[8]);
    oldY = y * ct - z * st; z = y * st + z * ct; y = oldY;
    ct = Math.cos(band[9]); st = Math.sin(band[9]);
    oldX = x * ct + z * st; z = -x * st + z * ct; x = oldX;
    ct = Math.cos(band[10]); st = Math.sin(band[10]);
    oldX = x * ct - y * st; y = x * st + y * ct; x = oldX;

    var mt = 2 * TAU * t + 0.11 * phase;
    var ms = Math.sin(mt), mc = Math.cos(mt);
    tx = 1.43 * mc; ty = 1.34 * Math.cos(2 * mt); tz = -0.44 * ms;
    inv = 1 / Math.hypot(tx, ty, tz); tx *= inv; ty *= inv; tz *= inv;
    inv = 1 / Math.hypot(tx, ty);
    nx = -ty * inv; ny = tx * inv; nz = 0;
    bx = -tz * ny; by = tz * nx; bz = tx * ny - ty * nx;
    var half = 0.5 * mt + 0.24 + 0.13 * Math.sin(0.27 * roll);
    var lane = Math.floor((2 * seed[3] - 1) * 64 + 0.5) / 64 + (seed[0] - 0.5) * 0.009;
    var cross = lane * 0.57 * (0.88 + 0.12 * ms * ms);
    var cushion = depth * 0.012 + (ribbon - 3.5) * 0.0025;
    ct = Math.cos(half); st = Math.sin(half);
    var mx = 1.43 * ms + cross * (nx * ct + bx * st) + bx * cushion;
    var my = 0.67 * Math.sin(2 * mt) + cross * (ny * ct + by * st) + by * cushion;
    var mz = 0.44 * mc + cross * bz * st + bz * cushion;
    mz += 0.006 * vibration * Math.sin(28 * mt + 9 * time + seedPhase);
    ct = Math.cos(-0.22); st = Math.sin(-0.22);
    oldX = mx * ct - my * st; my = mx * st + my * ct; mx = oldX;
    var morph = smooth(1.12 * clamp(finite(controls.morph, 0), 0, 1) - 0.12 * seed[2]);
    var expand = finite(controls.expand, 1);
    x = (x + (mx - x) * morph) * expand;
    y = (y + (my - y) * morph) * expand;
    z = (z + (mz - z) * morph) * expand;
    var bounded = Math.min(1, 2.16 / Math.max(Math.hypot(x, y, z), 0.0001));
    out[0] = x * bounded; out[1] = y * bounded; out[2] = z * bounded;
    return out;
  }

  var SHAPE_GLSL = `
    #define CORE_TAU 6.283185307179586
    uniform vec4 uBandA[8];
    uniform vec4 uBandB[8];
    uniform vec4 uBandC[8];
    uniform float uTime, uPhase, uRoll, uMorph, uTurbulence, uVibration, uExpand;
    uniform float uBright, uWarmth, uGain, uLineEnergy, uPixelRatio;
    uniform vec3 uCold, uDeep, uAmber, uIce;
    attribute vec4 aParam;
    attribute vec4 aSeed;
    vec3 corePoint(vec4 param, vec4 seed) {
      int id = int(param.w + 0.5);
      vec4 A = uBandA[id], B = uBandB[id], C = uBandC[id];
      float theta = CORE_TAU * param.x + A.w + uPhase * B.w * 0.18;
      float s = sin(theta), c = cos(theta);
      float r = A.x * (1.0 + A.y * sin(3.0 * theta + A.w) + 0.055 * cos(2.0 * theta - A.w));
      float dr = A.x * (3.0 * A.y * cos(3.0 * theta + A.w) - 0.11 * sin(2.0 * theta - A.w));
      vec3 tangent = normalize(vec3(dr*c-r*s, 0.82*(dr*s+r*c), 2.0*A.z*cos(2.0*theta+A.w)-0.21*sin(3.0*theta-A.w)));
      vec3 radial = vec3(c, s, 0.0);
      vec3 normal = normalize(radial - tangent * dot(radial, tangent));
      vec3 binormal = cross(tangent, normal);
      float twist = B.z * theta + A.w + 0.16 * uRoll * B.w;
      vec3 across = normal * cos(twist) + binormal * sin(twist);
      vec3 deep = binormal * cos(twist) - normal * sin(twist);
      float seedPhase = CORE_TAU * seed.y;
      float widthWave = cos(theta + A.w);
      float width = param.y * B.x * (0.86 + 0.14 * widthWave * widthWave);
      width += 0.006 * sin(7.0 * theta + seedPhase + 0.21 * uTime);
      float fine = param.z * B.y + 0.010 * uTurbulence * sin(5.0 * theta + seedPhase - 0.23 * uTime);
      fine += uVibration * 0.006 * (sin(36.0*theta+11.0*uTime+seedPhase) + 0.4*sin(71.0*theta-17.0*uTime));
      vec3 p = vec3(r*c, 0.82*r*s, A.z*sin(2.0*theta+A.w)+0.07*cos(3.0*theta-A.w)) + across*width + deep*fine;
      p += 0.035 * uTurbulence * sin(vec3(2.1*p.y+0.31*uTime+A.w, 2.3*p.z-0.27*uTime+A.w, 2.0*p.x+0.29*uTime-A.w));
      p.yz = mat2(cos(C.x), sin(C.x), -sin(C.x), cos(C.x)) * p.yz;
      p.xz = mat2(cos(C.y), -sin(C.y), sin(C.y), cos(C.y)) * p.xz;
      p.xy = mat2(cos(C.z), sin(C.z), -sin(C.z), cos(C.z)) * p.xy;

      float mt = 2.0 * CORE_TAU * param.x + 0.11 * uPhase;
      float ms = sin(mt), mc = cos(mt);
      vec3 tangentM = normalize(vec3(1.43*mc, 1.34*cos(2.0*mt), -0.44*ms));
      vec3 normalM = normalize(vec3(-tangentM.y, tangentM.x, 0.0));
      vec3 binormalM = cross(tangentM, normalM);
      float halfTwist = 0.5*mt + 0.24 + 0.13*sin(0.27*uRoll);
      float lane = floor((2.0*seed.w-1.0)*64.0+0.5)/64.0 + (seed.x-0.5)*0.009;
      float crossWidth = lane * 0.57 * (0.88+0.12*ms*ms);
      float cushion = param.z*0.012 + (param.w-3.5)*0.0025;
      vec3 mobius = vec3(1.43*ms, 0.67*sin(2.0*mt), 0.44*mc);
      mobius += crossWidth * (normalM*cos(halfTwist) + binormalM*sin(halfTwist)) + binormalM*cushion;
      mobius.z += 0.006*uVibration*sin(28.0*mt+9.0*uTime+seedPhase);
      mobius.xy = mat2(cos(-0.22), sin(-0.22), -sin(-0.22), cos(-0.22)) * mobius.xy;
      float amount = smoothstep(0.0, 1.0, clamp(1.12*uMorph-0.12*seed.z, 0.0, 1.0));
      p = mix(p, mobius, amount) * uExpand;
      return p * min(1.0, 2.16/max(length(p), 0.0001));
    }
    float coreScan(float t, float direction, float seed) {
      float sweep = 0.5 + 0.5*cos(2.0*CORE_TAU*t - 2.8*uPhase*mix(direction, 1.0, uMorph) + 0.55*seed);
      return pow(sweep, 6.0);
    }
    float coreWarm(float ribbon, float seed) {
      float affinity = uBandC[int(ribbon+0.5)].w;
      return clamp(0.02 + affinity*(0.58+0.53*uWarmth) + (seed-0.5)*0.08, 0.0, 1.0);
    }
    float coreDepth(vec4 viewPosition) {
      float relativeDepth = viewPosition.z - modelViewMatrix[3].z;
      return mix(0.46, 1.0, smoothstep(-2.2, 2.2, relativeDepth));
    }
  `;
  var LINE_VERTEX = SHAPE_GLSL + `
    varying float vScan, vWarm, vEnergy;
    void main() {
      vec3 p = corePoint(aParam, aSeed);
      vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
      float direction = uBandB[int(aParam.w+0.5)].w;
      vScan = coreScan(aParam.x, direction, aSeed.y);
      vWarm = coreWarm(aParam.w, aSeed.z);
      float detail = 0.70 + 0.30*sin(9.0*CORE_TAU*aParam.x + 8.0*aSeed.y);
      #ifdef SPINE_LAYER
        float weight = 0.30 * (0.28 + 0.72*vScan);
      #else
        float weight = uLineEnergy * (0.18 + 0.82*aSeed.x) * (0.12 + 0.72*vScan) * detail;
      #endif
      // Converging fibers overlap more: preserve dark gaps instead of whitening.
      vEnergy = weight * mix(1.0, 0.67, uMorph) * uBright * uGain * coreDepth(viewPosition);
      gl_Position = projectionMatrix * viewPosition;
    }
  `;
  var LINE_FRAGMENT = `
    uniform vec3 uCold, uDeep, uAmber, uIce;
    varying float vScan, vWarm, vEnergy;
    void main() {
      vec3 cold = mix(uDeep, uCold, 0.40+0.60*vScan);
      vec3 color = mix(cold, uAmber, vWarm);
      color = mix(color, uIce, 0.10*pow(vScan, 4.0));
      gl_FragColor = vec4(color * (1.15+1.45*vScan), clamp(vEnergy, 0.0, 0.86));
      // Linear HDR; the host owns the single ACES + sRGB output pass.
    }
  `;
  var SPARK_VERTEX = SHAPE_GLSL + `
    varying float vWarm, vEnergy, vTwinkle;
    void main() {
      vec4 param = aParam;
      float direction = uBandB[int(param.w+0.5)].w;
      param.x = fract(param.x + uPhase*(0.018+0.020*aSeed.x)*mix(direction, 1.0, uMorph));
      vec3 p = corePoint(param, aSeed);
      float life = fract(uTime*(0.075+0.055*aSeed.z) + aSeed.y);
      vTwinkle = pow(0.5+0.5*sin(uTime*(1.3+2.2*aSeed.w)+aSeed.z*61.0), 9.0);
      float scan = coreScan(param.x, direction, aSeed.y);
      float weight;
      #ifdef DRIFT_LAYER
        vec3 outward = normalize(p + vec3(0.17*sin(13.0*aSeed.x), 0.13*cos(19.0*aSeed.y), 0.11));
        p += outward * (0.03 + 0.34*life*life);
        p += 0.027*sin(vec3(aSeed.x*31.0, aSeed.y*47.0, aSeed.z*29.0) + uTime*0.25);
        p *= min(1.0, 2.2/max(length(p), 0.0001));
        weight = 0.24*smoothstep(0.02, 0.17, life)*(1.0-smoothstep(0.65, 0.99, life));
        weight *= 0.35+0.65*vTwinkle;
      #else
        weight = (0.075+0.18*scan+0.42*vTwinkle)*(0.25+0.75*aSeed.x);
      #endif
      vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
      vWarm = coreWarm(param.w, aSeed.z);
      vEnergy = weight * mix(1.0, 0.72, uMorph) * uBright * uGain * coreDepth(viewPosition);
      float size = (1.15+1.60*aSeed.x+0.80*vTwinkle) * uPixelRatio;
      gl_PointSize = clamp(size*7.0/max(1.0,-viewPosition.z), 1.0, 5.0*uPixelRatio);
      gl_Position = projectionMatrix * viewPosition;
    }
  `;
  var SPARK_FRAGMENT = `
    uniform vec3 uCold, uAmber, uIce;
    varying float vWarm, vEnergy, vTwinkle;
    void main() {
      vec2 uv = 2.0*gl_PointCoord-1.0;
      float r2 = dot(uv, uv);
      if (r2 > 1.0) discard;
      float halo = exp(-5.0*r2)*(1.0-smoothstep(0.55,1.0,r2));
      float pin = exp(-48.0*r2);
      float glint = (1.0-smoothstep(0.015,0.12,abs(uv.x)))*(1.0-smoothstep(0.1,0.95,abs(uv.y)));
      float alpha = (0.42*halo+0.92*pin+0.18*vTwinkle*glint)*vEnergy;
      vec3 color = mix(mix(uCold,uAmber,vWarm),uIce,0.28*pin);
      gl_FragColor = vec4(color*(1.8+2.0*pin+0.8*vTwinkle),clamp(alpha,0.0,0.9));
      // Linear HDR; the host owns the single ACES + sRGB output pass.
    }
  `;

  function buildAttributes(fibers, samples, random, spines) {
    var count = fibers * samples;
    var position = new Float32Array(count * 3), param = new Float32Array(count * 4), seeds = new Float32Array(count * 4);
    var Index = count <= 65536 ? Uint16Array : Uint32Array;
    var index = new Index(count * 2), counts = spines ? new Uint16Array([1,1,1,1,1,1,1,1]) : distributeFibers(fibers);
    var fiber = 0, scratch = new Float64Array(3), seed = new Float64Array(4);
    for (var band = 0; band < 8; band++) {
      for (var lane = 0; lane < counts[band]; lane++, fiber++) {
        var lateral = spines ? 0 : -1 + 2 * (lane + 0.15 + 0.7 * random()) / counts[band];
        var depth = spines ? 0 : 2 * random() - 1;
        seed[0] = spines ? 1 : random(); seed[1] = random(); seed[2] = random();
        seed[3] = spines ? (band + 0.5) / 8 : (lane + random()) / counts[band];
        for (var step = 0; step < samples; step++) {
          var vertex = fiber * samples + step, at = vertex * 4;
          var t = step / samples;
          param[at] = t; param[at+1] = lateral; param[at+2] = depth; param[at+3] = band;
          seeds[at] = seed[0]; seeds[at+1] = seed[1]; seeds[at+2] = seed[2]; seeds[at+3] = seed[3];
          sampleCurve(t, lateral, depth, band, seed, INITIAL, scratch);
          position[vertex*3] = scratch[0]; position[vertex*3+1] = scratch[1]; position[vertex*3+2] = scratch[2];
          index[vertex*2] = vertex;
          index[vertex*2+1] = fiber*samples + (step+1)%samples;
        }
      }
    }
    return { position: position, param: param, seeds: seeds, index: index };
  }
  function buildSparks(count, random) {
    var position = new Float32Array(count*3), param = new Float32Array(count*4), seeds = new Float32Array(count*4);
    var scratch = new Float64Array(3), seed = new Float64Array(4), counts = distributeFibers(1024), cumulative = new Float64Array(8);
    var sum = 0;
    for (var b = 0; b < 8; b++) { sum += counts[b]; cumulative[b] = sum / 1024; }
    for (var i = 0; i < count; i++) {
      var choose = random(), band = 0;
      while (band < 7 && choose > cumulative[band]) band++;
      var t = random(), lateral = random()*2-1, depth = random()*2-1, at = i*4;
      for (var k = 0; k < 4; k++) { seed[k] = random(); seeds[at+k] = seed[k]; }
      param[at] = t; param[at+1] = lateral; param[at+2] = depth; param[at+3] = band;
      sampleCurve(t,lateral,depth,band,seed,INITIAL,scratch);
      position[i*3] = scratch[0]; position[i*3+1] = scratch[1]; position[i*3+2] = scratch[2];
    }
    return { position: position, param: param, seeds: seeds };
  }

  function create(THREE, options) {
    options = options || {};
    if (!THREE || !THREE.Group || !THREE.ShaderMaterial || !THREE.BufferGeometry || !THREE.LineSegments || !THREE.Points) {
      throw new TypeError('JarvisCore.create requires the host Three r160 namespace.');
    }
    var quality = resolveQuality(options), tier = TIERS[quality];
    var seed = finite(options.seed, DEFAULT_SEED) >>> 0;
    var group = new THREE.Group(); group.name = 'JarvisCore';
    var disposed = false, geometries = [], materials = [], bytes = 0;
    var driver = { time: 0, lastTime: NaN, phase: 0, roll: 0, morph: 0, speed: STATES.idle.speed,
      turbulence: STATES.idle.turbulence, expand: 1, bright: 1, warm: STATES.idle.warm, gain: 1, vibration: 0, speech: 0 };
    var uniforms = {
      uBandA: { value: BANDS.map(function (b) { return new THREE.Vector4(b[0],b[1],b[2],b[3]); }) },
      uBandB: { value: BANDS.map(function (b) { return new THREE.Vector4(b[4],b[5],b[6],b[7]); }) },
      uBandC: { value: BANDS.map(function (b) { return new THREE.Vector4(b[8],b[9],b[10],b[11]); }) },
      uTime: {value:0}, uPhase: {value:0}, uRoll: {value:0}, uMorph: {value:0}, uTurbulence: {value:driver.turbulence},
      uVibration: {value:0}, uExpand: {value:1}, uBright: {value:1}, uWarmth: {value:driver.warm}, uGain: {value:1},
      uLineEnergy: {value:tier.lineEnergy}, uPixelRatio: {value:clamp(finite(options.pixelRatio,1),0.75,options.lowPower ? 1.5 : 2)},
      // THREE.Color decodes these sRGB literals into linear radiance for the shaders.
      uCold: {value:new THREE.Color(0x35cbe9)}, uDeep: {value:new THREE.Color(0x125491)},
      uAmber: {value:new THREE.Color(0xffb557)}, uIce: {value:new THREE.Color(0xc9f6ff)}
    };
    function geometry(data) {
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(data.position,3));
      geo.setAttribute('aParam', new THREE.BufferAttribute(data.param,4));
      geo.setAttribute('aSeed', new THREE.BufferAttribute(data.seeds,4));
      bytes += data.position.byteLength + data.param.byteLength + data.seeds.byteLength;
      if (data.index) { geo.setIndex(new THREE.BufferAttribute(data.index,1)); bytes += data.index.byteLength; }
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(),RADIUS);
      geometries.push(geo);
      return geo;
    }
    function material(vertexShader,fragmentShader,defines) {
      var mat = new THREE.ShaderMaterial({
        name: 'JarvisSilk', uniforms: uniforms, defines: defines || {}, vertexShader: vertexShader, fragmentShader: fragmentShader,
        transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
        toneMapped: false, premultipliedAlpha: false, linewidth: 1
      });
      materials.push(mat);
      return mat;
    }
    function mount(object,name,order) {
      object.name = name; object.renderOrder = order; object.frustumCulled = false;
      group.add(object);
    }
    mount(new THREE.LineSegments(geometry(buildAttributes(tier.fibers,tier.samples,rng(seed),false)),
      material(LINE_VERTEX,LINE_FRAGMENT)), 'Silk connected fibers', 10);
    mount(new THREE.LineSegments(geometry(buildAttributes(8,tier.samples,rng(seed^0x9e3779b9),true)),
      material(LINE_VERTEX,LINE_FRAGMENT,{SPINE_LAYER:1})), 'Eight ribbon backbones', 11);
    var drifting = Math.floor(tier.particles*0.2), embedded = tier.particles-drifting;
    mount(new THREE.Points(geometry(buildSparks(embedded,rng(seed^0x71e257ab))),
      material(SPARK_VERTEX,SPARK_FRAGMENT)), 'Silk traveling pin sparks', 12);
    mount(new THREE.Points(geometry(buildSparks(drifting,rng(seed^0xb5297a4d))),
      material(SPARK_VERTEX,SPARK_FRAGMENT,{DRIFT_LAYER:1})), 'Silk escaping embers', 13);

    var lineVertices = (tier.fibers+8)*tier.samples;
    var stats = Object.seal({ quality: quality, lowPower: options.lowPower === true, seed: seed, radius: RADIUS,
      ribbons: 8, fibers: tier.fibers, samplesPerFiber: tier.samples, lineVertices: lineVertices,
      vertices: lineVertices+tier.particles, segments: lineVertices, particles: tier.particles,
      embeddedSparks: embedded, driftingSparks: drifting, drawCalls: 4, attributeBytes: bytes,
      state: 'idle', morph: 0, gain: 1, reducedMotion: options.reducedMotion === true, disposed: false });

    function update(input) {
      if (disposed) return;
      input = input || {};
      var now = finite(input.time, Number.isFinite(driver.lastTime) ? driver.lastTime+Math.max(0,finite(input.dt,0)) : 0);
      var elapsed = Number.isFinite(driver.lastTime) ? Math.max(0,now-driver.lastTime) : Math.max(0,now);
      var dt = clamp(finite(input.dt,elapsed),0,0.1);
      driver.lastTime = now;
      var reduced = typeof input.reducedMotion === 'boolean' ? input.reducedMotion : options.reducedMotion === true;
      var state = Object.prototype.hasOwnProperty.call(STATES,input.state) ? input.state : (input.state === undefined ? stats.state : 'idle');
      var target = STATES[state];
      var fast = -Math.expm1(-5.4*dt), shapeEase = -Math.expm1(-2.8*dt), warmEase = -Math.expm1(-3.0*dt);
      driver.speed += (target.speed-driver.speed)*fast;
      driver.turbulence += (target.turbulence-driver.turbulence)*fast;
      driver.expand += (target.expand-driver.expand)*fast;
      driver.bright += (target.bright-driver.bright)*fast;
      driver.warm += (target.warm-driver.warm)*warmEase;
      driver.morph += (clamp(finite(input.morph,target.morph),0,1)-driver.morph)*shapeEase;
      driver.gain += (clamp(finite(input.gain,1),0,2)-driver.gain)*fast;
      driver.speech += ((state === 'speaking' && !reduced ? 1 : 0)-driver.speech)*fast;
      if (!reduced) {
        // Use caller time for shader animation; dt only damps state and phase.
        driver.time += elapsed;
        driver.phase += driver.speed*dt;
        driver.roll += 0.10*dt;
      }
      // Local synthetic speech shimmer, deliberately not a claimed audio envelope.
      var pulse = clamp(0.35+0.43*Math.sin(4.7*driver.time)*Math.sin(2.1*driver.time+0.7)+0.19*Math.sin(10.9*driver.time),0,1);
      driver.vibration = reduced ? 0 : driver.speech*pulse;
      uniforms.uTime.value = driver.time; uniforms.uPhase.value = driver.phase; uniforms.uRoll.value = driver.roll;
      uniforms.uMorph.value = driver.morph; uniforms.uTurbulence.value = driver.turbulence;
      uniforms.uExpand.value = driver.expand; uniforms.uBright.value = driver.bright;
      uniforms.uWarmth.value = driver.warm; uniforms.uGain.value = driver.gain; uniforms.uVibration.value = driver.vibration;
      group.visible = driver.gain > 0.0001;
      stats.state = state; stats.morph = driver.morph; stats.gain = driver.gain; stats.reducedMotion = reduced;
    }
    function dispose() {
      if (disposed) return;
      disposed = true;
      if (group.parent) group.parent.remove(group);
      group.clear();
      for (var i = 0; i < geometries.length; i++) geometries[i].dispose();
      for (var j = 0; j < materials.length; j++) materials[j].dispose();
      geometries.length = 0; materials.length = 0;
      group.visible = false; stats.disposed = true; stats.drawCalls = 0;
    }
    return { group: group, update: update, dispose: dispose, stats: stats };
  }

  return Object.freeze({ create: create, qualityTiers: TIERS, version: '2.0.0',
    // Pure construction/evaluation utilities; none execute the renderer or app.
    pure: Object.freeze({ sampleCurve: sampleCurve, distributeFibers: distributeFibers,
      resolveQuality: resolveQuality, seededRandom: rng, bands: BANDS, states: STATES }) });
});

