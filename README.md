# MINSA Captura — código de la app

PWA que sube fotos y documentos a los buzones `99_Pendiente-Archivar` de las 5 unidades.
La planeación, la auditoría de seguridad y el backlog viven **fuera de este repo**, en el acervo
privado del holding — aquí sólo va el código, porque este repo es público.

## Estado

**Paso 0 superado** (5 de 5 unidades accesibles). Están hechas y probadas las dos piezas puras;
falta la pantalla.

| Archivo | Qué es | Estado |
|---|---|---|
| `nombre.js` | Slug y armado de nombres de carpeta y archivo. **El contrato con las skills de archivar** | ✅ 24 pruebas |
| `pdf.js` | Une varios JPEG en un PDF de varias páginas, sin librerías | ✅ 13 pruebas |
| `config.js` | `client_id`, `tenant_id` y los 5 sitios. Público por diseño, **sin secretos** | ✅ |
| `paso0.html` | Prueba del descubrimiento de permisos. Sólo lee | ✅ superada |
| `explorar.html` | Herramienta de desarrollo: lista las carpetas reales de las 5 bibliotecas | ✅ |
| `vendor/msal-browser.min.js` | MSAL, vendorizado (ver abajo) | ✅ |
| `servidor-local.js` | Servidor estático para pruebas en `localhost:8080` | ✅ |
| `index.html` · `app.js` | **La app** | ⏳ por escribir |
| `manifest.json` · `sw.js` · iconos | Lo que la hace instalable | ⏳ por escribir |

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

## Cómo probar en el navegador

```bash
node servidor-local.js paso0.html      # o explorar.html
```

Y abrir **`http://localhost:8080/`** — la raíz, no `/paso0.html`.

> **Por qué la raíz:** la URL de redirección registrada en Entra es exactamente
> `http://localhost:8080/`. Si la página se abre en otra ruta, MSAL manda esa como `redirectUri` y
> Entra la rechaza por no estar registrada. Por eso el servidor sirve el archivo indicado **en la
> raíz** en lugar de exponer el directorio.

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

## Una trampa ya pagada

En `config.js`, el sitio de Finanzas es `/sites/Administracion-Documentos`, **no**
`/sites/Administracion-Finanzas`, aunque la carpeta de OneDrive se llame así. El sitio se renombró
después de crearse y la URL conservó el slug original. **Nunca construir la ruta de un sitio a
partir del nombre de su biblioteca** — hay que traerla verificada.
