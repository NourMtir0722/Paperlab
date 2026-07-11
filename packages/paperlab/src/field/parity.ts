import * as THREE from 'three'
import type { DeformerInstance, SheetDims } from '../deformers/types'
import { displacePoint } from '../deformers/compose'
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
      { type: 'wave', options: { amplitude: 0.05, wavelength: 0.5, speed: 1, angle: 20, pinnedEdge: 'none' } },
    ],
    sheet: { width: 1, height: 1 },
    t: 1.234,
  },
  {
    name: 'wave: pinned top at t=2.5',
    stack: [
      { type: 'wave', options: { amplitude: 0.04, wavelength: 0.4, speed: 1.5, angle: 80, pinnedEdge: 'top' } },
    ],
    sheet: { width: 1.2, height: 1.5 },
    t: 2.5,
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
      { type: 'wave', options: { amplitude: 0.02, wavelength: 0.6, speed: 0.7, angle: 45, pinnedEdge: 'none' } },
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
${composed.functionsSrc}
${composed.displaceSrc}
out vec4 outColor;
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5) / float(${GRID - 1});
  vec3 p = vec3((uv - 0.5) * uSheet, 0.0);
  outColor = vec4(plDisplace(p, uv, uPlTime), 1.0);
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

function runCaseOnGPU(gl: WebGL2RenderingContext, c: ParityCase): Float32Array {
  const composed = buildDisplacementGLSL(c.stack, c.sheet)
  const program = gl.createProgram()!
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT))
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, buildParityFragment(c.stack, c.sheet)))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`[paperlab parity] link failed: ${gl.getProgramInfoLog(program)}`)
  }
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

/** Run every parity case. Requires a WebGL2 context with float render targets. */
export function runParityHarness(canvas?: HTMLCanvasElement): ParityResult[] {
  const cnv = canvas ?? document.createElement('canvas')
  const gl = cnv.getContext('webgl2')
  if (!gl) throw new Error('[paperlab parity] WebGL2 unavailable')
  if (!gl.getExtension('EXT_color_buffer_float')) {
    throw new Error('[paperlab parity] EXT_color_buffer_float unavailable')
  }

  const point = new THREE.Vector3()
  return parityCases.map((c) => {
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
}
