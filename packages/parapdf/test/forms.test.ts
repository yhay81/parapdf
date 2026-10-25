import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formsOf } from "../src/features/forms/index.ts";
import { openSession } from "./fake-pdfjs.ts";

/** A page's widgets as pdf.js's getAnnotations() gives them. */
const widgets = [
  {
    id: "1R",
    annotationType: 20,
    fieldName: "name",
    fieldType: "Tx",
    fieldValue: "",
    rect: [0, 0, 100, 20],
  },
  {
    id: "2R",
    annotationType: 20,
    fieldName: "agree",
    fieldType: "Btn",
    checkBox: true,
    exportValue: "Yes",
    fieldValue: "Off",
    rect: [0, 30, 10, 40],
  },
  {
    id: "3R",
    annotationType: 20,
    fieldName: "size",
    fieldType: "Ch",
    combo: true,
    options: [
      { exportValue: "s", displayValue: "Small" },
      { exportValue: "l", displayValue: "Large" },
    ],
    fieldValue: "s",
    rect: [0, 50, 100, 70],
  },
];

/** A one-page form whose annotation storage is a map, as pdf.js's is. */
async function form() {
  const storage = new Map<string, unknown>();
  const page = {
    getViewport: () => ({
      convertToViewportPoint: (x: number, y: number) => [x, 792 - y],
    }),
    getAnnotations: async () => widgets,
  };
  const opened = await openSession({
    proxy: {
      getFieldObjects: async () =>
        new Map(widgets.map(({ fieldName }) => [fieldName, [{ page: 0 }]])),
      getPage: async () => page,
      annotationStorage: {
        get size() {
          return storage.size;
        },
        getRawValue: (id: string) => storage.get(id),
        setValue: (id: string, value: unknown) => storage.set(id, value),
      },
    },
  });
  return { ...opened, storage };
}

describe("form fields", () => {
  it("are read once per session, with their values", async () => {
    const { session } = await form();
    assert.equal(formsOf(session), formsOf(session));
    const fields = await formsOf(session).getFormFields();
    assert.deepEqual(
      fields.map(({ name, type, value }) => ({ name, type, value })),
      [
        { name: "name", type: "text", value: "" },
        { name: "agree", type: "checkbox", value: "Off" },
        { name: "size", type: "combobox", value: "s" },
      ],
    );
    assert.deepEqual(fields[0]?.widgets, [
      { id: "1R", pageIndex: 0, rect: { x: 0, y: 772, width: 100, height: 20 } },
    ]);
  });

  it("are set by name into the annotation storage, unknown names ignored", async () => {
    const { session, storage } = await form();
    const forms = formsOf(session);
    const set = await forms.setFormValues({ name: "Ada", agree: true, size: "l", missing: "x" });
    assert.deepEqual(set, ["name", "agree", "size"]);
    assert.deepEqual(storage.get("1R"), { value: "Ada", formattedValue: null });
    assert.deepEqual(storage.get("2R"), { value: true });
    const values = Object.fromEntries(
      (await forms.getFormFields()).map(({ name, value }) => [name, value]),
    );
    assert.deepEqual(values, { name: "Ada", agree: "Yes", size: "l" });
    assert.deepEqual(await forms.formChange("2R"), { name: "agree", value: "Yes" });
    assert.equal(await forms.formChange("9R"), null);
  });
});
