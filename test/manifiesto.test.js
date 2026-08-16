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
    appVersion: '0.1.0',
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
