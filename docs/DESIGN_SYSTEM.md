# NEXUS design system

Implemented foundations live in `app/tokens.css`, `app/styles.css`, `app/chrome.tsx`, `app/workspace-navigation.tsx`, `app/page-header.tsx`, and `app/forms.tsx`. See [design audit](DESIGN_AUDIT.md) for the baseline.

Use warm canvas, white operational surfaces, deep green interactive emphasis, restrained elevation, and compact sans-serif headings. Reserve semantic colors for actions and status, with a text equivalent. Body typography uses system fonts with a Kannada fallback. Kannada localization and glyph coverage still need device validation. Keep numbers tabular when comparing report metrics and use locale-aware time in institutional contexts.

The shared shell, scoped navigation, breadcrumb/page header, and existing action form are available now. Existing panel, button, tag, and table styles use shared tokens. Extract card, data table, metrics, state feedback, and confirmation components when migrating their consumers. Use native form controls and established accessible dialog and tabs primitives when an actual interaction needs them. Command search, notifications, charts, and map panels require working consumers and data contracts first.
