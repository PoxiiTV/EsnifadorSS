# Changelog

Todas las versiones de EsnifadorSS, de la más reciente a la más antigua.
*All EsnifadorSS releases, newest first.*

---

## 🎉 v0.1.0 — 10 de septiembre de 2026

**Primera versión pública.** Un visualizador de espacio en disco que dibuja cada
archivo con el tamaño que ocupa de verdad, para que lo que sobra se vea sin leer
ni una tabla.

### 🗺️ El mapa

- **Mapa de árbol** con teselado *squarified*: los bloques tienden al cuadrado, que es lo que los hace comparables de un vistazo.
- **Estilo plano con aire**: color puro, 2 px de separación entre bloques y esquinas redondeadas. El hueco deja ver el color de la carpeta padre, así que el anidamiento se lee sin bordes gruesos.
- **El aire se descuenta del propio bloque**, no del reparto: las áreas siguen siendo exactamente proporcionales al tamaño real.
- **12 niveles de detalle**, controlables con la rueda del ratón.
- **Colorear por tamaño, tipo de archivo o antigüedad.**
- **Solo se dibuja lo que ocupa el disco.** El espacio libre no se representa; el espacio *no identificado* sí, porque esos bytes están realmente ocupados.

### 🔍 Navegación

- **Zoom con animación** al entrar y salir de las carpetas, para no perder la referencia de dónde estabas.
- **Migas de pan** navegables, e historial de atrás y adelante.
- **Pestañas**: varios discos abiertos a la vez, cada uno con su propio análisis.
- **Arrastrar y soltar** una carpeta sobre la ventana para analizarla.

### 🏷️ Filtros

- **Sintaxis completa**: comodines (`*.mp4|*.mkv`), tamaños (`>500mb`), fechas (`<2024/01/31`), atributos (`:oculto`, `:cifrado`) y exclusiones (`*.*;*.tmp`).
- **Varias condiciones se combinan**: `*.log >1mb` exige que se cumplan las dos.
- **Lo que coincide se resalta** y el resto se atenúa, sin desaparecer del mapa.
- **Ayuda integrada** con `F1`.

### 🧹 Limpieza

- **Detector de carpetas prescindibles**, desactivado por defecto: `node_modules`, `__pycache__`, cachés de pip, npm y Cargo, temporales de Windows, modelos descargados de Hugging Face…
- **Separa lo que se regenera solo** de lo que hay que revisar antes de borrar.
- **Dos salvaguardas**: al encontrar una carpeta no sigue bajando, y `target` solo cuenta como artefacto de Rust si tiene un `Cargo.toml` al lado.
- **Deja fuera `build`, `dist` y `out` a propósito**, porque es demasiado fácil que contengan trabajo tuyo.

### 🎨 Aspecto

- **Ocho temas**: Deep Space, Midnight Glass, Nordic Light, Solar Flare, Emerald Deep, Neon Terminal, Candy Pop y Slate Pro.
- **Tipografías incrustadas**: Inter para el texto y JetBrains Mono para todas las cifras, con dígitos tabulares para que las columnas de GB queden alineadas.
- **Barra de título propia**, con pestañas integradas.
- **Recuerda el tamaño y la posición de la ventana** entre sesiones.

### 📊 Información

- **Panel de detalles** con ruta, porcentaje del padre y del total, atributos y fechas.
- **Los 20 archivos y las 20 carpetas más grandes** de la carpeta actual.
- **Reparto por extensión**, con leyenda de las familias de archivo.
- **Barra de progreso real con tiempo restante** al analizar una unidad entera, con la estimación suavizada para que no salte de 10 segundos a 3 minutos.
- **Lista de carpetas sin acceso**, accesible desde la barra de estado.

### 🗑️ Acciones

- **Enviar a la papelera** o **eliminar permanentemente**, siempre con confirmación.
- **El mapa se recalcula al instante** tras borrar, sin volver a escanear el disco.
- **Abrir**, **mostrar en el Explorador**, **propiedades** y **copiar ruta**.
- **Exportar un informe** en texto plano.

### ⚡ Rendimiento

- **Escaneo paralelo en Rust**: unos 700.000 archivos en 6 segundos sobre NVMe.
- **Ajusta los hilos según el disco**: en un disco mecánico baja a 2, porque cada hilo extra manda el cabezal a otra zona del plato y el tiempo se va en desplazamientos.
- **El árbol vive en un arena plano** en orden BFS, lo que permite propagar las coincidencias del filtro hacia arriba en un único bucle.
- **La interfaz nunca recibe el árbol entero**: solo pide la porción que cabe en pantalla, y lo que no llegaría ni a un píxel se agrupa en un bloque «resto».

### 📦 Descarga

- **`EsnifadorSS.exe`** — portable, **4,5 MB**. Se ejecuta tal cual, no instala nada.
- **`EsnifadorSS_0.1.0_x64-setup.exe`** — instalador, **1,45 MB**, con accesos directos y desinstalador.
- Requiere **Windows 10 u 11**. Usa el WebView2 que el sistema ya trae; no empaqueta ningún runtime.
- **No se conecta a internet.** Sin cuentas, sin anuncios, sin telemetría.

### ⚠️ Limitaciones conocidas

- **Hay carpetas que ni un administrador puede leer.** `System Volume Information`, el índice de búsqueda o las hives del registro están reservadas al usuario SYSTEM. Lo que ocupan aparece agrupado como *espacio no identificado*, y la app lista cuáles se saltó.
- **Un archivo abierto para escritura puede aparecer con tamaño cero.** NTFS no refresca la entrada de directorio hasta que se cierra el descriptor; el Explorador de Windows se comporta igual.
- **Los enlaces simbólicos y las uniones se cuentan pero no se siguen**, para no entrar en bucles ni sumar los mismos bytes dos veces.
- **Los enlaces duros se cuentan una vez por cada nombre**, así que un archivo con varios enlaces suma de más.
- **Solo Windows**, por ahora.

---

## 🇬🇧 English

## 🎉 v0.1.0 — September 10, 2026

**First public release.** A disk space visualizer that draws every file at the
size it actually takes up, so what's wasting your space is obvious without
reading a single table.

### 🗺️ The map

- **Treemap** with squarified tiling: blocks tend toward squares, which is what makes them comparable at a glance.
- **Flat style with breathing room**: pure colour, 2 px gaps between blocks, rounded corners. The gap reveals the parent folder's colour, so nesting reads without heavy borders.
- **The gap is taken from the block itself**, not from the allocation: areas stay exactly proportional to real size.
- **12 detail levels**, driven by the mouse wheel.
- **Colour by size, file type or age.**
- **Only occupied space is drawn.** Free space isn't shown; *unidentified* space is, because those bytes really are in use.

### 🔍 Navigation

- **Animated zoom** when entering and leaving folders, so you never lose your bearings.
- **Clickable breadcrumbs**, plus back and forward history.
- **Tabs**: several drives open at once, each with its own scan.
- **Drag and drop** a folder onto the window to scan it.

### 🏷️ Filters

- **Full syntax**: wildcards (`*.mp4|*.mkv`), sizes (`>500mb`), dates (`<2024/01/31`), attributes (`:hidden`, `:encrypted`) and exclusions (`*.*;*.tmp`).
- **Conditions combine**: `*.log >1mb` requires both to hold.
- **Matches are highlighted** and everything else dims instead of disappearing.
- **Built-in help** on `F1`.

### 🧹 Cleanup

- **Disposable-folder detector**, off by default: `node_modules`, `__pycache__`, pip/npm/Cargo caches, Windows temp files, downloaded Hugging Face models…
- **Separates what regenerates itself** from what you should review before deleting.
- **Two safeguards**: it stops descending once it finds a match, and `target` only counts as a Rust artifact when a `Cargo.toml` sits beside it.
- **`build`, `dist` and `out` are deliberately excluded**, because they too easily contain your own work.

### 🎨 Looks

- **Eight themes**: Deep Space, Midnight Glass, Nordic Light, Solar Flare, Emerald Deep, Neon Terminal, Candy Pop and Slate Pro.
- **Embedded typefaces**: Inter for text, JetBrains Mono for every figure, with tabular digits so GB columns line up.
- **Custom title bar** with integrated tabs.
- **Remembers window size and position** across sessions.

### 📊 Information

- **Details panel** with path, share of parent and of total, attributes and dates.
- **Top 20 files and top 20 folders** in the current directory.
- **Breakdown by extension**, with a legend of file families.
- **Real progress bar with ETA** when scanning a whole drive, smoothed so it doesn't jump from 10 seconds to 3 minutes.
- **List of unreadable folders**, reachable from the status bar.

### 🗑️ Actions

- **Send to Recycle Bin** or **delete permanently**, always with confirmation.
- **The map updates instantly** after deleting, without rescanning the disk.
- **Open**, **show in Explorer**, **properties** and **copy path**.
- **Export a plain-text report.**

### ⚡ Performance

- **Parallel scanning in Rust**: around 700,000 files in 6 seconds on NVMe.
- **Thread count adapts to the drive**: it drops to 2 on a spinning disk, where every extra thread sends the head to another part of the platter and the time goes into seeking.
- **The tree lives in a flat arena** in BFS order, letting filter matches propagate upward in a single loop.
- **The UI never receives the whole tree**: it asks only for the slice that fits on screen, and anything below one pixel is folded into a "remainder" block.

### 📦 Download

- **`EsnifadorSS.exe`** — portable, **4.5 MB**. Just run it, installs nothing.
- **`EsnifadorSS_0.1.0_x64-setup.exe`** — installer, **1.45 MB**, with shortcuts and an uninstaller.
- Requires **Windows 10 or 11**. Uses the WebView2 the system already ships; no runtime is bundled.
- **Never connects to the internet.** No accounts, no ads, no telemetry.

### ⚠️ Known limitations

- **Some folders are unreadable even for an administrator.** `System Volume Information`, the search index and the registry hives are reserved for SYSTEM. What they occupy shows up grouped as *unidentified space*, and the app lists which ones were skipped.
- **A file held open for writing may report zero bytes.** NTFS doesn't refresh the directory entry until the handle closes; Windows Explorer behaves the same.
- **Symlinks and junctions are counted but not followed**, to avoid loops and double-counting the same bytes.
- **Hard links are counted once per name**, so a file with several links adds up more than once.
- **Windows only**, for now.

---

<div align="center">

hecho con 💙 por [poxi](https://github.com/PoxiiTV)

</div>
