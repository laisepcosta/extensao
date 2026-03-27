/**
 * background.js v3.0
 * Ponte de mensagens entre side panel, eproc.js e gemini.js.
 *
 * NOVOS FLUXOS (v3):
 *
 *  ANALISAR_VIA_GEMINI (popup → background):
 *    1. Recebe o payload de texto montado pelo aiService
 *    2. Abre aba do gemini.google.com em background (active: false)
 *    3. Aguarda o content script gemini.js estar pronto
 *    4. Envia 'INJETAR_PROMPT' para a aba
 *    5. Aguarda 'GEMINI_JSON_EXTRAIDO' do gemini.js
 *    6. Fecha a aba do Gemini
 *    7. Responde ao popup com o JSON extraído
 *
 *  FLUXOS MANTIDOS (v2):
 *    PROCESSO_DETECTADO — eproc.js → popup
 *    BAIXAR_PDFS        — popup → eproc.js (fetch das 3 camadas)
 */

// ================================================================
// ESTADO: rastreia a aba do Gemini aberta
// ================================================================

let _abaMensagensGemini = {
  tabId: null,
  responder: null,  // função responder do onMessage original
};

// ================================================================
// ABERTURA DO SIDE PANEL
// ================================================================

chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ tabId: tab.id });

  setTimeout(async () => {
    try {
      const resposta = await chrome.tabs.sendMessage(tab.id, {
        tipo: 'SOLICITAR_DADOS_PROCESSO'
      });
      if (resposta?.encontrado) {
        chrome.runtime.sendMessage({
          tipo: 'DADOS_PROCESSO',
          payload: resposta.payload
        }).catch(() => {
          chrome.storage.session.set({ processoDetectado: resposta.payload });
        });
      }
    } catch (err) {
      console.debug('[background] Sem content_script na aba:', err.message);
    }
  }, 600);
});

// ================================================================
// HUB DE MENSAGENS
// ================================================================

chrome.runtime.onMessage.addListener((mensagem, remetente, responder) => {
  switch (mensagem.tipo) {

    // ── eproc.js detectou processo ────────────────────────────────
    case 'PROCESSO_DETECTADO':
      chrome.runtime.sendMessage({
        tipo: 'DADOS_PROCESSO',
        payload: mensagem.payload
      }).catch(() => {
        chrome.storage.session.set({ processoDetectado: mensagem.payload });
      });
      responder({ recebido: true });
      break;

    // ── popup pede download de PDFs via eproc.js ──────────────────
    case 'BAIXAR_PDFS':
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        const tabId = tabs[0]?.id;
        if (!tabId) {
          responder({ sucesso: false, erro: 'Aba do eProc não encontrada.' });
          return;
        }
        try {
          const arquivos = [];
          for (let i = 0; i < mensagem.anexos.length; i++) {
            const anexo = mensagem.anexos[i];

            chrome.runtime.sendMessage({
              tipo: 'PROGRESSO_DOWNLOAD',
              atual: i + 1, total: mensagem.anexos.length, nome: anexo.nome
            }).catch(() => {});

            const res = await chrome.tabs.sendMessage(tabId, {
              tipo: 'FETCH_PDF_URL',
              url:  anexo.url,
              nome: anexo.nome
            });

            if (!res?.sucesso) throw new Error(res?.erro || `Falha em "${anexo.nome}".`);
            arquivos.push({ nome: anexo.nome, docId: anexo.docId || '', base64: res.base64 });
          }
          responder({ sucesso: true, arquivos });
        } catch (err) {
          responder({ sucesso: false, erro: err.message });
        }
      });
      return true; // assíncrono

    // ── popup pede análise via Gemini Pro ─────────────────────────
    case 'ANALISAR_VIA_GEMINI':
      _analisarViaGemini(mensagem.payload, responder);
      return true; // assíncrono

    // ── gemini.js retorna JSON extraído ───────────────────────────
    case 'GEMINI_JSON_EXTRAIDO':
      _receberRespostaGemini(mensagem);
      break;

    // ── gemini.js sinaliza que está pronto para receber prompt ────
    case 'GEMINI_PRONTO':
      _enviarPromptParaAba(remetente.tab?.id, mensagem);
      break;

    default:
      break;
  }
});

// ================================================================
// ORQUESTRAÇÃO DA ABA GEMINI
// ================================================================

/**
 * Abre aba do Gemini em background, aguarda o content script
 * sinalizar que está pronto e então injeta o prompt.
 */
async function _analisarViaGemini(payload, responder) {
  console.log('[background] Abrindo aba do Gemini em background...');

  try {
    // Guarda a função responder para usar quando o JSON chegar
    _abaMensagensGemini.responder = responder;
    _abaMensagensGemini.payload   = payload;

    // Abre a aba em background (active: false = não tira foco do usuário)
    const aba = await chrome.tabs.create({
      url:    'https://gemini.google.com/app',
      active: false,
    });

    _abaMensagensGemini.tabId = aba.id;
    console.log(`[background] Aba Gemini aberta: tabId=${aba.id}`);

    // O gemini.js vai enviar 'GEMINI_PRONTO' quando o DOM estiver pronto.
    // Timeout de segurança caso o content script nunca sinalize (ex: login expirado)
    _abaMensagensGemini.timeout = setTimeout(() => {
      console.error('[background] Timeout: gemini.js não sinalizou GEMINI_PRONTO.');
      _fecharAbaGemini();
      if (_abaMensagensGemini.responder) {
        _abaMensagensGemini.responder({
          sucesso: false,
          erro: 'Timeout: o Gemini não respondeu. Verifique se você está logado em gemini.google.com.'
        });
        _abaMensagensGemini.responder = null;
      }
    }, 30000); // 30s para o Gemini carregar

  } catch (err) {
    console.error('[background] Erro ao abrir aba Gemini:', err);
    responder({ sucesso: false, erro: err.message });
  }
}

/**
 * Chamado quando gemini.js envia 'GEMINI_PRONTO'.
 * Envia o prompt para a aba.
 */
function _enviarPromptParaAba(tabId, _msg) {
  if (tabId !== _abaMensagensGemini.tabId) return;

  clearTimeout(_abaMensagensGemini.timeout);
  console.log(`[background] gemini.js pronto na tab ${tabId}. Enviando prompt...`);

  chrome.tabs.sendMessage(tabId, {
    tipo:    'INJETAR_PROMPT',
    payload: _abaMensagensGemini.payload,
  }).catch(err => {
    console.error('[background] Falha ao enviar prompt para gemini.js:', err);
    _fecharAbaGemini();
    if (_abaMensagensGemini.responder) {
      _abaMensagensGemini.responder({ sucesso: false, erro: err.message });
      _abaMensagensGemini.responder = null;
    }
  });
}

/**
 * Chamado quando gemini.js envia 'GEMINI_JSON_EXTRAIDO'.
 * Fecha a aba e encaminha o resultado ao popup.
 */
function _receberRespostaGemini(mensagem) {
  console.log('[background] JSON recebido do gemini.js. Fechando aba...');

  _fecharAbaGemini();

  if (_abaMensagensGemini.responder) {
    _abaMensagensGemini.responder({
      sucesso: mensagem.sucesso,
      json:    mensagem.json,
      erro:    mensagem.erro,
    });
    _abaMensagensGemini.responder = null;
  }
}

/**
 * Fecha a aba do Gemini e limpa o estado.
 */
function _fecharAbaGemini() {
  if (_abaMensagensGemini.tabId) {
    chrome.tabs.remove(_abaMensagensGemini.tabId).catch(() => {});
    _abaMensagensGemini.tabId = null;
  }
  clearTimeout(_abaMensagensGemini.timeout);
}