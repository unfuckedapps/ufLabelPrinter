//! Printer models are plain data: one JSON file per model describes which protocol the
//! printer speaks, its resolution, how to recognise it and sensible defaults.
//!
//! Built-in models live in `src-tauri/models/` and are embedded at compile time. Users can
//! add their own without rebuilding by dropping files into `<app config dir>/models/`;
//! a user file with the same `id` replaces the built-in one.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::{protocol, status};

include!(concat!(env!("OUT_DIR"), "/builtin_models.rs"));

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsbId {
    pub vendor_id: u16,
    pub product_id: u16,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelMatch {
    #[serde(default)]
    pub usb: Vec<UsbId>,
    /// Prefixes of the Bluetooth name, Classic (`/dev/cu.<name>`) or LE. Compared without
    /// case, spaces, dashes and underscores, so "D530Pro" also matches "D530 Pro_1A2B".
    #[serde(default)]
    pub bluetooth: Vec<String>,
}

/// Starting values for a new printer profile; the UI owns the full profile.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDefaults {
    pub width_mm: Option<f32>,
    pub height_mm: Option<f32>,
    pub media_type: Option<String>,
    pub gap_mm: Option<f32>,
    pub speed: Option<u8>,
    pub density: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Range {
    pub min: u8,
    pub max: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterModel {
    pub id: String,
    pub vendor: String,
    pub name: String,
    /// Printer language, see [`protocol::get`].
    pub protocol: String,
    /// Status query dialect, see [`status::get`]; `None` if the printer cannot be asked.
    #[serde(default)]
    pub status: Option<String>,
    pub dpi: u32,
    pub max_width_mm: f32,
    #[serde(default, rename = "match")]
    pub matches: ModelMatch,
    #[serde(default)]
    pub defaults: ModelDefaults,
    #[serde(default)]
    pub speeds: Vec<u8>,
    #[serde(default)]
    pub density: Option<Range>,
    #[serde(default)]
    pub notes: Option<String>,
    /// Bitmap compression the printer understands; used over Bluetooth, where the
    /// uncompressed bitmap takes minutes.
    #[serde(default)]
    pub compression: crate::protocol::Compression,
    /// Set for files loaded from the user's model folder.
    #[serde(default, skip_deserializing)]
    pub custom: bool,
}

impl PrinterModel {
    fn parse(source: &str, json: &str) -> Result<Self> {
        let model: PrinterModel = serde_json::from_str(json)
            .map_err(|e| Error::Other(format!("{source}: {e}")))?;
        model.validate().map_err(|e| Error::Other(format!("{source}: {e}")))?;
        Ok(model)
    }

    fn validate(&self) -> std::result::Result<(), String> {
        if self.id.trim().is_empty() {
            return Err("\"id\" must not be empty".into());
        }
        protocol::get(&self.protocol).map_err(|e| e.to_string())?;
        if let Some(dialect) = &self.status {
            status::get(dialect).ok_or_else(|| format!("unknown status dialect \"{dialect}\""))?;
        }
        if !(100..=1200).contains(&self.dpi) {
            return Err(format!("implausible resolution {} dpi", self.dpi));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelRegistry {
    pub models: Vec<PrinterModel>,
    /// Broken user model files, shown in the UI instead of failing silently.
    pub errors: Vec<String>,
}

impl ModelRegistry {
    pub fn load(user_dir: Option<&Path>) -> Self {
        let mut registry = Self::default();
        for (file, json) in BUILTIN_MODELS {
            // Built-in files are covered by a unit test, so this never fires in a release.
            match PrinterModel::parse(file, json) {
                Ok(model) => registry.insert(model),
                Err(err) => registry.errors.push(err.to_string()),
            }
        }

        if let Some(dir) = user_dir {
            registry.load_dir(dir);
        }
        registry
    }

    fn load_dir(&mut self, dir: &Path) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        let mut paths: Vec<_> = entries
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.extension().is_some_and(|ext| ext == "json"))
            .collect();
        paths.sort();

        for path in paths {
            let source = path.display().to_string();
            let parsed = std::fs::read_to_string(&path)
                .map_err(Error::from)
                .and_then(|json| PrinterModel::parse(&source, &json));
            match parsed {
                Ok(mut model) => {
                    model.custom = true;
                    self.insert(model);
                }
                Err(err) => self.errors.push(err.to_string()),
            }
        }
    }

    fn insert(&mut self, model: PrinterModel) {
        self.models.retain(|m| m.id != model.id);
        self.models.push(model);
    }

    pub fn get(&self, id: &str) -> Result<&PrinterModel> {
        self.models
            .iter()
            .find(|m| m.id == id)
            .ok_or_else(|| Error::UnknownModel(id.to_owned()))
    }

    pub fn match_usb(&self, vendor_id: u16, product_id: u16) -> Option<&PrinterModel> {
        self.models.iter().find(|m| {
            m.matches
                .usb
                .iter()
                .any(|u| u.vendor_id == vendor_id && u.product_id == product_id)
        })
    }

    pub fn match_bluetooth(&self, name: &str) -> Option<&PrinterModel> {
        let name = normalize(name);
        self.models.iter().find(|m| {
            m.matches
                .bluetooth
                .iter()
                .any(|prefix| !prefix.is_empty() && name.starts_with(&normalize(prefix)))
        })
    }
}

fn normalize(name: &str) -> String {
    name.chars()
        .filter(|c| !matches!(c, ' ' | '-' | '_'))
        .flat_map(char::to_lowercase)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_models_are_valid() {
        let registry = ModelRegistry::load(None);
        assert!(registry.errors.is_empty(), "{:?}", registry.errors);
        assert!(registry.models.len() >= 4);
    }

    #[test]
    fn recognises_the_known_printers() {
        let registry = ModelRegistry::load(None);
        assert_eq!(registry.match_usb(11836, 22361).unwrap().id, "phomemo-d530-pro");
        assert_eq!(registry.match_bluetooth("D530Pro").unwrap().id, "phomemo-d530-pro");
        assert_eq!(registry.match_bluetooth("Y468BT-4958").unwrap().id, "vevor-y468bt");
        assert_eq!(registry.match_bluetooth("D530 Pro_3A6A").unwrap().id, "phomemo-d530-pro");
        assert!(registry.match_bluetooth("iPhone").is_none());
    }

    #[test]
    fn user_models_override_and_report_errors() {
        let dir = std::env::temp_dir().join(format!("thermalprinter-models-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("custom.json"),
            r#"{"id":"vevor-y468bt","vendor":"Vevor","name":"Y468BT (eigene)","protocol":"tspl","dpi":203,"maxWidthMm":108}"#,
        )
        .unwrap();
        std::fs::write(dir.join("broken.json"), r#"{"id":"x","protocol":"zpl"}"#).unwrap();

        let registry = ModelRegistry::load(Some(&dir));
        std::fs::remove_dir_all(&dir).unwrap();

        let vevor = registry.get("vevor-y468bt").unwrap();
        assert!(vevor.custom);
        assert_eq!(vevor.name, "Y468BT (eigene)");
        assert_eq!(registry.errors.len(), 1);
        assert!(registry.errors[0].contains("broken.json"));
    }
}
