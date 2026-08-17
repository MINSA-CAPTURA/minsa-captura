// Camara integrada — el visor se queda ABIERTO entre foto y foto.
//
// POR QUE EXISTE. El boton de fotos usaba <input capture="environment">, que le pide al
// celular su camara nativa en modo "una foto y regresa": el sistema toma UNA, cierra la
// camara y devuelve la app. El atributo `multiple` que iba al lado no hace nada cuando
// `capture` esta presente — asi lo resuelven iOS Safari y Android Chrome. Documentar un
// equipo desde cuatro angulos costaba cuatro viajes de ida y vuelta, y cada viaje es una
// oportunidad de que el operador se distraiga y deje el lote a medias.
//
// Aqui la camara es de la app: se abre una vez, se dispara N veces cambiando de angulo, y
// se cierra cuando el operador dice "Listo".
//
// LO QUE SE PIERDE, dicho de frente: esto captura un cuadro del video en vivo, no pasa por
// el motor de fotos del telefono (multi-cuadro, HDR, reduccion de ruido). Para evidencia de
// campo es de sobra — la app reduce todo a 2048 px de lado de todas formas —, pero en un
// documento con letra chica la camara nativa sigue ganando. Por eso ese boton no se quito:
// convive con este, y es ademas el respaldo cuando el celular niega el permiso de camara.
//
// Las tres funciones puras de abajo se prueban con Node; las que tocan el <video> no.

/** Si este navegador puede abrir la camara desde la pagina. Recibe el navigator para poder
 *  probar los dos caminos sin navegador. */
export function soportada(nav = globalThis.navigator) {
    return !!(nav && nav.mediaDevices && typeof nav.mediaDevices.getUserMedia === 'function');
}

/**
 * Lo que se le pide al navegador. Todo va como `ideal` y nada como `exact` A PROPOSITO:
 * un `exact` que el telefono no pueda cumplir no degrada, TRUENA con OverconstrainedError
 * y deja al operador sin camara por querer mas resolucion.
 *
 * @param {{frontal?: boolean, ladoIdeal?: number}} [opciones]
 */
export function restriccionesDeVideo({ frontal = false, ladoIdeal = 2560 } = {}) {
    return {
        audio: false,
        video: {
            facingMode: frontal ? { ideal: 'user' } : { ideal: 'environment' },
            width: { ideal: ladoIdeal },
            height: { ideal: Math.round(ladoIdeal * 3 / 4) }
        }
    };
}

/**
 * Traduce el fallo de getUserMedia a algo que el operador pueda ACCIONAR desde la planta.
 * El nombre del DOMException es lo unico estable entre navegadores; el `message` de fabrica
 * suele venir en ingles y no dice que hacer.
 *
 * @param {{name?: string, message?: string}} error
 * @returns {string}
 */
export function mensajeDeFallo(error) {
    const nombre = (error && error.name) || '';
    const cola = ' Mientras tanto usa «Cámara del teléfono», que toma una por una.';
    switch (nombre) {
        case 'NotAllowedError':
        case 'SecurityError':
            return 'No se le dio permiso de cámara a esta página. Si te salió el aviso y ' +
                   'picaste «Bloquear», hay que volver a permitirlo en los ajustes del ' +
                   'navegador.' + cola;
        case 'NotFoundError':
        case 'DevicesNotFoundError':
            return 'Este aparato no reporta ninguna cámara.' + cola;
        case 'NotReadableError':
        case 'TrackStartError':
            return 'Otra aplicación está usando la cámara. Ciérrala y vuelve a intentar.' + cola;
        case 'OverconstrainedError':
            return 'La cámara de este aparato no acepta lo que se le pidió.' + cola;
        default:
            return 'No se pudo abrir la cámara' +
                   (error && error.message ? `: ${error.message}` : '.') + cola;
    }
}

/**
 * Espera a que el <video> entregue imagen de verdad. No basta con `play()`: hay telefonos
 * donde la promesa se resuelve con videoWidth todavia en 0, y capturar ahi devuelve un
 * cuadro negro — que se sube igual de bien que uno bueno y nadie lo nota hasta despues.
 */
function esperarImagen(video, ms = 8000) {
    if (video.videoWidth > 0) return Promise.resolve();
    return new Promise((listo, falla) => {
        const limpiar = () => {
            clearTimeout(reloj);
            clearInterval(sondeo);
            video.removeEventListener('loadedmetadata', revisar);
        };
        const revisar = () => { if (video.videoWidth > 0) { limpiar(); listo(); } };
        const reloj = setTimeout(() => {
            limpiar();
            falla(new Error('la cámara no entregó imagen'));
        }, ms);
        // Evento Y sondeo: en algunos navegadores 'loadedmetadata' ya paso cuando llegamos.
        const sondeo = setInterval(revisar, 120);
        video.addEventListener('loadedmetadata', revisar);
    });
}

/**
 * Abre la camara y la deja corriendo en el <video>. Devuelve el stream, que hay que
 * guardar para poder apagarlo: mientras viva, el foquito de la camara sigue prendido.
 *
 * @param {HTMLVideoElement} video
 * @param {{frontal?: boolean, ladoIdeal?: number}} [opciones]
 * @returns {Promise<MediaStream>}
 */
export async function abrir(video, opciones = {}) {
    if (!soportada()) {
        const e = new Error('este navegador no permite abrir la cámara desde la página');
        e.name = 'NotSupportedError';
        throw e;
    }
    const stream = await navigator.mediaDevices.getUserMedia(restriccionesDeVideo(opciones));
    // playsinline y muted no son cosmetica: sin ellos iOS abre el video a pantalla completa
    // con sus propios controles, y encima bloquea el autoplay.
    video.setAttribute('playsinline', '');
    video.muted = true;
    video.srcObject = stream;
    try {
        await video.play();
        await esperarImagen(video);
    } catch (e) {
        cerrar(stream, video);
        throw e;
    }
    return stream;
}

/**
 * Congela el cuadro actual del visor y lo devuelve como JPEG.
 *
 * La calidad va alta (0.95) porque esto NO es el archivo final: `comprimir()` lo vuelve a
 * codificar a 2048 px / 0.82. Apretarlo dos veces se nota, y lo que se ahorraria aqui se
 * tira en el segundo paso.
 *
 * @param {HTMLVideoElement} video
 * @param {number} [calidad]
 * @returns {Promise<Blob>}
 */
export async function capturar(video, calidad = 0.95) {
    const ancho = video.videoWidth;
    const alto = video.videoHeight;
    if (!ancho || !alto) throw new Error('la cámara todavía no entrega imagen');

    const lienzo = document.createElement('canvas');
    lienzo.width = ancho;
    lienzo.height = alto;
    lienzo.getContext('2d').drawImage(video, 0, 0, ancho, alto);

    const blob = await new Promise(res => lienzo.toBlob(res, 'image/jpeg', calidad));
    if (!blob) throw new Error('el navegador no pudo guardar la foto');
    return blob;
}

/**
 * Apaga la camara. Se llama SIEMPRE al salir — incluso si algo trono a la mitad: un stream
 * huerfano deja la camara ocupada para las demas apps y se come la bateria del turno.
 */
export function cerrar(stream, video) {
    if (stream) for (const pista of stream.getTracks()) pista.stop();
    if (video) video.srcObject = null;
}
