---
title: Permissions
description: Report, and optionally follow, what an encrypted PDF permits.
---

An encrypted PDF may refuse printing, copying, changing, or annotating it.
The document state's `permissions` reports what it permits, and is null
until the document is ready and when they cannot be read:

```tsx
const canPrint = useDocumentState((state) => state.permissions?.print ?? true);
```

| Field | |
|---|---|
| `print`, `printHighQuality` | Printing, and printing at full quality. |
| `modify`, `assemble` | Changing the document, and inserting, rotating, or deleting pages. |
| `copy`, `copyForAccessibility` | Copying text, and extracting it for assistive technology. |
| `annotate`, `fillForms` | Adding or changing annotations, and filling in form fields. |
| `restricted` | True when the document restricts anything at all. |

Documents that are not encrypted permit everything.

## Following them

The viewer only reports permissions unless `<PdfPermissions />` is mounted for
it (typically inside `<PdfViewer>`), as in pdf.js:

```tsx
<PdfViewer>
  <PdfPermissions />
</PdfViewer>
```

Then:

- without `copy`, the text cannot be selected or copied, though assistive
  technology and `getText()` still read it;
- without `print`, `print()` fails;
- without `annotate`, annotations cannot be created, even with
  `<PdfAnnotationEditor />`;
- with `<PdfForms />`, fields can be filled in only with `fillForms` or `annotate`.

Mounting or unmounting `<PdfPermissions />` applies to the open document immediately.
Existing form values and annotations are kept when editing is restricted.

`permits(viewer, what)` says whether the viewer allows `"print"`, `"copy"`,
`"annotate"`, or `"fillForms"`, say to disable a print button: true when its
document permits it, and always when the viewer does not follow permissions.

Permissions are advisory: a document that opens can be read whole by any
program that ignores them, so they protect nothing an application must keep
secret.
