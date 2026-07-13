/**
 * Ambient module declaration for CSS side-effect imports (Vite handles the
 * actual loading at build/dev time). Scoped to this package's needs; no
 * shared/frozen file touched.
 */
declare module "*.css";
