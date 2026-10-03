import { beforeEach, describe, expect, it } from 'vitest';
import { chooseTableLayout, readViewPref, writeViewPref } from './tableLayout';

describe('chooseTableLayout', () => {
  const wide = { width: 1280, height: 720 };
  it('uses the overlay on a wide enough window when 3D is wanted and working', () => {
    expect(chooseTableLayout({ ...wide, pref: '3d', failed: false })).toBe('overlay');
    expect(chooseTableLayout({ width: 1024, height: 768, pref: '3d', failed: false })).toBe('overlay');
  });
  it('goes flat by choice, on failure, or when the window is too narrow or too tall', () => {
    expect(chooseTableLayout({ ...wide, pref: 'flat', failed: false })).toBe('column');
    expect(chooseTableLayout({ ...wide, pref: '3d', failed: true })).toBe('column');
    expect(chooseTableLayout({ width: 899, height: 500, pref: '3d', failed: false })).toBe('column');
    expect(chooseTableLayout({ width: 1280, height: 1100, pref: '3d', failed: false })).toBe('column');
    expect(chooseTableLayout({ width: 1280, height: 0, pref: '3d', failed: false })).toBe('column');
  });
});

describe('view preference', () => {
  beforeEach(() => window.localStorage.removeItem('table.view'));
  it("reads '2d' as flat and anything else as 3D, and writes '2d' for flat", () => {
    expect(readViewPref()).toBe('3d');
    window.localStorage.setItem('table.view', '2d');
    expect(readViewPref()).toBe('flat');
    window.localStorage.setItem('table.view', 'nonsense');
    expect(readViewPref()).toBe('3d');
    writeViewPref('flat');
    expect(window.localStorage.getItem('table.view')).toBe('2d');
    writeViewPref('3d');
    expect(window.localStorage.getItem('table.view')).toBe('3d');
  });
});
