# UltraTrader UI Wireframe Spec + React Component Map

**Timestamp (ET):** 2026-04-22 11:02:07 AM ET

## Product flow


Left-to-right platform flow:

**Build → Assemble → Validate → Deploy → Govern → System**

Design principles:

* Above the fold should answer one question only.
* Every page must have a primary action.
* Progressive disclosure beats dense configuration.
* Use cards for composition, tables for history, drawers for detail, and sticky summary rails for validation.
* Keep trading language intuitive and consistent.

---

# 1. Global App Shell

## Layout

### Left navigation

Grouped nav:

* **Build**

  * Strategies
  * Strategy Controls
  * Risk Profiles
  * Execution Styles
  * Watchlists
* **Assemble**

  * Programs
* **Validate**

  * Sim Lab
  * Backtests
  * Optimization
* **Deploy**

  * Deployments
  * Portfolio Control
* **System**

  * Broker Accounts
  * Run History
  * Logs / Events
  * Backup / Restore

### Top bar

* Current workspace / environment badge
* Broker account context selector
* Global search
* Notifications / alerts
* Quick actions menu
* Status indicators:

  * Backend connected
  * Broker connected
  * Data stream live / stale

### Right utility rail or drawer

Reusable drawer for:

* help
* validation
* diff view
* event details
* replay details

---

# 2. Wireframe Spec by Page

## BUILD

## A. Strategies

### User goal

Capture a trading idea quickly, then refine it.

### Above the fold

* Page title: **Strategies**
* Subtext: “Define signal logic for entries, exits, stops, and targets.”
* Primary input card:

  * Strategy name
  * Natural language strategy prompt textarea
  * CTA buttons:

    * **Generate with AI**
    * **Build Manually**
* Lightweight status strip:

  * Entry rules: complete / incomplete
  * Exit rules: complete / incomplete
  * Stop: optional / complete
  * Target: optional / complete

### Main body

Two-column layout.

#### Left column

Accordion sections:

1. Entry Conditions
2. Exit Conditions
3. Stop Candidate
4. Target Candidate
5. Advanced Logic

Each condition row includes:

* left operand
* operator
* right operand
* add AND / OR group
* duplicate row
* delete row

#### Right column

Sticky preview panel:

* Strategy summary
* Human-readable interpretation
* JSON preview toggle
* Validation issues
* “Save Draft” / “Create New Version” actions

### Footer actions

* Save Draft
* Validate Strategy
* Send to Program Builder

### Interaction notes

* AI-generated strategies should land directly into the same structured form.
* Avoid showing watchlists, risk, or execution here.

---

## B. Strategy Controls

### User goal

Define when and how often a strategy is allowed to act.

### Above the fold

* Page title: **Strategy Controls**
* Template selector chips:

  * Intraday
  * Swing
  * Position
* Primary CTA: **Create Controls**

### Main body

Single form with sections.

#### Section 1: Timeframe & Mode

* Timeframe dropdown
* Trading style label
* Timezone selector

#### Section 2: Session Windows

* Add session window rows

  * start time
  * end time
* Skip first N minutes toggle
* Force flat by time toggle

#### Section 3: Frequency Limits

* Max trades per session
* Max trades per day
* Min minutes between entries
* Cooldown after stopout

#### Section 4: Regime Filters (collapsed by default)

* Allowed regimes checklist
* Trade only when market trend filter passes

#### Section 5: Advanced Gates (collapsed)

* Earnings blackout toggle
* Weekend hold toggle

### Right rail

* Plain-English summary
* Compatibility hints:

  * good for day trading
  * good for swing
* Linked strategies count

### Footer actions

* Save Controls
* Duplicate Template

---

## C. Risk Profiles

### User goal

Define reusable risk and sizing rules.

### Above the fold

* Page title: **Risk Profiles**
* Grid of profile cards
* Prominent golden templates row
* CTA: **New Risk Profile**

### Card view

Each profile card shows:

* name
* style badge
* risk per trade
* max positions
* daily loss limit
* drawdown lockout
* leverage
* actions: view, duplicate, edit

### Detail/edit view

Sections:

1. Position Sizing

   * risk % per trade
   * fixed dollar risk
   * ATR fallback stop
2. Exposure Limits

   * max long positions
   * max short positions
   * max total positions
   * max position concentration
3. Loss Controls

   * daily loss limit
   * weekly loss limit
   * drawdown lockout
4. Leverage & Special Rules

   * max leverage
   * pyramiding allowed
   * max adds per position

### Right rail

* Sizing example calculator
* “At $100k account and 1% risk, max loss/trade = $1,000”
* policy summary

---

## D. Execution Styles

### User goal

Control how orders are expressed to the broker and modeled in backtests.

### Above the fold

* Page title: **Execution Styles**
* Template cards:

  * Market + Bracket
  * Limit Pullback
  * Stop-Limit Breakout
  * Trailing Exit
* CTA: **New Execution Style**

### Main body

Sections:

1. Entry Orders

   * market / limit / stop / stop-limit
   * time in force
   * offset mode/value
   * cancel after N bars
2. Exit Mechanics

   * bracket mode
   * stop order type
   * take profit order type
   * trailing stop config
3. Scale Out

   * partial exit rows
4. Backtest Assumptions

   * fill model
   * slippage
   * commission

### Right rail

* Broker behavior preview
* Backtest behavior preview
* Warnings if settings are inconsistent

---

## E. Watchlists

### User goal

Define the symbol universe.

### Above the fold

* Page title: **Watchlists**
* Search bar
* Filter chips: golden, momentum, ETFs, volatile, custom
* CTA: **New Watchlist**

### Main view

Card or table toggle.

#### Card mode

* name
* tag chips
* symbol count
* sample symbols
* used by N programs
* duplicate / edit / delete

#### Detail/edit view

* symbol entry input
* paste bulk symbols
* validate ticker list
* tag selector
* notes

### Right rail

* related programs
* usage warnings if in use

---

## ASSEMBLE

## F. Programs

### User goal

Create a deployable trading package.

### Above the fold

* Page title: **Programs**
* One-line explanation: “Combine a strategy, controls, risk profile, execution style, and watchlist into a deployable unit.”
* CTA: **Create Program**
* Optional 5-step mini progress bar:

  1. Strategy
  2. Controls
  3. Risk
  4. Execution
  5. Watchlist

### Main body

Program builder with five composition cards.

#### Composition cards

1. Strategy
2. Strategy Controls
3. Risk Profile
4. Execution Style
5. Watchlists

Each card shows:

* selected item name
* compact summary
* swap button
* create new button
* missing / complete status

### Secondary sections

* Program name
* Description
* Mode badge: day / swing / position
* Watchlist combination rule: union / intersection
* Program notes

### Right rail

Sticky **Program Readiness Panel**:

* all required pieces attached?
* warnings
* expected behavior summary
* buttons:

  * Run in Sim Lab
  * Launch Backtest
  * Freeze Program

### Footer actions

* Save Program
* Validate Program
* Freeze Program

---

## VALIDATE

## G. Sim Lab

### User goal

Visually confirm that a strategy/program behaves the way the trader expects.

### Above the fold

* Source selector:

  * Strategy
  * Program
* Symbol selector
* Date range selector
* Timeframe selector
* CTA: **Run Simulation**

### Main body

Large chart-first layout.

#### Center

* Candlestick chart
* indicator overlays
* trade markers
* order markers
* stop/target lines

#### Left control panel

* simulation settings
* playback controls
* speed
* bar stepping

#### Right analysis panel

Tabs:

* Decisions
* Conditions
* Orders
* Notes

The Decisions tab should show:

* why entry happened
* why exit happened
* what rule fired

### Footer

* Save snapshot
* Open as Backtest
* Create Program from this config

---

## H. Backtests

### User goal

Run a full validation of a program over time.

### Above the fold

* Backtest source selector: Program or Strategy Version
* symbol / watchlist source
* timeframe
* date range
* starting capital
* CTA: **Run Backtest**

### Main body after run

#### KPI strip

* net PnL
* CAGR
* max drawdown
* win rate
* profit factor
* Sharpe
* trade count

#### Tabbed result area

1. Overview
2. Equity Curve
3. Trade Log
4. Regime Analysis
5. Diagnostics
6. Walk-Forward

### Right rail

* run metadata
* linked program
* export actions
* compare with prior run

### Important UX rule

Do not overload initial launch form. Show advanced settings collapsed.

---

## I. Optimization

### User goal

Tune parameters and understand robustness.

### Above the fold

* Strategy or Program selector
* date range
* objective metric
* CTA: **Run Optimization**

### Main body

#### Left parameter panel

* parameter path input
* value grid entry
* max combinations
* walk-forward toggle

#### Center results panel

Tabs:

* Ranked Results
* Walk-Forward Analysis
* Parameter Sensitivity
* Paper-to-Live Readiness

#### Right rail

* best candidate summary
* caution flags for overfitting
* recommended next step

---

## DEPLOY

## J. Deployments

### User goal

Activate a frozen program on a broker account.

### Above the fold

* Program selector (frozen only)
* Broker account selector
* deployment mode: paper / live
* capital allocation input
* CTA: **Create Deployment**

### Main body

Two-column layout.

#### Left

Deployment form:

* program
* broker account
* mode
* allocation
* optional overrides within allowed bounds

#### Right

Pre-flight checklist:

* frozen program confirmed
* portfolio governor active
* account buying power sufficient
* no conflicting active deployment
* risk profile present

### Below

Active deployments table:

* deployment name
* program
* account
* mode
* status
* last heartbeat
* actions: pause, resume, view

---

## K. Portfolio Governor

### User goal

Govern all active programs on a broker account.

### Above the fold

* Page title: **Portfolio Governor**
* Broker account context selector
* Big status pill:

  * active
  * halted
  * degraded
* Primary emergency action:

  * **Halt All**

### Main body

#### Section 1: Exposure Summary

* gross exposure
* net exposure
* long exposure
* short exposure
* concentration by symbol
* concentration by sector

#### Section 2: Active Programs

Table:

* program
* deployment
* allocation
* status
* current exposure
* last signal
* actions

#### Section 3: Conflict Resolution Queue

List of blocked or arbitrated intents:

* timestamp
* symbol
* incoming intent
* existing state
* decision
* reason

#### Section 4: Portfolio Events

Event stream:

* halted
* resumed
* trade blocked
* trade approved
* exposure warning
* drawdown lock

### Right rail

* kill-switch notes
* current portfolio rules
* add program hot-add action

### UX rule

This page is for **control authority**, not performance analytics.

---

## SYSTEM

## L. Broker Accounts

### User goal

Manage real broker connections and broker state.

### Main body

Card/table hybrid:

* account nickname
* provider badge: Alpaca
* mode: paper/live
* connection status
* buying power
* equity
* last sync
* actions: connect, refresh, disable

### Detail drawer

* Alpaca identifiers
* balances
* restrictions
* PDT state
* permissions
* sync logs

---

## M. Run History

### User goal

Find and reopen prior validations quickly.

### Main body

Table with filters:

* date
* run type
* source
* symbols
* timeframe
* result summary
* actions: open, compare, duplicate settings

### Top filters

* run type
* strategy/program
* status
* date range

---

## N. Logs / Events

### User goal

See what happened across the platform and why.

### Main body

Unified event stream with filterable table.
Columns:

* timestamp
* category
* severity
* component
* symbol
* message
* trace link

Filters:

* source component
* severity
* account
* program
* symbol
* event type

Detail drawer:

* raw payload
* interpreted explanation
* linked deployment / program / order

---

## O. Backup / Restore

### User goal

Protect platform state and recover safely.

### Main body

Two panels.

#### Backup panel

* latest backup timestamp
* download backup button
* auto-backup status

#### Restore panel

* upload backup file
* validation status
* restore warning
* confirm restore action

### Right rail

* what is included in backup
* what happens on restore
* last restore event

---

# 3. Cross-Page UI Patterns

## A. Cards

Use for reusable building blocks:

* risk profiles
* execution styles
* watchlists
* program composition slots

## B. Tables

Use for:

* deployments
* runs
* logs
* active programs
* blocked intents

## C. Drawers

Use for:

* detail inspection
* diff view
* event details
* replay panels
* help panels

## D. Sticky right rails

Use when user needs persistent validation, summary, or context.

## E. Empty states

Every page should say:

* what this page is for
* what to do first
* what happens next

## F. Primary action rule

One page, one dominant CTA.

---

# 4. React Component Map

## Core Layout Components

* `AppShell`
* `SidebarNav`
* `TopBar`
* `StatusIndicators`
* `GlobalSearch`
* `ContextDrawer`
* `PageHeader`
* `StickySummaryRail`
* `EmptyStatePanel`

## Shared Form Components

* `EntityCard`
* `SelectionCard`
* `TemplateCardGrid`
* `FormSection`
* `InlineField`
* `TimeWindowEditor`
* `ConditionRow`
* `ConditionGroupBuilder`
* `SymbolInputTable`
* `ValidationChecklist`
* `JsonPreviewPanel`
* `PlainEnglishSummary`

## Strategies Page

* `StrategyPromptCard`
* `StrategyBuilderLayout`
* `EntryConditionsSection`
* `ExitConditionsSection`
* `StopCandidateSection`
* `TargetCandidateSection`
* `AdvancedLogicSection`
* `StrategyPreviewRail`
* `StrategyValidationStrip`

## Strategy Controls Page

* `StrategyControlsForm`
* `TimeframeModeSection`
* `SessionWindowsSection`
* `FrequencyLimitsSection`
* `CooldownRulesSection`
* `RegimeFilterSection`
* `ControlsSummaryRail`

## Risk Profiles Page

* `RiskProfileGrid`
* `RiskProfileCard`
* `RiskProfileEditor`
* `SizingSection`
* `ExposureLimitsSection`
* `LossControlsSection`
* `RiskExampleCalculator`

## Execution Styles Page

* `ExecutionStyleGrid`
* `ExecutionStyleCard`
* `ExecutionStyleEditor`
* `EntryOrderSection`
* `ExitMechanicsSection`
* `ScaleOutSection`
* `BacktestAssumptionsSection`
* `ExecutionPreviewRail`

## Watchlists Page

* `WatchlistGrid`
* `WatchlistCard`
* `WatchlistEditor`
* `TickerPasteBox`
* `SymbolValidationList`
* `TagFilterBar`
* `WatchlistUsageRail`

## Programs Page

* `ProgramBuilder`
* `ProgramIdentitySection`
* `ProgramCompositionGrid`
* `ProgramSlotCard`
* `WatchlistCombinationSelector`
* `ProgramReadinessRail`
* `FreezeProgramDialog`

## Sim Lab Page

* `SimulationToolbar`
* `SourceSelector`
* `SimulationChart`
* `PlaybackControls`
* `DecisionTracePanel`
* `ConditionTruthTable`
* `OrderTracePanel`
* `SimulationNotesPanel`

## Backtests Page

* `BacktestLaunchForm`
* `BacktestMetricStrip`
* `EquityCurvePanel`
* `TradeLogTable`
* `RegimeAnalysisTable`
* `DiagnosticsCard`
* `WalkForwardPanel`
* `RunMetadataRail`

## Optimization Page

* `OptimizationLaunchForm`
* `ParameterGridEditor`
* `OptimizationResultsTable`
* `WalkForwardResultsPanel`
* `SensitivityHeatmapPanel`
* `ReadinessAssessmentCard`
* `OptimizationSummaryRail`

## Deployments Page

* `DeploymentCreateForm`
* `PreflightChecklist`
* `ActiveDeploymentsTable`
* `DeploymentStatusBadge`
* `DeploymentOverridePanel`

## Portfolio Control Page

* `PortfolioStatusHeader`
* `HaltAllButton`
* `ExposureSummaryCards`
* `ActiveProgramsTable`
* `ConflictResolutionQueue`
* `PortfolioEventsFeed`
* `AddProgramModal`
* `PortfolioRulesRail`

## Broker Accounts Page

* `BrokerAccountGrid`
* `BrokerAccountCard`
* `BrokerConnectionForm`
* `BrokerSyncDrawer`
* `BuyingPowerPanel`
* `RestrictionSummary`

## Run History Page

* `RunHistoryFilters`
* `RunHistoryTable`
* `RunComparisonDrawer`
* `DuplicateRunConfigAction`

## Logs / Events Page

* `EventFilterBar`
* `EventsTable`
* `EventDetailDrawer`
* `PayloadViewer`
* `RelatedObjectsPanel`

## Backup / Restore Page

* `BackupPanel`
* `RestorePanel`
* `RestoreValidationBanner`
* `DangerConfirmDialog`
* `BackupHistoryList`

---

# 5. Recommended Routing and Feature Ownership

## Routes

* `/strategies`
* `/strategy-controls`
* `/risk-profiles`
* `/execution-styles`
* `/watchlists`
* `/programs`
* `/sim-lab`
* `/backtests`
* `/optimization`
* `/deployments`
* `/portfolio-control`
* `/broker-accounts`
* `/run-history`
* `/events`
* `/backup`

## Suggested frontend folder map

* `src/pages/*`
* `src/components/layout/*`
* `src/components/shared/*`
* `src/components/strategies/*`
* `src/components/strategy-controls/*`
* `src/components/risk/*`
* `src/components/execution/*`
* `src/components/watchlists/*`
* `src/components/programs/*`
* `src/components/simlab/*`
* `src/components/backtests/*`
* `src/components/optimization/*`
* `src/components/deployments/*`
* `src/components/portfolio/*`
* `src/components/system/*`

---

# 6. Implementation Order

## Highest-value order

1. Strategies above-the-fold simplification
2. Program Builder card composition
3. Portfolio Control page cleanup
4. Deployments preflight UX
5. Backtest result tabs refinement
6. Sim Lab decision trace panel
7. Logs / Events unification
8. Broker Accounts detail drawer

---

# 7. Final UX rules

* Strategy pages should feel like idea capture, not engineering configuration.
* Program pages should feel like assembly, not JSON editing.
* Validation pages should feel evidence-driven.
* Deployment pages should feel controlled and serious.
* Portfolio Control should feel like an authority console.
* System pages should feel operational, not front-and-center.

This language and structure should make the app feel intuitive for a serious trader while preserving clean internal architecture.
