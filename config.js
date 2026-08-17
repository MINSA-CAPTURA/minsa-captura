// Configuracion de MINSA Captura.
//
// TODO ESTO ES PUBLICO POR DISENO. En una app de pagina unica el client id y el tenant id
// no son secretos: lo que impide que alguien monte una pagina falsa con este client id es
// la lista de URL de redireccion registradas en Entra, no el secreto de estos valores.
// NUNCA agregar aqui un client secret: esta app no lleva ninguno.

export const CONFIG = {
    clientId: '53cabe0b-f367-4167-b700-ed62df200482',
    tenantId: 'c28754af-c62e-44db-a72a-3eeab634074b',

    // Con Sites.Selected el token NO alcanza nada por si mismo: el acceso lo dan los
    // permisos otorgados sitio por sitio (docs/otorgar-permisos-sitios.ps1).
    scopes: ['https://graph.microsoft.com/Sites.Selected'],

    graph: 'https://graph.microsoft.com/v1.0',
    sharepointHost: 'minsaenergy.sharepoint.com',

    // El buzon donde aterriza todo lo que sube la app.
    buzon: '99_Pendiente-Archivar',

    // El catalogo vive en el sitio de la RAMA Administracion, no en el de una unidad,
    // para que todos puedan leerlo. La app tiene ahi permiso de LECTURA solamente:
    // lee las opciones del desplegable y nunca las modifica.
    catalogo: {
        ruta: '/sites/Administracion',
        lista: 'CAT_Evidencia_MINSA'
    },

    // Los 5 sitios, VERIFICADOS contra el tenant el 2026-08-16.
    //
    // OJO con Finanzas: la URL del sitio es 'Administracion-Documentos' aunque en OneDrive
    // la carpeta se vea como 'Administracion-Finanzas'. Pasa cuando un sitio se renombra
    // despues de crearse. NUNCA construir una de estas rutas a partir del nombre de la
    // biblioteca: hay que traerla verificada, como estas.
    // `rama`/`ramaNombre` solo pintan el indicador de rama en la ficha (la rayita y el
    // subtitulo); no participan en rutas ni permisos.
    unidades: [
        { clave: 'CALYTEK',  nombre: 'CALYTEK',  ruta: '/sites/Ambiental-CALYTEK',        rama: 'ambiental', ramaNombre: 'Ambiental' },
        { clave: 'PITEPEC',  nombre: 'PITEPEC',  ruta: '/sites/Quimicos-PITEPEC',         rama: 'quimicos',  ramaNombre: 'Químicos' },
        { clave: 'RABASA',   nombre: 'RABASA',   ruta: '/sites/Quimicos-RABASA',          rama: 'quimicos',  ramaNombre: 'Químicos' },
        { clave: 'LEGAL',    nombre: 'Legal',    ruta: '/sites/Administracion-Legal',     rama: 'admin',     ramaNombre: 'Administración' },
        { clave: 'FINANZAS', nombre: 'Finanzas', ruta: '/sites/Administracion-Documentos', rama: 'admin',    ramaNombre: 'Administración' }
    ]
};
