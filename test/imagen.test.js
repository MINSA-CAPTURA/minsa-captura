// Pruebas de la lectura de orientacion EXIF.  node test/imagen.test.js
//
// La orientacion es la trampa silenciosa de todo esto: si se lee mal, las fotos suben
// acostadas y NO hay ningun error — solo se ven mal, y para cuando alguien se da cuenta ya
// hay cientos archivadas. Por eso se prueba byte por byte.

import assert from 'node:assert/strict';
import { leerOrientacionExif, giraLosLados, matrizDeOrientacion } from '../imagen.js';

let pasadas = 0;
const fallas = [];
function prueba(nombre, fn) {
    try { fn(); pasadas++; }
    catch (e) { fallas.push({ nombre, error: e.message }); }
}

/**
 * Construye un JPEG con un APP1/EXIF que declara la orientacion pedida.
 * @param {number} orientacion
 * @param {boolean} little  true = "II" (Intel), false = "MM" (Motorola)
 */
function jpegConOrientacion(orientacion, little = true) {
    // TIFF: cabecera (8) + numero de entradas (2) + 1 entrada (12) + siguiente IFD (4)
    const tiff = new Uint8Array(26);
    const v = new DataView(tiff.buffer);
    v.setUint16(0, little ? 0x4949 : 0x4d4d, false);
    v.setUint16(2, 42, little);
    v.setUint32(4, 8, little);          // IFD0 empieza en el byte 8 del TIFF
    v.setUint16(8, 1, little);          // una sola entrada
    v.setUint16(10, 0x0112, little);    // tag Orientation
    v.setUint16(12, 3, little);         // tipo SHORT
    v.setUint32(14, 1, little);         // un valor
    v.setUint16(18, orientacion, little);
    v.setUint32(22, 0, little);         // no hay IFD siguiente

    const exif = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];   // "Exif\0\0"
    const carga = [...exif, ...tiff];
    const largo = carga.length + 2;

    return new Uint8Array([
        0xff, 0xd8,                                   // SOI
        0xff, 0xe1, (largo >> 8) & 0xff, largo & 0xff, // APP1
        ...carga,
        0xff, 0xda, 0x00, 0x02,                        // SOS: aqui ya no se busca mas
        0xff, 0xd9                                     // EOI
    ]);
}

prueba('lee las 8 orientaciones, en orden de bytes Intel', () => {
    for (let o = 1; o <= 8; o++) {
        assert.equal(leerOrientacionExif(jpegConOrientacion(o, true)), o, `fallo con ${o}`);
    }
});

prueba('lee las 8 orientaciones, en orden de bytes Motorola', () => {
    // Los telefonos difieren en esto. Leer solo uno de los dos ordenes es un error
    // que se manifiesta unicamente en ciertas marcas.
    for (let o = 1; o <= 8; o++) {
        assert.equal(leerOrientacionExif(jpegConOrientacion(o, false)), o, `fallo con ${o}`);
    }
});

prueba('un JPEG sin EXIF devuelve 1, no truena', () => {
    const sinExif = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x04, 0, 0, 0xff, 0xd9]);
    assert.equal(leerOrientacionExif(sinExif), 1);
});

prueba('lo que no es JPEG devuelve 1', () => {
    assert.equal(leerOrientacionExif(new Uint8Array([1, 2, 3, 4])), 1);
    assert.equal(leerOrientacionExif(new Uint8Array([])), 1);
    assert.equal(leerOrientacionExif(null), 1);
});

prueba('un EXIF corrupto devuelve 1 en vez de reventar', () => {
    // El TIFF empieza en el byte 12:  SOI(2) + marcador APP1(2) + largo(2) + "Exif\0\0"(6).
    // Ahi vive la marca de orden de bytes; romperla es lo que hace ilegible el EXIF.
    const sinOrden = jpegConOrientacion(6);
    sinOrden[12] = 0x00; sinOrden[13] = 0x00;
    assert.equal(leerOrientacionExif(sinOrden), 1);

    // Y con la marca buena pero el numero magico 42 roto.
    const sinMagia = jpegConOrientacion(6);
    sinMagia[14] = 0xff; sinMagia[15] = 0xff;
    assert.equal(leerOrientacionExif(sinMagia), 1);

    // Un APP1 que dice ser EXIF y se corta a la mitad.
    const truncado = jpegConOrientacion(6).slice(0, 16);
    assert.equal(leerOrientacionExif(truncado), 1);
});

prueba('una orientacion fuera de rango se ignora', () => {
    assert.equal(leerOrientacionExif(jpegConOrientacion(99)), 1);
    assert.equal(leerOrientacionExif(jpegConOrientacion(0)), 1);
});

prueba('solo 5..8 intercambian los lados', () => {
    for (const o of [1, 2, 3, 4]) assert.equal(giraLosLados(o), false, `${o}`);
    for (const o of [5, 6, 7, 8]) assert.equal(giraLosLados(o), true, `${o}`);
});

// --- La matriz: se comprueba aplicandola a las esquinas, sin canvas.

function aplicar(m, x, y) {
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

prueba('la orientacion 1 no mueve nada', () => {
    const m = matrizDeOrientacion(1, 100, 50);
    assert.deepEqual(aplicar(m, 0, 0), [0, 0]);
    assert.deepEqual(aplicar(m, 100, 50), [100, 50]);
});

prueba('cada matriz deja la imagen dentro del cuadro correcto', () => {
    const W = 100, H = 50;
    for (let o = 1; o <= 8; o++) {
        const m = matrizDeOrientacion(o, W, H);
        const esquinas = [[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => aplicar(m, x, y));
        const xs = esquinas.map(p => p[0]);
        const ys = esquinas.map(p => p[1]);
        const anchoSalida = Math.max(...xs) - Math.min(...xs);
        const altoSalida = Math.max(...ys) - Math.min(...ys);

        const esperadoAncho = giraLosLados(o) ? H : W;
        const esperadoAlto = giraLosLados(o) ? W : H;

        assert.equal(anchoSalida, esperadoAncho, `orientacion ${o}: ancho`);
        assert.equal(altoSalida, esperadoAlto, `orientacion ${o}: alto`);
        // Y siempre pegada al origen: si no, la foto sale recortada o con borde.
        assert.equal(Math.min(...xs), 0, `orientacion ${o}: se salio en x`);
        assert.equal(Math.min(...ys), 0, `orientacion ${o}: se salio en y`);
    }
});

prueba('la 6 (vertical del celular) gira 90 grados como debe', () => {
    // Es la mas comun: foto tomada en vertical con la camara trasera.
    const m = matrizDeOrientacion(6, 100, 50);
    // La esquina superior izquierda del original debe acabar arriba a la derecha.
    assert.deepEqual(aplicar(m, 0, 0), [50, 0]);
    assert.deepEqual(aplicar(m, 100, 0), [50, 100]);
});

console.log('');
if (fallas.length === 0) {
    console.log(`  imagen.js — ${pasadas} pruebas OK`);
    process.exit(0);
} else {
    console.log(`  imagen.js — ${pasadas} OK, ${fallas.length} FALLARON:`);
    for (const f of fallas) console.log(`    x ${f.nombre}\n      ${f.error}`);
    process.exit(1);
}
