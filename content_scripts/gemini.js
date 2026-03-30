/**
 * content_scripts/gemini.js  v6.0
 *
 * Baseado na inspeção real do DOM do Gemini (gemini.google.com/gem/...):
 *
 *  FLUXO:
 *    1. Selecionar modo "Raciocínio" (bard-mode-menu-button → mat-mdc-menu-item)
 *    2. Anexar PDFs via botão oculto (hidden-local-file-upload-button)
 *       que faz o Angular criar um input[type=file] dinâmico
 *    3. Injetar o prompt no campo rich-textarea .ql-editor
 *    4. Clicar em "Enviar mensagem" (PT-BR)
 *    5. Aguardar resposta e extrair JSON
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
    // Campo de texto Quill
    campoTexto: 'rich-textarea .ql-editor[contenteditable="true"]',

    // Botão enviar — PT-BR confirmado
    btnEnviar: [
      'button[aria-label="Enviar mensagem"]',
      'button.send-button.submit',
      'button.send-button',
    ].join(', '),

    // Botão "+" que abre menu de upload
    btnAbrirMenuUpload: [
      'button[aria-label="Abrir o menu de envio de arquivo"]',
      'button.upload-card-button',
    ].join(', '),

    // Botão oculto de arquivo local (xapfileselectortrigger)
    // Este é o trigger real — clicar nele faz o Angular criar input[type=file]
    btnUploadOculto: [
      'button.hidden-local-file-upload-button',
      'button[tabindex="-2"][xapfileselectortrigger]:not(.hidden-local-upload-button)',
    ].join(', '),

    // Botão seletor de modo ("Rápido" / "Raciocínio")
    btnSeletorModo: [
      'button[aria-label="Abrir seletor de modo"]',
      'button[data-test-id="bard-mode-menu-button"]',
    ].join(', '),

    // Item "Raciocínio" no menu de modo (aparece após clicar no seletor)
    // O menu tem classe gds-mode-switch-menu
    itemMenuModo: '.gds-mode-switch-menu .mat-mdc-menu-item, .mat-mdc-menu-panel .mat-mdc-menu-item, [role="menuitem"]',

    // Loading/geração em andamento
    loadingAtivo: [
      'mat-progress-bar',
      '.progress-container',
      'model-response.is-generating',
      '[data-is-generating="true"]',
    ].join(', '),

    // Última resposta do modelo
    blocoResposta: [
      'model-response:last-of-type .markdown',
      'model-response:last-of-type message-content',
      'model-response:last-of-type',
      '.response-container:last-child .markdown',
    ].join(', '),

    // Chips de arquivo anexado (confirmação visual do upload)
    chipArquivo: [
      'file-upload-chip',
      '.file-chip',
      '[data-test-id*="chip"]',
      'attachment-chip',
      '.upload-chip',
      'inline-attachment',
    ].join(', '),
  };

  // ================================================================
  // TIMEOUTS
  // ================================================================

  const T = {
    CAMPO_MS:       15000,
    MODO_MS:         5000,
    MENU_ABRIR_MS:   2000,
    UPLOAD_MS:       8000,  // espera o Gemini processar os arquivos
    INPUT_DIN_MS:    3000,  // janela para capturar o input dinâmico
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
      // Se já não existe, resolve imediatamente
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

  function _base64ToFile(base64, nome) {
    const bytes = atob(base64);
    const arr   = new Uint8Array(bytes.length);
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

      // Já está no modo correto?
      if (textoAtual.includes('racioc') || textoAtual.includes('reason') ||
          textoAtual.includes('think')  || textoAtual.includes('deep')) {
        console.log('[gemini.js] Modo Raciocínio já ativo.');
        return;
      }

      console.log(`[gemini.js] Modo atual: "${textoAtual}". Abrindo menu...`);
      btnModo.click();

      // Aguarda o menu abrir
      await _sleep(800);

      // Procura o item "Raciocínio" em todos os itens visíveis do menu
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
        // Fecha o menu e continua sem o modo
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

  /**
   * O Gemini usa o padrão xapfileselectortrigger do Angular:
   *   1. O botão oculto (hidden-local-file-upload-button) é o trigger
   *   2. Ao ser clicado, o Angular cria dinamicamente um input[type=file]
   *   3. Precisamos capturar esse input ANTES de ele abrir o dialog do OS
   *   4. Injetamos os arquivos via DataTransfer e disparamos 'change'
   *
   * O MutationObserver precisa estar ativo ANTES do clique no botão.
   */
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

      // Timeout: se o input não aparecer em INPUT_DIN_MS, desiste
      const timeout = setTimeout(() => {
        console.warn('[gemini.js] Input dinâmico não apareceu. Upload pode ter falhado.');
        resolver(false);
      }, T.INPUT_DIN_MS);

      // Observa criação de input[type=file] em qualquer lugar do DOM
      const obs = new MutationObserver(mutations => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeType !== 1) continue;

            // Verifica se o nó adicionado É um input[type=file]
            const input = (node.tagName === 'INPUT' && node.type === 'file')
              ? node
              : node.querySelector?.('input[type="file"]');

            if (!input) continue;

            // Capturado! Injeta os arquivos imediatamente
            resolver(true);
            console.log('[gemini.js] ✅ Input dinâmico capturado. Injetando arquivos...');

            const dt = new DataTransfer();
            for (const arq of arquivos) {
              dt.items.add(_base64ToFile(arq.base64, arq.nome));
            }

            // FileList é read-only — usa defineProperty
            try {
              Object.defineProperty(input, 'files', {
                value: dt.files, writable: true, configurable: true,
              });
            } catch (_) {
              // Alguns ambientes não permitem defineProperty em inputs
              // Tenta atribuição direta como fallback
              try { input.files = dt.files; } catch (_2) {}
            }

            // Dispara eventos que o Angular/Quill escuta
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new Event('input',  { bubbles: true }));

            console.log(`[gemini.js] ${arquivos.length} arquivo(s) injetado(s).`);
            return;
          }
        }
      });

      // Observa o body inteiro com subtree
      obs.observe(document.body, { childList: true, subtree: true });

      // Clica no botão oculto para acionar o Angular
      // Tenta o botão oculto direto primeiro; se não existir, abre o menu "+"
      const btnOculto = document.querySelector(SEL.btnUploadOculto);
      if (btnOculto) {
        console.log('[gemini.js] Clicando no botão oculto de upload...');
        btnOculto.click();
      } else {
        // Abre o menu "+" e então clica no botão oculto
        const btnMenu = document.querySelector(SEL.btnAbrirMenuUpload);
        if (btnMenu) {
          console.log('[gemini.js] Abrindo menu de upload...');
          btnMenu.click();
          // Aguarda um tick para o menu abrir, então clica no botão oculto
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
      // Aguarda o Gemini processar e exibir os chips dos arquivos
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
    // Limpa qualquer conteúdo anterior
    document.execCommand('selectAll', false, null);
    document.execCommand('delete',    false, null);

    // Insere em chunks de 5K para não travar a thread
    for (let i = 0; i < texto.length; i += 5000) {
      document.execCommand('insertText', false, texto.slice(i, i + 5000));
      if (i + 5000 < texto.length) await _sleep(0); // yield
    }

    console.log(`[gemini.js] ✅ Prompt injetado (${texto.length} chars).`);
  }

  // ================================================================
  // PASSO 4 — ENVIAR E AGUARDAR RESPOSTA
  // ================================================================

  async function _enviarEAguardar() {
    // Aguarda o botão de envio ficar habilitado (campos + arquivos prontos)
    const btn = await _aguardarBotaoAtivo();
    btn.click();
    console.log('[gemini.js] ✅ Mensagem enviada. Aguardando geração...');

    // Aguarda o loading começar (confirma que o Gemini recebeu)
    try {
      await _aguardarElemento(SEL.loadingAtivo, T.LOADING_MS);
      console.log('[gemini.js] Loading detectado — gerando resposta...');
    } catch (_) {
      console.warn('[gemini.js] Loading não detectado (pode ter sido instantâneo).');
    }

    // Aguarda o loading terminar
    await _aguardarSumir(SEL.loadingAtivo, T.RESPOSTA_MS);
    console.log('[gemini.js] ✅ Geração concluída.');

    // Aguarda o DOM estabilizar
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
      // Tenta reparar JSON truncado
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
        if (esc)       { esc = false; continue; }
        if (c === '\\') { esc = true;  continue; }
        if (c === '"')  { dentroStr = !dentroStr; continue; }
        if (dentroStr)  continue;
        if (c === '{') chaves++;
        if (c === '}') chaves--;
        if (c === '[') colchetes++;
        if (c === ']') colchetes--;
      }
      while (colchetes > 0) { txt += ']'; colchetes--; }
      while (chaves   > 0) { txt += '}'; chaves--;    }
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
        // Garante que o campo de texto está pronto antes de tudo
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
    chrome.runtime.sendMessage({ tipo: 'GEMINI_PRONTO' }).catch(() => {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _inicializar);
  } else {
    _inicializar();
  }

})();