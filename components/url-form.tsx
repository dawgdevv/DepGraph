"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { parseGithubInput } from "@/lib/github";

export function UrlForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseGithubInput(url);
    if (!parsed) {
      setError("Please enter a valid public GitHub repository URL.");
      return;
    }
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repositoryUrl: url }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        analysisId?: string;
        analysisUrl?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "We couldn't start the analysis.");
        return;
      }
      const target =
        data.analysisUrl ??
        (data.analysisId ? `/analysis/${data.analysisId}` : null);
      if (target) router.push(target);
      else setError("We couldn't start the analysis.");
    } catch {
      setError("The analysis service is temporarily unavailable. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-xl" noValidate>
      <div
        className={`flex items-stretch border bg-surface transition-colors ${
          error ? "border-accent" : "border-line-strong focus-within:border-link"
        }`}
      >
        <input
          type="text"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (error) setError(null);
          }}
          placeholder="https://github.com/owner/repository"
          aria-label="GitHub repository URL"
          aria-invalid={!!error}
          autoComplete="off"
          spellCheck={false}
          className="h-13 min-w-0 flex-1 bg-transparent px-4 py-3.5 font-mono text-[15px] text-ink placeholder:text-faint focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending}
          className="m-1.5 shrink-0 bg-ink px-5 font-display text-sm font-medium tracking-wide text-bg transition-opacity hover:opacity-85 disabled:opacity-50"
        >
          {pending ? "Analyzing…" : "Analyze Repository"}
        </button>
      </div>
      <div className="mt-2 flex min-h-6 items-start justify-between gap-4">
        <p
          className={`font-mono text-xs ${
            error ? "text-accent-ink" : "text-faint"
          }`}
          role={error ? "alert" : undefined}
        >
          {error ?? "Public repositories · npm projects with package-lock.json"}
        </p>
        <span className="shrink-0 font-mono text-xs text-faint">Paste a GitHub URL to start</span>
      </div>
    </form>
  );
}
