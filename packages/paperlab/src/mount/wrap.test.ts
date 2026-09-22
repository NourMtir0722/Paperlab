import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createLemonGeometry } from './lemon'
import { MountSurface, weldedNormals } from './surface'
import { buildWrap, sampleWrap, shellMap } from './wrap'

const lemon = () => {
  const g = createLemonGeometry({ girth: 0.7, nipple: 0.6, lumps: 0.5, seed: 1 })
  g.scale(1.6, 1.6, 1.6)
  return new MountSurface(g)
}

describe('mount wrap', () => {
  const surface = lemon()
  const t0 = performance.now()
  const wrap = buildWrap(surface, { azimuth: 0, elevation: 10, roll: 0 }, 0.5, 0.35, 41)
  const ms = performance.now() - t0

  it('lays up fast enough to do on a slider change', () => {
    expect(ms).toBeLessThan(1500)
  })

  it('every node is on the skin', () => {
    const hit = { point: new THREE.Vector3(), normal: new THREE.Vector3() }
    const p = new THREE.Vector3()
    for (let k = 0; k < wrap.positions.length; k += 3) {
      p.fromArray(wrap.positions, k)
      surface.closest(p, hit)
      expect(hit.point.distanceTo(p)).toBeLessThan(1e-4)
    }
  })

  it('keeps the sticker the size it is along its ribs', () => {
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const n = new THREE.Vector3()
    // Arc length along the middle row, measured in small chords.
    let arc = 0
    sampleWrap(wrap, -0.4, 0, a, n)
    for (let i = 1; i <= 80; i++) {
      sampleWrap(wrap, -0.4 + (0.8 * i) / 80, 0, b, n)
      arc += a.distanceTo(b)
      a.copy(b)
    }
    expect(arc).toBeGreaterThan(0.8 * 0.97)
    expect(arc).toBeLessThan(0.8 * 1.03)
  })

  it('puts height along the normal', () => {
    const pts = new Float32Array([0, 0, 0.1])
    shellMap(wrap, pts, 1, 0)
    const p = new THREE.Vector3().fromArray(pts)
    expect(p.distanceTo(wrap.origin)).toBeCloseTo(0.1, 3)
    expect(p.clone().sub(wrap.origin).normalize().dot(wrap.normal)).toBeGreaterThan(0.999)
  })
})

describe('mount rig', () => {
  it('a lifted flap is placed rigidly: it keeps its length on a curve', async () => {
    const { MountRig } = await import('./rig')
    const { getDeformer } = await import('../deformers/registry')
    const surface = lemon()
    const sheet = { width: 0.6, height: 0.25 }
    const wrap = buildWrap(surface, { azimuth: 0, elevation: 0, roll: 0 }, 1.2, 1.2, 49)
    const rig = new MountRig(wrap, sheet)
    const options = { angle: 180, front: 0.7, radius: 0.03, flap: 140, tension: 0, release: 0 }
    const stack = [{ type: 'lift', options }]
    const ctx = { t: 0, sheet }
    rig.update(stack, ctx)
    const n = 300
    const base = new Float32Array(n * 3)
    const pos = new Float32Array(n * 3)
    const lift = getDeformer('lift')
    const p = new THREE.Vector3()
    for (let i = 0; i < n; i++) {
      const x = 0.3 - (0.6 * i) / (n - 1)
      base.set([x, 0, 0], i * 3)
      p.set(x, 0, 0)
      lift.displace(p, new THREE.Vector2(), options, ctx)
      pos.set([p.x, p.y, p.z], i * 3)
    }
    rig.shell(pos, base, null, n)
    let length = 0
    for (let i = 1; i < n; i++) {
      length += Math.hypot(
        pos[i * 3]! - pos[i * 3 - 3]!,
        pos[i * 3 + 1]! - pos[i * 3 - 2]!,
        pos[i * 3 + 2]! - pos[i * 3 - 1]!,
      )
    }
    // Shell-mapped at height, the flap would come out several per cent long.
    expect(length).toBeGreaterThan(0.6 * 0.97)
    expect(length).toBeLessThan(0.6 * 1.03)
    rig.dispose()
  })
})

describe('the flight', () => {
  const grid = async (azimuth: number) => {
    const { MountRig } = await import('./rig')
    const surface = lemon()
    const sheet = { width: 0.3, height: 0.2 }
    const wrap = buildWrap(surface, { azimuth, elevation: 20, roll: 10 }, 0.6, 0.6, 31)
    const rig = new MountRig(wrap, sheet)
    const plane = new THREE.PlaneGeometry(sheet.width, sheet.height, 10, 10)
    const base = Float32Array.from(plane.attributes.position!.array as Float32Array)
    const count = plane.attributes.position!.count
    const stuck = Float32Array.from(base)
    rig.shell(stuck, base, null, count)
    const at = (f: number, host = new THREE.Matrix4(), seed = 1) => {
      const pos = Float32Array.from(stuck)
      rig.fly(pos, count, 11, f, host, seed)
      return pos
    }
    const centroid = (pos: Float32Array, host = new THREE.Matrix4()) => {
      const c = new THREE.Vector3()
      const p = new THREE.Vector3()
      for (let v = 0; v < count; v++) c.add(p.fromArray(pos, v * 3).applyMatrix4(host))
      return c.multiplyScalar(1 / count)
    }
    return { surface, stuck, at, centroid, count, rig }
  }

  it('leaves the way it is already facing: a sticker on the left flies off to the left', async () => {
    for (const [azimuth, sign] of [
      [-70, -1],
      [70, 1],
    ] as const) {
      const { at, centroid, rig } = await grid(azimuth)
      const end = centroid(at(1))
      expect(Math.sign(end.x)).toBe(sign)
      // Out of any shot the camera frames an object of this size in.
      expect(Math.abs(end.x)).toBeGreaterThan(2.5)
      expect(end.y).toBeGreaterThan(0.5)
      rig.dispose()
    }
  })

  it('never passes through the object it came off', async () => {
    const hit = { point: new THREE.Vector3(), normal: new THREE.Vector3() }
    const p = new THREE.Vector3()
    for (const azimuth of [-70, 0, 70, 160]) {
      const { surface, at, count, rig } = await grid(azimuth)
      for (let k = 1; k <= 40; k++) {
        const pos = at(k / 40)
        for (let v = 0; v < count; v++) {
          p.fromArray(pos, v * 3)
          // Clear of the object's box is clear of the object.
          if (surface.bounds.distanceToPoint(p) > 0.01) continue
          surface.closest(p, hit)
          // Outside the skin, or at worst the sticker's own thickness in.
          expect(p.clone().sub(hit.point).dot(hit.normal)).toBeGreaterThan(-0.004)
        }
      }
      rig.dispose()
    }
  })

  it('is a pure function of how far through it is, and does nothing before it starts', async () => {
    const { at, stuck, rig } = await grid(30)
    expect([...at(0)]).toEqual([...stuck])
    expect([...at(0.37)]).toEqual([...at(0.37)])
    rig.dispose()
  })

  it('flies in the world, not the object: a leaning object still sends it sideways and up', async () => {
    const { at, centroid, rig } = await grid(-70)
    const host = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0, 0.3, 0.4, 'ZYX'))
    const start = centroid(at(0, host), host)
    const end = centroid(at(1, host), host)
    expect(end.x - start.x).toBeLessThan(-2.5)
    expect(end.y - start.y).toBeGreaterThan(0.5)
    rig.dispose()
  })
})

describe('an uploaded model', () => {
  /** A thin wing: one quad, open on every side, smaller than the sticker put on it. */
  const wing = (twoSided: boolean) => {
    const g = new THREE.PlaneGeometry(0.4, 0.4, 8, 8)
    const pos = g.attributes.position!.array as Float32Array
    const idx = Array.from(g.index!.array)
    const positions = Float32Array.from(pos)
    const indices = [...idx]
    if (twoSided) {
      // The back: the same positions again, wound the other way.
      const n = pos.length / 3
      const both = new Float32Array(pos.length * 2)
      both.set(pos)
      both.set(pos, pos.length)
      for (let t = 0; t < idx.length; t += 3) indices.push(idx[t]! + n, idx[t + 2]! + n, idx[t + 1]! + n)
      return build(both, indices)
    }
    return build(positions, indices)
  }
  const build = (positions: Float32Array, indices: number[]) => {
    const index = new Uint32Array(indices)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    g.setAttribute('normal', new THREE.BufferAttribute(weldedNormals(positions, index, 1), 3))
    g.setIndex(new THREE.BufferAttribute(index, 1))
    return new MountSurface(g)
  }

  it('a back-to-back surface keeps a normal instead of cancelling to nothing', () => {
    const surface = wing(true)
    for (let k = 0; k < surface.normals.length; k += 3) {
      expect(Math.hypot(surface.normals[k]!, surface.normals[k + 1]!, surface.normals[k + 2]!)).toBeCloseTo(
        1,
        5,
      )
    }
  })

  it('welds across a seam: two halves split apart share one normal at the join', () => {
    // A roof: two faces meeting at a ridge, each with its own copy of the ridge.
    const positions = new Float32Array([
      -1, 0, 0, 0, 0.5, 0, -1, 0, 1, 0, 0.5, 1, 0, 0.5, 0, 1, 0, 0, 0, 0.5, 1, 1, 0, 1,
    ])
    const index = new Uint32Array([0, 1, 2, 1, 3, 2, 4, 5, 6, 5, 7, 6])
    const n = weldedNormals(positions, index, 2)
    expect([n[3], n[4], n[5]].map((x) => x!.toFixed(4))).toEqual(
      [n[12], n[13], n[14]].map((x) => x!.toFixed(4)),
    )
  })

  it('puts a sticker where a line from the centre leaves the model, not on whatever sticks out furthest', () => {
    // A post with a fin either side, each reaching further forward than the
    // post's own face: the nearest point to somewhere far in front is a fin's
    // front edge, and a line out of the centre meets the post.
    const parts = [new THREE.BoxGeometry(0.2, 1, 0.2, 2, 8, 2).toNonIndexed()]
    for (const x of [0.35, -0.35]) {
      const fin = new THREE.PlaneGeometry(0.8, 0.3).toNonIndexed()
      fin.rotateY(Math.PI / 2)
      fin.translate(x, 0, 0)
      parts.push(fin)
    }
    const arrays = parts.map((p) => p.attributes.position!.array as Float32Array)
    const positions = new Float32Array(arrays.reduce((n, a) => n + a.length, 0))
    let at = 0
    for (const a of arrays) {
      positions.set(a, at)
      at += a.length
    }
    const index = new Uint32Array(positions.length / 3).map((_, i) => i)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    g.setAttribute('normal', new THREE.BufferAttribute(weldedNormals(positions, index, 1), 3))
    g.setIndex(new THREE.BufferAttribute(index, 1))
    const surface = new MountSurface(g)
    const hit = { point: new THREE.Vector3(), normal: new THREE.Vector3() }
    surface.outermost(new THREE.Vector3(0, 0, 1), hit)
    // Straight out the front: on the post's face, facing the way it was asked.
    expect(hit.point.z).toBeCloseTo(0.1, 4)
    expect(Math.abs(hit.point.x)).toBeLessThan(1e-3)
    expect(hit.normal.z).toBeGreaterThan(0.99)
  })

  it('a sticker straddling a joint stays one sheet instead of fanning out', () => {
    // A block with a fin standing straight out of its front face: walking
    // the ribs, one row climbs the fin and the next stays on the block.
    const parts = [new THREE.BoxGeometry(1, 1, 0.4, 10, 10, 4).toNonIndexed()]
    const fin = new THREE.PlaneGeometry(0.3, 1, 3, 10).toNonIndexed()
    fin.rotateY(Math.PI / 2)
    fin.rotateZ(Math.PI / 4)
    fin.translate(0, 0, 0.35)
    parts.push(fin)
    const arrays = parts.map((p) => p.attributes.position!.array as Float32Array)
    const positions = new Float32Array(arrays.reduce((n, a) => n + a.length, 0))
    let at = 0
    for (const a of arrays) {
      positions.set(a, at)
      at += a.length
    }
    const index = new Uint32Array(positions.length / 3).map((_, i) => i)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    g.setAttribute('normal', new THREE.BufferAttribute(weldedNormals(positions, index, 1), 3))
    g.setIndex(new THREE.BufferAttribute(index, 1))
    const surface = new MountSurface(g)
    const wrap = buildWrap(surface, { azimuth: 0, elevation: -25, roll: 0 }, 0.3, 0.3, 21)
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const step = 0.6 / 20
    for (let j = 0; j < wrap.res; j++) {
      for (let i = 0; i < wrap.res; i++) {
        b.fromArray(wrap.positions, (j * wrap.res + i) * 3)
        if (i > 0)
          expect(a.fromArray(wrap.positions, (j * wrap.res + i - 1) * 3).distanceTo(b)).toBeLessThan(
            step * 2.5,
          )
        if (j > 0)
          expect(a.fromArray(wrap.positions, ((j - 1) * wrap.res + i) * 3).distanceTo(b)).toBeLessThan(
            step * 2.5,
          )
      }
    }
  })

  for (const twoSided of [false, true]) {
    it(`a sticker bigger than a ${twoSided ? 'two-sided' : 'one-sided'} wing overhangs it flat instead of crushing onto its edge`, () => {
      const surface = wing(twoSided)
      const wrap = buildWrap(surface, { azimuth: 0, elevation: 0, roll: 0 }, 0.4, 0.4, 21)
      // Every node a step from its neighbour along a row: nothing piled up.
      const dx = 0.8 / 20
      const a = new THREE.Vector3()
      const b = new THREE.Vector3()
      for (let j = 0; j < wrap.res; j++) {
        for (let i = 1; i < wrap.res; i++) {
          a.fromArray(wrap.positions, (j * wrap.res + i - 1) * 3)
          b.fromArray(wrap.positions, (j * wrap.res + i) * 3)
          expect(a.distanceTo(b)).toBeGreaterThan(dx * 0.9)
          expect(a.distanceTo(b)).toBeLessThan(dx * 1.1)
        }
      }
      // And every normal faces the same way as the one at its centre.
      for (let k = 0; k < wrap.normals.length; k += 3) {
        expect(
          wrap.normals[k]! * wrap.normal.x +
            wrap.normals[k + 1]! * wrap.normal.y +
            wrap.normals[k + 2]! * wrap.normal.z,
        ).toBeGreaterThan(0.99)
      }
    })
  }
})
