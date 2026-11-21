# GridPay design tokens

Run `npm ci` and `npm test` from this directory. Style Dictionary resolves
the DTCG tokens in `tokens.json` to the web stylesheet and TypeScript theme
objects and declarations in `dist/`. Commit the regenerated stylesheet when
changing the source. Open the [token showcase](../../apps/web/token-showcase.html)
in a browser to review the two themes.

Import `apps/web/src/styles/fonts.css` and `tokens.css` into the consuming
app. Light is the default. Set `data-theme="dark"` on the console root and
`data-theme="light"` on any nested light surface. The stylesheet sets all
motion duration variables to zero when reduced motion is requested. Use the
same duration variables for both transitions and animations.

Use `gp-numeric` for addresses, hashes and amounts. It selects the bundled
JetBrains Mono font, tabular figures and slashed zero, and disables ligatures.
Display the full address when the user verifies a transfer and validate its
network, type and checksum in the application.

Use semantic foreground/background pairs together, including the paired
action colors. Place default text, muted text, control borders and focus
outlines on the surface or raised surface. Keep a text label for each status.
The brand and neutral ramps are palette primitives.

The package exports `themes`, `ThemeName` and `TokenName`. Tailwind consumers
using a JavaScript config can load `@cypher-gridpay/design-tokens/tailwind`
as a preset after building the package, then use classes such as
`bg-semantic-surface` or `text-semantic-text`. Import the CSS to resolve
the variables referenced by the preset.
