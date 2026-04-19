# Mobile UX Implementation Plan (Site Manager MVP)

Date: April 16, 2026  
Scope: Implement the recommendations from `MOBILE_UX_REVIEW.md` in a staged, testable rollout.

## Goals
1. Reduce accidental pin placement during mobile scrolling.
2. Improve touch reliability for pin selection and key actions.
3. Reduce time and scroll effort for common field workflows.
4. Add safeguards for destructive actions.
5. Keep performance acceptable for long PDFs.

---

## Milestone 1 — Safety + Core Touch UX (Highest Priority)

### 1.1 Add explicit Pin Mode
**Changes**
- Add state: `isPinMode` (default `false`).
- Add UI toggle visible in viewer header and mobile action bar.
- Gate `onAddPin` behavior: only place pins when `isPinMode === true`.
- Update helper copy from “Tap anywhere…” to context-aware instructions.

**Files likely touched**
- `src/app/page.tsx`
- `src/app/page.module.css`

**Acceptance criteria**
- Tapping PDF while Pin Mode is OFF never creates a pin.
- Tapping PDF while Pin Mode is ON creates a pin with current behavior.
- User can clearly tell current mode at all times.

### 1.2 Increase tap targets to 44x44 on mobile
**Changes**
- Keep current visual pin style but increase interactive area (button dimensions or pseudo element + padding pattern).
- Ensure list/action buttons meet mobile minimum hit area.

**Files likely touched**
- `src/app/page.module.css`

**Acceptance criteria**
- Pin target area is >=44x44 CSS pixels at <=640px widths.
- No overlap/collision regressions that block selecting nearby pins.

### 1.3 Add destructive action safeguards
**Changes**
- Add confirm dialog or undo toast for:
  - `Clear saved project`
  - `Delete pin`
  - `Remove photo`
- Prefer non-blocking undo toast for pin/photo removal.

**Files likely touched**
- `src/app/page.tsx`
- Optional helper component file if extracted.

**Acceptance criteria**
- User has recovery path before data is permanently lost.
- Works on mobile and desktop.

---

## Milestone 2 — Mobile Workflow Speed

### 2.1 Add sticky mobile action bar
**Changes**
- Add bottom-fixed action bar at mobile breakpoints with primary actions:
  - Upload/Replace PDF
  - Enter/Exit Pin Mode
  - Add photo (enabled only when pin selected)
- Add safe-area support (`env(safe-area-inset-bottom)`).

**Files likely touched**
- `src/app/page.tsx`
- `src/app/page.module.css`

**Acceptance criteria**
- Core actions remain reachable without long scroll.
- Bar does not hide important content (use bottom padding in main layout).

### 2.2 Collapse secondary panels on mobile
**Changes**
- Convert Project/Pins/Selected Pin sections to collapsible accordions under 980px or 640px.
- Default open state:
  - Selected Pin open when a pin is selected.
  - Others collapsed by default after PDF load.

**Files likely touched**
- `src/app/page.tsx`
- `src/app/page.module.css`

**Acceptance criteria**
- Viewer becomes the primary visible area after upload.
- Users can still access all controls with <=2 taps.

---

## Milestone 3 — Navigation + Performance for Long PDFs

### 3.1 Page jump controls
**Changes**
- Add page navigator (Prev / page input or select / Next).
- Add quick “Jump to selected pin page” action.

**Files likely touched**
- `src/app/page.tsx`
- `src/app/page.module.css`

**Acceptance criteria**
- Users can reach arbitrary page in <=3 interactions.
- Navigator state syncs with currently viewed page.

### 3.2 Incremental rendering / virtualization
**Changes**
- Render current + adjacent pages first.
- Use `IntersectionObserver` to defer offscreen page rendering.
- Add loading placeholders for deferred pages.

**Files likely touched**
- `src/app/page.tsx` (or extracted viewer component)

**Acceptance criteria**
- Initial render faster on large documents.
- Scrolling remains smooth on mid-range mobile devices.

---

## Technical Design Notes
- Keep pin coordinate model unchanged (`x`/`y` percentages) to preserve stored data compatibility.
- Avoid breaking localStorage schema unless required; if changed, bump key version with migration.
- Prefer small component extraction for readability:
  - `MobileActionBar`
  - `ConfirmOrUndo`
  - `PageNavigator`

---

## QA Plan

### Manual checks
1. Upload PDF on iPhone/Android viewport and place/select/delete pins.
2. Verify accidental pin prevention while scrolling with Pin Mode off.
3. Verify sticky action bar accessibility during deep scroll.
4. Verify undo/confirm flows for all destructive actions.
5. Verify behavior on 1-page and 50+ page PDFs.

### Accessibility checks
- Keyboard focus order remains logical.
- Buttons/toggles have clear `aria-label`/pressed states.
- Touch targets meet size guidelines.

### Regression checks
- Existing localStorage project still loads.
- Pins stay aligned after orientation change.
- Photo upload/remove behavior unchanged aside from safeguards.

---

## Rollout Strategy
1. Ship Milestone 1 behind a temporary feature flag (`mobileUxPhase1`) for quick rollback.
2. Validate with a small internal pilot (field users).
3. Ship Milestone 2 after 1 week of no critical issues.
4. Ship Milestone 3 last due to higher complexity/performance risk.

---

## Suggested Task Breakdown (Engineer-facing)
- [ ] Implement Pin Mode state + toggle + gated add-pin behavior.
- [ ] Increase mobile hit targets and validate pin collision behavior.
- [ ] Add confirm/undo for clear/delete/remove.
- [ ] Build sticky mobile action bar and safe-area spacing.
- [ ] Convert sidebar panels to mobile accordions.
- [ ] Add page navigation controls.
- [ ] Add deferred page rendering strategy.
- [ ] Run manual mobile QA checklist and capture results.
