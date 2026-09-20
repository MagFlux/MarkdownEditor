// Hide the console window on Windows release builds. Without this the
// bundled exe spawns a console that must stay open (closing it kills the app).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "linux")]
mod keymap;

fn main() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());

    // Legacy-keysym fix (Linux only): X maps Shift+Tab to GDK_KEY_ISO_Left_Tab,
    // which WebKitGTK forwards to the DOM as key "Unidentified" (not "Tab"), so
    // the editor's Shift+Tab outdent never ran and GTK's focus traversal
    // escaped the editor. keymap.rs rewrites that keysym to Tab(+Shift) before
    // the webview sees it. Needs the webview handle, hence setup().
    #[cfg(target_os = "linux")]
    let builder = builder.setup(|app| {
        keymap::install(app.handle());
        Ok(())
    });

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
