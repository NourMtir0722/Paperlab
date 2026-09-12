import * as THREE from 'three'
import { BlendFunction, Effect } from 'postprocessing'

/** How many flames the haze can shimmer above at once. */
export const HAZE_SOURCES = 16

const FRAGMENT = /* glsl */ `
uniform vec4 uSources[${HAZE_SOURCES}];
uniform int uCount;
uniform float uTime;
uniform float uAmount;
uniform vec3 uWarm;
uniform float uGrade;

float hzHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float hzNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hzHash(i), hzHash(i + vec2(1.0, 0.0)), u.x), mix(hzHash(i + vec2(0.0, 1.0)), hzHash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// Heat haze: the air above a flame is hotter than the air beside it, and
// light bends through the difference. A few pixels of upward-scrolling
// displacement, only in the column above each flame, fading with height.
void mainUv(inout vec2 uv) {
  vec2 offset = vec2(0.0);
  for (int i = 0; i < ${HAZE_SOURCES}; i++) {
    if (i >= uCount) break;
    vec4 s = uSources[i];
    vec2 d = uv - s.xy;
    float h = max(s.z, 1e-4);
    float above = d.y / h;
    if (above < -0.1 || above > 3.2) continue;
    float across = abs(d.x) / (h * 0.55 + 1e-4);
    // Around the flame's own boundary as well as above it: gentle inside the
    // body, strongest in the hot column over it, gone by three flame heights.
    float column = smoothstep(0.3, 0.9, above) * (1.0 - smoothstep(1.4, 3.2, above));
    float around = smoothstep(-0.1, 0.15, above) * (1.0 - smoothstep(0.8, 1.2, above)) * 0.45;
    float m = (1.0 - smoothstep(0.45, 1.15, across)) * max(column, around) * s.w;
    vec2 q = vec2(uv.x * 140.0, uv.y * 90.0 - uTime * 3.0);
    offset += (vec2(hzNoise(q), hzNoise(q + 31.7)) - 0.5) * m;
  }
  uv += offset * uAmount;
}

// The grade: the whole frame warms as the fire grows — a few percent, no
// more (spec §7). A multiply, so black stays black.
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  outputColor = vec4(inputColor.rgb * mix(vec3(1.0), uWarm, uGrade), inputColor.a);
}
`

/**
 * Heat haze above the flames, and the warm grade of a frame with a fire in
 * it — spec §7's last two items, as one pass because both are cheap and both
 * run on the HDR frame before the tone curve.
 *
 * Fed each frame by `FxPostPass`: `sources` holds up to {@link HAZE_SOURCES}
 * flames as (screen u, screen v, flame height in screen v, strength).
 */
export class HazeGradeEffect extends Effect {
  constructor() {
    super('HazeGradeEffect', FRAGMENT, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ['uSources', new THREE.Uniform(Array.from({ length: HAZE_SOURCES }, () => new THREE.Vector4()))],
        ['uCount', new THREE.Uniform(0)],
        ['uTime', new THREE.Uniform(0)],
        // 1–3 px at 1080p, as a fraction of the frame.
        ['uAmount', new THREE.Uniform(2.2 / 1080)],
        ['uWarm', new THREE.Uniform(new THREE.Vector3(1.04, 1.0, 0.94))],
        ['uGrade', new THREE.Uniform(0)],
      ]),
    })
  }

  get sources(): THREE.Vector4[] {
    return this.uniforms.get('uSources')!.value as THREE.Vector4[]
  }

  set count(n: number) {
    this.uniforms.get('uCount')!.value = n
  }

  set time(t: number) {
    this.uniforms.get('uTime')!.value = t
  }

  /** 0 turns the shimmer off (the low tier) and keeps the grade. */
  set amount(px1080: number) {
    this.uniforms.get('uAmount')!.value = px1080 / 1080
  }

  /** 0..1 — how much of the warm grade to apply. */
  set grade(g: number) {
    this.uniforms.get('uGrade')!.value = g
  }
}
