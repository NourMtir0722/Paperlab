import * as THREE from 'three'
import { useEffect, useState } from 'react'
import type { ContentConfig, SheetConfig } from '../config/schema'
import type { Stock } from '../core/stock'
import { renderContentToCanvas } from './texture'

/**
 * Field mode packs every paper's content into one grid atlas — one texture,
 * one draw call. Tiles keep the sheet's aspect; images redraw their tile as
 * they decode (LQIP-ish: stock tint first, pixels when ready).
 */

const MAX_ATLAS = 4096

export function atlasGrid(count: number): { cols: number; rows: number } {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)))
  return { cols, rows: Math.max(1, Math.ceil(count / cols)) }
}

export interface ContentAtlas {
  texture: THREE.CanvasTexture
  cols: number
  rows: number
}

export function useContentAtlas(
  contents: ContentConfig[],
  sheet: SheetConfig,
  stock: Stock,
): ContentAtlas | null {
  const [atlas, setAtlas] = useState<ContentAtlas | null>(null)
  const key = JSON.stringify({ contents, w: sheet.width, h: sheet.height, stock: stock.id })

  useEffect(() => {
    let disposed = false
    const { cols, rows } = atlasGrid(contents.length)
    const aspect = sheet.height / sheet.width
    const tileW = Math.min(1024, Math.floor(MAX_ATLAS / cols))
    const tileH = Math.min(Math.round(tileW * aspect), Math.floor(MAX_ATLAS / rows))

    const canvas = document.createElement('canvas')
    canvas.width = tileW * cols
    canvas.height = tileH * rows
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = stock.color
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 4
    setAtlas({ texture, cols, rows })

    const drawTile = (index: number, tile: HTMLCanvasElement) => {
      if (disposed) return
      const x = (index % cols) * tileW
      const y = Math.floor(index / cols) * tileH
      ctx.drawImage(tile, x, y, tileW, tileH)
      texture.needsUpdate = true
    }

    contents.forEach((content, index) => {
      if (content.type === 'image') {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => drawTile(index, renderContentToCanvas(content, sheet, stock, img))
        img.src = content.src
      } else if (content.type === 'text' || content.type === 'receipt') {
        document.fonts.ready.then(() => drawTile(index, renderContentToCanvas(content, sheet, stock)))
      } else {
        drawTile(index, renderContentToCanvas(content, sheet, stock))
      }
    })

    return () => {
      disposed = true
      texture.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return atlas
}
