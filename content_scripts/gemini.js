/**
 * content_scripts/gemini.js  v6.1
 **/

(function () {
  'use strict';

  // =========================
  // SELETORES
  // =========================
  const SEL = {
    campoTexto: 'rich-textarea .ql-editor[contenteditable="true"]',

    btnEnviar: [
      '.send-icon',
      'button[aria-label="Enviar mensagem"]',
      'button[aria-label="Send message"]'
    ].join(', '),

    btnAbrirMenuUpload: [
      '.upload-icon',
      'button[aria-label="Abrir o menu de envio de arquivo"]',
      'images-files-uploader button[xapfileselectortrigger]'
    ].join(', '),

    btnUploadOculto: [
      'button[xapfileselectortrigger]',
      'button.hidden-local-file-upload-button'
    ].join(', '),

    chipArquivo: 'file-upload-chip, .file-chip'
  };

  const T = {
    CAMPO_MS: 15000,
    INPUT_MS: 15000,
    BOTAO_MS: 8000,
    RESPOSTA_MS: 180000
  };

  const _sleep = ms => new Promise(r => setTimeout(r, ms));

  // =========================
  // BUSCA PROFUNDA (shadow DOM)
  // =========================
  function _queryDeep(selector, root = document) {
    const results = [];

    function traverse(node) {
      if (!node) return;

      if (node.querySelectorAll) {
        results.push(...node.querySelectorAll(selector));
      }

      if (node.shadowRoot) traverse(node.shadowRoot);

      node.childNodes.forEach(traverse);
    }

    traverse(root);
    return results;
  }

  function _getInputFileDeep() {
    const inputs = _queryDeep('input[type="file"]');
    return inputs.find(i => i && !i.disabled);
  }

  // =========================
  // UTILITÁRIOS
  // =========================
  function _getElementoVisivel(sel) {
    return Array.from(document.querySelectorAll(sel)).find(el =>
      el.offsetParent !== null
    );
  }

  function _aguardarCondicao(fn, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();

      const tick = () => {
        if (fn()) return resolve(true);
        if (Date.now() - t0 > timeout) {
          return reject(new Error('Timeout aguardando condição'));
        }
        setTimeout(tick, 150);
      };

      tick();
    });
  }

  function _aguardarElemento(sel, timeout = 10000) {
    return _aguardarCondicao(() => _getElementoVisivel(sel), timeout)
      .then(() => _getElementoVisivel(sel));
  }

  function _base64ToFile(base64, nome) {
    const dados = base64.includes(',') ? base64.split(',')[1] : base64;
    const bytes = atob(dados);
    const arr = new Uint8Array(bytes.length);

    for (let i = 0; i < bytes.length; i++) {
      arr[i] = bytes.charCodeAt(i);
    }

    return new File([arr], nome, { type: 'application/pdf' });
  }

  // =========================
  // UPLOAD
  // =========================
  async function _anexarArquivos(arquivos) {
    if (!arquivos?.length) return;

    console.log('[gemini] iniciando upload...');

    const btn = await _aguardarElemento(SEL.btnAbrirMenuUpload, 10000);
    btn.click();

    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    await _sleep(400);

    const btnInterno = _getElementoVisivel(SEL.btnUploadOculto);
    if (btnInterno) btnInterno.click();

    await _aguardarCondicao(() => _getInputFileDeep(), T.INPUT_MS);

    const input = _getInputFileDeep();

    if (!input) throw new Error('Input file não encontrado');

    console.log('[gemini] input capturado');

    const dt = new DataTransfer();

    for (const arq of arquivos) {
      dt.items.add(_base64ToFile(arq.base64, arq.nome));
    }

    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await _aguardarCondicao(() =>
      document.querySelectorAll(SEL.chipArquivo).length > 0,
      15000
    );

    console.log('[gemini] upload ok');
  }

  // =========================
  // PROMPT
  // =========================
  async function _injetarPrompt(texto) {
    const campo = await _aguardarElemento(SEL.campoTexto, T.CAMPO_MS);

    campo.focus();
    document.execCommand('selectAll');
    document.execCommand('delete');

    document.execCommand('insertText', false, texto);
  }

  // =========================
  // ENVIO
  // =========================
  async function _enviar() {
    const btn = await _aguardarElemento(SEL.btnEnviar, T.BOTAO_MS);
    btn.click();

    await _sleep(2000);
  }

  // =========================
  // FLOW
  // =========================
  chrome.runtime.onMessage.addListener((msg, _, responder) => {
    if (msg.tipo !== 'INJETAR_PROMPT') return;

    (async () => {
      try {
        await _anexarArquivos(msg.payload.arquivos);
        await _injetarPrompt(msg.payload.texto);
        await _enviar();

        chrome.runtime.sendMessage({
          tipo: 'OK'
        });

      } catch (e) {
        console.error(e);

        chrome.runtime.sendMessage({
          tipo: 'ERRO',
          erro: e.message
        });
      }
    })();

    responder({ ok: true });
    return false;
  });

})();
