// Une varios JPEG en un solo PDF de varias paginas, sin librerias externas.
//
// Por que a mano y no con una libreria: un PDF que solo incrusta JPEG es ~200 lineas
// deterministas, y meter una dependencia de terceros en una pagina que sostiene un token
// de sesion es justo lo que la auditoria pide evitar (hallazgo A8). Los JPEG entran tal
// cual, sin recomprimir: PDF sabe leerlos con el filtro /DCTDecode.
//
// Se prueba con Node, sin navegador:  node test/pdf.test.js

// Carta (215.9 x 279.4 mm) en puntos PDF. Es el tamaño de oficina en Mexico.
export const CARTA = { ancho: 612, alto: 792 };

/**
 * Lee ancho, alto y numero de componentes de color de un JPEG.
 * Recorre los marcadores hasta el SOF (Start Of Frame), que es donde viven.
 *
 * @param {Uint8Array} bytes
 * @returns {{ancho: number, alto: number, componentes: number}}
 */
export function medirJpeg(bytes) {
    if (!bytes || bytes.length < 4) throw new Error('JPEG vacio o demasiado corto');
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('no empieza con SOI: no es un JPEG');

    let i = 2;
    while (i < bytes.length - 1) {
        if (bytes[i] !== 0xff) { i++; continue; }      // relleno entre segmentos
        const marcador = bytes[i + 1];
        i += 2;

        // Marcadores sin carga util.
        if (marcador === 0xd8 || marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd7)) continue;
        if (marcador === 0xd9) break;                  // EOI
        if (marcador === 0xff) { i--; continue; }       // relleno

        if (i + 1 >= bytes.length) break;
        const largo = (bytes[i] << 8) | bytes[i + 1];
        if (largo < 2) throw new Error('segmento JPEG con largo invalido');

        // SOF0..SOF15 traen las dimensiones. Se excluyen DHT (C4), JPG (C8) y DAC (CC),
        // que caen en el mismo rango y NO son SOF.
        const esSOF = marcador >= 0xc0 && marcador <= 0xcf &&
                      marcador !== 0xc4 && marcador !== 0xc8 && marcador !== 0xcc;
        if (esSOF) {
            if (i + 7 >= bytes.length) throw new Error('SOF truncado');
            return {
                alto:  (bytes[i + 3] << 8) | bytes[i + 4],
                ancho: (bytes[i + 5] << 8) | bytes[i + 6],
                componentes: bytes[i + 7]
            };
        }
        i += largo;
    }
    throw new Error('no se encontro el SOF: JPEG incompleto o progresivo no soportado');
}

/**
 * Calcula como acomodar una imagen dentro de la pagina sin deformarla.
 * Se ajusta por el lado que sobre y se centra.
 */
function encajar(anchoImg, altoImg, pagina) {
    const escala = Math.min(pagina.ancho / anchoImg, pagina.alto / altoImg);
    const a = anchoImg * escala;
    const h = altoImg * escala;
    return { a, h, x: (pagina.ancho - a) / 2, y: (pagina.alto - h) / 2 };
}

const cod = new TextEncoder();
function txt(s) { return cod.encode(s); }

/**
 * Arma el PDF.
 *
 * @param {Uint8Array[]} jpegs  las paginas, en orden
 * @param {{pagina?: {ancho:number,alto:number}, titulo?: string}} [opciones]
 * @returns {Uint8Array}
 */
export function jpegsAPdf(jpegs, opciones = {}) {
    if (!Array.isArray(jpegs) || jpegs.length === 0) {
        throw new Error('se necesita al menos un JPEG');
    }
    const pagina = opciones.pagina || CARTA;

    const partes = [];      // trozos de bytes, en orden
    let posicion = 0;       // desplazamiento acumulado, para la tabla xref
    const desplazamientos = [];   // desplazamientos[n] = donde empieza el objeto n

    function escribir(datos) {
        const b = typeof datos === 'string' ? txt(datos) : datos;
        partes.push(b);
        posicion += b.length;
    }
    function abrirObjeto(n) {
        desplazamientos[n] = posicion;
        escribir(`${n} 0 obj\n`);
    }
    function cerrarObjeto() { escribir('endobj\n'); }

    // Numeracion: 1 catalogo, 2 arbol de paginas, y luego 3 objetos por pagina
    // (pagina, contenido, imagen).
    const n = jpegs.length;
    const idPagina    = i => 3 + i * 3;
    const idContenido = i => 4 + i * 3;
    const idImagen    = i => 5 + i * 3;
    const totalObjetos = 2 + n * 3;

    escribir('%PDF-1.4\n');
    // Comentario con bytes altos: le dice a cualquier herramienta que el archivo es binario.
    escribir(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

    abrirObjeto(1);
    escribir('<< /Type /Catalog /Pages 2 0 R >>\n');
    cerrarObjeto();

    abrirObjeto(2);
    const kids = Array.from({ length: n }, (_, i) => `${idPagina(i)} 0 R`).join(' ');
    escribir(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>\n`);
    cerrarObjeto();

    for (let i = 0; i < n; i++) {
        const jpeg = jpegs[i] instanceof Uint8Array ? jpegs[i] : new Uint8Array(jpegs[i]);
        const medida = medirJpeg(jpeg);
        const caja = encajar(medida.ancho, medida.alto, pagina);

        abrirObjeto(idPagina(i));
        escribir(
            `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pagina.ancho} ${pagina.alto}] ` +
            `/Resources << /XObject << /Im0 ${idImagen(i)} 0 R >> >> ` +
            `/Contents ${idContenido(i)} 0 R >>\n`);
        cerrarObjeto();

        // El operador cm coloca y escala la imagen; Do la dibuja.
        const flujo = `q\n${r(caja.a)} 0 0 ${r(caja.h)} ${r(caja.x)} ${r(caja.y)} cm\n/Im0 Do\nQ\n`;
        abrirObjeto(idContenido(i));
        escribir(`<< /Length ${txt(flujo).length} >>\nstream\n`);
        escribir(flujo);
        escribir('endstream\n');
        cerrarObjeto();

        const espacio = medida.componentes === 1 ? '/DeviceGray'
                      : medida.componentes === 4 ? '/DeviceCMYK'
                      : '/DeviceRGB';
        abrirObjeto(idImagen(i));
        escribir(
            `<< /Type /XObject /Subtype /Image /Width ${medida.ancho} /Height ${medida.alto} ` +
            `/ColorSpace ${espacio} /BitsPerComponent 8 /Filter /DCTDecode ` +
            `/Length ${jpeg.length} >>\nstream\n`);
        escribir(jpeg);
        escribir('\nendstream\n');
        cerrarObjeto();
    }

    // Tabla de referencias cruzadas. Cada renglon mide EXACTAMENTE 20 bytes; si no,
    // los lectores estrictos rechazan el archivo.
    const inicioXref = posicion;
    escribir(`xref\n0 ${totalObjetos + 1}\n`);
    escribir('0000000000 65535 f \n');
    for (let k = 1; k <= totalObjetos; k++) {
        escribir(String(desplazamientos[k]).padStart(10, '0') + ' 00000 n \n');
    }

    escribir(`trailer\n<< /Size ${totalObjetos + 1} /Root 1 0 R >>\n`);
    escribir(`startxref\n${inicioXref}\n%%EOF\n`);

    // Un solo arreglo con todo.
    const total = partes.reduce((s, p) => s + p.length, 0);
    const salida = new Uint8Array(total);
    let d = 0;
    for (const p of partes) { salida.set(p, d); d += p.length; }
    return salida;
}

// PDF no acepta notacion exponencial ni demasiados decimales.
function r(v) {
    return (Math.round(v * 100) / 100).toString();
}
