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
    entryPoints: ['src/popup/index.ts'],
    outfile: 'dist/popup.js',
    format: 'esm',
  }),
]);

console.log('Built dist/background.js, dist/content.js, and dist/popup.js');
