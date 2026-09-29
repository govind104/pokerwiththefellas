import '@testing-library/jest-dom/vitest';

// jsdom has no WebGL, so tests run against the 2D Blackjack table unless a test opts in.
beforeEach(() => {
  window.localStorage.setItem('table.view', '2d');
});
