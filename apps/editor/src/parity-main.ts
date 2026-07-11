import { runParityHarness, PARITY_EPSILON } from 'paperlab'

declare global {
  interface Window {
    __PARITY__?: { results: { name: string; maxError: number; pass: boolean }[]; error?: string }
  }
}

const el = document.getElementById('results')!
try {
  const results = runParityHarness()
  window.__PARITY__ = { results }
  el.innerHTML =
    `<p>epsilon = ${PARITY_EPSILON}</p>` +
    results
      .map(
        (r) =>
          `<div class="${r.pass ? 'pass' : 'fail'}">${r.pass ? '✓' : '✗'} ${r.name} — max error ${r.maxError.toExponential(2)}</div>`,
      )
      .join('')
} catch (error) {
  window.__PARITY__ = { results: [], error: String(error) }
  el.innerHTML = `<div class="fail">${String(error)}</div>`
}
