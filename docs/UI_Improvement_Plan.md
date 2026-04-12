# UI Improvement Plan — UltraTrader 2026

## Purpose
Create a prioritized, actionable UI plan that maps the PRD requirements to concrete UI changes, owners (agents), and acceptance criteria. This plan is designed so the five agents scaffolded in `prompts/` collaborate to finish the work.

## Quick findings from code review
- `ModeIndicator` (frontend/src/components/ModeIndicator.tsx) exists and already highlights modes, but needs standardization, accessible markup, and consistent placement.
- `KillSwitch` (frontend/src/components/KillSwitch.tsx) is present and visible, but is a single-button toggle with ephemeral confirmation — PRD requires global + scoped kill switches, audit reasons, and approved resume flows.
- `Layout` places ModeIndicator and KillSwitch in header; navigation and pages are present and well-structured.
- Strategy creation UI is feature-rich (`StrategyCreator`, `ConditionBuilder`) but would benefit from improved UX for complex N-of-M logic, versioning, and JSON/YAML previews.

## High-level goals (from PRD -> UI)
- Make mode state obvious (Backtest/Paper/Live) across all screens and exportable to screenshots/logs.
- Implement safety-first confirmation patterns and explicit audit capture for promotions and kill/flatten actions.
- Rework Strategy Studio UX for N-of-M logic, staging, cooldowns, and structure-aware stop/target configuration.
- Provide backtest, run, and deployment visualizations (equity, drawdown, heatmaps) with explainable trade reasons.
- Build a component library + design tokens, Storybook, and automated accessibility/test suites.

## Proposed UI improvements (prioritized)
1. Safety & Mode UX (P0)
   - Persistent, accessible `ModeIndicator` with tooltip and link to active mode details.
   - Global and scoped kill controls UI: reason input, scope picker (global/account/deployment/strategy), countdown/undo window for non-destructive actions, and required approver flow for live promotions.
   - High-contrast live banners and sticky confirmation dialogs for destructive actions.
2. Strategy Studio polish (P0/P1)
   - Clear N-of-M builder UI (explicit selector for N and list size M), JSON/YAML preview pane, version history and publish workflow.
   - Inline explainers for structure-aware stop placement (swing high/low, FVG bounds) and draggable visual stop markers in chart previews.
3. Backtest & Monitor visualizations (P1)
   - Story-driven trade replay with entry/exit reason callouts, equity and drawdown overlays, and compare mode between strategies.
4. Component library & tokens (P0)
   - Centralized tokens (color, spacing, type), Storybook, and conventions for safety components (banners, dialogs, confirm flows).
5. Accessibility & QA (P0)
   - WCAG-based a11y checks, keyboard-first flows for critical actions, and CI tests (axe, Playwright). 

## Agent responsibilities (owners)
- `UIUX` (UI/UX Designer): wireframes, tokens, acceptance criteria, accessible copy, and visual QA checklist.
- `FrontendDeveloper`: build components, Storybook stories, implement ModeIndicator and KillSwitch enhancements, and integrate with stores/APIs.
- `Accessibility`: run scans, triage violations, provide fixes and automated tests.
- `SafetyOps`: author safety flows, confirmation copy, gating logic, and audit event hooks mapping to backend endpoints.
- `QA`: author deterministic E2E and component tests mapped to PRD acceptance criteria.

## Subagents used for automation
- `DesignSpec`: generate tokens and component specs from UIUX prompts.
- `StorybookBuilder`: scaffold stories for review.
- `A11yScanner`: run automated A11y scans and prioritize fixes.
- `TestRunner`: run test suites and gather artifacts.
- `DeployPreview`: create preview instructions and artifacts for stakeholder review.

## Acceptance criteria (short)
- Mode is always visible and machine-readable; Live has unmistakable visual affordance.
- Kill/flatten actions require explicit scope and reason, are logged, and enforce approval rules for live promotions.
- Strategy editor supports N-of-M logic, shows JSON/YAML preview, and preserves version history for promotes.
- Backtest labs show explainable trade logs with reason tags and replay controls.
- All safety-critical UI passes accessibility and automated E2E tests.

## Next steps (short-term)
1. `UIUX` to produce wireframes for header, kill UI, and strategy N-of-M widget. (2 days)
2. `FrontendDeveloper` to implement component tokens, ModeIndicator improvements, and enhanced KillSwitch prototype. (3 days)
3. `A11yScanner` + `Accessibility` to run scans on the prototype; `QA` to add E2E tests for kill/promotion flows. (2 days)
4. Iterate until PRD acceptance criteria above are met; use `DeployPreview` for stakeholder validation.

---

Files referenced during review:
- [frontend/src/components/ModeIndicator.tsx](frontend/src/components/ModeIndicator.tsx#L1)
- [frontend/src/components/KillSwitch.tsx](frontend/src/components/KillSwitch.tsx#L1)
- [frontend/src/components/Layout.tsx](frontend/src/components/Layout.tsx#L1)
- [frontend/src/pages/StrategyCreator.tsx](frontend/src/pages/StrategyCreator.tsx#L1)
- PRD: [docs/PRD.md](docs/PRD.md#L1)

If you want, I can start by implementing the P0 prototype: scoped KillSwitch UI with reason input and enhanced ModeIndicator (small PR). Which should I do first?