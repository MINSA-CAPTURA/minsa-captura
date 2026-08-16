// El manifiesto `_lote.json` que la app deja dentro de cada carpeta de lote.
//
// POR QUE EXISTE. La app sabe a donde va cada lote: la columna `Destino` del catalogo se lo
// dice, y la app ya la lee y la valida. Antes ese dato se descartaba al subir, y las cinco
// skills de archivar tenian que reconstruirlo cada una con su propia tabla copiada del
// catalogo. Eso hacia que agregar una opcion se tocara en DOS lugares — la lista y la tabla —
// y quien solo hiciera lo primero veia su foto llegar al buzon y quedarse ahi.
//
// Con el manifiesto el catalogo vuelve a ser la unica fuente de verdad: la app escribe el
// destino que leyo, y la skill lo propone en su plan.
//
// EL MANIFIESTO SE SUBE AL FINAL, A PROPOSITO. Su presencia es la prueba de que el lote se
// subio COMPLETO. Una subida que se corta a la mitad —sin senal, con la pantalla apagada—
// deja la carpeta con algunas fotos y sin manifiesto, y la skill de archivar la trata como
// lote incompleto en vez de archivarla como si estuviera entera. Por eso tambien lleva la
// lista de archivos: no basta con que el archivo exista, tiene que cuadrar con lo que hay.
//
// NO ES UNA ORDEN. La skill valida el destino contra la biblioteca real y lo propone en su
// plan para que Carlos de el OK, igual que con cualquier otro archivo. El manifiesto ahorra
// la clasificacion, no el visto bueno.

/** Nombre fijo del archivo. Las skills lo buscan por este nombre exacto. */
export const NOMBRE_MANIFIESTO = '_lote.json';

/**
 * Version del CONTRATO, no de la app. Sube solo si cambia la forma del archivo de un modo
 * que obligue a la skill a leerlo distinto. La version de la app va aparte, en `app_version`:
 * sirve para rastrear cual corrida lo escribio y no para decidir como se lee.
 */
export const CONTRATO = 1;

/**
 * Arma el manifiesto de un lote.
 *
 * @param {object} d
 * @param {string} d.appVersion  version de la app (package.json)
 * @param {string} d.unidad      clave de la unidad: CALYTEK, PITEPEC, RABASA, LEGAL, FINANZAS
 * @param {string} d.etiqueta    la opcion que eligio el operador, tal cual la muestra el catalogo
 * @param {string} d.destino     ruta destino relativa a la RAIZ de la biblioteca, ya validada
 * @param {string} d.tipo        'foto' | 'documento'
 * @param {string} d.fecha       YYYY-MM-DD (hora de Mexico)
 * @param {string} d.concepto    lo que escribio el operador, SIN convertir a slug
 * @param {string[]} d.archivos  nombres de las piezas que se subieron, en orden
 * @param {string} [d.subido]    ISO 8601; por omision, ahora
 * @returns {object}
 */
export function construirManifiesto(d) {
    return {
        app: 'minsa-captura',
        contrato: CONTRATO,
        app_version: texto(d.appVersion),
        unidad: texto(d.unidad),
        etiqueta: texto(d.etiqueta),
        destino: texto(d.destino),
        tipo: texto(d.tipo),
        fecha: texto(d.fecha),
        concepto: texto(d.concepto),
        archivos: Array.isArray(d.archivos) ? d.archivos.map(texto) : [],
        subido: d.subido || new Date().toISOString()
    };
}

/**
 * Los bytes listos para subir. UTF-8 explicito: el concepto trae acentos y enes, y el
 * manifiesto lo va a leer un script de Python que asume UTF-8.
 */
export function bytesDelManifiesto(manifiesto) {
    return new TextEncoder().encode(JSON.stringify(manifiesto, null, 2) + '\n');
}

/**
 * Revisa un manifiesto ya leido. Es la MISMA validacion que corre la skill del otro lado,
 * escrita aqui para que la app no suba nunca un manifiesto que su propia skill rechazaria.
 *
 * @returns {{ok: boolean, motivo?: string}}
 */
export function validarManifiesto(m) {
    if (!m || typeof m !== 'object') return { ok: false, motivo: 'no es un objeto' };
    if (m.app !== 'minsa-captura') return { ok: false, motivo: 'no lo escribio esta app' };
    if (m.contrato !== CONTRATO) {
        return { ok: false, motivo: `contrato ${m.contrato}, esta version lee ${CONTRATO}` };
    }
    for (const campo of ['unidad', 'etiqueta', 'destino', 'tipo', 'fecha']) {
        if (!texto(m[campo])) return { ok: false, motivo: `sin ${campo}` };
    }
    if (!['foto', 'documento'].includes(m.tipo)) {
        return { ok: false, motivo: `tipo "${m.tipo}" desconocido` };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m.fecha)) {
        return { ok: false, motivo: `fecha "${m.fecha}" no es YYYY-MM-DD` };
    }
    if (!Array.isArray(m.archivos) || m.archivos.length === 0) {
        return { ok: false, motivo: 'sin lista de archivos' };
    }
    return { ok: true };
}

function texto(v) {
    return v === null || v === undefined ? '' : String(v).trim();
}
