// Subida a SharePoint por Microsoft Graph.
//
// Todo pasa por conReintento: en un celular con datos moviles, un fallo de red o un 429
// no es una excepcion rara, es el caso normal. Lo que NO se reintenta es un 403 o un 404 —
// esos no mejoran repitiendo y solo harian esperar al operador para nada.

const REINTENTOS = 4;

/** Codigos que si vale la pena reintentar. */
function valeReintentar(estado) {
    return estado === 429 || estado === 503 || estado === 504 || estado === 0;
}

export async function conReintento(hacer, alAvisar) {
    let espera = 800;
    for (let intento = 1; intento <= REINTENTOS; intento++) {
        let r;
        try {
            r = await hacer();
        } catch (e) {
            // Fallo de red: no hay respuesta que mirar.
            if (intento === REINTENTOS) throw e;
            if (alAvisar) alAvisar(`sin conexión, reintentando (${intento}/${REINTENTOS - 1})`);
            await dormir(espera); espera *= 2;
            continue;
        }
        if (r.ok) return r;
        if (!valeReintentar(r.status) || intento === REINTENTOS) return r;

        // Si el servidor dice cuanto esperar, se le hace caso.
        const dice = Number(r.headers.get('Retry-After'));
        const cuanto = Number.isFinite(dice) && dice > 0 ? dice * 1000 : espera;
        if (alAvisar) alAvisar(`el servidor pidió esperar, reintentando (${intento}/${REINTENTOS - 1})`);
        await dormir(cuanto);
        espera *= 2;
    }
    throw new Error('se agotaron los reintentos');
}

const dormir = ms => new Promise(res => setTimeout(res, ms));

/**
 * Mensaje util a partir de una respuesta fallida.
 *
 * NO nombra la operacion ni el recurso — eso lo pone quien llama, que es el unico que lo
 * sabe. Esta funcion la usan por igual las lecturas (sitio, lista, subcarpetas) y las
 * escrituras (crear carpeta, subir), asi que un 403 que dijera "para escribir" apunta a la
 * cosa equivocada en la mitad de los casos: le paso a un operador el 2026-08-17, cuando lo
 * que le faltaba era LECTURA del sitio del catalogo y el mensaje hablaba de escritura.
 * Mismo motivo para el 404: aqui no se sabe si lo que no existe es una carpeta o un sitio.
 */
export async function motivo(r) {
    let detalle = '';
    try {
        const j = await r.json();
        detalle = j?.error?.message || j?.error?.code || '';
    } catch (_) { /* la respuesta no era JSON */ }
    if (r.status === 403) return `sin permiso (403). ${detalle}`;
    if (r.status === 404) return `no existe (404). ${detalle}`;
    if (r.status === 401) return `la sesión caducó (401). Vuelve a entrar.`;
    if (r.status === 507) return `no hay espacio en la biblioteca (507).`;
    return `HTTP ${r.status}. ${detalle}`;
}

export function crearCliente(graph, token) {
    const cab = { Authorization: 'Bearer ' + token };

    async function pedir(url, opciones = {}, avisar) {
        return conReintento(() => fetch(url, {
            ...opciones,
            headers: { ...cab, ...(opciones.headers || {}) }
        }), avisar);
    }

    return {
        /**
         * Resuelve el identificador de un sitio a partir de su ruta.
         *
         * La ruta va en el mensaje de error a proposito: es el unico dato que distingue
         * "no alcanzo la unidad que elegi" de "no alcanzo el sitio del catalogo", y sin
         * ella el 403 se lee como si fuera del destino de las fotos.
         */
        async sitio(host, ruta) {
            const r = await pedir(`${graph}/sites/${host}:${ruta}`);
            if (!r.ok) throw new Error(`no se pudo abrir el sitio ${ruta}: ` + await motivo(r));
            return (await r.json()).id;
        },

        /** ¿Existe esta carpeta? Sirve para descubrir a qué unidades alcanza el usuario. */
        async puedeVer(siteId, ruta) {
            const r = await fetch(`${graph}/sites/${siteId}/drive/root:/${rutaUrl(ruta)}`, { headers: cab });
            return r.ok;
        },

        /**
         * Los nombres de las SUBCARPETAS de una carpeta. Existe por los destinos '<base>/*'
         * del catalogo (B8): el operador elige entre las subcarpetas reales — el servicio
         * en curso dentro de 01_Servicios — y asi el destino elegido existe por
         * construccion, en vez de salir de una tabla que alguien tendria que mantener.
         */
        async subcarpetas(siteId, ruta, avisar) {
            const r = await pedir(
                `${graph}/sites/${siteId}/drive/root:/${rutaUrl(ruta)}:/children?$select=name,folder&$top=500`,
                {}, avisar);
            if (!r.ok) throw new Error(`no se pudieron leer las subcarpetas de ${ruta}: ` + await motivo(r));
            return (await r.json()).value.filter(x => x.folder).map(x => x.name);
        },

        /**
         * Crea la carpeta del lote y devuelve su ruta real.
         *
         * conflictBehavior 'rename' importa: si dos personas suben el mismo dia sobre el
         * mismo objeto y concepto, SharePoint agrega un sufijo en vez de mezclar los dos
         * lotes en una carpeta. El sufijo va al final, asi que NO rompe el patron de dos
         * guiones bajos que leen las skills de archivar.
         */
        async crearCarpeta(siteId, rutaPadre, nombre, avisar) {
            const padre = rutaPadre
                ? `${graph}/sites/${siteId}/drive/root:/${rutaUrl(rutaPadre)}:/children`
                : `${graph}/sites/${siteId}/drive/root/children`;

            const r = await pedir(padre, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: nombre,
                    folder: {},
                    '@microsoft.graph.conflictBehavior': 'rename'
                })
            }, avisar);

            if (!r.ok) throw new Error(`no se pudo crear la carpeta ${nombre} en ${rutaPadre || '(raíz)'}: ` + await motivo(r));
            const j = await r.json();
            return { nombreReal: j.name, id: j.id };
        },

        /** Sube una pieza. Con las fotos ya comprimidas siempre cabe en un PUT simple. */
        async subirPieza(siteId, rutaCarpeta, nombreArchivo, bytes, tipoMime, avisar) {
            const url = `${graph}/sites/${siteId}/drive/root:/${rutaUrl(rutaCarpeta)}/${rutaUrl(nombreArchivo)}:/content`;
            const r = await pedir(url, {
                method: 'PUT',
                headers: { 'Content-Type': tipoMime },
                body: bytes
            }, avisar);
            if (!r.ok) throw new Error(`no se pudo subir ${nombreArchivo} a ${rutaCarpeta}: ` + await motivo(r));
            return await r.json();
        },

        /** Lee los renglones de una lista. */
        async renglonesDeLista(siteId, nombreLista) {
            const l = await pedir(`${graph}/sites/${siteId}/lists?$select=id,name,displayName&$top=200`);
            if (!l.ok) throw new Error('no se pudo ver las listas de ese sitio: ' + await motivo(l));
            const lista = (await l.json()).value.find(
                x => x.displayName === nombreLista || x.name === nombreLista);
            if (!lista) throw new Error(`no existe la lista ${nombreLista} en ese sitio`);

            const r = await pedir(
                `${graph}/sites/${siteId}/lists/${lista.id}/items?expand=fields&$top=500`);
            if (!r.ok) throw new Error('no se pudieron leer los renglones: ' + await motivo(r));
            return (await r.json()).value;
        }
    };
}

/**
 * Codifica una ruta para Graph SIN destruir las diagonales que separan carpetas.
 * encodeURIComponent sobre la ruta entera convertiria '/' en '%2F' y el destino
 * '02_Planta/Equipos' se volveria el nombre de UNA sola carpeta con diagonal adentro.
 */
export function rutaUrl(ruta) {
    return String(ruta)
        .split('/')
        .filter(s => s !== '')
        .map(encodeURIComponent)
        .join('/');
}
