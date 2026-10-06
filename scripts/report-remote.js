import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const sql = readFileSync(new URL('./report-d1.sql', import.meta.url), 'utf8');
// Remote --file imports SQL and returns an execution summary, not SELECT rows.
// One equals-form argument also preserves leading SQL comments without a shell.
const result = spawnSync(process.execPath, [
  fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url)),
  'd1', 'execute', 'DB', '--remote', `--command=${sql}`, '--json',
], { cwd: root, stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
