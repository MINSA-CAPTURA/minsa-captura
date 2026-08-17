# MINSA Captura — código de la app

PWA que sube fotos y documentos a los buzones `99_Pendiente-Archivar` de las 5 unidades.
La planeación, la auditoría de seguridad y el backlog viven **fuera de este repo**, en el acervo
privado del holding — aquí sólo va el código, porque este repo es público.

## Estado

**Paso 0 superado** (5 de 5 unidades accesibles) y la app escrita. Falta probarla en campo.

| Archivo | Qué es | Estado |
|---|---|---|
| `nombre.js` | Slug y armado de nombres de carpeta y archivo. **El contrato con las skills de archivar** | ✅ 24 pruebas |
| `manifiesto.js` | El `_lote.json` que cierra cada lote. **El otro contrato con las skills**: dice a dónde va | ✅ 30 pruebas |
| `pdf.js` | Une varios JPEG en un PDF de varias páginas, sin librerías | ✅ 13 pruebas |
| `catalogo.js` | Lee y valida los renglones de `CAT_Evidencia_MINSA` | ✅ 15 pruebas |
| `imagen.js` | Compresión de las fotos antes de subirlas | ✅ 10 pruebas |
| `subir.js` | Graph: sitios, carpetas, piezas y reintentos | ✅ 12 pruebas |
| `config.js` | `client_id`, `tenant_id` y los 5 sitios. Público por diseño, **sin secretos** | ✅ |
| `vendor/msal-browser.min.js` | MSAL, vendorizado (ver abajo) | ✅ |
| `servidor-local.js` | Servidor estático para pruebas en `localhost:8080` | ✅ |
| `index.html` · `app.js` | **La app** | ✅ escrita |
| `manifest.json` · `sw.js` · iconos | Lo que la hace instalable | ✅ 10 pruebas (`sw.js`) |

**Los dos contratos con las skills de archivar viven en `nombre.js` y `manifiesto.js`.** El primero
decide cómo se llaman las cosas; el segundo, a dónde van. Romper cualquiera de los dos manda las
fotos al buzón a quedarse ahí, **sin ningún error visible** — por eso los dos tienen pruebas que
fijan el formato, y no son de higiene.

## Pruebas

```bash
npm test
```

Corren con Node, sin navegador. No son de higiene: `nombre.js` produce el nombre de carpeta que
las skills de archivar leen para saber a dónde va cada foto, así que estas pruebas son lo único
que detecta que se rompió ese contrato **antes** de que las fotos empiecen a caer donde no van.

El PDF generado se valida además con un lector independiente (PyMuPDF), porque que mis propias
aserciones pasen no prueba que un lector real acepte el archivo:

```bash
python -c "import fitz; d=fitz.open(r'$TEMP\minsa-captura-muestra.pdf'); print(d.page_count)"
```

Las herramientas de desarrollo (`paso0.html`, `explorar.html`, `revisar-catalogo.html`)
**no viven en este repo**: hacen login real y no llevan CSP, así que no deben publicarse
con la app. Se quedan en una carpeta hermana privada y se sirven con el mismo
`servidor-local.js` cuando hacen falta.

## Cómo probar en el navegador

```bash
node servidor-local.js                                   # la app
node servidor-local.js ../herramientas-dev/paso0.html    # una herramienta de desarrollo
```

Y abrir **`http://localhost:8080/`** — la raíz, no `/paso0.html`.

> **Por qué la raíz:** cuando se prueba en local, la URL de redirección que se registra en Entra
> es exactamente `http://localhost:8080/`. Si la página se abre en otra ruta, MSAL manda esa como
> `redirectUri` y Entra la rechaza por no estar registrada. Por eso el servidor sirve el archivo
> indicado **en la raíz** en lugar de exponer el directorio.
>
> **Esa URI se quitó de Entra al publicar** (2026-08-16): el login local va a fallar con
> AADSTS50011 hasta que se re-agregue **temporalmente** en Entra → Authentication → plataforma SPA
> — y se vuelve a quitar al terminar. La app publicada no la necesita.

## Dependencias vendorizadas

Nada se carga desde un CDN: en planta la señal es mala, y además un CDN comprometido podría
inyectar código dentro de una sesión autenticada.

| Paquete | Versión | Tamaño | SHA-256 |
|---|---|---|---|
| `@azure/msal-browser` | **4.11.0** | 303,365 bytes | `bfca8e5dea51ead194c522544e3fe3284a24c9d307f40c4a1a646d4c57775bfe` |

Obtenido con `npm pack @azure/msal-browser@4.11.0` y copiado de `package/lib/msal-browser.min.js`.
**Al actualizarlo, actualizar también esta tabla** — si el hash de aquí no coincide con el del
archivo, alguien lo cambió por fuera.

```bash
sha256sum vendor/msal-browser.min.js
```

## Reglas que no se negocian

Salen de la auditoría de seguridad del diseño. No son preferencias de estilo:

- **Cache de MSAL en `sessionStorage`**, nunca `localStorage`.
- **Nunca `innerHTML` con entrada del usuario** — sólo `textContent`. Un XSS aquí no desfigura la
  página: se lleva el token.
- **El `Destino` que viene del catálogo se valida antes de usarse** (sin `..`, sin ruta absoluta,
  y el resultado tiene que quedar dentro del buzón).
- **El service worker no toca `graph.microsoft.com` ni `login.microsoftonline.com`** — sólo cachea
  el armazón estático.
- **Nunca un client secret en este repo.** La app usa PKCE; un secreto aquí no protegería nada.
- **Las herramientas de desarrollo no se publican.** Hacen login real y no llevan CSP; viven fuera
  de este repo a propósito.
- **El framebuster de `app.js` distingue el marco propio del ajeno.** El iframe oculto con el que
  MSAL renueva el token es de la misma origin y es legítimo; no "simplificar" la comprobación a un
  `self !== top` a secas, porque eso rompe `acquireTokenSilent`.

## Una trampa ya pagada

En `config.js`, el sitio de Finanzas es `/sites/Administracion-Documentos`, **no**
`/sites/Administracion-Finanzas`, aunque la carpeta de OneDrive se llame así. El sitio se renombró
después de crearse y la URL conservó el slug original. **Nunca construir la ruta de un sitio a
partir del nombre de su biblioteca** — hay que traerla verificada.
