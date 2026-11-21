import assert from 'node:assert/strict';
import { themes } from './dist/themes.js';

function luminance(hex) {
  assert.match(hex, /^#[\da-f]{6}$/i);
  const channels = hex.slice(1).match(/../g).map((pair) => {
    const srgb = Number.parseInt(pair, 16) / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

let passed = 0;
const failures = [];
for (const [mode, theme] of Object.entries(themes)) {
  function check(foreground, background, minimum) {
    const [low, high] = [foreground, background]
      .map((name) => luminance(theme[`semantic-${name}`]))
      .sort((a, b) => a - b);
    const ratio = (high + 0.05) / (low + 0.05);
    if (ratio >= minimum) {
      passed++;
    } else {
      failures.push(`${mode} ${foreground} on ${background}: ${ratio.toFixed(2)} < ${minimum}`);
    }
  }

  for (const bg of ['surface', 'raised']) {
    for (const text of ['text', 'muted']) check(text, bg, 4.5);
    for (const control of ['border', 'focus', 'action-background']) check(control, bg, 3);
  }
  const backgrounds = Object.keys(theme).filter((name) => /^semantic-.*-background$/.test(name));
  const foregrounds = Object.keys(theme).filter((name) => /^semantic-.*-foreground$/.test(name));
  assert.deepEqual(backgrounds.map((name) => name.replace(/background$/, 'foreground')).sort(), foregrounds.sort());
  for (const name of backgrounds) {
    const pair = name.replace(/^semantic-|-background$/g, '');
    check(`${pair}-foreground`, `${pair}-background`, 4.5);
  }
}
console.log(`${passed}/${passed + failures.length} semantic pairs meet WCAG 2.1 AA.`);
assert.deepEqual(failures, []);
