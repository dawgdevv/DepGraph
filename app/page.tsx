import { UrlForm } from "@/components/url-form";

const FACTS = [
  ["01", "Parse", "Reads package.json and package-lock.json to resolve the exact dependency tree."],
  ["02", "Scan", "Runs CVE-Lite against resolved versions to find vulnerable packages."],
  ["03", "Traverse", "Walks DEPENDS_ON relationships backward across any number of hops."],
  ["04", "Explain", "Renders every dependency path from your project to the vulnerability."],
];

export default function Home() {
  return (
    <main className="relative flex flex-1 flex-col overflow-hidden">
      <div className="grid-backdrop pointer-events-none absolute inset-0" aria-hidden />

      <header className="relative z-10 flex items-center justify-between px-8 pt-7">
        <div className="flex items-center gap-2.5">
          <Mark />
          <span className="font-display text-lg font-semibold tracking-tight">
            DepGraph ( for npm ecosystem)
          </span>
        </div>
        <div className="flex items-center gap-3">
          <p className="hidden font-mono text-xs text-faint sm:block">
            npm · lockfile v3
          </p>
          <span className="hidden items-center gap-1.5 border border-line-strong bg-surface px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted sm:flex">
            <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden>
              <ellipse cx="5" cy="2.4" rx="4" ry="1.7" fill="none" stroke="var(--link)" strokeWidth="1.1" />
              <path d="M1 2.4 V7.6 A4 1.7 0 0 0 9 7.6 V2.4" fill="none" stroke="var(--link)" strokeWidth="1.1" />
            </svg>
            powered by CognoDB
          </span>
        </div>
      </header>

      <section className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-6 pb-24">
        <p className="rise mb-5 border border-line-strong bg-surface px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
          dependency blast-radius explorer
        </p>

        <h1
          className="rise max-w-2xl text-center font-display text-[clamp(2.4rem,6vw,4.2rem)] leading-[1.02] font-semibold tracking-[-0.03em]"
          style={{ animationDelay: "60ms" }}
        >
          See exactly what depends on a{" "}
          <span className="relative whitespace-nowrap text-accent">
            vulnerable
            <svg
              className="absolute -bottom-1 left-0 w-full"
              viewBox="0 0 200 8"
              preserveAspectRatio="none"
              aria-hidden
            >
              <path d="M2 6 Q 100 -2 198 5" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.55" />
            </svg>
          </span>{" "}
          package.
        </h1>

        <p
          className="rise mt-6 max-w-xl text-center text-[15px] leading-relaxed text-muted"
          style={{ animationDelay: "120ms" }}
        >
          Paste a GitHub URL. DepGraph resolves your npm tree, scans it for
          vulnerabilities, and traces every path from your project to each
          finding — no signup, no install.
        </p>

        <div className="rise mt-10 flex w-full justify-center" style={{ animationDelay: "180ms" }}>
          <UrlForm />
        </div>
      </section>

      <section className="relative z-10 mx-auto grid w-full max-w-3xl grid-cols-1 gap-px border-t border-line bg-line sm:grid-cols-4">
        {FACTS.map(([n, title, body]) => (
          <div key={n} className="bg-bg px-4 pb-5 pt-4">
            <span className="font-mono text-[11px] text-faint">{n}</span>
            <h2 className="mt-1 font-display text-sm font-semibold">{title}</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">{body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}

function Mark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
      <circle cx="4" cy="16" r="2.6" fill="var(--link)" />
      <circle cx="16" cy="4" r="2.6" fill="var(--accent)" />
      <path d="M5.5 14 L14.5 5.8" stroke="var(--ink)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M9 15.5 H15 M12 12 V18" stroke="var(--ink)" strokeWidth="1.4" strokeLinecap="round" opacity="0.35" />
    </svg>
  );
}
