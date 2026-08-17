// MINSA Captura — la pantalla.
//
// Regla de esta pagina: NADA de innerHTML con datos que no controlamos (hallazgo A3).
// Un XSS aqui no desfigura la pagina, se lleva el token de sesion. Todo texto entra con
// textContent y todo nodo se crea con createElement.

// Contra el clickjacking: la defensa correcta es la cabecera frame-ancestors, pero GitHub
// Pages no permite cabeceras propias y por <meta> esa directiva no existe. Esto es lo que
// queda: si un sitio AJENO enmarca la pagina para robarle clics a un operador autenticado,
// la pagina se sale del marco — y si el marco lo impide (sandbox), al menos no arranca.
//
// OJO: el marco PROPIO es legitimo y no se toca. MSAL renueva el token en silencio
// cargando esta misma pagina en un iframe oculto de la misma origin; reventarle ese marco
// romperia acquireTokenSilent. La prueba que distingue: leer top.location solo se permite
// entre misma origin — si truena, el de afuera es ajeno.
if (window.self !== window.top) {
    let marcoAjeno = false;
    try { void window.top.location.href; } catch (_) { marcoAjeno = true; }
    if (marcoAjeno) {
        window.top.location = window.self.location;
        throw new Error('esta página no se sirve dentro de un marco ajeno');
    }
}

import { CONFIG } from './config.js';
import { slug, fechaMexico, nombreCarpeta, nombreArchivo, limpiarEtiqueta } from './nombre.js';
import { normalizarCatalogo, opcionesDe } from './catalogo.js';
import { comprimir } from './imagen.js';
import * as camara from './camara.js';
import { mover, puedeMover } from './orden.js';
import { jpegsAPdf } from './pdf.js';
import { crearCliente } from './subir.js';
import { NOMBRE_MANIFIESTO, construirManifiesto, bytesDelManifiesto } from './manifiesto.js';

const VERSION = '0.6.2';

const $ = id => document.getElementById(id);

const estado = {
    cuenta: null,
    token: null,
    cliente: null,
    unidades: [],        // las que este usuario alcanza
    unidad: null,
    catalogo: [],
    opciones: [],
    piezas: [],          // {archivo, urlPrevia, bytes, ancho, alto}
    servicios: new Map() // cache de subcarpetas por `${siteId}|${ruta}` (B8)
};

// NO llamar a esta variable `msal`: taparia el global que expone el bundle UMD.
const pca = new msal.PublicClientApplication({
    auth: {
        clientId: CONFIG.clientId,
        authority: `https://login.microsoftonline.com/${CONFIG.tenantId}`,
        // La CARPETA de la app, no la raiz del dominio. En localhost las dos coinciden,
        // pero en GitHub Pages la app vive en /minsa-captura/ y lo registrado en Entra es
        // exactamente esa URL con su barra final: origin + '/' mandaria la raiz del
        // dominio y Entra la rechazaria (AADSTS50011).
        redirectUri: new URL('./', window.location.href).href
    },
    cache: {
        // sessionStorage, NUNCA localStorage (hallazgo A13): el escenario mas probable
        // no es un hacker, es un celular que se queda sobre una mesa.
        cacheLocation: 'sessionStorage',
        storeAuthStateInCookie: false
    }
});

// ---------------------------------------------------------------- avisos

function avisar(texto, clase = '') {
    const d = document.createElement('div');
    d.className = 'mensaje' + (clase ? ' ' + clase : '');
    d.textContent = texto;
    $('avisos').appendChild(d);
    return d;
}
function limpiarAvisos() { $('avisos').textContent = ''; }

// ---------------------------------------------------------------- sesión

async function token() {
    const cuentas = pca.getAllAccounts();
    try {
        const r = await pca.acquireTokenSilent({ scopes: CONFIG.scopes, account: cuentas[0] });
        return r.accessToken;
    } catch (_) {
        return (await pca.acquireTokenPopup({ scopes: CONFIG.scopes })).accessToken;
    }
}

// El login va por REDIRECCION, no por ventana emergente (v0.4.2). El popup dependia de
// que la ventanita conservara el vinculo con la pagina que la abrio, y en celulares se
// rompe con facilidad: el navegador integrado de WhatsApp la abre como pestana suelta,
// la respuesta de Microsoft aterriza sin su solicitud en sessionStorage y MSAL truena
// con no_token_request_cache_error (le paso a la primera operadora real, 2026-08-16).
// Con loginRedirect la PROPIA pagina va a Microsoft y regresa: no hay segunda ventana
// que perder. Es ademas lo que MSAL recomienda para moviles/PWA.

let msalListo = false;

async function prepararMsal() {
    if (msalListo) return null;
    await pca.initialize();
    // Procesa el retorno de Microsoft si esta carga viene de un loginRedirect. Tiene que
    // correr en CADA carga de la pagina, no solo al picar el boton: el regreso del login
    // es una carga nueva donde nadie ha picado nada.
    const respuesta = await pca.handleRedirectPromise();
    msalListo = true;
    return respuesta;
}

async function sesionIniciada() {
    estado.cuenta = pca.getAllAccounts()[0];
    estado.token = await token();
    estado.cliente = crearCliente(CONFIG.graph, estado.token);
    $('quien').textContent = estado.cuenta.username;
    $('btnSalir').classList.remove('oculto');

    $('textoEntrar').textContent = 'Buscando a qué áreas tienes acceso…';
    await descubrirUnidades();
    await cargarCatalogo();

    pintarUnidades();
    $('pantallaEntrar').classList.add('oculto');
    $('pantallaUnidad').classList.remove('oculto');

    // Si sólo alcanza un área, no tiene caso hacerle elegir.
    if (estado.unidades.length === 1) {
        elegirUnidad(estado.unidades[0], $('fichasUnidad').firstElementChild);
    }
}

async function entrar() {
    $('btnEntrar').disabled = true;
    $('textoEntrar').textContent = 'Entrando…';
    try {
        await prepararMsal();
        if (pca.getAllAccounts().length === 0) {
            // La pagina entera navega a Microsoft; al volver, arrancar() retoma.
            await pca.loginRedirect({ scopes: CONFIG.scopes });
            return;
        }
        await sesionIniciada();
    } catch (e) {
        avisar('No se pudo entrar: ' + (e && e.message ? e.message : e), 'error');
        $('btnEntrar').disabled = false;
        $('textoEntrar').textContent = 'Vuelve a intentarlo.';
    }
}

// Corre en cada carga: si esta pagina es el REGRESO de un loginRedirect (o ya hay sesion
// viva en esta pestana), entra sola sin esperar otro clic. Y si el retorno no se puede
// procesar, lo dice y deja el boton vivo para reintentar limpio — antes ese caso era un
// callejon sin salida.
async function arrancar() {
    // El marco PROPIO es la renovacion silenciosa de MSAL (ver el framebuster arriba):
    // esa carga no debe arrancar la app ni sondear Graph — el padre solo lee el hash.
    if (window.self !== window.top) return;
    try {
        const respuesta = await prepararMsal();
        if (respuesta || pca.getAllAccounts().length > 0) {
            $('btnEntrar').disabled = true;
            $('textoEntrar').textContent = 'Entrando…';
            await sesionIniciada();
        }
    } catch (e) {
        avisar('No se pudo terminar el inicio de sesión: ' +
               (e && e.message ? e.message : e), 'error');
        $('btnEntrar').disabled = false;
        $('textoEntrar').textContent = 'Vuelve a picar Entrar.';
    }
}

// Con Sites.Selected la app solo alcanza los sitios autorizados, y encima aplican los
// permisos de la persona. Sondear los 5 y quedarse con los que contestan ES la respuesta
// completa a "¿a qué puede escribir este usuario?".
async function descubrirUnidades() {
    const encontradas = [];
    for (const u of CONFIG.unidades) {
        try {
            const siteId = await estado.cliente.sitio(CONFIG.sharepointHost, u.ruta);
            if (await estado.cliente.puedeVer(siteId, CONFIG.buzon)) {
                encontradas.push({ ...u, siteId });
            }
        } catch (_) { /* sin acceso: simplemente no se muestra */ }
    }
    estado.unidades = encontradas;
    if (encontradas.length === 0) {
        throw new Error('tu cuenta no tiene acceso de escritura a ninguna de las áreas');
    }
}

async function cargarCatalogo() {
    try {
        const siteId = await estado.cliente.sitio(CONFIG.sharepointHost, CONFIG.catalogo.ruta);
        const crudos = await estado.cliente.renglonesDeLista(siteId, CONFIG.catalogo.lista);
        const { opciones, descartados } = normalizarCatalogo(crudos);
        estado.catalogo = opciones;
        if (descartados.length) {
            // Se dice, no se esconde: un renglon mal capturado hace desaparecer una opción
            // del desplegable, y sin aviso nadie entendería por qué.
            avisar(`Hay ${descartados.length} opción(es) del catálogo mal capturadas y no se ` +
                   `van a mostrar: ${descartados.map(d => d.motivo).join(' · ')}`, 'ojo');
        }
    } catch (e) {
        // El catalogo vive en un sitio APARTE del de la unidad, asi que este fallo no lo
        // puede arreglar el operador aunque alcance su propia biblioteca: le falta lectura
        // en el sitio del catalogo, y eso lo otorga Carlos. El mensaje lo dice porque el
        // 2026-08-17 un operador quedo trabado aqui creyendo que era su sesion.
        throw new Error(
            `no se pudo leer el catálogo (lista ${CONFIG.catalogo.lista} en ` +
            `${CONFIG.catalogo.ruta}). ${e && e.message ? e.message : e} — si dice "sin ` +
            `permiso", pídele a Carlos acceso de LECTURA a ese sitio: no es tu sesión.`);
    }
}

// ---------------------------------------------------------------- unidad

function pintarUnidades() {
    const cont = $('fichasUnidad');
    cont.textContent = '';
    for (const u of estado.unidades) {
        const b = document.createElement('button');
        // La clase de rama solo pinta la rayita indicadora; el nombre y la rama van como
        // texto, siempre con textContent (regla A3: nada de innerHTML).
        b.className = 'ficha' + (u.rama ? ` rama-${u.rama}` : '');
        b.type = 'button';
        const nombre = document.createElement('span');
        nombre.className = 'n';
        nombre.textContent = u.nombre;
        b.appendChild(nombre);
        if (u.ramaNombre) {
            const rama = document.createElement('span');
            rama.className = 'r';
            rama.textContent = u.ramaNombre;
            b.appendChild(rama);
        }
        b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', () => elegirUnidad(u, b));
        cont.appendChild(b);
    }
}

function elegirUnidad(u, boton) {
    estado.unidad = u;
    for (const b of $('fichasUnidad').children) b.setAttribute('aria-pressed', 'false');
    boton.setAttribute('aria-pressed', 'true');

    estado.opciones = opcionesDe(estado.catalogo, u.clave);
    const sel = $('selEtiqueta');
    sel.textContent = '';
    $('selServicio').textContent = '';   // lo de otra unidad no debe sobrevivir aqui
    if (estado.opciones.length === 0) {
        const o = document.createElement('option');
        o.textContent = '(esta área no tiene opciones en el catálogo)';
        sel.appendChild(o);
        sel.disabled = true;
    } else {
        sel.disabled = false;
        // Un <select> preselecciona su primera <option>, asi que sin este renglon vacio la
        // guarda de btnEnviar no puede bloquear NUNCA por falta de etiqueta: el lote saldria
        // rotulado con la primera del catalogo sin que nadie la eligiera. La guarda existiria,
        // se leeria bien, y no protegeria nada (obs. 387).
        const vacia = document.createElement('option');
        vacia.value = '';
        vacia.textContent = '— elige —';
        sel.appendChild(vacia);
        for (const op of estado.opciones) {
            const o = document.createElement('option');
            o.value = op.etiqueta;
            o.textContent = op.etiqueta;
            sel.appendChild(o);
        }
    }
    $('pantallaCaptura').classList.remove('oculto');
    alCambiar();
    $('pantallaCaptura').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function opcionActual() {
    return estado.opciones.find(o => o.etiqueta === $('selEtiqueta').value) || null;
}

// ---------------------------------------------------------------- servicio (B8)

// Una opcion cuyo destino trae el marcador '/*' en el catalogo (hoy: la evidencia de
// servicio de PITEPEC) no tiene destino final fijo: el operador elige la subcarpeta REAL
// — el servicio en curso — y el lote declara `01_Servicios/<ese servicio>` en su
// manifiesto. La lista se lee de la biblioteca, no de una tabla: un servicio nuevo
// aparece solo, y el destino elegido existe por construccion.

function pintarServicios(op, fase) {
    const sel = $('selServicio');
    sel.textContent = '';
    const agregar = (valor, textoOpcion) => {
        const o = document.createElement('option');
        o.value = valor;
        o.textContent = textoOpcion;
        sel.appendChild(o);
    };
    if (fase === 'cargando') {
        agregar('', 'Cargando…');
        sel.disabled = true;
        return;
    }
    if (fase === 'fallo') {
        agregar('', '(no se pudo leer la lista — vuelve a elegir el tipo, o usa Otro)');
        sel.disabled = true;
        return;
    }
    const nombres = estado.servicios.get(`${estado.unidad.siteId}|${op.destino}`) || [];
    if (nombres.length === 0) {
        agregar('', '(no hay servicios abiertos)');
        sel.disabled = true;
        return;
    }
    sel.disabled = false;
    agregar('', '— elige —');
    for (const n of nombres) agregar(n, n);
}

async function cargarServicios(op) {
    const llave = `${estado.unidad.siteId}|${op.destino}`;
    if (!estado.servicios.has(llave)) {
        pintarServicios(op, 'cargando');
        try {
            const nombres = await estado.cliente.subcarpetas(estado.unidad.siteId, op.destino);
            // El nombre empieza por la fecha: en orden inverso, lo mas reciente queda arriba.
            nombres.sort((a, b) => b.localeCompare(a, 'es'));
            estado.servicios.set(llave, nombres);
        } catch (_) {
            // No se guarda nada: volver a elegir el tipo reintenta la lectura.
        }
    }
    if (opcionActual() !== op) return;   // mientras cargaba, eligieron otra cosa
    pintarServicios(op, estado.servicios.has(llave) ? 'listo' : 'fallo');
    alCambiar();
}

// ---------------------------------------------------------------- piezas

// La unica puerta por la que una imagen entra al lote, venga del archivo del celular o del
// visor de la camara. Devuelve la pieza para quien necesite su miniatura de inmediato.
async function agregarImagen(imagen) {
    const r = await comprimir(imagen);
    const pieza = {
        bytes: r.bytes,
        urlPrevia: URL.createObjectURL(new Blob([r.bytes], { type: 'image/jpeg' }))
    };
    estado.piezas.push(pieza);
    return pieza;
}

async function agregarArchivos(lista) {
    const archivos = Array.from(lista || []).filter(f => f.type.startsWith('image/'));
    if (archivos.length === 0) return;

    const trabajando = avisar(`Preparando ${archivos.length} foto(s)…`);
    for (const archivo of archivos) {
        try {
            await agregarImagen(archivo);
        } catch (e) {
            avisar(`No se pudo preparar ${archivo.name}: ${e.message}`, 'error');
        }
    }
    trabajando.remove();
    alCambiar();
}

// ---------------------------------------------------------------- cámara integrada

// El visor se queda ABIERTO entre disparo y disparo: se toma una foto, se cambia de angulo y
// se vuelve a disparar sin regresar a la pantalla. Con la camara nativa (`capture`) eso no se
// puede — el sistema toma UNA y devuelve la app —, y documentar un equipo desde varios
// angulos costaba un viaje de ida y vuelta por foto.

const visor = { stream: null, ocupado: false };

function pintarCuentaCamara() {
    const esDoc = !!(opcionActual() && opcionActual().tipo === 'documento');
    const n = estado.piezas.length;
    const cosa = esDoc ? 'hoja' : 'foto';
    $('camaraCuenta').textContent = n === 0
        ? `Sin ${cosa}s todavía`
        : `${n} ${cosa}${n === 1 ? '' : 's'} en este lote`;
}

async function abrirVisor() {
    // Se descubre y se muestra ANTES de pedir la camara: iOS no reproduce un <video> que
    // esta en un contenedor con display:none, y ahi el visor arrancaria en negro.
    $('camara').classList.remove('oculto');
    document.body.classList.add('con-camara');
    $('camaraUltima').hidden = true;
    $('camaraUltima').removeAttribute('src');
    pintarCuentaCamara();

    try {
        visor.stream = await camara.abrir($('camaraVideo'));
    } catch (e) {
        cerrarVisor();
        // No se abre la camara nativa por cuenta propia: entre el aviso de permiso y la
        // respuesta se pierde el gesto del usuario, y el navegador bloquearia ese clic
        // automatico sin decir nada. Se dice que hacer y el boton esta ahi abajo.
        avisar(camara.mensajeDeFallo(e), 'ojo');
    }
}

function cerrarVisor() {
    camara.cerrar(visor.stream, $('camaraVideo'));
    visor.stream = null;
    $('camara').classList.add('oculto');
    document.body.classList.remove('con-camara');
}

async function disparar() {
    // La compresion de un cuadro de 2560 px tarda un momento en un celular. Sin este cerrojo,
    // dos piquetes seguidos meten dos veces la MISMA foto — y en un documento eso es una hoja
    // duplicada que ya nadie distingue de una hoja repetida a proposito.
    if (visor.ocupado || !visor.stream) return;
    visor.ocupado = true;
    $('camaraDisparo').disabled = true;
    try {
        const foto = await camara.capturar($('camaraVideo'));
        const pieza = await agregarImagen(foto);

        $('camaraDestello').classList.remove('dispara');
        void $('camaraDestello').offsetWidth;      // reinicia la animación
        $('camaraDestello').classList.add('dispara');
        if (navigator.vibrate) navigator.vibrate(30);

        const ultima = $('camaraUltima');
        ultima.src = pieza.urlPrevia;
        ultima.hidden = false;

        alCambiar();                 // deja lista la pantalla de atrás
        pintarCuentaCamara();
    } catch (e) {
        avisar('No se pudo guardar la foto: ' + (e && e.message ? e.message : e), 'error');
    } finally {
        visor.ocupado = false;
        $('camaraDisparo').disabled = false;
    }
}

// Un solo repintado para todo lo que depende del estado: `alCambiar` es la unica puerta y
// llama a esto. Antes cada sitio que tocaba las piezas tenia que acordarse de llamar a las
// dos, y el desplegable —que cambia si la numeracion dice "Foto" o "Hoja"— solo llamaba a una.
//
// PERO `alCambiar` corre en cada TECLA del concepto, y volver a crear los <img> en cada tecla
// parpadea con 10 fotos en un celular. La firma es lo que hace que la unica-puerta no cueste:
// si las piezas y su orden no cambiaron, no se repinta.
let firmaPintada = null;

function pintarMiniaturas(esDoc) {
    const firma = estado.piezas.map(p => p.urlPrevia).join('|') + '#' + (esDoc ? 'doc' : 'foto');
    if (firma === firmaPintada) return;
    firmaPintada = firma;

    const cont = $('miniaturas');
    cont.textContent = '';
    const total = estado.piezas.length;
    const cosa = esDoc ? 'hoja' : 'foto';

    estado.piezas.forEach((p, i) => {
        const caja = document.createElement('div');
        caja.className = 'mini';

        const marco = document.createElement('div');
        marco.className = 'lienzo';

        const img = document.createElement('img');
        img.src = p.urlPrevia;
        img.alt = `${esDoc ? 'Hoja' : 'Foto'} ${i + 1} de ${total}`;
        marco.appendChild(img);

        const num = document.createElement('span');
        num.className = 'num';
        // Para un documento el numero NO es decorativo: es la hoja que va a quedar en esa
        // posicion del PDF. Se rotula para que el operador pueda cotejarlo contra el papel.
        num.textContent = esDoc
            ? `Hoja ${String(i + 1).padStart(2, '0')}`
            : String(i + 1).padStart(2, '0');
        marco.appendChild(num);

        const quitar = document.createElement('button');
        quitar.className = 'quitar';
        quitar.type = 'button';
        quitar.textContent = '×';
        quitar.title = 'Quitar';
        quitar.setAttribute('aria-label', `Quitar la ${cosa} ${i + 1}`);
        quitar.addEventListener('click', () => {
            URL.revokeObjectURL(p.urlPrevia);
            estado.piezas.splice(i, 1);
            alCambiar();
        });
        marco.appendChild(quitar);
        caja.appendChild(marco);

        // Los controles de orden solo aparecen si hay a donde mover. Con una sola pieza serian
        // dos botones muertos ocupando el dedo.
        if (total > 1) {
            const fila = document.createElement('div');
            fila.className = 'orden';
            for (const [delta, glifo, dice] of [[-1, '◀', 'antes'], [1, '▶', 'después']]) {
                const b = document.createElement('button');
                b.type = 'button';
                b.textContent = glifo;
                b.disabled = !puedeMover(estado.piezas, i, delta);
                b.title = `Mover esta ${cosa} un lugar ${dice}`;
                b.setAttribute('aria-label', `Mover la ${cosa} ${i + 1} un lugar ${dice}`);
                b.addEventListener('click', () => {
                    estado.piezas = mover(estado.piezas, i, delta);
                    alCambiar();
                });
                fila.appendChild(b);
            }
            caja.appendChild(fila);
        }

        cont.appendChild(caja);
    });

    const kb = estado.piezas.reduce((s, p) => s + p.bytes.length, 0) / 1024;
    const peso = kb > 1024 ? (kb / 1024).toFixed(1) + ' MB' : Math.round(kb) + ' KB';
    if (total === 0) {
        $('pistaPiezas').textContent = esDoc
            ? 'Todavía no hay hojas.'
            : 'Todavía no hay fotos.';
    } else if (esDoc) {
        // El aviso existe porque el defecto NO se ve despues: un PDF desordenado es un PDF
        // valido, y ni la app ni la skill de archivar tienen con que notarlo. La unica
        // oportunidad de cazarlo es aqui, con el papel todavia enfrente (2026-08-16).
        $('pistaPiezas').textContent =
            `${total} hoja(s) · ${peso} · El PDF se arma EN ESTE ORDEN` +
            (total > 1 ? '. Revísalo contra el documento y corrígelo con ◀ ▶ antes de enviar.' : '.');
    } else {
        $('pistaPiezas').textContent = `${total} foto(s) · ${peso} en total`;
    }
}

// ---------------------------------------------------------------- previa y validación

function alCambiar() {
    const op = opcionActual();
    const concepto = $('txtConcepto').value;
    const s = slug(concepto);
    const fecha = fechaMexico();

    const esDoc = op && op.tipo === 'documento';
    $('tituloPiezas').textContent = esDoc ? 'Páginas del documento' : 'Fotos';
    $('btnCamara').textContent = esDoc ? 'Fotografiar el documento' : 'Tomar fotos';
    // Se nombra por lo que la distingue del botón de arriba, que es el ritmo — no por la
    // marca de la cámara: «una por una» es lo que el operador va a sentir.
    $('btnCamaraNativa').textContent = esDoc
        ? 'Cámara del teléfono (hoja por hoja)'
        : 'Cámara del teléfono (una por una)';
    pintarMiniaturas(esDoc);

    // El campo de servicio solo existe para las opciones que lo piden (B8).
    const pideServicio = !!(op && op.elegirSubcarpeta);
    $('campoServicio').classList.toggle('oculto', !pideServicio);
    const servicio = pideServicio ? $('selServicio').value : '';

    const previa = $('previa');
    previa.textContent = '';
    if (!op || !estado.unidad) { previa.textContent = '—'; }
    else {
        const carpeta = nombreCarpeta(fecha, op.etiqueta, s);
        const lineas = [`${CONFIG.buzon}/${carpeta}/`];
        if (esDoc) {
            lineas.push(`   ${nombreArchivo(fecha, estado.unidad.clave, 'documento', s)}` +
                        `   (${estado.piezas.length || 1} página(s) en un solo PDF)`);
        } else {
            const n = Math.max(estado.piezas.length, 1);
            lineas.push(`   ${nombreArchivo(fecha, estado.unidad.clave, 'foto', s, 1)}`);
            if (n > 1) lineas.push(`   … hasta -${String(n).padStart(2, '0')}.jpg`);
        }
        if (pideServicio && servicio) {
            lineas.push(`   → se archivará en: ${op.destino}/${servicio}/`);
        }
        previa.textContent = lineas.join('\n');
    }

    $('pistaConcepto').textContent = concepto.trim()
        ? `Se guardará como: ${s}`
        : 'Sin esto no se puede enviar: es lo que permite encontrarlo después.';

    $('btnEnviar').disabled = !(
        estado.unidad && op && concepto.trim() && estado.piezas.length > 0 &&
        (!pideServicio || servicio)
    );
}

// ---------------------------------------------------------------- enviar

async function enviar() {
    const op = opcionActual();
    if (!op || !estado.unidad || estado.piezas.length === 0) return;

    // El destino del manifiesto: fijo, o armado con el servicio elegido (B8). El nombre
    // del servicio viene de la propia biblioteca (subcarpetas reales), no de texto libre.
    const servicio = op.elegirSubcarpeta ? $('selServicio').value : '';
    if (op.elegirSubcarpeta && !servicio) return;
    const destinoLote = op.elegirSubcarpeta ? `${op.destino}/${servicio}` : op.destino;

    $('btnEnviar').disabled = true;
    $('avance').classList.remove('oculto');
    limpiarAvisos();

    const fecha = fechaMexico();
    const s = slug($('txtConcepto').value);
    const unidad = estado.unidad;
    const esDoc = op.tipo === 'documento';

    // +1 por la carpeta y +1 por el manifiesto del final.
    const total = (esDoc ? 1 : estado.piezas.length) + 1;
    let hechas = 0;
    const paso = t => { $('textoAvance').textContent = t; };
    const barra = () => { $('barraAvance').style.width = `${Math.round(hechas / (total + 1) * 100)}%`; };

    try {
        // El token pudo caducar mientras se tomaban las fotos.
        estado.token = await token();
        estado.cliente = crearCliente(CONFIG.graph, estado.token);

        paso('Creando la carpeta…');
        // La carpeta del lote va SIEMPRE en el buzón, no en el destino final: el destino
        // lo aplica la skill de archivar al acomodarla. La app apunta, no archiva — pero
        // deja apuntado a dónde, en el manifiesto que se sube al cerrar.
        const { nombreReal } = await estado.cliente.crearCarpeta(
            unidad.siteId, CONFIG.buzon, nombreCarpeta(fecha, op.etiqueta, s), paso);
        hechas++; barra();

        const rutaLote = `${CONFIG.buzon}/${nombreReal}`;
        const subidos = [];

        if (esDoc) {
            paso('Armando el PDF…');
            const pdf = jpegsAPdf(estado.piezas.map(p => p.bytes));
            const nombre = nombreArchivo(fecha, unidad.clave, 'documento', s);
            paso('Subiendo el documento…');
            await estado.cliente.subirPieza(
                unidad.siteId, rutaLote, nombre, pdf, 'application/pdf', paso);
            subidos.push(nombre);
            hechas++; barra();
        } else {
            for (let i = 0; i < estado.piezas.length; i++) {
                const nombre = nombreArchivo(fecha, unidad.clave, 'foto', s, i + 1);
                paso(`Subiendo foto ${i + 1} de ${estado.piezas.length}…`);
                await estado.cliente.subirPieza(
                    unidad.siteId, rutaLote, nombre,
                    estado.piezas[i].bytes, 'image/jpeg', paso);
                subidos.push(nombre);
                hechas++; barra();
            }
        }

        // AL FINAL y no antes: que el manifiesto exista es la prueba de que el lote subió
        // completo. Si la subida se corta a la mitad, la carpeta queda sin él y la skill de
        // archivar la reporta como incompleta en vez de darla por buena.
        paso('Cerrando el lote…');
        const manifiesto = construirManifiesto({
            appVersion: VERSION,
            unidad: unidad.clave,
            etiqueta: op.etiqueta,
            destino: destinoLote,
            tipo: op.tipo,
            fecha,
            concepto: $('txtConcepto').value.trim(),
            archivos: subidos,
            // Las fotos que entraron, no los archivos que salieron: para un documento son
            // N hojas dentro de UN solo PDF, y esa cuenta no se puede reconstruir despues.
            paginas: estado.piezas.length
        });
        await estado.cliente.subirPieza(
            unidad.siteId, rutaLote, NOMBRE_MANIFIESTO,
            bytesDelManifiesto(manifiesto), 'application/json', paso);
        hechas++; barra();

        $('barraAvance').style.width = '100%';
        paso('Listo.');
        // La confirmación es una pantalla, no un mensajito: el operador acaba de soltar
        // evidencia y merece ver QUÉ se fue y CUÁNTO antes de decidir si captura otro.
        // Los datos se toman ANTES de reiniciar, que vacía las piezas.
        $('exitoQue').textContent = `${op.etiqueta} · ${unidad.nombre}`;
        $('exitoCuanto').textContent = esDoc
            ? `${estado.piezas.length} hoja(s) → un solo PDF`
            : `${estado.piezas.length} foto(s)`;
        $('exitoDestino').textContent = nombreReal;
        reiniciarLote();
        $('pantallaCaptura').classList.add('oculto');
        $('pantallaUnidad').classList.add('oculto');
        $('pantallaExito').classList.remove('oculto');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
        avisar('No se pudo terminar: ' + (e && e.message ? e.message : e), 'error');
        avisar('Lo que ya subió se quedó en la carpeta, pero el lote quedó SIN CERRAR: ' +
               'nadie lo va a archivar así. Vuelve a intentar; si insiste, avísale a Carlos.',
               'ojo');
        $('btnEnviar').disabled = false;
    }
}

function reiniciarLote() {
    for (const p of estado.piezas) URL.revokeObjectURL(p.urlPrevia);
    estado.piezas = [];
    $('txtConcepto').value = '';
    alCambiar();
    $('avance').classList.add('oculto');
    $('barraAvance').style.width = '0';
}

// ---------------------------------------------------------------- arranque

// Cerrar sesion de verdad (hallazgo A13: el telefono prestado). No basta con limpiar el
// sessionStorage de esta pagina: la sesion de Microsoft del navegador seguiria viva y el
// siguiente "Entrar" volveria a entrar sin pedir nada. logoutRedirect cierra las dos.
async function salir() {
    try {
        await pca.logoutRedirect({ account: estado.cuenta });
    } catch (_) {
        // Sin red no se puede cerrar en el servidor; al menos se limpia lo local.
        sessionStorage.clear();
        window.location.reload();
    }
}

$('btnEntrar').addEventListener('click', entrar);
$('btnSalir').addEventListener('click', salir);
$('btnOtro').addEventListener('click', () => {
    $('pantallaExito').classList.add('oculto');
    $('pantallaUnidad').classList.remove('oculto');
    $('pantallaCaptura').classList.remove('oculto');
    $('pantallaUnidad').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
// La cámara integrada es la ruta normal; si este navegador no la tiene, el botón principal
// cae en la cámara nativa y el segundo botón sobra — dos botones que hacen lo mismo son una
// pregunta que el operador no tiene por qué contestar.
const hayVisor = camara.soportada();
$('btnCamara').addEventListener('click', () => {
    if (hayVisor) abrirVisor(); else $('entradaCamara').click();
});
if (!hayVisor) $('btnCamaraNativa').classList.add('oculto');
$('btnCamaraNativa').addEventListener('click', () => $('entradaCamara').click());
$('camaraDisparo').addEventListener('click', disparar);
$('camaraListo').addEventListener('click', cerrarVisor);
$('camaraCerrar').addEventListener('click', cerrarVisor);
// Escape cierra: en la PWA de escritorio (Carlos revisando desde la computadora) es el
// reflejo, y sin esto el visor se queda encima sin salida evidente.
document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && visor.stream) cerrarVisor();
});
// Al volver de otra app, iOS deja el <video> pausado y el visor se ve congelado. Ojo: no es
// un error, así que sin esto el operador dispararía sobre una imagen vieja.
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && visor.stream) $('camaraVideo').play().catch(() => {});
});
$('btnGaleria').addEventListener('click', () => $('entradaGaleria').click());
$('entradaCamara').addEventListener('change', e => { agregarArchivos(e.target.files); e.target.value = ''; });
$('entradaGaleria').addEventListener('change', e => { agregarArchivos(e.target.files); e.target.value = ''; });
$('selEtiqueta').addEventListener('change', () => {
    const op = opcionActual();
    if (op && op.elegirSubcarpeta) cargarServicios(op);
    alCambiar();
});
$('selServicio').addEventListener('change', alCambiar);
$('txtConcepto').addEventListener('input', alCambiar);
$('btnEnviar').addEventListener('click', enviar);

$('pie').textContent = `MINSA Captura ${VERSION}`;

arrancar();

// El service worker, y la otra mitad que faltaba: darse cuenta de que hay versión nueva.
//
// Registrar no es enterarse. Un service worker ya instalado sigue sirviendo su armazón, y
// el navegador sólo busca uno nuevo cuando le toca; el operador puede picar "recargar" y
// seguir viendo la versión vieja sin ningún error — le pasó a Carlos con 0.6.1 ya
// publicada. `update()` lo pregunta de frente en cada carga, y cuando el service worker
// nuevo toma el control se recarga la página UNA vez para que corra el código nuevo.
if ('serviceWorker' in navigator) {
    // Si no había controlador, esta carga ES la primera instalación: ahí `controllerchange`
    // dispara solo, y recargar sería un rebote gratis en la cara del operador.
    const habiaControlador = !!navigator.serviceWorker.controller;
    let recargando = false;

    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!habiaControlador || recargando) return;
        recargando = true;
        window.location.reload();
    });

    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(registro => registro.update())
            .catch(() => { /* sin sw se vive igual */ });
    });
}
