import fs from 'fs';
import path from 'path';

/**
 * Discover available skills by scanning .claude/skills/ for directories
 * containing SKILL.md files. Returns skill names.
 */
export function discoverSkills(skillsDir?: string): string[] {
  const dir = skillsDir || path.join(process.cwd(), '.claude', 'skills');

  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        fs.existsSync(path.join(dir, entry.name, 'SKILL.md')),
    )
    .map((entry) => entry.name);
}
