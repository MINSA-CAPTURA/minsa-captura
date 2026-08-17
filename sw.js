// Service worker — sólo para que la app abra rápido y sobreviva a una señal mala.
//
// REGLA QUE NO SE TOCA (hallazgo A7 de la auditoría): aquí se cachea ÚNICAMENTE el
// armazón estático. Nada de Microsoft Graph, nada de login.microsoftonline.com. Cachear
// una respuesta de Graph dejaría datos de la empresa en el disco del teléfono, y cachear
// algo de login dejaría material de sesión. Esas peticiones se dejan pasar sin tocarlas.
//
// Ojo: un service worker se queda instalado. Si algún día hay que sacar uno malo, se sube
// el número de CACHE y se borra lo viejo en 'activate' — que es justo lo que hace esto.

const CACHE = 'minsa-captura-v9';

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
    './iconos/icono-512.png'
];

self.addEventListener('install', evento => {
    evento.waitUntil(
        caches.open(CACHE)
            .then(c => c.addAll(ARMAZON))
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
    // toma en cuanto haya señal, en vez de quedarse pegada la vieja.
    evento.respondWith(
        fetch(evento.request)
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
