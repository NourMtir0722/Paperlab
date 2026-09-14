/**
 * The name in the top-left of every surface, with its beta mark — one
 * component, so the editor, /hands and /fx-lab cannot disagree about it.
 */
export function Brand() {
  return (
    <div className="brand">
      Paperlab <span className="beta">beta</span>
    </div>
  )
}
