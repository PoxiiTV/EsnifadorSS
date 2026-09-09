<div align="center">

<img src=".assets/banner.png" alt="EsnifadorSS" width="100%" />

<br />

![Versión](https://img.shields.io/badge/versión-0.1.0-4fd1ff?style=flat-square)
![Plataforma](https://img.shields.io/badge/Windows-10%20%7C%2011-a06bff?style=flat-square)
![Tamaño](https://img.shields.io/badge/portable-4,5%20MB-34e0a1?style=flat-square)
![Sin telemetría](https://img.shields.io/badge/telemetría-ninguna-ffb454?style=flat-square)

**Visualizador de espacio en disco para Windows.**
Cada rectángulo ocupa lo que ocupa en el disco, así que lo que sobra se ve de un vistazo.

</div>

---

## 🎯 Qué es

Analiza una unidad o carpeta y la dibuja como un mapa de árbol. Un archivo de 8 GB
es una caja grande. Una carpeta con mil archivos de 2 KB es una mancha diminuta.
No hay que leer ninguna tabla: **el tamaño se ve**.

El escaneo va en Rust, en paralelo; la interfaz es HTML sobre lienzo dentro de
Tauri 2. El ejecutable ronda los **4,5 MB** y no empaqueta ningún runtime: usa el
WebView2 que Windows 10 y 11 ya traen puesto.

> 🔒 No se conecta a internet. No manda nada a ninguna parte. No hay cuentas,
> ni anuncios, ni «versión pro».

## 📥 Descarga

Busca la última versión en **[Releases](../../releases)**:

| Archivo | Para qué |
|---|---|
| `EsnifadorSS.exe` | **Portable.** Se ejecuta tal cual, no instala nada |
| `EsnifadorSS_x64-setup.exe` | **Instalador**, con accesos directos y desinstalador |

## ✨ Qué trae

| | |
|---|---|
| 🗺️ **Mapa de árbol** | Teselado *squarified*: los bloques tienden al cuadrado, que es lo que los hace comparables de un vistazo |
| 🔍 **Zoom infinito** | Doble clic para entrar, clic derecho para salir, rueda para más o menos detalle |
| 🎨 **8 temas** | Deep Space, Midnight Glass, Nordic Light, Solar Flare, Emerald, Neon Terminal, Candy Pop y Slate Pro |
| 🏷️ **Filtros con sintaxis** | `*.mp4|>500mb`, fechas, atributos, exclusiones. Lo que coincide se resalta y el resto se atenúa |
| 🧹 **Detector de carpetas prescindibles** | `node_modules`, cachés de pip/npm, temporales… separando lo que se regenera solo de lo que hay que revisar |
| 📊 **Panel de estadísticas** | Los 20 archivos y carpetas más grandes, y el reparto por extensión |
| 🗑️ **Papelera** | Borrado con confirmación, y el mapa se recalcula sin volver a escanear |
| 🗂️ **Pestañas** | Varios discos abiertos a la vez, cada uno con su análisis |
| ⚡ **Rápido** | ~700.000 archivos en 6 s en NVMe. Ajusta los hilos según el disco sea SSD o mecánico |

## ⌨️ Cómo se usa

Elige una unidad en la portada y espera a que termine. Con **tres gestos** ya te manejas:

| | |
|---|---|
| 🖱️ **Doble clic** | Entrar en la carpeta. Si es un archivo, lo abre |
| 🖱️ **Clic derecho en el fondo** | Subir un nivel |
| 🎡 **Rueda del ratón** | Más o menos niveles de detalle |

Y el resto con teclado:

| Acción | Tecla |
|---|---|
| Subir un nivel · volver a la raíz | `Retroceso` · `Inicio` |
| Atrás / adelante | `Alt` + `←` / `→` |
| Más / menos detalle | `+` / `−` |
| Volver a analizar | `F5` o `Ctrl` + `R` |
| Ir al filtro | `Ctrl` + `F` |
| Nueva pestaña / cerrar | `Ctrl` + `T` / `Ctrl` + `W` |
| Papelera / borrado definitivo | `Supr` / `May` + `Supr` |
| Ayuda de filtros y atajos | `F1` |

## 🔮 Trucos escondidos

Cosas que están ahí pero no saltan a la vista:

| | |
|---|---|
| 🧹 **Detector de carpetas prescindibles** | Menú de vista (**◒**) → *Avanzado*. Viene apagado porque es cosa de programadores. Al encenderlo aparece una pestaña **Limpieza** con `node_modules`, cachés y temporales, ya separados entre lo que se regenera solo y lo que conviene mirar antes |
| 🎨 **Colorear por antigüedad** | En el mismo menú. El mapa se vuelve un mapa de calor: verde lo reciente, rojo lo que lleva años sin tocarse |
| 📁 **Ocultar los archivos** | También ahí. Deja solo la estructura de carpetas, muy útil para ver de dónde cuelga el peso |
| 🔢 **El «N sin acceso» se pulsa** | Abajo a la derecha. Te lista exactamente qué carpetas se saltó y por qué |
| 🖱️ **Arrastra una carpeta a la ventana** | Se analiza sola, sin pasar por ningún diálogo |
| 🗂️ **Clic con la rueda en una pestaña** | La cierra |
| 🔍 **Texto suelto en el filtro** | Sin comodines busca «que contenga»: escribir `factura` encuentra `Factura-2024.pdf` |
| 🧮 **Condiciones encadenadas** | `*.log >1mb` exige las dos a la vez. Y `*.*;*.tmp` excluye lo de después del `;` |
| ⎋ **`Esc` con el filtro enfocado** | Lo limpia de golpe |
| ⬛ **Bloques con borde punteado** | Son carpetas que Windows no dejó leer |
| 🔲 **El bloque «N elementos»** | Agrupa todo lo que no llegaría ni a un píxel. Sube el detalle o entra para verlo |
| 📤 **Exportar informe** | Menú de vista. Vuelca el árbol a texto plano |
| 🧊 **El botón ▤** | Pliega el panel lateral y le da todo el ancho al mapa |

### 🏷️ Sintaxis del filtro

```text
*.mp4|*.mkv      alternativas separadas por |
>500mb           más grande que (b, kb, mb, gb, tb)
<1gb             más pequeño que
>2024/01/31      modificado después de esa fecha
<2023-12-01      modificado antes de esa fecha
:oculto          atributo: oculto, sistema, sololectura, comprimido, cifrado, temporal
:carpeta         solo carpetas   ·   :fichero solo archivos
informe          texto suelto: el nombre lo contiene
*.log >1mb       varias condiciones se cumplen a la vez
*.*;*.tmp        lo que va tras el ; se excluye
```

## 🔧 Compilar

Requiere [Node.js](https://nodejs.org) y [Rust](https://rustup.rs).

```bat
start.bat     :: modo desarrollo, con recarga en caliente
deploy.bat    :: compila y deja portable + instalador en deploy-hosting\
```

Pruebas del backend: `cd src-tauri && cargo test`

### 🗃️ Estructura

```
src/                  interfaz — sin bundler, módulos ES nativos
  js/themes.js        paleta única: variables CSS y colores del mapa
  js/treemap.js       teselado, pintado y animación de zoom
  js/main.js          pestañas, navegación, filtro, panel lateral
src-tauri/src/
  scan.rs             recorrido paralelo del disco
  tree.rs             árbol en arena plana y consultas
  filter.rs           analizador de la sintaxis de filtros
  suspects.rs         detector de carpetas prescindibles
  fsops.rs            abrir, explorador, propiedades, papelera
```

## 🧠 Detalles que conviene saber

- **El árbol vive en un arena plano en orden BFS.** El índice de un padre siempre
  es menor que el de sus hijos, y eso permite propagar las coincidencias del
  filtro hacia arriba en un único bucle, sin recursión.
- **El frontend nunca recibe el árbol entero.** Pide solo la porción que cabe en
  pantalla; lo que no llegaría ni a un píxel se agrupa en un bloque «resto».
- **No se dibuja el espacio libre**, solo lo que ocupa el disco. Sí aparece el
  espacio *no identificado*: el hueco entre lo que Windows dice que está usado y
  lo que se ha podido medir.
- **Los enlaces simbólicos y las uniones se cuentan pero no se siguen**, para no
  entrar en bucles ni sumar los mismos bytes dos veces.
- **Hay carpetas que ni un administrador puede leer.** `System Volume Information`
  o el índice de búsqueda están reservadas a SYSTEM. La app lista cuáles son.
- **Un archivo abierto para escritura puede aparecer con tamaño cero:** NTFS no
  refresca la entrada de directorio hasta que se cierra el descriptor. El
  Explorador de Windows se comporta igual.

<div align="center">

---

hecho con 💙 por [poxi](https://github.com/PoxiiTV)

</div>

---

<div align="center">

# 🇬🇧 English

</div>

## 🎯 What it is

**Disk space visualizer for Windows.** It scans a drive or folder and draws it as
a treemap. An 8 GB file is a big box; a folder with a thousand 2 KB files is a
speck. No table to read — **you just see the size**.

Scanning runs in parallel in Rust; the UI is HTML on canvas inside Tauri 2. The
executable is around **4.5 MB** and bundles no runtime — it uses the WebView2 that
already ships with Windows 10 and 11.

> 🔒 It never connects to the internet. No accounts, no ads, no "pro version".

## 📥 Download

Grab the latest build from **[Releases](../../releases)**:

| File | What it is |
|---|---|
| `EsnifadorSS.exe` | **Portable.** Just run it, installs nothing |
| `EsnifadorSS_x64-setup.exe` | **Installer**, with shortcuts and an uninstaller |

## ✨ Features

Squarified treemap · infinite zoom · 8 themes · filter syntax · disposable-folder
detector (`node_modules`, package caches, temp files) · top-20 panels · recycle
bin with confirmation · tabs · ~700,000 files in 6 s on NVMe.

## ⌨️ How to use it

Pick a drive on the start screen and wait for the scan. **Three gestures** cover most of it:

| | |
|---|---|
| 🖱️ **Double click** | Enter the folder. On a file, opens it |
| 🖱️ **Right click on the background** | Go up one level |
| 🎡 **Mouse wheel** | More or fewer detail levels |

The rest is keyboard:

| Action | Key |
|---|---|
| Up one level · back to root | `Backspace` · `Home` |
| Back / forward | `Alt` + `←` / `→` |
| More / less detail | `+` / `−` |
| Rescan | `F5` or `Ctrl` + `R` |
| Focus the filter | `Ctrl` + `F` |
| New tab / close | `Ctrl` + `T` / `Ctrl` + `W` |
| Recycle bin / permanent delete | `Del` / `Shift` + `Del` |
| Filter and shortcut help | `F1` |

## 🔮 Hidden gems

Things that are in there but don't announce themselves:

| | |
|---|---|
| 🧹 **Disposable-folder detector** | View menu (**◒**) → *Avanzado*. Off by default because it's a developer thing. Turning it on adds a **Limpieza** tab listing `node_modules`, caches and temp files, already split between what regenerates itself and what deserves a look first |
| 🎨 **Colour by age** | Same menu. The map becomes a heatmap: green for recent, red for what hasn't been touched in years |
| 📁 **Hide files** | Also there. Leaves only the folder structure, handy for seeing where the weight hangs from |
| 🔢 **The "N sin acceso" counter is clickable** | Bottom right. Lists exactly which folders were skipped and why |
| 🖱️ **Drag a folder onto the window** | It scans straight away, no dialog |
| 🗂️ **Middle click on a tab** | Closes it |
| 🔍 **Plain text in the filter** | With no wildcards it means "contains": typing `invoice` finds `Invoice-2024.pdf` |
| 🧮 **Chained conditions** | `*.log >1mb` requires both. And `*.*;*.tmp` excludes whatever follows the `;` |
| ⎋ **`Esc` while the filter has focus** | Clears it instantly |
| ⬛ **Blocks with a dotted border** | Folders Windows refused to read |
| 🔲 **The "N elementos" block** | Groups everything too small to reach a pixel. Raise the detail or step inside to see it |
| 📤 **Export report** | View menu. Dumps the tree to plain text |
| 🧊 **The ▤ button** | Folds the side panel away and gives the map the full width |

Filter syntax matches the Spanish section above; attribute keywords also accept
English names (`:hidden`, `:system`, `:readonly`, `:encrypted`, `:temporary`,
`:dir`, `:file`).

## 🔧 Building

Requires [Node.js](https://nodejs.org) and [Rust](https://rustup.rs).

```bat
start.bat     :: dev mode with hot reload
deploy.bat    :: builds portable + installer into deploy-hosting\
```

Backend tests: `cd src-tauri && cargo test`

## 🧠 Things worth knowing

- **The tree lives in a flat arena in BFS order.** A parent's index is always
  lower than its children's, which lets filter matches propagate upward in a
  single loop, no recursion needed.
- **The frontend never receives the whole tree.** It only asks for the slice that
  fits on screen; anything that wouldn't reach a single pixel is folded into a
  "remainder" block.
- **Free space is not drawn**, only what actually occupies the disk. *Unidentified*
  space is shown: the gap between what Windows reports as used and what could be
  measured.
- **Symlinks and junctions are counted but not followed**, to avoid loops and
  double-counting the same bytes.
- **Some folders are unreadable even for an administrator.** `System Volume
  Information` and the search index are reserved for SYSTEM. The app lists which
  ones were skipped.
- **A file held open for writing may report zero bytes:** NTFS does not refresh
  the directory entry until the handle closes. Windows Explorer behaves the same.

<div align="center">

---

made with 💙 by [poxi](https://github.com/PoxiiTV)

</div>
