import { getAllComponents, getComponent } from "@/lib/registry";

export function generateStaticParams() {
  return getAllComponents().map(c => ({ id: c.id }));
}

export default function ComponentPage({ params }: { params: { id: string } }) {
  const component = getComponent(params.id);
  if (!component) return <div>Component not found</div>;

  const { meta, source } = component;
  const deps = Object.entries(meta.npmDependencies);

  return (
    <div>
      <div style={{ marginBottom: "2rem" }}>
        <a href="/components/" style={{ color: "#888", textDecoration: "none" }}>&larr; All Components</a>
      </div>

      <h1>{meta.name}</h1>
      <p style={{ color: "#888", fontSize: "1.125rem" }}>{meta.description}</p>

      <div style={{ display: "flex", gap: "0.5rem", margin: "1rem 0", flexWrap: "wrap" }}>
        <span style={{ background: "#1a3a1a", color: "#4ade80", padding: "0.25rem 0.75rem", borderRadius: "999px", fontSize: "0.875rem" }}>{meta.category}</span>
        <span style={{ background: "#1a1a3a", color: "#818cf8", padding: "0.25rem 0.75rem", borderRadius: "999px", fontSize: "0.875rem" }}>Phase {meta.phase}</span>
      </div>

      <section style={{ marginTop: "2rem" }}>
        <h2>Install</h2>
        <pre style={{ background: "#1a1a1a", padding: "1rem", borderRadius: "8px", overflow: "auto" }}>
          <code>npx clawkit add {meta.name}</code>
        </pre>
      </section>

      {deps.length > 0 && (
        <section style={{ marginTop: "2rem" }}>
          <h2>Dependencies</h2>
          <ul>{deps.map(([name, version]) => <li key={name}><code>{name}</code> {version}</li>)}</ul>
        </section>
      )}

      {Object.keys(meta.configSchema).length > 0 && (
        <section style={{ marginTop: "2rem" }}>
          <h2>Configuration</h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ borderBottom: "1px solid #333" }}>
              <th style={{ textAlign: "left", padding: "0.5rem" }}>Property</th>
              <th style={{ textAlign: "left", padding: "0.5rem" }}>Type</th>
              <th style={{ textAlign: "left", padding: "0.5rem" }}>Default</th>
            </tr></thead>
            <tbody>
              {Object.entries(meta.configSchema).map(([key, schema]: [string, any]) => (
                <tr key={key} style={{ borderBottom: "1px solid #222" }}>
                  <td style={{ padding: "0.5rem" }}><code>{key}</code></td>
                  <td style={{ padding: "0.5rem", color: "#888" }}>{schema.type ?? "any"}</td>
                  <td style={{ padding: "0.5rem", color: "#888" }}>{schema.default !== undefined ? String(schema.default) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {meta.suggests.length > 0 && (
        <section style={{ marginTop: "2rem" }}>
          <h2>Related Components</h2>
          <ul>
            {meta.suggests.map((s: string) => (
              <li key={s}>
                <a href={`/components/${s}/`} style={{ color: "#818cf8" }}>{s}</a>
                {meta.suggestReason[s] && <span style={{ color: "#888" }}> — {meta.suggestReason[s]}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section style={{ marginTop: "2rem" }}>
        <h2>Source Code</h2>
        <pre style={{ background: "#1a1a1a", padding: "1rem", borderRadius: "8px", overflow: "auto", fontSize: "0.875rem", lineHeight: 1.5, maxHeight: "600px" }}>
          <code>{source}</code>
        </pre>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>Usage</h2>
        <pre style={{ background: "#1a1a1a", padding: "1rem", borderRadius: "8px", overflow: "auto" }}>
          <code>{`import ${meta.importName} from "./components/${meta.category}/${meta.name.replace(`${meta.category}-`, "").replace(meta.category, "")}/index.js";\n\nconst instance = ${meta.instanceTemplate};`}</code>
        </pre>
      </section>
    </div>
  );
}
