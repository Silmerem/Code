# Practicar idiomas

Ejercicios web para practicar gramática en inglés y pronunciación de números en
francés. Todo funciona en el navegador, sin servidor ni dependencias.

| Página | Qué hace |
| --- | --- |
| `index.html` | Portada con todos los ejercicios y comprobación del micrófono |
| `gramatica-ingles.html` | Test de gramática inglesa en tres niveles, con explicación de cada respuesta |
| `tutor-interactivo.html` | Lección guiada de números en francés del 1 al 10, con puntuación |
| `tutor-2.0.html` | La misma lección, más directa |
| `numeros-frances.html` | Práctica libre del 1 al 100 en orden aleatorio |
| `js/gramatica-*.js` | Banco de preguntas, un archivo por nivel |
| `js/speech.js` | Módulo compartido: permisos, grabación, reconocimiento y síntesis |

## Gramática en inglés

181 preguntas repartidas en tres niveles. Cada una presenta una frase con un
hueco y tres opciones; al responder se marca la correcta y se explica el porqué
en español. Al terminar la ronda se listan los fallos con su explicación y se
puede repetir solo las falladas. La mejor marca de cada nivel se guarda en el
navegador (`localStorage`).

| Nivel | MCER | Preguntas | Contenidos |
| --- | --- | --- | --- |
| Básica | A1–A2 | 61 | Presente y pasado simple, artículos, plurales, preposiciones, comparativos, modales sencillos |
| Intermedia | B1–B2 | 60 | Present perfect, condicionales, pasiva, estilo indirecto, relativos, patrones verbales |
| Avanzada | C1–C2 | 60 | Inversión, condicionales mixtos, cleft sentences, participio, subjuntivo, pasiva impersonal |

Las frases son originales, escritas siguiendo el reparto de contenidos por nivel
del Marco Común Europeo y de los sílabos de los exámenes de Cambridge
([English Grammar Profile](https://www.cambridge.org/elt/blog/2021/06/23/using-cefr-criterial-features-for-grammar-instruction/),
[requisitos por nivel MCER](https://tracktest.eu/english-grammar-cef-level-requirements/),
[estructuras de B2 First](https://engxam.com/handbook/common-grammatical-structures-fce-grammar-list-cambridge-b2-first/),
[gramática C1 del British Council](https://learnenglish.britishcouncil.org/free-resources/grammar/c1)).
Buena parte de los distractores reproduce
[errores típicos de hispanohablantes](https://www.leonardoenglish.com/blog/the-most-common-mistakes-in-english-for-spanish-speakers)
—«depend of», «married with», «arrive to», «she sings good», el orden
adjetivo-sustantivo— para que fallar enseñe algo.

Para añadir preguntas basta con ampliar el array del archivo del nivel
correspondiente. El formato de cada entrada es:

```js
{
    tema: "Present perfect: since / for",
    frase: "I have lived here ___ 2015.",   // exactamente un hueco "___"
    opciones: ["for", "since", "during"],   // exactamente tres
    correcta: 1,                            // índice de la opción correcta
    explicacion: "«Since» marca el punto de inicio; «for», la duración."
}
```

La posición de la respuesta correcta dentro del array da igual: la página baraja
las opciones cada vez que pinta una pregunta.

## Cómo abrirlo

La gramática en inglés funciona abriendo el archivo directamente, pero **el
micrófono de los tutores de francés no**. Los navegadores solo
dan acceso al micrófono en `https://` o en `localhost`, así que `file://` queda
descartado. Levanta un servidor local:

```bash
python3 -m http.server 8000
```

Y entra en <http://localhost:8000>.

También funciona publicado en GitHub Pages (Settings → Pages → rama `main`), que
sirve por HTTPS.

## Navegadores

La gramática en inglés funciona en cualquier navegador actual. Lo que varía es
la parte de francés, que depende del micrófono:

| Navegador | Escuchar | Grabarse | Puntuación de la pronunciación |
| --- | --- | --- | --- |
| Chrome / Edge | ✅ | ✅ | ✅ |
| Firefox / Safari | ✅ | ✅ | ❌ |

La puntuación de la pronunciación usa la Web Speech API (`SpeechRecognition`), que hoy solo
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
