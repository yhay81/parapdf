"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PdfSession } from "../document/pdf-session.ts";
import {
  type DownloadOptions,
  download as downloadSession,
  type SaveOptions,
  save as saveSession,
} from "../features/download.ts";
import { useOptionalSession } from "./context.ts";

export interface SaveControls {
  /** Save the document's bytes, including form values and created annotations. */
  save(options?: SaveOptions): Promise<Uint8Array | null>;
  /** Save the document and hand it to the browser as a download. */
  download(options?: DownloadOptions): Promise<void>;
  /** True while `save()` or `download()` from this hook is running. */
  saving: boolean;
}

/**
 * Save or download the document of `session`, or of the nearest
 * `<PdfDocument>`, while tracking whether an operation from this hook is in
 * flight (`saving`).
 */
export function useSave(session?: PdfSession): SaveControls {
  const resolved = useOptionalSession(session);
  const [saving, setSaving] = useState(false);
  const pendingRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    // A save may finish while Activity has disconnected this hook's effects.
    setSaving(pendingRef.current > 0);
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const save = useCallback(
    async (options?: SaveOptions): Promise<Uint8Array | null> => {
      pendingRef.current += 1;
      if (mountedRef.current) setSaving(true);
      try {
        return await saveSession(resolved, options);
      } finally {
        pendingRef.current -= 1;
        if (mountedRef.current && pendingRef.current === 0) setSaving(false);
      }
    },
    [resolved],
  );

  const download = useCallback(
    async (options?: DownloadOptions): Promise<void> => {
      pendingRef.current += 1;
      if (mountedRef.current) setSaving(true);
      try {
        await downloadSession(resolved, options);
      } finally {
        pendingRef.current -= 1;
        if (mountedRef.current && pendingRef.current === 0) setSaving(false);
      }
    },
    [resolved],
  );

  return useMemo(() => ({ save, download, saving }), [save, download, saving]);
}
