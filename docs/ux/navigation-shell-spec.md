# Navigation Shell & Role Switcher — UX Spec (Issue #417)

## 1. Problem

A single Stellar address can act as Customer, Merchant, Arbitrator, and Protocol Admin at the same time. A flat sidebar mixing all four roles causes context confusion and cross-context mistakes (e.g. a merchant initiating a customer action).

## 2. Application Shell

### 2.1 Desktop (>= 1280px)

- Collapsible left sidebar: `240px` expanded / `64px` icon rail.
- Sidebar header hosts the **Workspace / Role Switcher**.
- Top utility bar: Global Search trigger (`Cmd+K` / `Ctrl+K`), Network & Ledger Status, Notification Bell, Wallet Menu.
- Active role shown as a subtle badge in the header so the current context is always visible.

### 2.2 Tablet (768px–1279px)

- Sidebar defaults to the `64px` icon rail; expands on demand.
- Top utility bar remains; search collapses to an icon button.

### 2.3 Mobile (360px–767px)

- Bottom tab bar with **4 primary actions per role**.
- Secondary navigation lives in a slide-over drawer.
- Bottom tab bar must respect safe-area insets:
  `padding-bottom: env(safe-area-inset-bottom);`

## 3. Workspace / Role Switcher

- Auto-detects applicable roles from on-chain state (merchant registry, arbitrator registry, admin set) for the connected address.
- Shows only relevant roles by default.
- Optional **"Explore all workspaces"** toggle reveals roles the address is not currently enrolled in (read-only preview).
- Switching roles is route-based: the role is part of the route context, so deep-linked URLs keep working and are not rewritten on switch.

### 3.1 Primary actions per role (mobile tabs)

| Role       | Tabs                                              |
|------------|---------------------------------------------------|
| Customer   | Home · Invoices · Escrows · Disputes              |
| Merchant   | Dashboard · Settlements · Policies · Disputes     |
| Arbitrator | Queue · Cases · Rewards · Profile                 |
| Admin      | Overview · Registries · Parameters · Audit        |

## 4. Global Command Palette

- Opened with `Cmd+K` / `Ctrl+K`; closed with `Esc`.
- Lookup by Payment ID, Escrow ID, Refund ID, Stellar address, or quick route navigation.
- 100% keyboard-operable: `ArrowUp` / `ArrowDown` to move, `Enter` to select.
- ARIA combobox semantics: `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, with `role="listbox"` / `role="option"` on results.

## 5. Acceptance Criteria

- [ ] Shell adapts across Desktop (>= 1280px), Tablet (768–1279px), Mobile (360–767px).
- [ ] Role switcher auto-detects applicable roles; switching preserves deep-linked URLs.
- [ ] Command palette is fully keyboard-operable with ARIA combobox semantics.
- [ ] Active role is visually distinguished to prevent cross-context actions.
- [ ] Mobile bottom tabs respect `env(safe-area-inset-bottom)`.
