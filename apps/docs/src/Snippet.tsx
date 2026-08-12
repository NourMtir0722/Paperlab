import { useState } from 'react'

/**
 * Code you can take. Every example on this page is the exact source for the
 * thing rendering beside it — generated from the same config the canvas is
 * running, never retyped, because a docs snippet that drifts from the demo
 * beside it is worse than no snippet.
 */
export function Snippet({ code, lang = 'tsx' }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="snippet">
      <pre>
        <code>{code}</code>
      </pre>
      <button
        type="button"
        className="copy"
        aria-label="Copy code"
        onClick={() => {
          void navigator.clipboard.writeText(code)
          setCopied(true)
          setTimeout(() => setCopied(false), 1400)
        }}
      >
        {copied ? 'copied' : 'copy'}
      </button>
      <span className="snippet-lang">{lang}</span>
    </div>
  )
}
