//! Bad Cat — a desktop cat that closes your doomscrolling.
//!
//! Three moving parts:
//!   * a transparent, click-through overlay strip along the bottom of
//!     the screen, where the cat lives
//!   * a settings window
//!   * a background thread that watches the foreground window and
//!     decides when the cat should get up
//!
//! The overlay never gets a window handle and never closes anything by
//! itself. It asks, and the Rust side re-verifies before acting.

mod config;
mod rules;
mod win;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{
    menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder,
};

use config::Config;
use win::Snapshot;

const COOLDOWN: Duration = Duration::from_secs(12);
const TRAIL_MAX: usize = 40;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrailEntry {
    pub event: String,
    pub rule: String,
    pub detail: String,
    pub at: String,
}

pub struct Shared {
    cfg: Config,
    dir: PathBuf,
    notes: Vec<String>,
    snooze_until: Option<Instant>,
    cooldown_until: Option<Instant>,
    last: Option<Snapshot>,
    matched: Option<String>,
    remaining: f64,
    trail: Vec<TrailEntry>,
    started: Instant,
}

impl Shared {
    fn snoozing(&self) -> bool {
        self.snooze_until.map(|t| Instant::now() < t).unwrap_or(false)
    }

    fn note(&mut self, event: &str, rule: &str, detail: &str) {
        let secs = self.started.elapsed().as_secs();
        // debug builds narrate to stdout; `cargo run` is then a live log
        #[cfg(debug_assertions)]
        eprintln!("[badcat] {event:<8} {rule:<18} {detail}");
        self.trail.push(TrailEntry {
            event: event.into(),
            rule: rule.into(),
            detail: detail.into(),
            at: format!("+{}:{:02}", secs / 60, secs % 60),
        });
        if self.trail.len() > TRAIL_MAX {
            self.trail.remove(0);
        }
    }
}

pub type State = Arc<Mutex<Shared>>;

/* ------------------------------------------------------------------
   payloads
------------------------------------------------------------------ */

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BustPayload {
    rule_id: String,
    label: String,
    target: Snapshot,
    mode: String,
    countdown: u64,
    /// The offending window's horizontal centre, in the overlay's own
    /// local coordinate space (physical px, already offset by the work
    /// area's origin) — so the cat can walk to beneath the actual
    /// window instead of an arbitrary spot on screen. Absent if the
    /// window rect couldn't be read.
    window_center_x: Option<f64>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StatusPayload {
    watching: bool,
    label: String,
    remaining: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusInfo {
    enabled: bool,
    mode: String,
    snoozing: bool,
    snooze_seconds_left: u64,
    foreground: Option<Snapshot>,
    haystack: String,
    matched: Option<String>,
    remaining: f64,
    notes: Vec<String>,
    trail: Vec<TrailEntry>,
}

/* ------------------------------------------------------------------
   commands
------------------------------------------------------------------ */

#[tauri::command]
fn get_config(state: tauri::State<State>) -> Config {
    state.lock().unwrap().cfg.clone()
}

#[tauri::command]
fn save_config(app: AppHandle, state: tauri::State<State>, cfg: Config) -> Result<(), String> {
    let mut guard = state.lock().unwrap();
    let dir = guard.dir.clone();
    config::save(&dir, &cfg).map_err(|e| e.to_string())?;
    guard.cfg = cfg.clone();
    guard.note("settings", "", "saved");
    drop(guard);

    // the overlay reads cat size/speed straight from the config
    let _ = app.emit("config-changed", cfg);
    Ok(())
}

#[tauri::command]
fn reset_rules(state: tauri::State<State>) -> Vec<config::Rule> {
    let mut guard = state.lock().unwrap();
    guard.cfg.rules = config::default_rules();
    let dir = guard.dir.clone();
    let cfg = guard.cfg.clone();
    let _ = config::save(&dir, &cfg);
    guard.cfg.rules.clone()
}

#[tauri::command]
fn status(state: tauri::State<State>) -> StatusInfo {
    let guard = state.lock().unwrap();
    let snoozing = guard.snoozing();
    StatusInfo {
        enabled: guard.cfg.enabled,
        mode: guard.cfg.mode.clone(),
        snoozing,
        snooze_seconds_left: guard
            .snooze_until
            .map(|t| t.saturating_duration_since(Instant::now()).as_secs())
            .unwrap_or(0),
        haystack: guard.last.as_ref().map(rules::haystack).unwrap_or_default(),
        foreground: guard.last.clone(),
        matched: guard.matched.clone(),
        remaining: guard.remaining,
        notes: guard.notes.clone(),
        trail: guard.trail.clone(),
    }
}

/// The overlay asks for this when its countdown reaches zero.
#[tauri::command]
fn act(state: tauri::State<State>, target: Snapshot) -> win::ActResult {
    let guard = state.lock().unwrap();
    if guard.cfg.mode != "close" {
        return win::ActResult {
            acted: false,
            reason: "nag mode".into(),
        };
    }
    let action = rules::matches(&guard.cfg, &target)
        .map(|r| rules::action_for(r, &target))
        .unwrap_or_else(|| "tab".into());
    drop(guard);

    let result = win::close_target(&target, &action);

    let mut guard = state.lock().unwrap();
    guard.cooldown_until = Some(Instant::now() + COOLDOWN);
    guard.note(
        if result.acted { "closed" } else { "skipped" },
        "",
        &result.reason,
    );
    result
}

#[tauri::command]
fn snooze(state: tauri::State<State>, minutes: Option<u64>) -> u64 {
    let mut guard = state.lock().unwrap();
    let mins = minutes.unwrap_or(guard.cfg.snooze_minutes);
    guard.snooze_until = Some(Instant::now() + Duration::from_secs(mins * 60));
    guard.note("snooze", "", &format!("{mins} min"));
    mins
}

#[tauri::command]
fn cancel_snooze(state: tauri::State<State>) {
    let mut guard = state.lock().unwrap();
    guard.snooze_until = None;
}

/// The overlay is click-through except while the pointer is on the cat.
#[tauri::command]
fn set_interactive(app: AppHandle, on: bool) {
    if let Some(w) = app.get_webview_window("pet") {
        let _ = w.set_ignore_cursor_events(!on);
    }
}

#[tauri::command]
fn open_settings(app: AppHandle) {
    show_settings(&app);
}

#[tauri::command]
fn set_cat_visible(app: AppHandle, visible: bool) {
    if let Some(w) = app.get_webview_window("pet") {
        let _ = if visible { w.show() } else { w.hide() };
    }
}

/// Fires a pretend interception so you can see what the cat does
/// without waiting to be caught.
#[tauri::command]
fn preview_bust(app: AppHandle, state: tauri::State<State>) {
    let guard = state.lock().unwrap();
    let payload = BustPayload {
        rule_id: "preview".into(),
        label: "YouTube Shorts".into(),
        target: Snapshot::default(),
        mode: "nag".into(), // a preview never closes anything
        countdown: guard.cfg.countdown_seconds,
        window_center_x: None,
    };
    drop(guard);
    if let Some(w) = app.get_webview_window("pet") {
        let _ = w.emit("bust", payload);
    }
}

/// Lets the overlay write into the same debug stream as the Rust side.
/// A transparent, always-on-top webview has no devtools you can click
/// into, so without this its console is simply unreachable.
#[tauri::command]
fn jslog(msg: String) {
    #[cfg(debug_assertions)]
    eprintln!("[badcat] overlay  {msg}");
    #[cfg(not(debug_assertions))]
    let _ = msg;
}

#[tauri::command]
fn preview_state(app: AppHandle, name: String) {
    if let Some(w) = app.get_webview_window("pet") {
        let _ = w.emit("preview-state", name);
    }
}

/* ------------------------------------------------------------------
   windows
------------------------------------------------------------------ */

fn work_area() -> (i32, i32, i32, i32) {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::UI::WindowsAndMessaging::{
        SystemParametersInfoW, SPI_GETWORKAREA, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
    };
    let mut rect = RECT::default();
    let ok = unsafe {
        SystemParametersInfoW(
            SPI_GETWORKAREA,
            0,
            Some(&mut rect as *mut RECT as *mut std::ffi::c_void),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        )
    };
    if ok.is_err() {
        return (0, 0, 1920, 1080);
    }
    (
        rect.left,
        rect.top,
        rect.right - rect.left,
        rect.bottom - rect.top,
    )
}

/// Windows will happily give an always-on-top window focus when it is
/// clicked. WS_EX_NOACTIVATE is what stops the cat pulling you out of
/// whatever you were typing in.
#[cfg(windows)]
fn make_non_activating(window: &tauri::WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE,
    };
    if let Ok(handle) = window.hwnd() {
        let hwnd = HWND(handle.0 as *mut std::ffi::c_void);
        unsafe {
            let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style | WS_EX_NOACTIVATE.0 as isize);
        }
    }
}

fn build_overlay(app: &AppHandle) -> tauri::Result<()> {
    // The overlay covers the *entire* work area, not just a bottom strip —
    // dragging the cat upward and letting gravity drop it needs the room.
    // It is click-through everywhere except the cat itself (toggled by
    // set_interactive), so this doesn't intercept clicks meant for
    // whatever is running underneath.
    let (x, y, w, h) = work_area();
    let window = WebviewWindowBuilder::new(app, "pet", WebviewUrl::App("pet.html".into()))
        .title("Bad Cat")
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .focused(false)
        .visible(false)
        .build()?;

    window.set_position(PhysicalPosition::new(x, y))?;
    window.set_size(PhysicalSize::new(w, h))?;
    window.set_ignore_cursor_events(true)?;

    #[cfg(windows)]
    make_non_activating(&window);

    window.show()?;
    Ok(())
}

fn show_settings(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        return;
    }
    let built = WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("settings.html".into()))
        .title("Bad Cat — Settings")
        .inner_size(940.0, 700.0)
        .min_inner_size(720.0, 520.0)
        .resizable(true)
        .build();
    if let Ok(w) = built {
        let _ = w.set_focus();
    }
}

/* ------------------------------------------------------------------
   the watch
------------------------------------------------------------------ */

fn spawn_monitor(app: AppHandle, state: State) {
    std::thread::spawn(move || {
        // UI Automation is COM; this thread owns the apartment.
        #[cfg(windows)]
        unsafe {
            use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }

        let mut reader = win::UrlReader::new();
        let mut match_id = String::new();
        let mut match_since = Instant::now();
        let mut pending = String::new();
        let mut last_hwnd: isize = 0;
        #[allow(unused_mut, unused_assignments)]
        let mut last_seen = String::new();

        loop {
            let (poll_ms, url_ms) = {
                let guard = state.lock().unwrap();
                (guard.cfg.poll_ms.max(250), guard.cfg.url_poll_ms.max(500))
            };

            if let Some(snap) = win::foreground(&mut reader, Duration::from_millis(url_ms)) {
                if snap.hwnd != last_hwnd {
                    last_hwnd = snap.hwnd;
                    pending.clear();
                }

                let mut guard = state.lock().unwrap();
                guard.last = Some(snap.clone());

                let paused = guard.snoozing()
                    || guard
                        .cooldown_until
                        .map(|t| Instant::now() < t)
                        .unwrap_or(false);

                let hit = if paused {
                    None
                } else {
                    rules::matches(&guard.cfg, &snap).cloned()
                };

                #[cfg(debug_assertions)]
                {
                    let key = format!("{}|{}", snap.title, snap.url);
                    if key != last_seen {
                        last_seen = key;
                        eprintln!(
                            "[badcat] front    proc={} url={:?} title={:?}",
                            snap.proc, snap.url, snap.title
                        );
                    }
                }

                match hit {
                    None => {
                        guard.matched = None;
                        guard.remaining = 0.0;
                        match_id.clear();
                        drop(guard);
                        let _ = app.emit_to(
                            "pet",
                            "status",
                            StatusPayload {
                                watching: false,
                                label: String::new(),
                                remaining: 0.0,
                            },
                        );
                    }
                    Some(rule) => {
                        // The clock runs per matched rule, not per window:
                        // switching from a work tab to Reels inside an
                        // already-focused browser has to start the grace
                        // at zero, and swiping to the next reel must not
                        // restart it.
                        let id = format!("{}|{}", rule.id, snap.hwnd);
                        if match_id != id {
                            match_id = id;
                            match_since = Instant::now();
                            guard.note("spotted", &rule.id, &snap.title);
                        }

                        let held = match_since.elapsed().as_secs_f64();
                        let remaining = (rule.grace as f64 - held).max(0.0);
                        guard.matched = Some(rule.label.clone());
                        guard.remaining = remaining;

                        let key = format!("{}|{}|{}", snap.hwnd, snap.title, snap.url);
                        let countdown = guard.cfg.countdown_seconds;
                        let mode = guard.cfg.mode.clone();

                        if remaining > 0.0 {
                            drop(guard);
                            let _ = app.emit_to(
                                "pet",
                                "status",
                                StatusPayload {
                                    watching: true,
                                    label: rule.label.clone(),
                                    remaining,
                                },
                            );
                        } else if pending != key {
                            pending = key;
                            guard.note("caught", &rule.id, &snap.title);
                            drop(guard);

                            // local to the overlay, which sits at the work
                            // area's own origin — see build_overlay()
                            let overlay_x = work_area().0;
                            let window_center_x = win::window_center_x(snap.hwnd)
                                .map(|cx| cx - overlay_x as f64);

                            let sent = app.emit_to(
                                "pet",
                                "bust",
                                BustPayload {
                                    rule_id: rule.id.clone(),
                                    label: rule.label.clone(),
                                    target: snap.clone(),
                                    mode,
                                    countdown,
                                    window_center_x,
                                },
                            );
                            #[cfg(debug_assertions)]
                            eprintln!("[badcat] emit_to(pet, bust) -> {sent:?}");
                        }
                    }
                }
            }

            std::thread::sleep(Duration::from_millis(poll_ms));
        }
    });
}

/* ------------------------------------------------------------------
   tray
------------------------------------------------------------------ */

fn build_tray(app: &AppHandle, state: State) -> tauri::Result<()> {
    let settings = MenuItemBuilder::with_id("settings", "Settings…").build(app)?;
    let enabled = CheckMenuItemBuilder::with_id("enabled", "On patrol")
        .checked(state.lock().unwrap().cfg.enabled)
        .build(app)?;
    let snooze_item = MenuItemBuilder::with_id("snooze", "Snooze").build(app)?;
    let show = MenuItemBuilder::with_id("show", "Show / hide the cat").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

    let menu = MenuBuilder::new(app)
        .items(&[&settings])
        .separator()
        .items(&[&enabled, &snooze_item, &show])
        .separator()
        .items(&[&quit])
        .build()?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::WebviewNotFound)?;

    let handle = app.clone();
    TrayIconBuilder::with_id("tray")
        .icon(icon)
        .tooltip("Bad Cat")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| {
            let state = app.state::<State>();
            match event.id().as_ref() {
                "settings" => show_settings(app),
                "enabled" => {
                    let mut guard = state.lock().unwrap();
                    guard.cfg.enabled = !guard.cfg.enabled;
                    let dir = guard.dir.clone();
                    let cfg = guard.cfg.clone();
                    let _ = config::save(&dir, &cfg);
                }
                "snooze" => {
                    let mut guard = state.lock().unwrap();
                    let mins = guard.cfg.snooze_minutes;
                    guard.snooze_until = Some(Instant::now() + Duration::from_secs(mins * 60));
                }
                "show" => {
                    if let Some(w) = app.get_webview_window("pet") {
                        let visible = w.is_visible().unwrap_or(true);
                        let _ = if visible { w.hide() } else { w.show() };
                    }
                }
                "quit" => app.exit(0),
                _ => {}
            }
        })
        .on_tray_icon_event(move |_tray, event| {
            if let tauri::tray::TrayIconEvent::DoubleClick { .. } = event {
                show_settings(&handle);
            }
        })
        .build(app)?;

    Ok(())
}

/* ------------------------------------------------------------------
   entry
------------------------------------------------------------------ */

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();

            let dir = handle
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            // check before loading: load() writes the defaults out on
            // first run, so asking afterwards always says "not first run"
            let first_run = !config::config_path(&dir).exists();
            let (cfg, notes) = config::load(&dir);
            #[cfg(debug_assertions)]
            eprintln!(
                "[badcat] config {} - {} rule(s), mode {}, enabled {}{}",
                config::config_path(&dir).display(),
                cfg.rules.len(),
                cfg.mode,
                cfg.enabled,
                if notes.is_empty() { String::new() } else { format!(" - {}", notes.join("; ")) }
            );

            let state: State = Arc::new(Mutex::new(Shared {
                cfg,
                dir,
                notes,
                snooze_until: None,
                cooldown_until: None,
                last: None,
                matched: None,
                remaining: 0.0,
                trail: Vec::new(),
                started: Instant::now(),
            }));
            app.manage(state.clone());

            build_overlay(&handle)?;
            build_tray(&handle, state.clone())?;
            spawn_monitor(handle.clone(), state);

            // first run has nothing configured yet; --settings forces it
            if first_run || std::env::args().any(|a| a == "--settings") {
                show_settings(&handle);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            reset_rules,
            status,
            act,
            snooze,
            cancel_snooze,
            set_interactive,
            open_settings,
            set_cat_visible,
            preview_bust,
            preview_state,
            jslog
        ])
        .build(tauri::generate_context!())
        .expect("error building Bad Cat")
        .run(|_app, event| {
            // a tray app outlives its windows
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                api.prevent_exit();
            }
        });
}
