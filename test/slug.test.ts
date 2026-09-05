import { describe, it, expect } from 'vitest';
import { parseGithubSlug } from '../src/core/slug';

describe('parseGithubSlug', () => {
  it('parses https remotes', () => {
    expect(parseGithubSlug('https://github.com/ujjavala/docgrity-vscode.git')).toBe(
      'ujjavala/docgrity-vscode'
    );
    expect(parseGithubSlug('https://github.com/ujjavala/docgrity-vscode')).toBe(
      'ujjavala/docgrity-vscode'
    );
  });

  it('parses ssh remotes', () => {
    expect(parseGithubSlug('git@github.com:owner/repo.git')).toBe('owner/repo');
    expect(parseGithubSlug('ssh://git@github.com/owner/repo.git')).toBe('owner/repo');
  });

  it('keeps dots in repo names', () => {
    expect(parseGithubSlug('git@github.com:owner/my.repo.name.git')).toBe('owner/my.repo.name');
  });

  it('handles trailing slash and whitespace', () => {
    expect(parseGithubSlug(' https://github.com/owner/repo/ \n')).toBe('owner/repo');
  });

  it('returns undefined for non-GitHub remotes', () => {
    expect(parseGithubSlug('https://gitlab.com/owner/repo.git')).toBeUndefined();
    expect(parseGithubSlug('')).toBeUndefined();
  });
});
