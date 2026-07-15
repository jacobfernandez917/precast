// Astryx (@astryxdesign/core) ships components compiled with React's
// *development* JSX runtime (`jsxDEV` from `react/jsx-dev-runtime`). React's
// real dev runtime does not expose `jsxDEV` in a production build, so those
// components crash during `next build`. This shim maps `jsxDEV` onto the
// production `jsx`; the extra dev-only arguments (isStaticChildren, source,
// self) are simply ignored. Aliased in for production builds only — see
// next.config.ts.
export { Fragment, jsx as jsxDEV } from 'react/jsx-runtime';
