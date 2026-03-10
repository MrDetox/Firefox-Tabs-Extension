# UI improvement plan

## 1. Naming and branding consistency

**Issue:** Extension name in [manifest.json](manifest.json) is **"Better Tab Groups"** but the popup header in [popup.html](popup.html) says **"Tab Group Deduper"**. The extension now does more than deduplication (merge groups, auto-group rules, quick group, duplicate tabs).

**Change:**
- Set the popup header title to **"Better Tab Groups"** so it matches the manifest and toolbar tooltip.
- Optionally add a short subtitle under the header, e.g. *"Merge groups, prevent duplicate tabs, quick group"*, to clarify scope at a glance (can be removed later if it feels noisy).

---

## 2. Replace inline styles with CSS classes

**Issue:** Several elements use `style="..."` in [popup.html](popup.html), which is harder to maintain and inconsistent with the rest of the stylesheet.

| Location | Current inline style | Proposed class / change |
|----------|----------------------|---------------------------|
| Button rows (lines 495–497, 554–556) | `display: flex; gap: 8px` and `flex: 1` on buttons | Add `.form-actions { display: flex; gap: 8px; }` and `.form-actions .add-rule-btn { flex: 1; }` (or reuse for both rows). |
| Duplicate tabs form wrapper (line 534) | `margin-top: 12px` | Use existing spacing pattern or add `.add-rule-form.with-top-margin { margin-top: 12px; }`. |
| Match type `<select>` (line 547) | `width: 100%; padding: 8px 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 12px` | Add `.form-field select` in the same block as `.form-field input` so all form controls share size, border, radius, and font. |

**Files:** [popup.html](popup.html) (remove inline `style`, add/use classes).

---

## 3. Form control consistency (select styling)

**Issue:** The deduplication "Match type" `<select>` is styled inline; other inputs use `.form-field input` and look consistent.

**Change:**
- In the `<style>` block, add rules for `.form-field select` (and optionally `select` inside `.form-field`) so padding, border, border-radius, font-size, and width match `.form-field input`.
- Remove inline styles from `#deduplicationMatchType` and rely on `class` (e.g. keep it inside the existing `.form-field`).

---

## 4. Section order and default open state

**Issue:** All sections are equal visually; the popup can feel long. Users may care more about one area (e.g. Duplicate tabs or Merge groups) depending on usage.

**Options (pick one or combine):**
- **Reorder sections** by perceived frequency of use, e.g.: Merge duplicate groups → Duplicate tabs → Auto-Group Rules → Quick Group → Feedback. (Duplicate tabs and Merge groups first so core behavior is visible without scrolling.)
- **Default open/closed:** Keep 1–2 sections open by default (e.g. Merge duplicate groups + Duplicate tabs), leave the rest closed so the popup is shorter on first open.
- **Persist open/closed state:** Store which sections are open in `storage.local` and restore on next open (requires a small change in [popup.js](popup.js) and section headers).

Recommendation: at least reorder so "Duplicate tabs" and "Merge duplicate groups" are the first two sections; optionally persist open state in a follow-up.

---

## 5. Accessibility (a11y)

**Improvements:**
- **Section headers:** Add `role="button"` and `aria-expanded="true"` / `"false"` on the section header so collapse/expand is announced. Toggle the attribute when opening/closing in [popup.js](popup.js).
- **Toggle switches:** Ensure the `<input type="checkbox">` has an associated label (already wrapped in `<label>`) and that the visible label text is not only in a sibling `<div>`; optionally add `aria-label` on the input if the visible text is not programmatically associated.
- **Badges:** Add `aria-label` on section badges, e.g. `aria-label="3 rules"` so screen readers get context.
- **Focus:** Ensure focus outline is visible on buttons and inputs (already have `:focus` on `.form-field input`; add similar for `.add-rule-btn` and toggles if needed).

**Files:** [popup.html](popup.html) (markup), [popup.js](popup.js) (aria-expanded and any dynamic aria-labels).

---

## 6. Visual hierarchy in "Duplicate tabs" section

**Current:** Global toggle, then subheading "Rules for specific URLs or domains", then form and list.

**Optional improvement:** Add a light divider between the global toggle and the rules subsection (e.g. a thin `border-top` on `.add-rule-form` when it follows the toggle, or a dedicated `.subsection-divider`). Keeps the hierarchy clear without adding much visual weight.

---

## 7. Empty states and status messages

**Current:** `.empty-state` and `.status` toasts exist.

**Improvements:**
- Use the same empty-state pattern everywhere (e.g. "No rules yet. Add one above!" vs "No deduplication rules yet...") so wording is consistent.
- Ensure status toasts are not covered by the fixed header/footer (already at bottom; confirm z-index and padding so they are fully visible when body has bottom margin).

---

## 8. Optional: sticky header

**Issue:** Popup is 475px wide and up to 1000px max-height with many sections; when scrolled, the title disappears.

**Option:** Make the header `position: sticky; top: 0; z-index: 50` so "Better Tab Groups" (or current title) stays visible while scrolling. Slight shadow when scrolled can reinforce the effect. Low priority if popup is usually used with few sections open.

---

## 9. Optional: icon consistency

**Current:** Section icons are emoji (🔀, 📋, 📁, 🔗, 💬). They are consistent and readable.

**Option:** Replace with small inline SVGs or icon font for a more polished look and better control over size/color; add `aria-hidden="true"` so screen readers skip them. Only worth it if you want a more "product" look; emoji are fine for clarity.

---

## Implementation order (suggested)

1. **Quick wins:** Naming (header = "Better Tab Groups"), replace inline styles with classes, unify select styling.  
2. **Structure:** Reorder sections; set 1–2 sections open by default.  
3. **Accessibility:** aria-expanded, aria-labels on badges, focus styles.  
4. **Polish:** Divider in Duplicate tabs, empty-state wording, optional sticky header or icons.

No backend or [background.js](background.js) changes required for any of the above; all changes are in [popup.html](popup.html) and [popup.js](popup.js).
