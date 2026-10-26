---
title: Layers and attachments
description: Show and hide a PDF's layers, and open the files embedded in it.
---

[The demo](/demo/?file=synthetic-features.pdf) opens a document with two
layers, an embedded file, page labels, a comment, and form fields: its
sidebar lists the layers and the file.

These hooks read the document of the nearest `PdfDocument` with React's
`use()`: each suspends until its data is read, so render it under a
Suspense boundary of your own, apart from the viewer, which never waits for
them.

```tsx
import { setLayerVisible, useLayers, type Viewer } from "parapdf";

function Layers({ viewer }: { viewer: Viewer }) {
  const layers = useLayers();
  return (
    <ul>
      {layers.map(({ id, name, visible }) =>
        id === null ? null : (
          <li key={id}>
            <label>
              <input
                type="checkbox"
                checked={visible}
                onChange={(event) => setLayerVisible(viewer, id, event.target.checked)}
              />
              {name}
            </label>
          </li>
        ),
      )}
    </ul>
  );
}

<Suspense fallback={null}>
  <Layers viewer={viewer} />
</Suspense>;
```

## Layers

`useLayers()` lists the document's layers (optional content) in its own
order, empty when it has none: `{ id, name, visible, children }`, where a
heading that only groups others has a null `id`. It follows their
visibility as it changes.

`setLayerVisible(viewer, id, visible)` shows or hides one in every viewer of
the document, their thumbnails, and their printouts; showing one of a set
of exclusive layers hides the others, and links in the document that switch
layers work too. Pages keep their old pixels while they are drawn again.

## Attachments

`useAttachments()` lists the embedded files as
`{ id, filename, description }`, empty when there are none.

- `getAttachmentContent(viewer, id)` resolves to a file's bytes, or null.
- `openAttachment(viewer, attachment)` does what activating a file
  attachment annotation does: by default, the browser downloads the file.
- `PdfViewer`'s `openAttachment` prop, `({ filename, content }) => void`,
  replaces that, for both.

## Page labels and metadata

`usePageLabels()` gives each page's label, such as `"iv"` or `"A-3"`, when
the PDF defines them, and null otherwise. `useMetadata()` gives the title,
author, subject, keywords, creator, producer, creation and modification
dates, PDF version, and language, or null when they cannot be read.
