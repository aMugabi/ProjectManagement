// Node module hook: lets Node (22.18+, which strips TypeScript types itself) run the TypeScript in
// api/ and src/shared directly. Their imports say '.js', as Vercel's compiler wants; when no such
// file exists, use the '.ts' file beside it. Registered by scripts/ts-register.mjs.
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' && /^\.{1,2}\/.*\.js$/.test(specifier)) {
      return next(specifier.slice(0, -3) + '.ts', context);
    }
    throw error;
  }
}
