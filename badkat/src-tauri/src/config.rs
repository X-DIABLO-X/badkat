//! Settings, their defaults, and how they reach disk.
//!
//! Everything the settings window can change lives in this one struct,
//! serialised straight to `config.json` in the app's config dir. Field
//! names are camelCase on the wire so the frontend can bind to them
//! without a translation layer.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    pub id: String,
    pub label: String,
    /// every pattern must appear
    #[serde(default)]
    pub all: Vec<String>,
    /// at least one pattern must appear
    #[serde(default)]
    pub any: Vec<String>,
    /// seconds this rule must hold the foreground before the cat acts
    pub grace: u64,
    /// "tab" (Ctrl+W) or "close" (WM_CLOSE)
    #[serde(default = "default_action")]
    pub action: String,
    #[serde(default = "yes")]
    pub enabled: bool,
}

fn default_action() -> String {
    "tab".into()
}
fn yes() -> bool {
    true
}

impl Rule {
    /// A rule with no patterns matches nothing, which on screen is
    /// indistinguishable from the app being broken.
    pub fn is_usable(&self) -> bool {
        !self.id.trim().is_empty() && !(self.all.is_empty() && self.any.is_empty())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatSettings {
    /// px per design unit; the rig is drawn in a 200x150 unit box
    pub scale: f64,
    /// multiplier on the animation and the walk speed together
    pub speed: f64,
    /// wander along the screen edge when idle
    pub wander: bool,
    /// let the cat doze off between wanders
    pub sleepy: bool,
}

impl Default for CatSettings {
    fn default() -> Self {
        Self {
            scale: 1.25,
            speed: 1.0,
            wander: true,
            sleepy: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub enabled: bool,
    /// "close" acts on the window, "nag" only makes the cat cross
    pub mode: String,
    pub countdown_seconds: u64,
    pub snooze_minutes: u64,
    pub poll_ms: u64,
    /// address-bar reads are the expensive part, so they get their own rate
    pub url_poll_ms: u64,
    /// substrings that are never acted on, whatever else matches
    pub never: Vec<String>,
    pub rules: Vec<Rule>,
    #[serde(default)]
    pub cat: CatSettings,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            enabled: true,
            mode: "close".into(),
            countdown_seconds: 3,
            snooze_minutes: 5,
            poll_ms: 1000,
            url_poll_ms: 1500,
            never: vec![
                "zoom meeting".into(),
                "microsoft teams".into(),
                "google meet".into(),
            ],
            rules: default_rules(),
            cat: CatSettings::default(),
        }
    }
}

/// Order matters: the first match wins, so the specific rules
/// (shorts, reels) have to sit above the general ones (youtube,
/// instagram) or the long leash would swallow them.
pub fn default_rules() -> Vec<Rule> {
    let r = |id: &str, label: &str, any: &[&str], grace: u64| Rule {
        id: id.into(),
        label: label.into(),
        all: vec![],
        any: any.iter().map(|s| s.to_string()).collect(),
        grace,
        action: "tab".into(),
        enabled: true,
    };

    vec![
        r("youtube-shorts", "YouTube Shorts", &["youtube.com/shorts"], 6),
        r("instagram-reels", "Instagram Reels", &["instagram.com/reel"], 6),
        r("tiktok", "TikTok", &["tiktok.com"], 6),
        r(
            "facebook-reels",
            "Facebook Reels",
            &["facebook.com/reel", "facebook.com/watch", "fb.watch"],
            10,
        ),
        r("snapchat", "Snapchat", &["snapchat.com"], 15),
        r(
            "streaming",
            "Streaming",
            &[
                "netflix.com",
                "netflix",
                "primevideo.com",
                "prime video",
                "hotstar.com",
                "hotstar",
                "disneyplus.com",
                "disney+",
                "crunchyroll",
                "hulu.com",
                "jiocinema",
                "sonyliv",
                "zee5",
                "aha.video",
                "mxplayer",
                "peacocktv.com",
                "tv.apple.com",
            ],
            20,
        ),
        r("instagram", "Instagram", &["instagram.com"], 45),
        r("reddit", "Reddit", &["reddit.com"], 90),
        // a long leash: plenty of YouTube is work
        r("youtube-watch", "YouTube", &["youtube.com/watch", "- youtube"], 240),
    ]
}

pub fn config_path(dir: &Path) -> PathBuf {
    dir.join("config.json")
}

/// Reads the config, repairing what it can rather than refusing to
/// start. Returns the config plus anything that had to be dropped, so
/// the settings window can say what happened.
pub fn load(dir: &Path) -> (Config, Vec<String>) {
    let path = config_path(dir);
    let mut notes: Vec<String> = Vec::new();

    let raw = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(_) => {
            let cfg = Config::default();
            let _ = save(dir, &cfg);
            return (cfg, notes);
        }
    };

    // Notepad and most Windows editors write UTF-8 with a BOM, and
    // serde_json refuses it. This file exists to be hand-edited.
    let cleaned = raw.trim_start_matches('\u{feff}');

    match serde_json::from_str::<Config>(cleaned) {
        Ok(mut cfg) => {
            let before = cfg.rules.len();
            cfg.rules.retain(|r| r.is_usable());
            if cfg.rules.len() != before {
                notes.push(format!(
                    "{} rule(s) ignored: each needs an id and at least one pattern",
                    before - cfg.rules.len()
                ));
            }
            if cfg.rules.is_empty() {
                cfg.rules = default_rules();
                notes.push("no usable rules left, restored the defaults".into());
            }
            (cfg, notes)
        }
        Err(err) => {
            notes.push(format!("config.json could not be read ({err}), using defaults"));
            (Config::default(), notes)
        }
    }
}

pub fn save(dir: &Path, cfg: &Config) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let text = serde_json::to_string_pretty(cfg).unwrap_or_else(|_| "{}".into());
    std::fs::write(config_path(dir), text)
}
