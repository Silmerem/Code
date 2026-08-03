/**
 * speech.js — Módulo de voz compartido por los tutores de números en francés.
 *
 * Resuelve las tres cosas que el navegador complica y que rompían el micrófono:
 *   1. Contexto seguro y permisos (abrir el HTML con file:// nunca da micrófono).
 *   2. Grabación real del audio con MediaRecorder, para poder reescuchar tu voz.
 *   3. Reconocimiento de voz con errores traducidos y sin estados colgados.
 *
 * Uso mínimo:
 *   Voz.avisarProblemas(document.querySelector('.container'));
 *   Voz.grabar({ onInicio, onFin, onError });
 *   await Voz.hablar('deux', 'fr-FR');
 */
(function (global) {
    'use strict';

    const ReconocimientoVoz = global.SpeechRecognition || global.webkitSpeechRecognition;
    const sintesis = global.speechSynthesis;

    // Corta la grabación sola si el usuario se queda callado.
    const TIEMPO_MAXIMO_MS = 8000;

    const MENSAJES_ERROR = {
        'no-speech': 'No se escuchó nada. Acércate al micrófono y habla un poco más fuerte.',
        'audio-capture': 'No se detectó ningún micrófono. Revisa que esté conectado y no lo esté usando otra app.',
        'not-allowed': 'El micrófono está bloqueado. Abre el candado 🔒 de la barra de direcciones y permite el micrófono.',
        'service-not-allowed': 'El navegador bloqueó el servicio de reconocimiento de voz.',
        'network': 'Sin conexión. El reconocimiento de voz de Chrome necesita internet para funcionar.',
        'aborted': 'Grabación cancelada.'
    };

    const MENSAJES_PERMISO = {
        NotAllowedError: 'Denegaste el permiso del micrófono. Abre el candado 🔒 de la barra de direcciones, permite el micrófono y recarga la página.',
        PermissionDeniedError: 'Denegaste el permiso del micrófono. Abre el candado 🔒 de la barra de direcciones, permite el micrófono y recarga la página.',
        NotFoundError: 'No se encontró ningún micrófono conectado.',
        DevicesNotFoundError: 'No se encontró ningún micrófono conectado.',
        NotReadableError: 'Otra aplicación está usando el micrófono. Ciérrala e inténtalo de nuevo.',
        TrackStartError: 'Otra aplicación está usando el micrófono. Ciérrala e inténtalo de nuevo.'
    };

    let reconocimiento = null;
    let grabadora = null;
    let streamActivo = null;
    let ultimoAudioURL = null;
    let grabando = false;
    let arrancando = false;
    let temporizador = null;
    let callbacks = {};
    let transcripcion = '';
    let errorEmitido = false;

    /* ------------------------------------------------------------------ */
    /*  Diagnóstico del entorno                                            */
    /* ------------------------------------------------------------------ */

    function entorno() {
        return {
            esArchivoLocal: global.location.protocol === 'file:',
            contextoSeguro: global.isSecureContext === true,
            hayReconocimiento: Boolean(ReconocimientoVoz),
            hayGrabacion: Boolean(
                navigator.mediaDevices &&
                navigator.mediaDevices.getUserMedia &&
                global.MediaRecorder
            ),
            haySintesis: Boolean(sintesis)
        };
    }

    /**
     * Devuelve el motivo por el que el micrófono no va a funcionar, o null si
     * el entorno es correcto. El orden importa: lo más bloqueante primero.
     */
    function problemaDeEntorno() {
        const e = entorno();

        if (e.esArchivoLocal) {
            return 'Estás abriendo la página como archivo local (file://). Los navegadores solo dan acceso al micrófono en https:// o localhost. Levanta un servidor con <code>python3 -m http.server 8000</code> y entra en <code>http://localhost:8000</code>.';
        }
        if (!e.contextoSeguro) {
            return 'La página no se está sirviendo por HTTPS. El micrófono solo funciona en https:// o localhost.';
        }
        if (!e.hayGrabacion && !e.hayReconocimiento) {
            return 'Este navegador no permite usar el micrófono desde la web. Prueba con Chrome o Edge actualizados.';
        }
        if (!e.hayReconocimiento) {
            return 'Este navegador no soporta reconocimiento de voz (Web Speech API), así que no se puede puntuar la pronunciación. Podrás grabarte y reescucharte, pero para la corrección automática usa Chrome o Edge.';
        }
        return null;
    }

    /** Inserta un aviso visible arriba del contenedor si algo va a fallar. */
    function avisarProblemas(contenedor) {
        const problema = problemaDeEntorno();
        if (!problema || !contenedor) return null;

        inyectarEstilos();
        const aviso = document.createElement('div');
        aviso.className = 'voz-aviso';
        aviso.innerHTML = '<strong>⚠️ Micrófono no disponible</strong><span>' + problema + '</span>';
        contenedor.insertBefore(aviso, contenedor.firstChild);
        return aviso;
    }

    function inyectarEstilos() {
        if (document.getElementById('voz-estilos')) return;
        const estilo = document.createElement('style');
        estilo.id = 'voz-estilos';
        estilo.textContent = [
            '.voz-aviso{background:#fff3cd;border:1px solid #ffe08a;border-left:4px solid #f0ad4e;',
            'color:#7a5b00;padding:14px 16px;border-radius:10px;margin-bottom:20px;font-size:14px;',
            'line-height:1.5;display:flex;flex-direction:column;gap:6px;text-align:left;}',
            '.voz-aviso code{background:rgba(0,0,0,.08);padding:2px 6px;border-radius:4px;',
            'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;}'
        ].join('');
        document.head.appendChild(estilo);
    }

    /* ------------------------------------------------------------------ */
    /*  Permisos y captura de audio                                        */
    /* ------------------------------------------------------------------ */

    /**
     * Pide el micrófono explícitamente. Hacerlo antes de arrancar el
     * reconocimiento permite dar un mensaje claro en vez del críptico
     * "not-allowed" que devuelve la Web Speech API.
     */
    async function pedirPermiso() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            return { ok: false, mensaje: 'Este navegador no expone el micrófono a las páginas web.' };
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            return { ok: true, stream: stream };
        } catch (error) {
            const mensaje = MENSAJES_PERMISO[error.name] ||
                ('No se pudo abrir el micrófono (' + error.name + ').');
            return { ok: false, mensaje: mensaje };
        }
    }

    function soltarStream() {
        if (streamActivo) {
            streamActivo.getTracks().forEach(function (pista) { pista.stop(); });
            streamActivo = null;
        }
    }

    function iniciarGrabadora(stream) {
        if (!global.MediaRecorder) return;

        let trozos = [];
        let rec;
        try {
            rec = new MediaRecorder(stream);
        } catch (error) {
            grabadora = null;
            return;
        }

        rec.ondataavailable = function (evento) {
            if (evento.data && evento.data.size > 0) trozos.push(evento.data);
        };

        // Ojo: aquí se usa 'rec' y no la variable de módulo, que para cuando
        // salta 'stop' ya vale null. Leerla ahí lanzaba una excepción y la
        // grabación se perdía sin avisar.
        rec.onstop = function () {
            if (trozos.length) {
                if (ultimoAudioURL) URL.revokeObjectURL(ultimoAudioURL);
                ultimoAudioURL = URL.createObjectURL(new Blob(trozos, { type: rec.mimeType || 'audio/webm' }));
                trozos = [];
            }
            // El micrófono se libera cuando la grabadora ha vaciado su buffer,
            // no antes, o el final del audio se corta.
            soltarStream();
        };

        grabadora = rec;
        rec.start();
    }

    function pararGrabadora() {
        const rec = grabadora;
        grabadora = null;

        if (rec && rec.state !== 'inactive') {
            try {
                rec.stop();   // soltarStream() se llama desde su onstop
                return;
            } catch (error) { /* ya estaba parada */ }
        }
        soltarStream();
    }

    /* ------------------------------------------------------------------ */
    /*  Reconocimiento de voz                                              */
    /* ------------------------------------------------------------------ */

    function crearReconocimiento(idioma) {
        const rec = new ReconocimientoVoz();
        rec.lang = idioma;
        rec.continuous = false;
        rec.interimResults = true;
        rec.maxAlternatives = 3;
        return rec;
    }

    function limpiarEstado() {
        grabando = false;
        arrancando = false;
        clearTimeout(temporizador);
        temporizador = null;
        pararGrabadora();
    }

    /**
     * Graba al usuario y devuelve la transcripción.
     * @param {Object} opciones
     * @param {string}   [opciones.idioma='fr-FR']
     * @param {Function} [opciones.onInicio]   ()
     * @param {Function} [opciones.onParcial]  (textoProvisional)
     * @param {Function} [opciones.onFin]      (transcripcion, {alternativas, soloAudio})
     * @param {Function} [opciones.onError]    (mensajeLegible, codigo)
     */
    async function grabar(opciones) {
        opciones = opciones || {};
        if (grabando || arrancando) return;

        arrancando = true;
        callbacks = opciones;
        transcripcion = '';
        errorEmitido = false;

        // Si el tutor sigue hablando, el micrófono se grabaría a sí mismo.
        if (sintesis) sintesis.cancel();

        const problema = problemaDeEntorno();
        if (problema && !entorno().hayReconocimiento && !entorno().hayGrabacion) {
            arrancando = false;
            avisar('onError', problema.replace(/<[^>]+>/g, ''), 'entorno');
            return;
        }

        const permiso = await pedirPermiso();
        if (!permiso.ok) {
            arrancando = false;
            avisar('onError', permiso.mensaje, 'permiso');
            return;
        }
        streamActivo = permiso.stream;
        iniciarGrabadora(streamActivo);

        // Sin Web Speech API (Firefox, Safari) se graba igual: el usuario
        // podrá reescucharse aunque no haya puntuación automática.
        if (!ReconocimientoVoz) {
            arrancando = false;
            grabando = true;
            avisar('onInicio');
            temporizador = setTimeout(detener, TIEMPO_MAXIMO_MS);
            return;
        }

        reconocimiento = crearReconocimiento(opciones.idioma || 'fr-FR');
        let alternativas = [];

        reconocimiento.onstart = function () {
            arrancando = false;
            grabando = true;
            avisar('onInicio');
        };

        reconocimiento.onresult = function (evento) {
            let provisional = '';
            for (let i = evento.resultIndex; i < evento.results.length; i++) {
                const resultado = evento.results[i];
                if (resultado.isFinal) {
                    transcripcion = resultado[0].transcript.toLowerCase().trim();
                    for (let j = 0; j < resultado.length; j++) {
                        alternativas.push(resultado[j].transcript.toLowerCase().trim());
                    }
                } else {
                    provisional += resultado[0].transcript;
                }
            }
            if (provisional && !transcripcion) avisar('onParcial', provisional.trim());
        };

        reconocimiento.onerror = function (evento) {
            // 'aborted' llega cuando paramos nosotros: no es un fallo real.
            if (evento.error === 'aborted') return;
            errorEmitido = true;
            avisar('onError', MENSAJES_ERROR[evento.error] || ('Error de micrófono: ' + evento.error), evento.error);
        };

        reconocimiento.onend = function () {
            limpiarEstado();

            // Tras un error, 'end' llega igualmente. Sin este corte se llamaría
            // a onFin con transcripción vacía y el mensaje concreto del fallo
            // quedaría pisado por un genérico "no se detectó tu voz".
            if (errorEmitido) return;

            avisar('onFin', transcripcion, {
                alternativas: alternativas,
                soloAudio: false
            });
        };

        try {
            reconocimiento.start();
            temporizador = setTimeout(detener, TIEMPO_MAXIMO_MS);
        } catch (error) {
            // InvalidStateError: ya había una sesión abierta.
            limpiarEstado();
            avisar('onError', 'El micrófono ya estaba grabando. Espera un momento e inténtalo de nuevo.', 'estado');
        }
    }

    /** Corta la grabación en curso. */
    function detener() {
        clearTimeout(temporizador);
        temporizador = null;

        if (reconocimiento && (grabando || arrancando)) {
            try { reconocimiento.stop(); } catch (error) { /* ya estaba parada */ }
            return; // el resto se hace en onend
        }
        if (grabando) {
            limpiarEstado();
            avisar('onFin', '', { alternativas: [], soloAudio: true });
        }
    }

    function estaGrabando() {
        return grabando || arrancando;
    }

    function avisar(nombre, a, b) {
        const fn = callbacks[nombre];
        if (typeof fn === 'function') fn(a, b);
    }

    /* ------------------------------------------------------------------ */
    /*  Reproducción de lo grabado                                         */
    /* ------------------------------------------------------------------ */

    function hayGrabacion() {
        return Boolean(ultimoAudioURL);
    }

    /** Reproduce el audio real del usuario (no una síntesis del texto). */
    function reproducirGrabacion() {
        return new Promise(function (resolver, rechazar) {
            if (!ultimoAudioURL) {
                rechazar(new Error('Todavía no hay ninguna grabación.'));
                return;
            }
            if (sintesis) sintesis.cancel();
            const audio = new Audio(ultimoAudioURL);
            audio.onended = function () { resolver(); };
            audio.onerror = function () { rechazar(new Error('No se pudo reproducir la grabación.')); };
            audio.play().catch(rechazar);
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Síntesis de voz                                                    */
    /* ------------------------------------------------------------------ */

    /**
     * getVoices() devuelve [] en la primera llamada en Chrome hasta que se
     * dispara 'voiceschanged'. Sin esperar, la voz francesa nunca se aplicaba.
     */
    function vocesDisponibles() {
        return new Promise(function (resolver) {
            if (!sintesis) { resolver([]); return; }

            const voces = sintesis.getVoices();
            if (voces.length) { resolver(voces); return; }

            let resuelto = false;
            const terminar = function () {
                if (resuelto) return;
                resuelto = true;
                resolver(sintesis.getVoices());
            };
            sintesis.addEventListener('voiceschanged', terminar, { once: true });
            setTimeout(terminar, 1500);
        });
    }

    function elegirVoz(voces, idioma) {
        const base = idioma.split('-')[0];
        const delIdioma = voces.filter(function (v) { return v.lang.replace('_', '-').startsWith(base); });
        if (!delIdioma.length) return null;

        const exacta = delIdioma.filter(function (v) { return v.lang.replace('_', '-') === idioma; });
        const candidatas = exacta.length ? exacta : delIdioma;

        const femenina = candidatas.find(function (v) {
            return /female|femenin|marie|amelie|amélie|audrey|mónica|monica|helena|paulina/i.test(v.name);
        });
        return femenina || candidatas[0];
    }

    /**
     * Lee un texto en voz alta. Resuelve siempre: si la síntesis se queda
     * colgada (pasa en Chrome), un watchdog libera la promesa para que la
     * lección no se quede bloqueada esperando.
     */
    async function hablar(texto, idioma, opciones) {
        idioma = idioma || 'es-ES';
        opciones = opciones || {};
        if (!sintesis || !texto) return;

        const voces = await vocesDisponibles();

        return new Promise(function (resolver) {
            sintesis.cancel();

            const locucion = new SpeechSynthesisUtterance(texto);
            locucion.lang = idioma;
            locucion.rate = opciones.velocidad || (idioma.startsWith('fr') ? 0.85 : 0.95);
            locucion.pitch = opciones.tono || 1;
            locucion.volume = 1;

            const voz = elegirVoz(voces, idioma);
            if (voz) locucion.voice = voz;

            let resuelto = false;
            const terminar = function () {
                if (resuelto) return;
                resuelto = true;
                clearTimeout(vigilante);
                resolver();
            };

            // ~110 ms por carácter, con un mínimo generoso.
            const vigilante = setTimeout(terminar, Math.max(4000, texto.length * 110 + 2000));

            locucion.onend = terminar;
            locucion.onerror = terminar;
            sintesis.speak(locucion);
        });
    }

    function callarse() {
        if (sintesis) sintesis.cancel();
    }

    /* ------------------------------------------------------------------ */
    /*  Comparación de texto                                               */
    /* ------------------------------------------------------------------ */

    /**
     * Deja el texto listo para comparar. Sin esto, decir "quarante-sept"
     * perfectamente puntuaba menos de 100 % solo porque el reconocedor
     * devuelve el guion y el objetivo lleva espacio.
     */
    function normalizar(texto) {
        return (texto || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')  // quita acentos
            .replace(/[-–—'’.,!?;:]/g, ' ')    // guiones y puntuación → espacio
            .replace(/\s+/g, ' ')
            .trim();
    }

    global.Voz = {
        entorno: entorno,
        problemaDeEntorno: problemaDeEntorno,
        avisarProblemas: avisarProblemas,
        pedirPermiso: pedirPermiso,
        grabar: grabar,
        detener: detener,
        estaGrabando: estaGrabando,
        hayGrabacion: hayGrabacion,
        reproducirGrabacion: reproducirGrabacion,
        hablar: hablar,
        callarse: callarse,
        normalizar: normalizar
    };
})(window);
