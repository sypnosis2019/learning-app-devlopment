declare module "*.css";

export {};

declare global {
  namespace JSX {
    interface IntrinsicElements {
      ["s-app-nav"]: any;
      ["s-link"]: any;
      ["s-page"]: any;
      ["s-section"]: any;
      ["s-heading"]: any;
      ["s-paragraph"]: any;
      ["s-button"]: any;
      ["s-banner"]: any;
    }
  }
}
