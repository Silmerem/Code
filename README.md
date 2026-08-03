# Pronunciación de Números en Francés

Tres tutores web para practicar la pronunciación de los números en francés usando
el micrófono. Todo funciona en el navegador, sin servidor ni dependencias.

| Página | Qué hace |
| --- | --- |
| `index.html` | Portada, elección de modo y comprobación del micrófono |
| `tutor-interactivo.html` | Lección guiada del 1 al 10 con explicaciones y puntuación |
| `tutor-2.0.html` | La misma lección, más directa |
| `numeros-frances.html` | Práctica libre del 1 al 100 en orden aleatorio |
| `js/speech.js` | Módulo compartido: permisos, grabación, reconocimiento y síntesis |

## Cómo abrirlo

**El micrófono no funciona si abres el HTML con doble clic.** Los navegadores solo
dan acceso al micrófono en `https://` o en `localhost`, así que `file://` queda
descartado. Levanta un servidor local:

```bash
python3 -m http.server 8000
```

Y entra en <http://localhost:8000>.

También funciona publicado en GitHub Pages (Settings → Pages → rama `main`), que
sirve por HTTPS.

## Navegadores

| Navegador | Escuchar | Grabarse | Puntuación automática |
| --- | --- | --- | --- |
| Chrome / Edge | ✅ | ✅ | ✅ |
| Firefox / Safari | ✅ | ✅ | ❌ |

La puntuación usa la Web Speech API (`SpeechRecognition`), que hoy solo
implementan Chrome y Edge, y necesita conexión a internet porque la
transcripción se hace en los servidores de Google. En el resto de navegadores
las páginas siguen siendo útiles: puedes escuchar el número, grabarte y
reescuchar tu voz, pero sin corrección automática.

## El módulo de voz

`js/speech.js` expone el objeto global `Voz` y concentra todo lo relacionado con
audio para que los tres tutores no repitan la misma lógica:

```js
Voz.avisarProblemas(contenedor);   // inserta un aviso si el entorno no sirve
await Voz.pedirPermiso();          // { ok, stream } | { ok:false, mensaje }
Voz.grabar({ idioma, onInicio, onParcial, onFin, onError });
Voz.detener();
Voz.hayGrabacion();
await Voz.reproducirGrabacion();   // reproduce tu audio real
await Voz.hablar(texto, 'fr-FR');
```

Puntos a tener en cuenta si tocas el módulo:

- La grabación se corta sola a los 8 segundos para no dejar el micrófono abierto.
- Antes de grabar se cancela la síntesis de voz, o el micrófono se grabaría al
  propio tutor.
- `getVoices()` devuelve una lista vacía en la primera llamada en Chrome, por eso
  `hablar()` espera al evento `voiceschanged` antes de elegir la voz francesa.
- `hablar()` siempre resuelve su promesa: si la síntesis se cuelga (pasa en
  Chrome), un temporizador la libera para que la lección no se quede bloqueada.
- Los errores del reconocedor se traducen a mensajes accionables en vez de
  mostrar códigos como `not-allowed`.
