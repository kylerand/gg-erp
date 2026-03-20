import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const CHECKLIST_PATTERN = /^\s*-\s+\[(?<state>[ xX])\]\s+/;
const DECISION_STATUS_PATTERN = /^\s*-\s+\*\*Status:\*\*\s*(?<status>.+?)\s*$/i;
const PRIORITY_PATTERN = /^\s*\d+\.\s+\*\*(?<priority>P\d+):\*\*\s+(?<title>.+?)\s*$/i;
const TABLE_ROW_PATTERN = /^\|.+\|\s*$/;
const TABLE_DIVIDER_PATTERN = /^\|\s*[-:\s|]+\|\s*$/;

const STATUS_ICONS = {
  covered: '✅',
  partial: '⚠️',
  gap: '❌',
};

const EXPLICIT_TABLE_STATUSES = new Map([
  ['done', 'covered'],
  ['covered', 'covered'],
  ['complete', 'covered'],
  ['completed', 'covered'],
  ['in progress', 'partial'],
  ['in review', 'partial'],
  ['partial', 'partial'],
  ['blocked', 'gap'],
  ['not started', 'gap'],
  ['gap', 'gap'],
  ['pending', 'gap'],
]);

function normalizeDecisionStatus(value) {
  return value.trim().toLowerCase().replace(/[^\w\s-]/g, '');
}

function statusFromTableRow(line) {
  if (line.includes(STATUS_ICONS.gap)) {
    return 'gap';
  }

  if (line.includes(STATUS_ICONS.partial)) {
    return 'partial';
  }

  if (line.includes(STATUS_ICONS.covered)) {
    return 'covered';
  }

  return null;
}

function normalizeTableCellStatus(value) {
  return value
    .replace(/[✅⚠️❌]/gu, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, ' ');
}

function statusFromTableCells(cells) {
  for (const cellValue of cells) {
    const normalizedValue = normalizeTableCellStatus(cellValue);
    const mappedStatus = EXPLICIT_TABLE_STATUSES.get(normalizedValue);
    if (mappedStatus) {
      return mappedStatus;
    }
  }

  return null;
}

function toRelativePath(filePath) {
  const relativePath = path.relative(process.cwd(), filePath);
  return relativePath.length > 0 ? relativePath : filePath;
}

function parseArgs(argv) {
  const options = {
    json: false,
    paths: ['docs/architecture'],
  };
  let hasCustomPath = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg === '--path') {
      const nextValue = argv[index + 1];
      if (!nextValue) {
        throw new Error('Missing value for --path');
      }

      if (!hasCustomPath) {
        options.paths = [];
        hasCustomPath = true;
      }

      options.paths.push(nextValue);
      index += 1;
      continue;
    }

    if (arg === '--help') {
      options.help = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

async function walkMarkdownFiles(directoryPath) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const sortedEntries = entries.sort((left, right) => left.name.localeCompare(right.name));
  const markdownFiles = [];

  for (const entry of sortedEntries) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      const nestedFiles = await walkMarkdownFiles(entryPath);
      markdownFiles.push(...nestedFiles);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.md')) {
      markdownFiles.push(entryPath);
    }
  }

  return markdownFiles;
}

async function collectMarkdownFiles(targetPaths) {
  const markdownFiles = new Set();

  for (const targetPath of targetPaths) {
    const absolutePath = path.resolve(process.cwd(), targetPath);
    const targetStats = await stat(absolutePath).catch(() => null);
    if (!targetStats) {
      throw new Error(`Path not found: ${targetPath}`);
    }

    if (targetStats.isFile()) {
      if (absolutePath.endsWith('.md')) {
        markdownFiles.add(absolutePath);
      }
      continue;
    }

    if (targetStats.isDirectory()) {
      const filesInDirectory = await walkMarkdownFiles(absolutePath);
      for (const markdownPath of filesInDirectory) {
        markdownFiles.add(markdownPath);
      }
      continue;
    }

    throw new Error(`Unsupported path type: ${targetPath}`);
  }

  return [...markdownFiles].sort((left, right) => left.localeCompare(right));
}

function analyzeMarkdownPlan(content) {
  const analysis = {
    checklist: {
      total: 0,
      done: 0,
    },
    tableStatus: {
      covered: 0,
      partial: 0,
      gap: 0,
    },
    decisions: {
      accepted: 0,
      pending: 0,
    },
    openItems: [],
    priorityItems: [],
  };

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trimEnd();

    const checklistMatch = line.match(CHECKLIST_PATTERN);
    if (checklistMatch) {
      analysis.checklist.total += 1;
      if (checklistMatch.groups?.state.toLowerCase() === 'x') {
        analysis.checklist.done += 1;
      }
      continue;
    }

    const decisionStatusMatch = line.match(DECISION_STATUS_PATTERN);
    if (decisionStatusMatch?.groups?.status) {
      const normalizedStatus = normalizeDecisionStatus(decisionStatusMatch.groups.status);
      if (normalizedStatus.startsWith('accepted')) {
        analysis.decisions.accepted += 1;
      } else {
        analysis.decisions.pending += 1;
      }
      continue;
    }

    const priorityMatch = line.match(PRIORITY_PATTERN);
    if (priorityMatch?.groups?.priority && priorityMatch.groups?.title) {
      analysis.priorityItems.push({
        priority: priorityMatch.groups.priority.toUpperCase(),
        title: priorityMatch.groups.title.trim(),
      });
      continue;
    }

    const trimmedLine = line.trim();
    if (!TABLE_ROW_PATTERN.test(trimmedLine) || TABLE_DIVIDER_PATTERN.test(trimmedLine)) {
      continue;
    }

    const cells = trimmedLine
      .split('|')
      .slice(1, -1)
      .map((cellValue) => cellValue.trim());

    const rowStatus = statusFromTableRow(trimmedLine) ?? statusFromTableCells(cells);
    if (!rowStatus) {
      continue;
    }

    analysis.tableStatus[rowStatus] += 1;

    if (rowStatus === 'covered') {
      continue;
    }

    const label = cells[0] ?? '(unnamed item)';
    const detail =
      cells.find(
        (cellValue) =>
          cellValue.includes(STATUS_ICONS.gap) ||
          cellValue.includes(STATUS_ICONS.partial) ||
          EXPLICIT_TABLE_STATUSES.has(normalizeTableCellStatus(cellValue)),
      ) ?? '';

    analysis.openItems.push({
      label,
      status: rowStatus,
      detail: detail.replace(/\s+/g, ' ').trim(),
    });
  }

  const checklistOpen = analysis.checklist.total - analysis.checklist.done;
  const tableTotal =
    analysis.tableStatus.covered + analysis.tableStatus.partial + analysis.tableStatus.gap;
  const decisionTotal = analysis.decisions.accepted + analysis.decisions.pending;

  const totalItems = analysis.checklist.total + tableTotal + decisionTotal;
  const completeItems =
    analysis.checklist.done + analysis.tableStatus.covered + analysis.decisions.accepted;
  const partialItems = analysis.tableStatus.partial;
  const gapItems = checklistOpen + analysis.tableStatus.gap + analysis.decisions.pending;
  const completionPoints = completeItems + partialItems * 0.5;
  const completionRatio = totalItems === 0 ? 0 : completionPoints / totalItems;

  return {
    ...analysis,
    totals: {
      totalItems,
      completeItems,
      partialItems,
      gapItems,
    },
    completion: {
      points: completionPoints,
      ratio: completionRatio,
      percent: Number((completionRatio * 100).toFixed(1)),
    },
  };
}

async function analyzePlanFile(filePath) {
  const content = await readFile(filePath, 'utf8');
  return {
    path: toRelativePath(filePath),
    ...analyzeMarkdownPlan(content),
  };
}

function summarizeProject(planSummaries) {
  const summary = {
    totalItems: 0,
    completeItems: 0,
    partialItems: 0,
    gapItems: 0,
    completionPoints: 0,
  };

  for (const planSummary of planSummaries) {
    summary.totalItems += planSummary.totals.totalItems;
    summary.completeItems += planSummary.totals.completeItems;
    summary.partialItems += planSummary.totals.partialItems;
    summary.gapItems += planSummary.totals.gapItems;
    summary.completionPoints += planSummary.completion.points;
  }

  const completionRatio =
    summary.totalItems === 0 ? 0 : summary.completionPoints / summary.totalItems;

  return {
    ...summary,
    completionRatio,
    completionPercent: Number((completionRatio * 100).toFixed(1)),
  };
}

function renderProgressBar(ratio, width = 28) {
  const clampedRatio = Math.max(0, Math.min(1, ratio));
  const filledSlots = Math.round(clampedRatio * width);
  const emptySlots = width - filledSlots;
  return `[${'#'.repeat(filledSlots)}${'-'.repeat(emptySlots)}]`;
}

function renderDashboard(report) {
  const lines = [];
  const overall = report.overall;

  lines.push('Project plan progress dashboard');
  lines.push('');
  lines.push(
    `Overall ${renderProgressBar(overall.completionRatio)} ${overall.completionPercent.toFixed(1)}%`,
  );
  lines.push(
    `Items: complete=${overall.completeItems}, partial=${overall.partialItems}, gap=${overall.gapItems}, total=${overall.totalItems}`,
  );

  lines.push('');
  lines.push('Per-plan summary');

  const scoredPlans = report.plans
    .filter((planSummary) => planSummary.totals.totalItems > 0)
    .sort((left, right) => left.path.localeCompare(right.path));

  if (scoredPlans.length === 0) {
    lines.push('- No plan status signals found in scanned markdown files.');
    return lines.join('\n');
  }

  for (const planSummary of scoredPlans) {
    lines.push(`- ${planSummary.path}`);
    lines.push(
      `  ${renderProgressBar(planSummary.completion.ratio, 18)} ${planSummary.completion.percent.toFixed(1)}%`,
    );
    lines.push(
      `  complete=${planSummary.totals.completeItems}, partial=${planSummary.totals.partialItems}, gap=${planSummary.totals.gapItems}, total=${planSummary.totals.totalItems}`,
    );
  }

  const openItems = scoredPlans.flatMap((planSummary) =>
    planSummary.openItems.map((openItem) => ({
      ...openItem,
      planPath: planSummary.path,
    })),
  );

  if (openItems.length > 0) {
    lines.push('');
    lines.push('Open plan items');
    for (const openItem of openItems.slice(0, 8)) {
      const statusLabel = openItem.status === 'gap' ? 'GAP' : 'PARTIAL';
      lines.push(`- [${statusLabel}] ${openItem.label} (${openItem.planPath})`);
    }
  }

  const priorityItems = scoredPlans.flatMap((planSummary) =>
    planSummary.priorityItems.map((priorityItem) => ({
      ...priorityItem,
      planPath: planSummary.path,
      rank: Number.parseInt(priorityItem.priority.replace('P', ''), 10),
    })),
  );

  if (priorityItems.length > 0) {
    lines.push('');
    lines.push('Priority sequence');
    for (const priorityItem of priorityItems.sort((left, right) => left.rank - right.rank)) {
      lines.push(`- ${priorityItem.priority}: ${priorityItem.title} (${priorityItem.planPath})`);
    }
  }

  return lines.join('\n');
}

function printUsage() {
  console.log(`Usage: node ./scripts/plan-progress.mjs [--path <file-or-dir>] [--json] [--help]

Examples:
  node ./scripts/plan-progress.mjs
  node ./scripts/plan-progress.mjs --path docs/architecture/employee-web-api-dependency-map.md
  node ./scripts/plan-progress.mjs --path docs/architecture --json`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const markdownFiles = await collectMarkdownFiles(options.paths);
  if (markdownFiles.length === 0) {
    throw new Error('No markdown files found for the provided path(s).');
  }

  const plans = await Promise.all(markdownFiles.map((markdownFile) => analyzePlanFile(markdownFile)));
  const overall = summarizeProject(plans);

  const report = {
    generatedAt: new Date().toISOString(),
    scannedFiles: markdownFiles.length,
    overall,
    plans,
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(renderDashboard(report));
}

const isMainModule =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMainModule) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

export { analyzeMarkdownPlan, renderDashboard, summarizeProject };
