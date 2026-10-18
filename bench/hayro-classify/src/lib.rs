//! Page classifier for the ParaPDF hybrid engine.
//!
//! The hybrid engine renders image-only pages (scans) with hayro and every
//! other page with pdf.js. pdf.js's text content cannot tell an invisible OCR
//! text layer from visible text, so this module reads the page itself: it
//! walks the content stream and the form XObjects it draws, without decoding
//! any image, and reports what the page draws. The engine decides from these
//! counts; the walk stops early once a page cannot be image-only.

use hayro_syntax::Pdf;
use hayro_syntax::content::TypedIter;
use hayro_syntax::content::ops::TypedInstruction;
use hayro_syntax::object::dict::keys::{ANNOTS, AP, CONTENTS, F, FORM, IMAGE, MATRIX, RESOURCES, SUBTYPE};
use hayro_syntax::object::{Array, Dict, Name, Stream};
use hayro_syntax::page::{Page, Resources};
use std::borrow::Cow;
use wasm_bindgen::prelude::*;

/// What a page draws, as far as choosing a rendering engine is concerned.
#[derive(Default, Debug, Clone)]
pub struct PageStats {
    /// Text-showing operators in a visible rendering mode.
    pub visible_text: u32,
    /// Text-showing operators in rendering mode 3 (invisible) or 7 (clip
    /// only), the modes OCR text layers use.
    pub invisible_text: u32,
    /// Path construction operators (`m`, `l`, `c`, `v`, `y`, `re`).
    pub path_segments: u32,
    /// Image XObjects and inline images drawn.
    pub images: u32,
    /// Share of the crop box covered by the bounding box of the largest image.
    pub image_coverage: f64,
    /// Shading operators (`sh`); shading patterns count as path fills.
    pub shadings: u32,
    /// Form XObjects entered.
    pub forms: u32,
    /// Visible annotations other than links that carry an appearance stream.
    pub annotations: u32,
    /// Operators visited.
    pub operators: u32,
    /// Whether a limit stopped the walk before the end of the content.
    pub stopped: bool,
}

/// When to stop walking a page that cannot be image-only.
pub struct Limits {
    pub stop_at_visible_text: bool,
    pub max_path_segments: u32,
    pub max_operators: u32,
    /// Encoded content larger than this is not decoded at all. Scans keep
    /// their pixels in image XObjects, so a large content stream means
    /// drawing operators, and decoding it would cost more than the answer is
    /// worth.
    pub max_content_bytes: usize,
}

type Matrix = [f64; 6];

const IDENTITY: Matrix = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
const LINK: &[u8] = b"Link";
/// Deeper nesting is skipped, which also ends self-referencing forms.
const MAX_FORM_DEPTH: u8 = 8;

/// `m` applied first, then `ctm`: the concatenation of the `cm` operator.
fn concat(ctm: &Matrix, m: &Matrix) -> Matrix {
    [
        m[0] * ctm[0] + m[1] * ctm[2],
        m[0] * ctm[1] + m[1] * ctm[3],
        m[2] * ctm[0] + m[3] * ctm[2],
        m[2] * ctm[1] + m[3] * ctm[3],
        m[4] * ctm[0] + m[5] * ctm[2] + ctm[4],
        m[4] * ctm[1] + m[5] * ctm[3] + ctm[5],
    ]
}

struct Walker<'l> {
    limits: &'l Limits,
    stats: PageStats,
    /// Crop box in default user space as `[x0, y0, x1, y1]`.
    crop: [f64; 4],
}

impl Walker<'_> {
    fn stop(&mut self) -> bool {
        self.stats.stopped = true;
        false
    }

    /// An image paints the unit square under the current transformation.
    fn image(&mut self, ctm: &Matrix) {
        self.stats.images += 1;
        let [a, b, c, d, e, f] = *ctm;
        let xs = [e, a + e, c + e, a + c + e];
        let ys = [f, b + f, d + f, b + d + f];
        let min = |values: [f64; 4]| values.into_iter().fold(f64::INFINITY, f64::min);
        let max = |values: [f64; 4]| values.into_iter().fold(f64::NEG_INFINITY, f64::max);
        let [cx0, cy0, cx1, cy1] = self.crop;
        let width = (max(xs).min(cx1) - min(xs).max(cx0)).max(0.0);
        let height = (max(ys).min(cy1) - min(ys).max(cy0)).max(0.0);
        let area = (cx1 - cx0) * (cy1 - cy0);
        if area > 0.0 {
            self.stats.image_coverage = self.stats.image_coverage.max(width * height / area);
        }
    }

    /// Walk one content stream; returns false once a limit stopped the walk.
    fn walk(
        &mut self,
        content: &[u8],
        resources: &Resources<'_>,
        mut ctm: Matrix,
        mut mode: i64,
        depth: u8,
    ) -> bool {
        // The text rendering mode is part of the graphics state, so q/Q save it.
        let mut saved: Vec<(Matrix, i64)> = Vec::new();
        let mut iter = TypedIter::new(content);
        while let Some(op) = iter.next() {
            self.stats.operators += 1;
            if self.stats.operators > self.limits.max_operators {
                return self.stop();
            }
            match op {
                TypedInstruction::SaveState(_) => saved.push((ctm, mode)),
                TypedInstruction::RestoreState(_) => {
                    if let Some((saved_ctm, saved_mode)) = saved.pop() {
                        ctm = saved_ctm;
                        mode = saved_mode;
                    }
                }
                TypedInstruction::Transform(t) => {
                    let m = [
                        t.0.as_f64(),
                        t.1.as_f64(),
                        t.2.as_f64(),
                        t.3.as_f64(),
                        t.4.as_f64(),
                        t.5.as_f64(),
                    ];
                    ctm = concat(&ctm, &m);
                }
                TypedInstruction::TextRenderingMode(m) => mode = m.0.as_i64(),
                TypedInstruction::ShowText(_)
                | TypedInstruction::NextLineAndShowText(_)
                | TypedInstruction::ShowTextWithParameters(_)
                | TypedInstruction::ShowTexts(_) => {
                    if mode == 3 || mode == 7 {
                        self.stats.invisible_text += 1;
                    } else {
                        self.stats.visible_text += 1;
                        if self.limits.stop_at_visible_text {
                            return self.stop();
                        }
                    }
                }
                TypedInstruction::MoveTo(_)
                | TypedInstruction::LineTo(_)
                | TypedInstruction::CubicTo(_)
                | TypedInstruction::CubicStartTo(_)
                | TypedInstruction::CubicEndTo(_)
                | TypedInstruction::RectPath(_) => {
                    self.stats.path_segments += 1;
                    if self.stats.path_segments > self.limits.max_path_segments {
                        return self.stop();
                    }
                }
                TypedInstruction::Shading(_) => self.stats.shadings += 1,
                TypedInstruction::InlineImage(_) => self.image(&ctm),
                TypedInstruction::XObject(x) => {
                    let Some(stream) = resources.get_x_object(x.0) else {
                        continue;
                    };
                    let dict = stream.dict();
                    match dict.get::<Name<'_>>(SUBTYPE).as_deref() {
                        Some(IMAGE) => self.image(&ctm),
                        Some(FORM) if depth < MAX_FORM_DEPTH => {
                            self.stats.forms += 1;
                            let Ok(decoded) = stream.decoded() else {
                                continue;
                            };
                            let matrix = dict.get::<[f64; 6]>(MATRIX).unwrap_or(IDENTITY);
                            let own = dict.get::<Dict<'_>>(RESOURCES).map(Resources::new);
                            let form_ctm = concat(&ctm, &matrix);
                            let form_resources = own.as_ref().unwrap_or(resources);
                            if !self.walk(&decoded, form_resources, form_ctm, mode, depth + 1) {
                                return false;
                            }
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }
        true
    }
}

/// The page's content streams, in order.
fn content_streams<'a>(page: &Page<'a>) -> Vec<Stream<'a>> {
    let raw = page.raw();
    if let Some(stream) = raw.get::<Stream<'a>>(CONTENTS) {
        return vec![stream];
    }
    raw.get::<Array<'a>>(CONTENTS)
        .map(|array| array.iter::<Stream<'a>>().collect())
        .unwrap_or_default()
}

/// Decoded content, without the per-page cache of `Page::page_stream`, so
/// classifying a long document keeps no streams alive.
fn decode_content<'a>(streams: &[Stream<'a>]) -> Option<Cow<'a, [u8]>> {
    if let [stream] = streams {
        return stream.decoded().ok();
    }
    let mut joined = Vec::new();
    for stream in streams {
        if let Ok(decoded) = stream.decoded() {
            joined.extend_from_slice(&decoded);
            // Streams must have at least one whitespace in between.
            joined.push(b' ');
        }
    }
    Some(Cow::Owned(joined))
}

fn count_annotations(page: &Page<'_>) -> u32 {
    let Some(annotations) = page.raw().get::<Array<'_>>(ANNOTS) else {
        return 0;
    };
    let mut count = 0;
    for annotation in annotations.iter::<Dict<'_>>() {
        let hidden = annotation.get::<u32>(F).unwrap_or(0) & 2 != 0;
        let link = annotation.get::<Name<'_>>(SUBTYPE).as_deref() == Some(LINK);
        if !hidden && !link && annotation.contains_key(AP) {
            count += 1;
        }
    }
    count
}

/// Count what `page` draws, stopping early as `limits` allow.
pub fn classify_page(page: &Page<'_>, limits: &Limits) -> PageStats {
    let crop = page.intersected_crop_box();
    let mut walker = Walker {
        limits,
        stats: PageStats::default(),
        crop: [
            crop.x0.min(crop.x1),
            crop.y0.min(crop.y1),
            crop.x0.max(crop.x1),
            crop.y0.max(crop.y1),
        ],
    };
    walker.stats.annotations = count_annotations(page);
    let streams = content_streams(page);
    let encoded: usize = streams.iter().map(|stream| stream.raw_data().len()).sum();
    if encoded > limits.max_content_bytes {
        walker.stats.stopped = true;
    } else if let Some(content) = decode_content(&streams) {
        walker.walk(&content, page.resources(), IDENTITY, 0, 0);
    }
    walker.stats
}

#[wasm_bindgen]
pub struct PageClassifier {
    pdf: Pdf,
}

#[wasm_bindgen]
impl PageClassifier {
    #[wasm_bindgen(constructor)]
    pub fn new(data: Vec<u8>) -> Result<PageClassifier, JsError> {
        let pdf = Pdf::new(data).map_err(|err| JsError::new(&format!("{err:?}")))?;
        Ok(PageClassifier { pdf })
    }

    #[wasm_bindgen(js_name = pageCount)]
    pub fn page_count(&self) -> u32 {
        self.pdf.pages().len() as u32
    }

    /// Classify one page, stopping at the first visible text, after
    /// `max_path_segments` path segments, or before decoding more than
    /// `max_content_bytes` of encoded content. Returns `[visibleText,
    /// invisibleText, pathSegments, images, imageCoverage, shadings, forms,
    /// annotations, operators, stopped]`.
    pub fn classify(
        &self,
        index: u32,
        max_path_segments: u32,
        max_content_bytes: u32,
    ) -> Result<Vec<f64>, JsError> {
        let pages = self.pdf.pages();
        let page = pages
            .get(index as usize)
            .ok_or_else(|| JsError::new("page index out of range"))?;
        let stats = classify_page(
            page,
            &Limits {
                stop_at_visible_text: true,
                max_path_segments,
                max_operators: 1_000_000,
                max_content_bytes: max_content_bytes as usize,
            },
        );
        Ok(vec![
            f64::from(stats.visible_text),
            f64::from(stats.invisible_text),
            f64::from(stats.path_segments),
            f64::from(stats.images),
            stats.image_coverage,
            f64::from(stats.shadings),
            f64::from(stats.forms),
            f64::from(stats.annotations),
            f64::from(stats.operators),
            if stats.stopped { 1.0 } else { 0.0 },
        ])
    }
}
