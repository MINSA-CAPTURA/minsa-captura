// Pruebas del ensamblador de PDF.  node test/pdf.test.js
//
// Lo que se verifica no es "se ve bonito" sino lo que hace que un lector acepte el archivo:
// que las dimensiones salgan del JPEG de verdad, que haya tantas paginas como fotos, y que
// los desplazamientos de la tabla xref apunten realmente al objeto que dicen.

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { medirJpeg, jpegsAPdf, CARTA } from '../pdf.js';

let pasadas = 0;
const fallas = [];
function prueba(nombre, fn) {
    try { fn(); pasadas++; }
    catch (e) { fallas.push({ nombre, error: e.message }); }
}

// JPEG real de 1x1 pixel (baseline, escala de grises→YCbCr 3 componentes).
const JPEG_1x1 = new Uint8Array(Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAHwAAAQUBAQEB' +
    'AQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1Fh' +
    'ByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZ' +
    'WmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXG' +
    'x8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/AKoA/9k=', 'base64'));

// Construye una cabecera JPEG sintetica con las dimensiones que se pidan. No es una imagen
// decodificable: sirve para probar el lector de marcadores con tamaños arbitrarios.
function jpegFalso(ancho, alto, componentes = 3) {
    const b = [0xff, 0xd8];                                  // SOI
    b.push(0xff, 0xe0, 0x00, 0x10);                          // APP0, largo 16
    b.push(...Array(14).fill(0x00));                         // relleno del APP0
    b.push(0xff, 0xc0, 0x00, 0x11);                          // SOF0, largo 17
    b.push(0x08, (alto >> 8) & 0xff, alto & 0xff,
                 (ancho >> 8) & 0xff, ancho & 0xff, componentes);
    b.push(...Array(11).fill(0x00));
    b.push(0xff, 0xd9);                                      // EOI
    return new Uint8Array(b);
}

// ---------------------------------------------------------------- medirJpeg

prueba('lee las dimensiones de un JPEG real', () => {
    const m = medirJpeg(JPEG_1x1);
    assert.equal(m.ancho, 1);
    assert.equal(m.alto, 1);
});

prueba('lee dimensiones grandes y no confunde ancho con alto', () => {
    const m = medirJpeg(jpegFalso(4032, 3024));
    assert.equal(m.ancho, 4032);
    assert.equal(m.alto, 3024);
    const v = medirJpeg(jpegFalso(3024, 4032));
    assert.equal(v.ancho, 3024);
    assert.equal(v.alto, 4032);
});

prueba('no confunde una tabla Huffman (DHT) con un SOF', () => {
    // 0xC4 cae dentro del rango C0..CF pero NO es SOF. Si se tomara como tal,
    // saldrian dimensiones basura.
    const b = [0xff, 0xd8];
    b.push(0xff, 0xc4, 0x00, 0x08, 0, 0, 0, 0, 0, 0);        // DHT antes del SOF
    b.push(0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x00, 0xc8, 0x03);
    b.push(...Array(11).fill(0));
    b.push(0xff, 0xd9);
    const m = medirJpeg(new Uint8Array(b));
    assert.equal(m.alto, 300);
    assert.equal(m.ancho, 200);
});

prueba('rechaza lo que no es un JPEG', () => {
    assert.throws(() => medirJpeg(new Uint8Array([1, 2, 3, 4])), /no es un JPEG/);
    assert.throws(() => medirJpeg(new Uint8Array([])), /vacio/);
});

// ---------------------------------------------------------------- jpegsAPdf

prueba('un JPEG produce un PDF de una pagina', () => {
    const pdf = jpegsAPdf([JPEG_1x1]);
    const s = Buffer.from(pdf).toString('latin1');
    assert.ok(s.startsWith('%PDF-1.4'), 'no empieza con la cabecera PDF');
    assert.ok(s.trimEnd().endsWith('%%EOF'), 'no termina en %%EOF');
    assert.equal((s.match(/\/Type \/Page[^s]/g) || []).length, 1);
    assert.ok(s.includes('/Count 1'));
});

prueba('cuatro fotos producen cuatro paginas — el caso de RABASA', () => {
    const pdf = jpegsAPdf([JPEG_1x1, JPEG_1x1, JPEG_1x1, JPEG_1x1]);
    const s = Buffer.from(pdf).toString('latin1');
    assert.equal((s.match(/\/Type \/Page[^s]/g) || []).length, 4);
    assert.equal((s.match(/\/Subtype \/Image/g) || []).length, 4);
    assert.ok(s.includes('/Count 4'));
});

prueba('cada imagen entra con DCTDecode, sin recomprimir', () => {
    const pdf = jpegsAPdf([JPEG_1x1]);
    const s = Buffer.from(pdf).toString('latin1');
    assert.ok(s.includes('/Filter /DCTDecode'));
    // Los bytes del JPEG original tienen que estar tal cual dentro del PDF.
    const original = Buffer.from(JPEG_1x1).toString('latin1');
    assert.ok(s.includes(original), 'el JPEG no quedo intacto dentro del PDF');
});

prueba('los desplazamientos de xref apuntan al objeto correcto', () => {
    // Esta es la prueba que de verdad importa: un xref corrido hace que el PDF abra en
    // unos lectores y en otros no, que es el peor modo de falla posible.
    const pdf = jpegsAPdf([JPEG_1x1, JPEG_1x1]);
    const s = Buffer.from(pdf).toString('latin1');

    const mXref = s.match(/\nxref\n0 (\d+)\n/);
    assert.ok(mXref, 'no hay tabla xref');
    const total = parseInt(mXref[1], 10);

    const inicio = s.indexOf('\nxref\n') + 1;
    const cuerpo = s.slice(inicio);
    const renglones = cuerpo.split('\n').slice(2, 2 + total);

    // El renglon 0 es el objeto libre.
    assert.match(renglones[0], /^0000000000 65535 f $/);

    for (let k = 1; k < total; k++) {
        assert.equal(renglones[k].length, 19, `el renglon ${k} no mide 20 bytes con el salto`);
        const desp = parseInt(renglones[k].slice(0, 10), 10);
        const enEseLugar = s.slice(desp, desp + 24);
        assert.ok(enEseLugar.startsWith(`${k} 0 obj`),
            `xref[${k}] apunta a ${desp}, donde dice "${enEseLugar.slice(0, 12)}"`);
    }

    const mStart = s.match(/startxref\n(\d+)\n/);
    assert.ok(mStart);
    assert.ok(s.slice(parseInt(mStart[1], 10)).startsWith('xref'),
        'startxref no apunta a la tabla');
});

prueba('la imagen se encaja sin deformarse y centrada', () => {
    // Una foto apaisada 4032x3024 en pagina Carta vertical: debe ajustarse por el ancho
    // y quedar centrada verticalmente, conservando la proporcion 4:3.
    const pdf = jpegsAPdf([jpegFalso(4032, 3024)]);
    const s = Buffer.from(pdf).toString('latin1');
    const m = s.match(/q\n([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm/);
    assert.ok(m, 'no se encontro la matriz de colocacion');
    const [a, h, x, y] = m.slice(1).map(Number);

    assert.ok(a <= CARTA.ancho + 0.01 && h <= CARTA.alto + 0.01, 'se sale de la pagina');
    assert.ok(Math.abs(a / h - 4032 / 3024) < 0.01, 'se deformo la imagen');
    assert.ok(Math.abs(x - (CARTA.ancho - a) / 2) < 0.01, 'no quedo centrada en x');
    assert.ok(Math.abs(y - (CARTA.alto - h) / 2) < 0.01, 'no quedo centrada en y');
});

prueba('una foto vertical se ajusta por el alto', () => {
    const pdf = jpegsAPdf([jpegFalso(3024, 4032)]);
    const s = Buffer.from(pdf).toString('latin1');
    const m = s.match(/q\n([\d.]+) 0 0 ([\d.]+) /);
    const [a, h] = m.slice(1).map(Number);
    assert.ok(Math.abs(h - CARTA.alto) < 0.01, `el alto deberia llenar la pagina, dio ${h}`);
    assert.ok(a < CARTA.ancho, 'deberia sobrar ancho');
});

prueba('escala de grises y CMYK usan su espacio de color', () => {
    const gris = Buffer.from(jpegsAPdf([jpegFalso(10, 10, 1)])).toString('latin1');
    assert.ok(gris.includes('/ColorSpace /DeviceGray'));
    const cmyk = Buffer.from(jpegsAPdf([jpegFalso(10, 10, 4)])).toString('latin1');
    assert.ok(cmyk.includes('/ColorSpace /DeviceCMYK'));
});

prueba('sin fotos, truena en vez de producir un PDF vacio', () => {
    assert.throws(() => jpegsAPdf([]), /al menos un JPEG/);
});

// Deja un ejemplar en el temporal para poder abrirlo con los ojos.
prueba('escribe un PDF de muestra que se puede abrir', () => {
    const pdf = jpegsAPdf([JPEG_1x1, jpegFalso(1600, 1200), JPEG_1x1]);
    const ruta = join(tmpdir(), 'minsa-captura-muestra.pdf');
    writeFileSync(ruta, pdf);
    assert.ok(pdf.length > 500);
    console.log(`  (muestra escrita en ${ruta})`);
});

console.log('');
if (fallas.length === 0) {
    console.log(`  pdf.js — ${pasadas} pruebas OK`);
    process.exit(0);
} else {
    console.log(`  pdf.js — ${pasadas} OK, ${fallas.length} FALLARON:`);
    for (const f of fallas) console.log(`    x ${f.nombre}\n      ${f.error}`);
    process.exit(1);
}
