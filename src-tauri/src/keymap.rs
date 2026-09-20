//! Tab-normalization for the WebKitGTK shell (Linux release code, kept!)
//!
//! Mechanism discovered with the [TABDBG] diagnostics (see main.rs history):
//! on Linux the X keyboard mapping reports Shift+Tab with the LEGACY keysym
//! GDK_KEY_ISO_Left_Tab (0xfe20), which WebKitGTK forwards to the DOM as
//! `KeyboardEvent.key = "Unidentified"` instead of `"Tab"`. The editor's
//! Shift+Tab outdent therefore never runs and no `preventDefault()` happens,
//! so GTK's window-level focus-traversal binding ("Tab"/"Tab"+Shift →
//! move-focus) escapes the editor to another GUI control. Chromium and the
//! playwright webkit build both report `"Tab"`, which is why the bug is only
//! reproducible inside the real Tauri/GTK shell.
//!
//! The fix allocates a copy of every incoming ISO_Left_Tab key press with the
//! keysym rewritten to GDK_KEY_Tab (Shift flag kept in the state mask) and
//! delivers it DIRECTLY to the WebKit widget, then inhibits the original —
//! WebKit now translates a normal Tab+Shift event, the DOM gets
//! `key: "Tab"` (+ shiftKey) and the editor's JS-window-capture handler
//! outdents and prevents default. No traversal ever sees the key.
//!
//! When the X keyboard map someday stops emitting ISO_Left_Tab this handler
//! becomes a harmless no-op.

/// GDK_KEY_ISO_Left_Tab — legacy Shift+Tab keysym (0xfe20).
const GDK_KEY_ISO_LEFT_TAB: u32 = 0xFE20;
/// GDK_KEY_Tab (0xff09).
const GDK_KEY_TAB: u32 = 0xFF09;
/// GDK_KEY_PRESS.

/// Installs the GTK-level normalization on the app's webviews. Call once from
/// `setup` (main.rs) — only meaningful on Linux where the tao/WebKitGTK stack
/// lives; a no-op elsewhere.
pub fn install(app: &tauri::AppHandle) {
    use gtk::gdk::ffi;
    use gtk::glib::translate::IntoGlib as _;
    use gtk::prelude::*;
    use tauri::Manager;

    if let Some(win) = app.get_webview_window("main") {
        let _ = win.with_webview(move |pw| {
            let wk = pw.inner();
            wk.connect_key_press_event(move |wk, ev| {
                let keyval: u32 = ev.keyval().into_glib();
                if keyval != GDK_KEY_ISO_LEFT_TAB {
                    return gtk::glib::Propagation::Proceed;
                }
                // Build the Tab replacement event from the original so all
                // common fields (window/time/hardware keycode/group) match.
                let mut rep = gtk::gdk::Event::new(gtk::gdk::EventType::KeyPress);
                unsafe {
                    let dst = rep.as_mut() as *mut ffi::GdkEventAny as *mut ffi::GdkEventKey;
                    let src = ev.as_ref();
                    (*dst).type_ = ffi::GDK_KEY_PRESS;
                    (*dst).window = src.window; // borrowed ref, lifetime managed by GTK
                    (*dst).send_event = src.send_event;
                    (*dst).time = src.time;
                    (*dst).state = src.state; // SHIFT_MASK still set
                    (*dst).keyval = GDK_KEY_TAB as u32;
                    (*dst).length = 0;
                    (*dst).string = std::ptr::null_mut();
                    (*dst).hardware_keycode = src.hardware_keycode;
                    (*dst).group = src.group;
                }
                // Deliver the rewritten Tab event straight to the webview (no
                // up-propagation, so the window's own Tab traversal binding
                // cannot see it).
                                let _ = wk.upcast_ref::<gtk::Widget>().event(&rep);
                // Swallow the ORIGINAL keysym: WebKit must never see it
                // (it reports DOM "Unidentified") and the window must not
                // run its move-focus traversal for it.
                gtk::glib::Propagation::Stop
            });
        });
    }
}
