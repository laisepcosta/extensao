/**
 * background.js v4.0
 *
 * CORREÇÃO CRÍTICA v4:
 *   O download dos PDFs falhava porque background.js usava
 *   chrome.tabs.query({active:true}) para encontrar a aba do eProc.
 *   Mas quando o Gemini é aberto (active:false), a aba ativa muda
 *   e o eProc não é mais encontrado.
 *
 *   Solução: salvar o tabId do eProc no momento em que o processo
 *   é detectado (PROCESSO_DETECTADO ou SOLICITAR_DADOS_PROCESSO),
 *   e usar esse tabId fixo para todos os downloads subsequentes.
 */

// ================================================================
// ESTADO
// ================================================================

let _tabIdEproc   = null;   // ← tabId do eProc salvo no momento da detecção
let _abaMensagensGemini = {
  tabId:     null,
  responder: null,
  payload:   null,
  timeout:   null,
};

// ================================================================
// ABERTURA DO SIDE PANEL
// ================================================================

chrome.action.onClicked.addListener(async (tab) => {
  // Salva o tabId da aba onde o usuário clicou (deve ser o eProc)
  _tabIdEproc = tab.id;
  console.log(`[background] Side panel aberto. tabId eProc salvo: ${_tabIdEproc}`);

  await chrome.sidePanel.open({ tabId: tab.id });

  setTimeout(async () => {
    try {
      const resposta = await chrome.tabs.sendMessage(tab.id, {
        tipo: 'SOLICITAR_DADOS_PROCESSO'
      });
      if (resposta?.encontrado) {
        chrome.runtime.sendMessage({
          tipo:    'DADOS_PROCESSO',
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
      // Salva o tabId do eProc (a mensagem vem do content_script)
      if (remetente.tab?.id) {
        _tabIdEproc = remetente.tab.id;
        console.log(`[background] PROCESSO_DETECTADO — tabId eProc: ${_tabIdEproc}`);
      }
      chrome.runtime.sendMessage({
        tipo:    'DADOS_PROCESSO',
        payload: mensagem.payload
      }).catch(() => {
        chrome.storage.session.set({ processoDetectado: mensagem.payload });
      });
      responder({ recebido: true });
      break;

    // ── popup pede download de PDFs ───────────────────────────────
    case 'BAIXAR_PDFS':
      _baixarPDFs(mensagem.anexos, responder);
      return true; // assíncrono

    // ── popup pede análise via Gemini ─────────────────────────────
    case 'ANALISAR_VIA_GEMINI':
      _analisarViaGemini(mensagem.payload, responder);
      return true;

    // ── gemini.js retorna JSON extraído ───────────────────────────
    case 'GEMINI_JSON_EXTRAIDO':
      _receberRespostaGemini(mensagem);
      break;

    // ── gemini.js sinaliza que está pronto ────────────────────────
    case 'GEMINI_PRONTO':
      _enviarPromptParaAba(remetente.tab?.id);
      break;

    default:
      break;
  }
});

// ================================================================
// DOWNLOAD DE PDFs
// ================================================================

async function _baixarPDFs(anexos, responder) {
  // Usa o tabId salvo do eProc — não depende de qual aba está ativa
  const tabId = _tabIdEproc;

  if (!tabId) {
    responder({ sucesso: false, erro: 'TabId do eProc não encontrado. Reabra o assistente no eProc.' });
    return;
  }

  console.log(`[background] Baixando ${anexos.length} PDFs via tabId ${tabId}...`);

  try {
    const arquivos = [];

    for (let i = 0; i < anexos.length; i++) {
      const anexo = anexos[i];

      // Notifica progresso ao popup
      chrome.runtime.sendMessage({
        tipo:  'PROGRESSO_DOWNLOAD',
        atual: i + 1,
        total: anexos.length,
        nome:  anexo.nome
      }).catch(() => {});

      const res = await chrome.tabs.sendMessage(tabId, {
        tipo: 'FETCH_PDF_URL',
        url:  anexo.url,
        nome: anexo.nome
      });

      if (!res?.sucesso) throw new Error(res?.erro || `Falha ao baixar "${anexo.nome}".`);
      arquivos.push({ nome: anexo.nome, docId: anexo.docId || '', base64: res.base64 });
    }

    responder({ sucesso: true, arquivos });
  } catch (err) {
    console.error('[background] Erro no download:', err.message);
    responder({ sucesso: false, erro: err.message });
  }
}

// ================================================================
// ORQUESTRAÇÃO DO GEMINI
// ================================================================

async function _analisarViaGemini(payload, responder) {
  console.log('[background] Abrindo aba do Gemini...');

  try {
    _abaMensagensGemini.responder = responder;
    _abaMensagensGemini.payload   = payload;

    const aba = await chrome.tabs.create({
      url:    'https://gemini.google.com/gem/0665e9c704a6',
      active: false,   // não tira foco do usuário
    });

    _abaMensagensGemini.tabId = aba.id;
    console.log(`[background] Aba Gemini: tabId=${aba.id}`);

    // Timeout de segurança (30s para carregar)
    _abaMensagensGemini.timeout = setTimeout(() => {
      console.error('[background] Timeout: Gemini não respondeu.');
      _fecharAbaGemini();
      if (_abaMensagensGemini.responder) {
        _abaMensagensGemini.responder({
          sucesso: false,
          erro: 'Timeout: Gemini não respondeu. Verifique o login em gemini.google.com.'
        });
        _abaMensagensGemini.responder = null;
      }
    }, 30000);

  } catch (err) {
    console.error('[background] Erro ao abrir Gemini:', err);
    responder({ sucesso: false, erro: err.message });
  }
}

function _enviarPromptParaAba(tabId) {
  if (tabId !== _abaMensagensGemini.tabId) return;
  clearTimeout(_abaMensagensGemini.timeout);
  console.log(`[background] Gemini pronto (tab ${tabId}). Enviando payload...`);

  chrome.tabs.sendMessage(tabId, {
    tipo:    'INJETAR_PROMPT',
    payload: _abaMensagensGemini.payload,
  }).catch(err => {
    console.error('[background] Falha ao enviar para gemini.js:', err);
    _fecharAbaGemini();
    if (_abaMensagensGemini.responder) {
      _abaMensagensGemini.responder({ sucesso: false, erro: err.message });
      _abaMensagensGemini.responder = null;
    }
  });
}

function _receberRespostaGemini(mensagem) {
  console.log('[background] JSON recebido. Fechando aba Gemini...');
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

function _fecharAbaGemini() {
  if (_abaMensagensGemini.tabId) {
    chrome.tabs.remove(_abaMensagensGemini.tabId).catch(() => {});
    _abaMensagensGemini.tabId = null;
  }
  clearTimeout(_abaMensagensGemini.timeout);
}