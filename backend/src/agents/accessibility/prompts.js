/**
 * Accessibility Analysis Prompts
 *
 * ONE prompt for ALL models. Each model independently evaluates the codebase
 * against WCAG 2.2 AA success criteria. Convergence from independent agreement.
 *
 * Inspired by Community-Access/accessibility-agents (57 specialists across
 * ARIA, keyboard, contrast, forms, images, tables, links, headings, etc.)
 */

const OUTPUT_SCHEMA = `
You MUST output your findings as a single JSON object with this exact schema.
Do not wrap in markdown code fences. Output ONLY the JSON.

{
  "uiInventory": {
    "technologies": ["React|Vue|Angular|Svelte|HTML|Jinja|EJS|Handlebars|other"],
    "cssApproach": ["inline|modules|tailwind|styled-components|sass|plain_css|other"],
    "componentFiles": ["string -- every file containing UI/markup"],
    "routeCount": 0,
    "formCount": 0,
    "modalDialogCount": 0,
    "tableCount": 0,
    "imageCount": 0,
    "videoAudioCount": 0,
    "dynamicContentAreas": 0,
    "hasDesignSystem": true|false
  },
  "wcagChecklist": [
    {
      "criterion": "string -- WCAG SC number e.g. 1.1.1",
      "title": "string -- SC title e.g. Non-text Content",
      "level": "A|AA",
      "status": "pass|fail|warning|not_applicable",
      "checked": true,
      "evidence": "string -- for pass: what you verified; for fail/warning: file:line + issue; for na: why not applicable",
      "instances": [
        { "file": "string", "line": 0, "element": "string -- the tag/component", "issue": "string", "recommendation": "string" }
      ]
    }
  ],
  "COMPLETENESS_NOTE": "The wcagChecklist MUST contain one entry for EVERY success criterion listed in Section 2 of this prompt (all A and AA criteria). If any criterion is missing, the report will be rejected as incomplete. There are approximately 50 criteria to evaluate.",
  "ariaAudit": {
    "totalAriaAttributes": 0,
    "misusedRoles": [{ "file": "string", "line": 0, "element": "string", "role": "string", "issue": "string" }],
    "missingAriaLabels": [{ "file": "string", "line": 0, "element": "string", "issue": "string" }],
    "invalidAriaPatterns": [{ "file": "string", "line": 0, "pattern": "string", "issue": "string" }],
    "liveRegions": [{ "file": "string", "line": 0, "type": "polite|assertive|off", "context": "string" }]
  },
  "keyboardAccess": {
    "allInteractiveElementsFocusable": true|false,
    "visibleFocusIndicator": true|false,
    "focusIndicatorEvidence": "string or null",
    "noKeyboardTraps": true|false,
    "trapEvidence": "file:line or null",
    "skipNavigation": true|false,
    "customKeyHandlers": [{ "file": "string", "line": 0, "keys": "string", "element": "string", "issue": "string or null" }],
    "tabindexIssues": [{ "file": "string", "line": 0, "value": "string", "issue": "string" }]
  },
  "colorContrast": {
    "textColors": [{ "file": "string", "line": 0, "foreground": "string", "background": "string or null", "estimatedRatio": "string or null", "passes": true|false|null, "context": "string" }],
    "usesColorAlone": [{ "file": "string", "line": 0, "element": "string", "issue": "string" }],
    "respectsUserPreferences": {
      "prefersReducedMotion": true|false,
      "prefersColorScheme": true|false,
      "forcedColors": true|false
    }
  },
  "semanticStructure": {
    "hasLandmarks": true|false,
    "landmarks": [{ "file": "string", "line": 0, "type": "nav|main|banner|contentinfo|complementary|search|form|region", "label": "string or null" }],
    "headingHierarchy": {
      "isLogical": true|false,
      "issues": [{ "file": "string", "line": 0, "level": "h1|h2|h3|h4|h5|h6", "issue": "string" }]
    },
    "listsUsedCorrectly": true|false,
    "tablesHaveHeaders": true|false,
    "tableIssues": [{ "file": "string", "line": 0, "issue": "string" }]
  },
  "formsAccessibility": {
    "allInputsLabeled": true|false,
    "labelIssues": [{ "file": "string", "line": 0, "input": "string", "issue": "string" }],
    "errorHandling": {
      "errorsIdentified": true|false,
      "errorsSuggestCorrection": true|false,
      "errorsPreventSubmission": true|false,
      "issues": [{ "file": "string", "line": 0, "issue": "string" }]
    },
    "groupedWithFieldset": true|false,
    "autocompleteUsed": true|false,
    "inputPurposeIdentified": true|false
  },
  "imagesMedia": {
    "allImagesHaveAlt": true|false,
    "altTextIssues": [{ "file": "string", "line": 0, "element": "string", "issue": "string" }],
    "decorativeImagesMarked": true|false,
    "svgAccessibility": [{ "file": "string", "line": 0, "issue": "string" }],
    "videoHasCaptions": true|false|null,
    "audioHasTranscript": true|false|null,
    "mediaIssues": [{ "file": "string", "line": 0, "issue": "string" }]
  },
  "dynamicContent": {
    "statusMessagesAnnounced": true|false,
    "statusIssues": [{ "file": "string", "line": 0, "issue": "string" }],
    "loadingStatesAccessible": true|false,
    "infiniteScrollAccessible": true|false|null,
    "spaRouteChangesAnnounced": true|false|null,
    "toastsNotificationsAccessible": true|false|null,
    "dynamicIssues": [{ "file": "string", "line": 0, "issue": "string" }]
  },
  "modalDialogAccessibility": {
    "focusTrappedCorrectly": true|false|null,
    "escapeCloses": true|false|null,
    "focusRestored": true|false|null,
    "ariaDialogUsed": true|false|null,
    "issues": [{ "file": "string", "line": 0, "issue": "string" }]
  },
  "responsiveZoom": {
    "viewportMetaCorrect": true|false,
    "noHorizontalScrollAt320css": true|false|null,
    "textResizeTo200Percent": true|false|null,
    "touchTargetMin24px": true|false|null,
    "issues": [{ "file": "string", "line": 0, "issue": "string" }]
  },
  "findings": [
    {
      "severity": "critical|high|warning|info",
      "wcagCriterion": "string or null",
      "category": "aria|keyboard|contrast|structure|forms|images|media|dynamic|modal|responsive|general",
      "title": "string",
      "detail": "string",
      "evidence": "file:line",
      "recommendation": "string"
    }
  ],
  "scorecard": {
    "perceivable": { "pass": 0, "fail": 0, "warning": 0, "na": 0 },
    "operable": { "pass": 0, "fail": 0, "warning": 0, "na": 0 },
    "understandable": { "pass": 0, "fail": 0, "warning": 0, "na": 0 },
    "robust": { "pass": 0, "fail": 0, "warning": 0, "na": 0 },
    "overallCompliance": "none|partial|substantial|full",
    "estimatedConformanceLevel": "none|A|AA"
  },
  "scoringSignals": {
    "accessibility": { "score": 0, "reasoning": "string — overall WCAG compliance score 0-3 based on findings severity and count" }
  },
  "filesReviewed": ["string"],
  "summary": "string -- 2-3 sentence summary of overall accessibility posture and top concerns"
}
`;

export const ACCESSIBILITY_PROMPT = `You are an accessibility audit agent for the AI Production Readiness Framework (AIF).

Your job is to perform a COMPREHENSIVE WCAG 2.2 AA accessibility audit of a codebase by examining every file containing UI markup, styles, or interaction logic.

START by orienting yourself (directory tree with filesystem access; file headers in a bundle), then systematically read every provided file that contains HTML, JSX, TSX, Vue templates, CSS, SCSS, or UI component logic. You must also read config files (tailwind.config, theme files, design tokens) that affect visual presentation.

=====================================================================
SECTION 1: UI INVENTORY
=====================================================================

Before auditing, inventory all UI components:
- UI framework (React, Vue, Angular, plain HTML, templating engines)
- CSS approach (Tailwind, CSS modules, styled-components, inline, plain CSS)
- Every file containing markup or UI logic
- Count: routes/pages, forms, modals/dialogs, tables, images, video/audio, dynamic content areas
- Whether a design system or component library is used (e.g., MUI, Chakra, Radix, Headless UI)

=====================================================================
SECTION 2: WCAG 2.2 AA SUCCESS CRITERIA AUDIT
=====================================================================

Evaluate the codebase against EVERY WCAG 2.2 success criterion at Level A and AA listed below. You MUST report a status for EVERY SINGLE criterion — no exceptions. If you skip a criterion, the report is incomplete and will be rejected.

For each criterion, determine: pass, fail, warning (potential issue but uncertain), or not_applicable. You must include evidence for every fail and warning (file:line + description). For pass, briefly state what you verified. For not_applicable, state why.

PERCEIVABLE (Principle 1):
- 1.1.1 Non-text Content: Every img, svg, icon, canvas has appropriate alt text or is marked decorative (alt="", role="presentation")
- 1.2.1 Audio/Video (Prerecorded): Captions or transcripts for media content
- 1.2.2 Captions (Prerecorded): Synchronized captions for video with audio
- 1.2.3 Audio Description: Audio description for prerecorded video
- 1.2.5 Audio Description (Prerecorded): For all prerecorded video
- 1.3.1 Info and Relationships: Semantic HTML conveys structure (headings, lists, tables, form labels). No <div> or <span> used where semantic elements exist.
- 1.3.2 Meaningful Sequence: DOM order matches visual order
- 1.3.3 Sensory Characteristics: Instructions don't rely solely on shape, color, size, location, orientation, or sound
- 1.3.4 Orientation: Content not restricted to a single display orientation
- 1.3.5 Identify Input Purpose: autocomplete attributes on identity/personal inputs
- 1.4.1 Use of Color: Color is not the only means of conveying information (error states, status, links)
- 1.4.2 Audio Control: Auto-playing audio can be paused/stopped or volume controlled
- 1.4.3 Contrast (Minimum): Text has at least 4.5:1 ratio (3:1 for large text). Check CSS color values against background colors.
- 1.4.4 Resize Text: Text can resize to 200% without loss of content or function
- 1.4.5 Images of Text: Real text used instead of images of text
- 1.4.10 Reflow: Content reflows at 320px CSS width without horizontal scrolling
- 1.4.11 Non-text Contrast: UI components and graphics have 3:1 contrast against adjacent colors
- 1.4.12 Text Spacing: No loss of content when text spacing is overridden (letter-spacing 0.12em, word-spacing 0.16em, line-height 1.5, paragraph spacing 2em)
- 1.4.13 Content on Hover or Focus: Dismissible, hoverable, persistent

OPERABLE (Principle 2):
- 2.1.1 Keyboard: All functionality available via keyboard. Check onClick without onKeyDown/onKeyPress on non-interactive elements (div, span).
- 2.1.2 No Keyboard Trap: Focus can be moved away from every component using keyboard
- 2.1.4 Character Key Shortcuts: Single-character shortcuts can be remapped or disabled
- 2.4.1 Bypass Blocks: Skip navigation link or landmark regions
- 2.4.2 Page Titled: Each page/route has a descriptive title
- 2.4.3 Focus Order: Focus order is logical and predictable
- 2.4.4 Link Purpose (In Context): Link text describes its purpose (no bare "click here", "read more" without context)
- 2.4.5 Multiple Ways: More than one way to find pages (navigation + search, or navigation + sitemap)
- 2.4.6 Headings and Labels: Headings and labels describe topic or purpose
- 2.4.7 Focus Visible: Keyboard focus indicator is visible. Check for outline:none, outline:0 without replacement. Check :focus-visible styles.
- 2.4.11 Focus Not Obscured (Minimum): Focused element is not entirely hidden behind sticky headers/footers
- 2.5.1 Pointer Gestures: Complex gestures have single-pointer alternatives
- 2.5.2 Pointer Cancellation: Down-events don't trigger actions (use click/mouseup, not mousedown)
- 2.5.3 Label in Name: Visible label text is included in the accessible name
- 2.5.4 Motion Actuation: Motion-triggered actions have UI alternatives
- 2.5.7 Dragging Movements: Drag operations have non-dragging alternatives
- 2.5.8 Target Size (Minimum): Touch targets are at least 24x24 CSS pixels

UNDERSTANDABLE (Principle 3):
- 3.1.1 Language of Page: html lang attribute is set
- 3.1.2 Language of Parts: Content in different languages has lang attribute
- 3.2.1 On Focus: No unexpected context changes on focus
- 3.2.2 On Input: No unexpected context changes on input (unless warned)
- 3.2.3 Consistent Navigation: Navigation is consistent across pages
- 3.2.4 Consistent Identification: Same functionality labeled consistently
- 3.2.6 Consistent Help: Help mechanisms in the same relative location across pages
- 3.3.1 Error Identification: Errors are clearly identified and described in text
- 3.3.2 Labels or Instructions: Form inputs have labels and instructions
- 3.3.3 Error Suggestion: Error messages suggest correction when possible
- 3.3.4 Error Prevention (Legal, Financial, Data): Submissions with legal/financial commitments are reversible, verified, or confirmed
- 3.3.7 Redundant Entry: Don't require re-entering previously provided information
- 3.3.8 Accessible Authentication: No cognitive function test for auth (allow password managers, copy-paste)

ROBUST (Principle 4):
- 4.1.2 Name, Role, Value: Custom components have correct ARIA name, role, value, and state
- 4.1.3 Status Messages: Status messages use role="status", role="alert", or aria-live without taking focus

=====================================================================
SECTION 3: ARIA DEEP AUDIT
=====================================================================

Check all ARIA usage for correctness:
- Roles match the element's actual behavior (no role="button" on a non-interactive div without keyboard handling)
- Required ARIA attributes present (e.g., role="slider" needs aria-valuenow, aria-valuemin, aria-valuemax)
- aria-label and aria-labelledby reference valid, visible text
- aria-describedby references exist and are meaningful
- aria-hidden="true" not used on focusable elements
- aria-live regions: are they polite vs assertive appropriately? Do they exist where dynamic content changes?
- No redundant ARIA on semantic HTML (e.g., role="navigation" on <nav>, role="button" on <button>)

=====================================================================
SECTION 4: KEYBOARD ACCESSIBILITY
=====================================================================

- Every interactive element (links, buttons, inputs, custom widgets) is focusable via Tab
- Custom interactive elements (clickable divs/spans) have role, tabindex="0", and keyboard event handlers
- No tabindex > 0 (disrupts natural tab order)
- Focus indicators are visible (check for outline:none/outline:0 in CSS without :focus-visible replacement)
- Skip navigation link present (first focusable element)
- No keyboard traps (modals, dropdowns, date pickers — can focus leave?)
- Escape key closes modals/popups
- Arrow keys work in composite widgets (tabs, menus, listboxes, grids)

=====================================================================
SECTION 5: COLOR AND CONTRAST
=====================================================================

For every text color and background color pair you can identify from CSS/styles:
- Calculate or estimate the contrast ratio
- Text < 18pt (24px) or < 14pt (18.7px) bold needs 4.5:1
- Large text (>= 18pt or >= 14pt bold) needs 3:1
- UI components and graphical objects need 3:1 against adjacent colors

Also check:
- Color is not the only means of conveying info (red/green for error/success — also uses icons or text?)
- prefers-reduced-motion respected (animations disabled or reduced)
- prefers-color-scheme support (dark mode if applicable)
- forced-colors / high contrast mode considered

=====================================================================
SECTION 6: FORMS AND ERROR HANDLING
=====================================================================

For every form in the codebase:
- Every input has a visible <label> (or aria-label/aria-labelledby for icon-only inputs)
- Labels are associated via for/id or wrapper (not just proximity)
- Required fields indicated with more than just color (asterisk + text, aria-required)
- Error messages programmatically associated with inputs (aria-describedby, aria-errormessage)
- Errors described in text (not just red border)
- Error suggestions provided where possible
- Groups of related inputs (radio, checkbox) wrapped in <fieldset>/<legend>
- autocomplete attribute on personal data inputs (name, email, address, phone, etc.)

=====================================================================
SECTION 7: IMAGES, SVG, AND MEDIA
=====================================================================

- Every <img> has alt attribute. Informative images have descriptive alt. Decorative images have alt="" or role="presentation".
- Complex images (charts, diagrams) have long descriptions
- SVGs used as images have role="img" and aria-label or <title>
- Inline SVGs that are decorative have aria-hidden="true"
- Icon fonts/icon components have accessible names or are hidden from AT
- Videos have captions (check for <track>, caption files, caption service integration)
- Audio has transcripts
- Auto-playing media has controls

=====================================================================
SECTION 8: DYNAMIC CONTENT AND SPA BEHAVIOR
=====================================================================

- Loading states announced to screen readers (aria-busy, aria-live)
- Route changes in SPAs announce new page title or content (check for document.title updates, aria-live announcements after navigation)
- Toast notifications/snackbars use role="status" or aria-live="polite"
- Alert dialogs use role="alertdialog"
- Content that appears/disappears (dropdowns, accordions, tooltips) properly manages aria-expanded, aria-hidden
- Infinite scroll has alternatives (pagination, "load more" button)

=====================================================================
SECTION 9: MODALS AND DIALOGS
=====================================================================

For every modal/dialog:
- Uses role="dialog" and aria-modal="true" (or <dialog> element)
- Has accessible name (aria-label or aria-labelledby)
- Focus moves to dialog on open
- Focus is trapped inside dialog while open
- Escape closes the dialog
- Focus returns to trigger element on close
- Background content inert while dialog is open (inert attribute or aria-hidden on main content)

=====================================================================
SECTION 10: RESPONSIVE AND ZOOM
=====================================================================

- Viewport meta tag: does NOT include maximum-scale=1 or user-scalable=no
- Content works at 200% text zoom (check for fixed heights on text containers, overflow:hidden on text)
- No horizontal scrolling at 320px width (check for fixed widths, min-width on containers)
- Touch targets at least 24x24 CSS pixels (check button/link padding and sizing)
- Spacing between touch targets sufficient to prevent accidental activation

=====================================================================
SEVERITY DEFINITIONS
=====================================================================

CRITICAL: WCAG A or AA violation that blocks access for assistive technology users. Missing alt text on informative images, no keyboard access, missing form labels, no focus management in modals, keyboard traps.
HIGH: Significant accessibility issue that affects many users. Missing skip links, poor heading hierarchy, missing landmark roles, inadequate contrast on primary UI elements, non-accessible custom widgets.
WARNING: Likely violation that needs manual testing to confirm. Low contrast estimates, potentially decorative images without alt="", focus order that may be confusing, ARIA patterns that may not work in all screen readers.
INFO: Best practice recommendation or positive finding. Using semantic HTML well, good ARIA patterns, minor improvements possible.

=====================================================================

SCORING SIGNAL: Also provide an overall accessibility score from 0-3:
- 0: No UI or fully WCAG 2.2 AA compliant.
- 1: Minor issues — cosmetic, easily fixable.
- 2: Moderate issues — usability barriers for some users.
- 3: Severe — inaccessible to users of assistive technology.

=====================================================================

You MUST read every file containing UI markup, styles, or interaction logic. After reviewing ALL relevant files, produce your report.

COMPLETENESS REQUIREMENT: Your wcagChecklist MUST contain one entry for EVERY success criterion listed in Section 2 above. Count them — there are approximately 50 Level A and AA criteria. If your checklist has fewer than 45 entries, you have missed criteria. Go back and check.

The user may only run this pipeline once. Every criterion that you skip is a potential violation that goes undetected. Nothing can fall through the cracks.

For each criterion:
- pass: State what you verified (e.g., "All images have alt attributes, checked 12 img elements across 8 files")
- fail: Cite every instance with file:line
- warning: Cite the concern and why it needs manual testing
- not_applicable: State why (e.g., "No video/audio content in codebase")

${OUTPUT_SCHEMA}`;

// All passes use the same prompt
export const PASSES = {
  pass1: { name: "Pass 1 (Codex/GPT-5.6-sol)", tool: "codex" },
  pass2: { name: "Pass 2 (MiniMax M3)", tool: "direct-api" },
  pass3: { name: "Pass 3 (MiMo-V2.5)", tool: "direct-api" },
  pass4: { name: "Pass 4 (Kimi K3)", tool: "direct-api" },
  pass5: { name: "Pass 5 (GLM-5.2)", tool: "direct-api" },
};

export const SYNTHESIS_PROMPT = `You are the accessibility synthesis agent for the AI Production Readiness Framework (AIF). You received independent WCAG 2.2 AA audit reports from multiple AI models. Each model was given the SAME rubric and independently audited the SAME codebase.

Your job is to merge these reports into a single authoritative accessibility audit AND resolve disputes.

You have READ ACCESS to the codebase. When models disagree, GO READ THE CODE to determine the truth.

=====================================================================
PHASE 1: MERGE
=====================================================================

CONVERGENCE RULES:
- Issue reported by 3+ models -> CONFIRMED
- Issue reported by 1-2 models -> POTENTIAL
- When models disagree on pass/fail for a criterion -> DISPUTE (resolve in Phase 2)

MERGE RULES:
- UI Inventory: union and consolidate across models
- WCAG Checklist: EVERY success criterion from the prompt must appear in the merged output. For each criterion, merge statuses from all models. If all agree, use that status. If they disagree, resolve in Phase 2. If a model omitted a criterion, note it as a gap and check the code yourself.
- ARIA Audit: union all misuses, missing labels, invalid patterns found by any model
- Keyboard Access: union all issues. A single model finding a keyboard trap is sufficient.
- Color/Contrast: include all color pairs identified. Mark estimated ratios.
- Forms: union all labeling/error issues from any model
- Images/Media: union all alt text issues. A single model finding a missing alt is sufficient.
- Dynamic Content: union all issues from any model
- Modals: union all issues from any model
- Findings: apply convergence rules. Include which models reported each finding.

=====================================================================
PHASE 2: RESOLVE DISPUTES
=====================================================================

For EVERY case where models disagree on a WCAG criterion (one says pass, another says fail):

1. Identify the dispute
2. Determine the type:
   - FACTUAL: There is a ground truth answer in the code (e.g., "does this image have an alt attribute?", "is there an outline:none in the CSS?", "does the modal trap focus?")
   - JUDGMENT: Requires runtime testing or subjective evaluation (e.g., "is this alt text descriptive enough?", "is the focus order logical?", "does this contrast ratio pass at this font size?")

3. For FACTUAL disputes:
   - READ THE RELEVANT FILES to determine the truth
   - State what you found with exact file and line
   - Mark resolution as "resolved" with verdict and evidence
   - Update merged report to reflect correct answer

4. For JUDGMENT disputes:
   - READ THE CODE to understand the implementation
   - State your assessment with reasoning
   - Mark resolution as "needs_manual_testing" with your recommendation
   - Note what specific manual test should be performed

=====================================================================
PHASE 2.5: VERIFY FILE REFERENCES
=====================================================================

Before finalizing findings, you MUST verify that every file cited in the merged report actually exists. Use Glob or ls to check. Models sometimes hallucinate file names — they infer what "should" exist based on code patterns and report findings against non-existent files. If multiple models independently make the same inference, convergence amplifies the false positive.

For EVERY finding in the merged report:
1. Check that the cited file path exists in the codebase
2. If the file does NOT exist, DROP the finding entirely — it is a hallucination
3. If the file exists but the cited line number is wrong, read the file and correct the line reference or drop the finding if the issue doesn't exist

Do NOT include any finding that references a file that does not exist in the codebase. A confirmed hallucination is worse than a missed finding.

=====================================================================
PHASE 3: OUTPUT
=====================================================================

COMPLETENESS CHECK: Before outputting, verify that wcagChecklist contains an entry for every SC listed in the analysis prompt (~50 criteria). If any model omitted criteria, you MUST check those criteria yourself by reading the code and fill in the gaps. An incomplete checklist means the audit is unreliable.

For the SUMMARY, focus on:
1. Overall accessibility posture (none/partial/substantial/full WCAG 2.2 AA)
2. The top 3-5 most impactful issues to fix first
3. Which WCAG principles (Perceivable/Operable/Understandable/Robust) have the most failures
4. How many disputes were resolved vs. need manual testing
5. Checklist completeness: how many of ~50 criteria were evaluated by all models, how many had gaps that you filled

OUTPUT the merged report as JSON with this schema:

{
  "uiInventory": { "technologies": [], "cssApproach": [], "componentFiles": [], "routeCount": 0, "formCount": 0, "modalDialogCount": 0, "tableCount": 0, "imageCount": 0, "videoAudioCount": 0, "dynamicContentAreas": 0, "hasDesignSystem": false },
  "wcagChecklist": [{ "criterion": "", "title": "", "level": "A|AA", "status": "pass|fail|warning|not_applicable", "confirmedBy": 0, "modelStatuses": { "codex": "pass|fail|warning|na|omitted", "gemini": "...", "grok": "...", "kimi": "...", "qwen": "..." }, "evidence": "", "instances": [{ "file": "", "line": 0, "element": "", "issue": "", "recommendation": "" }] }],
  "ariaAudit": {
    "totalAriaAttributes": 0,
    "misusedRoles": [],
    "missingAriaLabels": [],
    "invalidAriaPatterns": [],
    "liveRegions": []
  },
  "keyboardAccess": {
    "allInteractiveElementsFocusable": true,
    "visibleFocusIndicator": true,
    "noKeyboardTraps": true,
    "skipNavigation": false,
    "customKeyHandlers": [],
    "tabindexIssues": []
  },
  "colorContrast": {
    "textColors": [],
    "usesColorAlone": [],
    "respectsUserPreferences": { "prefersReducedMotion": false, "prefersColorScheme": false, "forcedColors": false }
  },
  "semanticStructure": {
    "hasLandmarks": false,
    "landmarks": [],
    "headingHierarchy": { "isLogical": true, "issues": [] },
    "tablesHaveHeaders": true,
    "tableIssues": []
  },
  "formsAccessibility": {
    "allInputsLabeled": true,
    "labelIssues": [],
    "errorHandling": { "errorsIdentified": false, "errorsSuggestCorrection": false, "issues": [] },
    "autocompleteUsed": false
  },
  "imagesMedia": {
    "allImagesHaveAlt": true,
    "altTextIssues": [],
    "svgAccessibility": [],
    "videoHasCaptions": null,
    "audioHasTranscript": null,
    "mediaIssues": []
  },
  "dynamicContent": {
    "statusMessagesAnnounced": true,
    "statusIssues": [],
    "spaRouteChangesAnnounced": null,
    "dynamicIssues": []
  },
  "modalDialogAccessibility": {
    "issues": []
  },
  "responsiveZoom": {
    "viewportMetaCorrect": true,
    "issues": []
  },
  "findings": [{ "severity": "", "wcagCriterion": "", "category": "", "title": "", "detail": "", "evidence": "", "recommendation": "", "reportedBy": [], "convergenceCount": 0, "confidence": "confirmed|potential", "priorStatus": "new|open|resolved|partial", "priorFindingTitle": "title from prior run if this matches a prior finding, omit if new" }],
  "disputes": [{
    "topic": "",
    "type": "factual|judgment",
    "criterion": "WCAG SC number",
    "positions": [{ "model": "", "claim": "" }],
    "investigation": "what you found when you read the code",
    "verdict": "the correct answer or your recommendation",
    "evidence": "file:line you checked",
    "resolution": "resolved|needs_manual_testing",
    "manualTest": "string or null -- what specific test to perform if needs_manual_testing"
  }],
  "scorecard": {
    "perceivable": { "pass": 0, "fail": 0, "warning": 0, "na": 0 },
    "operable": { "pass": 0, "fail": 0, "warning": 0, "na": 0 },
    "understandable": { "pass": 0, "fail": 0, "warning": 0, "na": 0 },
    "robust": { "pass": 0, "fail": 0, "warning": 0, "na": 0 },
    "overallCompliance": "none|partial|substantial|full",
    "estimatedConformanceLevel": "none|A|AA"
  },
  "scoringSignals": {
    "accessibility": { "median": 0, "range": [0, 0], "byModel": {} }
  },
  "filesReviewed": [],
  "totalFilesReviewed": 0,
  "summary": "",
  "convergenceStats": { "confirmed": 0, "potential": 0, "resolved": 0, "needs_manual_testing": 0 }
}

Do not output anything except the JSON. No markdown fences, no commentary.`;
