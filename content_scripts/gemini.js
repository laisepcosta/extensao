/**
 * content_scripts/gemini.js  v4.0
 *
 * CORREÇÃO PRINCIPAL (v4):
 *   _anexarArquivos() substituída. A versão anterior usava DragEvent
 *   sintético (dispatchEvent 'drop') que o Gemini ignora por segurança.
 *
 *   Nova estratégia (em ordem de tentativa):
 *     1. Encontra o input[type=file] real do Gemini e injeta via DataTransfer
 *     2. Se não encontrar, tenta clicar no botão de anexo para revelar o input
 *     3. Fallback: ClipboardEvent com os arquivos (último recurso)
 *
 * O restante do fluxo não mudou:
 *   background.js abre esta aba → gemini.js sinaliza GEMINI_PRONTO →
 *   background.js envia INJETAR_PROMPT → gemini.js anexa arquivos,
 *   injeta o prompt, aguarda resposta, extrai JSON, envia de volta.
 */

(function () {
  'use strict';

  // ================================================================
  // SELETORES — atualizar aqui quando o Gemini mudar o DOM
  // ================================================================

  const SELETORES = {
    campoTexto: [
      'rich-textarea .ql-editor',
      'rich-textarea div[contenteditable="true"]',
      'div[contenteditable="true"].input-area',
      'div[contenteditable="true"]',
    ].join(', '),

    btnEnviar: [
      'button[aria-label="Send message"]',
      'button[data-test-id="send-button"]',
      'button.send-button',
      'button[jsname="Qosgbe"]',
    ].join(', '),

    // Seletores do input de arquivo (nova estratégia)
    inputFile: [
      'input[type="file"]',
      'input[accept*="pdf"]',
      'input[accept*="application"]',
    ].join(', '),

    // Botão que abre o seletor de arquivos (ícone de clipe/anexo)
    btnAnexo: [
      'button[aria-label*="ttach"]',      // "Attach" ou "Attachment"
      'button[aria-label*="nexo"]',        // "Anexo" (PT)
      'button[aria-label*="file"]',
      'button[aria-label*="upload"]',
      'button[data-test-id*="attach"]',
      'button[data-test-id*="file"]',
      'button[jsname*="attach"]',
      // Ícone de clipe — procura por SVG com path de clipe dentro de button
      'button:has(svg)',
    ].join(', '),

    loadingAtivo: [
      'mat-progress-bar',
      'div[data-is-generating="true"]',
      '.loading-indicator',
      'model-response [data-is-loading]',
      'model-response.is-generating',
    ].join(', '),

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
    CAMPO_PRONTO_MS:   15000,
    LOADING_INICIO_MS: 10000,
    RESPOSTA_MS:      120000,
    POLL_MS:             500,
    UPLOAD_ESPERA_MS:   6000,  // espera após injetar arquivos
    INPUT_REVEAL_MS:    3000,  // espera para o input aparecer após clicar no botão
  };

  // ================================================================
  // HELPERS
  // ================================================================

  function _base64ToFile(base64, nomeArquivo) {
    const byteCharacters = atob(base64);
    const byteArray = new Uint8Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteArray[i] = byteCharacters.charCodeAt(i);
    }
    return new File([byteArray], nomeArquivo, { type: 'application/pdf' });
  }

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

  function _aguardarElementoSumir(seletor, timeoutMs = TIMEOUT.RESPOSTA_MS) {
    return new Promise((resolve, reject) => {
      const inicio = Date.now();
      const checar = () => {
        if (!document.querySelector(seletor)) return resolve();
        if (Date.now() - inicio > timeoutMs)
          return reject(new Error(`Timeout: "${seletor}" não sumiu em ${timeoutMs}ms`));
        setTimeout(checar, TIMEOUT.POLL_MS);
      };
      checar();
    });
  }

  function _aguardarBotaoAtivo(timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const inicio = Date.now();
      const checar = () => {
        const btn = document.querySelector(SELETORES.btnEnviar);
        if (btn && !btn.disabled) return resolve(btn);
        if (Date.now() - inicio > timeoutMs)
          return reject(new Error('Botão de envio não ficou ativo.'));
        setTimeout(checar, 200);
      };
      checar();
    });
  }

  function _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // ================================================================
  // UPLOAD DE ARQUIVOS — nova implementação
  // ================================================================

  /**
   * Estratégia 1: injeta diretamente no input[type=file] se ele existir no DOM.
   * Usa DataTransfer para criar um FileList sintético e dispara 'change'.
   */
  async function _tentarInjetarNoInput(arquivos) {
    const input = document.querySelector(SELETORES.inputFile);
    if (!input) return false;

    console.log('[gemini.js] input[type=file] encontrado diretamente. Injetando...');

    const dt = new DataTransfer();
    for (const arq of arquivos) {
      dt.items.add(_base64ToFile(arq.base64, arq.nome));
    }

    // Define a propriedade files via Object.defineProperty (FileList é read-only)
    Object.defineProperty(input, 'files', {
      value: dt.files,
      writable: true,
      configurable: true,
    });

    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('input',  { bubbles: true }));

    console.log(`[gemini.js] ${arquivos.length} arquivo(s) injetado(s) via input[type=file].`);
    await _sleep(TIMEOUT.UPLOAD_ESPERA_MS);
    return true;
  }

  /**
   * Estratégia 2: clica no botão de anexo para revelar o input,
   * depois injeta os arquivos nele.
   */
  async function _tentarViaCliqueBotaoAnexo(arquivos) {
    // Procura o botão de clipe/anexo — filtra botões de envio
    const botoes = Array.from(document.querySelectorAll('button'));
    const btnAnexo = botoes.find(btn => {
      const label = (btn.getAttribute('aria-label') || '').toLowerCase();
      const testId = (btn.getAttribute('data-test-id') || '').toLowerCase();
      return (
        (label.includes('attach') || label.includes('file') ||
         label.includes('upload') || label.includes('nexo') ||
         testId.includes('attach') || testId.includes('file')) &&
        !label.includes('send') && !label.includes('enviar')
      );
    });

    if (!btnAnexo) {
      console.warn('[gemini.js] Botão de anexo não encontrado.');
      return false;
    }

    console.log('[gemini.js] Clicando no botão de anexo para revelar input...');
    btnAnexo.click();

    // Aguarda o input aparecer após o clique
    try {
      await _aguardarElemento(SELETORES.inputFile, TIMEOUT.INPUT_REVEAL_MS);
    } catch (_) {
      console.warn('[gemini.js] input[type=file] não apareceu após clique no botão de anexo.');
      return false;
    }

    return await _tentarInjetarNoInput(arquivos);
  }

  /**
   * Estratégia 3: ClipboardEvent com os arquivos como fallback.
   * Alguns editores contenteditable aceitam paste de arquivos.
   */
  async function _tentarViaPaste(arquivos) {
    console.log('[gemini.js] Tentando upload via ClipboardEvent (paste)...');

    const campo = document.querySelector(SELETORES.campoTexto);
    if (!campo) return false;

    const dt = new DataTransfer();
    for (const arq of arquivos) {
      dt.items.add(_base64ToFile(arq.base64, arq.nome));
    }

    campo.focus();
    const pasteEvent = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: dt,
    });
    campo.dispatchEvent(pasteEvent);

    await _sleep(TIMEOUT.UPLOAD_ESPERA_MS);
    return true;
  }

  /**
   * Orquestrador: tenta as estratégias em ordem até uma funcionar.
   */
  async function _anexarArquivos(arquivos) {
    if (!arquivos || arquivos.length === 0) return;

    console.log(`[gemini.js] Iniciando upload de ${arquivos.length} arquivo(s)...`);

    // Estratégia 1: input direto
    if (await _tentarInjetarNoInput(arquivos)) return;

    // Estratégia 2: clicar no botão de anexo e depois injetar
    if (await _tentarViaCliqueBotaoAnexo(arquivos)) return;

    // Estratégia 3: paste
    if (await _tentarViaPaste(arquivos)) return;

    // Nenhuma estratégia funcionou — loga mas não lança erro
    // O prompt será enviado sem os arquivos e o Gem usará apenas as instruções
    console.error('[gemini.js] Nenhuma estratégia de upload funcionou. Prosseguindo sem arquivos.');
  }

  // ================================================================
  // INJEÇÃO DO PROMPT
  // ================================================================

  async function _injetarPrompt(texto) {
    console.log('[gemini.js] Aguardando campo de texto...');
    const campo = await _aguardarElemento(SELETORES.campoTexto, TIMEOUT.CAMPO_PRONTO_MS);

    campo.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);

    const CHUNK = 5000;
    for (let i = 0; i < texto.length; i += CHUNK) {
      document.execCommand('insertText', false, texto.slice(i, i + CHUNK));
      await _sleep(0);
    }

    console.log(`[gemini.js] Prompt injetado: ${texto.length} chars`);
  }

  // ================================================================
  // ENVIO E AGUARDO DA RESPOSTA
  // ================================================================

  async function _enviarEAguardar() {
    const btn = await _aguardarBotaoAtivo();
    btn.click();
    console.log('[gemini.js] Mensagem enviada. Aguardando resposta...');

    try {
      await _aguardarElemento(SELETORES.loadingAtivo, TIMEOUT.LOADING_INICIO_MS);
      console.log('[gemini.js] Loading detectado — Gemini está gerando...');
    } catch (_) {
      console.warn('[gemini.js] Loading não detectado — pode ter sido muito rápido.');
    }

    await _aguardarElementoSumir(SELETORES.loadingAtivo, TIMEOUT.RESPOSTA_MS);
    console.log('[gemini.js] Resposta completa.');

    await _sleep(1000);

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
  // EXTRAÇÃO DO JSON
  // ================================================================

  function _extrairJSON(textoResposta) {
    let limpo = textoResposta
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/gi, '')
      .replace(/\[cite[^\]]*\]/gi, '')
      .replace(/【[^】]*】/g, '')
      .trim();

    const match = limpo.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error(`JSON não encontrado na resposta (${textoResposta.length} chars).`);
    }

    try {
      return JSON.parse(match[0]);
    } catch (e) {
      throw new Error(`JSON inválido: ${e.message}`);
    }
  }

  // ================================================================
  // HUB DE MENSAGENS
  // ================================================================

  chrome.runtime.onMessage.addListener((msg, _remetente, responder) => {
    if (msg.tipo !== 'INJETAR_PROMPT') return;

    console.log('[gemini.js] INJETAR_PROMPT recebido. Iniciando automação...');
    responder({ recebido: true });

    (async () => {
      try {
        // 1. Anexa os PDFs ANTES de injetar o prompt
        //    (o campo de texto precisa estar pronto primeiro)
        await _aguardarElemento(SELETORES.campoTexto, TIMEOUT.CAMPO_PRONTO_MS);
        await _anexarArquivos(msg.payload.arquivos);

        // 2. Injeta o prompt
        await _injetarPrompt(msg.payload.texto);

        // 3. Envia e aguarda resposta
        const textoResposta = await _enviarEAguardar();
        const json = _extrairJSON(textoResposta);

        chrome.runtime.sendMessage({
          tipo:    'GEMINI_JSON_EXTRAIDO',
          sucesso: true,
          json,
        });

      } catch (erro) {
        console.error('[gemini.js] Erro na automação:', erro.message);
        chrome.runtime.sendMessage({
          tipo:    'GEMINI_JSON_EXTRAIDO',
          sucesso: false,
          erro:    erro.message,
        });
      }
    })();

    return false;
  });

  // ================================================================
  // INICIALIZAÇÃO — sinaliza que está pronto
  // ================================================================

  async function _inicializar() {
    console.log('[gemini.js] Carregado. Aguardando DOM do Gemini...');
    try {
      await _aguardarElemento(SELETORES.campoTexto, TIMEOUT.CAMPO_PRONTO_MS);
      console.log('[gemini.js] Campo de texto pronto. Sinalizando background...');
      chrome.runtime.sendMessage({ tipo: 'GEMINI_PRONTO' }).catch(() => {});
    } catch (err) {
      console.error('[gemini.js] Campo de texto não apareceu:', err.message);
      chrome.runtime.sendMessage({ tipo: 'GEMINI_PRONTO' }).catch(() => {});
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _inicializar);
  } else {
    _inicializar();
  }

})();