//! Minimal hayro bindings for the engine benchmark and the demo's hybrid
//! engine.
//!
//! The document and its render cache live for the whole benchmark job, so the
//! cache can reuse parsed fonts across pages the way pdf.js and PDFium do.
//! hayro decodes a page's images again on every render, so the hybrid engine
//! renders an image-only page once at full resolution and takes its
//! low-resolution layer from `RenderedPage::reduce`.

use hayro::hayro_interpret::InterpreterSettings;
use hayro::hayro_syntax::Pdf;
use hayro::vello_cpu::color::palette::css::WHITE;
use hayro::vello_cpu::peniko::ImageAlphaType;
use hayro::{PixmapSettings, RenderCache, RenderSettings, render};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct HayroDocument {
    // Leaked so the cache can borrow it for 'static. Each benchmark job runs in
    // a fresh page, so the allocation is reclaimed with the page.
    pdf: &'static Pdf,
    cache: RenderCache<'static>,
    settings: InterpreterSettings,
}

#[wasm_bindgen]
pub struct RenderedPage {
    width: u32,
    height: u32,
    pixels: Vec<u8>,
}

#[wasm_bindgen]
impl RenderedPage {
    #[wasm_bindgen(getter)]
    pub fn width(&self) -> u32 {
        self.width
    }

    #[wasm_bindgen(getter)]
    pub fn height(&self) -> u32 {
        self.height
    }

    /// Move the RGBA8 pixels out; the browser copies them into JS memory once.
    pub fn take_pixels(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.pixels)
    }

    /// Where the RGBA8 pixels start in the module's memory. A view built from
    /// it is valid until this page is freed or the memory grows, so the
    /// browser can copy the pixels straight into an `ImageBitmap`.
    #[wasm_bindgen(js_name = pixelsPtr)]
    pub fn pixels_ptr(&self) -> usize {
        self.pixels.as_ptr() as usize
    }

    /// A copy at `1 / factor` of the size, `floor(width / factor)` ×
    /// `floor(height / factor)` pixels, where each pixel is the mean of a
    /// `factor` × `factor` block. Rows and columns at the right and bottom
    /// edges that do not fill a block are dropped.
    pub fn reduce(&self, factor: u32) -> Vec<u8> {
        reduce_blocks(
            &self.pixels,
            self.width as usize,
            self.height as usize,
            factor.clamp(1, 255) as usize,
        )
    }
}

/// Box filter over RGBA8 rows: sums `factor` rows column by column, a loop
/// that vectorizes, then sums `factor` pixels of the column sums.
fn reduce_blocks(src: &[u8], width: usize, height: usize, factor: usize) -> Vec<u8> {
    let (out_width, out_height) = (width / factor, height / factor);
    let mut out = Vec::with_capacity(out_width * out_height * 4);
    let row_len = width * 4;
    if src.len() < row_len * height {
        return out;
    }
    let used = out_width * factor * 4;
    // Divide by the block's area with a multiply: sums stay below 255 * area,
    // so `sum * reciprocal` fits in 32 bits.
    let reciprocal = (1u32 << 24) / (factor * factor) as u32;
    let mut column_sums = vec![0u16; used];
    for rows in src.chunks_exact(row_len * factor).take(out_height) {
        column_sums.fill(0);
        for row in rows.chunks_exact(row_len) {
            for (sum, &value) in column_sums.iter_mut().zip(&row[..used]) {
                *sum += u16::from(value);
            }
        }
        for block in column_sums.chunks_exact(factor * 4) {
            let mut pixel = [0u32; 4];
            for values in block.chunks_exact(4) {
                pixel[0] += u32::from(values[0]);
                pixel[1] += u32::from(values[1]);
                pixel[2] += u32::from(values[2]);
                pixel[3] += u32::from(values[3]);
            }
            out.extend(pixel.map(|sum| ((sum * reciprocal + (1 << 23)) >> 24) as u8));
        }
    }
    out
}

#[wasm_bindgen]
impl HayroDocument {
    #[wasm_bindgen(constructor)]
    pub fn new(data: Vec<u8>) -> Result<HayroDocument, JsError> {
        let pdf = Pdf::new(data).map_err(|err| JsError::new(&format!("{err:?}")))?;
        let pdf: &'static Pdf = Box::leak(Box::new(pdf));
        Ok(HayroDocument {
            pdf,
            cache: RenderCache::new(),
            settings: InterpreterSettings::default(),
        })
    }

    #[wasm_bindgen(js_name = pageCount)]
    pub fn page_count(&self) -> u32 {
        self.pdf.pages().len() as u32
    }

    /// Return the rotation-resolved page size in points as `[width, height]`.
    #[wasm_bindgen(js_name = pageSize)]
    pub fn page_size(&self, index: u32) -> Result<Vec<f32>, JsError> {
        let pages = self.pdf.pages();
        let page = pages
            .get(index as usize)
            .ok_or_else(|| JsError::new("page index out of range"))?;
        let (width, height) = page.render_dimensions();
        Ok(vec![width, height])
    }

    /// Render one page on an opaque white background.
    ///
    /// With an opaque background the premultiplied buffer equals straight
    /// alpha, so no conversion pass is needed.
    pub fn render(&self, index: u32, scale: f32) -> Result<RenderedPage, JsError> {
        let pages = self.pdf.pages();
        let page = pages
            .get(index as usize)
            .ok_or_else(|| JsError::new("page index out of range"))?;
        let pixmap = render(
            page,
            &self.cache,
            &self.settings,
            &RenderSettings::default(),
            &PixmapSettings {
                x_scale: scale,
                y_scale: scale,
                bg_color: WHITE,
            },
        );
        let (width, height) = (u32::from(pixmap.width()), u32::from(pixmap.height()));
        Ok(RenderedPage {
            width,
            height,
            pixels: pixmap.take_rgba8(ImageAlphaType::AlphaPremultiplied),
        })
    }
}
