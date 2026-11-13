import { type AnnotationLabels, type AnnotationTool, PdfPermissions } from "parapdf";
import { lazy, Suspense } from "react";

const LazyForms = lazy(() => import("./features/LazyForms.tsx"));
const LazyAnnotationEditor = lazy(() => import("./features/LazyAnnotationEditor.tsx"));
const LazyAutoLinks = lazy(() => import("./features/LazyAutoLinks.tsx"));

export interface DemoFeatures {
  autoLinks: boolean;
  forms: boolean;
  formScripts: boolean;
  annotations: boolean;
  annotationLabels?: Partial<AnnotationLabels> | undefined;
  annotationTool?: AnnotationTool | undefined;
  defaultAnnotationTool?: AnnotationTool | undefined;
  onAnnotationToolChange?: ((tool: AnnotationTool) => void) | undefined;
  enforcePermissions: boolean;
}

export function ViewerFeatures({ features }: { features: DemoFeatures }) {
  return (
    <>
      {features.enforcePermissions ? <PdfPermissions /> : null}
      <Suspense fallback={null}>
        {features.forms ? <LazyForms scripts={features.formScripts} /> : null}
        {features.annotations ? (
          <LazyAnnotationEditor
            labels={features.annotationLabels}
            tool={features.annotationTool}
            defaultTool={features.defaultAnnotationTool}
            onToolChange={features.onAnnotationToolChange}
          />
        ) : null}
        {features.autoLinks ? <LazyAutoLinks /> : null}
      </Suspense>
    </>
  );
}
