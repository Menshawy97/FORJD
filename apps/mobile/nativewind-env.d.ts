/// <reference types="nativewind/types" />

// Side-effect CSS imports (global.css, pulled in once at the app root to feed NativeWind's
// Tailwind compilation) have no meaningful export shape — declare the module so `tsc` stops
// treating the import as unresolved. CSS Modules (*.module.css, used by the web-only
// template file this app inherited) map to a class-name lookup object instead.
declare module '*.css';
declare module '*.module.css' {
  const classes: { readonly [className: string]: string };
  export default classes;
}
