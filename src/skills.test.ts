import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { discoverSkills } from './skills.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('discoverSkills', () => {
  it('discovers skills with SKILL.md', () => {
    fs.mkdirSync(path.join(tmpDir, 'arxiv-search'));
    fs.writeFileSync(path.join(tmpDir, 'arxiv-search', 'SKILL.md'), '# Test');

    fs.mkdirSync(path.join(tmpDir, 'web-search'));
    fs.writeFileSync(path.join(tmpDir, 'web-search', 'SKILL.md'), '# Test');

    const skills = discoverSkills(tmpDir);
    expect(skills).toContain('arxiv-search');
    expect(skills).toContain('web-search');
    expect(skills).toHaveLength(2);
  });

  it('ignores directories without SKILL.md', () => {
    fs.mkdirSync(path.join(tmpDir, 'has-skill'));
    fs.writeFileSync(path.join(tmpDir, 'has-skill', 'SKILL.md'), '# Test');

    fs.mkdirSync(path.join(tmpDir, 'no-skill'));
    fs.writeFileSync(path.join(tmpDir, 'no-skill', 'README.md'), '# Test');

    const skills = discoverSkills(tmpDir);
    expect(skills).toEqual(['has-skill']);
  });

  it('returns empty array for non-existent directory', () => {
    expect(discoverSkills('/nonexistent/path')).toEqual([]);
  });

  it('returns empty array for empty directory', () => {
    expect(discoverSkills(tmpDir)).toEqual([]);
  });
});
