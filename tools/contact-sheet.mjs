#!/usr/bin/env node
/**
 * Composes labelled contact sheets out of PNGs the other harnesses shot.
 *
 * A catalogue of eight lighting rigs is not eight images — it is ONE image,
 * because the whole claim is comparative: `raking` only means anything next
 * to `lightbox`. Eight files in a README are eight scroll positions and the
 * comparison never happens.
 *
 * There is no ImageMagick here and this ffmpeg has no `drawtext`, so the
 * composition happens in the browser that is already a dependency. That is
 * also what lets the labels use the app's own type ramp rather than whatever
 * a tiling filter would have burned in.
 *
 *   node tools/contact-sheet.mjs --out=docs/media/lighting.png --cols=4 \
 *     .shots/light-studio-typed-note.png=studio \
 *     .shots/light-noir-typed-note.png=noir
 *
 * Each positional argument is `path=label`. `--crop=x,y,w,h` takes the same
 * window out of every source, which is how a sheet centred in a 620px frame
 * stops being mostly background.
 */
import { mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { chromium } from 'playwright'
import { root } from './harness.mjs'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const out = resolve(root, flag('out', '.shots/contact-sheet.png'))
const cols = Number(flag('cols', 4))
const width = Number(flag('width', 1600))
const gap = Number(flag('gap', 14))
const crop = flag('crop', '')
/**
 * These sheets are photographs of a renderer, and PNG prices them like line
 * art: the camera grid is 2.9 MB as PNG and 215 KB as JPEG with no visible
 * difference, labels included. `--out=…​.jpg` picks the encoder; `--scale` is
 * the device pixel ratio, because a README column is ~880px and 2x of a
 * 1400px sheet is three times the pixels anyone will see.
 */
const scale = Number(flag('scale', 2))
const quality = Number(flag('quality', 88))
const jpeg = /\.jpe?g$/i.test(out)

const tiles = argv
  .filter((a) => !a.startsWith('--'))
  .map((a) => {
    const i = a.lastIndexOf('=')
    if (i < 0) throw new Error(`[contact-sheet] "${a}" is not path=label`)
    return { path: resolve(root, a.slice(0, i)), label: a.slice(i + 1) }
  })

if (tiles.length === 0) throw new Error('[contact-sheet] no tiles given')

/** Inline every source: a file:// page cannot read siblings under CSP. */
const asDataUri = (p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`

const cellWidth = Math.floor((width - gap * (cols - 1)) / cols)

/**
 * The crop window is in SOURCE pixels, but the cell it lands in is narrower
 * than the source. So the window is cut at natural size and the whole cut is
 * then scaled to the cell — rather than offsetting a already-resized image,
 * which slides the wrong distance and leaves the sheet half out of frame.
 */
const cropStyle = (() => {
  if (!crop) return { outer: '', inner: '', img: 'width:100%;display:block;' }
  const [x, y, w, h] = crop.split(',').map(Number)
  const k = cellWidth / w
  return {
    outer: `height:${Math.round(h * k)}px;overflow:hidden;`,
    inner: `width:${w}px;height:${h}px;overflow:hidden;position:relative;transform:scale(${k});transform-origin:top left;`,
    img: `position:absolute;left:${-x}px;top:${-y}px;display:block;`,
  }
})()

const html = `<!doctype html><meta charset="utf-8"><style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500&display=swap');
  :root {
    --l0:#08090a;
    --ink:rgba(255,255,255,0.95);
    --ink-meta:rgba(255,255,255,0.35);
    --hair:rgba(255,255,255,0.07);
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    background:var(--l0);
    font-family:"Inter",ui-sans-serif,system-ui,-apple-system,sans-serif;
    padding:${gap}px;
    width:${width + gap * 2}px;
  }
  .grid { display:grid; grid-template-columns:repeat(${cols},${cellWidth}px); gap:${gap}px; }
  figure { background:#0b0c0d; border-radius:8px; overflow:hidden; border:1px solid var(--hair); }
  .shot { ${cropStyle.outer} }
  .shot .inner { ${cropStyle.inner} }
  .shot img { ${cropStyle.img} }
  figcaption {
    padding:9px 12px 11px;
    font-size:12.5px;
    letter-spacing:0.01em;
    color:var(--ink);
    font-weight:500;
    display:flex; align-items:baseline; gap:8px;
  }
  figcaption .n { color:var(--ink-meta); font-weight:400; font-variant-numeric:tabular-nums; }
</style>
<div class="grid">
${tiles
  .map(
    (t, i) => `  <figure>
    <div class="shot">${crop ? '<div class="inner">' : ''}<img src="${asDataUri(t.path)}" alt="${t.label}">${crop ? '</div>' : ''}</div>
    <figcaption><span class="n">${String(i + 1).padStart(2, '0')}</span>${t.label}</figcaption>
  </figure>`,
  )
  .join('\n')}
</div>`

const browser = await chromium.launch()
try {
  const page = await browser.newPage({
    viewport: { width: width + gap * 2, height: 800 },
    deviceScaleFactor: scale,
  })
  await page.setContent(html, { waitUntil: 'networkidle' })
  // The webfont may not land; the fallback stack is real, so do not block on it.
  await page.evaluate(() => document.fonts.ready.catch(() => {}))
  mkdirSync(dirname(out), { recursive: true })
  await page.locator('.grid').screenshot(jpeg ? { path: out, type: 'jpeg', quality } : { path: out })
  const kb = Math.round(statSync(out).size / 1024)
  console.log(
    `contact sheet → ${out.replace(`${root}/`, '')}  (${tiles.length} tiles, ${cols} cols, ${kb} KB)`,
  )
} finally {
  await browser.close()
}
