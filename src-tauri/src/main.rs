// Sin consola en release: la app es puramente grafica.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    esnifadorss_lib::run()
}
