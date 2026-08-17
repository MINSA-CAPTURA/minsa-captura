// Service worker — sólo para que la app abra rápido y sobreviva a una señal mala.
//
// REGLA QUE NO SE TOCA (hallazgo A7 de la auditoría): aquí se cachea ÚNICAMENTE el
// armazón estático. Nada de Microsoft Graph, nada de login.microsoftonline.com. Cachear
// una respuesta de Graph dejaría datos de la empresa en el disco del teléfono, y cachear
// algo de login dejaría material de sesión. Esas peticiones se dejan pasar sin tocarlas.
//
// Ojo: un service worker se queda instalado. Si algún día hay que sacar uno malo, se sube
// el número de CACHE y se borra lo viejo en 'activate' — que es justo lo que hace esto.
//
// LA SEGUNDA CACHÉ, la que no se ve (2026-08-17). Subir el número de CACHE re-descarga el
// armazón, pero `addAll` y `fetch()` pasan por la CACHÉ HTTP del navegador, y GitHub Pages
// sirve todo con `Cache-Control: max-age=600`. O sea que el service worker nuevo se
// instalaba bien y llenaba su caché nueva con los archivos VIEJOS: el teléfono se quedaba
// en 0.6.0 con la app recién publicada y sin ningún error a la vista. Por eso cada petición
// del armazón lleva `cache: 'reload'`, que salta esa caché y va a la red de verdad.
// Sin eso, el número de CACHE da una sensación de control que no tiene.

const CACHE = 'minsa-captura-v12';

// Pide un recurso del armazón SALTÁNDOSE la caché HTTP. Es la única forma de que "versión
// nueva" signifique la del servidor y no la que el navegador guardó hace diez minutos.
function traerDeLaRed(recurso) {
    return fetch(new Request(recurso, { cache: 'reload', credentials: 'same-origin' }));
}

const ARMAZON = [
    './',
    './index.html',
    './estilo.css',
    './app.js',
    './config.js',
    './nombre.js',
    './catalogo.js',
    './imagen.js',
    './camara.js',
    './orden.js',
    './pdf.js',
    './subir.js',
    './manifiesto.js',
    './manifest.json',
    './vendor/msal-browser.min.js',
    './iconos/icono-192.png',
    './iconos/icono-512.png',
    // El recortable lo declara el manifest y faltaba aqui: sin el, instalar la app sin
    // señal deja al launcher sin el icono que usa para enmascarar.
    './iconos/icono-512-recortable.png'
];

// Se conserva la atomicidad de addAll —si una pieza falla, el armazón no se da por bueno a
// medias—, pero pidiendo cada una a la red de verdad.
self.addEventListener('install', evento => {
    evento.waitUntil(
        caches.open(CACHE)
            .then(c => Promise.all(ARMAZON.map(recurso =>
                traerDeLaRed(recurso).then(respuesta => {
                    if (!respuesta || !respuesta.ok) {
                        throw new Error(`no se pudo precargar ${recurso}`);
                    }
                    return c.put(recurso, respuesta);
                })
            )))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', evento => {
    evento.waitUntil(
        caches.keys()
            .then(llaves => Promise.all(
                llaves.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', evento => {
    const url = new URL(evento.request.url);

    // Todo lo que no sea de esta app se deja pasar SIN tocar: Graph, login, lo que sea.
    // No se intercepta, no se cachea, no se mira.
    if (url.origin !== self.location.origin) return;
    if (evento.request.method !== 'GET') return;

    // El armazón: primero la red, y si no hay, lo guardado. Así una versión nueva se
    // toma en cuanto haya señal, en vez de quedarse pegada la vieja. "La red" tiene que ser
    // la red: sin `cache: 'reload'` esto lo contesta la caché HTTP y se cachea lo viejo
    // encima de lo viejo, que es lo que dejó un teléfono en 0.6.0 con 0.6.1 ya publicada.
    evento.respondWith(
        traerDeLaRed(evento.request.url)
            .then(respuesta => {
                if (respuesta && respuesta.ok) {
                    const copia = respuesta.clone();
                    caches.open(CACHE).then(c => c.put(evento.request, copia));
                }
                return respuesta;
            })
            .catch(() => caches.match(evento.request).then(r => r || caches.match('./index.html')))
    );
});
