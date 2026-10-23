import type * as Pdfjs from "pdfjs-dist";
import type { FormChange, FormField, FormFieldType, FormValue } from "./types.ts";

/** What pdf.js's display annotations hold for a form widget. */
interface WidgetData {
  id: string;
  annotationType: number;
  fieldName?: string;
  fieldType?: string;
  fieldValue?: unknown;
  defaultFieldValue?: unknown;
  readOnly?: boolean;
  required?: boolean;
  checkBox?: boolean;
  radioButton?: boolean;
  pushButton?: boolean;
  combo?: boolean;
  multiSelect?: boolean;
  exportValue?: string;
  buttonValue?: string;
  options?: { exportValue: string; displayValue: string }[];
  rect: [number, number, number, number];
}

/** A field as the document holds it, without the values the reader changed. */
interface FieldEntry {
  field: Omit<FormField, "value">;
  /** Each widget and the value that checks it, for boxes and radio buttons. */
  widgets: { id: string; exportValue: string }[];
  /** The value in the document, before anything was typed. */
  documentValue: FormValue;
}

/** pdf.js's annotation type of form widgets (AnnotationType.WIDGET). */
const WIDGET = 20;

const typeOf = (data: WidgetData): FormFieldType => {
  switch (data.fieldType) {
    case "Tx":
      return "text";
    case "Ch":
      return data.combo ? "combobox" : "listbox";
    case "Sig":
      return "signature";
    default:
      return data.checkBox ? "checkbox" : data.radioButton ? "radio" : "button";
  }
};

const strings = (value: unknown): string[] =>
  (Array.isArray(value) ? value : value === null || value === undefined ? [] : [value]).map(String);

/**
 * The document's form fields, read and written through pdf.js's
 * `annotationStorage`, where the annotation layer keeps what the reader
 * types: a value per widget, `{ value }`, holding text, whether a box or
 * radio button is checked, or the selected options.
 */
export function createFormAccess(
  doc: Pdfjs.PDFDocumentProxy,
  getPage: (pageIndex: number) => Promise<Pdfjs.PDFPageProxy>,
) {
  let fields: Promise<Map<string, FieldEntry>> | undefined;
  const byWidget = new Map<string, FieldEntry>();

  const load = async (): Promise<Map<string, FieldEntry>> => {
    const objects = (await doc.getFieldObjects()) as Map<string, { page?: number }[]> | null;
    const pages = new Set<number>();
    for (const widgets of objects?.values() ?? []) {
      for (const { page } of widgets) if (typeof page === "number" && page >= 0) pages.add(page);
    }
    const entries = new Map<string, FieldEntry>();
    for (const pageIndex of [...pages].sort((a, b) => a - b)) {
      const page = await getPage(pageIndex);
      const viewport = page.getViewport({ scale: 1 });
      const annotations = (await page.getAnnotations({ intent: "display" })) as WidgetData[];
      for (const data of annotations) {
        if (data.annotationType !== WIDGET || !data.fieldName) continue;
        let entry = entries.get(data.fieldName);
        if (!entry) {
          const type = typeOf(data);
          const choice = type === "combobox" || type === "listbox";
          const multiple = type === "listbox" && data.multiSelect === true;
          const list = (value: unknown): FormValue =>
            choice
              ? multiple
                ? strings(value)
                : (strings(value)[0] ?? "")
              : type === "checkbox" || type === "radio"
                ? (strings(value)[0] ?? "Off")
                : (strings(value)[0] ?? "");
          entry = {
            field: {
              name: data.fieldName,
              type,
              defaultValue: list(data.defaultFieldValue),
              readOnly: data.readOnly === true,
              required: data.required === true,
              multiple,
              options: (data.options ?? []).map(({ exportValue, displayValue }) => ({
                value: exportValue,
                label: displayValue,
              })),
              exportValues: [],
              widgets: [],
            },
            widgets: [],
            documentValue: list(data.fieldValue),
          };
          entries.set(data.fieldName, entry);
        }
        const exportValue = (data.checkBox ? data.exportValue : data.buttonValue) ?? "";
        const [left, bottom, right, top] = data.rect;
        const [x1 = 0, y1 = 0] = viewport.convertToViewportPoint(left, top);
        const [x2 = 0, y2 = 0] = viewport.convertToViewportPoint(right, bottom);
        const rect = {
          x: Math.min(x1, x2),
          y: Math.min(y1, y2),
          width: Math.abs(x2 - x1),
          height: Math.abs(y2 - y1),
        };
        entry.widgets.push({ id: data.id, exportValue });
        entry.field = {
          ...entry.field,
          exportValues:
            (data.checkBox || data.radioButton) && !entry.field.exportValues.includes(exportValue)
              ? [...entry.field.exportValues, exportValue]
              : entry.field.exportValues,
          widgets: [...entry.field.widgets, { id: data.id, pageIndex, rect }],
        };
        byWidget.set(data.id, entry);
      }
    }
    return entries;
  };
  const loaded = () => {
    fields ??= load();
    return fields;
  };

  /** The field's value with what the reader typed and the application set. */
  const currentValue = ({ field, widgets, documentValue }: FieldEntry): FormValue => {
    const storage = doc.annotationStorage;
    const stored = (id: string) =>
      (storage.getRawValue(id) as { value?: unknown } | undefined)?.value;
    switch (field.type) {
      case "checkbox":
      case "radio": {
        let changed = false;
        for (const { id, exportValue } of widgets) {
          const value = stored(id);
          if (value === true) return exportValue;
          if (value !== undefined) changed = true;
        }
        return changed ? "Off" : documentValue;
      }
      case "combobox":
      case "listbox": {
        const widget = widgets.find(({ id }) => stored(id) !== undefined);
        if (!widget) return documentValue;
        const values = strings(stored(widget.id));
        return field.multiple ? values : (values[0] ?? "");
      }
      default: {
        const widget = widgets.find(({ id }) => typeof stored(id) === "string");
        return widget ? (stored(widget.id) as string) : documentValue;
      }
    }
  };

  return {
    async getFormFields(): Promise<readonly FormField[]> {
      const entries = await loaded();
      return [...entries.values()].map((entry) => ({ ...entry.field, value: currentValue(entry) }));
    },
    async setFormValues(values: Readonly<Record<string, FormValue | boolean>>): Promise<string[]> {
      const entries = await loaded();
      const storage = doc.annotationStorage;
      const set: string[] = [];
      for (const [name, value] of Object.entries(values)) {
        const entry = entries.get(name);
        if (!entry) continue;
        const { field, widgets } = entry;
        switch (field.type) {
          case "checkbox":
          case "radio": {
            // true checks the first box, false unchecks every one.
            const checked =
              value === true
                ? (widgets[0]?.exportValue ?? "")
                : value === false
                  ? "Off"
                  : (strings(value)[0] ?? "Off");
            for (const { id, exportValue } of widgets) {
              storage.setValue(id, { value: checked !== "Off" && exportValue === checked });
            }
            break;
          }
          case "combobox":
          case "listbox": {
            const selected = typeof value === "boolean" ? [] : strings(value);
            for (const { id } of widgets) {
              storage.setValue(id, { value: field.multiple ? selected : (selected[0] ?? null) });
            }
            break;
          }
          case "text":
            for (const { id } of widgets) {
              // The text shows as set, not as a format script once left it.
              storage.setValue(id, {
                value: typeof value === "string" ? value : strings(value).join(""),
                formattedValue: null,
              });
            }
            break;
          default:
            continue;
        }
        set.push(name);
      }
      return set;
    },
    async formChange(widgetId: string): Promise<FormChange | null> {
      await loaded();
      const entry = byWidget.get(widgetId);
      return entry ? { name: entry.field.name, value: currentValue(entry) } : null;
    },
  };
}
