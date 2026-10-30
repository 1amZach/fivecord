import * as esbuild from 'esbuild';

const options = {
    entryPoints: ['src/index.ts'],
    outfile: 'dist/server.js',
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    minify: true,
    legalComments: 'external',
    // optional native addons discord.js tries to load, fine without them
    external: ['zlib-sync', 'bufferutil', 'utf-8-validate', 'erlpack'],
};

if (process.argv.includes('--watch')) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
} else {
    await esbuild.build(options);
}
