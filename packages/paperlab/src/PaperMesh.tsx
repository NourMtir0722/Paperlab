import * as THREE from 'three'
import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react'
import type {
  ContentConfig,
  PaperConfig,
  PaperConfigInput,
  SheetConfig,
  StockName,
} from './config/schema'
import { paperConfigSchema } from './config/schema'
import { mergeConfig, parsePreset, serializePreset } from './config/serialize'
import { createSheetGeometry } from './core/sheet'
import { getStock } from './core/stock'
import { getPreset } from './config/presets'
import { useContentTexture } from './content/texture'

export interface PaperMeshProps {
  /** Built-in preset name, or a (partial) preset object. Props below override it. */
  preset?: string | PaperConfigInput
  sheet?: Partial<SheetConfig>
  stock?: StockName
  content?: ContentConfig
  onTwos?: boolean
  interactive?: boolean
  /** Transform passthrough for placing the sheet in a larger scene. */
  position?: [number, number, number]
  rotation?: [number, number, number]
}

export interface PaperHandle {
  /** Current full state as a preset. */
  snapshot(): PaperConfig
  /** Serialized `.paper` JSON of the current state. */
  toJSON(): string
  readonly mesh: THREE.Mesh | null
}

/** Resolve preset + prop overrides into a validated config. */
export function resolveConfig(props: PaperMeshProps): PaperConfig {
  const base = props.preset
    ? typeof props.preset === 'string'
      ? getPreset(props.preset)
      : parsePreset(props.preset)
    : paperConfigSchema.parse({})
  const overrides: PaperConfigInput = {}
  if (props.sheet) overrides.sheet = { ...base.sheet, ...props.sheet }
  if (props.stock) overrides.stock = props.stock
  if (props.content) overrides.content = props.content
  if (props.onTwos !== undefined) overrides.onTwos = props.onTwos
  return paperConfigSchema.parse(mergeConfig(base as PaperConfigInput, overrides))
}

/**
 * The atom: one sheet of paper as a mesh, for use inside an existing R3F
 * scene. `<Paper />` wraps this with its own Canvas.
 */
export const PaperMesh = forwardRef<PaperHandle, PaperMeshProps>(function PaperMesh(props, ref) {
  const config = resolveConfig(props)
  const configKey = JSON.stringify(config.sheet)
  const meshRef = useRef<THREE.Mesh>(null)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geometry = useMemo(() => createSheetGeometry(config.sheet), [configKey])
  const stock = getStock(config.stock)
  const texture = useContentTexture(config.content, config.sheet, stock)

  useImperativeHandle(ref, () => ({
    snapshot: () => resolveConfig(props),
    toJSON: () => serializePreset(resolveConfig(props)),
    get mesh() {
      return meshRef.current
    },
  }))

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      position={props.position}
      rotation={props.rotation}
      castShadow
      receiveShadow
    >
      <meshStandardMaterial
        map={texture ?? undefined}
        color={texture ? '#ffffff' : stock.color}
        roughness={stock.roughness}
        metalness={0}
        transparent={stock.opacity < 1}
        opacity={stock.opacity}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
})
