import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';

const ROOT = process.cwd();
const OUTPUT_PATH = path.join(ROOT, 'docs/generated/module-map.md');
const CHECK_MODE = process.argv.includes('--check');
const HANDBOOK_FILES = [
  'README.md',
  'AGENTS.md',
  'CONTEXT.md',
  'docs/ARCHITECTURE.md',
  'docs/INTEGRATION_SPEC.md',
  'docs/vehicle_editor/AGENT_TASKS.md',
  'docs/vehicle_editor/ARCHITECTURE.md',
];

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function relativeToRoot(filePath) {
  return toPosix(path.relative(ROOT, filePath));
}

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolute = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(absolute) : [absolute];
    });
}

function lineCount(text) {
  if (text.length === 0) return 0;
  const lines = text.split(/\r?\n/).length;
  return text.endsWith('\n') ? lines - 1 : lines;
}

function bindingNames(name, names = []) {
  if (ts.isIdentifier(name)) {
    names.push(name.text);
    return names;
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) bindingNames(element.name, names);
  }
  return names;
}

function hasExportModifier(node) {
  if (!ts.canHaveModifiers(node)) return false;
  return Boolean(
    ts
      .getModifiers(node)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
  );
}

function exportedNames(sourceFile) {
  const names = [];
  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          names.push(element.name.text);
        }
      } else if (!statement.moduleSpecifier) {
        names.push('*');
      }
      continue;
    }
    if (ts.isExportAssignment(statement)) {
      names.push('default');
      continue;
    }
    if (!hasExportModifier(statement)) continue;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        bindingNames(declaration.name, names);
      }
      continue;
    }
    if ('name' in statement && statement.name && ts.isIdentifier(statement.name)) {
      names.push(statement.name.text);
    } else {
      names.push('default');
    }
  }
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

function moduleSpecifiers(sourceFile) {
  const specifiers = [];
  for (const statement of sourceFile.statements) {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      specifiers.push(statement.moduleSpecifier.text);
    }
  }
  return specifiers;
}

function externalPackage(specifier) {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
  return specifier.split('/')[0];
}

function resolveRelativeImport(importer, specifier) {
  if (!specifier.startsWith('.')) return null;
  const absolute = path.resolve(path.dirname(importer), specifier);
  const candidates = [
    absolute,
    `${absolute}.ts`,
    path.join(absolute, 'index.ts'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function parseModule(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const specifiers = moduleSpecifiers(sourceFile);
  return {
    path: relativeToRoot(filePath),
    absolutePath: filePath,
    loc: lineCount(text),
    exports: exportedNames(sourceFile),
    internalImports: [...new Set(
      specifiers
        .map((specifier) => resolveRelativeImport(filePath, specifier))
        .filter(Boolean)
        .map(relativeToRoot)
        .filter((resolved) => resolved.startsWith('src/')),
    )].sort(),
    externalImports: [...new Set(
      specifiers
        .filter((specifier) => !specifier.startsWith('.'))
        .map(externalPackage),
    )].sort(),
  };
}

function codeList(values, empty = 'none') {
  return values.length > 0
    ? values.map((value) => `\`${value}\``).join(', ')
    : empty;
}

function docLink(filePath) {
  return `[\`${filePath}\`](../../${filePath})`;
}

function generateModuleMap() {
  const sourcePaths = walk(path.join(ROOT, 'src'))
    .filter((filePath) => filePath.endsWith('.ts'))
    .sort();
  const modules = sourcePaths.map(parseModule);
  const sourceSet = new Set(sourcePaths.map((filePath) => path.resolve(filePath)));
  const testPaths = [path.join(ROOT, 'unit'), path.join(ROOT, 'tests')]
    .flatMap(walk)
    .filter((filePath) => filePath.endsWith('.ts'))
    .sort();
  const directTests = new Map(modules.map((module) => [module.path, []]));

  for (const testPath of testPaths) {
    const text = fs.readFileSync(testPath, 'utf8');
    const sourceFile = ts.createSourceFile(
      testPath,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    for (const specifier of moduleSpecifiers(sourceFile)) {
      const resolved = resolveRelativeImport(testPath, specifier);
      if (!resolved || !sourceSet.has(path.resolve(resolved))) continue;
      directTests.get(relativeToRoot(resolved))?.push(relativeToRoot(testPath));
    }
  }

  const dependents = new Map(modules.map((module) => [module.path, []]));
  for (const module of modules) {
    for (const dependency of module.internalImports) {
      dependents.get(dependency)?.push(module.path);
    }
  }

  const totalLoc = modules.reduce((sum, module) => sum + module.loc, 0);
  const groups = new Map();
  for (const module of modules) {
    const group = module.path.split('/')[1];
    const groupedModules = groups.get(group) ?? [];
    groupedModules.push(module);
    groups.set(group, groupedModules);
  }
  const hotspots = [...modules].sort((a, b) => b.loc - a.loc).slice(0, 10);
  const lines = [
    '# Generated TypeScript Module Map',
    '',
    '> Generated by `npm run context:generate` from the TypeScript AST. Do not',
    '> edit by hand. Search this file for a path or exported symbol; do not read',
    '> it end to end as routine task setup.',
    '',
    `- Source Modules: ${modules.length}`,
    `- Source lines: ${totalLoc.toLocaleString('en-US')}`,
    `- Test files scanned: ${testPaths.length}`,
    '',
    '## Largest Modules',
    '',
    '| Module | LOC |',
    '| --- | ---: |',
    ...hotspots.map((module) => `| ${docLink(module.path)} | ${module.loc} |`),
    '',
  ];

  for (const [group, groupedModules] of [...groups.entries()].sort()) {
    lines.push(`## src/${group}`, '');
    for (const module of groupedModules) {
      const tests = [...new Set(directTests.get(module.path) ?? [])].sort();
      const importedBy = [...new Set(dependents.get(module.path) ?? [])].sort();
      lines.push(
        `### ${docLink(module.path)} (${module.loc} LOC)`,
        '',
        `- Exports: ${codeList(module.exports)}`,
        `- Imports: ${codeList(module.internalImports)}`,
        `- Imported by: ${codeList(importedBy)}`,
        `- External packages: ${codeList(module.externalImports)}`,
        `- Direct tests: ${codeList(tests)}`,
        '',
      );
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function validateMarkdownLinks(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const failures = [];
  for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const rawTarget = match[1].replace(/^<|>$/g, '');
    if (/^(?:https?:|mailto:|#)/.test(rawTarget)) continue;
    const target = decodeURIComponent(rawTarget.split('#')[0]);
    const absolute = path.resolve(path.dirname(filePath), target);
    if (!fs.existsSync(absolute)) failures.push(rawTarget);
  }
  return failures;
}

function validateBacktickedPaths(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const failures = [];
  const pattern = /`((?:src|unit|tests|docs|scripts)\/[^`\n]+?\.(?:ts|css|md|mjs))`/g;
  for (const match of text.matchAll(pattern)) {
    const candidate = match[1];
    if (candidate.includes('*')) continue;
    if (!fs.existsSync(path.join(ROOT, candidate))) failures.push(candidate);
  }
  return failures;
}

function validateHandbook() {
  const failures = [];
  for (const relativePath of HANDBOOK_FILES) {
    const absolute = path.join(ROOT, relativePath);
    if (!fs.existsSync(absolute)) {
      failures.push(`${relativePath}: missing required handbook file`);
      continue;
    }
    for (const target of validateMarkdownLinks(absolute)) {
      failures.push(`${relativePath}: broken link ${target}`);
    }
    for (const target of validateBacktickedPaths(absolute)) {
      failures.push(`${relativePath}: missing path ${target}`);
    }
  }
  return failures;
}

const generated = generateModuleMap();

if (CHECK_MODE) {
  const current = fs.existsSync(OUTPUT_PATH)
    ? fs.readFileSync(OUTPUT_PATH, 'utf8')
    : null;
  const failures = validateHandbook();
  if (current !== generated) {
    failures.push(
      'docs/generated/module-map.md is stale; run npm run context:generate',
    );
  }
  if (failures.length > 0) {
    for (const failure of failures) console.error(`context:check: ${failure}`);
    process.exitCode = 1;
  } else {
    console.log('Agent context documentation is current.');
  }
} else {
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, generated);
  console.log(`Wrote ${relativeToRoot(OUTPUT_PATH)}.`);
}
