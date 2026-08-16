// Armado de nombres de carpeta y archivo.
//
// Esta es la pieza mas delicada del proyecto: el nombre de la carpeta ES el contrato con las
// skills de archivar. Una columna de SharePoint no baja al disco sincronizado; el nombre si.
// Si esto cambia, hay que cambiar tambien las tablas <RUTEO-DECLARADO> de las skills.
//
// El algoritmo del slug es fiel a los pasos c01-c08 de la implementacion original
// (minsa-energy/ambiental/calytek/evidencia-fotografica.md), que ya esta probada en campo.
// Va aislado en su propio archivo justamente para poder probarlo con Node, sin navegador.

// SharePoint / OneDrive rechazan estos caracteres en un nombre.
// El algoritmo original ya quitaba  . , : ; ( ) / "  y  ¿ ? ¡ !
// Aqui se agregan  * < > \ |  que el original dejaba pasar: son invalidos de todas formas,
// asi que quitarlos no cambia ningun caso que antes funcionara — solo evita que uno que
// habria fallado en la subida falle en silencio.
const PUNTUACION = /[.,:;()/"¿?¡!*<>\\|]/g;

const LARGO_MAXIMO = 50;

// Cuando el concepto se queda sin nada utilizable. Nunca devolver vacio: un nombre vacio
// produce una carpeta sin nombre, o un '..' que se sale del buzon.
const SLUG_VACIO = 'sin-concepto';

/**
 * Convierte el texto libre que escribio el operador en el slug del nombre.
 * "Evidencia de FUGA en la bomba" -> "evidencia-de-fuga-en-la-bomba"
 */
export function slug(concepto) {
    if (concepto === null || concepto === undefined) return SLUG_VACIO;

    let s = String(concepto).trim().toLowerCase();          // c01

    // c02 — sin acentos. Se hace con NFD en vez de una cadena de replace: cubre los 7
    // caracteres del original (á é í ó ú ñ ü) con el mismo resultado, y ademas los que el
    // original dejaba pasar (à, â, ç, ...), que habrian llegado crudos al nombre.
    s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    s = s.replace(PUNTUACION, '');                          // c03 + c04
    s = s.replace(/\s+/g, '-');                             // c05
    s = s.replace(/-+/g, '-');                              // c06 — colapso real
    s = cortar(s, LARGO_MAXIMO);                            // c07
    s = s.replace(/^-+|-+$/g, '');                          // c08 (+ tambien al inicio)

    // Guardas que el original no tenia. Un nombre que sea '.', '..' o vacio no es un nombre
    // feo: es un salto de ruta o un error de la API.
    if (s === '' || s === '.' || s === '..') return SLUG_VACIO;

    // SharePoint recorta en silencio los puntos y espacios del final.
    s = s.replace(/^[.\s]+|[.\s]+$/g, '');
    if (s === '') return SLUG_VACIO;

    return s;
}

/**
 * Corta a n unidades sin partir un par sustituto a la mitad (emoji, por ejemplo).
 * Partirlo deja media letra invalida en el nombre.
 */
function cortar(s, n) {
    if (s.length <= n) return s;
    let corte = n;
    const ultimo = s.charCodeAt(corte - 1);
    if (ultimo >= 0xd800 && ultimo <= 0xdbff) corte -= 1;   // quedo una mitad alta suelta
    return s.slice(0, corte);
}

/**
 * La fecha de HOY en hora de Mexico, no UTC. Importa: si alguien sube algo a las 7 de la
 * noche, en UTC ya es el dia siguiente y la carpeta saldria con la fecha equivocada.
 */
export function fechaMexico(cuando) {
    const d = cuando instanceof Date ? cuando : new Date();
    // en-CA da directamente aaaa-mm-dd
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Mexico_City',
        year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(d);
}

/**
 * Nombre de la carpeta del lote:  YYYY-MM-DD_<Etiqueta>_<slug>
 * Exactamente dos guiones bajos. Es lo que las skills usan para reconocerla.
 */
export function nombreCarpeta(fecha, etiqueta, textoSlug) {
    return `${fecha}_${limpiarEtiqueta(etiqueta)}_${textoSlug}`;
}

/**
 * Nombre de cada pieza:
 *   foto       ->  YYYY-MM-DD_<UNIDAD>_Foto_<slug>-01.jpg
 *   documento  ->  YYYY-MM-DD_<UNIDAD>_Doc_<slug>.pdf
 *
 * @param indice  1-based. Se ignora para documento (siempre es una sola pieza).
 */
export function nombreArchivo(fecha, unidad, tipo, textoSlug, indice) {
    if (tipo === 'documento') {
        return `${fecha}_${unidad}_Doc_${textoSlug}.pdf`;
    }
    const nn = String(indice).padStart(2, '0');
    return `${fecha}_${unidad}_Foto_${textoSlug}-${nn}.jpg`;
}

/**
 * La etiqueta viaja en el nombre de la carpeta, asi que tampoco puede traer basura.
 * No se le aplica el slug: se conserva legible ("Eddy Pump", no "eddy-pump") porque asi
 * la esperan las tablas de ruteo. Solo se le quitan los caracteres invalidos y el guion
 * bajo, que es el separador y partiria el nombre en mas de tres campos.
 */
export function limpiarEtiqueta(etiqueta) {
    const e = String(etiqueta === null || etiqueta === undefined ? '' : etiqueta)
        .replace(PUNTUACION, '')
        .replace(/_/g, '-')
        .replace(/\s+/g, ' ')
        .trim();
    return e === '' ? 'Otro' : e;
}

/**
 * Valida el `Destino` que viene del catalogo de SharePoint ANTES de construir la ruta.
 * Hallazgo A6 de la auditoria: si alguien puede editar el catalogo, puede desviar las
 * subidas de los demas — y un destino con '..' se sale del buzon.
 *
 * El catalogo es un dato de entrada, no una fuente confiable, aunque viva en nuestro tenant.
 *
 * @returns {{ok: boolean, motivo?: string, segmentos?: string[]}}
 */
export function validarDestino(destino) {
    // Vacio es LEGITIMO: es el caso "Otro", que cae a la raiz del buzon.
    if (destino === null || destino === undefined || String(destino).trim() === '') {
        return { ok: true, segmentos: [] };
    }

    const d = String(destino).trim();

    if (d.includes('\\')) return { ok: false, motivo: 'trae barra invertida' };
    if (d.startsWith('/')) return { ok: false, motivo: 'es una ruta absoluta' };
    if (/^[a-zA-Z]:/.test(d)) return { ok: false, motivo: 'trae letra de unidad' };
    if (/^https?:/i.test(d)) return { ok: false, motivo: 'es una URL' };
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(d)) return { ok: false, motivo: 'trae caracteres de control' };

    const segmentos = d.split('/').filter(x => x !== '');
    if (segmentos.length === 0) return { ok: true, segmentos: [] };

    for (const seg of segmentos) {
        if (seg === '.' || seg === '..') {
            return { ok: false, motivo: `el segmento "${seg}" se sale de la carpeta` };
        }
        if (/[<>:"|?*]/.test(seg)) {
            return { ok: false, motivo: `el segmento "${seg}" trae caracteres invalidos` };
        }
        if (seg !== seg.trim() || seg.endsWith('.')) {
            return { ok: false, motivo: `el segmento "${seg}" empieza o termina en espacio o punto` };
        }
    }

    return { ok: true, segmentos };
}
