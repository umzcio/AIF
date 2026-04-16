import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, extname, basename } from 'node:path';

const DEFAULT_MAX_CHARS = 400_000;

// Directories to skip entirely
const EXCLUDED_DIRS = new Set([
  '.git', 'node_modules', '.opencode', '__pycache__', '.venv', 'venv',
  'env', '.env', 'dist', 'build', '.next', '.nuxt', 'coverage', '.cache',
]);

// Files to skip by exact name
const EXCLUDED_FILES = new Set([
  '.DS_Store', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
]);

// Extensions to skip (binary/minified/media)
const EXCLUDED_EXTS = new Set([
  '.pyc', '.pyo', '.class', '.o', '.so', '.dylib', '.exe', '.dll', '.wasm',
  '.min.js', '.min.css', '.map', '.lock',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
  '.woff', '.woff2', '.ttf', '.eot',
  '.mp3', '.mp4', '.wav', '.pdf', '.zip', '.tar', '.gz', '.db', '.sqlite',
]);

// Extensions/names to include (source + config)
const INCLUDED_EXTS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.py', '.rb', '.go', '.rs', '.java', '.kt',
  '.swift', '.c', '.cpp', '.h', '.hpp', '.cs', '.ex', '.exs', '.erl', '.hs',
  '.ml', '.clj', '.scala', '.r', '.php', '.lua',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
  '.html', '.htm', '.css', '.scss', '.less', '.sass',
  '.xml', '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
  '.md', '.txt', '.rst',
]);

// Basename patterns that are included regardless of extension
const INCLUDED_NAMES_EXACT = new Set([
  'Dockerfile', 'Makefile', 'Gemfile',
]);

// Basename prefixes/patterns for inclusion
function matchesIncludedName(name) {
  if (INCLUDED_NAMES_EXACT.has(name)) return true;
  const lower = name.toLowerCase();
  if (lower.startsWith('readme')) return true;
  if (lower.startsWith('license')) return true;
  if (lower.startsWith('changelog')) return true;
  if (lower.startsWith('dockerfile')) return true;
  if (lower.startsWith('docker-compose')) return true;
  if (lower === '.env.example' || lower === '.env.sample') return true;
  if (lower.startsWith('.eslintrc')) return true;
  if (lower.startsWith('.prettierrc')) return true;
  if (lower === 'tsconfig.json') return true;
  if (lower === 'cargo.toml' || lower === 'go.mod' || lower === 'go.sum') return true;
  if (lower === 'mix.exs' || lower === 'requirements.txt') return true;
  if (lower === 'setup.py' || lower === 'pyproject.toml') return true;
  if (/^vite\.config\./.test(lower)) return true;
  if (/^webpack\.config\./.test(lower)) return true;
  if (/^jest\.config\./.test(lower)) return true;
  return false;
}

// Check if extension matches .min.js / .min.css (double extension)
function hasMinExt(name) {
  return name.endsWith('.min.js') || name.endsWith('.min.css');
}

function shouldIncludeFile(name, extsOverride) {
  if (EXCLUDED_FILES.has(name)) return false;
  if (hasMinExt(name)) return false;
  const ext = extname(name).toLowerCase();
  if (EXCLUDED_EXTS.has(ext)) return false;
  if ((extsOverride || INCLUDED_EXTS).has(ext)) return true;
  if (matchesIncludedName(name)) return true;
  // .R extension (case-sensitive)
  if (extname(name) === '.R') return true;
  return false;
}

// Manifest files get priority-1 inclusion
const MANIFEST_NAMES = new Set([
  'package.json', 'cargo.toml', 'go.mod', 'mix.exs',
  'requirements.txt', 'pyproject.toml',
]);

function isManifest(name) {
  return MANIFEST_NAMES.has(name.toLowerCase());
}

// Priority-2: config/readme/docker files
function isPriorityConfig(name) {
  const lower = name.toLowerCase();
  return lower.startsWith('readme') ||
    lower.startsWith('dockerfile') ||
    lower.startsWith('docker-compose') ||
    lower === 'tsconfig.json' ||
    lower.startsWith('.eslintrc') ||
    lower.startsWith('.prettierrc') ||
    /^(vite|webpack|jest)\.config\./.test(lower);
}

async function walkDir(dir, baseDir, extraExcludeDirs, extraExcludeExts, includedExts) {
  const results = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const name = entry.name;
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(name)) continue;
      if (extraExcludeDirs && extraExcludeDirs.has(name)) continue;
      await walkDir(join(dir, name), baseDir, extraExcludeDirs, extraExcludeExts, includedExts).then(r => results.push(...r));
    } else if (entry.isFile()) {
      if (!shouldIncludeFile(name, includedExts)) continue;
      if (extraExcludeExts) {
        const ext = extname(name).toLowerCase();
        if (extraExcludeExts.has(ext)) continue;
      }
      const fullPath = join(dir, name);
      const relPath = relative(baseDir, fullPath);
      results.push({ fullPath, relPath, name });
    }
  }
  return results;
}

/**
 * Bundle a codebase directory into a single text string for LLM prompts.
 *
 * @param {string} codebasePath - Absolute path to the codebase root
 * @param {object} [options]
 * @param {number} [options.maxChars=400000] - Hard character budget
 * @param {string[]} [options.includePatterns] - Additional file extensions to include (e.g. ['.vue'])
 * @param {string[]} [options.excludePatterns] - Additional directory names or extensions to exclude
 * @returns {Promise<{bundle: string, manifest: string[], excluded: string[], totalFiles: number, totalChars: number, truncated: boolean}>}
 */
export async function bundleCodebase(codebasePath, options = {}) {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;

  // Clone INCLUDED_EXTS to avoid mutating the module-level set across pipeline runs
  const includedExts = new Set(INCLUDED_EXTS);
  if (options.includePatterns) {
    for (const p of options.includePatterns) {
      if (p.startsWith('.')) includedExts.add(p.toLowerCase());
    }
  }
  const extraExcludeDirs = new Set();
  const extraExcludeExts = new Set();
  if (options.excludePatterns) {
    for (const p of options.excludePatterns) {
      if (p.startsWith('.')) extraExcludeExts.add(p.toLowerCase());
      else extraExcludeDirs.add(p);
    }
  }

  // Walk and collect files
  const files = await walkDir(
    codebasePath, codebasePath,
    extraExcludeDirs.size ? extraExcludeDirs : null,
    extraExcludeExts.size ? extraExcludeExts : null,
    includedExts,
  );

  // Sort alphabetically for determinism
  files.sort((a, b) => a.relPath.localeCompare(b.relPath));

  // Config JSON files worth including regardless of size
  const CONFIG_JSON = new Set([
    'package.json', 'tsconfig.json', 'jsconfig.json', 'composer.json',
    '.eslintrc.json', '.prettierrc.json', 'vercel.json', 'netlify.json',
    'firebase.json', 'manifest.json', 'appsettings.json',
  ]);

  // Read all file contents, skip large non-config JSON/data files
  const fileData = [];
  for (const f of files) {
    try {
      const content = await readFile(f.fullPath, 'utf-8');
      // Skip large JSON files that are data blobs, not config
      const ext = extname(f.name).toLowerCase();
      if (ext === '.json' && content.length > 10_000 && !CONFIG_JSON.has(f.name.toLowerCase())) {
        continue; // Skip output/data JSON blobs (extraction results, audit reports, etc.)
      }
      fileData.push({ relPath: f.relPath, name: f.name, content, chars: content.length });
    } catch {
      // Skip unreadable files (binary misdetected, permission errors)
    }
  }

  const totalFiles = fileData.length;
  const totalChars = fileData.reduce((sum, f) => sum + f.chars + f.relPath.length + 12, 0); // 12 = "=== FILE:  ===\n" + "\n"

  // If within budget, include everything
  if (totalChars <= maxChars) {
    const bundle = fileData.map(f => `=== FILE: ${f.relPath} ===\n${f.content}\n`).join('');
    return {
      bundle,
      manifest: fileData.map(f => f.relPath),
      excluded: [],
      totalFiles,
      totalChars: bundle.length,
      truncated: false,
    };
  }

  // Over budget — prioritize files
  // Priority 1: manifests, Priority 2: config/readme/docker, Priority 3: source (largest first)
  const p1 = []; // manifests
  const p2 = []; // config/readme/docker
  const p3 = []; // everything else

  for (const f of fileData) {
    if (isManifest(f.name)) p1.push(f);
    else if (isPriorityConfig(f.name)) p2.push(f);
    else p3.push(f);
  }

  // Sort p3 by size descending (largest first for max coverage of significant files)
  p3.sort((a, b) => b.chars - a.chars);

  const included = [];
  const excluded = [];
  let usedChars = 0;

  function overhead(f) {
    return f.relPath.length + 16; // "=== FILE: " + " ===\n" + trailing "\n"
  }

  // Add priority 1 + 2 unconditionally
  for (const f of [...p1, ...p2]) {
    usedChars += f.chars + overhead(f);
    included.push(f);
  }

  // Add source files until budget
  for (const f of p3) {
    const cost = f.chars + overhead(f);
    if (usedChars + cost <= maxChars) {
      usedChars += cost;
      included.push(f);
    } else {
      excluded.push(f.relPath);
    }
  }

  // Re-sort included alphabetically for deterministic output
  included.sort((a, b) => a.relPath.localeCompare(b.relPath));

  let bundle = included.map(f => `=== FILE: ${f.relPath} ===\n${f.content}\n`).join('');

  if (excluded.length > 0) {
    bundle += `\n=== EXCLUDED FILES (${excluded.length} files omitted due to ${maxChars} char budget) ===\n`;
    bundle += excluded.join('\n') + '\n';
  }

  return {
    bundle,
    manifest: included.map(f => f.relPath),
    excluded,
    totalFiles,
    totalChars: bundle.length,
    truncated: true,
  };
}
