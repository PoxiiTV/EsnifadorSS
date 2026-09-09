//! Deteccion de carpetas prescindibles: cachés, dependencias y artefactos de
//! compilacion que se regeneran solos.
//!
//! No hace falta volver a escanear el disco. El arbol ya esta en memoria, asi
//! que esto es un unico recorrido del arena y tarda milisegundos.
//!
//! La regla de oro: aqui solo entra lo que se puede reconstruir. Nada que
//! pueda contener trabajo del usuario, por muy "temporal" que suene el nombre.

use crate::tree::Tree;
use serde::Serialize;

/// Cuanto duele borrarlo.
#[derive(Serialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Risk {
    /// Se regenera solo la proxima vez que uses la herramienta.
    Safe,
    /// Se recupera, pero hay que volver a descargarlo.
    Review,
}

struct Rule {
    /// Nombre exacto de la carpeta, en minusculas.
    name: &'static str,
    label: &'static str,
    risk: Risk,
    /// Si esta puesto, la carpeta hermana con ese nombre debe existir. Evita
    /// confundir una carpeta del usuario llamada "target" con la de Rust.
    sibling: Option<&'static str>,
    /// Si esta puesto, la ruta completa debe contener este fragmento.
    within: Option<&'static str>,
}

const fn r(name: &'static str, label: &'static str, risk: Risk) -> Rule {
    Rule { name, label, risk, sibling: None, within: None }
}

const fn rs(name: &'static str, label: &'static str, risk: Risk, sibling: &'static str) -> Rule {
    Rule { name, label, risk, sibling: Some(sibling), within: None }
}

const fn rw(name: &'static str, label: &'static str, risk: Risk, within: &'static str) -> Rule {
    Rule { name, label, risk, sibling: None, within: Some(within) }
}

const RULES: &[Rule] = &[
    // --- desarrollo ---
    r("node_modules", "Dependencias de Node.js — vuelven con npm install", Risk::Safe),
    r("__pycache__", "Bytecode de Python", Risk::Safe),
    r(".pytest_cache", "Caché de pytest", Risk::Safe),
    r(".mypy_cache", "Caché de mypy", Risk::Safe),
    r(".ruff_cache", "Caché de ruff", Risk::Safe),
    r(".parcel-cache", "Caché de Parcel", Risk::Safe),
    r(".turbo", "Caché de Turborepo", Risk::Safe),
    r(".next", "Compilación de Next.js", Risk::Safe),
    r(".nuxt", "Compilación de Nuxt", Risk::Safe),
    r(".svelte-kit", "Compilación de SvelteKit", Risk::Safe),
    r(".angular", "Caché de Angular", Risk::Safe),
    rs("target", "Compilación de Rust", Risk::Safe, "cargo.toml"),
    rs("obj", "Objetos intermedios de .NET", Risk::Safe, "bin"),
    // --- gestores de paquetes ---
    rw("cache", "Caché de pip", Risk::Review, "\\pip\\"),
    rw("cache", "Caché de Yarn", Risk::Review, "\\yarn\\"),
    r("npm-cache", "Caché de npm", Risk::Review),
    r("pnpm-store", "Almacén de pnpm", Risk::Review),
    rw("src", "Fuentes descargadas por Cargo", Risk::Review, "\\.cargo\\registry\\"),
    rw("cache", "Caché de Cargo", Risk::Review, "\\.cargo\\registry\\"),
    r("caches", "Caché de Gradle", Risk::Review),
    // --- modelos e IA: pesan mucho y se vuelven a descargar ---
    rw("hub", "Modelos descargados de Hugging Face", Risk::Review, "huggingface"),
    rw("hub", "Modelos descargados de PyTorch", Risk::Review, "torch"),
    // --- navegadores y aplicaciones Electron ---
    r("code cache", "Caché de código (Chromium)", Risk::Safe),
    r("gpucache", "Caché de GPU", Risk::Safe),
    r("dawncache", "Caché de shaders (Dawn)", Risk::Safe),
    r("grshadercache", "Caché de shaders (Skia)", Risk::Safe),
    r("shadercache", "Caché de shaders", Risk::Safe),
    r("cachestorage", "Caché web", Risk::Safe),
    r("crashpad", "Informes de fallos", Risk::Safe),
    r("crashdumps", "Volcados de memoria", Risk::Safe),
    // --- Windows ---
    rw("temp", "Archivos temporales", Risk::Safe, "\\appdata\\local\\"),
    rw("temp", "Temporales de Windows", Risk::Safe, "\\windows\\"),
    rw("download", "Actualizaciones ya instaladas", Risk::Safe, "softwaredistribution"),
    r("$recycle.bin", "Papelera de reciclaje", Risk::Review),
];

#[derive(Serialize)]
pub struct Suspect {
    pub i: u32,
    pub path: String,
    pub name: String,
    pub label: String,
    pub size: u64,
    pub files: u32,
    pub risk: Risk,
}

impl Tree {
    /// Busca carpetas prescindibles bajo `root`. Al encontrar una no baja mas:
    /// un node_modules dentro de otro no se lista dos veces.
    pub fn suspects(&self, root: u32, limit: usize) -> Vec<Suspect> {
        let mut out: Vec<Suspect> = Vec::new();
        let mut stack = vec![root];

        while let Some(cur) = stack.pop() {
            for id in self.children_range(cur) {
                let n = &self.nodes[id as usize];
                if !n.is_dir() || n.is_deleted() || n.is_pseudo() {
                    continue;
                }
                match self.rule_for(id, cur) {
                    // Coincide: se apunta y NO se sigue bajando.
                    Some(rule) => out.push(Suspect {
                        i: id,
                        path: self.path(id).to_string_lossy().into_owned(),
                        name: n.name.to_string(),
                        label: rule.label.to_string(),
                        size: n.size,
                        files: n.files,
                        risk: rule.risk,
                    }),
                    None => stack.push(id),
                }
            }
        }

        out.sort_unstable_by(|a, b| b.size.cmp(&a.size));
        out.truncate(limit);
        out
    }

    fn rule_for(&self, id: u32, parent: u32) -> Option<&'static Rule> {
        let name = self.nodes[id as usize].name.to_ascii_lowercase();
        let mut full: Option<String> = None;

        RULES.iter().find(|rule| {
            if rule.name != name {
                return false;
            }
            if let Some(sib) = rule.sibling {
                let found = self
                    .children_range(parent)
                    .any(|c| self.nodes[c as usize].name.to_ascii_lowercase() == sib);
                if !found {
                    return false;
                }
            }
            if let Some(frag) = rule.within {
                let p = full.get_or_insert_with(|| self.path(id).to_string_lossy().to_lowercase());
                if !p.contains(frag) {
                    return false;
                }
            }
            true
        })
    }
}
