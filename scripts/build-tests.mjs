import { build } from 'esbuild';

await build({
  entryPoints: ['tests/policy.test.ts', 'tests/schedule.test.ts'],
  outdir: 'dist-tests',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
});
