import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Reads sample records from a JSON file in the repository. No network.
 *
 * To keep the demo looking current, a record may give relative times:
 *   posted_hours_ago  -> posted_at
 *   expires_in_days   -> expires_at
 */
export const fixtureAdapter = {
  async fetchItems(source, now = new Date()) {
    const file = path.resolve(ROOT, source.file);
    if (!file.startsWith(ROOT + path.sep)) throw new Error('Fixture path is outside the project');
    const records = JSON.parse(await readFile(file, 'utf8'));
    return records.map((r) => ({
      ...r,
      posted_at: r.posted_at ?? new Date(now.getTime() - (r.posted_hours_ago ?? 0) * 3_600_000).toISOString(),
      expires_at:
        r.expires_at ??
        (r.expires_in_days != null ? new Date(now.getTime() + r.expires_in_days * 86_400_000).toISOString() : null),
    }));
  },
};
