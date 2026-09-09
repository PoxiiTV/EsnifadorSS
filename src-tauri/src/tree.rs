//! Arbol de archivos en arena plana. Los hijos de un nodo ocupan posiciones
//! contiguas, asi que basta con guardar el indice del primero y cuantos son.
//! El arena esta en orden BFS: el indice de un padre siempre es menor que el
//! de sus hijos, lo que permite propagar datos hacia arriba en un solo bucle.

use crate::filter::Filter;
use serde::Serialize;
use std::path::PathBuf;

pub const F_DIR: u8 = 1;
pub const F_UNKNOWN: u8 = 4; // pseudo-nodo: ocupado pero no accesible
pub const F_DENIED: u8 = 8; // carpeta sin permisos de lectura
pub const F_DELETED: u8 = 16; // borrado desde la propia aplicacion

pub struct Node {
    pub name: Box<str>,
    pub size: u64,
    pub mtime: i64,
    pub attrs: u32,
    pub parent: u32,
    pub first_child: u32,
    pub child_count: u32,
    pub files: u32,
    pub dirs: u32,
    pub flags: u8,
}

impl Node {
    pub fn is_dir(&self) -> bool {
        self.flags & F_DIR != 0
    }
    pub fn is_pseudo(&self) -> bool {
        self.flags & F_UNKNOWN != 0
    }
    pub fn is_deleted(&self) -> bool {
        self.flags & F_DELETED != 0
    }
}

pub struct Tree {
    pub nodes: Vec<Node>,
    pub root_path: PathBuf,
    /// Capacidad total de la unidad, si la raiz es una unidad completa.
    pub volume_total: u64,
    pub volume_free: u64,
    pub scan_ms: u64,
    pub denied: u32,
}

impl Tree {
    pub fn children_range(&self, id: u32) -> std::ops::Range<u32> {
        let n = &self.nodes[id as usize];
        n.first_child..n.first_child + n.child_count
    }

    /// Ruta absoluta de un nodo, reconstruida subiendo hasta la raiz.
    pub fn path(&self, id: u32) -> PathBuf {
        let mut parts = Vec::new();
        let mut cur = id;
        while cur != 0 {
            let n = &self.nodes[cur as usize];
            if n.is_pseudo() {
                return self.root_path.clone();
            }
            parts.push(n.name.as_ref());
            cur = n.parent;
        }
        let mut p = self.root_path.clone();
        for part in parts.iter().rev() {
            p.push(part);
        }
        p
    }

    /// Cadena de ids desde la raiz hasta `id`, para las migas de pan.
    pub fn ancestry(&self, id: u32) -> Vec<u32> {
        let mut v = vec![id];
        let mut cur = id;
        while cur != 0 {
            cur = self.nodes[cur as usize].parent;
            v.push(cur);
        }
        v.reverse();
        v
    }

    /// Marca por nodo: bit 0 = coincide, bit 1 = algun descendiente coincide.
    /// Un solo barrido en orden inverso basta porque el padre siempre va antes.
    pub fn compute_matches(&self, f: &Filter) -> Vec<u8> {
        let mut m = vec![0u8; self.nodes.len()];
        for i in (0..self.nodes.len()).rev() {
            let n = &self.nodes[i];
            if !n.is_pseudo() && f.matches(n) {
                m[i] |= 1;
            }
            if m[i] != 0 && i != 0 {
                m[n.parent as usize] |= 2;
            }
        }
        m
    }
}

/// Nodo tal y como viaja al frontend. Nombres cortos porque de esto se envian
/// miles en cada repintado.
#[derive(Serialize)]
pub struct ViewNode {
    pub i: u32,
    pub n: String,
    pub s: u64,
    pub d: u8,
    pub m: i64,
    pub fc: u32,
    pub dc: u32,
    #[serde(skip_serializing_if = "is_zero_u8")]
    pub f: u8,
    /// Tamano agregado de los hijos demasiado pequenos para dibujarse.
    #[serde(skip_serializing_if = "is_zero_u64")]
    pub hs: u64,
    #[serde(skip_serializing_if = "is_zero_u32")]
    pub hn: u32,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub c: Vec<ViewNode>,
}

fn is_zero_u8(v: &u8) -> bool {
    *v == 0
}
fn is_zero_u32(v: &u32) -> bool {
    *v == 0
}
fn is_zero_u64(v: &u64) -> bool {
    *v == 0
}

pub struct ViewOpts {
    pub max_depth: u32,
    /// Un hijo se dibuja solo si ocupa al menos estos bytes. Lo calcula el
    /// frontend a partir del area del lienzo, para no mandar rectangulos de 1px.
    pub min_bytes: u64,
    pub show_files: bool,
    pub max_nodes: usize,
}

impl Tree {
    pub fn build_view(&self, id: u32, o: &ViewOpts, marks: Option<&[u8]>) -> ViewNode {
        let mut budget = o.max_nodes;
        self.view_rec(id, 0, o, marks, &mut budget)
    }

    fn view_rec(
        &self,
        id: u32,
        depth: u32,
        o: &ViewOpts,
        marks: Option<&[u8]>,
        budget: &mut usize,
    ) -> ViewNode {
        let n = &self.nodes[id as usize];
        let mut out = ViewNode {
            i: id,
            n: n.name.to_string(),
            s: n.size,
            d: n.flags,
            m: n.mtime,
            fc: n.files,
            dc: n.dirs,
            f: marks.map(|m| m[id as usize]).unwrap_or(0),
            hs: 0,
            hn: 0,
            c: Vec::new(),
        };
        if depth >= o.max_depth || n.child_count == 0 {
            return out;
        }
        for cid in self.children_range(id) {
            let c = &self.nodes[cid as usize];
            if c.is_deleted() {
                continue;
            }
            let visible = c.size >= o.min_bytes && (o.show_files || c.is_dir() || c.is_pseudo());
            if !visible || *budget == 0 {
                out.hs += c.size;
                out.hn += 1;
                continue;
            }
            *budget -= 1;
            out.c.push(self.view_rec(cid, depth + 1, o, marks, budget));
        }
        out
    }
}

/// Los N nodos mas grandes del subarbol, para el panel de estadisticas.
#[derive(Serialize)]
pub struct TopItem {
    pub i: u32,
    pub n: String,
    pub s: u64,
    pub d: u8,
    pub path: String,
}

impl Tree {
    pub fn top_items(&self, id: u32, want_dirs: bool, limit: usize) -> Vec<TopItem> {
        let mut best: Vec<(u64, u32)> = Vec::new();
        let mut stack = vec![id];
        while let Some(cur) = stack.pop() {
            for cid in self.children_range(cur) {
                let c = &self.nodes[cid as usize];
                if c.is_pseudo() || c.is_deleted() {
                    continue;
                }
                if c.is_dir() {
                    stack.push(cid);
                }
                if c.is_dir() == want_dirs {
                    best.push((c.size, cid));
                }
            }
            // Poda periodica para no acumular medio millon de tuplas.
            if best.len() > limit * 64 {
                best.sort_unstable_by(|a, b| b.0.cmp(&a.0));
                best.truncate(limit);
            }
        }
        best.sort_unstable_by(|a, b| b.0.cmp(&a.0));
        best.truncate(limit);
        best.into_iter()
            .map(|(s, i)| TopItem {
                i,
                n: self.nodes[i as usize].name.to_string(),
                s,
                d: self.nodes[i as usize].flags,
                path: self.path(i).to_string_lossy().into_owned(),
            })
            .collect()
    }

    /// Reparto por extension del subarbol.
    pub fn by_extension(&self, id: u32, limit: usize) -> Vec<ExtStat> {
        use std::collections::HashMap;
        let mut map: HashMap<String, (u64, u32)> = HashMap::new();
        let mut stack = vec![id];
        while let Some(cur) = stack.pop() {
            for cid in self.children_range(cur) {
                let c = &self.nodes[cid as usize];
                if c.is_pseudo() || c.is_deleted() {
                    continue;
                }
                if c.is_dir() {
                    stack.push(cid);
                } else {
                    let slot = map.entry(ext_of(&c.name)).or_insert((0, 0));
                    slot.0 += c.size;
                    slot.1 += 1;
                }
            }
        }
        let mut v: Vec<ExtStat> = map
            .into_iter()
            .map(|(ext, (size, count))| ExtStat { ext, size, count })
            .collect();
        v.sort_unstable_by(|a, b| b.size.cmp(&a.size));
        v.truncate(limit);
        v
    }

    /// Informe de texto plano, equivalente al export de SpaceSniffer.
    pub fn report(&self, id: u32, max_depth: u32) -> String {
        let n = &self.nodes[id as usize];
        let mut s = String::new();
        s.push_str("EsnifadorSS - informe de uso de disco\r\n");
        s.push_str(&format!("Ruta: {}\r\n", self.path(id).display()));
        s.push_str(&format!(
            "Total: {} bytes | {} archivos | {} carpetas\r\n",
            n.size, n.files, n.dirs
        ));
        s.push_str(&"-".repeat(78));
        s.push_str("\r\n");
        self.report_rec(id, 0, max_depth, &mut s);
        s
    }

    fn report_rec(&self, id: u32, depth: u32, max_depth: u32, out: &mut String) {
        if depth >= max_depth {
            return;
        }
        for cid in self.children_range(id) {
            let c = &self.nodes[cid as usize];
            if c.is_deleted() {
                continue;
            }
            out.push_str(&format!(
                "{}{:>14}  {}{}\r\n",
                "  ".repeat(depth as usize),
                c.size,
                c.name,
                if c.is_dir() { "\\" } else { "" }
            ));
            if c.is_dir() {
                self.report_rec(cid, depth + 1, max_depth, out);
            }
        }
    }
}

#[derive(Serialize)]
pub struct ExtStat {
    pub ext: String,
    pub size: u64,
    pub count: u32,
}

pub fn ext_of(name: &str) -> String {
    match name.rfind('.') {
        Some(i) if i > 0 && i + 1 < name.len() => name[i + 1..].to_ascii_lowercase(),
        _ => String::from("(sin extension)"),
    }
}
