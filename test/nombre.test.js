// Pruebas del armado de nombres. Corren con Node, sin navegador:
//
//   node test/nombre.test.js
//
// El nombre de la carpeta es el contrato con las skills de archivar, asi que estas pruebas
// no son de higiene: son la unica cosa que detecta que se rompio ese contrato antes de que
// las fotos empiecen a caer donde no van.

import assert from 'node:assert/strict';
import {
    slug, fechaMexico, nombreCarpeta, nombreArchivo, limpiarEtiqueta, validarDestino
} from '../nombre.js';

let pasadas = 0;
const fallas = [];

function prueba(nombre, fn) {
    try { fn(); pasadas++; }
    catch (e) { fallas.push({ nombre, error: e.message }); }
}

// ---------------------------------------------------------------- slug

prueba('el caso de la prueba 1 de la Parte 4, con el corte a 50', () => {
    // OJO: la documentacion original esperaba '...-en-que-ll', pero el algoritmo da
    // '...-en-que-lleg'. Manda el algoritmo — y esto es lo que se vio en campo el 2026-08-15.
    const r = slug('Evidencia de fuga en la bomba y estado en que llegó');
    assert.equal(r, 'evidencia-de-fuga-en-la-bomba-y-estado-en-que-lleg');
    assert.equal(r.length, 50);
});

prueba('minusculas, acentos y ñ', () => {
    assert.equal(slug('Revisión del AÑO pasado'), 'revision-del-ano-pasado');
    assert.equal(slug('ÁÉÍÓÚ Ññ Üü'), 'aeiou-nn-uu');
});

prueba('acentos que el algoritmo original NO cubria', () => {
    // à â ç no estaban en la cadena de replace del original: habrian llegado crudos.
    assert.equal(slug('Vàlvula câmara açao'), 'valvula-camara-acao');
});

prueba('puntuacion fuera, incluida la de apertura en español', () => {
    assert.equal(slug('¿Qué pasó? ¡Fuga!'), 'que-paso-fuga');
    assert.equal(slug('a.b,c:d;e(f)g/h"i'), 'abcdefghi');
});

prueba('caracteres invalidos de SharePoint que el original dejaba pasar', () => {
    assert.equal(slug('tanque *3* <urgente> a|b\\c'), 'tanque-3-urgente-ab c'.replace(' c', 'c'));
});

prueba('espacios multiples colapsan a un solo guion', () => {
    assert.equal(slug('a     b'), 'a-b');
    assert.equal(slug('  hola   mundo  '), 'hola-mundo');
});

prueba('no quedan guiones sueltos al inicio ni al final', () => {
    assert.equal(slug('- hola -'), 'hola');
    assert.equal(slug('...fuga...'), 'fuga');
});

prueba('el corte a 50 no deja un guion final', () => {
    // 49 caracteres + espacio + mas texto: al cortar en 50 cae justo en el guion.
    const concepto = 'a'.repeat(49) + ' bcdef';
    const r = slug(concepto);
    assert.ok(r.length <= 50, `largo ${r.length}`);
    assert.ok(!r.endsWith('-'), `termina en guion: ${r}`);
});

prueba('nunca devuelve vacio, ni "." ni ".."', () => {
    assert.equal(slug(''), 'sin-concepto');
    assert.equal(slug('   '), 'sin-concepto');
    assert.equal(slug('...'), 'sin-concepto');
    assert.equal(slug('..'), 'sin-concepto');
    assert.equal(slug('.'), 'sin-concepto');
    assert.equal(slug('///'), 'sin-concepto');
    assert.equal(slug(null), 'sin-concepto');
    assert.equal(slug(undefined), 'sin-concepto');
});

prueba('no parte un par sustituto a la mitad', () => {
    // 48 letras + un emoji (2 unidades UTF-16): el corte en 50 caeria dentro del emoji.
    const r = slug('a'.repeat(48) + '\u{1F600}');
    assert.ok(r.length <= 50);
    for (const ch of r) {
        const p = ch.codePointAt(0);
        assert.ok(!(p >= 0xd800 && p <= 0xdfff), 'quedo media letra suelta');
    }
});

// ---------------------------------------------------------------- fecha

prueba('la fecha sale en hora de Mexico, no en UTC', () => {
    // 2026-08-16 01:30 UTC  =  2026-08-15 19:30 en Mexico. Debe dar el 15, no el 16.
    assert.equal(fechaMexico(new Date('2026-08-16T01:30:00Z')), '2026-08-15');
    assert.equal(fechaMexico(new Date('2026-08-16T18:00:00Z')), '2026-08-16');
});

prueba('la fecha tiene el formato aaaa-mm-dd', () => {
    assert.match(fechaMexico(new Date()), /^\d{4}-\d{2}-\d{2}$/);
});

// ---------------------------------------------------------------- nombres

prueba('la carpeta tiene EXACTAMENTE dos guiones bajos', () => {
    const c = nombreCarpeta('2026-08-16', 'Eddy Pump', 'fuga-en-la-bomba');
    assert.equal(c, '2026-08-16_Eddy Pump_fuga-en-la-bomba');
    assert.equal((c.match(/_/g) || []).length, 2);
});

prueba('una etiqueta con guion bajo no rompe el patron de dos', () => {
    const c = nombreCarpeta('2026-08-16', 'Frac_Tank', 'x');
    assert.equal((c.match(/_/g) || []).length, 2, `partio el nombre: ${c}`);
    assert.equal(c, '2026-08-16_Frac-Tank_x');
});

prueba('sin regresion para CALYTEK: el nombre de foto es el de siempre', () => {
    assert.equal(
        nombreArchivo('2026-08-16', 'CALYTEK', 'foto', 'fuga-en-la-bomba', 1),
        '2026-08-16_CALYTEK_Foto_fuga-en-la-bomba-01.jpg');
    assert.equal(
        nombreArchivo('2026-08-16', 'CALYTEK', 'foto', 'fuga-en-la-bomba', 12),
        '2026-08-16_CALYTEK_Foto_fuga-en-la-bomba-12.jpg');
});

prueba('el documento sale como un solo PDF, sin indice', () => {
    assert.equal(
        nombreArchivo('2026-08-16', 'RABASA', 'documento', 'contrato-firmado', 1),
        '2026-08-16_RABASA_Doc_contrato-firmado.pdf');
});

prueba('una etiqueta vacia cae en Otro, no en cadena vacia', () => {
    assert.equal(limpiarEtiqueta(''), 'Otro');
    assert.equal(limpiarEtiqueta('   '), 'Otro');
    assert.equal(limpiarEtiqueta(null), 'Otro');
});

// ---------------------------------------------------------------- destino (hallazgo A6)

prueba('un destino normal pasa', () => {
    const r = validarDestino('02_Planta/Equipos/Eddy Pump/');
    assert.equal(r.ok, true);
    assert.deepEqual(r.segmentos, ['02_Planta', 'Equipos', 'Eddy Pump']);
});

prueba('un destino vacio es legitimo: es el caso Otro', () => {
    assert.equal(validarDestino('').ok, true);
    assert.equal(validarDestino(null).ok, true);
    assert.deepEqual(validarDestino('').segmentos, []);
});

prueba('un destino que se sale del buzon se RECHAZA', () => {
    assert.equal(validarDestino('../../otra-carpeta').ok, false);
    assert.equal(validarDestino('02_Planta/../../fuera').ok, false);
    assert.equal(validarDestino('./x').ok, false);
});

prueba('rutas absolutas, unidades y URL se rechazan', () => {
    assert.equal(validarDestino('/Legal/Contratos').ok, false);
    assert.equal(validarDestino('C:\\Windows').ok, false);
    assert.equal(validarDestino('https://otro.sitio/x').ok, false);
    assert.equal(validarDestino('a\\b').ok, false);
});

prueba('caracteres invalidos y de control se rechazan', () => {
    assert.equal(validarDestino('carpeta<mala>').ok, false);
    assert.equal(validarDestino('carpeta|tubo').ok, false);
    assert.equal(validarDestino('a/b\u0000c').ok, false);
});

prueba('un espacio de sobra al final del valor completo se recorta, no se rechaza', () => {
    // Es un dedazo del catalogo, no un ataque: se limpia y sigue.
    const r = validarDestino('02_Planta/Equipos ');
    assert.equal(r.ok, true);
    assert.deepEqual(r.segmentos, ['02_Planta', 'Equipos']);
});

prueba('un espacio o punto al final DENTRO de un segmento se rechaza', () => {
    // Aqui si importa: SharePoint lo recorta en silencio y el destino deja de ser el
    // que decia el catalogo — dos renglones distintos acabarian en la misma carpeta.
    assert.equal(validarDestino('a /b').ok, false);
    assert.equal(validarDestino('carpeta./x').ok, false);
    assert.equal(validarDestino('x/ b/y').ok, false);
});

// ---------------------------------------------------------------- resultado

console.log('');
if (fallas.length === 0) {
    console.log(`  nombre.js — ${pasadas} pruebas OK`);
    process.exit(0);
} else {
    console.log(`  nombre.js — ${pasadas} OK, ${fallas.length} FALLARON:`);
    for (const f of fallas) console.log(`    x ${f.nombre}\n      ${f.error}`);
    process.exit(1);
}
