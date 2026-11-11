use serde::{Deserialize, Serialize};
use tauri::WebviewWindow;

use crate::error::AppError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

#[cfg(target_os = "linux")]
pub fn build_cairo_region(rects: &[Rect]) -> cairo::Region {
    let region = cairo::Region::create();
    for r in rects {
        if r.w > 0 && r.h > 0 {
            let rect = cairo::RectangleInt::new(r.x, r.y, r.w, r.h);
            let _ = region.union_rectangle(&rect);
        }
    }
    region
}

#[tauri::command]
pub fn set_input_region(window: WebviewWindow, rects: Option<Vec<Rect>>) -> Result<(), AppError> {
    #[cfg(target_os = "linux")]
    {
        use gtk::traits::WidgetExt;
        use tauri::Manager;

        let app = window.app_handle().clone();

        app.run_on_main_thread(move || {
            let gtk_window = match window.gtk_window() {
                Ok(w) => w,
                Err(e) => {
                    log::error!("Failed to obtain GTK window for input region: {e}");
                    return;
                }
            };

            if let Some(rect_list) = rects {
                let region = build_cairo_region(&rect_list);
                gtk_window.input_shape_combine_region(Some(&region));
            } else {
                // None restores full window interactive shape
                gtk_window.input_shape_combine_region(None);
            }
        })
        .map_err(|e| AppError::Platform(format!("Failed to run on main thread: {e}")))?;

        Ok(())
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = (window, rects);
        // Windows/macOS safe no-op (Windows native SetWindowRgn planned for F5)
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rect_serialization_roundtrip() {
        let original = Rect {
            x: 100,
            y: 150,
            w: 200,
            h: 300,
        };
        let json = serde_json::to_string(&original).expect("serialize failed");
        assert_eq!(json, r#"{"x":100,"y":150,"w":200,"h":300}"#);

        let parsed: Rect = serde_json::from_str(&json).expect("deserialize failed");
        assert_eq!(parsed, original);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_build_cairo_region_empty() {
        let region = build_cairo_region(&[]);
        assert!(region.is_empty());
        assert_eq!(region.num_rectangles(), 0);
        assert!(!region.contains_point(10, 10));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_build_cairo_region_single() {
        let rects = vec![Rect {
            x: 50,
            y: 50,
            w: 100,
            h: 100,
        }];
        let region = build_cairo_region(&rects);
        assert!(!region.is_empty());
        assert_eq!(region.num_rectangles(), 1);

        // Inside
        assert!(region.contains_point(50, 50));
        assert!(region.contains_point(100, 100));
        assert!(region.contains_point(149, 149));

        // Outside
        assert!(!region.contains_point(49, 50));
        assert!(!region.contains_point(50, 49));
        assert!(!region.contains_point(150, 150));
        assert!(!region.contains_point(0, 0));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_build_cairo_region_union_disjoint() {
        let rects = vec![
            Rect {
                x: 10,
                y: 10,
                w: 20,
                h: 20,
            },
            Rect {
                x: 100,
                y: 100,
                w: 30,
                h: 30,
            },
        ];
        let region = build_cairo_region(&rects);
        assert_eq!(region.num_rectangles(), 2);

        assert!(region.contains_point(15, 15));
        assert!(region.contains_point(110, 110));
        assert!(!region.contains_point(50, 50));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_build_cairo_region_union_overlapping() {
        let rects = vec![
            Rect {
                x: 0,
                y: 0,
                w: 50,
                h: 50,
            },
            Rect {
                x: 25,
                y: 25,
                w: 50,
                h: 50,
            },
        ];
        let region = build_cairo_region(&rects);

        // Cairo decomposes into non-overlapping bands
        assert!(region.contains_point(10, 10));
        assert!(region.contains_point(30, 30));
        assert!(region.contains_point(60, 60));
        assert!(!region.contains_point(80, 80));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_build_cairo_region_ignores_zero_or_negative_dimensions() {
        let rects = vec![
            Rect {
                x: 10,
                y: 10,
                w: 0,
                h: 100,
            },
            Rect {
                x: 20,
                y: 20,
                w: 100,
                h: -5,
            },
            Rect {
                x: 50,
                y: 50,
                w: 50,
                h: 50,
            },
        ];
        let region = build_cairo_region(&rects);
        assert_eq!(region.num_rectangles(), 1);
        assert!(region.contains_point(60, 60));
        assert!(!region.contains_point(15, 15));
    }
}
