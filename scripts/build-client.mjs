import esbuild from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';

const workspace = path.resolve(process.cwd(), 'client');
const outdir = path.join(workspace, 'dist');
await fs.rm(outdir, { recursive: true, force: true });
await fs.mkdir(outdir, { recursive: true });
await esbuild.build({
  entryPoints: [path.join(workspace, 'src/main.jsx')],
  outfile: path.join(outdir, 'assets/app.js'),
  bundle: true,
  minify: true,
  sourcemap: false,
  format: 'esm',
  jsx: 'automatic',
  loader: { '.jsx': 'jsx', '.css': 'css' },
  legalComments: 'none'
});
const indexPath = path.join(workspace, 'index.html');
let index = await fs.readFile(indexPath, 'utf8');
index = index.replace('<script type="module" src="/src/main.jsx"></script>', '<link rel="stylesheet" href="/assets/app.css" /><script type="module" src="/assets/app.js"></script>');
await fs.writeFile(path.join(outdir, 'index.html'), index);
