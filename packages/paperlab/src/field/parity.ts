import * as THREE from 'three'
import type { DeformerInstance, SheetDims } from '../deformers/types'
import { displacePoint } from '../deformers/compose'
import { getDeformer } from '../deformers/registry'
import { buildDisplacementGLSL } from './compose'

/**
 * Golden-vector parity: the JS (hero) and GLSL (field) implementations of a
 * deformer must produce identical displacements. This harness evaluates the
 * GLSL path on the real GPU — the stack's displacement functions run in a
 * fragment shader over an N×N grid, rendered to a float target and read
 * back — then epsilon-compares against the JS path. Browser-only (WebGL2);
 * driven by tools/parity.mjs in CI.
 */

const GRID = 48
/** highp float + sin/cos implementation differences across GPUs. */
export const PARITY_EPSILON = 5e-4

export interface ParityCase {
  name: string
  stack: DeformerInstance[]
  sheet: SheetDims
  t: number
}

export interface ParityResult {
  name: string
  maxError: number
  pass: boolean
}

/** One case per deformer feature worth guarding, both easy and adversarial. */
export const parityCases: ParityCase[] = [
  {
    name: 'roll: defaults',
    stack: [{ type: 'roll', options: { angle: 90, boundary: 0, radius: 0.12, spiral: 0.015 } }],
    sheet: { width: 1, height: 1.4 },
    t: 0,
  },
  {
    name: 'roll: tight receipt roll, rolling down',
    stack: [{ type: 'roll', options: { angle: 270, boundary: -0.4, radius: 0.07, spiral: 0.02 } }],
    sheet: { width: 1, height: 2.6 },
    t: 0,
  },
  {
    name: 'curl: bottom-right peel',
    stack: [{ type: 'curl', options: { corner: 'bottom-right', amount: 0.45, radius: 0.2, skew: 0 } }],
    sheet: { width: 1.5, height: 1 },
    t: 0,
  },
  {
    name: 'curl: skewed top-left',
    stack: [{ type: 'curl', options: { corner: 'top-left', amount: 0.7, radius: 0.3, skew: 15 } }],
    sheet: { width: 1, height: 1 },
    t: 0,
  },
  {
    name: 'bend: positive arc at an angle',
    stack: [{ type: 'bend', options: { curvature: 1.2, angle: 33 } }],
    sheet: { width: 1, height: 1.4 },
    t: 0,
  },
  {
    /**
     * The gentle end, which nothing used to cover: the gate only ever tried
     * |curvature| ≥ 0.6, and `photo-print` — the field starter preset — bends
     * at 0.35. That band is where the arc's float32 evaluation loses its
     * cancellation, and where the two paths were 6e-4 apart until `bend` was
     * rewritten in cancellation-free form. Keep a case down here.
     */
    name: 'bend: barely-there arc (the band photo-print lives in)',
    stack: [{ type: 'bend', options: { curvature: 0.35, angle: 0 } }],
    sheet: { width: 1.2, height: 0.9 },
    t: 0,
  },
  {
    name: 'bend: the gentlest arc the schema allows',
    stack: [{ type: 'bend', options: { curvature: 0.02, angle: 61 } }],
    sheet: { width: 2, height: 2.6 },
    t: 0,
  },
  {
    name: 'bend: negative arc',
    stack: [{ type: 'bend', options: { curvature: -0.8, angle: 0 } }],
    sheet: { width: 1, height: 1.4 },
    t: 0,
  },
  {
    name: 'fold: 90° hinge',
    stack: [{ type: 'fold', options: { angle: 90, offset: 0, foldAngle: 90, radius: 0.06 } }],
    sheet: { width: 1, height: 1.4 },
    t: 0,
  },
  {
    name: 'fold: deep fold, travelling down',
    stack: [{ type: 'fold', options: { angle: 270, offset: 0.2, foldAngle: 165, radius: 0.04 } }],
    sheet: { width: 1, height: 1.4 },
    t: 0,
  },
  {
    name: 'wave: free ripple at t=1.234',
    stack: [
      {
        type: 'wave',
        options: { amplitude: 0.05, wavelength: 0.5, speed: 1, angle: 20, pinnedEdge: 'none' },
      },
    ],
    sheet: { width: 1, height: 1 },
    t: 1.234,
  },
  {
    name: 'wave: pinned top at t=2.5',
    stack: [
      {
        type: 'wave',
        options: { amplitude: 0.04, wavelength: 0.4, speed: 1.5, angle: 80, pinnedEdge: 'top' },
      },
    ],
    sheet: { width: 1.2, height: 1.5 },
    t: 2.5,
  },
  {
    name: 'drape: banner hung from the top',
    stack: [
      {
        type: 'drape',
        options: { amplitude: 0.17, folds: 5, falloff: 1.6, irregular: 0.45, gather: 0.5, pinnedEdge: 'top' },
      },
    ],
    sheet: { width: 1.5, height: 8.5 },
    t: 0,
  },
  {
    name: 'drape: deep irregular folds pinned at the bottom',
    stack: [
      {
        type: 'drape',
        options: { amplitude: 0.55, folds: 11, falloff: 0.4, irregular: 1, gather: 1, pinnedEdge: 'bottom' },
      },
    ],
    sheet: { width: 2.2, height: 3 },
    t: 0,
  },
  {
    name: 'crumple: defaults',
    stack: [{ type: 'crumple', options: { amount: 0.35, scale: 3, pull: 0.4, seed: 0 } }],
    sheet: { width: 1, height: 1.4 },
    t: 0,
  },
  {
    // The adversarial one. `fract` is a sawtooth, so the two halves disagree
    // hardest where a crease lands exactly on a sample — a fine scale and a
    // seed whose fold directions are near-axis puts the most creases in
    // reach of the grid.
    name: 'crumple: fully crushed, fine creases, off-axis seed',
    stack: [{ type: 'crumple', options: { amount: 1, scale: 7.5, pull: 1, seed: 5 } }],
    sheet: { width: 1.3, height: 0.9 },
    t: 0,
  },
  {
    // Crush then curl, which is the order the crumple BEHAVIOR stacks them:
    // the creases have to be placed on the flat sheet, not on a bent one.
    name: 'stacked: crumple ∘ bend (the crumple behavior)',
    stack: [
      { type: 'crumple', options: { amount: 0.62, scale: 3.3, pull: 0.5, seed: 2 } },
      { type: 'bend', options: { curvature: 0.31, angle: 35 } },
    ],
    sheet: { width: 1.1, height: 1.4 },
    t: 0,
  },
  {
    name: 'stacked: letter-fold pair (fold ∘ fold)',
    stack: [
      { type: 'fold', options: { angle: 270, offset: 0.2333, foldAngle: 120, radius: 0.05 } },
      { type: 'fold', options: { angle: 90, offset: 0.2333, foldAngle: 100, radius: 0.08 } },
    ],
    sheet: { width: 1, height: 1.4 },
    t: 0,
  },
  {
    name: 'stacked: bend ∘ roll ∘ wave',
    stack: [
      { type: 'bend', options: { curvature: 0.6, angle: 0 } },
      { type: 'roll', options: { angle: 90, boundary: 0.1, radius: 0.15, spiral: 0 } },
      {
        type: 'wave',
        options: { amplitude: 0.02, wavelength: 0.6, speed: 0.7, angle: 45, pinnedEdge: 'none' },
      },
    ],
    sheet: { width: 1, height: 1.4 },
    t: 0.8,
  },
]

function buildParityFragment(stack: DeformerInstance[], sheet: SheetDims): string {
  const composed = buildDisplacementGLSL(stack, sheet)
  return /* glsl */ `#version 300 es
precision highp float;
uniform float uPlTime;
uniform float uPlBias;
${composed.functionsSrc}
${composed.displaceSrc}
out vec4 outColor;
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5) / float(${GRID - 1});
  vec3 p = vec3((uv - 0.5) * uSheet, 0.0);
  outColor = vec4(plDisplace(p, uv, uPlTime, uPlBias), 1.0);
}
`
}

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, src)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`[paperlab parity] shader compile failed: ${gl.getShaderInfoLog(shader)}`)
  }
  return shader
}

function runCaseOnGPU(gl: WebGL2RenderingContext, c: ParityCase, bias = 1): Float32Array {
  const composed = buildDisplacementGLSL(c.stack, c.sheet)
  const program = gl.createProgram()!
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT))
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, buildParityFragment(c.stack, c.sheet)))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`[paperlab parity] link failed: ${gl.getProgramInfoLog(program)}`)
  }
  // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's gl.useProgram, not a React hook
  gl.useProgram(program)

  for (const [name, value] of Object.entries(composed.uniforms)) {
    const loc = gl.getUniformLocation(program, name)
    if (!loc) continue
    if (typeof value === 'number') gl.uniform1f(loc, value)
    else if (value.length === 2) gl.uniform2f(loc, value[0]!, value[1]!)
    else if (value.length === 3) gl.uniform3f(loc, value[0]!, value[1]!, value[2]!)
    else gl.uniform4f(loc, value[0]!, value[1]!, value[2]!, value[3]!)
  }
  const timeLoc = gl.getUniformLocation(program, 'uPlTime')
  if (timeLoc) gl.uniform1f(timeLoc, c.t)
  const biasLoc = gl.getUniformLocation(program, 'uPlBias')
  if (biasLoc) gl.uniform1f(biasLoc, bias)

  const quad = gl.createBuffer()!
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const posLoc = gl.getAttribLocation(program, 'aPos')
  gl.enableVertexAttribArray(posLoc)
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

  const tex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, GRID, GRID, 0, gl.RGBA, gl.FLOAT, null)
  const fbo = gl.createFramebuffer()!
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  gl.viewport(0, 0, GRID, GRID)
  gl.drawArrays(gl.TRIANGLES, 0, 3)

  const out = new Float32Array(GRID * GRID * 4)
  gl.readPixels(0, 0, GRID, GRID, gl.RGBA, gl.FLOAT, out)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  return out
}

/**
 * The bias contract, checked on the GPU: a stack of strength-bearing
 * deformers must go completely flat at bias 0, and a stack of deformers that
 * opt out (roll) must ignore bias entirely. Parity alone can't catch this —
 * it only ever evaluates bias 1.
 */
function runBiasCases(gl: WebGL2RenderingContext): ParityResult[] {
  const results: ParityResult[] = []
  for (const c of parityCases) {
    const strengths = c.stack.map((i) => getDeformer(i.type).glsl?.strength !== undefined)
    // Mixed stacks flatten only partway — nothing crisp to assert.
    if (!strengths.every((h) => h === strengths[0])) continue
    const scales = strengths[0]

    const at0 = runCaseOnGPU(gl, c, 0)
    const reference = scales ? null : runCaseOnGPU(gl, c, 1)
    let maxError = 0
    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        const i4 = (row * GRID + col) * 4
        // At bias 0 a scaling stack collapses onto the flat sheet; an opted-out
        // stack must land exactly where bias 1 put it.
        const ex = reference ? reference[i4]! : (col / (GRID - 1) - 0.5) * c.sheet.width
        const ey = reference ? reference[i4 + 1]! : (row / (GRID - 1) - 0.5) * c.sheet.height
        const ez = reference ? reference[i4 + 2]! : 0
        maxError = Math.max(
          maxError,
          Math.abs(at0[i4]! - ex),
          Math.abs(at0[i4 + 1]! - ey),
          Math.abs(at0[i4 + 2]! - ez),
        )
      }
    }
    results.push({
      name: `bias: ${c.name} → ${scales ? 'flat at 0' : 'ignores bias'}`,
      maxError,
      pass: maxError < PARITY_EPSILON,
    })
  }
  return results
}

/** Run every parity case. Requires a WebGL2 context with float render targets. */
export function runParityHarness(canvas?: HTMLCanvasElement): ParityResult[] {
  const cnv = canvas ?? document.createElement('canvas')
  const gl = cnv.getContext('webgl2')
  if (!gl) throw new Error('[paperlab parity] WebGL2 unavailable')
  if (!gl.getExtension('EXT_color_buffer_float')) {
    throw new Error('[paperlab parity] EXT_color_buffer_float unavailable')
  }

  const point = new THREE.Vector3()
  const parity = parityCases.map((c) => {
    const gpu = runCaseOnGPU(gl, c)
    let maxError = 0
    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        const u = col / (GRID - 1)
        const v = row / (GRID - 1)
        point.set((u - 0.5) * c.sheet.width, (v - 0.5) * c.sheet.height, 0)
        displacePoint(point, u, v, c.stack, { t: c.t, sheet: c.sheet })
        const i4 = (row * GRID + col) * 4
        maxError = Math.max(
          maxError,
          Math.abs(gpu[i4]! - point.x),
          Math.abs(gpu[i4 + 1]! - point.y),
          Math.abs(gpu[i4 + 2]! - point.z),
        )
      }
    }
    return { name: c.name, maxError, pass: maxError < PARITY_EPSILON }
  })
  return [...parity, ...runBiasCases(gl)]
}
