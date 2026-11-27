import { build } from 'esbuild';

const common = {
  bundle: true,
  sourcemap: true,
  target: ['chrome114', 'firefox109'],
};

await Promise.all([
  build({
    ...common,
    entryPoints: ['src/background/index.ts'],
    outfile: 'dist/background.js',
    format: 'esm',
  }),
  build({
    ...common,
    entryPoints: ['src/content/index.ts'],
    outfile: 'dist/content.js',
    format: 'iife',
  }),
  build({
    ...common,
    entryPoints: { popup: 'src/popup/index.ts', schedule: 'src/options/index.ts' },
    outdir: 'dist',
    format: 'esm',
  }),
]);

console.log('Built background, content, popup, and schedule bundles');
