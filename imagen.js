// Compresion de fotos en el celular, antes de subirlas.
//
// Dos razones para comprimir aqui y no despues:
//   1. Deja las piezas en 300 KB - 1.5 MB, asi que la subida es un PUT simple y se evita
//      createUploadSession. Es lo que resuelve el "Error al enviar con muchas fotos".
//   2. Al recomprimir se pierde el EXIF, y con el las coordenadas GPS y el modelo del
//      telefono. Eso es una ganancia de privacidad gratis — que conviene no "optimizar"
//      mas adelante subiendo el archivo original.
//
// Pero el EXIF tambien trae la ORIENTACION, y esa si hace falta: sin ella las fotos
// verticales suben acostadas. Y no da ningun error — solo se ven mal. Por eso se lee a
// mano ANTES de recomprimir y se aplica al dibujar.

export const OPCIONES = {
    ladoMaximo: 2048,
    calidad: 0.82
};

/**
 * Lee la orientacion EXIF de un JPEG. Devuelve 1..8 (1 = derecha, sin girar).
 * Es analisis de bytes puro, sin navegador, para poder probarlo con Node.
 *
 * @param {Uint8Array} bytes
 * @returns {number}
 */
export function leerOrientacionExif(bytes) {
    if (!bytes || bytes.length < 4) return 1;
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;      // no es JPEG

    const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let i = 2;

    while (i < bytes.length - 3) {
        if (bytes[i] !== 0xff) { i++; continue; }
        const marcador = bytes[i + 1];
        if (marcador === 0xd8 || marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd7)) {
            i += 2; continue;
        }
        if (marcador === 0xda || marcador === 0xd9) break;      // ya empezaron los datos
        const largo = vista.getUint16(i + 2, false);
        if (largo < 2) return 1;

        if (marcador === 0xe1) {                                // APP1: aqui vive el EXIF
            const inicio = i + 4;
            if (inicio + 6 <= bytes.length &&
                bytes[inicio] === 0x45 && bytes[inicio + 1] === 0x78 &&
                bytes[inicio + 2] === 0x69 && bytes[inicio + 3] === 0x66) {   // "Exif"
                return orientacionDesdeTiff(vista, inicio + 6);
            }
        }
        i += 2 + largo;
    }
    return 1;
}

function orientacionDesdeTiff(vista, tiff) {
    try {
        const marca = vista.getUint16(tiff, false);
        let little;
        if (marca === 0x4949) little = true;        // "II" — Intel
        else if (marca === 0x4d4d) little = false;  // "MM" — Motorola
        else return 1;

        if (vista.getUint16(tiff + 2, little) !== 42) return 1;

        const ifd0 = tiff + vista.getUint32(tiff + 4, little);
        const cuantas = vista.getUint16(ifd0, little);

        for (let e = 0; e < cuantas; e++) {
            const entrada = ifd0 + 2 + e * 12;
            if (vista.getUint16(entrada, little) === 0x0112) {   // tag Orientation
                const v = vista.getUint16(entrada + 8, little);
                return (v >= 1 && v <= 8) ? v : 1;
            }
        }
    } catch (_) { /* EXIF corrupto: se trata como sin girar */ }
    return 1;
}

/**
 * Las orientaciones 5..8 intercambian ancho y alto.
 */
export function giraLosLados(orientacion) {
    return orientacion >= 5 && orientacion <= 8;
}

/**
 * La transformacion de canvas que endereza cada orientacion.
 * Se exporta aparte para poder probarla sin navegador.
 */
export function matrizDeOrientacion(orientacion, ancho, alto) {
    switch (orientacion) {
        case 2: return [-1, 0, 0, 1, ancho, 0];        // espejo horizontal
        case 3: return [-1, 0, 0, -1, ancho, alto];    // 180 grados
        case 4: return [1, 0, 0, -1, 0, alto];         // espejo vertical
        case 5: return [0, 1, 1, 0, 0, 0];             // transpuesta
        case 6: return [0, 1, -1, 0, alto, 0];         // 90 en sentido del reloj
        case 7: return [0, -1, -1, 0, alto, ancho];    // transversa
        case 8: return [0, -1, 1, 0, 0, ancho];        // 270 en sentido del reloj
        default: return [1, 0, 0, 1, 0, 0];            // 1: nada que hacer
    }
}

/**
 * Comprime una foto: la endereza, la reduce y la vuelve JPEG.
 * Solo corre en el navegador.
 *
 * @param {File|Blob} archivo
 * @param {{ladoMaximo?: number, calidad?: number}} [opciones]
 * @returns {Promise<{bytes: Uint8Array, ancho: number, alto: number, orientacion: number}>}
 */
export async function comprimir(archivo, opciones = {}) {
    const ladoMaximo = opciones.ladoMaximo || OPCIONES.ladoMaximo;
    const calidad = opciones.calidad || OPCIONES.calidad;

    const crudo = new Uint8Array(await archivo.arrayBuffer());
    const orientacion = leerOrientacionExif(crudo);

    // Se decodifica SIN que el navegador aplique el EXIF por su cuenta: la orientacion la
    // aplicamos nosotros, para que el resultado sea el mismo en todos los telefonos.
    const mapa = await createImageBitmap(new Blob([crudo]), { imageOrientation: 'none' });

    let anchoFuente = mapa.width;
    let altoFuente = mapa.height;
    if (giraLosLados(orientacion)) { anchoFuente = mapa.height; altoFuente = mapa.width; }

    const escala = Math.min(1, ladoMaximo / Math.max(anchoFuente, altoFuente));
    const ancho = Math.round(anchoFuente * escala);
    const alto = Math.round(altoFuente * escala);

    const lienzo = document.createElement('canvas');
    lienzo.width = ancho;
    lienzo.height = alto;
    const ctx = lienzo.getContext('2d');

    // Primero se enderza en el sistema de coordenadas del original, luego se escala.
    const m = matrizDeOrientacion(orientacion, mapa.width, mapa.height);
    ctx.setTransform(escala, 0, 0, escala, 0, 0);
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.drawImage(mapa, 0, 0);
    mapa.close && mapa.close();

    const blob = await new Promise(res => lienzo.toBlob(res, 'image/jpeg', calidad));
    if (!blob) throw new Error('el navegador no pudo generar el JPEG');

    return {
        bytes: new Uint8Array(await blob.arrayBuffer()),
        ancho, alto, orientacion
    };
}
