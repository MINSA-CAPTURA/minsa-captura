// Prueba del service worker: que su lista de precarga no se quede corta.
//
// POR QUE. Un modulo nuevo que se importa desde app.js y NO esta en la lista del sw no rompe
// nada mientras haya senal: el navegador lo baja de la red. Rompe la app entera la primera vez
// que alguien la abre sin datos — que es el caso para el que se hizo una PWA, y el unico que
// nadie prueba antes de salir a la planta. Paso al agregar manifiesto.js.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let n = 0;
const ok = (cond, que) => { assert.ok(cond, que); n++; };

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const sw = readFileSync(join(raiz, 'sw.js'), 'utf8');

// Los modulos de la app: los .js de la raiz, sin el propio sw ni el servidor de desarrollo
// (que solo corre en la maquina de Carlos y nunca llega al celular).
const FUERA = new Set(['sw.js', 'servidor-local.js']);
const modulos = readdirSync(raiz)
    .filter(f => f.endsWith('.js') && !FUERA.has(f));

ok(modulos.length > 0, 'se encontraron módulos que revisar');

for (const m of modulos) {
    ok(sw.includes(`'./${m}'`), `sw.js precarga ${m}`);
}

// Y el otro medio filo del mismo cuchillo: cachear con la misma llave despues de cambiar un
// archivo deja al celular con la version vieja. El numero de CACHE tiene que moverse.
ok(/const CACHE = 'minsa-captura-v(\d+)'/.test(sw), 'sw.js versiona su caché');

console.log(`\n  sw.js — ${n} pruebas OK\n`);
