// Pruebas del lector del catalogo.  node test/catalogo.test.js
//
// El catalogo viene de una lista que una persona edita. Estas pruebas cubren lo que pasa
// cuando ese renglon esta mal — que es cuando importa, porque un catalogo perfecto no
// necesita validacion.

import assert from 'node:assert/strict';
import { normalizarCatalogo, opcionesDe, CAMPOS } from '../catalogo.js';

let pasadas = 0;
const fallas = [];
function prueba(nombre, fn) {
    try { fn(); pasadas++; }
    catch (e) { fallas.push({ nombre, error: e.message }); }
}

// Renglon como lo devuelve Graph: los campos van dentro de .fields y con nombre INTERNO.
function fila(etiqueta, unidad, destino, tipo, orden = 10, activo = true) {
    return { fields: {
        [CAMPOS.etiqueta]: etiqueta, [CAMPOS.unidad]: unidad, [CAMPOS.destino]: destino,
        [CAMPOS.tipo]: tipo, [CAMPOS.orden]: orden, [CAMPOS.activo]: activo
    } };
}

prueba('lee un renglon normal', () => {
    const { opciones, descartados } = normalizarCatalogo([
        fila('Eddy Pump', 'CALYTEK', '02_Planta/Equipos/Eddy Pump/', 'foto', 20)
    ]);
    assert.equal(descartados.length, 0);
    assert.equal(opciones.length, 1);
    assert.deepEqual(opciones[0], {
        etiqueta: 'Eddy Pump', unidad: 'CALYTEK',
        destino: '02_Planta/Equipos/Eddy Pump', tipo: 'foto', orden: 20
    });
});

prueba('respeta el orden y desempata por etiqueta', () => {
    const { opciones } = normalizarCatalogo([
        fila('Zeta', 'X', 'a/', 'foto', 20),
        fila('Alfa', 'X', 'a/', 'foto', 10),
        fila('Beta', 'X', 'a/', 'foto', 20)
    ]);
    assert.deepEqual(opciones.map(o => o.etiqueta), ['Alfa', 'Beta', 'Zeta']);
});

prueba('el destino vacio del caso Otro es valido', () => {
    const { opciones, descartados } = normalizarCatalogo([
        fila('Otro', 'CALYTEK', '', 'foto', 999)
    ]);
    assert.equal(descartados.length, 0);
    assert.equal(opciones[0].destino, '');
});

prueba('un renglon inactivo se omite sin considerarse error', () => {
    const { opciones, descartados } = normalizarCatalogo([
        fila('Retirado', 'CALYTEK', 'a/', 'foto', 10, false)
    ]);
    assert.equal(opciones.length, 0);
    assert.equal(descartados.length, 0, 'inactivo no es un descarte, es una baja a proposito');
});

prueba('Activo se entiende como booleano y como texto', () => {
    for (const v of [true, 'true', 'Si', 'sí', '1', 'YES']) {
        assert.equal(normalizarCatalogo([fila('A', 'X', 'a/', 'foto', 1, v)]).opciones.length, 1, `fallo con ${v}`);
    }
    for (const v of [false, 'false', 'No', '0']) {
        assert.equal(normalizarCatalogo([fila('A', 'X', 'a/', 'foto', 1, v)]).opciones.length, 0, `fallo con ${v}`);
    }
});

prueba('si la columna Activo no existe, no se vacia el catalogo', () => {
    // Vale mas mostrar de mas que dejar al operador con un desplegable vacio por un
    // nombre de columna equivocado.
    const { opciones } = normalizarCatalogo([
        { fields: { Title: 'A', Unidad: 'X', Destino: 'a/', TipoDoc: 'foto', Orden: 1 } }
    ]);
    assert.equal(opciones.length, 1);
});

// --- Lo que importa: los renglones malos

prueba('DESCARTA un destino que se sale del buzon', () => {
    const { opciones, descartados } = normalizarCatalogo([
        fila('Bueno', 'X', 'a/b/', 'foto', 10),
        fila('Malo', 'X', '../../otra/', 'foto', 20)
    ]);
    assert.equal(opciones.length, 1, 'el bueno debe sobrevivir');
    assert.equal(opciones[0].etiqueta, 'Bueno');
    assert.equal(descartados.length, 1);
    assert.match(descartados[0].motivo, /destino invalido/);
});

prueba('DESCARTA rutas absolutas y URL', () => {
    const { descartados } = normalizarCatalogo([
        fila('A', 'X', '/raiz/', 'foto'),
        fila('B', 'X', 'https://otro/', 'foto'),
        fila('C', 'X', 'a\\b', 'foto')
    ]);
    assert.equal(descartados.length, 3);
});

prueba('DESCARTA un tipo que no es foto ni documento', () => {
    const { descartados } = normalizarCatalogo([
        fila('A', 'X', 'a/', 'video'),
        fila('B', 'X', 'a/', '')
    ]);
    assert.equal(descartados.length, 2);
    assert.match(descartados[0].motivo, /tipo "video"/);
});

prueba('DESCARTA sin etiqueta o sin unidad, y dice cual', () => {
    const { descartados } = normalizarCatalogo([
        fila('', 'X', 'a/', 'foto'),
        fila('Suelta', '', 'a/', 'foto')
    ]);
    assert.equal(descartados.length, 2);
    assert.match(descartados[1].motivo, /"Suelta" sin unidad/);
});

prueba('un renglon malo NO tumba a los demas', () => {
    const entrada = [
        fila('Uno', 'X', 'a/', 'foto', 10),
        null,
        fila('Dos', 'X', '../fuera', 'foto', 20),
        fila('Tres', 'X', 'b/', 'documento', 30)
    ];
    const { opciones, descartados } = normalizarCatalogo(entrada);
    assert.deepEqual(opciones.map(o => o.etiqueta), ['Uno', 'Tres']);
    assert.equal(descartados.length, 2);
});

prueba('acepta los campos sin envoltura .fields', () => {
    const { opciones } = normalizarCatalogo([
        { Title: 'A', Unidad: 'X', Destino: 'a/', TipoDoc: 'foto', Orden: 1, Activo: true }
    ]);
    assert.equal(opciones.length, 1);
});

prueba('el filtro por unidad no distingue mayusculas ni acentos', () => {
    const { opciones } = normalizarCatalogo([
        fila('A', 'Legal', 'a/', 'documento', 10),
        fila('B', 'LEGAL', 'b/', 'documento', 20),
        fila('C', 'Finanzas', 'c/', 'documento', 30)
    ]);
    assert.equal(opcionesDe(opciones, 'legal').length, 2);
    assert.equal(opcionesDe(opciones, 'LEGAL').length, 2);
    assert.equal(opcionesDe(opciones, 'Finanzas').length, 1);
});

prueba('sin catalogo no truena', () => {
    assert.deepEqual(normalizarCatalogo([]).opciones, []);
    assert.deepEqual(normalizarCatalogo(null).opciones, []);
});

// --- B8: el destino con marcador '/*' (elegir subcarpeta al capturar)

prueba('B8: el destino con /* pide subcarpeta y valida la base', () => {
    const { opciones, descartados } = normalizarCatalogo([
        fila('Evidencia de servicio', 'PITEPEC', '01_Servicios/*', 'foto', 10)
    ]);
    assert.equal(descartados.length, 0);
    assert.equal(opciones[0].destino, '01_Servicios');
    assert.equal(opciones[0].elegirSubcarpeta, true);
});

prueba('B8: una opcion normal NO carga el campo elegirSubcarpeta', () => {
    const { opciones } = normalizarCatalogo([fila('A', 'X', 'a/', 'foto', 1)]);
    assert.ok(!('elegirSubcarpeta' in opciones[0]),
        'el campo se filtraria a todos los manifiestos sin necesidad');
});

prueba('B8: /* con base invalida o vacia se descarta', () => {
    const { opciones, descartados } = normalizarCatalogo([
        fila('A', 'X', '../fuera/*', 'foto', 1),
        fila('B', 'X', '/*', 'foto', 2)
    ]);
    assert.equal(opciones.length, 0);
    assert.equal(descartados.length, 2);
});

prueba('B8: un * que no es el marcador sigue rechazado', () => {
    const { descartados } = normalizarCatalogo([
        fila('A', 'X', '01_*/algo', 'foto', 1),
        fila('B', 'X', 'a*', 'foto', 2)
    ]);
    assert.equal(descartados.length, 2);
});

// --- El catalogo real, tal como quedo cargado

prueba('el catalogo real de las 5 unidades pasa entero', () => {
    const reales = [
        ...['Bascula', 'Eddy Pump', 'Frac Tank', 'McAda', 'Pug Mill', 'Separador Trifasico', 'Shakers']
            .map((e, i) => fila(e, 'CALYTEK', `02_Planta/Equipos/${e}/`, 'foto', (i + 1) * 10)),
        fila('Sistema electrico', 'CALYTEK', '02_Planta/Sistema Eléctrico/', 'foto', 120),
        fila('Predio Cardon', 'CALYTEK', '03_Predios/Cardón (18ha)/', 'foto', 140),
        fila('Otro', 'CALYTEK', '', 'foto', 999),
        fila('Documento firmado', 'RABASA', '03_Contratos-Legal/', 'documento', 20),
        fila('Contrato firmado', 'Legal', '05_Contratos/', 'documento', 10),
        fila('Comprobante de pago', 'Finanzas', '05_Comprobantes-Pago/', 'documento', 10),
        fila('Evidencia de servicio', 'PITEPEC', '01_Servicios/', 'foto', 10)
    ];
    const { opciones, descartados } = normalizarCatalogo(reales);
    assert.equal(descartados.length, 0, 'un renglon real fue descartado: ' + JSON.stringify(descartados));
    assert.equal(opciones.length, reales.length);
    // Los acentos del destino se conservan: son parte del nombre de la carpeta.
    assert.ok(opciones.some(o => o.destino === '02_Planta/Sistema Eléctrico'));
    assert.ok(opciones.some(o => o.destino === '03_Predios/Cardón (18ha)'));
});

console.log('');
if (fallas.length === 0) {
    console.log(`  catalogo.js — ${pasadas} pruebas OK`);
    process.exit(0);
} else {
    console.log(`  catalogo.js — ${pasadas} OK, ${fallas.length} FALLARON:`);
    for (const f of fallas) console.log(`    x ${f.nombre}\n      ${f.error}`);
    process.exit(1);
}
