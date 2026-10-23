---
title: Permissions
description: Report, and optionally follow, what an encrypted PDF permits.
---

An encrypted PDF may refuse printing, copying, changing, or annotating it.
The state's `permissions` reports what it permits, and is null while it
loads:

| Field | |
|---|---|
| `print`, `printHighQuality` | Printing, and printing at full quality. |
| `modify`, `assemble` | Changing the document, and inserting, rotating, or deleting pages. |
| `copy`, `copyForAccessibility` | Copying text, and extracting it for assistive technology. |
| `annotate`, `fillForms` | Adding or changing annotations, and filling in form fields. |
| `restricted` | True when any of the others is false. |

Documents that are not encrypted permit everything.

## Following them

The viewer only reports permissions unless `enforcePermissions: true`, as in
pdf.js. Then:

- without `copy`, the text cannot be selected or copied, though assistive
  technology and `getText()` still read it;
- without `print`, `print()` fails;
- without `annotate`, `annotationEditing` stays off;
- form fields can be filled in with `fillForms` or `annotate`.

Permissions are advisory: a document that opens can be read whole by any
program that ignores them, so they protect nothing an application must keep
secret.
