import { readFile } from "node:fs/promises";
const input = await readFile(process.argv[2] || "/dev/stdin", "utf8");
const groups = new Map();
for (const line of input.split("\n")) {
  const match = line.match(/AI request metric\s+(\{.*\})/);
  if (!match) continue;
  let record;
  try {
    record = JSON.parse(match[1]);
  } catch {
    continue;
  }
  const group = groups.get(record.task) || [];
  group.push(record);
  groups.set(record.task, group);
}
const percentile = (values, p) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null;
};
for (const [task, rows] of groups)
  console.log(
    JSON.stringify({
      task,
      requests: rows.length,
      successRate: rows.filter((r) => r.complete).length / rows.length,
      p50Ms: percentile(
        rows.map((r) => r.elapsedMs),
        0.5,
      ),
      p95Ms: percentile(
        rows.map((r) => r.elapsedMs),
        0.95,
      ),
      ttftP95Ms: percentile(
        rows.map((r) => r.ttftMs),
        0.95,
      ),
      errors: rows.filter((r) => r.status >= 400).length,
    }),
  );
