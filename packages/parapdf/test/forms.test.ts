import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { PdfSessionController } from "../src/document/pdf-session.ts";
import {
  type FormChange,
  formsOf,
  getFormFields,
  hasViewerFormListeners,
  initialFormFields,
  notifyViewerFormChange,
  onViewerFormChange,
  setFormValues,
} from "../src/features/forms/index.ts";
import { ViewerController } from "../src/view/viewer.ts";
import {
  askPassword,
  fakeDocument,
  fakePdfjs,
  LETTER,
  openSession,
  PasswordException,
  settle,
} from "./fake-pdfjs.ts";

/** A widget as pdf.js's getAnnotations() gives it, on page `page` (the first by default). */
interface Widget {
  id: string;
  annotationType: number;
  fieldName?: string;
  page?: number;
  [key: string]: unknown;
}

/** A page's widgets as pdf.js's getAnnotations() gives them. */
const widgets: Widget[] = [
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

/** Two radio buttons of one field, "red" selected in the document. */
const radios: Widget[] = [
  {
    id: "red",
    annotationType: 20,
    fieldName: "color",
    fieldType: "Btn",
    radioButton: true,
    buttonValue: "red",
    fieldValue: "red",
    rect: [0, 0, 10, 10],
  },
  {
    id: "blue",
    annotationType: 20,
    fieldName: "color",
    fieldType: "Btn",
    radioButton: true,
    buttonValue: "blue",
    fieldValue: "red",
    rect: [0, 10, 10, 20],
  },
];

/**
 * A form whose annotation storage is a map, as pdf.js's is. The pages in
 * `turned` are turned a quarter by their /Rotate, as pdf.js's viewport of a
 * page of US Letter turns points.
 */
async function form(fieldWidgets: readonly Widget[] = widgets, turned: readonly number[] = []) {
  const storage = new Map<string, unknown>();
  const pageOf = (widget: Widget) => widget.page ?? 0;
  const page = (pageIndex: number) => ({
    getViewport: () => ({
      convertToViewportPoint: (x: number, y: number) =>
        turned.includes(pageIndex) ? [y, x] : [x, 792 - y],
    }),
    getAnnotations: async () => fieldWidgets.filter((widget) => pageOf(widget) === pageIndex),
  });
  // Each field's widgets' pages, in the order the widgets are listed.
  const objects = new Map<string, { page: number }[]>();
  for (const widget of fieldWidgets) {
    if (!widget.fieldName) continue;
    objects.set(widget.fieldName, [
      ...(objects.get(widget.fieldName) ?? []),
      { page: pageOf(widget) },
    ]);
  }
  let fieldReads = 0;
  const opened = await openSession({
    pages: Array.from(
      { length: Math.max(1, ...fieldWidgets.map(pageOf).map((p) => p + 1)) },
      () => LETTER,
    ),
    proxy: {
      getFieldObjects: async () => {
        fieldReads++;
        return objects;
      },
      getPage: async (pageNumber: number) => page(pageNumber - 1),
      annotationStorage: {
        get size() {
          return storage.size;
        },
        getRawValue: (id: string) => storage.get(id),
        setValue: (id: string, value: unknown) => storage.set(id, value),
      },
    },
  });
  return { ...opened, storage, fieldReads: () => fieldReads };
}

describe("form fields", () => {
  it("are read once per session, with their values", async () => {
    const { session, fieldReads } = await form();
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
    await formsOf(session).setFormValues({ name: "Ada" });
    await formsOf(session).getFormFields();
    assert.equal(fieldReads(), 1);
  });

  it("forgets a failed field read so the next call retries", async () => {
    let attempts = 0;
    const { session } = await openSession({
      pages: [LETTER],
      proxy: {
        getFieldObjects: async () => {
          if (++attempts === 1) throw new Error("transient read failure");
          return null;
        },
      },
    });
    const forms = formsOf(session);
    await assert.rejects(forms.getFormFields(), /transient read failure/);
    assert.deepEqual(await forms.getFormFields(), []);
    assert.equal(attempts, 2);
  });

  it("gather a field's widgets from every page in page order, rectangles from the top-left", async () => {
    const pagesApart: Widget[] = [
      { ...(radios[1] as Widget), rect: [10, 20, 30, 60], page: 1 },
      { ...(radios[0] as Widget), page: 0 },
    ];
    const { session } = await form(pagesApart, [1]);
    const [field] = await formsOf(session).getFormFields();
    assert.equal(field?.value, "red");
    assert.deepEqual(field?.exportValues, ["red", "blue"]);
    assert.deepEqual(field?.widgets, [
      { id: "red", pageIndex: 0, rect: { x: 0, y: 782, width: 10, height: 10 } },
      { id: "blue", pageIndex: 1, rect: { x: 20, y: 10, width: 40, height: 20 } },
    ]);
  });

  it("list buttons and signatures, which values do not set, and skip other annotations", async () => {
    const { session, storage } = await form([
      {
        id: "4R",
        annotationType: 20,
        fieldName: "submit",
        fieldType: "Btn",
        pushButton: true,
        rect: [0, 0, 10, 10],
      },
      { id: "5R", annotationType: 20, fieldName: "sign", fieldType: "Sig", rect: [0, 20, 10, 30] },
      // A link, and a widget of no field.
      { id: "6R", annotationType: 2, rect: [0, 40, 10, 50] },
      { id: "7R", annotationType: 20, rect: [0, 60, 10, 70] },
    ]);
    const forms = formsOf(session);
    assert.deepEqual(
      (await forms.getFormFields()).map(({ name, type, value, exportValues }) => ({
        name,
        type,
        value,
        exportValues,
      })),
      [
        { name: "submit", type: "button", value: "", exportValues: [] },
        { name: "sign", type: "signature", value: "", exportValues: [] },
      ],
    );
    assert.deepEqual(await forms.setFormValues({ submit: "x", sign: "y" }), []);
    assert.equal(storage.size, 0);
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

  it("keeps a radio's document value when only another widget is stored unchecked", async () => {
    const { session, storage } = await form(radios);
    const forms = formsOf(session);
    const value = async () => (await forms.getFormFields())[0]?.value;
    assert.equal(await value(), "red");
    // pdf.js records other radios as unchecked as it renders the selected one.
    storage.set("blue", { value: false });
    assert.equal(await value(), "red");
    assert.deepEqual(await forms.formChange("blue"), { name: "color", value: "red" });
    storage.set("red", { value: false });
    assert.equal(await value(), "Off");
    storage.set("blue", { value: true });
    assert.equal(await value(), "blue");
    await forms.setFormValues({ color: false });
    assert.equal(await value(), "Off");
    await forms.setFormValues({ color: "red" });
    assert.equal(await value(), "red");
  });

  it("read what the document's scripts set for widgets not built yet", async () => {
    // pdf.js stores what the scripts send for a widget without an element:
    // a box's or radio button's field value, and calculated text as a number.
    const { session, storage } = await form([...widgets, ...radios]);
    const forms = formsOf(session);
    const values = async () =>
      Object.fromEntries((await forms.getFormFields()).map(({ name, value }) => [name, value]));
    storage.set("1R", { value: 42, formattedValue: "42.00" });
    storage.set("2R", { value: "Yes" });
    storage.set("red", { value: "blue" });
    storage.set("blue", { value: "blue" });
    assert.deepEqual(await values(), { name: "42", agree: "Yes", size: "s", color: "blue" });
    assert.deepEqual(await forms.formChange("red"), { name: "color", value: "blue" });
    storage.set("2R", { value: "Off" });
    assert.equal((await values()).agree, "Off");
  });

  it("check only the box of the value among boxes of one field", async () => {
    const boxes: Widget[] = ["A", "B"].map((exportValue, index) => ({
      id: `box${exportValue}`,
      annotationType: 20,
      fieldName: "pick",
      fieldType: "Btn",
      checkBox: true,
      exportValue,
      fieldValue: "Off",
      rect: [0, index * 20, 10, index * 20 + 10],
    }));
    const { session, storage } = await form(boxes);
    const forms = formsOf(session);
    const value = async () => (await forms.getFormFields())[0]?.value;
    assert.deepEqual((await forms.getFormFields())[0]?.exportValues, ["A", "B"]);
    await forms.setFormValues({ pick: "B" });
    assert.deepEqual(
      [storage.get("boxA"), storage.get("boxB")],
      [{ value: false }, { value: true }],
    );
    assert.equal(await value(), "B");
    await forms.setFormValues({ pick: true });
    assert.equal(await value(), "A");
    await forms.setFormValues({ pick: "Off" });
    assert.equal(await value(), "Off");
  });

  it("take several options of a list box that allows them", async () => {
    const toppings: Widget = {
      id: "8R",
      annotationType: 20,
      fieldName: "toppings",
      fieldType: "Ch",
      multiSelect: true,
      options: [
        { exportValue: "a", displayValue: "Anchovies" },
        { exportValue: "b", displayValue: "Basil" },
      ],
      fieldValue: ["a", "b"],
      defaultFieldValue: "a",
      rect: [0, 0, 100, 40],
    };
    const { session, storage } = await form([toppings]);
    const forms = formsOf(session);
    const [field] = await forms.getFormFields();
    assert.equal(field?.type, "listbox");
    assert.equal(field?.multiple, true);
    assert.deepEqual(field?.value, ["a", "b"]);
    assert.deepEqual(field?.defaultValue, ["a"]);
    assert.deepEqual(field?.options, [
      { value: "a", label: "Anchovies" },
      { value: "b", label: "Basil" },
    ]);
    await forms.setFormValues({ toppings: "b" });
    assert.deepEqual(storage.get("8R"), { value: ["b"] });
    assert.deepEqual((await forms.getFormFields())[0]?.value, ["b"]);
    await forms.setFormValues({ toppings: [] });
    assert.deepEqual((await forms.getFormFields())[0]?.value, []);
  });

  it("store no option of a single choice as an empty one, as pdf.js's widgets read it", async () => {
    // Its annotation layer, printing, and saving take a single choice's value as a string.
    const { session, storage } = await form();
    const forms = formsOf(session);
    for (const none of [[], false] as const) {
      await forms.setFormValues({ size: "l" });
      await forms.setFormValues({ size: none });
      assert.deepEqual(storage.get("3R"), { value: "" });
      assert.equal((await forms.getFormFields())[2]?.value, "");
    }
  });
});

describe("PdfSession form actions and viewer form listeners", () => {
  it("reads and sets form values on PdfSession without a Viewer, settles initialFormFields on password errors, and notifies content listeners", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const unopened = new PdfSessionController({ url: "/unopened.pdf" });
    assert.deepEqual(await getFormFields(unopened), []);
    assert.deepEqual(await setFormValues(unopened, { author: "x" }), []);

    const storage = new Map<string, unknown>();
    const widget = {
      id: "1R",
      annotationType: 20,
      fieldName: "author",
      fieldType: "Tx",
      fieldValue: "Initial",
      rect: [0, 0, 100, 20],
    };
    let fieldReads = 0;
    const objects = new Map([["author", [{ page: 0 }]]]);
    const doc = fakeDocument({
      pages: [LETTER],
      proxy: {
        getFieldObjects: async () => {
          fieldReads++;
          return objects;
        },
        getPage: async () => ({
          view: [0, 0, LETTER.width, LETTER.height],
          rotate: 0,
          userUnit: 1,
          getViewport: () => ({
            width: LETTER.width,
            height: LETTER.height,
            convertToViewportPoint: (x: number, y: number) => [x, LETTER.height - y],
          }),
          getAnnotations: async () => [widget],
        }),
        annotationStorage: {
          get size() {
            return storage.size;
          },
          print: { printing: true },
          getRawValue: (id: string) => storage.get(id),
          setValue: (id: string, value: unknown) => storage.set(id, value),
        },
      },
    });
    const loader = fakePdfjs(async (task, { password: given }) => {
      let password = given;
      while (password !== "secret") {
        const answer = await askPassword(task, password === undefined ? "required" : "incorrect");
        if (answer === null) throw new PasswordException("No password given", 1);
        password = answer;
      }
      return doc.proxy;
    }).loader;

    const session = new PdfSessionController(
      { url: "/locked-form.pdf" },
      { passwordPrompt: false, pdfjs: loader },
    );
    const disconnect = session.connect();
    t.after(async () => {
      disconnect();
      t.mock.timers.tick(1000);
      await settle();
    });

    // Settles empty while locked without reading fields, then reads once after unlocking.
    const lockedInitial = initialFormFields(session);
    assert.deepEqual(await lockedInitial, []);
    assert.equal(initialFormFields(session), lockedInitial);
    assert.equal(fieldReads, 0);

    session.submitPassword("secret");
    await settle();
    const unlockedInitial = initialFormFields(session);
    assert.notEqual(unlockedInitial, lockedInitial);
    assert.equal((await unlockedInitial)[0]?.value, "Initial");
    assert.equal(fieldReads, 1);
    assert.equal(initialFormFields(session), unlockedInitial);

    assert.deepEqual(await setFormValues(session, { author: "Updated" }), ["author"]);
    assert.equal((await getFormFields(session))[0]?.value, "Updated");

    const openDoc = session.openDocument();
    assert.ok(openDoc);
    let notifications = 0;
    const stop = new AbortController();
    openDoc.onContentChange(() => notifications++, stop.signal);
    await setFormValues(session, { author: "Again" });
    assert.equal(notifications, 1);
    stop.abort();
  });

  it("tracks viewer form change subscriptions and delivers changes only to active listeners", () => {
    const viewer = new ViewerController();
    assert.equal(hasViewerFormListeners(viewer), false);
    notifyViewerFormChange(viewer, { name: "city", value: "Ignored" });

    const heardA: FormChange[] = [];
    const heardB: FormChange[] = [];
    let unsubA = () => {};
    unsubA = onViewerFormChange(viewer, (change) => {
      heardA.push(change);
      unsubA();
    });
    const unsubB = onViewerFormChange(viewer, (change) => heardB.push(change));
    assert.equal(hasViewerFormListeners(viewer), true);

    notifyViewerFormChange(viewer, { name: "city", value: "Tokyo" });
    assert.deepEqual(heardA, [{ name: "city", value: "Tokyo" }]);
    assert.deepEqual(heardB, [{ name: "city", value: "Tokyo" }]);
    assert.equal(hasViewerFormListeners(viewer), true);

    unsubB();
    assert.equal(hasViewerFormListeners(viewer), false);
    notifyViewerFormChange(viewer, { name: "city", value: "Osaka" });
    assert.equal(heardB.length, 1);
    void mock;
  });
});
