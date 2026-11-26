import { tokenNames } from './dist/themes.js';

const sections = {
  colors: /^(brand|neutral|semantic)-/,
  fontFamily: /^font-(sans|mono)$/,
  fontSize: /^font-size-/,
  fontWeight: /^font-weight-/,
  lineHeight: /^line-height-/,
  spacing: /^space-/,
  borderRadius: /^radius-/,
  boxShadow: /^elevation-/,
  transitionDuration: /^motion-duration-/,
  transitionTimingFunction: /^motion-easing-/,
};

export default {
  theme: {
    extend: Object.fromEntries(Object.entries(sections).map(([section, pattern]) => [
      section,
      Object.fromEntries(tokenNames.filter((name) => pattern.test(name)).map((name) => [
        section === 'colors' ? name : name.replace(pattern, ''),
        `var(--gp-${name})`,
      ])),
    ])),
  },
};
