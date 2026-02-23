import { getAllComponents, getCategories } from "@/lib/registry";

export default function Home() {
  const components = getAllComponents();
  const categories = getCategories();

  return (
    <div>
      <section style={{ textAlign: "center", padding: "4rem 0" }}>
        <h1 style={{ fontSize: "3rem", marginBottom: "1rem" }}>ClawKit</h1>
        <p style={{ fontSize: "1.25rem", color: "#888", maxWidth: "600px", margin: "0 auto" }}>
          Component registry for building AI agents. {components.length} components across {categories.length} categories.
        </p>
        <div style={{ marginTop: "2rem" }}>
          <code style={{ background: "#1a1a1a", padding: "0.75rem 1.5rem", borderRadius: "8px", fontSize: "1rem" }}>
            npx clawkit init my-agent
          </code>
        </div>
      </section>

      <section>
        <h2 style={{ marginBottom: "1.5rem" }}>Categories</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: "1rem" }}>
          {categories.map(cat => {
            const count = components.filter(c => c.meta.category === cat).length;
            return (
              <a key={cat} href={`/components/?category=${cat}`} style={{ background: "#1a1a1a", padding: "1.5rem", borderRadius: "12px", textDecoration: "none", color: "#ededed", border: "1px solid #222" }}>
                <h3 style={{ margin: 0, textTransform: "capitalize" }}>{cat}</h3>
                <p style={{ color: "#888", margin: "0.5rem 0 0" }}>{count} component{count !== 1 ? "s" : ""}</p>
              </a>
            );
          })}
        </div>
      </section>
    </div>
  );
}
