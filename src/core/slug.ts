/**
 * Pure parsing of a GitHub remote URL into an owner/repo slug.
 * Supports https, ssh (git@), and ssh:// forms.
 */
export function parseGithubSlug(remoteUrl: string): string | undefined {
  const m = /github\.com[:/]([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(
    remoteUrl.trim()
  );
  return m ? `${m[1]}/${m[2]}` : undefined;
}
