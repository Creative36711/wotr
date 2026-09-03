//! Score-screen winner detection for BFME battles.
//!
//! Rust port of the Python `match_result_detector` prototype:
//! - normalized cross-correlation template matching (coarse-to-fine pyramid),
//! - victory coin / defeat flame icon search inside the timeline chart,
//! - per-player highlighted line tracing with known player colors,
//! - winning team (good/evil) resolution.
//!
//! All geometry is expressed in window fractions measured at the 1920x1080
//! reference resolution, exactly like the Python DetectorConfig.

#![allow(clippy::too_many_arguments)]

use std::time::Duration;

mod templates {
    include!("assets_gen/templates.rs");
}

pub const REFERENCE_WIDTH: f64 = 1920.0;
pub const REFERENCE_HEIGHT: f64 = 1080.0;

pub const FORTRESS_ROI: (f64, f64, f64, f64) = (220.0 / 1920.0, 840.0 / 1080.0, 420.0 / 1920.0, 900.0 / 1080.0);
pub const SCORE_MARKER_ROI: (f64, f64, f64, f64) = (1250.0 / 1920.0, 0.0, 1800.0 / 1920.0, 220.0 / 1080.0);
pub const CHART_ROI: (f64, f64, f64, f64) = (190.0 / 1920.0, 240.0 / 1080.0, 1310.0 / 1920.0, 815.0 / 1080.0);
pub const ICON_FALLBACK_ROI: (f64, f64, f64, f64) = (150.0 / 1920.0, 200.0 / 1080.0, 1310.0 / 1920.0, 835.0 / 1080.0);
pub const SCORE_TAB_ROI: (f64, f64, f64, f64) = (845.0 / 1920.0, 150.0 / 1080.0, 1010.0 / 1920.0, 195.0 / 1080.0);
pub const SKIP_BUTTON_FRAC: (f64, f64) = (0.9109, 0.9583);

pub const FORTRESS_THRESHOLD: f64 = 0.85;
pub const SCORE_MARKER_THRESHOLD: f64 = 0.50;
pub const ICON_THRESHOLD: f64 = 0.72;
pub const ICON_NMS_DISTANCE: f64 = 18.0;
pub const COLOR_TOLERANCE: f64 = 45.0;
const SAT_THRESHOLD: i32 = 25;
const COARSE_FACTOR: usize = 4;

pub fn scale_for(width: usize, height: usize) -> f64 {
    if width == 0 || height == 0 {
        return 1.0;
    }
    (width as f64 / REFERENCE_WIDTH).min(height as f64 / REFERENCE_HEIGHT)
}

pub fn roi_pixels(roi: (f64, f64, f64, f64), width: usize, height: usize) -> (usize, usize, usize, usize) {
    let x0 = ((roi.0 * width as f64) as usize).min(width.saturating_sub(1));
    let y0 = ((roi.1 * height as f64) as usize).min(height.saturating_sub(1));
    let x1 = ((roi.2 * width as f64) as usize).min(width).max(x0 + 1);
    let y1 = ((roi.3 * height as f64) as usize).min(height).max(y0 + 1);
    (x0, y0, x1, y1)
}

// ---------------------------------------------------------------------------
// Frame + template primitives
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct RgbFrame {
    pub width: usize,
    pub height: usize,
    /// Interleaved RGB, row-major.
    pub data: Vec<u8>,
}

impl RgbFrame {
    pub fn is_black(&self) -> bool {
        if self.data.is_empty() {
            return true;
        }
        let mut total: u64 = 0;
        let mut bright: u64 = 0;
        let count = self.width * self.height;
        for px in self.data.chunks_exact(3) {
            let luma = (px[0] as u32 + px[1] as u32 + px[2] as u32) / 3;
            total += luma as u64;
            if px.iter().any(|c| *c > 60) {
                bright += 1;
            }
        }
        let mean = total as f64 / count as f64;
        if mean < 6.0 {
            return true;
        }
        mean < 20.0 && (bright as f64 / count as f64) < 0.0005
    }
}

#[derive(Clone)]
pub struct Template {
    pub width: usize,
    pub height: usize,
    pub data: Vec<u8>,
}

impl Template {
    fn from_hex(hex: &str, width: usize, height: usize) -> Self {
        let mut data = Vec::with_capacity(width * height * 3);
        for index in 0..width * height {
            let offset = index * 6;
            data.push(u8::from_str_radix(&hex[offset..offset + 2], 16).unwrap_or(0));
            data.push(u8::from_str_radix(&hex[offset + 2..offset + 4], 16).unwrap_or(0));
            data.push(u8::from_str_radix(&hex[offset + 4..offset + 6], 16).unwrap_or(0));
        }
        Template { width, height, data }
    }

    pub fn scaled(&self, scale: f64) -> Template {
        let width = ((self.width as f64 * scale).round() as usize).max(4);
        let height = ((self.height as f64 * scale).round() as usize).max(4);
        if width == self.width && height == self.height {
            return self.clone();
        }
        let mut data = Vec::with_capacity(width * height * 3);
        for y in 0..height {
            let source_y = (y * self.height) / height;
            for x in 0..width {
                let source_x = (x * self.width) / width;
                let offset = (source_y * self.width + source_x) * 3;
                data.extend_from_slice(&self.data[offset..offset + 3]);
            }
        }
        Template { width, height, data }
    }
}

pub fn fortress_template() -> Template {
    Template::from_hex(templates::FORTRESS_ICON_RGB_HEX, templates::FORTRESS_ICON_W, templates::FORTRESS_ICON_H)
}
pub fn score_marker_template() -> Template {
    Template::from_hex(templates::SCORE_MARKER_RGB_HEX, templates::SCORE_MARKER_W, templates::SCORE_MARKER_H)
}
pub fn victory_template() -> Template {
    Template::from_hex(templates::VICTORY_COIN_RGB_HEX, templates::VICTORY_COIN_W, templates::VICTORY_COIN_H)
}
pub fn defeat_template() -> Template {
    Template::from_hex(templates::DEFEAT_FLAME_RGB_HEX, templates::DEFEAT_FLAME_W, templates::DEFEAT_FLAME_H)
}

fn downsample(frame: &RgbFrame, factor: usize) -> RgbFrame {
    if factor <= 1 {
        return frame.clone();
    }
    let width = frame.width / factor;
    let height = frame.height / factor;
    let mut data = vec![0u8; width * height * 3];
    for y in 0..height {
        for x in 0..width {
            let mut sums = [0u32; 3];
            for dy in 0..factor {
                for dx in 0..factor {
                    let offset = ((y * factor + dy) * frame.width + (x * factor + dx)) * 3;
                    for channel in 0..3 {
                        sums[channel] += frame.data[offset + channel] as u32;
                    }
                }
            }
            let target = (y * width + x) * 3;
            for channel in 0..3 {
                data[target + channel] = (sums[channel] / (factor * factor) as u32) as u8;
            }
        }
    }
    RgbFrame { width, height, data }
}

/// One NCC evaluation of `template` at top-left (offset_x, offset_y) of the frame.
fn ncc_at(frame: &RgbFrame, template: &Template, offset_x: usize, offset_y: usize) -> f64 {
    let n = (template.width * template.height) as f64;
    let mut numerator = 0.0f64;
    let mut template_var = 0.0f64;
    let mut image_var = 0.0f64;
    for channel in 0..3 {
        let mut t_sum = 0.0f64;
        let mut t_sq = 0.0f64;
        for ty in 0..template.height {
            let row = (ty * template.width) * 3 + channel;
            for tx in 0..template.width {
                let value = f64::from(template.data[row + tx * 3]);
                t_sum += value;
                t_sq += value * value;
            }
        }
        let t_mean = t_sum / n;
        let t_var = t_sq - t_mean * t_mean * n;
        template_var += t_var;
        let mut i_sum = 0.0f64;
        let mut i_sq = 0.0f64;
        let mut corr = 0.0f64;
        for ty in 0..template.height {
            let t_row = (ty * template.width) * 3 + channel;
            let i_row = ((offset_y + ty) * frame.width + offset_x) * 3 + channel;
            for tx in 0..template.width {
                let t_value = f64::from(template.data[t_row + tx * 3]);
                let i_value = f64::from(frame.data[i_row + tx * 3]);
                i_sum += i_value;
                i_sq += i_value * i_value;
                corr += i_value * (t_value - t_mean);
            }
        }
        numerator += corr;
        image_var += (i_sq - i_sum * i_sum / n).max(0.0);
    }
    let denominator = (template_var * image_var).sqrt();
    if denominator > 1e-9 {
        numerator / denominator
    } else {
        0.0
    }
}

fn direct_hits(frame: &RgbFrame, template: &Template, threshold: f64) -> Vec<(usize, usize, f64)> {
    if frame.width < template.width || frame.height < template.height {
        return Vec::new();
    }
    let mut hits = Vec::new();
    for y in 0..=(frame.height - template.height) {
        for x in 0..=(frame.width - template.width) {
            let score = ncc_at(frame, template, x, y);
            if score >= threshold {
                hits.push((x, y, score));
            }
        }
    }
    hits
}

pub struct TemplateHit {
    pub x: f64,
    pub y: f64,
    pub score: f64,
}

/// Find template matches (window centers, absolute frame coordinates) inside a ROI.
/// Large templates go through a 4x pyramid pass with local full-res refinement.
pub fn find_template(
    frame: &RgbFrame,
    template: &Template,
    roi: (usize, usize, usize, usize),
    threshold: f64,
    nms_distance: f64,
) -> Vec<TemplateHit> {
    let (x0, y0, x1, y1) = (roi.0.min(frame.width), roi.1.min(frame.height), roi.2.min(frame.width), roi.3.min(frame.height));
    if x1 <= x0 || y1 <= y0 || x1 - x0 < template.width || y1 - y0 < template.height {
        return Vec::new();
    }
    // Crop ROI into its own frame for coordinate clarity.
    let mut region = RgbFrame { width: x1 - x0, height: y1 - y0, data: Vec::with_capacity((x1 - x0) * (y1 - y0) * 3) };
    for y in y0..y1 {
        let start = y * frame.width * 3 + x0 * 3;
        region.data.extend_from_slice(&frame.data[start..start + region.width * 3]);
    }

    let small_template = template.width * template.height <= 6400;
    let mut corners: Vec<(usize, usize, f64)> = Vec::new();
    if small_template {
        corners = direct_hits(&region, template, threshold);
    } else {
        // Coarse pass at 1/COARSE_FACTOR with a slightly relaxed threshold.
        let coarse = downsample(&region, COARSE_FACTOR);
        let coarse_template = Template::scaled(template, 1.0 / COARSE_FACTOR as f64);
        let coarse_threshold = threshold * 0.92;
        for (cx, cy, _score) in direct_hits(&coarse, &coarse_template, coarse_threshold) {
            let base_x = cx * COARSE_FACTOR;
            let base_y = cy * COARSE_FACTOR;
            for dy in 0..=COARSE_FACTOR {
                for dx in 0..=COARSE_FACTOR {
                    let x = base_x.saturating_sub(1) + dx;
                    let y = base_y.saturating_sub(1) + dy;
                    if x + template.width > region.width || y + template.height > region.height {
                        continue;
                    }
                    let score = ncc_at(&region, template, x, y);
                    if score >= threshold {
                        corners.push((x, y, score));
                    }
                }
            }
        }
    }
    if corners.is_empty() {
        return Vec::new();
    }
    // NMS: centers, keep best first.
    corners.sort_by(|left, right| right.2.partial_cmp(&left.2).unwrap_or(std::cmp::Ordering::Equal));
    let mut kept: Vec<TemplateHit> = Vec::new();
    for (x, y, score) in corners {
        let center_x = x as f64 + template.width as f64 / 2.0;
        let center_y = y as f64 + template.height as f64 / 2.0;
        if kept.iter().all(|hit| {
            let dx = hit.x - center_x;
            let dy = hit.y - center_y;
            dx * dx + dy * dy >= nms_distance * nms_distance
        }) {
            kept.push(TemplateHit { x: center_x + x0 as f64, y: center_y + y0 as f64, score });
        }
    }
    kept
}

/// Both screen templates (fortress legend icon + score header marker) must match.
pub fn is_score_screen(frame: &RgbFrame, fortress: &Template, marker: &Template) -> bool {
    let scale = scale_for(frame.width, frame.height);
    let fortress_hits = find_template(frame, &fortress.scaled(scale), roi_pixels(FORTRESS_ROI, frame.width, frame.height), FORTRESS_THRESHOLD, 20.0);
    if fortress_hits.is_empty() {
        return false;
    }
    let marker_hits = find_template(frame, &marker.scaled(scale), roi_pixels(SCORE_MARKER_ROI, frame.width, frame.height), SCORE_MARKER_THRESHOLD, 100.0);
    !marker_hits.is_empty()
}

// ---------------------------------------------------------------------------
// Player line tracing (chart colors)
// ---------------------------------------------------------------------------

fn color_refs(color: &str, vivid: bool) -> &'static [(u8, u8, u8)] {
    match (color, vivid) {
        ("blue", false) => &[(78, 90, 132), (50, 60, 92), (46, 55, 85)],
        ("blue", true) => &[(95, 112, 162), (110, 130, 180)],
        ("green", false) => &[(45, 68, 57), (42, 70, 56), (40, 68, 54)],
        ("green", true) => &[(56, 84, 70), (70, 100, 84)],
        ("yellow", false) => &[(88, 93, 64), (52, 54, 27), (85, 88, 60), (59, 64, 36)],
        ("yellow", true) => &[(192, 142, 93), (170, 151, 83)],
        ("white", false) => &[(127, 124, 122), (170, 170, 170), (85, 85, 85)],
        ("white", true) => &[(200, 200, 200), (230, 230, 230)],
        ("red", false) => &[(60, 33, 31), (76, 46, 42), (59, 35, 33)],
        ("red", true) => &[(141, 73, 60), (160, 80, 66)],
        ("orange", false) => &[(87, 69, 52), (63, 52, 38), (80, 69, 58)],
        ("orange", true) => &[(192, 142, 93), (185, 130, 89)],
        ("purple", false) => &[(140, 122, 128), (69, 66, 77), (158, 140, 150)],
        ("purple", true) => &[(163, 111, 134), (185, 139, 152)],
        ("light_blue", false) => &[(90, 110, 160), (110, 135, 190), (70, 85, 120)],
        ("light_blue", true) => &[(110, 135, 190), (130, 155, 210)],
        ("pink", false) => &[(160, 120, 140), (180, 140, 160)],
        ("pink", true) => &[(180, 140, 160), (200, 160, 180)],
        ("black", false) => &[(10, 10, 10), (60, 60, 70)],
        ("black", true) => &[(60, 60, 70)],
        _ => &[],
    }
}

/// Port of `find_highlighted_line_endpoint`: right end of the (bright) player line.
pub fn line_endpoint(
    frame: &RgbFrame,
    color: &str,
    icons: &[DetectedIcon],
    bright_only: bool,
) -> Option<(f64, f64)> {
    let mut refs: Vec<(i32, i32, i32)> = Vec::new();
    refs.extend(color_refs(color, false).iter().map(|v| (v.0 as i32, v.1 as i32, v.2 as i32)));
    refs.extend(color_refs(color, true).iter().map(|v| (v.0 as i32, v.1 as i32, v.2 as i32)));
    if refs.is_empty() {
        return None;
    }
    let scale = scale_for(frame.width, frame.height);
    let (x0, y0, x1, y1) = roi_pixels(CHART_ROI, frame.width, frame.height);
    let refs_sat_max = refs.iter().map(|v| v.0.max(v.1).max(v.2) - v.0.min(v.1).min(v.2)).max().unwrap_or(0);
    let tolerance = (COLOR_TOLERANCE * 1.3) as f64;
    let glow_radius = (34.0 * scale) as i32 + 6;
    let head = (18.0 * scale) as usize;

    let mut mask_points: Vec<(usize, usize)> = Vec::new();
    for y in head..(y1 - y0) {
        for x in 0..(x1 - x0) {
            let offset = ((y0 + y) * frame.width + (x0 + x)) * 3;
            let r = i32::from(frame.data[offset]);
            let g = i32::from(frame.data[offset + 1]);
            let b = i32::from(frame.data[offset + 2]);
            let max_c = r.max(g).max(b);
            let min_c = r.min(g).min(b);
            let matched = refs.iter().any(|v| {
                let dr = (r - v.0) as f64;
                let dg = (g - v.1) as f64;
                let db = (b - v.2) as f64;
                (dr * dr + dg * dg + db * db).sqrt() <= tolerance
            });
            if !matched {
                continue;
            }
            if color == "purple" && !(r >= g && b >= g && b - r <= 30) {
                continue;
            }
            if bright_only && max_c < 98 {
                continue;
            }
            if refs_sat_max < 10 {
                if max_c < 80 {
                    continue;
                }
            } else if max_c - min_c < SAT_THRESHOLD {
                continue;
            }
            let mut in_glow = false;
            for icon in icons {
                let dx = x0 as i32 + x as i32 - icon.x as i32;
                let dy = y0 as i32 + y as i32 - icon.y as i32;
                if dx * dx + dy * dy <= glow_radius * glow_radius {
                    in_glow = true;
                    break;
                }
            }
            if in_glow {
                continue;
            }
            mask_points.push((x, y));
        }
    }
    if mask_points.is_empty() {
        return None;
    }

    let y_band = 55.0f64;
    let end_gap = 80.0f64;
    let max_y_dist = 60.0f64;
    let mut best: Option<(f64, f64, f64)> = None;
    for icon in icons {
        let icon_x = icon.x - x0 as f64;
        let icon_y = icon.y - y0 as f64;
        let mut band: Vec<(usize, usize)> = mask_points
            .iter()
            .copied()
            .filter(|&(x, y)| {
                let fy = y as f64;
                let fx = x as f64;
                (fy - icon_y).abs() <= y_band && fx >= icon_x - y_band && fx <= icon_x + 10.0
            })
            .collect();
        if band.is_empty() {
            continue;
        }
        band.sort_by_key(|&(x, _)| x);
        let x_max = band[band.len() - 1].0 as f64;
        if icon_x - x_max > end_gap {
            continue;
        }
        let ys: Vec<f64> = band.iter().map(|&(_, y)| y as f64).collect();
        let mut sorted = ys.clone();
        sorted.sort_by(|l, r| l.partial_cmp(r).unwrap_or(std::cmp::Ordering::Equal));
        let y_median = sorted[sorted.len() / 2];
        let y_dist = (y_median - icon_y).abs();
        if y_dist > max_y_dist {
            continue;
        }
        let score = (end_gap - (icon_x - x_max)) + (max_y_dist - y_dist);
        if best.as_ref().map(|b| score > b.2).unwrap_or(true) {
            let last = band[band.len() - 1];
            best = Some((x0 as f64 + last.0 as f64, y0 as f64 + last.1 as f64, score));
        }
    }
    best.map(|(x, y, _)| (x, y))
}

// ---------------------------------------------------------------------------
// Winner analysis
// ---------------------------------------------------------------------------

pub struct PlayerInfo {
    pub slot: u64,
    pub color: String,
    pub side: String,
}

pub struct DetectedIcon {
    pub kind: &'static str,
    pub x: f64,
    pub y: f64,
    pub score: f64,
}

/// Detect all victory/defeat icons in the chart area (with a wider fallback).
pub fn detect_icons(frame: &RgbFrame) -> Vec<DetectedIcon> {
    let scale = scale_for(frame.width, frame.height);
    let victory = victory_template().scaled(scale);
    let defeat = defeat_template().scaled(scale);
    let nms = ICON_NMS_DISTANCE * scale;
    let scan = |roi| -> Vec<DetectedIcon> {
        let mut found = Vec::new();
        for (kind, template) in [("victory", &victory), ("defeat", &defeat)] {
            for hit in find_template(frame, template, roi, ICON_THRESHOLD, nms) {
                found.push(DetectedIcon { kind, x: hit.x, y: hit.y, score: hit.score });
            }
        }
        found
    };
    let mut icons = scan(roi_pixels(CHART_ROI, frame.width, frame.height));
    if icons.is_empty() {
        icons = scan(roi_pixels(ICON_FALLBACK_ROI, frame.width, frame.height));
    }
    // Deduplicate coin/flame pairs at the same location, keeping the better score.
    icons.sort_by(|l, r| r.score.partial_cmp(&l.score).unwrap_or(std::cmp::Ordering::Equal));
    let mut dedup: Vec<DetectedIcon> = Vec::new();
    for icon in icons {
        if dedup.iter().all(|kept| {
            let dx = kept.x - icon.x;
            let dy = kept.y - icon.y;
            dx * dx + dy * dy > ICON_NMS_DISTANCE * ICON_NMS_DISTANCE
        }) {
            dedup.push(icon);
        }
    }
    dedup
}

