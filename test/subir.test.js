// Pruebas de la capa de subida.  node test/subir.test.js
//
// No se prueba contra SharePoint de verdad: se prueba la LOGICA que decide cuando
// reintentar y como se arma la ruta. Las dos son cosas que fallan en silencio — un
// reintento de mas hace esperar al operador, y una ruta mal codificada crea la carpeta
// con un nombre raro en vez de dar error.

import assert from 'node:assert/strict';
import { conReintento, rutaUrl, crearCliente, motivo } from '../subir.js';

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

// ---------------------------------------------------------------- subcarpetas (B8)

await pruebaAsync('subcarpetas: pide la ruta bien codificada y filtra solo carpetas', async () => {
    let urlPedida = '';
    const fetchReal = globalThis.fetch;
    globalThis.fetch = async (url) => {
        urlPedida = String(url);
        return {
            ok: true, status: 200, headers: { get: () => null },
            json: async () => ({ value: [
                { name: '2026-06-22_OC-4500093931', folder: {} },
                { name: 'indice.xlsx', file: {} },
                { name: '1000080660', folder: {} }
            ] })
        };
    };
    try {
        const c = crearCliente('https://g', 'tok');
        const nombres = await c.subcarpetas('SITIO', '01_Servicios');
        assert.deepEqual(nombres, ['2026-06-22_OC-4500093931', '1000080660'],
            'un archivo suelto no es un servicio');
        assert.ok(urlPedida.includes('/sites/SITIO/drive/root:/01_Servicios:/children'),
            'la ruta no se armo bien: ' + urlPedida);
    } finally { globalThis.fetch = fetchReal; }
});

await pruebaAsync('subcarpetas: un error NO devuelve lista vacia — truena y se ve', async () => {
    const fetchReal = globalThis.fetch;
    globalThis.fetch = async () => ({
        ok: false, status: 404, headers: { get: () => null }, json: async () => ({})
    });
    try {
        const c = crearCliente('https://g', 'tok');
        await assert.rejects(c.subcarpetas('S', 'x'), /404/,
            'una lista vacia por error se leeria como "no hay servicios"');
    } finally { globalThis.fetch = fetchReal; }
});

// ---------------------------------------------------------------- mensajes de error
//
// Un mensaje que apunta a la cosa equivocada cuesta mas que ninguno: el 2026-08-17 un
// operador quedo trabado porque le faltaba LECTURA en el sitio del catalogo y el 403 decia
// "sin permiso para escribir ahi" — lo mando a revisar la biblioteca a la que si alcanzaba.

function respuestaJson(status, cuerpo) {
    return {
        ok: false, status,
        headers: { get: () => null },
        json: async () => cuerpo
    };
}

await pruebaAsync('el 403 no afirma que la operacion era de escritura', async () => {
    const m = await motivo(respuestaJson(403, { error: { message: 'Access denied' } }));
    assert.ok(!/escrib/i.test(m), `motivo() sigue hablando de escritura: "${m}"`);
    assert.ok(m.includes('403') && m.includes('Access denied'),
        'se perdio el codigo o el detalle del servidor: ' + m);
});

await pruebaAsync('el 404 no afirma que lo que falta era una carpeta', async () => {
    // Puede ser un sitio, una lista o una carpeta: quien llama es el que lo sabe.
    const m = await motivo(respuestaJson(404, {}));
    assert.ok(!/carpeta/i.test(m), `motivo() sigue asumiendo carpeta: "${m}"`);
    assert.ok(m.includes('404'), m);
});

await pruebaAsync('sitio(): el error NOMBRA la ruta que fallo', async () => {
    const fetchReal = globalThis.fetch;
    globalThis.fetch = async () => respuestaJson(403, { error: { message: 'Access denied' } });
    try {
        const c = crearCliente('https://g', 'tok');
        // Sin la ruta en el mensaje no hay forma de saber si el 403 fue del sitio de la
        // unidad o del sitio del catalogo, que es un problema de otra persona.
        await assert.rejects(c.sitio('h', '/sites/Administracion'), /\/sites\/Administracion/);
    } finally { globalThis.fetch = fetchReal; }
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
