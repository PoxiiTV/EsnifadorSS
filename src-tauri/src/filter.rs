//! Filtro con la sintaxis de SpaceSniffer, algo ampliada.
//!
//!   *.jpg|*.png        alternativas (OR)
//!   >10mb              tamano minimo (b, kb, mb, gb, tb)
//!   <1gb               tamano maximo
//!   >2024/01/31        modificado despues de
//!   <2024/01/31        modificado antes de
//!   :hidden            atributo (archive hidden system readonly
//!                      compressed encrypted temporary dir file)
//!   informe            texto suelto: coincide si el nombre lo contiene
//!   *.log >1mb         varias condiciones juntas = AND
//!   *.*;*.tmp|*.log    lo de la derecha del ; se excluye

use crate::tree::Node;

const A_READONLY: u32 = 0x1;
const A_HIDDEN: u32 = 0x2;
const A_SYSTEM: u32 = 0x4;
const A_ARCHIVE: u32 = 0x20;
const A_TEMPORARY: u32 = 0x100;
const A_COMPRESSED: u32 = 0x800;
const A_ENCRYPTED: u32 = 0x4000;

enum Cond {
    Name(String),
    MinSize(u64),
    MaxSize(u64),
    After(i64),
    Before(i64),
    Attr(u32),
    IsDir(bool),
}

impl Cond {
    fn test(&self, n: &Node) -> bool {
        match self {
            Cond::Name(p) => glob_match(p, &n.name.to_ascii_lowercase()),
            Cond::MinSize(v) => n.size >= *v,
            Cond::MaxSize(v) => n.size <= *v,
            Cond::After(t) => n.mtime >= *t,
            Cond::Before(t) => n.mtime <= *t,
            Cond::Attr(a) => n.attrs & a != 0,
            Cond::IsDir(d) => n.is_dir() == *d,
        }
    }
}

/// Conjuncion de condiciones. Todas deben cumplirse.
struct Term(Vec<Cond>);

impl Term {
    fn test(&self, n: &Node) -> bool {
        self.0.iter().all(|c| c.test(n))
    }
}

pub struct Filter {
    include: Vec<Term>,
    exclude: Vec<Term>,
}

impl Filter {
    /// Devuelve None si la expresion esta vacia o no aporta nada.
    pub fn parse(src: &str) -> Option<Filter> {
        let src = src.trim();
        if src.is_empty() {
            return None;
        }
        let (inc, exc) = match src.split_once(';') {
            Some((a, b)) => (a, b),
            None => (src, ""),
        };
        let f = Filter {
            include: parse_side(inc),
            exclude: parse_side(exc),
        };
        if f.include.is_empty() && f.exclude.is_empty() {
            None
        } else {
            Some(f)
        }
    }

    pub fn matches(&self, n: &Node) -> bool {
        if !self.exclude.is_empty() && self.exclude.iter().any(|t| t.test(n)) {
            return false;
        }
        if self.include.is_empty() {
            return true;
        }
        self.include.iter().any(|t| t.test(n))
    }
}

fn parse_side(s: &str) -> Vec<Term> {
    s.split('|')
        .filter_map(|alt| {
            let conds: Vec<Cond> = alt.split_whitespace().filter_map(parse_cond).collect();
            if conds.is_empty() {
                None
            } else {
                Some(Term(conds))
            }
        })
        .collect()
}

fn parse_cond(tok: &str) -> Option<Cond> {
    let tok = tok.trim();
    if tok.is_empty() {
        return None;
    }
    let mut ch = tok.chars();
    let first = ch.next().unwrap();
    let rest = ch.as_str();
    match first {
        '>' | '<' => {
            if let Some(t) = parse_date(rest) {
                // Una fecha delimita por el lado que dice el signo.
                return Some(if first == '>' {
                    Cond::After(t)
                } else {
                    Cond::Before(t)
                });
            }
            let v = parse_size(rest)?;
            Some(if first == '>' {
                Cond::MinSize(v)
            } else {
                Cond::MaxSize(v)
            })
        }
        ':' => match rest.to_ascii_lowercase().as_str() {
            "readonly" | "sololectura" => Some(Cond::Attr(A_READONLY)),
            "hidden" | "oculto" => Some(Cond::Attr(A_HIDDEN)),
            "system" | "sistema" => Some(Cond::Attr(A_SYSTEM)),
            "archive" | "archivo" => Some(Cond::Attr(A_ARCHIVE)),
            "temporary" | "temporal" => Some(Cond::Attr(A_TEMPORARY)),
            "compressed" | "comprimido" => Some(Cond::Attr(A_COMPRESSED)),
            "encrypted" | "cifrado" => Some(Cond::Attr(A_ENCRYPTED)),
            "dir" | "folder" | "carpeta" => Some(Cond::IsDir(true)),
            "file" | "fichero" => Some(Cond::IsDir(false)),
            _ => None,
        },
        _ => {
            let mut p = tok.to_ascii_lowercase();
            // Sin comodines lo tratamos como "contiene", que es lo que espera
            // cualquiera que escriba media palabra en la caja de busqueda.
            if !p.contains('*') && !p.contains('?') {
                p = format!("*{}*", p);
            }
            Some(Cond::Name(p))
        }
    }
}

fn parse_size(s: &str) -> Option<u64> {
    let s = s.trim().to_ascii_lowercase();
    let split = s
        .find(|c: char| !c.is_ascii_digit() && c != '.' && c != ',')
        .unwrap_or(s.len());
    let (num, unit) = s.split_at(split);
    let num: f64 = num.replace(',', ".").parse().ok()?;
    let mult: f64 = match unit.trim() {
        "" | "b" => 1.0,
        "k" | "kb" => 1024.0,
        "m" | "mb" => 1024.0 * 1024.0,
        "g" | "gb" => 1024.0 * 1024.0 * 1024.0,
        "t" | "tb" => 1024.0 * 1024.0 * 1024.0 * 1024.0,
        _ => return None,
    };
    Some((num * mult) as u64)
}

/// Acepta aaaa/mm/dd y aaaa-mm-dd. Devuelve segundos unix (UTC, medianoche).
fn parse_date(s: &str) -> Option<i64> {
    let s = s.trim();
    let sep = if s.contains('/') {
        '/'
    } else if s.contains('-') {
        '-'
    } else {
        return None;
    };
    let p: Vec<&str> = s.split(sep).collect();
    if p.len() != 3 {
        return None;
    }
    let y: i64 = p[0].parse().ok()?;
    let m: i64 = p[1].parse().ok()?;
    let d: i64 = p[2].parse().ok()?;
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) || y < 1601 {
        return None;
    }
    Some(days_from_civil(y, m, d) * 86400)
}

/// Algoritmo de Howard Hinnant: dias desde 1970-01-01.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

/// Comodines `*` y `?` con backtracking iterativo. `pat` y `text` en minusculas.
fn glob_match(pat: &str, text: &str) -> bool {
    let p: Vec<char> = pat.chars().collect();
    let t: Vec<char> = text.chars().collect();
    let (mut pi, mut ti) = (0usize, 0usize);
    let (mut star, mut mark) = (usize::MAX, 0usize);
    while ti < t.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == t[ti]) {
            pi += 1;
            ti += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = pi;
            mark = ti;
            pi += 1;
        } else if star != usize::MAX {
            pi = star + 1;
            mark += 1;
            ti = mark;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == '*' {
        pi += 1;
    }
    pi == p.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(name: &str, size: u64, mtime: i64, attrs: u32, dir: bool) -> Node {
        Node {
            name: name.into(),
            size,
            mtime,
            attrs,
            parent: 0,
            first_child: 0,
            child_count: 0,
            files: 0,
            dirs: 0,
            flags: if dir { crate::tree::F_DIR } else { 0 },
        }
    }

    #[test]
    fn globs() {
        assert!(glob_match("*.jpg", "foto.jpg"));
        assert!(!glob_match("*.jpg", "foto.jpeg"));
        assert!(glob_match("*a*b*", "xxayybzz"));
        assert!(!glob_match("*a*b*c", "ab"));
        assert!(glob_match("?oto.*", "foto.png"));
        assert!(glob_match("*", "loquesea"));
    }

    #[test]
    fn tamanos_y_fechas() {
        assert_eq!(parse_size("10mb"), Some(10 * 1024 * 1024));
        assert_eq!(parse_size("1,5kb"), Some(1536));
        assert_eq!(parse_size("512"), Some(512));
        assert_eq!(parse_date("1970/01/01"), Some(0));
        assert_eq!(parse_date("2024-01-31"), Some(1706659200));
        assert_eq!(parse_date("nada"), None);
    }

    #[test]
    fn expresiones() {
        let f = Filter::parse("*.jpg|*.png").unwrap();
        assert!(f.matches(&node("a.jpg", 1, 0, 0, false)));
        assert!(f.matches(&node("a.PNG", 1, 0, 0, false)));
        assert!(!f.matches(&node("a.txt", 1, 0, 0, false)));

        // AND: extension y tamano a la vez
        let f = Filter::parse("*.log >1mb").unwrap();
        assert!(f.matches(&node("x.log", 2 * 1024 * 1024, 0, 0, false)));
        assert!(!f.matches(&node("x.log", 10, 0, 0, false)));

        // Exclusion
        let f = Filter::parse("*.*;*.tmp").unwrap();
        assert!(f.matches(&node("a.txt", 1, 0, 0, false)));
        assert!(!f.matches(&node("a.tmp", 1, 0, 0, false)));

        // Solo exclusion
        let f = Filter::parse(";*.bak").unwrap();
        assert!(f.matches(&node("a.txt", 1, 0, 0, false)));
        assert!(!f.matches(&node("a.bak", 1, 0, 0, false)));

        // Texto suelto = contiene
        let f = Filter::parse("informe").unwrap();
        assert!(f.matches(&node("Informe-2024.pdf", 1, 0, 0, false)));
        assert!(!f.matches(&node("factura.pdf", 1, 0, 0, false)));

        // Atributos y tipo
        let f = Filter::parse(":hidden").unwrap();
        assert!(f.matches(&node("a", 1, 0, A_HIDDEN, false)));
        assert!(!f.matches(&node("a", 1, 0, 0, false)));
        let f = Filter::parse(":dir").unwrap();
        assert!(f.matches(&node("a", 1, 0, 0, true)));

        assert!(Filter::parse("   ").is_none());
    }
}
