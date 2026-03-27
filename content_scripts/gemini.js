/**
 * content_scripts/gemini.js
 * Automatiza o Gemini Pro (gemini.google.com) como backend de IA.
 *
 * FLUXO:
 *   1. background.js abre esta aba e envia 'INJETAR_PROMPT' com o payload
 *   2. Este script aguarda o DOM estar pronto, injeta o prompt no campo de texto
 *   3. Clica em enviar e monitora o DOM até a resposta estar completa
 *   4. Extrai o JSON da resposta e envia de volta ao background via runtime.sendMessage
 *   5. background.js fecha esta aba e encaminha o JSON ao popup
 *
 * POR QUE INJETAR VIA execCommand:
 *   O campo de texto do Gemini é um div[contenteditable] gerenciado pelo LitElement.
 *   Setar .textContent ou .innerText diretamente não dispara os event listeners
 *   internos, então o botão de envio nunca fica ativo. O execCommand('insertText')
 *   simula digitação real e dispara todos os eventos necessários.
 *
 * FRAGILIDADE CONHECIDA:
 *   Seletores de DOM podem quebrar quando o Gemini fizer deploy de novas versões.
 *   Todos os seletores estão centralizados em SELETORES para facilitar correção.
 */

(function () {
    'use strict';

    // ================================================================
    // SELETORES — ÚNICA FONTE DA VERDADE (atualizar aqui quando quebrar)
    // ================================================================

    const SELETORES = {
        // Campo de entrada de texto (div contenteditable dentro do rich-textarea)
        campoTexto: [
            'rich-textarea .ql-editor',
            'rich-textarea div[contenteditable="true"]',
            'div[contenteditable="true"].input-area',
            'div[contenteditable="true"]',
        ].join(', '),

        // Botão de enviar mensagem
        btnEnviar: [
            'button[aria-label="Send message"]',
            'button[data-test-id="send-button"]',
            'button.send-button',
            'button[jsname="Qosgbe"]',
        ].join(', '),

        // Indicador de que o modelo ainda está gerando (loading)
        loadingAtivo: [
            'mat-progress-bar',
            'div[data-is-generating="true"]',
            '.loading-indicator',
            'model-response [data-is-loading]',
            'model-response.is-generating',
        ].join(', '),

        // Container do último bloco de resposta do modelo
        blocoResposta: [
            'model-response:last-of-type .markdown',
            'model-response:last-of-type message-content',
            '.response-container:last-child .markdown',
            'model-response:last-of-type',
        ].join(', '),
    };

    // ================================================================
    // TIMEOUTS
    // ================================================================

    const TIMEOUT = {
        CAMPO_PRONTO_MS: 15000,   // Aguarda o campo de texto aparecer
        LOADING_INICIO_MS: 10000,   // Aguarda o loading começar após envio
        RESPOSTA_MS: 120000,  // Aguarda a resposta completa (2 min máx)
        POLL_MS: 500,     // Intervalo de polling do DOM
    };

    // ── FUNÇÕES DE UPLOAD DE ARQUIVO ──────────────────────────────
  
  function _base64ToFile(base64, nomeArquivo) {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new File([byteArray], nomeArquivo, { type: 'application/pdf' });
  }

  async function _anexarArquivos(arquivos) {
    if (!arquivos || arquivos.length === 0) return;

    console.log(`[gemini.js] Simulando Drop de ${arquivos.length} arquivos...`);

    // Cria um objeto nativo de transferência de arquivos
    const dataTransfer = new DataTransfer();
    for (const arq of arquivos) {
      dataTransfer.items.add(_base64ToFile(arq.base64, arq.nome));
    }

    // Dispara o evento de drop no documento (o Gemini escuta drops na tela toda)
    const dropEvent = new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: dataTransfer
    });

    document.dispatchEvent(dropEvent);

    // Aguarda o upload dos arquivos terminar na interface do Gemini
    console.log('[gemini.js] Aguardando o upload dos arquivos (8 segundos)...');
    await new Promise(r => setTimeout(r, 8000)); 
  }

    // ================================================================
    // UTILITÁRIOS DE DOM
    // ================================================================

    /**
     * Aguarda um seletor aparecer no DOM (com timeout).
     */
    function _aguardarElemento(seletor, timeoutMs = 10000) {
        return new Promise((resolve, reject) => {
            const existente = document.querySelector(seletor);
            if (existente) return resolve(existente);

            const obs = new MutationObserver(() => {
                const el = document.querySelector(seletor);
                if (el) { obs.disconnect(); resolve(el); }
            });

            obs.observe(document.body, { childList: true, subtree: true });

            setTimeout(() => {
                obs.disconnect();
                reject(new Error(`Timeout: "${seletor}" não apareceu em ${timeoutMs}ms`));
            }, timeoutMs);
        });
    }

    /**
     * Aguarda um seletor SUMIR do DOM (com polling).
     * Usado para detectar fim do loading.
     */
    function _aguardarElementoSumir(seletor, timeoutMs = TIMEOUT.RESPOSTA_MS) {
        return new Promise((resolve, reject) => {
            const inicio = Date.now();

            const checar = () => {
                if (!document.querySelector(seletor)) return resolve();
                if (Date.now() - inicio > timeoutMs) return reject(new Error(`Timeout: "${seletor}" não sumiu em ${timeoutMs}ms`));
                setTimeout(checar, TIMEOUT.POLL_MS);
            };

            checar();
        });
    }

    /**
     * Aguarda o botão de envio ficar enabled (com polling).
     */
    function _aguardarBotaoAtivo(timeoutMs = 5000) {
        return new Promise((resolve, reject) => {
            const inicio = Date.now();

            const checar = () => {
                const btn = document.querySelector(SELETORES.btnEnviar);
                if (btn && !btn.disabled) return resolve(btn);
                if (Date.now() - inicio > timeoutMs) return reject(new Error('Botão de envio não ficou ativo.'));
                setTimeout(checar, 200);
            };

            checar();
        });
    }

    // ================================================================
    // INJEÇÃO DO PROMPT
    // ================================================================

    async function _injetarPrompt(texto) {
        console.log('[gemini.js] Aguardando campo de texto...');
        const campo = await _aguardarElemento(SELETORES.campoTexto, TIMEOUT.CAMPO_PRONTO_MS);

        campo.focus();

        // Limpa qualquer texto anterior
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);

        // Insere o texto simulando digitação real (dispara os listeners do LitElement)
        // Para textos grandes, divide em chunks para não travar o browser
        const CHUNK_INSERCAO = 5000;
        for (let i = 0; i < texto.length; i += CHUNK_INSERCAO) {
            document.execCommand('insertText', false, texto.slice(i, i + CHUNK_INSERCAO));
            // Yield para não travar a thread
            await new Promise(r => setTimeout(r, 0));
        }

        console.log(`[gemini.js] Prompt injetado: ${texto.length} chars`);
    }

    // ================================================================
    // ENVIO E AGUARDO DA RESPOSTA
    // ================================================================

    async function _enviarEAguardar() {
        // Aguarda botão ativo e clica
        const btn = await _aguardarBotaoAtivo();
        btn.click();
        console.log('[gemini.js] Mensagem enviada. Aguardando resposta...');

        // Aguarda o loading começar (confirma que o Gemini recebeu)
        try {
            await _aguardarElemento(SELETORES.loadingAtivo, TIMEOUT.LOADING_INICIO_MS);
            console.log('[gemini.js] Loading detectado — Gemini está gerando...');
        } catch (_) {
            // Em alguns casos o loading é muito rápido e já sumiu — continua mesmo assim
            console.warn('[gemini.js] Loading não detectado — pode ter sido muito rápido.');
        }

        // Aguarda o loading SUMIR (resposta completa)
        await _aguardarElementoSumir(SELETORES.loadingAtivo, TIMEOUT.RESPOSTA_MS);
        console.log('[gemini.js] Resposta completa detectada.');

        // Dá um tempo extra para o DOM estabilizar
        await new Promise(r => setTimeout(r, 1000));

        // Extrai o texto da resposta
        const blocos = document.querySelectorAll(SELETORES.blocoResposta.split(', ')[0]) ||
            document.querySelectorAll(SELETORES.blocoResposta.split(', ')[1]);

        // Tenta cada seletor até encontrar conteúdo
        let textoResposta = '';
        for (const seletor of SELETORES.blocoResposta.split(', ')) {
            const els = document.querySelectorAll(seletor);
            if (els.length > 0) {
                textoResposta = els[els.length - 1].textContent || '';
                if (textoResposta.trim().length > 50) break;
            }
        }

        if (!textoResposta.trim()) {
            throw new Error('Resposta do Gemini está vazia ou não foi encontrada no DOM.');
        }

        console.log(`[gemini.js] Resposta extraída: ${textoResposta.length} chars`);
        return textoResposta;
    }

    // ================================================================
    // EXTRAÇÃO DO JSON DA RESPOSTA
    // ================================================================

    function _extrairJSON(textoResposta) {
        // Remove citações e artefatos do Gemini
        let limpo = textoResposta
            .replace(/```json\s*/gi, '')
            .replace(/```\s*/gi, '')
            .replace(/\[cite[^\]]*\]/gi, '')
            .replace(/【[^】]*】/g, '')
            .trim();

        // Tenta encontrar o objeto JSON principal
        const match = limpo.match(/\{[\s\S]*\}/);
        if (!match) {
            throw new Error(`JSON não encontrado na resposta (${textoResposta.length} chars).`);
        }

        try {
            return JSON.parse(match[0]);
        } catch (e) {
            throw new Error(`JSON inválido na resposta do Gemini: ${e.message}`);
        }
    }

    // ================================================================
    // HUB DE MENSAGENS
    // ================================================================

    chrome.runtime.onMessage.addListener((msg, _remetente, responder) => {
    if (msg.tipo !== 'INJETAR_PROMPT') return;

    console.log('[gemini.js] Recebeu INJETAR_PROMPT. Iniciando automação...');
    responder({ recebido: true });

    (async () => {
      try {
        // O payload agora terá o texto (prompt) e os arquivos (PDFs)
        await _anexarArquivos(msg.payload.arquivos);
        await _injetarPrompt(msg.payload.texto);
        
        const textoResposta = await _enviarEAguardar();
        const json = _extrairJSON(textoResposta);

        chrome.runtime.sendMessage({
          tipo: 'GEMINI_JSON_EXTRAIDO',
          sucesso: true,
          json,
        });

      } catch (erro) {
        console.error('[gemini.js] Erro na automação:', erro.message);
        chrome.runtime.sendMessage({
          tipo: 'GEMINI_JSON_EXTRAIDO',
          sucesso: false,
          erro: erro.message,
        });
      }
    })();

    return false;
  });

    // ================================================================
    // INICIALIZAÇÃO — sinaliza ao background que o content script está pronto
    // ================================================================

    /**
     * Aguarda o campo de texto aparecer e então sinaliza ao background.
     * O background só envia o prompt após receber este sinal.
     * Isso evita a race condition de enviar o prompt antes do DOM estar pronto.
     */
    async function _inicializar() {
        console.log('[gemini.js] Carregado. Aguardando DOM do Gemini ficar pronto...');

        try {
            await _aguardarElemento(SELETORES.campoTexto, TIMEOUT.CAMPO_PRONTO_MS);
            console.log('[gemini.js] Campo de texto pronto. Sinalizando background...');
            chrome.runtime.sendMessage({ tipo: 'GEMINI_PRONTO' }).catch(() => { });
        } catch (err) {
            console.error('[gemini.js] Campo de texto não apareceu:', err.message);
            // Sinaliza mesmo assim — o background vai tentar enviar e vai falhar
            // com erro mais descritivo em _injetarPrompt
            chrome.runtime.sendMessage({ tipo: 'GEMINI_PRONTO' }).catch(() => { });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _inicializar);
    } else {
        _inicializar();
    }

})();