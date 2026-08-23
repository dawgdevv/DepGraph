const GITHUB_INPUT_RE = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)\/?(?:\.git)?(?:\/.*)?$/;
const SLUG_RE = /^([\w.-]+)\/([\w.-]+)$/;

export function parseGithubInput(
  input: string
): { owner: string; repo: string } | null {
  const trimmed = input.trim();
  const m = trimmed.match(GITHUB_INPUT_RE);
  if (m) return { owner: m[1], repo: m[2] };
  const s = trimmed.match(SLUG_RE);
  if (s && !trimmed.includes(".")) return { owner: s[1], repo: s[2] };
  return null;
}

export function toSlug(owner: string, repo: string): string {
  return `${owner}--${repo}`;
}

export function slugToRepoPath(analysisId: string): string | null {
  const i = analysisId.indexOf("--");
  if (i <= 0 || i === analysisId.length - 2) return null;
  return `${analysisId.slice(0, i)}/${analysisId.slice(i + 2)}`;
}

export function toGithubUrl(repoPath: string): string {
  return `https://github.com/${repoPath}`;
}
