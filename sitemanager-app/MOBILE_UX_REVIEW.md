# Mobile UX Review (April 16, 2026)

## Scope
This review is based on the current implementation in `src/app/page.tsx` and `src/app/page.module.css`, focusing on touch usability, layout behavior at mobile breakpoints, and mobile-first workflows for field users.

## What Works Well Already
- The layout collapses from two columns to one at `max-width: 980px`, which avoids cramped side-by-side panels on phones.
- Controls use rounded, high-contrast buttons and most primary actions are clearly labeled.
- PDF pins are stored as relative coordinates (`x`, `y` percentages), which helps pin placement remain stable across device sizes.
- File upload actions are available near the top of the page.

## Key Mobile UX Issues

### 1) Pin placement competes with normal scrolling
**Problem:** The entire PDF page surface is a click target that creates a pin on tap. On touch devices, users may accidentally drop pins while trying to scroll the page.

**Impact:** High accidental action rate and frustration, especially for long PDFs.

**Recommendation:**
- Add an explicit **"Pin mode"** toggle (off by default).
- Only allow tap-to-drop when Pin mode is on.
- Show a small sticky status chip: `Pin mode: On`.

### 2) Pin hit target is too small on mobile
**Problem:** Pin markers shrink to `28x28px` on small screens.

**Impact:** Missed taps and poor accessibility for gloved use / outdoor field use.

**Recommendation:**
- Increase mobile touch target to at least **44x44px** (Apple/Google guidance).
- Keep visual pin icon small if desired, but add larger invisible hit area.

### 3) Important actions are not sticky in long-scroll contexts
**Problem:** Users must scroll to reach upload/add-photo actions after navigating deep page content.

**Impact:** Slower workflows and repeated long scrolling.

**Recommendation:**
- Introduce a bottom sticky action bar on mobile:
  - `Upload/Replace PDF`
  - `Add Pin` / `Exit Pin Mode`
  - `Add Photo` (enabled when pin selected)

### 4) Page-level navigation is inefficient for multi-page PDFs
**Problem:** All pages are rendered in a vertical stack and users scroll linearly.

**Impact:** Hard to jump quickly to page 20+ and back.

**Recommendation:**
- Add mobile page jump controls (dropdown or stepper: Prev / Page X / Next).
- Optional: lazy render only nearby pages to reduce memory pressure.

### 5) Content hierarchy overload on small screens
**Problem:** Hero content + multiple full panels consume significant vertical space before viewer interaction.

**Impact:** Delays core task (marking drawings).

**Recommendation:**
- Collapse non-critical sections by default on mobile (Project summary, Pins list, Selected pin details).
- Prioritize the PDF viewer at top after file upload.

### 6) Limited feedback for destructive actions
**Problem:** `Delete pin`, `Remove photo`, and `Clear saved project` are immediate.

**Impact:** High risk of accidental data loss on touch.

**Recommendation:**
- Add undo toast (preferred) or confirmation dialog for destructive actions.
- For clear project, require explicit confirmation.

### 7) Upload control discoverability
**Problem:** File input is hidden inside labels; this works technically, but may not be obvious to all users.

**Impact:** Some users may not realize actions open file picker, especially in bright outdoor conditions.

**Recommendation:**
- Add iconography + helper text (`Opens file picker`).
- Use consistent button width and placement for action predictability.

### 8) Metadata readability and truncation
**Problem:** Filename and metadata can truncate heavily in tight mobile widths.

**Impact:** Harder to verify selected file/photo context.

**Recommendation:**
- Add expandable metadata rows or tap-to-view-full-name modal.
- Show short, meaningful summaries first (e.g., `3 pins · 12 photos`).

## Prioritized Improvement Roadmap

### Phase 1 (Highest ROI, low effort)
1. Add Pin mode toggle + accidental tap prevention.
2. Increase pin hit targets to 44x44 on mobile.
3. Add confirmation/undo for destructive actions.

### Phase 2 (Medium effort)
1. Add mobile sticky action bar.
2. Collapse secondary panels on mobile, prioritize viewer.

### Phase 3 (Higher effort, performance + scalability)
1. Add page jump navigation.
2. Add lazy page rendering/virtualization for long PDFs.

## Suggested Mobile Usability Success Metrics
- **Accidental pin rate** (pins created then deleted within 5 seconds).
- **Time-to-first-pin** after upload.
- **Task completion time** for “add pin + attach photo” flow.
- **Undo/confirmation usage** on destructive actions.
- **Scroll distance per session** (should decrease with sticky actions/navigation).

## Quick Wins Checklist
- [ ] Pin mode toggle implemented
- [ ] 44x44 touch targets for pins and key controls
- [ ] Destructive action undo/confirm
- [ ] Sticky primary actions on mobile
- [ ] Page jump control for long PDFs
