import { build } from 'esbuild';

await build({
  entryPoints: ['tests/policy.test.ts'],
  outfile: 'dist-tests/policy.test.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
});
