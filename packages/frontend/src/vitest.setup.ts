import '@testing-library/jest-dom/vitest';

// jsdom has no WebGL, so tests run against the flat view ('2d' is the stored flat preference) unless a test opts in.
beforeEach(() => {
  window.localStorage.setItem('table.view', '2d');
});
