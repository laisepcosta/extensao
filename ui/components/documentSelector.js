/**
 * ui/components/documentSelector.js
 * Componente do Passo 0: recebe a lista de eventos do eProc
 * e renderiza o painel de seleção de documentos no side panel.
 *
 * FLUXO:
 *   background.js → chrome.runtime.onMessage("DADOS_PROCESSO")
 *   → documentSelector.renderizar(payload)
 *   → usuário marca eventos/docs
 *   → documentSelector.getAnexosSelecionados() → [{nome, url, docId}]
 *   → popup.js envia "BAIXAR_PDFS" ao background
 *   → background baixa e retorna base64[]
 *   → popup.js passa para aiService.extrair()
 */

const documentSelector = (() => {

  // Dados do processo atual
  let _processo = null;

  /**
   * Renderiza o painel de seleção no elemento #painelDocumentos.
   * @param {Object} payload - Dados do content_script (eventos, número, etc.)
   */
  function renderizar(payload) {
    _processo = payload;

    const painel = document.getElementById('painelDocumentos');
    if (!painel) return;

    const { numeroProcessoFormatado, eventos } = payload;

    // Filtra apenas eventos com documentos PDF
    const eventosComDocs = eventos.filter(ev => ev.documentos.length > 0);

    if (eventosComDocs.length === 0) {
      painel.innerHTML = `
        <div style="color:#856404;background:#fff3cd;padding:10px;border-radius:4px;font-size:13px;">
          ⚠️ Nenhum documento PDF encontrado nos eventos visíveis.<br>
          <small>Role a página do eProc para carregar mais eventos e reabra o assistente.</small>
        </div>`;
      return;
    }

    // Tipos de eventos que sugerem relevância para cessão
    const TIPOS_RELEVANTES = [
      'PETIÇÃO', 'PETICAO', 'HABILITAÇÃO', 'HABILITACAO',
      'CESSÃO', 'CESSAO', 'INSTRUMENTO', 'CONTRATO',
      'HONORÁRIOS', 'HONORARIOS', 'DESTAQUE', 'ESCRITURA',
      'PROCURAÇÃO', 'PROCURACAO', 'COMUNICAÇÃO', 'COMUNICACAO'
    ];

    const ehRelevante = (tipo) => TIPOS_RELEVANTES.some(t =>
      tipo.toUpperCase().includes(t)
    );

    let html = `
      <div style="margin-bottom:10px;">
        <strong style="font-size:13px;color:#0056b3;">${numeroProcessoFormatado}</strong>
        <span style="font-size:11px;color:#6c757d;"> — ${eventosComDocs.length} eventos com documentos</span>
      </div>
      <div style="font-size:11px;color:#6c757d;margin-bottom:8px;">
        Marque os eventos que contêm os documentos da cessão:
      </div>`;

    eventosComDocs.forEach(ev => {
      const relevante = ehRelevante(ev.tipo);
      const checkedEv = relevante ? 'checked' : '';
      const bgEv = relevante ? '#f0f7ff' : '#fafbfc';
      const borderEv = relevante ? '#0056b3' : '#ced4da';

      html += `
        <div class="ev-bloco" style="
          border:1px solid ${borderEv};border-radius:4px;margin-bottom:6px;
          background:${bgEv};overflow:hidden;">
          <label style="
            display:flex;align-items:center;gap:8px;padding:8px 10px;
            cursor:pointer;font-size:13px;font-weight:bold;
            border-bottom:1px solid ${borderEv}19;">
            <input type="checkbox" class="check-evento"
              data-evento="${ev.numero}" ${checkedEv}
              style="width:14px;height:14px;margin:0;cursor:pointer;flex-shrink:0;">
            <span>
              Ev. <strong>${ev.numero}</strong> — ${ev.tipo}
              <small style="font-weight:normal;color:#6c757d;"> ${ev.data}</small>
              ${relevante ? '<span style="font-size:10px;color:#0056b3;"> ★</span>' : ''}
            </span>
          </label>
          <div style="padding:4px 10px 8px 32px;">`;

      ev.documentos.forEach((doc, i) => {
        const checkedDoc = relevante ? 'checked' : '';
        html += `
            <label style="display:flex;align-items:center;gap:6px;
              font-size:12px;cursor:pointer;padding:2px 0;">
              <input type="checkbox" class="check-doc"
                data-evento="${ev.numero}"
                data-doc-id="${doc.docId}"
                data-doc-nome="${doc.nome}"
                data-doc-url="${doc.url}"
                ${checkedDoc}
                style="width:12px;height:12px;margin:0;cursor:pointer;flex-shrink:0;">
              <img src="../infra_css/imagens/pdf.gif"
                onerror="this.style.display='none'"
                style="width:14px;height:14px;" alt="PDF">
              ${doc.label || doc.nome}
            </label>`;
      });

      html += `
          </div>
        </div>`;
    });

    html += `
      <div style="display:flex;gap:6px;margin-top:8px;">
        <button id="btnSelecionarTodos" type="button"
          style="flex:1;font-size:11px;padding:4px;background:transparent;
            border:1px solid #0056b3;color:#0056b3;border-radius:4px;cursor:pointer;">
          Marcar todos
        </button>
        <button id="btnDeselecionarTodos" type="button"
          style="flex:1;font-size:11px;padding:4px;background:transparent;
            border:1px solid #6c757d;color:#6c757d;border-radius:4px;cursor:pointer;">
          Desmarcar todos
        </button>
      </div>`;

    painel.innerHTML = html;
    _configurarListeners();
  }

  // ── Sincronização checkbox de evento → docs filhos ─────────────
  function _configurarListeners() {
    // Marcar/desmarcar evento → propaga para os docs do mesmo evento
    document.querySelectorAll('.check-evento').forEach(chkEv => {
      chkEv.addEventListener('change', () => {
        const numEv = chkEv.dataset.evento;
        document.querySelectorAll(`.check-doc[data-evento="${numEv}"]`)
          .forEach(chkDoc => { chkDoc.checked = chkEv.checked; });
      });
    });

    // Desmarcar um doc individual → desmarca o evento pai
    document.querySelectorAll('.check-doc').forEach(chkDoc => {
      chkDoc.addEventListener('change', () => {
        if (!chkDoc.checked) {
          const numEv = chkDoc.dataset.evento;
          const chkEv = document.querySelector(`.check-evento[data-evento="${numEv}"]`);
          if (chkEv) chkEv.checked = false;
        }
      });
    });

    // Botões de seleção rápida
    document.getElementById('btnSelecionarTodos')?.addEventListener('click', () => {
      document.querySelectorAll('.check-evento, .check-doc')
        .forEach(ch => { ch.checked = true; });
    });
    document.getElementById('btnDeselecionarTodos')?.addEventListener('click', () => {
      document.querySelectorAll('.check-evento, .check-doc')
        .forEach(ch => { ch.checked = false; });
    });
  }

  /**
   * Retorna a lista de documentos que o usuário selecionou,
   * prontos para enviar ao background para download.
   *
   * @returns {Array<{nome, url, docId, evento}>}
   */
  function getAnexosSelecionados() {
    const checksDocs = document.querySelectorAll('.check-doc:checked');
    return Array.from(checksDocs).map(ch => ({
      nome:   ch.dataset.docNome,
      url:    ch.dataset.docUrl,
      docId:  ch.dataset.docId,
      evento: ch.dataset.evento
    }));
  }

  /**
   * Retorna o baseUrl do processo atual (necessário para download).
   */
  function getBaseUrl() {
    return _processo?.baseUrl || '';
  }

  /**
   * Retorna true se há um processo carregado no seletor.
   */
  function temProcesso() {
    return !!_processo;
  }

  return { renderizar, getAnexosSelecionados, getBaseUrl, temProcesso };
})();
