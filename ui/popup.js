/**
 * ui/popup.js  v4.0
 *
 * Ordem de carregamento no HTML (deve ser mantida):
 *   core/pdfHandler.js
 *   core/aiService.js
 *   core/templateLoader.js
 *   core/ruleEngine.js
 *   core/templateRenderer.js
 *   templates/cessao-credito/rules.js
 *   templates/cessao-credito/renderer.js
 *   ui/components/documentSelector.js
 *   ui/popup.js
 *
 * MUDANÇAS v4:
 *   - Seção A preenchida pelo eproc.js (DOM da tela) — não mais pelo JSON do Gemini
 *   - preencherCamposIA() só preenche seções C e D
 *   - _receberDadosProcesso() salva dadosTela e chama preencherCamposEproc()
 *   - dadosPrecatorio removido do estado e do payload da IA
 *   - _verificarIA() atualizada para Gemini Web
 */

// ================================================================
// ESTADO GLOBAL
// ================================================================

let estadoApp = {
  jsonBruto:  null,
  inputs:     null,
  templateId: 'cessao-credito',
  dadosTela:  null,   // dados extraídos do DOM do eProc pelo eproc.js
};

// ================================================================
// VALIDAÇÃO EM TEMPO REAL
// ================================================================

function validarDestaquesRealTime() {
  const painel     = document.getElementById('painelAlertaDestaque');
  const displayMsg = document.getElementById('msgAlertaUnificada');
  const areaCheck  = document.getElementById('areaCheckPerda');
  const areaDecisao = document.getElementById('areaDecisaoDivergencia');
  const checkPerda = document.getElementById('certificarPerdaObjeto');

  if (!painel || !estadoApp.jsonBruto) return;

  const inst     = estadoApp.jsonBruto.requerimento_cessao?.instrumento_cessao || {};
  const ressalva = parseFloat(inst.ressalva_honorarios?.percentual_contratuais) || 0;

  const previoPerc = parseFloat(document.getElementById('percDestaquePrevio')?.value) || 0;
  const novoPerc   = parseFloat(document.getElementById('percDeferidoAgora')?.value)  || 0;
  const previoNome = document.getElementById('beneficiarioDestaquePrevio')?.value.trim().toLowerCase() || '';
  const novoNome   = document.getElementById('beneficiarioDestaqueNovo')?.value.trim().toLowerCase()   || '';
  const perdaCert  = checkPerda?.checked || false;

  const ehDuplicado = (
    previoPerc > 0 && novoPerc > 0 &&
    previoPerc === novoPerc &&
    previoNome !== '' && previoNome === novoNome
  );
  const novoEfetivo = perdaCert ? 0 : novoPerc;
  const soma        = previoPerc + novoEfetivo;
  const erroMat     = ressalva > 0 && soma !== ressalva;

  let msgs = [], mostrarCheck = false, mostrarSelect = false, tipoPainel = '';

  if (ehDuplicado) {
    mostrarCheck = true;
    if (!perdaCert) {
      msgs.push('⚠️ <strong>AÇÃO NECESSÁRIA:</strong> Pedido idêntico ao histórico. Certifique a perda de objeto.');
      tipoPainel = 'warning';
    } else {
      msgs.push('✅ <strong>PERDA DE OBJETO CERTIFICADA.</strong> Valor novo desconsiderado da soma.');
      tipoPainel = 'success';
    }
  }

  if (erroMat) {
    if (!ehDuplicado || perdaCert) {
      msgs.push(`❌ <strong>DIVERGÊNCIA:</strong> Soma (${soma}%) ≠ Ressalva (${ressalva}%).`);
      mostrarSelect = true;
    }
    tipoPainel = 'error';
  }

  if (msgs.length > 0) {
    painel.classList.remove('hidden');
    displayMsg.innerHTML = msgs.join('<br><br>');
    areaCheck.classList.toggle('hidden', !mostrarCheck);
    areaDecisao.classList.toggle('hidden', !mostrarSelect);

    const estilos = {
      error:   { bg: '#fff5f5', border: '#dc3545', color: '#721c24' },
      warning: { bg: '#fffbef', border: '#ffc107', color: '#856404' },
      success: { bg: '#f4fff6', border: '#28a745', color: '#155724' },
    };
    const e = estilos[tipoPainel] || estilos.warning;
    painel.style.backgroundColor = e.bg;
    painel.style.borderColor     = e.border;
    displayMsg.style.color       = e.color;
  } else {
    painel.classList.add('hidden');
  }
}

// ================================================================
// INICIALIZAÇÃO
// ================================================================

document.addEventListener('DOMContentLoaded', function () {
  console.log('[Assistente] Iniciado. Template:', estadoApp.templateId);

  inicializarLocalStorage();

  // Toggles de sub-painéis condicionais
  const toggleDiv = (checkId, divId) => {
    const check = document.getElementById(checkId);
    const div   = document.getElementById(divId);
    if (check && div) {
      check.addEventListener('change', () => div.classList.toggle('hidden', !check.checked));
      div.classList.toggle('hidden', !check.checked);
    }
  };
  toggleDiv('existeDestaquePrevio', 'divDestaquePrevio');
  toggleDiv('deferidoNestaAnalise', 'divDestaqueNovo');

  document.getElementById('beneficiarioDestaquePrevio')
    ?.addEventListener('input', () => {
      if (estadoApp.jsonBruto) atualizarListaCedentes(estadoApp.jsonBruto);
    });

  _verificarIA();

  // ── Passo 0: ouvir dados do eProc ──────────────────────────────

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.tipo === 'DADOS_PROCESSO') _receberDadosProcesso(msg.payload);
  });

  chrome.storage.session.get('processoDetectado').then(resultado => {
    if (resultado.processoDetectado) {
      _receberDadosProcesso(resultado.processoDetectado);
      chrome.storage.session.remove('processoDetectado');
    }
  });

  document.getElementById('btnUsarModoManual')
    ?.addEventListener('click', _ativarModoManual);

  document.getElementById('btnAnalisarSelecionados')
    ?.addEventListener('click', async () => {
      const anexos = documentSelector.getAnexosSelecionados();
      if (anexos.length === 0) {
        alert('Selecione pelo menos um documento para analisar.');
        return;
      }
      await _baixarEProcessar(anexos);
    });

  // ── Passo 1 ────────────────────────────────────────────────────

  document.getElementById('btnSalvarJSON')
    ?.addEventListener('click', function () {
      const rawInput = document.getElementById('jsonInput').value;
      try {
        estadoApp.jsonBruto = pdfHandler.extrairJSON(rawInput);
        _carregarDadosNaTela(estadoApp.jsonBruto);
      } catch (e) {
        alert('Erro ao ler JSON.\nErro: ' + e.message);
      }
    });

  document.getElementById('btnReiniciar')
    ?.addEventListener('click', function () {
      if (confirm('Deseja limpar todos os dados e reiniciar?')) {
        localStorage.clear();
        window.location.reload();
      }
    });

  document.getElementById('btnGerarCertidao')
    ?.addEventListener('click', function () {
      if (!estadoApp.jsonBruto) {
        alert('Por favor, analise os documentos primeiro.');
        return;
      }
      try {
        capturarInputsFinais();
        document.getElementById('tabelaCertidaoVisual').innerHTML =
          templateRenderer.renderizarCertidao(
            estadoApp.jsonBruto, estadoApp.inputs, estadoApp.templateId
          );
        mudarPasso(1, 2);
      } catch (erro) {
        console.error('[Assistente] Erro ao gerar certidão:', erro);
        alert('Erro ao gerar certidão. Verifique o console.');
      }
    });

  // ── Passo 2 → 3 ────────────────────────────────────────────────

  document.getElementById('btnConfirmarCertidao')
    ?.addEventListener('click', function () {
      try {
        const resultado = ruleEngine.processar(
          estadoApp.jsonBruto, estadoApp.inputs, estadoApp.templateId
        );
        const htmlMinuta = templateRenderer.renderizarMinuta(
          estadoApp.jsonBruto, estadoApp.inputs, resultado.textos, estadoApp.templateId
        );
        const htmlTabela = templateRenderer.renderizarTabela(
          resultado.tabela, estadoApp.templateId
        );
        document.getElementById('previaMinuta').innerHTML  = htmlMinuta;
        document.getElementById('previaTabela').innerHTML  = htmlTabela;
        document.getElementById('outputMinuta').value      = htmlMinuta;
        document.getElementById('outputTabela').value      = htmlTabela;
        mudarPasso(2, 3);
      } catch (erro) {
        console.error('[Assistente] Erro ao gerar minuta:', erro);
        alert('Erro ao processar regras: ' + erro.message);
      }
    });

  document.getElementById('btnVoltarPasso2')
    ?.addEventListener('click', () => {
      if (typeof resetarRevisaoPorSecao === 'function') resetarRevisaoPorSecao();
      mudarPasso(3, 2);
    });

  document.getElementById('btnVoltarPasso1')
    ?.addEventListener('click', () => {
      if (typeof resetarRevisaoPorSecao === 'function') resetarRevisaoPorSecao();
      mudarPasso(2, 1);
    });

  configurarCopia('btnCopiarMinuta', 'outputMinuta', 'Só Minuta');
  configurarCopia('btnCopiarTabela', 'outputTabela', 'Só Tabela');

  document.getElementById('btnCopiarTudo')
    ?.addEventListener('click', function () {
      const texto =
        document.getElementById('outputMinuta').value + '\n\n' +
        document.getElementById('outputTabela').value;
      navigator.clipboard.writeText(texto);
      this.innerText = '✓ Tudo Copiado!';
      this.style.backgroundColor = '#28a745';
      setTimeout(() => {
        this.innerText = '📋 Copiar Tudo (Minuta + Tabela)';
        this.style.backgroundColor = '#17a2b8';
      }, 2000);
    });

  ['percDestaquePrevio', 'percDeferidoAgora', 'beneficiarioDestaquePrevio',
   'beneficiarioDestaqueNovo', 'certificarPerdaObjeto'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(
      el.type === 'checkbox' ? 'change' : 'input',
      validarDestaquesRealTime
    );
  });
});

// ================================================================
// PASSO 0 — RECEPÇÃO DOS DADOS DO EPROC
// ================================================================

function _receberDadosProcesso(payload) {
  document.getElementById('statusEproc')?.classList.add('hidden');
  document.getElementById('painelDocumentos')?.classList.remove('hidden');

  // Salva dados da tela extraídos pelo eproc.js
  estadoApp.dadosTela = payload.dadosTela || null;

  // Preenche seção A imediatamente — não espera o Gemini
  if (estadoApp.dadosTela) {
    preencherCamposEproc(estadoApp.dadosTela, payload.numeroProcessoFormatado);
  }

  documentSelector.renderizar(payload);

  // Exibe a barra de ação com o botão de analisar
  const actionBar = document.getElementById('actionBar0');
  if (actionBar) actionBar.style.display = 'flex';

  console.log('[Assistente] Processo carregado:', payload.numeroProcessoFormatado);
}

function _ativarModoManual() {
  mudarPasso(0, 1);
  document.getElementById('modoManualContainer')?.classList.remove('hidden');
  document.getElementById('areaCamposAutopreenchidos')?.classList.add('hidden');
}

// ================================================================
// PASSO 0 — DOWNLOAD E PROCESSAMENTO
// ================================================================

async function _baixarEProcessar(anexos) {
  const btnAnalisar = document.getElementById('btnAnalisarSelecionados');
  const progresso   = document.getElementById('progressoDownload');
  const msgProg     = document.getElementById('msgProgresso');
  const barra       = document.getElementById('barraProgresso');

  btnAnalisar.disabled = true;
  progresso.classList.remove('hidden');
  msgProg.textContent  = `⏬ Baixando 0/${anexos.length}...`;
  barra.style.width    = '5%';

  const _ouvirProgresso = (msg) => {
    if (msg.tipo === 'PROGRESSO_DOWNLOAD') {
      const pct = Math.round((msg.atual / msg.total) * 50);
      barra.style.width    = pct + '%';
      msgProg.textContent  = `⏬ Baixando ${msg.atual}/${msg.total}: ${msg.nome}`;
    }
  };
  chrome.runtime.onMessage.addListener(_ouvirProgresso);

  try {
    const resposta = await chrome.runtime.sendMessage({
      tipo: 'BAIXAR_PDFS',
      anexos
    });

    chrome.runtime.onMessage.removeListener(_ouvirProgresso);

    if (!resposta.sucesso) {
      throw new Error(resposta.erro || 'Falha desconhecida no download.');
    }

    estadoApp.arquivosBase64 = resposta.arquivos;
    msgProg.textContent = '🤖 Enviando PDFs ao Gemini para análise...';
    barra.style.width   = '70%';

    try {
      const template = await templateLoader.carregar(estadoApp.templateId);

      const resultadoIA = await aiService.extrair({
        arquivosBase64: resposta.arquivos,
        promptTemplate: template.prompt,
        // dadosPrecatorio removido — dados do processo vêm do eProc (DOM)
        onProgresso: (msg) => { msgProg.textContent = msg; }
      });

      if (resultadoIA.sucesso) {
        estadoApp.jsonBruto = resultadoIA.dados;

        try {
          chrome.storage.session.set({ ultimoJSON: resultadoIA.dados });
        } catch (_) {}

        progresso.classList.add('hidden');
        barra.style.width    = '100%';
        btnAnalisar.disabled = false;

        mudarPasso(0, 1);
        _carregarDadosNaTela(estadoApp.jsonBruto);

      } else {
        throw new Error(resultadoIA.erro || 'IA não retornou dados válidos.');
      }

    } catch (erroIA) {
      console.warn('[Assistente] Falha na IA, ativando modo manual:', erroIA.message);
      setTimeout(() => {
        progresso.classList.add('hidden');
        barra.style.width = '0%';
      }, 800);
      btnAnalisar.disabled = false;

      mudarPasso(0, 1);
      document.getElementById('modoManualContainer')?.classList.remove('hidden');

      const nomesDocs = resposta.arquivos.map(a => a.nome).join(', ');
      document.getElementById('jsonInput').placeholder =
        `✅ ${resposta.arquivos.length} PDF(s) baixado(s): ${nomesDocs}\n\n` +
        `⚠️ Falha na automação do Gemini: ${erroIA.message}\n\n` +
        `Cole aqui o JSON gerado manualmente para continuar.`;
    }

  } catch (erro) {
    chrome.runtime.onMessage.removeListener(_ouvirProgresso);
    progresso.classList.add('hidden');
    barra.style.width    = '0%';
    btnAnalisar.disabled = false;
    console.error('[Assistente] Erro no download:', erro);
    alert('Erro ao baixar documentos: ' + erro.message);
  }
}

// ================================================================
// IA — INDICADOR DE STATUS
// ================================================================

async function _verificarIA() {
  const status    = await aiService.verificarDisponibilidade();
  const indicador = document.getElementById('statusIA');
  const dot       = document.getElementById('iaDot');
  if (!indicador) return;

  if (status.disponivel) {
    if (dot) dot.classList.add('ok');
    indicador.textContent = 'Gemini Web disponível';
    return;
  }

  if (dot) dot.classList.add('err');
  indicador.textContent = 'Verifique o login em gemini.google.com';
}

// ================================================================
// SEÇÃO A — DADOS DO EPROC (preenchimento automático via DOM)
// ================================================================

function preencherCamposEproc(dadosTela, numeroFormatado) {
  if (!dadosTela) return;

  _setVal('procEproc',        dadosTela.numeroEproc || numeroFormatado || '');
  _setVal('procOriginario',   dadosTela.processoOriginario || '');
  _setVal('orgaoJulgador',    dadosTela.orgaoJulgador || '');
  _setVal('assuntoPrincipal', dadosTela.assuntoPrincipal || '');

  _renderizarLocalizadores(dadosTela.localizadores || []);
  _renderizarPartesTela(dadosTela.requerentes, dadosTela.requeridos);

  // Revela a área de dados e esconde o modo manual
  document.getElementById('areaCamposAutopreenchidos')?.classList.remove('hidden');
  document.getElementById('modoManualContainer')?.classList.add('hidden');

  console.log('[Assistente] Seção A preenchida com dados do eProc.');
}

function _renderizarLocalizadores(localizadores) {
  const container = document.getElementById('containerLocalizadores');
  if (!container) return;
  container.innerHTML = localizadores.length
    ? localizadores.map(loc =>
        `<span class="badge badge-blue" style="margin:2px;">${loc}</span>`
      ).join('')
    : '<span style="color:var(--text-muted);font-size:11px;">Nenhum</span>';
}

function _renderizarPartesTela(requerentes, requeridos) {
  const container = document.getElementById('containerPartesTela');
  if (!container) return;

  const renderLista = (partes, titulo) => {
    if (!partes?.length) return '';
    const items = partes.map(p => {
      const reps = p.representantes?.length
        ? `<div style="font-size:11px;color:var(--text-muted);margin-top:1px;">
             ${p.representantes.join(', ')}
           </div>`
        : '';
      return `<div style="padding:3px 0;border-bottom:1px dashed var(--gray-200);">
        <strong style="font-size:12px;">${p.nome}</strong>${reps}
      </div>`;
    }).join('');
    return `<div style="flex:1;min-width:0;">
      <div style="font-size:10px;font-weight:700;letter-spacing:.06em;
        text-transform:uppercase;color:var(--text-muted);margin-bottom:4px;">
        ${titulo}
      </div>
      ${items}
    </div>`;
  };

  container.innerHTML = `
    <div style="display:flex;gap:12px;font-size:12px;">
      ${renderLista(requerentes, 'Requerente')}
      ${renderLista(requeridos,  'Requerido')}
    </div>`;
}

// ================================================================
// SEÇÕES C e D — DADOS DOS DOCUMENTOS (preenchimento via JSON da IA)
// ================================================================

/**
 * Preenche apenas os campos que dependem da análise dos documentos pelo Gemini.
 * A seção A (dados do processo) vem do eProc — não mais do JSON.
 */
function preencherCamposIA(json) {
  if (!json) return;

  // ── C. Destaque Novo ───────────────────────────────────────────
  const reqDestaque = json.requerimento_destaque || {};
  const contrato    = reqDestaque.contrato_honorarios || {};

  if (reqDestaque.ha_requerimento === true) {
    const chkNovo = document.getElementById('deferidoNestaAnalise');
    if (chkNovo && !chkNovo.checked) {
      chkNovo.checked = true;
      chkNovo.dispatchEvent(new Event('change'));
    }
    _setVal('beneficiarioDestaqueNovo', reqDestaque.beneficiario || contrato.contratante);
    _setVal('percDeferidoAgora', contrato.percentual_contratuais);
  }

  // ── D. Legitimidade dos Cedentes ───────────────────────────────
  atualizarListaCedentes(json);

  console.log('[Assistente] Campos IA (seções C e D) preenchidos.');
}

// ================================================================
// LISTA DE CEDENTES (Seção D)
// ================================================================

function atualizarListaCedentes(json) {
  const container = document.getElementById('containerCedentesCheck');
  if (!container) return;

  const inst     = json?.requerimento_cessao?.instrumento_cessao || {};
  const cedentes = inst.partes?.cedentes || [];

  if (cedentes.length === 0) {
    container.innerHTML =
      '<span style="color:var(--text-muted);font-size:12px;">Nenhum cedente identificado pela IA.</span>';
    return;
  }

  container.innerHTML = cedentes.map((c, i) => {
    const nome    = c.nome || `Cedente ${i + 1}`;
    const doc     = c.numero_documento
      ? ` <span class="badge badge-blue" style="font-size:9px;">${c.tipo_documento || 'Doc'} ${c.numero_documento}</span>`
      : '';
    const checked = c.e_parte_precatorio ? 'checked' : '';
    return `
      <label class="cedente-item">
        <input type="checkbox" class="check-cedente"
          data-nome="${nome}" ${checked}>
        <span>${nome}${doc}</span>
      </label>`;
  }).join('');
}

// ================================================================
// CARREGAMENTO PÓS-IA
// ================================================================

function _carregarDadosNaTela(json) {
  preencherCamposIA(json);
  document.getElementById('modoManualContainer')?.classList.add('hidden');
  document.getElementById('areaCamposAutopreenchidos')?.classList.remove('hidden');
  document.getElementById('jsonInput')?.classList.add('hidden');
  document.getElementById('areaCamposAutopreenchidos')
    ?.scrollIntoView({ behavior: 'smooth' });
}

// ================================================================
// UTILITÁRIOS
// ================================================================

function _setVal(id, val) {
  const el = document.getElementById(id);
  if (!el || val === undefined || val === null || val === '') return;
  el.value = String(val);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function inicializarLocalStorage() {
  document.querySelectorAll('input:not(#jsonInput), textarea:not(#jsonInput), select')
    .forEach(el => {
      const salvo = localStorage.getItem(el.id);
      if (salvo !== null) {
        if (el.type === 'checkbox') el.checked = (salvo === 'true');
        else el.value = salvo;
      }
      const ev = el.type === 'checkbox' ? 'change' : 'input';
      el.addEventListener(ev, () =>
        localStorage.setItem(el.id, el.type === 'checkbox' ? el.checked : el.value)
      );
    });
}

function mudarPasso(sai, entra) {
  document.getElementById(`passo${sai}`)?.classList.add('hidden');
  document.getElementById(`passo${entra}`)?.classList.remove('hidden');
  // Atualiza indicador de passos se a função existir (definida no popup.html)
  if (typeof atualizarIndicador === 'function') atualizarIndicador(entra);
  if (typeof sincronizarActionBars === 'function') sincronizarActionBars(entra);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function configurarCopia(btnId, areaId, label) {
  document.getElementById(btnId)?.addEventListener('click', function () {
    navigator.clipboard.writeText(document.getElementById(areaId)?.value || '');
    this.innerText = '✓ Copiado!';
    this.style.backgroundColor = '#28a745';
    setTimeout(() => {
      this.innerText = label;
      this.style.backgroundColor = '';
    }, 2000);
  });
}

function capturarInputsFinais() {
  const cedentesLegitimos = [];
  document.querySelectorAll('.check-cedente:checked').forEach(chk => {
    cedentesLegitimos.push(chk.dataset.nome);
  });

  estadoApp.inputs = {
    eventoComunicacao:        document.getElementById('eventoComunicacaoCessao')?.value   || '',
    eventoInstrumento:        document.getElementById('eventoInstrumentoCessao')?.value   || '',
    dataComunicacao:          document.getElementById('dataComunicacaoCessao')?.value     || '',
    existeDestaquePrevio:     document.getElementById('existeDestaquePrevio')?.checked    || false,
    percDestaquePrevio:       parseFloat(document.getElementById('percDestaquePrevio')?.value) || 0,
    eventoDestaquePrevio:     document.getElementById('eventoDestaquePrevio')?.value      || '',
    beneficiarioDestaquePrevio: document.getElementById('beneficiarioDestaquePrevio')?.value || '',
    deferidoNestaAnalise:     document.getElementById('deferidoNestaAnalise')?.checked    || false,
    percDeferidoAgora:        parseFloat(document.getElementById('percDeferidoAgora')?.value)  || 0,
    eventoPedidoDestaque:     document.getElementById('eventoPedidoDestaque')?.value      || '',
    dataPedidoDestaque:       document.getElementById('dataPedidoDestaque')?.value        || '',
    beneficiarioDestaqueNovo: document.getElementById('beneficiarioDestaqueNovo')?.value  || '',
    opcaoDivergencia:         document.getElementById('opcaoDivergencia')?.value          || 'INTIMAR',
    inferiorEquivaleTotalidade: document.getElementById('inferiorEquivaleTotalidade')?.checked || false,
    perdaObjetoCertificada:   document.getElementById('certificarPerdaObjeto')?.checked   || false,
    cedentesLegitimos,
  };
}