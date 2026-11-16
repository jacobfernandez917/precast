import { statfsSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const GiB = 1024 ** 3;
const diskSpace = (root) => {
  const { bavail, bsize } = statfsSync(root);
  return { bavail, bsize };
};
/** Check the project filesystem before a cold install; this never removes a file. */
export function checkBootstrapSpace(
  root,
  inspect = diskSpace,
  installed = existsSync(join(root, 'node_modules/.modules.yaml')),
) {
  const stats = inspect(root);
  const available = Number(stats.bavail) * Number(stats.bsize);
  const required = (installed ? 2 : 6) * GiB;
  if (available < required)
    throw new Error(
      `The project disk needs ${required / GiB} GiB free for dependencies and build files (${(available / GiB).toFixed(1)} GiB available). Ask the owner to free reproducible build files or provide more space; no files were deleted.`,
    );
}
