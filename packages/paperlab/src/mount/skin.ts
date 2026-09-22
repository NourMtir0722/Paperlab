/**
 * The lemon's skin, as GLSL, in ONE place.
 *
 * Three programs draw a piece of this skin: the lemon itself, the patch a
 * sticker leaves behind when it comes off, and the sticker while it is
 * stuck — because vinyl pressed onto a dimpled peel takes the dimples. They
 * all read the same field at the same point in the host's own space, so a
 * pore under a sticker lines up with the pore beside it exactly, and the
 * sticker's relief sits in the lemon's rather than beside it. Three copies of
 * the function would be three chances for them to disagree, and the
 * disagreement is the thing a viewer would see.
 *
 * Everything is procedural and measured in world units of the host, so the
 * skin is the same fineness whatever size the object is drawn at, and there
 * is no texture to fetch, seam, or stretch.
 */
export const SKIN_GLSL = /* glsl */ `
vec3 plSkinHash3(vec3 p) {
  p = vec3(
    dot(p, vec3(127.1, 311.7, 74.7)),
    dot(p, vec3(269.5, 183.3, 246.1)),
    dot(p, vec3(113.5, 271.9, 124.6))
  );
  return fract(sin(p) * 43758.5453123);
}

float plSkinValue(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = plSkinHash3(i).x;
  float n100 = plSkinHash3(i + vec3(1.0, 0.0, 0.0)).x;
  float n010 = plSkinHash3(i + vec3(0.0, 1.0, 0.0)).x;
  float n110 = plSkinHash3(i + vec3(1.0, 1.0, 0.0)).x;
  float n001 = plSkinHash3(i + vec3(0.0, 0.0, 1.0)).x;
  float n101 = plSkinHash3(i + vec3(1.0, 0.0, 1.0)).x;
  float n011 = plSkinHash3(i + vec3(0.0, 1.0, 1.0)).x;
  float n111 = plSkinHash3(i + vec3(1.0, 1.0, 1.0)).x;
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z
  );
}

/**
 * The oil glands: a dimple per cell of a jittered 3D lattice, each its own
 * size. 0 on the open skin, up to 1 at the bottom of a pore.
 *
 * Cells rather than a noise because a citrus peel is not noisy — it is
 * PITTED, a field of distinct round hollows with skin between them, and that
 * is what catches a highlight and breaks it into a thousand points.
 */
float plSkinPores(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float pit = 0.0;
  for (int z = -1; z <= 1; z++) {
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec3 o = vec3(float(x), float(y), float(z));
        vec3 h = plSkinHash3(i + o);
        vec3 r = o + h - f;
        float radius = mix(0.45, 0.72, h.z);
        float d = length(r) / radius;
        pit = max(pit, 1.0 - smoothstep(0.0, 1.0, d));
      }
    }
  }
  return pit * pit * (3.0 - 2.0 * pit);
}

/** Pore depth in host units at this point, with a faint larger undulation over it. */
float plSkinHeight(vec3 p, float poreScale, float depth) {
  float pores = plSkinPores(p * poreScale);
  float swell = plSkinValue(p * poreScale * 0.18) - 0.5;
  return depth * (-pores + swell * 0.35);
}

/**
 * The bump, spent: a surface-gradient perturbation from screen derivatives
 * of a height in world units. The same maths as the paper's own relief.
 */
vec3 plSkinPerturb(vec3 n, float height, vec3 viewPos) {
  // Negated against the paper's own plPerturb: measured under the key, the
  // same formula lit a pit on its near wall — a bump. A pit is lit on the
  // wall that faces the light across it, which is what this gives.
  vec2 dH = -vec2(dFdx(height), dFdy(height));
  if (dH.x == 0.0 && dH.y == 0.0) return n;
  vec3 sigmaX = dFdx(viewPos);
  vec3 sigmaY = dFdy(viewPos);
  vec3 r1 = cross(sigmaY, n);
  vec3 r2 = cross(n, sigmaX);
  float det = dot(sigmaX, r1) * (gl_FrontFacing ? 1.0 : -1.0);
  if (abs(det) < 1e-12) return n;
  vec3 grad = sign(det) * (dH.x * r1 + dH.y * r2);
  return normalize(abs(det) * n - grad);
}

/**
 * The peel's colour at a point: mottled between a riper and a greener
 * yellow, darker in the pits, and turning at the two ends — green-brown at
 * the stem's button, drier at the blossom's tip.
 *
 * axial is -1 at the blossom end and +1 at the stem, along the fruit.
 */
vec3 plSkinAlbedo(vec3 p, vec3 base, float pores, float axial) {
  float mottle = plSkinValue(p * 3.2) * 0.65 + plSkinValue(p * 11.0) * 0.35;
  vec3 ripe = base * vec3(1.03, 0.93, 0.78);
  vec3 green = base * vec3(0.88, 0.96, 0.62);
  vec3 c = mix(ripe, base, smoothstep(0.25, 0.75, mottle));
  c = mix(c, green, smoothstep(0.62, 0.95, plSkinValue(p * 1.4 + 7.0)) * 0.35);
  c *= 1.0 - pores * 0.07;
  float stem = smoothstep(0.8, 0.975, axial);
  float tip = smoothstep(0.84, 0.985, -axial);
  c = mix(c, vec3(0.42, 0.40, 0.14), stem * 0.75);
  c = mix(c, vec3(0.55, 0.45, 0.17), tip * 0.6);
  return c;
}
`
