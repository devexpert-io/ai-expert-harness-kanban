import { statSync } from 'node:fs';

const stamp = (path) => {
  try {
    const stat = statSync(path);
    return `${stat.ino}:${stat.size}:${stat.mtimeMs}`;
  } catch { return 'missing'; }
};

// Memoizes a display-only loader until one of the files it read changes. Failures are never cached.
export function fileMemo(load, dependencies) {
  let cached = null;
  return (key) => {
    if (cached?.key === key && cached.stamps.every(([path, value]) => stamp(path) === value)) return cached.value;
    cached = null;
    const value = load(key);
    cached = { key, value, stamps: dependencies(key, value).map((path) => [path, stamp(path)]) };
    return value;
  };
}
