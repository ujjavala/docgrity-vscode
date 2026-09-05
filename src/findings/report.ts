/**
 * Markdown report generation — a portable artifact of the last scan that can
 * be viewed, saved, or shared without the extension UI.
 */
import { Finding } from './store';

const TYPE_LABELS: Record<string, string> = {
  contradiction: 'Contradictions',
  duplicate: 'Duplicates',
  open_question: 'Open questions',
};

export function buildReport(findings: Finding[], workspaceName: string): string {
  const lines: string[] = [];
  lines.push(`# Docgrity report — ${workspaceName}`);
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');

  if (findings.length === 0) {
    lines.push('No findings. Run **Docgrity: Scan workspace docs** to (re)scan.');
    return lines.join('\n');
  }

  const byType = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = byType.get(f.type) ?? [];
    list.push(f);
    byType.set(f.type, list);
  }

  lines.push('## Summary');
  lines.push('');
  lines.push('| Type | Count |');
  lines.push('|---|---|');
  for (const [type, list] of byType) {
    lines.push(`| ${TYPE_LABELS[type] ?? type} | ${list.length} |`);
  }
  lines.push(`| **Total** | **${findings.length}** |`);
  lines.push('');

  for (const [type, list] of byType) {
    lines.push(`## ${TYPE_LABELS[type] ?? type}`);
    lines.push('');
    for (const f of list) {
      lines.push(`### ${f.summary}`);
      lines.push('');
      lines.push(
        `- **Severity:** ${f.severity} · **Confidence:** ${(f.confidence * 100).toFixed(0)}%`
      );
      lines.push(`- **Files:** ${f.files.map((p) => `\`${p}\``).join(', ')}`);
      if (f.potentialOwners.length > 0) {
        lines.push(`- **Potential owner(s):** ${f.potentialOwners.join(', ')}`);
      }
      if (f.issueUrl) lines.push(`- **Issue:** ${f.issueUrl}`);
      lines.push(`- _model ${f.model}, prompt ${f.promptVersion}, ${f.createdAt}_`);
      lines.push('');
      lines.push('**Evidence:**');
      lines.push('');
      for (const e of f.evidence) {
        lines.push(`- \`${e.sourceLabel}\``);
        lines.push(`  > ${e.excerpt.replace(/\n/g, '\n  > ')}`);
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}
