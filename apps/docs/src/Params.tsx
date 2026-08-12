import type { ParamDoc } from './schemaDoc'

/** A parameter table, straight off the schema. Nothing here is hand-typed. */
export function Params({ rows }: { rows: ParamDoc[] }) {
  if (rows.length === 0) return <p className="meta">No parameters — it does one thing.</p>
  return (
    <table className="params">
      <thead>
        <tr>
          <th>param</th>
          <th>type</th>
          <th>default</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <td>
              <code>{row.key}</code>
            </td>
            <td>
              {row.type}
              {row.range && <span className="range"> {row.range}</span>}
              {row.options && <span className="range"> {row.options.join(' · ')}</span>}
            </td>
            <td>{row.fallback ? <code>{row.fallback}</code> : <span className="meta">—</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
