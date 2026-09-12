import * as THREE from 'three'
import type { SolverUniforms } from './params'
import {
  ADVECT,
  CURL,
  DIVERGENCE,
  FILL,
  FORCES,
  GRADIENT,
  MACCORMACK,
  MAX_SOURCES,
  PASS_VERTEX,
  PRESSURE,
  REACT,
  VORTICITY,
} from './passes'

/** Grid sizes for one tier. Both grids share the domain's aspect, so cells are square. */
export interface FluidGrid {
  /** Velocity and pressure — coarse, because they are smooth. */
  velocity: readonly [number, number]
  /** Fuel, heat, smoke, flame and air — fine, because that is what is drawn. */
  dye: readonly [number, number]
  /** Jacobi iterations for the pressure solve. */
  iterations: number
}

/** A pair of targets, read one and write the other, swapped after each pass. */
class Pair {
  read: THREE.WebGLRenderTarget
  write: THREE.WebGLRenderTarget
  constructor(w: number, h: number) {
    this.read = target(w, h)
    this.write = target(w, h)
  }
  swap(): void {
    const t = this.read
    this.read = this.write
    this.write = t
  }
  dispose(): void {
    this.read.dispose()
    this.write.dispose()
  }
}

function target(w: number, h: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  })
}

function pass(fragmentShader: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: PASS_VERTEX,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  })
}

/**
 * A fire, simulated on the GPU: a 2D grid fluid with combustion.
 *
 * Owns its render targets and the passes over them, and nothing about where
 * the fire is drawn — `FxFireFluid` places it. Every step reads the burning
 * rim as a list of emission points (position, radius, strength) the caller
 * works out on the CPU from the damage field, so nothing is ever read back
 * from the GPU.
 */
export class FireFluid {
  /** (fuel, heat, smoke, flame) on the fine grid — what is drawn. */
  readonly scalars: Pair
  /** (premixed oxygen, ambient oxygen, burn rate, –) on the fine grid. */
  readonly air: Pair
  readonly velocity: Pair
  readonly pressure: Pair
  private readonly divergence: THREE.WebGLRenderTarget
  private readonly curl: THREE.WebGLRenderTarget
  /** The two intermediate advections the MacCormack step compares. */
  private readonly forward: THREE.WebGLRenderTarget
  private readonly backward: THREE.WebGLRenderTarget
  /**
   * Error-compensated advection for the drawn fields. On by default; off is
   * a single semi-Lagrangian step, which is two passes a step cheaper and
   * visibly softer — a knob for the lowest tier, and for an A/B.
   */
  sharp = true
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly mesh: THREE.Mesh
  private readonly m: Record<string, THREE.ShaderMaterial>
  private readonly sources: THREE.Vector4[] = Array.from({ length: MAX_SOURCES }, () => new THREE.Vector4())

  /** Whether this renderer can draw into half-float targets at all. */
  static supported(renderer: THREE.WebGLRenderer): boolean {
    return (
      renderer.capabilities.isWebGL2 &&
      (renderer.extensions.has('EXT_color_buffer_float') ||
        renderer.extensions.has('EXT_color_buffer_half_float'))
    )
  }

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    readonly grid: FluidGrid,
    /** The domain's size in world units — width, height. */
    readonly domain: { width: number; height: number },
  ) {
    const [vw, vh] = grid.velocity
    const [dw, dh] = grid.dye
    this.scalars = new Pair(dw, dh)
    this.air = new Pair(dw, dh)
    this.velocity = new Pair(vw, vh)
    this.pressure = new Pair(vw, vh)
    this.divergence = target(vw, vh)
    this.curl = target(vw, vh)
    this.forward = target(dw, dh)
    this.backward = target(dw, dh)

    const aspect = domain.width / domain.height
    const vTexel = new THREE.Vector2(1 / vw, 1 / vh)
    const cell = domain.width / vw
    const shared = { uSources: { value: this.sources }, uCount: { value: 0 }, uAspect: { value: aspect } }
    this.m = {
      advect: pass(ADVECT, {
        uVelocity: { value: null },
        uSource: { value: null },
        uDomain: { value: new THREE.Vector2(domain.width, domain.height) },
        uDt: { value: 0 },
        uKeep: { value: new THREE.Vector4(1, 1, 1, 1) },
      }),
      react: pass(REACT, {
        ...shared,
        uA: { value: null },
        uB: { value: null },
        uOut: { value: 0 },
        uDt: { value: 0 },
        uFuel: { value: 0 },
        uHeat: { value: 0 },
        uSmoke: { value: 0 },
        uPremixed: { value: 0 },
        uAmbient: { value: 0 },
        uBurnRate: { value: 0 },
        uHeatRelease: { value: 0 },
        uCooling: { value: 0 },
        uSmokeProduction: { value: 0 },
        uSmokeFade: { value: 1 },
        uPersistence: { value: 0.1 },
      }),
      forces: pass(FORCES, {
        ...shared,
        uVelocity: { value: null },
        uA: { value: null },
        uTexel: { value: vTexel },
        uDt: { value: 0 },
        uTime: { value: 0 },
        uBuoyancy: { value: 0 },
        uWind: { value: 0 },
        uTurbulence: { value: 0 },
        uTurbScale: { value: 1 },
        uRadial: { value: 0 },
        uInitVel: { value: new THREE.Vector2() },
      }),
      curl: pass(CURL, { uVelocity: { value: null }, uTexel: { value: vTexel }, uCell: { value: cell } }),
      vorticity: pass(VORTICITY, {
        uVelocity: { value: null },
        uCurl: { value: null },
        uTexel: { value: vTexel },
        uCell: { value: cell },
        uDt: { value: 0 },
        uVorticity: { value: 0 },
      }),
      divergence: pass(DIVERGENCE, {
        uVelocity: { value: null },
        uB: { value: null },
        uTexel: { value: vTexel },
        uCell: { value: cell },
        uExpansion: { value: 0 },
      }),
      pressure: pass(PRESSURE, {
        uPressure: { value: null },
        uDivergence: { value: null },
        uTexel: { value: vTexel },
        uCell: { value: cell },
      }),
      gradient: pass(GRADIENT, {
        uVelocity: { value: null },
        uPressure: { value: null },
        uTexel: { value: vTexel },
        uCell: { value: cell },
      }),
      fill: pass(FILL, { uValue: { value: new THREE.Vector4() } }),
      maccormack: pass(MACCORMACK, {
        uVelocity: { value: null },
        uSource: { value: null },
        uForward: { value: null },
        uBackward: { value: null },
        uDomain: { value: new THREE.Vector2(domain.width, domain.height) },
        uTexel: { value: new THREE.Vector2(1 / dw, 1 / dh) },
        uDt: { value: 0 },
      }),
    }
    const triangle = new THREE.BufferGeometry()
    triangle.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
    )
    this.mesh = new THREE.Mesh(triangle, this.m.fill)
    this.mesh.frustumCulled = false
    this.scene.add(this.mesh)
  }

  /** Empty air, at the given ambient oxygen. */
  reset(ambient: number): void {
    this.withRenderer(() => {
      const fill = this.m.fill!
      const value = fill.uniforms.uValue!.value as THREE.Vector4
      value.set(0, 0, 0, 0)
      for (const t of [this.scalars, this.velocity, this.pressure]) {
        this.run(fill, t.read)
        this.run(fill, t.write)
      }
      this.run(fill, this.divergence)
      this.run(fill, this.curl)
      value.set(0, ambient, 0, 0)
      this.run(fill, this.air.read)
      this.run(fill, this.air.write)
    })
  }

  /**
   * One step of `dt` seconds. `sources` is (u, v, radius, strength) per
   * point, `count` of them; `time` drives the turbulence.
   */
  step(dt: number, u: SolverUniforms, sources: Float32Array, count: number, time: number): void {
    const n = Math.min(MAX_SOURCES, count)
    for (let i = 0; i < n; i++) this.sources[i]!.fromArray(sources, i * 4)
    const m = this.m
    for (const name of ['react', 'forces'] as const) m[name]!.uniforms.uCount!.value = n

    this.withRenderer(() => {
      // 1. Carry everything along the flow.
      const advect = m.advect!
      advect.uniforms.uDt!.value = dt
      advect.uniforms.uVelocity!.value = this.velocity.read.texture
      ;(advect.uniforms.uKeep!.value as THREE.Vector4).set(0.998, 0.998, 1, 1)
      advect.uniforms.uSource!.value = this.velocity.read.texture
      this.run(advect, this.velocity.write)
      this.velocity.swap()
      advect.uniforms.uVelocity!.value = this.velocity.read.texture
      ;(advect.uniforms.uKeep!.value as THREE.Vector4).set(1, 1, 1, 1)
      if (this.sharp) {
        // What is drawn, advected with its own error given back — see
        // MACCORMACK. Forward, back again, then the corrected, clamped result.
        advect.uniforms.uSource!.value = this.scalars.read.texture
        this.run(advect, this.forward)
        advect.uniforms.uDt!.value = -dt
        advect.uniforms.uSource!.value = this.forward.texture
        this.run(advect, this.backward)
        advect.uniforms.uDt!.value = dt
        const mc = m.maccormack!
        mc.uniforms.uDt!.value = dt
        mc.uniforms.uVelocity!.value = this.velocity.read.texture
        mc.uniforms.uSource!.value = this.scalars.read.texture
        mc.uniforms.uForward!.value = this.forward.texture
        mc.uniforms.uBackward!.value = this.backward.texture
        this.run(mc, this.scalars.write)
      } else {
        advect.uniforms.uSource!.value = this.scalars.read.texture
        this.run(advect, this.scalars.write)
      }
      this.scalars.swap()
      advect.uniforms.uSource!.value = this.air.read.texture
      this.run(advect, this.air.write)
      this.air.swap()

      // 2. Release gas at the rim, and burn what has oxygen.
      const react = m.react!
      const r = react.uniforms
      r.uDt!.value = dt
      r.uFuel!.value = u.fuel
      r.uHeat!.value = u.heat
      r.uSmoke!.value = u.smoke
      r.uPremixed!.value = u.premixed
      r.uAmbient!.value = u.ambient
      r.uBurnRate!.value = u.burnRate
      r.uHeatRelease!.value = u.heatRelease
      r.uCooling!.value = u.cooling
      r.uSmokeProduction!.value = u.smokeProduction
      r.uSmokeFade!.value = u.smokeFade
      r.uPersistence!.value = u.persistence
      r.uA!.value = this.scalars.read.texture
      r.uB!.value = this.air.read.texture
      r.uOut!.value = 0
      this.run(react, this.scalars.write)
      r.uOut!.value = 1
      this.run(react, this.air.write)
      this.scalars.swap()
      this.air.swap()

      // 3. Forces: buoyancy, wind, turbulence, the gas's own launch.
      const forces = m.forces!
      const f = forces.uniforms
      f.uVelocity!.value = this.velocity.read.texture
      f.uA!.value = this.scalars.read.texture
      f.uDt!.value = dt
      f.uTime!.value = time
      f.uBuoyancy!.value = u.buoyancy
      f.uWind!.value = u.wind
      f.uTurbulence!.value = u.turbulence
      f.uTurbScale!.value = u.turbulenceScale
      f.uRadial!.value = u.radial
      ;(f.uInitVel!.value as THREE.Vector2).set(u.initialVelocity[0], u.initialVelocity[1])
      this.run(forces, this.velocity.write)
      this.velocity.swap()

      // 4. Vorticity confinement.
      m.curl!.uniforms.uVelocity!.value = this.velocity.read.texture
      this.run(m.curl!, this.curl)
      const vort = m.vorticity!
      vort.uniforms.uVelocity!.value = this.velocity.read.texture
      vort.uniforms.uCurl!.value = this.curl.texture
      vort.uniforms.uDt!.value = dt
      vort.uniforms.uVorticity!.value = u.vorticity
      this.run(vort, this.velocity.write)
      this.velocity.swap()

      // 5. Keep the air from compressing — except where burning expands it.
      const div = m.divergence!
      div.uniforms.uVelocity!.value = this.velocity.read.texture
      div.uniforms.uB!.value = this.air.read.texture
      div.uniforms.uExpansion!.value = u.expansion
      this.run(div, this.divergence)
      const pressure = m.pressure!
      pressure.uniforms.uDivergence!.value = this.divergence.texture
      for (let k = 0; k < this.grid.iterations; k++) {
        pressure.uniforms.uPressure!.value = this.pressure.read.texture
        this.run(pressure, this.pressure.write)
        this.pressure.swap()
      }
      const gradient = m.gradient!
      gradient.uniforms.uVelocity!.value = this.velocity.read.texture
      gradient.uniforms.uPressure!.value = this.pressure.read.texture
      this.run(gradient, this.velocity.write)
      this.velocity.swap()
    })
  }

  dispose(): void {
    for (const p of [this.scalars, this.air, this.velocity, this.pressure]) p.dispose()
    this.divergence.dispose()
    this.curl.dispose()
    this.forward.dispose()
    this.backward.dispose()
    for (const m of Object.values(this.m)) m.dispose()
    this.mesh.geometry.dispose()
  }

  private run(material: THREE.ShaderMaterial, out: THREE.WebGLRenderTarget): void {
    this.mesh.material = material
    this.renderer.setRenderTarget(out)
    this.renderer.render(this.scene, this.camera)
  }

  /** Passes change the renderer's target and clearing; put both back. */
  private withRenderer(body: () => void): void {
    const previous = this.renderer.getRenderTarget()
    const autoClear = this.renderer.autoClear
    this.renderer.autoClear = false
    try {
      body()
    } finally {
      this.renderer.setRenderTarget(previous)
      this.renderer.autoClear = autoClear
    }
  }
}
