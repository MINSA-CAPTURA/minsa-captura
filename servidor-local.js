// Servidor estatico minimo para probar la app en http://localhost:8080/
//
//   node servidor-local.js            -> sirve index.html en la raiz
//   node servidor-local.js paso0.html -> sirve paso0.html en la raiz
//
// Sirve el archivo indicado EN LA RAIZ a proposito: la URL de redireccion registrada en
// Entra es exactamente 'http://localhost:8080/'. Si la pagina se abriera como
// '/paso0.html', MSAL mandaria esa como redirectUri y Entra la rechazaria por no estar
// registrada. Este es el tipo de detalle que cuesta media hora de depuracion.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// En modulos ES no existe __dirname. import.meta.dirname llega en Node 20.11+;
// el fallback cubre versiones anteriores.
const RAIZ = import.meta.dirname || path.dirname(fileURLToPath(import.meta.url));
const PUERTO = 8080;
const INDICE = process.argv[2] || 'index.html';

const TIPOS = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'text/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.svg':  'image/svg+xml',
    '.ico':  'image/x-icon'
};

const servidor = http.createServer((req, res) => {
    // Buzon de ida y vuelta para las herramientas de desarrollo: la pagina manda lo que
    // encontro y aterriza en un archivo local, para no tener que copiar y pegar a mano.
    // Solo existe en este servidor de pruebas; no es parte de la app.
    if (req.method === 'POST' && req.url === '/guardar') {
        let cuerpo = '';
        req.on('data', d => { cuerpo += d; if (cuerpo.length > 5e6) req.destroy(); });
        req.on('end', () => {
            const destino = path.join(RAIZ, '_salida-dev.json');
            fs.writeFileSync(destino, cuerpo, 'utf8');
            console.log(`  GUARDADO  ${cuerpo.length} bytes -> ${destino}`);
            res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
        });
        return;
    }

    let rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/') rel = '/' + INDICE;

    // Sin salto de ruta: se resuelve y se exige que quede dentro de RAIZ.
    const destino = path.resolve(RAIZ, '.' + rel);
    if (!destino.startsWith(RAIZ)) {
        res.writeHead(403).end('403');
        return;
    }

    fs.readFile(destino, (err, datos) => {
        if (err) {
            console.log(`  404  ${rel}`);
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 — no existe ' + rel);
            return;
        }
        const tipo = TIPOS[path.extname(destino).toLowerCase()] || 'application/octet-stream';
        console.log(`  200  ${rel}`);
        res.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': 'no-store' }).end(datos);
    });
});

servidor.listen(PUERTO, () => {
    console.log('');
    console.log(`Sirviendo ${RAIZ}`);
    console.log(`Indice: ${INDICE}`);
    console.log('');
    console.log(`  ABRE:  http://localhost:8080/`);
    console.log('');
    console.log('(Ctrl+C para detener)');
    console.log('');
});
