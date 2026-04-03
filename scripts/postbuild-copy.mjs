import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');

if (!fs.existsSync(dist)) {
  console.error('dist/ missing — run vite build first');
  process.exit(1);
}

for (const name of ['js', 'css']) {
  const src = path.join(root, name);
  const dest = path.join(dist, name);
  if (fs.existsSync(src)) {
    fs.cpSync(src, dest, { recursive: true });
    console.log('copied', name, '→ dist/' + name);
  }
}
