use std::{env, fs, path::Path};

/// Embeds every `models/*.json` so adding a printer model is a matter of dropping in a file.
fn embed_models() {
    println!("cargo:rerun-if-changed=models");
    let dir = Path::new(&env::var("CARGO_MANIFEST_DIR").unwrap()).join("models");
    let mut files: Vec<_> = fs::read_dir(&dir)
        .expect("models/ directory")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|ext| ext == "json"))
        .collect();
    files.sort();

    let mut out = String::from("pub const BUILTIN_MODELS: &[(&str, &str)] = &[\n");
    for path in files {
        let name = path.file_name().unwrap().to_string_lossy();
        out.push_str(&format!("    ({name:?}, include_str!({:?})),\n", path.display().to_string()));
    }
    out.push_str("];\n");
    fs::write(Path::new(&env::var("OUT_DIR").unwrap()).join("builtin_models.rs"), out).unwrap();
}

fn main() {
    embed_models();
    tauri_build::build()
}
