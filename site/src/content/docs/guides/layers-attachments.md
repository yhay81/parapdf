---
title: Layers and attachments
description: Show and hide a PDF's layers, and open the files embedded in it.
---

[The demo](/demo/?file=synthetic-features.pdf) opens a document with two
layers, an embedded file, page labels, a comment, and form fields: its
sidebar lists the layers and the file.

## Layers

The state's `layers` lists the document's layers (optional content) in its
own order, null while they load: `{ id, name, visible, children }`, where a
heading that only groups others has a null `id`.

`viewer.setLayerVisible(id, visible)` shows or hides one in this viewer, its
thumbnails, and its printouts; showing one of a set of exclusive layers hides
the others, and links in the document that switch layers work too. Pages
keep their old pixels while they are drawn again.

## Attachments

The state's `attachments` lists the embedded files as
`{ id, filename, description }`, null while they load.

- `viewer.getAttachmentContent(id)` resolves to a file's bytes.
- `viewer.openAttachment(attachment)` does what activating a file attachment
  annotation does: by default, the browser downloads the file.
- The `openAttachment` option, `({ filename, content }) => void`, replaces
  that, for both.

## Page labels and metadata

The state's `pageLabels` holds each page's label, such as `"iv"` or `"A-3"`,
when the PDF defines them, and null otherwise. `metadata` holds the title,
author, subject, keywords, creator, producer, creation and modification
dates, PDF version, and language, null while it loads.
