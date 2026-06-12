# UI Accessibility Checklist

Use this checklist after visual or workflow changes to the console.

- Keyboard tab order reaches the prototype banner, header controls, role navigation, page actions, forms, tables, and dialogs in a predictable order.
- Focus rings are visible on links, buttons, segmented controls, inputs, table actions, and modal controls.
- Icon-only controls have an `aria-label`; icon plus text controls keep visible text.
- Status tags include text, not color alone.
- Alerts are visible near the affected workflow and use plain-language headings.
- Table headers describe the data in the column.
- Form fields have labels, useful help text, and error messages tied to the field.
- Evidence images have descriptive alt text or nearby associated evidence text.
- Color contrast is acceptable in normal, hover, selected, disabled, and warning/error states.
- No color-only meaning is used for pass, fail, warning, or health status.
- Each page has one `h1`, followed by section headings in order.
- Reviewer override notes and correction messages are keyboard-accessible.
- Dialogs and drawers can be closed with keyboard and return focus to the triggering control.

Automated coverage:

```bash
npm --prefix apps/console run test:e2e -- accessibility.spec.ts
```

Automated axe scans support the checklist, but they do not replace manual keyboard and screen-reader review.
