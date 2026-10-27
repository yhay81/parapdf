import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement, Suspense } from "react";
import { prerender } from "react-dom/static";
import { PdfSession } from "../src/document/pdf-session.ts";
import { SessionContext } from "../src/react/context.ts";
import {
  useAttachments,
  useInitialView,
  useLayers,
  useMetadata,
  useOutline,
  usePageLabels,
} from "../src/react/data.ts";
import { useFormFields } from "../src/react/forms.ts";

const hooks = {
  useOutline,
  usePageLabels,
  useMetadata,
  useAttachments,
  useInitialView,
  useLayers,
  useFormFields,
};

describe("server rendering", () => {
  for (const [name, hook] of Object.entries(hooks)) {
    // A prerender waits for every boundary; one suspended on a read that
    // never settles left it pending until Node exited with nothing written.
    it(`renders the fallback of ${name}'s Suspense boundary, which the server cannot read`, async () => {
      const Reader = () => {
        hook();
        return createElement("p", null, "read");
      };
      const errors: unknown[] = [];
      const bailouts: unknown[] = [];
      const { prelude } = await prerender(
        createElement(
          SessionContext,
          { value: new PdfSession({ url: "/manual.pdf" }) },
          createElement(
            Suspense,
            { fallback: createElement("p", null, "reading") },
            createElement(Reader),
          ),
        ),
        {
          onError: (error) => void errors.push(error),
          onBrowserBailout: (error) => void bailouts.push(error),
        },
      );
      const html = await new Response(prelude).text();
      assert.match(html, /<p>reading<\/p>/);
      assert.doesNotMatch(html, /<p>read<\/p>/);
      // A bailout to the browser, not an error the browser would report.
      assert.deepEqual(errors, []);
      assert.equal(bailouts.length, 1);
      assert.match(String((bailouts[0] as Error).cause), new RegExp(`^${name} reads the document`));
    });
  }
});
