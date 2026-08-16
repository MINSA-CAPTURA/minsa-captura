// Reordenar las piezas de un lote antes de enviarlo.
//
// POR QUE EXISTE, y por que es un modulo aparte de app.js. Las fotos entran en ORDEN DE
// CAPTURA, y para un documento ese orden es el del PDF final. En la primera prueba de campo
// real (2026-08-16) el operador refotografio la hoja 2 al terminar, y el PDF salio con las
// paginas 1, 3, 4, 5, 2: completo, legible, y permanentemente desordenado. Nada lo señalo —
// ni la app ni la skill de archivar, porque un PDF de imagenes no tiene con que cotejar su
// propio orden. Falla en silencio y lo paga quien lo lea meses despues.
//
// La operacion es de una linea y aun asi vive aqui con pruebas: el modo de fallar de un
// reordenamiento no es tirar un error, es PERDER o DUPLICAR una pieza, y eso se ve igual de
// bien en pantalla que lo correcto. La prueba que importa no es "quedaron en otro orden",
// es "estan todas y una sola vez".

/**
 * Devuelve una lista NUEVA con el elemento `i` corrido `delta` lugares.
 * Fuera de rango no es un error: devuelve la misma lista sin tocar, porque quien llama es un
 * boton que el usuario alcanza a picar dos veces en el borde.
 *
 * @template T
 * @param {T[]} lista
 * @param {number} i      posicion actual
 * @param {number} delta  -1 = un lugar antes, +1 = un lugar despues
 * @returns {T[]}
 */
export function mover(lista, i, delta) {
    const destino = i + delta;
    if (!Array.isArray(lista)) return lista;
    if (!Number.isInteger(i) || !Number.isInteger(delta)) return lista;
    if (i < 0 || i >= lista.length) return lista;
    if (destino < 0 || destino >= lista.length) return lista;

    const copia = lista.slice();
    const [pieza] = copia.splice(i, 1);
    copia.splice(destino, 0, pieza);
    return copia;
}

/** Si el boton de mover en esa direccion tiene sentido. Los bordes van deshabilitados, no
 *  escondidos: un boton que aparece y desaparece mueve los demas bajo el dedo. */
export function puedeMover(lista, i, delta) {
    const destino = i + delta;
    return Array.isArray(lista) && destino >= 0 && destino < lista.length &&
           i >= 0 && i < lista.length;
}
