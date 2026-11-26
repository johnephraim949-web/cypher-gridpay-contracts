import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import mermaid from 'astro-mermaid';

// Documentation portal for Cypher GridPay.
// Consumes the source-of-truth Markdown in ../docs without duplicating it.
// API references (Rustdoc, TypeDoc, pdoc) are generated into ./public/api
// by scripts/build-api-docs.sh before the site build runs.
export default defineConfig({
  site: 'https://cypher-gridpay.github.io',
  base: '/',
  outDir: './dist',
  integrations: [
    mermaid({
      theme: 'default',
      // Fail the build on invalid Mermaid blocks instead of silently
      // rendering an error placeholder.
      enableLogs: true,
    }),
    starlight({
      title: 'Cypher GridPay Docs',
      description:
        'Unified documentation for Cypher GridPay: guides, ADRs, and Rust, TypeScript, and Python API references.',
      logo: {
        src: './src/assets/logo.svg',
        replacesTitle: false,
      },
      // Local Pagefind full-text search (built into Starlight).
      pagefind: true,
      // Dark/light theme support.
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
      },
      social: {
        github: 'https://github.com/cypher-gridpay/cypher-gridpay',
      },
      editLink: {
        baseUrl: 'https://github.com/cypher-gridpay/cypher-gridpay/edit/main/',
      },
      // Version selector: expose the current docs version in the sidebar.
      // Additional versions can be added as separate content collections.
      components: {
        // Custom component renders the version selector in the header.
        Header: './src/components/Header.astro',
      },
      sidebar: [
        {
          label: 'Guides',
          items: [
            { label: 'Merchant Integration Guide', link: '/guides/merchant-integration/' },
            { label: 'Error Codes', link: '/guides/error-codes/' },
          ],
        },
        {
          label: 'Architecture Decision Records',
          autogenerate: { directory: 'adr' },
        },
        {
          label: 'API Reference',
          items: [
            { label: 'Rust (core & orchestrator)', link: '/api/rust/' },
            { label: 'TypeScript SDK', link: '/api/typescript/' },
            { label: 'Python SDK', link: '/api/python/' },
          ],
        },
      ],
      // Fail the build on broken internal links and missing anchors.
      // Starlight surfaces these via the `starlight-links-validator` plugin.
      plugins: [],
    }),
  ],
  vite: {
    // Keep the generated API reference directories out of Vite's watcher
    // to avoid rebuild loops during local development.
    server: {
      watch: {
        ignored: ['**/public/api/**'],
      },
    },
  },
});
