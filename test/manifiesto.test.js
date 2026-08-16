// Pruebas de manifiesto.js — el `_lote.json` que cierra cada lote.
//
// Sin navegador: sólo se prueban funciones puras. Lo que NO se puede probar aquí es que la
// app lo suba de último; eso lo cubre la prueba de campo.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
    NOMBRE_MANIFIESTO, CONTRATO,
    construirManifiesto, bytesDelManifiesto, validarManifiesto
} from '../manifiesto.js';

let n = 0;
const ok = (cond, que) => { assert.ok(cond, que); n++; };
const eq = (a, b, que) => { assert.deepEqual(a, b, que); n++; };

const base = () => ({
    appVersion: '0.2.0',
    unidad: 'CALYTEK',
    etiqueta: 'Eddy Pump',
    destino: '02_Planta/Equipos/Eddy Pump',
    tipo: 'foto',
    fecha: '2026-08-15',
    concepto: 'evidencia de fuga y estado en que llegó',
    archivos: ['2026-08-15_CALYTEK_Foto_evidencia-de-fuga-01.jpg']
});

// ---------------------------------------------------------------- construir

{
    const m = construirManifiesto(base());
    eq(m.app, 'minsa-captura', 'lleva la firma de la app');
    eq(m.contrato, CONTRATO, 'lleva la versión del contrato');
    eq(m.destino, '02_Planta/Equipos/Eddy Pump', 'conserva el destino del catálogo');
    eq(m.unidad, 'CALYTEK', 'conserva la unidad');
    ok(/^\d{4}-\d{2}-\d{2}T/.test(m.subido), 'sella la hora de subida');
}

{
    // El concepto va SIN slug: el slug ya está en el nombre de la carpeta y de los archivos.
    // Aquí lo que se guarda es lo que la persona escribió, con sus acentos.
    const m = construirManifiesto(base());
    eq(m.concepto, 'evidencia de fuga y estado en que llegó', 'el concepto va tal cual, sin slug');
}

{
    const m = construirManifiesto({ ...base(), archivos: undefined });
    eq(m.archivos, [], 'sin archivos no truena: queda la lista vacía (y no valida)');
}

{
    const m = construirManifiesto({ ...base(), unidad: '  RABASA  ' });
    eq(m.unidad, 'RABASA', 'recorta los espacios de los campos');
}

// ---------------------------------------------------------------- bytes

{
    const m = construirManifiesto(base());
    const bytes = bytesDelManifiesto(m);
    ok(bytes instanceof Uint8Array, 'devuelve bytes, no una cadena');
    const texto = new TextDecoder('utf-8').decode(bytes);
    const leido = JSON.parse(texto);
    eq(leido.concepto, m.concepto, 'los acentos sobreviven la ida y vuelta por UTF-8');
    ok(texto.endsWith('\n'), 'termina en salto de línea');
    ok(texto.includes('\n  '), 'va indentado, para que se pueda leer a ojo desde SharePoint');
}

// ---------------------------------------------------------------- validar

{
    eq(validarManifiesto(construirManifiesto(base())).ok, true, 'un manifiesto recién armado pasa');
}

{
    eq(validarManifiesto(null).ok, false, 'null no pasa');
    eq(validarManifiesto('{}').ok, false, 'una cadena no pasa');
    eq(validarManifiesto({}).ok, false, 'un objeto vacío no pasa');
}

{
    const m = construirManifiesto(base());
    eq(validarManifiesto({ ...m, app: 'otra-cosa' }).ok, false,
       'un JSON que no escribió esta app no pasa');
}

{
    const m = construirManifiesto(base());
    const r = validarManifiesto({ ...m, contrato: CONTRATO + 1 });
    eq(r.ok, false, 'un contrato más nuevo no se lee a ciegas');
    ok(r.motivo.includes(String(CONTRATO)), 'y el motivo dice qué versión sí se lee');
}

{
    for (const campo of ['unidad', 'etiqueta', 'destino', 'tipo', 'fecha']) {
        const m = construirManifiesto(base());
        eq(validarManifiesto({ ...m, [campo]: '' }).ok, false, `sin ${campo} no pasa`);
    }
}

{
    const m = construirManifiesto(base());
    eq(validarManifiesto({ ...m, tipo: 'video' }).ok, false, 'un tipo desconocido no pasa');
    eq(validarManifiesto({ ...m, fecha: '15/08/2026' }).ok, false, 'una fecha que no es ISO no pasa');
    eq(validarManifiesto({ ...m, archivos: [] }).ok, false,
       'un lote sin archivos no pasa: la carpeta vacía no se archiva');
}

// ---------------------------------------------------------------- páginas (B10)

{
    // El caso que motivó el campo: 5 hojas fotografiadas salen como UN solo PDF, y sin este
    // número la cuenta de hojas se pierde para siempre.
    const m = construirManifiesto({
        ...base(), tipo: 'documento', paginas: 5,
        archivos: ['2026-08-16_RABASA_Documento_alcance-de-servicios.pdf']
    });
    eq(m.paginas, 5, 'un documento declara sus hojas, no su único archivo');
    eq(m.archivos.length, 1, 'y sube un solo PDF');
    eq(validarManifiesto(m).ok, true, 'un documento de 5 hojas en 1 PDF es válido');
}

{
    const m = construirManifiesto(base());   // tipo foto, 1 archivo, sin `paginas`
    eq(m.paginas, 1, 'sin declararlo, se toma de la lista de archivos');
}

{
    // Lo que se garantiza es la SALIDA, no la entrada: del otro lado lo lee Python, y ahí
    // `"3" != 3` sin avisar. Un número que llegue como texto se convierte; lo que no es un
    // entero cae al respaldo en vez de escribir basura en el archivo.
    ok(typeof construirManifiesto({ ...base(), paginas: '3' }).paginas === 'number',
       'el campo siempre sale como número, nunca como texto');
    eq(construirManifiesto({ ...base(), paginas: '3' }).paginas, 3, 'un texto numérico se convierte');
    eq(construirManifiesto({ ...base(), paginas: 'muchas' }).paginas, 1, 'lo que no es número cae al respaldo');
    eq(construirManifiesto({ ...base(), paginas: -2 }).paginas, 1, 'un negativo cae al respaldo');
    eq(construirManifiesto({ ...base(), paginas: null }).paginas, 1, 'null cae al respaldo');
}

{
    const m = construirManifiesto(base());
    eq(validarManifiesto({ ...m, paginas: undefined }).ok, false, 'sin páginas no pasa');
    eq(validarManifiesto({ ...m, paginas: 0 }).ok, false, 'cero páginas no pasa');
    eq(validarManifiesto({ ...m, paginas: 1.5 }).ok, false, 'una fracción de página no pasa');
}

{
    // Un lote de fotos sí tiene que cuadrar: cada foto es un archivo.
    const m = construirManifiesto({
        ...base(),
        archivos: ['a-01.jpg', 'a-02.jpg']
    });
    eq(m.paginas, 2, 'dos fotos, dos páginas');
    eq(validarManifiesto({ ...m, paginas: 3 }).ok, false,
       'en un lote de fotos, declarar más de las que se suben no pasa');
}

// ------------------------------------------------- el contrato con el otro lado

{
    // El nombre es la única cosa que la skill de archivar busca a ciegas. Si cambia aquí y no
    // allá, los lotes dejan de rutearse EN SILENCIO: llegan al buzón y se quedan.
    eq(NOMBRE_MANIFIESTO, '_lote.json', 'el nombre del manifiesto no cambió');
}

{
    // VERSION vive repetida en app.js y package.json porque el navegador no puede importar
    // el package.json. Repetida sin prueba, diverge; con ésta, no.
    const aqui = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(aqui, '..', 'package.json'), 'utf8'));
    const appJs = readFileSync(join(aqui, '..', 'app.js'), 'utf8');
    const m = appJs.match(/^const VERSION = '([^']+)';/m);
    ok(m, 'app.js declara VERSION');
    eq(m[1], pkg.version, 'la VERSION de app.js es la misma que la de package.json');
}

console.log(`\n  manifiesto.js — ${n} pruebas OK\n`);
