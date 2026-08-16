// Pruebas de orden.js — reordenar las piezas antes de enviar.
//
// Lo que se prueba de verdad no es que cambie el orden: es que NO SE PIERDA NI SE DUPLIQUE
// nada al moverlas. Un reordenamiento roto no truena, entrega un PDF que se ve bien y al que
// le falta una hoja.

import assert from 'node:assert/strict';
import { mover, puedeMover } from '../orden.js';

let n = 0;
const ok = (cond, que) => { assert.ok(cond, que); n++; };
const eq = (a, b, que) => { assert.deepEqual(a, b, que); n++; };

const L = () => ['a', 'b', 'c', 'd', 'e'];

// ---------------------------------------------------------------- mover

{
    eq(mover(L(), 0, 1), ['b', 'a', 'c', 'd', 'e'], 'la primera baja un lugar');
    eq(mover(L(), 4, -1), ['a', 'b', 'c', 'e', 'd'], 'la ultima sube un lugar');
    eq(mover(L(), 2, -1), ['a', 'c', 'b', 'd', 'e'], 'una de en medio sube');
    eq(mover(L(), 2, 1), ['a', 'b', 'd', 'c', 'e'], 'una de en medio baja');
}

{
    // El caso real de la prueba de campo del 2026-08-16: el PDF salio 1,3,4,5,2 porque la
    // hoja 2 se refotografio al final. Corregirlo es subir la ultima tres lugares.
    let l = ['p1', 'p3', 'p4', 'p5', 'p2'];
    l = mover(l, 4, -1);
    l = mover(l, 3, -1);
    l = mover(l, 2, -1);
    eq(l, ['p1', 'p2', 'p3', 'p4', 'p5'], 'el desorden real de la prueba de campo se arregla');
}

{
    // El modo de fallar que importa.
    const original = L();
    const movida = mover(original, 1, 1);
    eq(movida.length, original.length, 'no cambia el numero de piezas');
    eq([...movida].sort(), [...original].sort(), 'estan todas, y una sola vez');
    eq(original, L(), 'la lista original NO se muta: se devuelve una nueva');
}

{
    // Los bordes. Quien llama es un boton, y el usuario lo pica de mas.
    eq(mover(L(), 0, -1), L(), 'la primera no sube: se devuelve intacta');
    eq(mover(L(), 4, 1), L(), 'la ultima no baja: se devuelve intacta');
    eq(mover(L(), 9, -1), L(), 'un indice que no existe no truena');
    eq(mover(L(), -1, 1), L(), 'un indice negativo no truena');
    eq(mover([], 0, 1), [], 'una lista vacia no truena');
    eq(mover(L(), 0, 1.5), L(), 'un delta que no es entero no hace nada');
}

{
    eq(mover(L(), 0, 4), ['b', 'c', 'd', 'e', 'a'], 'un salto largo tambien vale');
}

// ---------------------------------------------------------------- puedeMover

{
    ok(!puedeMover(L(), 0, -1), 'la primera no puede subir');
    ok(puedeMover(L(), 0, 1), 'la primera si puede bajar');
    ok(puedeMover(L(), 4, -1), 'la ultima si puede subir');
    ok(!puedeMover(L(), 4, 1), 'la ultima no puede bajar');
    ok(!puedeMover(['sola'], 0, 1), 'con una sola pieza no hay a donde moverla');
    ok(!puedeMover(['sola'], 0, -1), 'ni para el otro lado');
}

console.log(`\n  orden.js — ${n} pruebas OK\n`);
