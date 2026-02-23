import { getAllComponents, getCategories } from "@/lib/registry";

export default function ComponentsPage() {
  const components = getAllComponents();
  const categories = getCategories();

  return (
    <div>
      <h1>Components</h1>
      <p style={{ color: "#888" }}>{components.length} components available</p>

      {categories.map(category => (
        <section key={category} style={{ marginBottom: "3rem" }}>
          <h2 style={{ textTransform: "capitalize", borderBottom: "1px solid #222", paddingBottom: "0.5rem" }}>{category}</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "1rem", marginTop: "1rem" }}>
            {components.filter(c => c.meta.category === category).map(comp => (
              <a key={comp.id} href={`/components/${comp.id}/`} style={{ background: "#1a1a1a", padding: "1.25rem", borderRadius: "8px", textDecoration: "none", color: "#ededed", border: "1px solid #222" }}>
                <h3 style={{ margin: 0, fontSize: "1rem" }}>{comp.id}</h3>
                <p style={{ color: "#888", margin: "0.5rem 0 0", fontSize: "0.875rem" }}>{comp.meta.description}</p>
                <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <span style={{ background: "#222", padding: "0.25rem 0.5rem", borderRadius: "4px", fontSize: "0.75rem" }}>Phase {comp.meta.phase}</span>
                  {Object.keys(comp.meta.npmDependencies).length > 0 && (
                    <span style={{ background: "#222", padding: "0.25rem 0.5rem", borderRadius: "4px", fontSize: "0.75rem" }}>
                      {Object.keys(comp.meta.npmDependencies).length} dep{Object.keys(comp.meta.npmDependencies).length !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              </a>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
