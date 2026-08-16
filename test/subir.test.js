// Pruebas de la capa de subida.  node test/subir.test.js
//
// No se prueba contra SharePoint de verdad: se prueba la LOGICA que decide cuando
// reintentar y como se arma la ruta. Las dos son cosas que fallan en silencio — un
// reintento de mas hace esperar al operador, y una ruta mal codificada crea la carpeta
// con un nombre raro en vez de dar error.

import assert from 'node:assert/strict';
import { conReintento, rutaUrl } from '../subir.js';

let pasadas = 0;
const fallas = [];
function prueba(nombre, fn) {
    try { fn(); pasadas++; }
    catch (e) { fallas.push({ nombre, error: e.message }); }
}
async function pruebaAsync(nombre, fn) {
    try { await fn(); pasadas++; }
    catch (e) { fallas.push({ nombre, error: e.message }); }
}

function respuesta(status, cabeceras = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: k => cabeceras[k] ?? null }
    };
}

// ---------------------------------------------------------------- rutaUrl

prueba('las diagonales que separan carpetas se conservan', () => {
    // El error clasico: encodeURIComponent sobre la ruta entera convierte '/' en '%2F'
    // y SharePoint crea UNA carpeta llamada "02_Planta%2FEquipos".
    assert.equal(rutaUrl('02_Planta/Equipos'), '02_Planta/Equipos');
});

prueba('los espacios y acentos del nombre si se codifican', () => {
    assert.equal(rutaUrl('02_Planta/Equipos/Eddy Pump'), '02_Planta/Equipos/Eddy%20Pump');
    assert.equal(rutaUrl('03_Predios/Cardón (18ha)'), '03_Predios/Card%C3%B3n%20(18ha)');
    assert.equal(rutaUrl('02_Planta/Sistema Eléctrico'), '02_Planta/Sistema%20El%C3%A9ctrico');
});

prueba('las diagonales de sobra no dejan segmentos vacios', () => {
    assert.equal(rutaUrl('/a//b/'), 'a/b');
    assert.equal(rutaUrl(''), '');
});

prueba('el signo de numero se codifica', () => {
    // Sin codificar, '#' corta la URL y el resto de la ruta se pierde en silencio.
    assert.equal(rutaUrl('a/b#c'), 'a/b%23c');
});

// ---------------------------------------------------------------- conReintento

await pruebaAsync('si sale bien a la primera, no reintenta', async () => {
    let veces = 0;
    const r = await conReintento(async () => { veces++; return respuesta(200); });
    assert.equal(r.status, 200);
    assert.equal(veces, 1);
});

await pruebaAsync('un 429 se reintenta y acaba pasando', async () => {
    let veces = 0;
    const r = await conReintento(async () => {
        veces++;
        return veces < 3 ? respuesta(429, { 'Retry-After': '0' }) : respuesta(201);
    });
    assert.equal(r.status, 201);
    assert.equal(veces, 3);
});

await pruebaAsync('un 403 NO se reintenta: repetir no lo va a arreglar', async () => {
    let veces = 0;
    const r = await conReintento(async () => { veces++; return respuesta(403); });
    assert.equal(r.status, 403);
    assert.equal(veces, 1, 'hizo esperar al operador para nada');
});

await pruebaAsync('un 404 y un 401 tampoco se reintentan', async () => {
    for (const codigo of [404, 401, 400]) {
        let veces = 0;
        await conReintento(async () => { veces++; return respuesta(codigo); });
        assert.equal(veces, 1, `reintento un ${codigo}`);
    }
});

await pruebaAsync('un fallo de red se reintenta y al final se propaga', async () => {
    let veces = 0;
    await assert.rejects(
        conReintento(async () => { veces++; throw new Error('sin red'); }),
        /sin red/);
    assert.ok(veces > 1, 'no reintento nada');
});

await pruebaAsync('un fallo de red que se recupera devuelve la buena', async () => {
    let veces = 0;
    const r = await conReintento(async () => {
        veces++;
        if (veces === 1) throw new Error('sin red');
        return respuesta(200);
    });
    assert.equal(r.status, 200);
    assert.equal(veces, 2);
});

await pruebaAsync('se le hace caso al Retry-After del servidor', async () => {
    let veces = 0;
    const t0 = Date.now();
    await conReintento(async () => {
        veces++;
        return veces < 2 ? respuesta(429, { 'Retry-After': '0.05' }) : respuesta(200);
    });
    const transcurrido = Date.now() - t0;
    // Con Retry-After 0.05 s debe esperar ~50 ms, no los 800 ms del respaldo.
    assert.ok(transcurrido < 500, `espero ${transcurrido} ms, ignoro el Retry-After`);
});

await pruebaAsync('avisa al usuario cada vez que reintenta', async () => {
    const avisos = [];
    let veces = 0;
    await conReintento(async () => {
        veces++;
        return veces < 3 ? respuesta(503, { 'Retry-After': '0' }) : respuesta(200);
    }, m => avisos.push(m));
    assert.equal(avisos.length, 2, 'el operador se queda sin saber que esta pasando');
});

console.log('');
if (fallas.length === 0) {
    console.log(`  subir.js — ${pasadas} pruebas OK`);
    process.exit(0);
} else {
    console.log(`  subir.js — ${pasadas} OK, ${fallas.length} FALLARON:`);
    for (const f of fallas) console.log(`    x ${f.nombre}\n      ${f.error}`);
    process.exit(1);
}
