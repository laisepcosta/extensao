/**
 * content_scripts/gemini.js  v6.1
 *
 * CORREÇÕES v6.1:
 *
 *  BUG 1 — _base64ToFile corrompendo o PDF:
 *    eproc.js usa FileReader.readAsDataURL(), que retorna a string no formato:
 *      "data:application/pdf;base64,JVBERi0xLjQ..."
 *    O atob() anterior recebia a string inteira (com o prefixo) e gerava
 *    bytes inválidos. O Gemini recebia um PDF corrompido e respondia com
 *    uma mensagem curta de erro (~98 chars) em vez do JSON.
 *    FIX: strip do prefixo "data:...;base64," antes do atob().
 *
 *  BUG 2 — _aguardarSumir resolvendo antes do Gemini gerar:
 *    _aguardarSumir resolve imediatamente se o seletor não existe no DOM
 *    no momento da chamada. O loading aparece com pequeno delay após o
 *    clique em enviar, então o código lia a resposta antes de ela existir.
 *    FIX: sleep de 2s após o clique antes de observar o loading.
 *
 *  SELETORES CONFIRMADOS no DOM real:
 *    - Campo texto:   rich-textarea .ql-editor[contenteditable="true"]
 *    - Botão enviar:  button[aria-label="Enviar mensagem"]  (PT-BR!)
 *    - Botão upload+: button[aria-label="Abrir o menu de envio de arquivo"]
 *    - Botão oculto:  button.hidden-local-file-upload-button  (xapfileselectortrigger)
 *    - Modo:          button[aria-label="Abrir seletor de modo"]
 *    - Menu modo:     .gds-mode-switch-menu .mat-mdc-menu-item
 */

(function () {
  'use strict';

  // ================================================================
  // SELETORES — confirmados no DOM real do Gemini PT-BR
  // ================================================================

  const SEL = {
    campoTexto: 'rich-textarea .ql-editor[contenteditable="true"]',

    btnEnviar: [
      'button[aria-label="Enviar mensagem"]',
      'button[aria-label="Send message"]',
      'button.send-button.submit',
      'button.send-button'
    ].join(', '),

    btnAbrirMenuUpload: [
      'button[aria-label="Abrir o menu de envio de arquivo"]',
      'button[aria-label="Upload image or file"]',
      'button.upload-card-button'
    ].join(', '),

    btnUploadOculto: [
      'button[data-test-id="hidden-local-file-upload-button"]',
      'button.hidden-local-file-upload-button',
      'button[tabindex="-2"][xapfileselectortrigger]'
    ].join(', '),

    btnSeletorModo: [
      'button[aria-label="Abrir seletor de modo"]',
      'button[data-test-id="bard-mode-menu-button"]'
    ].join(', '),

    itemMenuModo: '.gds-mode-switch-menu .mat-mdc-menu-item, .mat-mdc-menu-panel .mat-mdc-menu-item, [role="menuitem"]',

    loadingAtivo: [
      'mat-progress-bar',
      '.progress-container',
      'model-response.is-generating',
      '[data-is-generating="true"]'
    ].join(', '),

    blocoResposta: [
      'model-response:last-of-type .markdown',
      'model-response:last-of-type message-content',
      'model-response:last-of-type',
      '.response-container:last-child .markdown'
    ].join(', '),

    chipArquivo: [
      'file-upload-chip',
      '.file-chip',
      '[data-test-id*="chip"]',
      '[data-test-id="uploaded-file-chip"]',
      'attachment-chip',
      '.upload-chip',
      'inline-attachment'
    ].join(', '),
  };

  // ================================================================
  // TIMEOUTS
  // ================================================================

  const T = {
    CAMPO_MS:       15000,
    MODO_MS:         5000,
    MENU_ABRIR_MS:   2000,
    UPLOAD_MS:       8000,
    INPUT_DIN_MS:    3000,
    BOTAO_ATIVO_MS:  8000,
    LOADING_MS:     10000,
    RESPOSTA_MS:   180000,  // 3 min (Raciocínio é mais lento)
    POLL_MS:           300,
  };

  // ================================================================
  // UTILITÁRIOS
  // ================================================================

  const _sleep = ms => new Promise(r => setTimeout(r, ms));

  function _aguardarElemento(seletor, ms = 10000) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(seletor);
      if (el) return resolve(el);
      const obs = new MutationObserver(() => {
        const el = document.querySelector(seletor);
        if (el) { obs.disconnect(); resolve(el); }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => {
        obs.disconnect();
        reject(new Error(`Timeout (${ms}ms) aguardando: "${seletor}"`));
      }, ms);
    });
  }

  function _aguardarSumir(seletor, ms = T.RESPOSTA_MS) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const poll = () => {
        if (!document.querySelector(seletor)) return resolve();
        if (Date.now() - t0 > ms) return reject(new Error(`Timeout (${ms}ms) sumindo: "${seletor}"`));
        setTimeout(poll, T.POLL_MS);
      };
      if (!document.querySelector(seletor)) return resolve();
      poll();
    });
  }

  function _aguardarBotaoAtivo(ms = T.BOTAO_ATIVO_MS) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const poll = () => {
        const btn = document.querySelector(SEL.btnEnviar);
        if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') return resolve(btn);
        if (Date.now() - t0 > ms) return reject(new Error(`Botão "Enviar mensagem" não ficou ativo em ${ms}ms.`));
        setTimeout(poll, 200);
      };
      poll();
    });
  }

  // ================================================================
  // CORREÇÃO BUG 1 — strip do prefixo data URL antes do atob()
  // ================================================================

  function _base64ToFile(base64, nome) {
    // eproc.js usa FileReader.readAsDataURL() que retorna:
    //   "data:application/pdf;base64,JVBERi0xLjQ..."
    // O atob() só aceita a parte após a vírgula.
    const dadosPuros = base64.includes(',') ? base64.split(',')[1] : base64;

    const bytes = atob(dadosPuros);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return new File([arr], nome, { type: 'application/pdf' });
  }

  // ================================================================
  // PASSO 1 — SELECIONAR MODO RACIOCÍNIO
  // ================================================================

  async function _selecionarRaciocinio() {
    console.log('[gemini.js] Verificando modo atual...');

    try {
      const btnModo = await _aguardarElemento(SEL.btnSeletorModo, T.MODO_MS);
      const textoAtual = btnModo.textContent?.trim().toLowerCase() || '';

      if (textoAtual.includes('racioc') || textoAtual.includes('reason') ||
          textoAtual.includes('think')  || textoAtual.includes('deep')) {
        console.log('[gemini.js] Modo Raciocínio já ativo.');
        return;
      }

      console.log(`[gemini.js] Modo atual: "${textoAtual}". Abrindo menu...`);
      btnModo.click();
      await _sleep(800);

      const itens = Array.from(document.querySelectorAll(SEL.itemMenuModo));
      console.log(`[gemini.js] Itens no menu: ${itens.map(i => i.textContent?.trim()).join(' | ')}`);

      const opcao = itens.find(el => {
        const txt = el.textContent?.toLowerCase() || '';
        return txt.includes('racioc') || txt.includes('reason') ||
               txt.includes('think')  || txt.includes('deep')   ||
               txt.includes('flash thinking') || txt.includes('2.0 flash');
      });

      if (opcao) {
        opcao.click();
        console.log(`[gemini.js] ✅ Modo selecionado: "${opcao.textContent?.trim()}"`);
        await _sleep(600);
      } else {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await _sleep(300);
        console.warn('[gemini.js] ⚠️ Opção Raciocínio não encontrada. Continuando com modo padrão.');
      }

    } catch (err) {
      console.warn('[gemini.js] Seleção de modo falhou (não crítico):', err.message);
    }
  }

  // ================================================================
  // PASSO 2 — ANEXAR ARQUIVOS
  // ================================================================

  async function _anexarArquivos(arquivos) {
    if (!arquivos?.length) {
      console.log('[gemini.js] Nenhum arquivo para anexar.');
      return;
    }

    console.log(`[gemini.js] Anexando ${arquivos.length} arquivo(s)...`);

    const sucesso = await new Promise(resolve => {
      let resolvido = false;

      const resolver = (ok) => {
        if (resolvido) return;
        resolvido = true;
        clearTimeout(timeout);
        obs.disconnect();
        resolve(ok);
      };

      const timeout = setTimeout(() => {
        console.warn('[gemini.js] Input dinâmico não apareceu. Upload pode ter falhado.');
        resolver(false);
      }, T.INPUT_DIN_MS);

      // Observa criação de input[type=file] ANTES de clicar no botão
      const obs = new MutationObserver(mutations => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeType !== 1) continue;

            const input = (node.tagName === 'INPUT' && node.type === 'file')
              ? node
              : node.querySelector?.('input[type="file"]');

            if (!input) continue;

            resolver(true);
            console.log('[gemini.js] ✅ Input dinâmico capturado. Injetando arquivos...');

            const dt = new DataTransfer();
            for (const arq of arquivos) {
              dt.items.add(_base64ToFile(arq.base64, arq.nome));
            }

            // Sobrescreve a propriedade files do input
            try {
              Object.defineProperty(input, 'files', {
                value: dt.files, writable: true, configurable: true,
              });
            } catch (_) {
              try { input.files = dt.files; } catch (_2) { }
            }

            // Dispara eventos que o Angular escuta
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new Event('input',  { bubbles: true }));

            console.log(`[gemini.js] ${arquivos.length} arquivo(s) injetado(s).`);
            return;
          }
        }
      });

      obs.observe(document.body, { childList: true, subtree: true });

      // Clica no botão oculto para acionar o Angular
      const btnOculto = document.querySelector(SEL.btnUploadOculto);
      if (btnOculto) {
        console.log('[gemini.js] Clicando no botão oculto de upload...');
        btnOculto.click();
      } else {
        const btnMenu = document.querySelector(SEL.btnAbrirMenuUpload);
        if (btnMenu) {
          console.log('[gemini.js] Abrindo menu de upload...');
          btnMenu.click();
          setTimeout(() => {
            const btnOculto2 = document.querySelector(SEL.btnUploadOculto);
            if (btnOculto2) {
              console.log('[gemini.js] Clicando no botão oculto (pós-menu)...');
              btnOculto2.click();
            } else {
              console.warn('[gemini.js] Botão oculto não encontrado após abrir menu.');
              resolver(false);
            }
          }, 500);
        } else {
          console.warn('[gemini.js] Nenhum botão de upload encontrado.');
          resolver(false);
        }
      }
    });

    if (sucesso) {
      console.log('[gemini.js] Aguardando processamento dos arquivos...');
      await _sleep(T.UPLOAD_MS);

      const chips = document.querySelectorAll(SEL.chipArquivo);
      if (chips.length > 0) {
        console.log(`[gemini.js] ✅ ${chips.length} chip(s) de arquivo visível(is).`);
      } else {
        console.warn('[gemini.js] Chips não detectados — verificar se os arquivos foram aceitos.');
      }
    }
  }

  // ================================================================
  // PASSO 3 — INJETAR PROMPT NO CAMPO DE TEXTO
  // ================================================================

  async function _injetarPrompt(texto) {
    console.log('[gemini.js] Injetando prompt...');
    const campo = await _aguardarElemento(SEL.campoTexto, T.CAMPO_MS);

    campo.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('delete',    false, null);

    // Insere em chunks de 5K para não travar a thread
    for (let i = 0; i < texto.length; i += 5000) {
      document.execCommand('insertText', false, texto.slice(i, i + 5000));
      if (i + 5000 < texto.length) await _sleep(0);
    }

    console.log(`[gemini.js] ✅ Prompt injetado (${texto.length} chars).`);
  }

  // ================================================================
  // PASSO 4 — ENVIAR E AGUARDAR RESPOSTA
  // ================================================================

  async function _enviarEAguardar() {
    const btn = await _aguardarBotaoAtivo();
    btn.click();
    console.log('[gemini.js] ✅ Mensagem enviada. Aguardando geração...');

    // CORREÇÃO BUG 2: aguarda 2s para o loading aparecer no DOM
    // antes de tentar observá-lo. Sem esse delay, _aguardarSumir
    // resolve imediatamente (seletor não existe ainda) e o código
    // lê a resposta antes do Gemini terminar.
    await _sleep(2000);

    try {
      await _aguardarElemento(SEL.loadingAtivo, T.LOADING_MS);
      console.log('[gemini.js] Loading detectado — gerando resposta...');
    } catch (_) {
      console.warn('[gemini.js] Loading não detectado após 2s. Pode ter sido instantâneo ou já terminou.');
    }

    await _aguardarSumir(SEL.loadingAtivo, T.RESPOSTA_MS);
    console.log('[gemini.js] ✅ Geração concluída.');

    // Aguarda o DOM estabilizar após o loading sumir
    await _sleep(1500);

    // Extrai o texto da última resposta
    for (const sel of SEL.blocoResposta.split(', ')) {
      const els = document.querySelectorAll(sel.trim());
      if (!els.length) continue;
      const txt = els[els.length - 1].textContent?.trim() || '';
      if (txt.length > 50) {
        console.log(`[gemini.js] ✅ Resposta extraída: ${txt.length} chars.`);
        return txt;
      }
    }

    throw new Error('Resposta vazia ou não encontrada no DOM após geração.');
  }

  // ================================================================
  // EXTRAÇÃO DO JSON DA RESPOSTA
  // ================================================================

  function _extrairJSON(texto) {
    const limpo = texto
      .replace(/```json\s*/gi, '').replace(/```\s*/gi, '')
      .replace(/\[cite[^\]]*\]/gi, '').replace(/【[^】]*】/g, '')
      .trim();

    const match = limpo.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`JSON não encontrado na resposta (${texto.length} chars).`);

    try {
      return JSON.parse(match[0]);
    } catch (e) {
      const reparado = _repararJSON(match[0]);
      if (reparado) return reparado;
      throw new Error(`JSON inválido: ${e.message}`);
    }
  }

  function _repararJSON(jsonBruto) {
    try {
      let txt = jsonBruto.replace(/,\s*$/, '').replace(/:\s*$/, ': null').replace(/:\s*"[^"]*$/, ': ""');
      let chaves = 0, colchetes = 0, dentroStr = false, esc = false;
      for (const c of txt) {
        if (esc) { esc = false; continue; }
        if (c === '\\') { esc = true; continue; }
        if (c === '"') { dentroStr = !dentroStr; continue; }
        if (dentroStr) continue;
        if (c === '{') chaves++;
        if (c === '}') chaves--;
        if (c === '[') colchetes++;
        if (c === ']') colchetes--;
      }
      while (colchetes > 0) { txt += ']'; colchetes--; }
      while (chaves > 0) { txt += '}'; chaves--; }
      return JSON.parse(txt);
    } catch (_) { return null; }
  }

  // ================================================================
  // HUB DE MENSAGENS — recebe INJETAR_PROMPT do background.js
  // ================================================================

  chrome.runtime.onMessage.addListener((msg, _sender, responder) => {
    if (msg.tipo !== 'INJETAR_PROMPT') return;

    console.log('[gemini.js] INJETAR_PROMPT recebido. Iniciando automação...');
    responder({ recebido: true });

    (async () => {
      try {
        await _aguardarElemento(SEL.campoTexto, T.CAMPO_MS);

        // 1. Seleciona modo Raciocínio
        await _selecionarRaciocinio();

        // 2. Anexa os PDFs
        await _anexarArquivos(msg.payload.arquivos);

        // 3. Injeta o prompt
        await _injetarPrompt(msg.payload.texto);

        // 4. Envia e aguarda resposta
        const textoResposta = await _enviarEAguardar();
        const json = _extrairJSON(textoResposta);

        chrome.runtime.sendMessage({
          tipo:   'GEMINI_JSON_EXTRAIDO',
          sucesso: true,
          json,
        });

      } catch (erro) {
        console.error('[gemini.js] Erro na automação:', erro.message);
        chrome.runtime.sendMessage({
          tipo:   'GEMINI_JSON_EXTRAIDO',
          sucesso: false,
          erro:    erro.message,
        });
      }
    })();

    return false;
  });

  // ================================================================
  // INICIALIZAÇÃO — sinaliza ao background.js que está pronto
  // ================================================================

  async function _inicializar() {
    console.log('[gemini.js] Aguardando campo de texto do Gemini...');
    try {
      await _aguardarElemento(SEL.campoTexto, T.CAMPO_MS);
      console.log('[gemini.js] ✅ Pronto. Sinalizando background...');
    } catch (err) {
      console.warn('[gemini.js] Campo de texto não apareceu:', err.message);
    }
    chrome.runtime.sendMessage({ tipo: 'GEMINI_PRONTO' }).catch(() => { });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _inicializar);
  } else {
    _inicializar();
  }

})();