// Lectura del catalogo CAT_Evidencia_MINSA.
//
// El catalogo decide QUE opciones ve el operador y A DONDE va cada una. Es la pieza que un
// atacante querria tocar (hallazgo A6), asi que aqui se trata como dato de entrada y no
// como fuente confiable, aunque viva en nuestro tenant: cada renglon se valida y el que no
// pase se descarta con su motivo, sin tumbar la app.
//
// Los nombres de campo son los INTERNOS de SharePoint, que no siempre son los que se ven:
//   Title    -> se muestra como "Titulo". Es la etiqueta que lee el operador.
//   TipoDoc  -> se llama asi porque "Tipo" ya lo ocupa una columna interna (DocIcon).
// Leidos del tenant el 2026-08-16 con revisar-catalogo.html.

import { validarDestino } from './nombre.js';

export const CAMPOS = {
    etiqueta: 'Title',
    unidad:   'Unidad',
    destino:  'Destino',
    tipo:     'TipoDoc',
    activo:   'Activo',
    orden:    'Orden'
};

const TIPOS_VALIDOS = ['foto', 'documento'];

/**
 * Convierte los renglones crudos de Graph en opciones utilizables, descartando lo invalido.
 *
 * @param {Array<{fields?: object}>|Array<object>} crudos  items de Graph (con o sin .fields)
 * @returns {{opciones: Array, descartados: Array<{renglon: any, motivo: string}>}}
 */
export function normalizarCatalogo(crudos) {
    const opciones = [];
    const descartados = [];

    for (const item of (crudos || [])) {
        const f = item && item.fields ? item.fields : item;
        if (!f) { descartados.push({ renglon: item, motivo: 'renglon vacio' }); continue; }

        const etiqueta = texto(f[CAMPOS.etiqueta]);
        const unidad   = texto(f[CAMPOS.unidad]);
        const destino  = texto(f[CAMPOS.destino]);
        const tipo     = texto(f[CAMPOS.tipo]).toLowerCase();

        // Activo puede llegar como booleano o como texto, segun el tipo de columna.
        const activo = esVerdadero(f[CAMPOS.activo]);
        if (!activo) continue;              // retirado a proposito: no es un error

        if (!etiqueta) { descartados.push({ renglon: f, motivo: 'sin etiqueta' }); continue; }
        if (!unidad)   { descartados.push({ renglon: f, motivo: `"${etiqueta}" sin unidad` }); continue; }

        if (!TIPOS_VALIDOS.includes(tipo)) {
            descartados.push({ renglon: f, motivo: `"${etiqueta}" tiene tipo "${tipo || '(vacio)'}"` });
            continue;
        }

        // La validacion que importa: el destino es una ruta y viene de una lista editable.
        const v = validarDestino(destino);
        if (!v.ok) {
            descartados.push({ renglon: f, motivo: `"${etiqueta}" tiene un destino invalido: ${v.motivo}` });
            continue;
        }

        opciones.push({
            etiqueta,
            unidad,
            destino: v.segmentos.join('/'),   // normalizado, sin barras sueltas
            tipo,
            orden: numero(f[CAMPOS.orden], 500)
        });
    }

    opciones.sort((a, b) =>
        a.orden - b.orden || a.etiqueta.localeCompare(b.etiqueta, 'es'));

    return { opciones, descartados };
}

/** Las opciones de una unidad, ya ordenadas. */
export function opcionesDe(catalogo, claveUnidad) {
    const clave = normalizarClave(claveUnidad);
    return catalogo.filter(o => normalizarClave(o.unidad) === clave);
}

// La columna Unidad la escribe una persona: "Legal", "LEGAL" y "legal" son la misma.
function normalizarClave(s) {
    return String(s === null || s === undefined ? '' : s)
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .trim().toUpperCase();
}

function texto(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
}

function numero(v, porOmision) {
    const n = Number(v);
    return Number.isFinite(n) ? n : porOmision;
}

// Yes/No de SharePoint llega como booleano; si la columna fuera de texto, llega como
// "Si"/"true"/"1". Y una columna que NO existe llega como undefined — en ese caso se
// asume activo, para no vaciar el desplegable entero por una columna mal nombrada.
function esVerdadero(v) {
    if (v === null || v === undefined || v === '') return true;
    if (typeof v === 'boolean') return v;
    const s = String(v).trim().toLowerCase();
    return ['true', '1', 'si', 'sí', 'yes', 'verdadero'].includes(s);
}
