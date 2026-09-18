import { selectProjectFolder } from './folder-picker.mjs';
import { inspectProject } from './project-contract.mjs';

export async function chooseProject({ select = selectProjectFolder, inspect = inspectProject } = {}) {
  const path = await select();
  return path ? inspect(path) : null;
}
