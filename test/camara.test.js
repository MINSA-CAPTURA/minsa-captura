// Pruebas de camara.js — solo lo que se puede probar sin navegador, que es justo lo que
// falla en silencio.
//
// POR QUE ESTAS TRES. El visor en si se ve: si no prende, nadie lo sube a la planta. Lo que
// NO se ve es (1) que las restricciones lleven `exact` y dejen sin camara al telefono que no
// alcanza esa resolucion — un fallo que solo aparece en el aparato del operador, no en el de
// quien programa —, y (2) que el mensaje de un permiso negado no diga que hacer, que es el
// unico momento en que el operador puede resolverlo solo.

import assert from 'node:assert/strict';
import {
    soportada, restriccionesDeVideo, mensajeDeFallo
} from '../camara.js';

let n = 0;
const ok = (cond, que) => { assert.ok(cond, que); n++; };
const igual = (a, b, que) => { assert.deepEqual(a, b); n++; void que; };

// ---------------------------------------------------------------- soportada

ok(soportada({ mediaDevices: { getUserMedia() {} } }) === true,
   'reconoce un navegador con getUserMedia');
ok(soportada({ mediaDevices: {} }) === false,
   'un mediaDevices sin getUserMedia no cuenta como soporte');
ok(soportada({}) === false, 'sin mediaDevices no hay soporte');
ok(soportada(undefined) === false, 'sin navigator no truena: contesta que no');

// ---------------------------------------------------------------- restricciones

const r = restriccionesDeVideo();
ok(r.audio === false, 'nunca se pide micrófono: esto captura fotos');
ok(r.video.facingMode.ideal === 'environment', 'por omisión la cámara de atrás');
ok(restriccionesDeVideo({ frontal: true }).video.facingMode.ideal === 'user',
   'la frontal se pide explícita');

// Lo que de verdad importa de este objeto: TODO va como `ideal`. Un `exact` que el aparato
// no pueda cumplir no baja la resolución, tira OverconstrainedError y deja al operador sin
// cámara — y el teléfono barato de la planta es justo el que no la cumple.
const comoTexto = JSON.stringify(restriccionesDeVideo({ ladoIdeal: 4096 }));
ok(!comoTexto.includes('exact'),
   'ninguna restricción va como exact: eso dejaría sin cámara al teléfono que no alcance');
ok(r.video.width.ideal > 0 && r.video.height.ideal > 0,
   'se pide una resolución concreta, no lo que caiga');
igual(restriccionesDeVideo({ ladoIdeal: 1600 }).video.height.ideal, 1200,
      'el alto sale del lado pedido en 4:3');

// ---------------------------------------------------------------- mensajes de fallo

// El operador está en la planta sin nadie a quien preguntarle: cada mensaje tiene que
// terminar en algo que él pueda hacer con el teléfono en la mano.
for (const nombre of ['NotAllowedError', 'NotFoundError', 'NotReadableError',
                      'OverconstrainedError', 'SecurityError', 'CualquierOtro']) {
    const m = mensajeDeFallo({ name: nombre, message: 'lo que sea' });
    ok(typeof m === 'string' && m.length > 20, `${nombre} produce un mensaje con sustancia`);
    ok(m.includes('Cámara del teléfono'),
       `${nombre} apunta al botón de respaldo — sin eso el operador se queda parado`);
}

ok(mensajeDeFallo({ name: 'NotAllowedError' }).includes('permiso'),
   'el permiso negado se nombra por su causa, no por el nombre del error');
ok(mensajeDeFallo({ name: 'NotReadableError' }).includes('Otra aplicación'),
   'la cámara ocupada dice quién la tiene');
ok(!mensajeDeFallo({}).includes('undefined'),
   'un error sin nombre ni mensaje no imprime "undefined" en la cara del operador');
ok(!mensajeDeFallo(null).includes('undefined'),
   'ni siquiera con un error nulo');

console.log(`\n  camara.js — ${n} pruebas OK\n`);
