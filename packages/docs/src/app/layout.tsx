import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ClawKit - Component Registry for AI Agents",
  description: "Browse, search, and add components to build AI agents.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, -apple-system, sans-serif", margin: 0, padding: 0, background: "#0a0a0a", color: "#ededed" }}>
        <header style={{ borderBottom: "1px solid #222", padding: "1rem 2rem", display: "flex", alignItems: "center", gap: "2rem" }}>
          <a href="/" style={{ color: "#ededed", textDecoration: "none", fontSize: "1.5rem", fontWeight: 700 }}>ClawKit</a>
          <nav style={{ display: "flex", gap: "1.5rem" }}>
            <a href="/components/" style={{ color: "#888", textDecoration: "none" }}>Components</a>
            <a href="/getting-started/" style={{ color: "#888", textDecoration: "none" }}>Getting Started</a>
          </nav>
        </header>
        <main style={{ maxWidth: "1200px", margin: "0 auto", padding: "2rem" }}>
          {children}
        </main>
      </body>
    </html>
  );
}
