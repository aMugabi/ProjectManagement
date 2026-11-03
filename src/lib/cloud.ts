/**
 * Whether this build talks to the /api/* serverless functions. True only on Vercel
 * builds (and `vercel dev`); GitHub Pages and plain `npm run dev` run in local-only
 * mode — data stays in this browser, with no login gate and no push.
 */
export const CLOUD_ENABLED = import.meta.env.VITE_CLOUD === 'true';
