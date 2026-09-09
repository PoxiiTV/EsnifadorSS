//! Acciones sobre archivos: abrir, mostrar en el explorador, propiedades y
//! borrado. Todo lo que toca el shell de Windows vive aqui.

use std::path::{Path, PathBuf};

#[cfg(windows)]
fn wide(s: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    std::ffi::OsStr::new(s)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(windows)]
fn shell_open(target: &str) -> Result<(), String> {
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let verb = wide("open");
    let file = wide(target);
    let r = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            verb.as_ptr(),
            file.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    // ShellExecuteW devuelve un valor <= 32 cuando falla.
    if (r as isize) <= 32 {
        Err(format!("No se pudo abrir: {target}"))
    } else {
        Ok(())
    }
}

#[cfg(windows)]
pub fn open_path(p: &Path) -> Result<(), String> {
    shell_open(&p.to_string_lossy())
}

/// Abre una direccion web. Solo https, y solo la llama la propia interfaz:
/// nunca se le pasa nada que venga del disco analizado.
#[cfg(windows)]
pub fn open_url(url: &str) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("Solo se permiten direcciones https".into());
    }
    shell_open(url)
}

#[cfg(windows)]
pub fn properties(p: &Path) -> Result<(), String> {
    use windows_sys::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_INVOKEIDLIST, SHELLEXECUTEINFOW};
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let verb = wide("properties");
    let file = wide(&p.to_string_lossy());
    let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    info.fMask = SEE_MASK_INVOKEIDLIST;
    info.lpVerb = verb.as_ptr();
    info.lpFile = file.as_ptr();
    info.nShow = SW_SHOWNORMAL;
    let ok = unsafe { ShellExecuteExW(&mut info) };
    if ok == 0 {
        Err(format!("No se pudieron abrir las propiedades de {}", p.display()))
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
pub fn open_path(_p: &Path) -> Result<(), String> {
    Err("Solo disponible en Windows".into())
}

#[cfg(not(windows))]
pub fn open_url(_url: &str) -> Result<(), String> {
    Err("Solo disponible en Windows".into())
}

#[cfg(not(windows))]
pub fn properties(_p: &Path) -> Result<(), String> {
    Err("Solo disponible en Windows".into())
}

/// Argumento para `explorer.exe`. Las comillas envuelven SOLO la ruta.
///
/// explorer no usa el analizador de linea de comandos estandar de C, que es el
/// que aplica `Command::arg`. Si se le entrega `"/select,C:\ruta con espacios"`
/// entrecomillado entero no lo reconoce y acaba abriendo Documentos.
fn select_arg(p: &Path) -> String {
    format!("/select,\"{}\"", p.display())
}

/// Abre el explorador con el elemento ya seleccionado.
#[cfg(windows)]
pub fn reveal(p: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    // Si el elemento ya no existe, se muestra la carpeta que lo contenia.
    let target = if p.exists() { p } else { p.parent().unwrap_or(p) };
    // La raiz de una unidad no se puede seleccionar dentro de nada: se abre.
    if target.parent().is_none() {
        return open_path(target);
    }

    std::process::Command::new("explorer")
        // raw_arg entrega el texto tal cual, sin volver a entrecomillarlo.
        .raw_arg(select_arg(target))
        .spawn()
        .map(|_| ())
        // explorer.exe devuelve codigos raros aunque funcione, por eso solo
        // miramos que el proceso arranque.
        .map_err(|e| format!("No se pudo abrir el explorador: {e}"))
}

#[cfg(not(windows))]
pub fn reveal(_p: &Path) -> Result<(), String> {
    Err("Solo disponible en Windows".into())
}

/// Envia a la papelera. Devuelve las rutas que no se pudieron borrar.
pub fn delete(paths: &[PathBuf], permanent: bool) -> Vec<(String, String)> {
    let mut fails = Vec::new();
    for p in paths {
        let r = if permanent {
            if p.is_dir() {
                std::fs::remove_dir_all(p).map_err(|e| e.to_string())
            } else {
                std::fs::remove_file(p).map_err(|e| e.to_string())
            }
        } else {
            trash::delete(p).map_err(|e| e.to_string())
        };
        if let Err(e) = r {
            fails.push((p.to_string_lossy().into_owned(), e));
        }
    }
    fails
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Lo unico que hay que acertar: las comillas rodean la ruta y el prefijo
    /// `/select,` se queda fuera. Justo lo que fallaba antes.
    #[test]
    fn argumento_de_explorer() {
        let a = select_arg(Path::new(r"C:\Users\Alexis\mis cosas\informe final.pdf"));
        assert_eq!(a, "/select,\"C:\\Users\\Alexis\\mis cosas\\informe final.pdf\"");
        assert!(a.starts_with("/select,\""), "el prefijo no puede ir entrecomillado");
        assert!(a.ends_with('"'));
        assert!(!a.starts_with('"'));
    }
}
